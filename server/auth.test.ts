import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, canAccess, createAuthentication, type AuthProfile } from './auth';

const profile: AuthProfile = { id: 'cca', email: 'member@example.com', name: 'Member', role: 'cca', district: 'North', createdAt: '' };
const identity = { uid: 'own-user', email: 'MEMBER@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
async function request({ token = 'valid', claims = identity, account = profile, path = '/verify', method = 'POST', lookupError = false, invalidToken = false } = {}) {
  let status = 200, body: any, next = false, actor: any;
  const req: any = { path, method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: { actor: { role: 'admin' }, user: 'Impersonator', addedBy: 'Impersonator' } };
  const res: any = { locals: {}, status(code: number) { status = code; return this; }, json(data: any) { body = data; return this; } };
  const middleware = createAuthentication(async () => {
    if (invalidToken) throw new Error('invalid token');
    return claims;
  }, async email => {
    assert.equal(email, 'member@example.com');
    if (lookupError) throw new Error('database unavailable');
    return account;
  });
  await middleware(req, res, () => { next = true; actor = actorContext.getStore(); });
  return { status, body, next, actor, req, res };
}

test('missing, expired, forged, or revoked tokens are rejected', async () => {
  assert.equal((await request({ token: '' })).status, 401);
  assert.equal((await request({ invalidToken: true })).status, 401);
});
test('unverified and anonymous identities are rejected', async () => {
  assert.equal((await request({ claims: { ...identity, email_verified: false } })).status, 403);
  assert.equal((await request({ claims: { ...identity, firebase: { sign_in_provider: 'anonymous' } } })).status, 403);
});
test('unassigned accounts and unavailable role storage fail closed', async () => {
  assert.equal((await request({ account: null })).status, 403);
  assert.equal((await request({ lookupError: true })).status, 503);
});
test('authenticated requests use the stored account and overwrite spoofed actors', async () => {
  const result = await request();
  assert.equal(result.next, true);
  assert.deepEqual(result.actor, profile);
  assert.deepEqual(result.req.body.actor, profile);
  assert.equal(result.req.body.user, profile.name);
  assert.equal(result.req.body.addedBy, profile.name);
  assert.equal(actorContext.getStore(), undefined);
});
test('role removal and changes take effect on the next request', async () => {
  assert.equal((await request()).next, true);
  assert.equal((await request({ account: null })).next, false);
  assert.equal((await request({ account: { ...profile, role: 'auditor' }, path: '/vaccine/confirm' })).status, 403);
});
test('only the health GET is public', async () => {
  assert.equal((await request({ token: '', path: '/health', method: 'GET' })).next, true);
  assert.equal((await request({ token: '', path: '/health' })).status, 401);
  assert.equal((await request({ token: '', path: '/auth/me', method: 'GET' })).status, 401);
});
test('management permissions are enforced server-side', () => {
  for (const role of ['warehouse', 'cca', 'auditor', 'dco']) {
    assert.equal(canAccess(role, 'POST', '/roles'), false);
    assert.equal(canAccess(role, 'DELETE', '/roles/someone'), false);
    assert.equal(canAccess(role, 'POST', '/app/clear-all'), false);
    assert.equal(canAccess(role, 'POST', '/vaccine/blueprint-districts'), role !== 'cca');
  }
  assert.equal(canAccess('admin', 'POST', '/roles'), true);
  assert.equal(canAccess('admin', 'POST', '/roles/switch'), false);
  assert.equal(canAccess('cca', 'POST', '/vaccine/allocations/facility/topup'), false);
  assert.equal(canAccess('warehouse', 'POST', '/vaccine/adjust'), true);
  assert.equal(canAccess('auditor', 'POST', '/vaccine/confirm'), false);
  assert.equal(canAccess('auditor', 'POST', '/verify'), true);
  assert.equal(canAccess('cca', 'POST', '/vaccine/confirm'), true);
});

test('new accounts can complete their own profile without gaining operational access', async () => {
  const unverified = { ...identity, email_verified: false };
  const registration = await request({ claims: unverified, account: null, path: '/auth/register' });
  assert.equal(registration.next, true);
  assert.equal(registration.res.locals.identity.uid, 'own-user');
  assert.equal((await request({ claims: unverified, account: null, path: '/auth/registration', method: 'GET' })).next, true);
  assert.equal((await request({ claims: unverified, account: null })).status, 403);
  assert.equal((await request({ token: '', path: '/auth/register' })).status, 401);
  assert.equal((await request({ path: '/auth/register', claims: { ...identity, firebase: { sign_in_provider: 'anonymous' } } })).status, 403);
  assert.equal((await request({ path: '/auth/registration', method: 'POST', account: null })).status, 403);
});

test('administrative account APIs require an administrator for reads and writes', async () => {
  for (const method of ['GET', 'PATCH', 'POST', 'DELETE']) {
    assert.equal(canAccess('cca', method, '/admin/accounts'), false);
    assert.equal(canAccess('auditor', method, '/admin/accounts/user/actions'), false);
    assert.equal(canAccess('warehouse', method, '/admin/accounts'), false);
    assert.equal(canAccess('admin', method, '/admin/accounts'), true);
  }
  assert.equal((await request({ path: '/admin/accounts', method: 'GET' })).status, 403);
});


test('Warehouse and Compliance have complete blueprint access without account administration', () => {
  const routes: [string, string][] = [
    ['POST', '/vaccine/allocations/upload'], ['POST', '/vaccine/allocations/clear'],
    ['POST', '/vaccine/allocations/reset-demo'], ['POST', '/vaccine/allocations/facility/topup'],
    ['POST', '/vaccine/adjust'], ['POST', '/vaccine/aliases'], ['POST', '/vaccine/blueprint-months/add'],
    ['POST', '/vaccine/blueprint-districts/add'], ['POST', '/vaccine/blueprint-districts'],
    ['DELETE', '/vaccine/blueprint-districts/id'], ['PATCH', '/vaccine/blueprint-districts/id/rename'],
    ['POST', '/vaccine/blueprint-districts/sync'], ['POST', '/vaccine/blueprint-districts/clear'],
    ['POST', '/vaccine/blueprint-districts/id/topup'], ['POST', '/vaccine/blueprint-sheet'],
    ['POST', '/vaccine/blueprint-sheet/sync'], ['POST', '/vaccine/blueprint/start-facility'],
    ['POST', '/vaccine/blueprint/complete-facility'], ['PATCH', '/vaccine/facilities/id'],
    ['POST', '/vaccine/facilities/id/vaccines'],
  ];
  for (const role of ['warehouse', 'dco', 'auditor']) {
    for (const [method, path] of routes) assert.equal(canAccess(role, method, path), true, `${role}: ${path}`);
    for (const path of ['/roles', '/admin/accounts', '/app/clear-all', '/activity/logs/clear', '/vaccine/audit-logs/clear']) {
      assert.equal(canAccess(role, 'POST', path), false, `${role}: ${path}`);
    }
  }
  for (const [method, path] of routes) assert.equal(canAccess('cca', method, path), false, path);
});

test('multiple stored roles combine permissions and honor subsequent revocation', async () => {
  const account = { ...profile, role: 'auditor', roles: ['auditor', 'cca'] };
  assert.equal((await request({ account, path: '/vaccine/confirm' })).next, true);
  assert.equal((await request({ account, path: '/vaccine/blueprint-districts' })).next, true);
  assert.equal((await request({ account: { ...account, roles: ['auditor'] }, path: '/vaccine/confirm' })).status, 403);
  assert.equal((await request({ account: { ...account, role: 'admin', roles: ['cca'] }, path: '/roles' })).status, 403);
  assert.equal((await request({ account: { ...account, role: 'admin', roles: [] } })).status, 403);
  assert.equal((await request({ account: { ...account, roles: ['cca', 'admin'] }, path: '/admin/accounts', method: 'GET' })).next, true);
  assert.equal(canAccess(['warehouse', 'admin'], 'POST', '/roles/switch'), false);
});
