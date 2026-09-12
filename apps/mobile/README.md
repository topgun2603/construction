# BUILDR mobile (Flutter)

The site app, against the same API the web app uses.

```
lib/
├── core/
│   ├── env.dart            # where this build talks to
│   ├── phone.dart          # toE164Indian, ported from packages/shared
│   ├── format.dart         # paise and IST dates, integer arithmetic only
│   ├── session.dart        # tokens in the keystore, cached /me
│   ├── api_client.dart     # Dio + bearer token + single-flight refresh
│   ├── api_providers.dart  # every read and write, in one place
│   ├── phone_auth.dart     # Firebase OTP, or the development bypass
│   ├── auth_controller.dart# Riverpod: restoring / signed out / signed in
│   └── theme.dart          # the web palette, verbatim
├── features/
│   ├── auth/          # phone → code → session
│   ├── shell/         # top bar, drawer, bottom bar; destinations per permission
│   ├── home/          # today: headcount, what is waiting, sites needing a report
│   ├── sites/         # list, new site, detail — map, photos, milestones, people
│   ├── attendance/    # the roll call
│   ├── dpr/           # daily reports, read and filed
│   ├── workers/       # labour on the books: add, edit, assign, advances
│   ├── indents/       # raise, approve, reject
│   ├── expenses/      # record, approve, reject
│   ├── stock/         # on hand per site, booking in and out
│   ├── notifications/
│   └── profile/
└── shared/            # status pills, empty and error states, map, photo gallery
```

Navigation is gated on the same permission strings the API enforces, so a client's app is four items
and an owner's is ten, and nothing is offered that a request would refuse.

## Running it

The API must be up (`apps/api`, port 4100 in this checkout) and reachable from the device. On the
Android emulator the host machine is `10.0.2.2`, which is the default — a physical phone needs the
laptop's LAN address passed in.

**Without Firebase** (what you can do today):

```bash
# apps/api/.env must have DEV_AUTH_BYPASS=true — it already does locally
cd apps/mobile
flutter run --dart-define=DEV_AUTH_BYPASS=true
```

**On a phone plugged in over USB**, the simplest route is to tunnel rather than open a firewall
port. Two ports, not one:

```bash
adb reverse tcp:4100 tcp:4100   # the API
adb reverse tcp:9000 tcp:9000   # MinIO — site photos are served straight from it
flutter run --dart-define=API_URL=http://localhost:4100/v1 --dart-define=DEV_AUTH_BYPASS=true
```

The second one catches people out. Photo URLs are presigned by the API against `S3_ENDPOINT`, so
they arrive pointing at `http://localhost:9000/...`; on a phone "localhost" is the phone, and every
photo renders as a broken image while the rest of the app works perfectly. The tunnels drop whenever
the cable is replugged — re-run both.

No SMS is sent. Type any number that exists in the account and it signs straight in; the login
screen says on its face that it is doing this. The seeded demo users are `9000000001` (owner)
through `9000000005` (client).

**Against a deployed API:**

```bash
flutter run --dart-define=API_URL=https://api.your-domain.com/v1
```

## Turning on real OTP

The build side is done: the Google Services plugin is wired in, release signing reads a gitignored
`key.properties`, and the app already falls back to the development sign-in when Firebase is not
configured. What is left needs the Firebase console, which only you can reach.

**1. Register the Android app.** In the existing Firebase project (`construction-40308`), add an
Android app with the package name exactly:

```
com.buildr.buildr_mobile
```

**2. Give it the signing fingerprints.** Phone auth refuses to send an SMS without them, and the
failure looks like nothing happening rather than an error. The debug key on this machine is:

```
SHA-1    72:13:13:E2:1D:47:E7:B5:78:E1:B6:25:51:1A:B4:10:3E:A0:0A:24
SHA-256  2C:8D:0D:AA:06:94:EF:37:E1:F0:46:1F:13:99:78:C7:DF:79:C6:35:3C:B1:50:34:7C:B2:D7:1F:18:8A:0C:0D
```

That key lives in this laptop's `.android/debug.keystore` and is specific to it: building on another
machine produces different fingerprints, which need adding too. To print them anywhere:

```bash
cd android && ./gradlew :app:signingReport
```

**3. Download `google-services.json`** into `android/app/`. It is gitignored. The build applies the
Google Services plugin only when that file exists, so a clone without it still compiles - it just
signs in the development way.

**4. Enable Phone** under Authentication -> Sign-in method, and check the daily SMS quota suits the
number of people signing in. Done: phone sign-in is on for `construction-40308`.

### Test numbers

The seeded demo users are fictional numbers, so no SMS can ever reach them. They are registered as
Firebase **test phone numbers** instead, which return a fixed code without sending anything and
without touching the quota:

| Number | Code | Who |
|---|---|---|
| `9000000001` | `123456` | owner — and the platform console operator |
| `9000000002` | `123456` | project_manager |
| `9000000003` | `123456` | site_supervisor |
| `9000000004` | `123456` | accounts |
| `9000000005` | `123456` | client |

