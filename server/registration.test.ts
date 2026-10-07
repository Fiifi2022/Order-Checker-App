import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationFields, registrationHandlers } from './registration';

test('profile validation requires name, position, and Nest and ignores permissions', () => {
  assert.deepEqual(registrationFields({ name: ' Ada ', position: ' CCA ', nest: ' Ghana ', role: 'admin', uid: 'victim' }), { name: 'Ada', position: 'CCA', nest: 'Ghana' });
  for (const field of ['name', 'position', 'nest']) {
    for (const value of ['', '   ', null, {}, 'x'.repeat(101)]) {
      assert.throws(() => registrationFields({ name: 'Ada', position: 'CCA', nest: 'Ghana', [field]: value }));
    }
  }
});
test('registration saves only the authenticated identity and profile fields', async () => {
  let saved: any;
  const handlers = registrationHandlers({ get: async () => null, save: async (...args) => { saved = args; return {} as any; } });
  const req: any = { body: { uid: 'victim', email: 'victim@example.com', name: 'Ada', position: 'Administrator', nest: 'Nest 1', role: 'admin' } };
  const res: any = { locals: { identity: { uid: 'real-user', email: 'REAL@example.com' } }, json() {} };
  await handlers.save(req, res, () => {});
  assert.deepEqual(saved, ['real-user', { name: 'Ada', position: 'Administrator', nest: 'Nest 1' }, 'real@example.com']);
});
test('failed persistence does not report a successful registration', async () => {
  const handlers = registrationHandlers({ get: async () => { throw Error(); }, save: async () => { throw Error(); } });
  let status = 200;
  const res: any = { locals: { identity: { uid: 'own-user', email: 'own@example.com' } }, status(value: number) { status = value; return this; }, json() {} };
  await handlers.save({ body: { name: 'Ada', position: 'CCA', nest: 'Nest 1' } } as any, res, () => {});
  assert.equal(status, 503);
  await handlers.get({} as any, res, () => {});
  assert.equal(status, 503);
});
