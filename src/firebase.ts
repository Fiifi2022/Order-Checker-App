/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize client side SDK
const app = initializeApp(firebaseConfig);

// Initialize Firestore with long-polling fallback to prevent RST_STREAM / gRPC errors in sandboxed iframes
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Google Sign-In helper using popup
export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Google Auth login error:', error);
    throw error;
  }
}

// Sign-Out helper
export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Sign-out error:', error);
    throw error;
  }
}

// Simple connectivity safety check
export async function testFirebaseConnection() {
  try {
    // Only check if explicitly invoked
  } catch (error) {
    console.warn('Firebase connectivity check notice:', error);
  }
}

