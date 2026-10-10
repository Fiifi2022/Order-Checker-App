import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBackendUrl, fetchJson } from './backend.js';
import { signIn, getToken, backendRequest } from './auth.js';

test('accepts Render domains and local development; rejects insecure or path URLs', () => {
  assert.equal(normalizeBackendUrl('  ordercheck.onrender.com/  '), 'https://ordercheck.onrender.com');
  assert.equal(normalizeBackendUrl('http://localhost:3000/'), 'http://localhost:3000');
  for (const url of ['', 'http://ordercheck.onrender.com', 'https://user:secret@example.com', 'https://example.com/api', 'https://example.com?token=secret', 'https://example.com/#settings']) {
    assert.throws(() => normalizeBackendUrl(url));
  }
});

test('sign-in, token refresh and authenticated audits; revoked sessions clear without retry', async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  let session = {};
  globalThis.chrome = { storage: { session: {
    get: async () => session,
    set: async (value) => { session = value; },
    remove: async () => { session = {}; },
  } } };
  const calls = [];
  let auditStatus = 200;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('signInWithPassword')) return Response.json({ idToken: 'initial', refreshToken: 'refresh', expiresIn: '3600', email: 'agent@example.com' });
    if (url.includes('securetoken')) return Response.json({ id_token: 'renewed', refresh_token: 'new-refresh', expires_in: '3600' });
    return Response.json(auditStatus === 200 ? { allMatch: true, items: [] } : { error: 'Session revoked.' }, { status: auditStatus });
  };
  try {
    await assert.rejects(getToken(), /Sign in/);
    await signIn('agent@example.com', 'private-password');
    assert.equal(await getToken(), 'initial');
    assert.ok(!JSON.stringify(session).includes('private-password'));
    session.authSession.expiresAt = 0;
    assert.equal(await getToken(), 'renewed');
    assert.equal(session.authSession.refreshToken, 'new-refresh');
    await backendRequest('https://ordercheck.onrender.com', '/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer renewed');
    assert.equal(calls.at(-1).options.headers['Content-Type'], 'application/json');
    auditStatus = 401;
    const count = calls.length;
    await assert.rejects(backendRequest('https://ordercheck.onrender.com', '/api/verify', { method: 'POST' }), /Session revoked/);
    assert.equal(calls.length, count + 1);
    assert.deepEqual(session, {});
  } finally { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; }
});

test('reports HTML responses and times out a stalled service', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>Render starting</html>');
    await assert.rejects(fetchJson('https://example.com'), /non-JSON/);
    globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    await assert.rejects(fetchJson('https://example.com', {}, 10), /took too long/);
  } finally { globalThis.fetch = originalFetch; }
});
