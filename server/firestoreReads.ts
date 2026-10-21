import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

// Process-local diagnostics count successful SDK results, not Firebase billing.
// No document IDs, emails, tokens, query values or document data are retained.
type Counts = { operations: number; returnedDocuments: number; minimumReadEstimate: number; failures: number };
const counts = new Map<string, Counts>();
const context = new AsyncLocalStorage<() => string>();
const startedAt = new Date().toISOString();
const collections = new Set(['audits', 'activity_logs', 'vaccine_transactions', 'vaccine_districts', 'user_profiles', 'user_roles', 'product_catalog', 'general_facility_directory', 'vaccine_verified_orders', 'vaccine_allocations', 'dhd_inventory', 'vaccine_dhd_inventory']);
const routes = ['/verify', '/auth/me', '/auth/registration', '/auth/register', '/roles', '/roles/current', '/products', '/products/hints', '/products/suggest-aliases', '/general/facilities', '/kpis', '/audits', '/analytics', '/general-auditor/history', '/general-auditor/diagnostics', '/vaccine/blueprint-districts', '/vaccine/allocations', '/vaccine/validate', '/vaccine/allocations/commit', '/vaccine/companion/context', '/vaccine/companion/facilities', '/vaccine/dashboard', '/activity/log', '/activity/logs', '/activity/usage', '/osu', '/admin/accounts', '/admin/firestore-reads', '/vaccine/transactions', '/vaccine/adjustments', '/vaccine/audit-logs', '/vaccine/dhd-inventory', '/vaccine/aliases', '/gemini-status', '/gemini-status/events', '/speedtest'];
function routeCategory(path: string) {
  if (routes.includes(path)) return path;
  if (/^\/vaccine\/blueprint-districts\/[^/]+\/current$/.test(path)) return '/vaccine/blueprint-districts/:id/current';
  return 'other_authenticated_route';
}
export const firestoreReadContext: RequestHandler = (req, _res, next) => {
  const route = typeof req.route?.path === 'string' ? req.route.path : routeCategory(req.path || '');
  context.run(() => route, next);
};
export async function readSnapshot<T>(reference: { path?: string; get: () => Promise<T> }, collectionName?: string): Promise<T> {
  return measureFirestoreRead(collectionName || reference.path?.split('/')[0] || 'query', () => reference.get());
}
export async function measureFirestoreRead<T>(collectionName: string, read: () => Promise<T>): Promise<T> {
  const route = context.getStore()?.() || 'startup_or_background';
  const key = `${route}|${collections.has(collectionName) ? collectionName : 'other'}`;
  // Route names come from Express route declarations, never caller URL values.
  const safeKey = counts.has(key) || counts.size < 200 ? key : 'other|other';
  const value = counts.get(safeKey) || { operations: 0, returnedDocuments: 0, minimumReadEstimate: 0, failures: 0 };
  counts.set(safeKey, value); value.operations++;
  try {
    const result: any = await read();
    const returned = Array.isArray(result?.docs) ? result.docs.length : result?.exists === true ? 1 : 0;
    value.returnedDocuments += returned;
    value.minimumReadEstimate += Math.max(1, returned);
    return result;
  } catch (error) { value.failures++; throw error; }
}
export function firestoreReadReport() {
  return { startedAt, scope: 'This server process since startup; not Firebase billing. Failed requests, index reads and SDK-internal retries may incur additional reads.', listeners: 0,
    operations: [...counts.entries()].map(([key, value]) => { const [route, collection] = key.split('|'); return { route, collection, ...value }; }).sort((a, b) => b.minimumReadEstimate - a.minimumReadEstimate) };
}

/** Shares only an in-flight read. The next completed request always revalidates
 * against Firestore. No TTL, stale fallback or cached permissions/balances. */
export function coalesceFreshRead<T>(read: () => Promise<T>): (() => Promise<T>) & { invalidate: () => void } {
  let pending: Promise<T> | undefined;
  const load = () => {
    if (!pending) {
      const current = Promise.resolve().then(read).finally(() => { if (pending === current) pending = undefined; });
      pending = current;
    }
    return pending;
  };
  load.invalidate = () => { pending = undefined; };
  return load;
}
