'use client';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

/**
 * Firebase web SDK — used for one thing only: proving the user controls a phone
 * number via OTP. The ID token it returns is exchanged for a BUILDR JWT at
 * `POST /auth/exchange` and then never used again (spec §6.2).
 *
 * These values are public client identifiers. The secret half of Firebase is the
 * Admin SDK service account, which lives on the API.
 */
const firebaseConfig = {
  apiKey: process.env['NEXT_PUBLIC_FIREBASE_API_KEY'],
  authDomain: process.env['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'],
  projectId: process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'],
  storageBucket: process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'],
  messagingSenderId: process.env['NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'],
  appId: process.env['NEXT_PUBLIC_FIREBASE_APP_ID'],
  measurementId: process.env['NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID'],
};

export function firebaseApp(): FirebaseApp {
  // Next's dev server re-evaluates modules on HMR, so guard against a double init.
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export function firebaseAuth(): Auth {
  const auth = getAuth(firebaseApp());
  // Deliver the OTP SMS in the device's language where Firebase supports it.
  auth.useDeviceLanguage();
  return auth;
}

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

/**
 * Whether to skip Firebase and post a `dev:<phone>` token straight to the API.
 *
 * Two conditions, both statically resolvable, so a production build compiles this to `false` and
 * drops the development branch entirely rather than shipping it behind an untaken `if`.
 *
 * The `NODE_ENV` half is the one that matters. `next build` always sets it to `production`, which
 * makes a deployed bundle immune to the flag no matter where the flag came from — and it came from
 * somewhere unexpected once already: an `apps/web/.env.local` that reached a Docker build context
 * and turned the real sign-in into dead code. The API would still have refused the token, but the
 * only symptom a user saw was "Could not verify the sign-in token", which describes the wrong half
 * of the problem.
 */
export const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env['NEXT_PUBLIC_DEV_AUTH_BYPASS'] === 'true';

/**
 * Analytics is deliberately not initialised here. `getAnalytics` throws during SSR
 * and on unsupported browsers, and it has no part in authentication — wire it up in
 * a client-only effect behind `isSupported()` if it is ever wanted.
 */
