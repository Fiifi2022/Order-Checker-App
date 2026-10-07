import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import config from '../firebase-applet-config.json';

const adminApp = getApps().find(app => app.name === 'ordercheck-server') || initializeApp({
  credential: applicationDefault(), projectId: config.projectId,
}, 'ordercheck-server');
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp, config.firestoreDatabaseId);

// Keep the existing persistence call sites while using trusted server credentials.
export const collection = (db: any, name: string) => db.collection(name);
export const doc = (db: any, collectionName: string, id: string) => db.collection(collectionName).doc(id);
export const getDocs = (ref: any) => ref.get();
export const getDoc = async (ref: any) => {
  const snapshot = await ref.get();
  return { exists: () => snapshot.exists, data: () => snapshot.data(), id: snapshot.id };
};
export const setDoc = (ref: any, data: any, options?: any) => options ? ref.set(data, options) : ref.set(data);
export const deleteDoc = (ref: any) => ref.delete();
export const orderBy = (field: string, direction: 'asc' | 'desc' = 'asc') => (ref: any) => ref.orderBy(field, direction);
export const limit = (count: number) => (ref: any) => ref.limit(count);
export const query = (ref: any, ...constraints: any[]) => constraints.reduce((result, constraint) => constraint(result), ref);
export const writeBatch = (db: any) => db.batch();
export const runTransaction = (db: any, callback: any) => db.runTransaction((transaction: any) => callback({
  get: async (ref: any) => {
    const snapshot = await transaction.get(ref);
    return { exists: () => snapshot.exists, data: () => snapshot.data(), id: snapshot.id };
  },
  set: (ref: any, data: any, options?: any) => options ? transaction.set(ref, data, options) : transaction.set(ref, data),
  update: (ref: any, data: any) => transaction.update(ref, data),
  delete: (ref: any) => transaction.delete(ref),
}));
