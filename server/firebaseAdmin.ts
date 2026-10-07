import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  getFirestore,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type SetOptions,
  type Transaction
} from 'firebase-admin/firestore';

import config from '../firebase-applet-config.json';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!projectId || !clientEmail || !privateKey) {
  throw new Error(
    'Missing Firebase Admin credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.'
  );
}

const adminApp =
  getApps().find(app => app.name === 'ordercheck-server') ||
  initializeApp(
    {
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    },
    'ordercheck-server'
  );

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp, config.firestoreDatabaseId);

// Preserve the client-style call sites with typed, trusted server SDK operations.
export const collection = (db: Firestore, name: string) => db.collection(name);
export const doc = (db: Firestore, collectionName: string, id: string) => db.collection(collectionName).doc(id);
export const getDocs = (ref: Query<DocumentData>) => ref.get();
function clientSnapshot(snapshot: DocumentSnapshot<DocumentData>) {
  return { exists: () => snapshot.exists, data: () => snapshot.data(), id: snapshot.id };
}
export const getDoc = async (ref: DocumentReference<DocumentData>) => clientSnapshot(await ref.get());
export const setDoc = (ref: DocumentReference<DocumentData>, data: DocumentData, options?: SetOptions) => options ? ref.set(data, options) : ref.set(data);
export const deleteDoc = (ref: DocumentReference<DocumentData>) => ref.delete();
type QueryConstraint = (ref: Query<DocumentData>) => Query<DocumentData>;
export const orderBy = (field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint => ref => ref.orderBy(field, direction);
export const limit = (count: number): QueryConstraint => ref => ref.limit(count);
export const query = (ref: Query<DocumentData>, ...constraints: QueryConstraint[]) => constraints.reduce((result, constraint) => constraint(result), ref);
export const writeBatch = (db: Firestore) => db.batch();
function clientTransaction(transaction: Transaction) {
  return {
    get: async (ref: DocumentReference<DocumentData>) => clientSnapshot(await transaction.get(ref)),
    set: (ref: DocumentReference<DocumentData>, data: DocumentData, options?: SetOptions) => options ? transaction.set(ref, data, options) : transaction.set(ref, data),
    update: (ref: DocumentReference<DocumentData>, data: DocumentData) => transaction.update(ref, data),
    delete: (ref: DocumentReference<DocumentData>) => transaction.delete(ref),
  };
}
export const runTransaction = <T>(db: Firestore, callback: (transaction: ReturnType<typeof clientTransaction>) => Promise<T>) => db.runTransaction(transaction => callback(clientTransaction(transaction)));
