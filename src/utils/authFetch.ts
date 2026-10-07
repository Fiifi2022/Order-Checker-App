import { auth } from '../firebase';

export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
    await auth.authStateReady();
    if (auth.currentUser) headers.set('Authorization', `Bearer ${await auth.currentUser.getIdToken()}`);
  }
  const response = await fetch(input, { ...init, headers });
  if (url.origin === window.location.origin && url.pathname.startsWith('/api/') && response.status === 401) {
    window.dispatchEvent(new Event('ordercheck-session-expired'));
  }
  return response;
}
