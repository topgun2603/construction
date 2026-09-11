import 'dart:async';

import 'package:dio/dio.dart';

import 'env.dart';
import 'session.dart';

/// Something the API said no to, in words worth showing somebody.
class ApiException implements Exception {
  ApiException(this.message, {this.status, this.code});

  final String message;
  final int? status;
  final String? code;

  @override
  String toString() => message;
}

/// The API, with the session attached.
///
/// Two things happen here that must not be scattered around the app:
///
/// 1. Every request carries the access token, so no screen has to remember to attach it.
/// 2. A 401 refreshes once and replays the request. Access tokens are short-lived by design, so a
///    person filing a report from a site with no signal will hit an expired one the moment the
///    signal returns — and being thrown back to the sign-in screen at that moment, with the day's
///    work in hand, is the worst possible time for it.
///
/// The refresh is single-flight. Six queued requests waking up together would otherwise each rotate
/// the refresh token, and rotation means five of them are then holding a token the server has already
/// retired — which looks exactly like a stolen token and correctly kills the session.
class ApiClient {
  ApiClient({required SessionStore store, Dio? dio}) : _store = store, _dio = dio ?? Dio() {
    _dio.options
      ..baseUrl = Env.apiUrl
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 30)
      ..headers['Content-Type'] = 'application/json'
      // Anything but a 5xx is a considered answer; let the code below read it rather than throw.
      ..validateStatus = (status) => status != null && status < 500;

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.extra['skipAuth'] != true) {
            final tokens = await _store.readTokens();
            if (tokens != null) {
              options.headers['Authorization'] = 'Bearer ${tokens.accessToken}';
            }
          }
          handler.next(options);
        },
      ),
    );
  }

  final Dio _dio;
  final SessionStore _store;

  /// Called when the session cannot be recovered, so the app can show the sign-in screen.
  void Function()? onSessionLost;

  Future<TokenPair>? _refreshing;

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _send(() => _dio.get(path, queryParameters: query));

  Future<dynamic> post(String path, {Object? body, bool skipAuth = false}) => _send(
    () => _dio.post(
      path,
      data: body,
      options: Options(extra: {'skipAuth': skipAuth}),
    ),
  );

  Future<dynamic> patch(String path, {Object? body}) => _send(() => _dio.patch(path, data: body));

  // A body on a DELETE is unusual, but unregistering a device says *which* device, and the token is
  // too long to put in a path segment.
  Future<dynamic> delete(String path, {Object? body}) => _send(() => _dio.delete(path, data: body));

  Future<dynamic> _send(Future<Response<dynamic>> Function() call) async {
    Response<dynamic> response;
    try {
      response = await call();
    } on DioException catch (error) {
      throw ApiException(_networkMessage(error));
    }

    if (response.statusCode == 401 && !_isAuthRoute(response)) {
      final refreshed = await _refreshOnce();
      if (refreshed) {
        try {
          response = await call();
        } on DioException catch (error) {
          throw ApiException(_networkMessage(error));
        }
      }
    }

    final status = response.statusCode ?? 0;
    if (status >= 200 && status < 300) return response.data;

    if (status == 401) {
      await signOutLocally();
      throw ApiException('Your session has ended. Sign in again.', status: 401);
    }

    final data = response.data;
    final message = data is Map && data['message'] is String
        ? data['message'] as String
        : 'Something went wrong (${status == 0 ? 'no response' : status})';
    final code = data is Map && data['code'] is String ? data['code'] as String : null;
    throw ApiException(message, status: status, code: code);
  }

  bool _isAuthRoute(Response<dynamic> response) =>
      response.requestOptions.path.startsWith('/auth/');

  /// Rotates the refresh token, at most once at a time. Returns false when the session is gone.
  Future<bool> _refreshOnce() async {
    final inflight = _refreshing;
    if (inflight != null) {
      try {
        await inflight;
        return true;
      } catch (_) {
        return false;
      }
    }

    final attempt = _doRefresh();
    _refreshing = attempt;
    try {
      await attempt;
      return true;
    } catch (_) {
      await signOutLocally();
      return false;
    } finally {
      _refreshing = null;
    }
  }

  Future<TokenPair> _doRefresh() async {
    final tokens = await _store.readTokens();
    if (tokens == null) throw ApiException('No session');

    final response = await _dio.post(
      '/auth/refresh',
      data: {'refresh_token': tokens.refreshToken, 'device_id': await _store.deviceId()},
      options: Options(extra: {'skipAuth': true}),
    );
    final status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) throw ApiException('Session expired', status: status);

    final next = TokenPair.fromJson(Map<String, dynamic>.from(response.data as Map));
    await _store.writeTokens(next);
    return next;
  }

  /// Exchanges a phone-auth token for a session. Public: there is nothing to attach yet.
  Future<Map<String, dynamic>> exchange(String phoneAuthToken) async {
    final data = await post(
      '/auth/exchange',
      body: {'firebase_token': phoneAuthToken, 'device_id': await _store.deviceId()},
      skipAuth: true,
    );
    return Map<String, dynamic>.from(data as Map);
  }

  /// Put bytes straight into object storage through a presigned URL.
  ///
  /// Goes through this client's Dio rather than a bare HttpClient so that a test can intercept it,
  /// and with `skipAuth` set: the URL is already signed, and an extra Authorization header makes S3
  /// reject the signature.
  Future<void> putToStorage({
    required String url,
    required Map<String, String> headers,
    required List<int> bytes,
  }) async {
    late Response<dynamic> response;
    try {
      response = await _dio.put<dynamic>(
        url,
        data: Stream<List<int>>.fromIterable([bytes]),
        options: Options(
          headers: {...headers, Headers.contentLengthHeader: bytes.length},
          extra: {'skipAuth': true},
          // The signature covers the exact request; nothing here may add to it.
          contentType: headers['Content-Type'],
        ),
      );
    } on DioException catch (error) {
      throw ApiException(_networkMessage(error));
    }
    final status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      throw ApiException('Storage refused the upload ($status)', status: status);
    }
  }

  Future<Map<String, dynamic>> me() async {
    final data = await get('/me');
    return Map<String, dynamic>.from(data as Map);
  }

  /// Ends the session everywhere, then locally. A failed call still clears this device — somebody
  /// handing their phone over must not be told "could not sign out".
  Future<void> signOut() async {
    try {
      await post('/auth/logout');
    } catch (_) {
      // Nothing to do about it, and nothing worth saying.
    }
    await signOutLocally();
  }

  Future<void> signOutLocally() async {
    await _store.clear();
    onSessionLost?.call();
  }

  String _networkMessage(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
        return 'The network is too slow to answer. Try again in a moment.';
      case DioExceptionType.connectionError:
      case DioExceptionType.unknown:
        return Env.isLocal
            ? 'Cannot reach the API at ${Env.apiUrl}. Is it running?'
            : 'No connection. This will send itself when you are back on the network.';
      default:
        return error.message ?? 'Something went wrong';
    }
  }
}
