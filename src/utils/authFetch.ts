import { AUDIT_HARD_TIMEOUT_MS, AUDIT_TIMEOUT_MESSAGE, auditTimeoutSetting, waitForAudit } from '../../shared/auditPerformance';
import { auth } from '../firebase';

export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
  const audit = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() === 'POST' && ['/api/verify', '/api/vaccine/validate'].includes(url.pathname);
  const originalSignal = init?.signal || (input instanceof Request ? input.signal : undefined);
  const signal = audit ? AbortSignal.any([...(originalSignal ? [originalSignal] : []), AbortSignal.timeout(auditTimeoutSetting(import.meta.env.VITE_AUDIT_HARD_TIMEOUT_MS, AUDIT_HARD_TIMEOUT_MS))]) : originalSignal;
  const wait = async <T,>(promise: Promise<T>): Promise<T> => {
    try { return await waitForAudit(promise, signal); }
    catch (error) {
      if (audit && signal?.reason?.name === 'TimeoutError') throw new Error(AUDIT_TIMEOUT_MESSAGE);
      throw error;
    }
  };
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
    await wait(auth.authStateReady());
    if (auth.currentUser) headers.set('Authorization', `Bearer ${await wait(auth.currentUser.getIdToken())}`);
  }
  const response = await wait(fetch(input, { ...init, headers, signal }));
  if (url.origin === window.location.origin && url.pathname.startsWith('/api/') && response.status === 401) {
    window.dispatchEvent(new Event('ordercheck-session-expired'));
  }
  return response;
}
