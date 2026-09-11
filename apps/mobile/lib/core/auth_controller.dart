import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'phone_auth.dart';
import 'push.dart';
import 'session.dart';

final sessionStoreProvider = Provider<SessionStore>((ref) => SessionStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(store: ref.watch(sessionStoreProvider));
  // A session that dies mid-request must take the UI with it, or the app sits on a screen full of
  // data it can no longer refresh.
  client.onSessionLost = () => ref.read(authControllerProvider.notifier).forgetSession();
  return client;
});

final phoneAuthProvider = Provider<PhoneAuth>((ref) => resolvePhoneAuth());

/// Where the app is between "nothing known" and "signed in".
enum AuthStatus {
  /// Reading the keystore. First frame only.
  restoring,
  signedOut,
  signedIn,

  /// The number is real but belongs to no company yet — a builder who has not signed up.
  /// Starting a company means choosing a plan and paying for it, which happens on the web.
  needsOnboarding,
}

class AuthState {
  const AuthState({required this.status, this.me, this.error});

  final AuthStatus status;
  final Me? me;
  final String? error;

  bool get isSignedIn => status == AuthStatus.signedIn && me != null;

  AuthState copyWith({AuthStatus? status, Me? me, String? error}) =>
      AuthState(status: status ?? this.status, me: me ?? this.me, error: error);
}

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>(
  (ref) => AuthController(ref),
);

/// Signing in, staying signed in, and signing out.
class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(const AuthState(status: AuthStatus.restoring)) {
    restore();
  }

  final Ref _ref;

  ApiClient get _api => _ref.read(apiClientProvider);
  SessionStore get _store => _ref.read(sessionStoreProvider);
  PushService get _push => _ref.read(pushServiceProvider);

  /// Cold start.
  ///
  /// The cached `/me` is shown immediately and refreshed behind it. A supervisor opening the app in
  /// a basement should see their name and their sites, not a spinner waiting on a network that is
  /// not there — the tokens on disk are what say they are signed in, not the reachability of the API.
  Future<void> restore() async {
    final tokens = await _store.readTokens();
    if (tokens == null) {
      state = const AuthState(status: AuthStatus.signedOut);
      return;
    }

    final cached = await _store.readMe();
    if (cached != null) {
      state = AuthState(status: AuthStatus.signedIn, me: Me.fromJson(cached));
    }

    try {
      final fresh = await _api.me();
      await _store.writeMe(fresh);
      state = AuthState(status: AuthStatus.signedIn, me: Me.fromJson(fresh));
      // Only once `/me` has answered. Registering against tokens that turn out to be dead would
      // hand the API a device it is about to sign out anyway.
      unawaited(_push.register());
    } on ApiException catch (error) {
      // A 401 already cleared the session through the client; anything else is the network, and
      // offline is not signed out.
      if (error.status == 401) {
        state = const AuthState(status: AuthStatus.signedOut);
      } else if (cached == null) {
        state = const AuthState(status: AuthStatus.signedOut);
      }
    }
  }

  /// Turns a proven phone number into a session.
  ///
  /// Three outcomes, all of them a successful verification: a session, a number that belongs to no
  /// company yet, or a number belonging to several. The last is refused rather than guessed —
  /// picking the wrong company would show somebody another builder's sites.
  Future<void> completeSignIn(String phoneAuthToken) async {
    state = state.copyWith(status: state.status, error: null);
    final payload = await _api.exchange(phoneAuthToken);

    if (payload['onboarding_required'] == true) {
      state = const AuthState(status: AuthStatus.needsOnboarding);
      return;
    }
    if (payload['tenant_choice_required'] == true) {
      throw ApiException('This number belongs to more than one builder. Contact support.');
    }

    await _store.writeTokens(TokenPair.fromJson(payload));
    final me = await _api.me();
    await _store.writeMe(me);
    state = AuthState(status: AuthStatus.signedIn, me: Me.fromJson(me));
    unawaited(_push.register());
  }

  /// Pulls `/me` again — after a role change, or when a screen needs to be sure.
  Future<void> refreshMe() async {
    if (!state.isSignedIn) return;
    try {
      final fresh = await _api.me();
      await _store.writeMe(fresh);
      state = AuthState(status: AuthStatus.signedIn, me: Me.fromJson(fresh));
    } on ApiException {
      // Keep showing what we have. The next request will surface anything that matters.
    }
  }

  Future<void> signOut() async {
    // Before the session goes: withdrawing a device is an authenticated request, and a token left
    // registered would keep this person's approvals arriving on a phone somebody else is holding.
    await _push.unregister();
    await _api.signOut();
    state = const AuthState(status: AuthStatus.signedOut);
  }

  /// The session went away underneath us — token expired past recovery, or revoked elsewhere.
  void forgetSession() {
    if (state.status == AuthStatus.signedOut) return;
    state = const AuthState(status: AuthStatus.signedOut);
  }

  void backToSignIn() => state = const AuthState(status: AuthStatus.signedOut);
}
