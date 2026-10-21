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
import { measureFirestoreRead } from './firestoreReads';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!projectId || !clientEmail || !privateKey) {
  throw new Error(
    'Missing Firebase Admin credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.'
  );
}
if (projectId !== config.firebaseConfig.projectId) {
  throw new Error('Firebase Admin project must match the portal Firebase project in firebase-applet-config.json.');
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
const queryCollections = new WeakMap<object, string>();
export const collection = (db: Firestore, name: string) => { const ref = db.collection(name); queryCollections.set(ref, name); return ref; };
export const doc = (db: Firestore, collectionName: string, id: string) => db.collection(collectionName).doc(id);
export const getDocs = (ref: Query<DocumentData>) => measureFirestoreRead(queryCollections.get(ref) || 'query', () => ref.get());
function clientSnapshot(snapshot: DocumentSnapshot<DocumentData>) {
  return { exists: () => snapshot.exists, data: () => snapshot.data(), id: snapshot.id };
}
export const getDoc = async (ref: DocumentReference<DocumentData>) => clientSnapshot(await measureFirestoreRead(ref.path.split('/')[0], () => ref.get()));
export const setDoc = (ref: DocumentReference<DocumentData>, data: DocumentData, options?: SetOptions) => options ? ref.set(data, options) : ref.set(data);
export const deleteDoc = (ref: DocumentReference<DocumentData>) => ref.delete();
type QueryConstraint = (ref: Query<DocumentData>) => Query<DocumentData>;
export const orderBy = (field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint => ref => ref.orderBy(field, direction);
export const limit = (count: number): QueryConstraint => ref => ref.limit(count);
export const query = (ref: Query<DocumentData>, ...constraints: QueryConstraint[]) => constraints.reduce((result, constraint) => { const next = constraint(result); queryCollections.set(next, queryCollections.get(ref) || 'query'); return next; }, ref);
export const writeBatch = (db: Firestore) => db.batch();
function clientTransaction(transaction: Transaction) {
  return {
    get: async (ref: DocumentReference<DocumentData>) => clientSnapshot(await measureFirestoreRead(ref.path.split('/')[0], () => transaction.get(ref))),
    set: (ref: DocumentReference<DocumentData>, data: DocumentData, options?: SetOptions) => options ? transaction.set(ref, data, options) : transaction.set(ref, data),
    update: (ref: DocumentReference<DocumentData>, data: DocumentData) => transaction.update(ref, data),
    delete: (ref: DocumentReference<DocumentData>) => transaction.delete(ref),
  };
}
export const runTransaction = <T>(db: Firestore, callback: (transaction: ReturnType<typeof clientTransaction>) => Promise<T>) => db.runTransaction(transaction => callback(clientTransaction(transaction)));

export const runAdminTransaction = <T>(callback: (transaction: Transaction) => Promise<T>) => adminDb.runTransaction(transaction => {
  const observed = { get: (ref: DocumentReference<DocumentData>) => measureFirestoreRead(ref.path.split('/')[0], () => transaction.get(ref)),
    set: transaction.set.bind(transaction), update: transaction.update.bind(transaction), delete: transaction.delete.bind(transaction) };
  return callback(observed as unknown as Transaction);
});
