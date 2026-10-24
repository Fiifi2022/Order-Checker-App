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

test('companion uses all assigned roles and the current deterministic general audit contract', async () => {
  const { profileRoles, auditBody } = await import('./audit.js');
  const { webcrypto } = await import('node:crypto');
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
  try {
    assert.equal(profileRoles({ role: 'cca', roles: ['cca', 'auditor', 'warehouse'] }), 'CCA + Compliance + Warehouse');
    assert.equal(profileRoles({ role: 'cca', roles: ['auditor'] }), 'Compliance');
    assert.equal(profileRoles({ role: 'warehouse' }), 'Warehouse');
    const body = auditBody('Customer', 'Fulfillment', 12, { item: true });
    assert.equal(body.auditScope, 'general_auditor');
    assert.equal(body.productCatalogRevision, 12);
    assert.equal(body.checkSource, 'companion_extension');
    assert.deepEqual(body.generalOrderLimitDecisions, { item: true });
    const reopened = auditBody('Customer changed', 'Fulfillment', 12, {}, { id: 'saved-extension-audit', generalAudit: {} });
    assert.equal(reopened.checkId, 'saved-extension-audit');
    assert.equal(reopened.restoreProductConfirmations, true);
    assert.equal(body.restoreProductConfirmations, undefined);
  } finally {
    if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto);
    else delete globalThis.crypto;
  }
});

test('catalog drafts preserve canonical keys, optional details, explicit unlinking, and revision', async () => {
  const { catalogDraft, initialLinkedProductId } = await import('./catalog.js');
  const product = { id: 'g', name: 'Original', scope: 'general', aliases: ['O'], contextualAliases: [], note: '' };
  const values = { displayName: 'Renamed', scope: 'general', category: 'medicine', aliases: 'O\nOther\n', contextualAliases: 'O', fulfillmentSystemName: 'System Original', receivingDetails: 'Supply by box', linkedProductId: '', note: 'Note' };
  const draft = catalogDraft(product, values, 3);
  assert.equal(draft.name, 'Original'); assert.equal(draft.displayName, 'Renamed'); assert.equal(draft.revision, 3);
  assert.equal(draft.receivingDetails, values.receivingDetails); assert.equal(draft.linkedProductId, '');
  assert.deepEqual(draft.aliases, ['O', 'Other']);
  const counterpart = { ...product, id: 'v', scope: 'vaccine' };
  assert.equal(initialLinkedProductId(product, [product, counterpart]), 'v');
  assert.equal(initialLinkedProductId({ ...product, linkedProductId: '' }, [product, counterpart]), '');
  assert.equal(initialLinkedProductId(product, [product, counterpart, { ...counterpart, id: 'v2' }]), '');
});


test('the companion verification deadline includes a stalled token lookup', async () => {
  const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let fetches = 0;
  globalThis.chrome = { storage: { session: { get: () => new Promise(() => {}) } } };
  globalThis.fetch = async () => { fetches++; return Response.json({}); };
  globalThis.setTimeout = (callback, milliseconds) => {
    assert.equal(milliseconds, 20000);
    queueMicrotask(callback);
    return 1;
  };
  globalThis.clearTimeout = () => {};
  try {
    await assert.rejects(backendRequest('https://example.com', '/api/verify', { method: 'POST' }), /could not be completed/);
    assert.equal(fetches, 0);
  } finally {
    globalThis.chrome = originalChrome; globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear;
  }
});
