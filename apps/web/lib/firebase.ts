'use client';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

/**
 * Firebase web SDK — used to prove who somebody is: a phone number via OTP, a Google account, or
 * an email and password with an optional authenticator-app second step (TOTP, which needs the
 * project on Identity Platform). The ID token it returns is exchanged for a BUILDR JWT at
 * `POST /auth/exchange` and then never used again (spec §6.2).
 *
 * `getAuth` keeps its default persistence — local to this browser, surviving a reload — on
 * purpose: the account page turns two-factor on and off for whoever signed in with email here,
 * which it can only do while that Firebase sign-in is still around after the redirect.
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
 * Analytics is deliberately not initialised here. `getAnalytics` throws during SSR
 * and on unsupported browsers, and it has no part in authentication — wire it up in
 * a client-only effect behind `isSupported()` if it is ever wanted.
 */
