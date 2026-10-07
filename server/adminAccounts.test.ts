import test from 'node:test';
import assert from 'node:assert/strict';
import { accountSummary, adminAccountHandlers } from './adminAccounts';

function harness(role = 'admin', overrides: any = {}) {
  const calls: any[] = [];
  const user = { uid: 'target', email: 'target@example.com', providerData: [{ providerId: 'password' }] };
  const deps = {
    list: async (cursor: any) => { calls.push(['list', cursor]); return { accounts: [], nextCursor: 'next' }; },
    get: async () => user,
    updateProfile: async (...args: any[]) => { calls.push(['profile', ...args]); },
    updateAuth: async (...args: any[]) => { calls.push(['auth', ...args]); },
    revoke: async (...args: any[]) => { calls.push(['revoke', ...args]); },
    resetLink: async () => 'private-reset-link', verificationLink: async () => 'private-verification-link',
    audit: async (...args: any[]) => { calls.push(['audit', ...args]); }, ...overrides,
  };
  let status = 200, response: any;
  const res: any = { locals: { authUser: { id: 'admin', email: 'admin@example.com', role } }, setHeader() {}, status(value: number) { status = value; return this; }, json(value: any) { response = value; } };
  return { handlers: adminAccountHandlers(deps), calls, res, result: () => ({ status, response }) };
}
const req = (body: any = {}, query: any = {}) => ({ params: { uid: 'target' }, body, query } as any);

test('account summaries include profiles and access status but exclude credential data', () => {
  const result = accountSummary({ uid: 'target', email: 'user@example.com', passwordHash: 'secret', passwordSalt: 'secret', customClaims: { secret: true }, providerData: [{ providerId: 'password' }], metadata: { creationTime: 'created', lastSignInTime: 'signed-in' } }, { name: 'Ada', nest: 'Nest 1', position: 'CCA' }, { role: 'cca', district: 'North' });
  assert.equal(result.position, 'CCA'); assert.equal(result.role, 'cca');
  assert.equal(result.nest, 'Nest 1'); assert.equal(result.createdAt, 'created');
  assert.doesNotMatch(JSON.stringify(result), /secret|passwordHash|passwordSalt|customClaims/);
  assert.equal(accountSummary({ uid: 'incomplete' }, null, null).role, null);
});
test('all administrative handlers reject other roles including account reads', async () => {
  for (const role of ['cca', 'warehouse', 'auditor']) {
    for (const handler of ['list', 'profile', 'action'] as const) {
      const app = harness(role);
      await app.handlers[handler](req({ action: 'disable' }), app.res, () => {});
      assert.equal(app.result().status, 403); assert.equal(app.calls.length, 0);
    }
  }
});
test('account lists preserve pagination and validate page tokens', async () => {
  const app = harness();
  await app.handlers.list(req({}, { cursor: 'page' }), app.res, () => {});
  assert.equal(app.result().response.nextCursor, 'next'); assert.deepEqual(app.calls, [['list', 'page']]);
  await app.handlers.list(req({}, { cursor: ['bad'] }), app.res, () => {});
  assert.equal(app.result().status, 400);
});
test('profile edits strip privilege fields and record only the action', async () => {
  const app = harness();
  await app.handlers.profile(req({ name: ' Ada ', position: 'CCA', nest: 'Nest 1', role: 'admin', email: 'other@example.com', password: 'secret' }), app.res, () => {});
  assert.deepEqual(app.calls[0], ['profile', 'target', { name: 'Ada', position: 'CCA', nest: 'Nest 1' }]);
  assert.doesNotMatch(JSON.stringify(app.calls), /secret|other@example/);
  assert.equal(app.result().response.success, true);
});
test('password changes reject weak input, update credentials, and revoke sessions', async () => {
  const invalid = harness();
  await invalid.handlers.action(req({ action: 'password', password: 'short' }), invalid.res, () => {});
  assert.equal(invalid.result().status, 400); assert.equal(invalid.calls.length, 0);
  const app = harness();
  await app.handlers.action(req({ action: 'password', password: 'NewPassword123' }), app.res, () => {});
  assert.deepEqual(app.calls[0], ['auth', 'target', { password: 'NewPassword123' }]);
  assert.deepEqual(app.calls[1], ['revoke', 'target']);
  assert.doesNotMatch(JSON.stringify(app.calls.filter(call => call[0] === 'audit')), /NewPassword123/);
  assert.doesNotMatch(JSON.stringify(app.result().response), /NewPassword123/);
});
test('administrators cannot disable themselves or modify Google passwords', async () => {
  const self = harness('admin', { get: async () => ({ uid: 'admin', email: 'admin@example.com' }) });
  await self.handlers.action(req({ action: 'disable' }), self.res, () => {});
  assert.equal(self.result().status, 400); assert.equal(self.calls.length, 0);
  for (const action of ['password', 'reset_link']) {
    const google = harness('admin', { get: async () => ({ uid: 'target', providerData: [{ providerId: 'google.com' }] }) });
    await google.handlers.action(req({ action, password: 'NewPassword123' }), google.res, () => {});
    assert.equal(google.result().status, 400); assert.equal(google.calls.length, 0);
  }
});
test('recovery links are returned to the administrator but excluded from audit metadata', async () => {
  const app = harness();
  await app.handlers.action(req({ action: 'reset_link' }), app.res, () => {});
  assert.equal(app.result().response.link, 'private-reset-link');
  assert.doesNotMatch(JSON.stringify(app.calls), /private-reset-link/);
});
test('disable, enable, and session revocation use the fixed allowed operations', async () => {
  for (const action of ['disable', 'enable', 'revoke_sessions']) {
    const app = harness();
    await app.handlers.action(req({ action, customClaims: { admin: true } }), app.res, () => {});
    assert.deepEqual(app.calls[0], action === 'revoke_sessions' ? ['revoke', 'target'] : ['auth', 'target', { disabled: action === 'disable' }]);
  }
  const app = harness();
  await app.handlers.action(req({ action: 'delete' }), app.res, () => {});
  assert.equal(app.result().status, 400);
});
test('missing accounts and failed updates are reported without false success', async () => {
  const missing = harness('admin', { get: async () => { throw { code: 'auth/user-not-found' }; } });
  await missing.handlers.action(req({ action: 'disable' }), missing.res, () => {});
  assert.equal(missing.result().status, 404);
  const failed = harness('admin', { updateAuth: async () => { throw Error('private credential details'); } });
  await failed.handlers.action(req({ action: 'disable' }), failed.res, () => {});
  assert.equal(failed.result().status, 503);
  assert.equal(failed.calls.length, 0); assert.doesNotMatch(JSON.stringify(failed.result()), /private credential/);
});
