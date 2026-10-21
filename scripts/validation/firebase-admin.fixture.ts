import { measureFirestoreRead } from '../../server/firestoreReads';
// Isolated, in-memory test provider. NEVER used by production builds. No keys,
// remote services, production documents or actual account tokens are accepted.
const rows = new Map<string, any>();
const profile = { id: 'validation-user', uid: 'validation-user', email: 'validation@example.invalid', name: 'Validation Operator', role: 'admin', roles: ['admin'], position: 'Test', nest: 'Local validation', district: 'Test', createdAt: '2026-10-19' };
rows.set('user_roles/validation-user', profile);
rows.set('user_profiles/validation-user', profile);
rows.set('vaccine_districts/validation-sheet', { id: 'validation-sheet', district: 'Asante Mampong', month: 'October 2026', nest: 'Local validation', products: ['BCG', 'OPV', 'IPV'], rows: [{ id: 'validation-row', facility: 'Asaam HC', vaccines: {
  BCG: { allocation: 20, balance: 20, distributed: 0 }, OPV: { allocation: 20, balance: 20, distributed: 0 }, IPV: { allocation: 20, balance: 20, distributed: 0 }
} }] });
const snapshot = (path: string) => ({ id: path.split('/').at(-1), ref: reference(path), exists: rows.has(path), data: () => rows.has(path) ? structuredClone(rows.get(path)) : undefined });
function reference(path: string): any { return { path, id: path.split('/').at(-1), get: async () => snapshot(path), set: async (data: any, options?: any) => { rows.set(path, options?.merge ? { ...(rows.get(path) || {}), ...structuredClone(data) } : structuredClone(data)); }, delete: async () => { rows.delete(path); } }; }
function collectionRef(name: string, filters: any[] = [], maximum = Infinity): any { return { name, path: name, doc: (id: string) => reference(`${name}/${id}`),
  where: (field: string, _operator: string, value: any) => collectionRef(name, [...filters, [field, value]], maximum), limit: (n: number) => collectionRef(name, filters, n), orderBy: () => collectionRef(name, filters, maximum),
  async get() { const docs = [...rows].filter(([key, value]) => key.startsWith(name + '/') && filters.every(([field, expected]) => value[field] === expected)).slice(0, maximum).map(([key]) => snapshot(key)); return { docs, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) }; } }; }
function batch(): any { const operations: (() => any)[] = []; return { set(ref: any, value: any, options?: any) { operations.push(() => ref.set(value, options)); return this; }, update(ref: any, value: any) { operations.push(() => ref.set(value, { merge: true })); return this; }, delete(ref: any) { operations.push(() => ref.delete()); return this; }, commit: async () => { for (const operation of operations) await operation(); } }; }
let queue = Promise.resolve();
export const adminDb = { collection: collectionRef, batch, async runTransaction(callback: any) { const previous = queue; let release!: () => void; queue = new Promise(resolve => { release = resolve; }); await previous; try {
  const staged = batch(); const result = await callback({ get: (ref: any) => ref.get(), set: staged.set, update: staged.update, delete: staged.delete }); await staged.commit(); return result;
} finally { release(); } } };
export const adminAuth = { async verifyIdToken(token: string) { if (!/^validation-token:\d+$/.test(token)) throw new Error('Invalid synthetic token'); const delay = Number(token.split(':')[1]); if (delay < 0 || delay > 5000) throw new Error('Invalid fixture delay'); if (delay) await new Promise(resolve => setTimeout(resolve, delay)); return { uid: profile.uid, email: profile.email, email_verified: true, firebase: { sign_in_provider: 'password' } }; } };
export const collection = (_db: any, name: string) => collectionRef(name);
export const doc = (_db: any, name: string, id: string) => reference(`${name}/${id}`);
export const getDocs = (ref: any) => measureFirestoreRead(ref.name, () => ref.get());
export const getDoc = async (ref: any) => { const value = await measureFirestoreRead(ref.path.split('/')[0], () => ref.get()); return { id: value.id, exists: () => value.exists, data: value.data }; };
export const setDoc = (ref: any, data: any, options?: any) => ref.set(data, options);
export const deleteDoc = (ref: any) => ref.delete();
export const orderBy = (field: string) => (ref: any) => ref.orderBy(field);
export const limit = (n: number) => (ref: any) => ref.limit(n);
export const query = (ref: any, ...constraints: any[]) => constraints.reduce((value, change) => change(value), ref);
export const writeBatch = () => batch();
export const runTransaction = (_db: any, callback: any) => adminDb.runTransaction((tx: any) => callback({ ...tx, get: async (ref: any) => { const value = await measureFirestoreRead(ref.path.split('/')[0], () => tx.get(ref)); return { exists: () => value.exists, data: value.data, id: value.id }; } }));

export const runAdminTransaction = (callback: any) => adminDb.runTransaction((tx: any) => callback({ ...tx, get: (ref: any) => measureFirestoreRead(ref.path.split('/')[0], () => tx.get(ref)) }));
