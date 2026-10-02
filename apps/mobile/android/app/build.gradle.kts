import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

/*
 * Firebase, only if this checkout has been given its keys.
 *
 * `google-services.json` is gitignored: it belongs to whoever owns the Firebase project, not to the
 * repository. The Google Services plugin fails the build outright when the file is missing, which
 * would leave a fresh clone unable to compile at all — so it is applied only when the file is
 * there. Without it the app still builds and falls back to the development sign-in, exactly as
 * `main.dart` describes.
 */
val firebaseConfig = file("google-services.json")
if (firebaseConfig.exists()) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.lifecycle(
        "google-services.json not found - building without Firebase. " +
            "Real OTP sign-in needs it; see apps/mobile/README.md."
    )
}

/*
 * Release signing.
 *
 * Reads android/key.properties, which is gitignored and holds the keystore password. A release
 * build without it falls back to the debug key so the build still works — but a debug-signed APK
 * cannot go to Play, and its fingerprint is not the one to register with Firebase for a release.
 */
val keyProperties = Properties()
val keyPropertiesFile = rootProject.file("key.properties")
if (keyPropertiesFile.exists()) {
    keyPropertiesFile.inputStream().use { keyProperties.load(it) }
}

/*
 * `local.properties` — gitignored, and where the SDK path already lives, so it is the one file a
 * fresh checkout is expected to have its own copy of.
 */
val localProperties = Properties()
val localPropertiesFile = rootProject.file("local.properties")
if (localPropertiesFile.exists()) {
    localPropertiesFile.inputStream().use { localProperties.load(it) }
}

android {
    namespace = "com.buildr.buildr_mobile"
    /*
     * Pinned rather than following the Flutter tool.
     *
     * The tool asks for API 37, and the SDK manager installs that one as `android-37.0` — a
     * directory name Gradle then cannot match against the hash string `android-37`, so the build
     * fails on a platform that is demonstrably present. 36 is installed under the name Gradle
     * expects, and is the API level of the phones this ships to.
     */
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.buildr.buildr_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // Android 8. Spec §13: below this is a vanishing share of site phones, and Firebase
        // phone auth wants 23+ anyway.
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        /*
         * The Google Maps key, read from `local.properties` rather than committed.
         *
         * An Android Maps key travels inside the APK and cannot be hidden, so it is not a secret in
         * the sense a server key is — but it is a *spending* credential, and one left in the
         * repository is one anybody can bill. Restrict it in the Cloud console to this package name
         * and the signing certificate's SHA-1; that, not secrecy, is what stops somebody else using
         * it.
         *
         * Empty by default. A build without a key still compiles and runs; the map simply says it
         * is not configured, the way the tile layer used to.
         */
        manifestPlaceholders["mapsApiKey"] =
            (localProperties.getProperty("MAPS_API_KEY") ?: "")
    }

    signingConfigs {
        create("release") {
            if (keyPropertiesFile.exists()) {
                keyAlias = keyProperties["keyAlias"] as String
                keyPassword = keyProperties["keyPassword"] as String
                storeFile = file(keyProperties["storeFile"] as String)
                storePassword = keyProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (keyPropertiesFile.exists()) {
                signingConfigs.getByName("release")
            } else {
                // So `flutter build apk --release` still produces something runnable on a bench.
                signingConfigs.getByName("debug")
            }
        }
    }
}

flutter {
    source = "../.."
}