Type the ten digits, then `123456`. Firebase caps this list at ten numbers; the console keeps it
under Authentication -> Sign-in method -> Phone -> "Phone numbers for testing". A test number is
verified entirely client-side, so it needs no signal and no SIM — but it is still a real Firebase
sign-in, which means it exercises the code path a customer will use, unlike `DEV_AUTH_BYPASS`.

**5. Build without the development flag.** `--dart-define=DEV_AUTH_BYPASS=true` is what forces the
bypass; drop it and the app asks for a real code — including for the test numbers above:

```bash
# Against the local API, over the usb tunnels, with the real OTP screen
flutter run --dart-define=API_URL=http://localhost:4100/v1

# Against a deployed API
flutter run --dart-define=API_URL=https://api.your-domain.com/v1
```

If the code does not arrive, the code step offers **Resend** after thirty seconds. The second
request passes Firebase's `forceResendingToken`; without it Android answers from its cache and no
new message is ever sent, which is why "Resend" elsewhere so often does nothing.

### For a release build

Play needs a real signing key, and its fingerprint has to be registered with Firebase as well, or
OTP works in debug and fails in production. Create the keystore once:

```bash
keytool -genkey -v -keystore buildr-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias buildr
```

Keep it outside the repository, then write `android/key.properties` (also gitignored):

```properties
storePassword=...
keyPassword=...
keyAlias=buildr
storeFile=C:/path/to/buildr-release.jks
```

Run `./gradlew :app:signingReport` again and add the **release** variant's SHA-1 and SHA-256 to
Firebase. Losing that keystore means never being able to update the app on Play, so back it up
somewhere that is not this laptop.

## How sign-in works

Identical to the web app, deliberately:

1. Firebase proves the person controls the number, and returns an ID token.
2. `POST /auth/exchange` swaps it for a BUILDR access + refresh pair. The Firebase token is never
   used again.
3. `GET /me` says who they are, what they may do, and which modules the company pays for.

Three outcomes, all of them a successful verification: a session; `onboarding_required` (a number on
no company — the app explains and stops, because starting a company means choosing a plan, which is
a web flow); or `tenant_choice_required` (a number on several — refused rather than guessed).

There is **no role picker anywhere**, and there must never be one. Everybody signs in the same way;
what differs afterwards is what the server says they may do. `Me.can('attendance.record')` mirrors
the API's own permission check so a button is never offered that the request would refuse.

## Maps and photos

Maps are OpenStreetMap raster tiles through `flutter_map` — the same source the web app uses, so
neither needs an API key or a billing account. The card does not pan: at 350px a pin is for
recognising a place, and a map that swallows scroll gestures inside a scrolling page is worse than
one that opens properly on tap. Tapping hands the coordinates to whatever map app the phone has via
a `geo:` URI, falling back to the browser.

Photos are private objects. Every image is fetched through a URL signed for that person for an hour;
nothing in the app holds a permanent link to somebody's site photographs, and a URL that leaks stops
working on its own. Thumbnails are used in the strip where the media worker has generated them.

## Notifications

Two halves, and they arrive by different routes:

- **The list and the badge** are polled. `/notifications` fills the screen behind the bell, and the
  unread count rides along on `/me` rather than costing a request of its own.
- **Push** is FCM. `lib/core/push.dart` asks for permission *after* sign-in — the dialog means
  something to somebody looking at their sites and nothing to somebody looking at a login form —
  then registers the device token with `POST /me/fcm-tokens` and withdraws it with `DELETE` on the
  way out of `signOut()`.

The token is per install, not per person, which is why the session brackets it. A site phone shared
by three supervisors must not keep delivering the first one's approvals to the third.

A tapped notification is routed by the `type` FCM carries — `indent.approved` opens Indents,
`dpr.submitted` opens Reports — but only if that person's role has the section; anything else, and
anything with no mobile home like `wage_period.drafted`, opens the notification list.
`sectionForNotification` is a plain function so `test/push_test.dart` can hold it to the types the
API actually emits.

**Push needs `google-services.json`.** Without it `Firebase.initializeApp()` fails at startup, and
every path here turns into a no-op: no permission dialog, no token, no registration call. The app
signs in and works. The API is equally forgiving — `FcmService` logs a dry run when it has no
service account, so a local stack sends nothing and fails nothing. Turning on real OTP (above) is
the same setup, so doing it once lights up both.

## What is next

**Indents and expenses, offline.** The roll call, the daily report and its photos all queue on a
phone with no signal and send themselves when it returns. Raising an indent and recording a bill
still need a connection — which is the wrong way round, because the basement a supervisor is
standing in is exactly where they run out of both signal and patience.

Then the rest of the admin the web app has and the phone does not: editing a site and its
milestones, the people on it, and the settings lists — contractors, materials, team and roles.

**iOS has never been configured.** There is a Flutter scaffold and no `GoogleService-Info.plist`,
so sign-in and push do not work there at all.

The wage and earnings arithmetic those screens preview offline must match the server exactly.
`packages/shared/src/earnings.ts` is the reference implementation — port it with the same rounding
rules (half day floors to the paise, overtime is computed in tenths of an hour) and port its test
cases alongside it, the way `lib/core/phone.dart` and `test/phone_test.dart` were ported.

## Checks

```bash
flutter analyze
flutter test
```
