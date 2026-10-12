import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuthentication } from './auth';
import { fsContextHandlers, fsReadBudget, startFsReadBudget } from './fsContext';
import { lookupFsAllocation } from './fsAllocation';
import { fsContextSheets, fsContextCases } from './fsContextFixtures';

test('formatting-qualified BCG returns ok and a numeric remaining balance; composite facility names resolve', () => {
  const a = lookupFsAllocation(fsContextSheets, fsContextCases.a);
  assert.equal(a.status, 'matched'); assert.equal(a.products[0].status, 'ok');
  assert.equal(a.products[0].balance, 6); assert.equal(typeof a.products[0].balance, 'number');
  assert.equal(lookupFsAllocation(fsContextSheets, fsContextCases.b).status, 'matched');
  const c = lookupFsAllocation(fsContextSheets, fsContextCases.c);
  assert.equal(c.products[0].status, 'untracked'); assert.equal(c.products[0].balance, null);
});

test('unit punctuation, spacing and case are tolerant without collapsing strengths or pack sizes', () => {
  const selection = { ...fsContextCases.a, products: [
    { name: 'AMOXICILLIN 125mg/5mL Suspension, 100mL', quantity: '2' },
    { name: 'Amoxicillin 250mg/5mL Suspension, 100mL', quantity: '1' },
    { name: 'Amoxicillin 125mg/5mL Suspension, 200mL', quantity: '1' },
  ] };
  const result = lookupFsAllocation(fsContextSheets, selection);
  assert.equal(result.products.length, 3);
  assert.deepEqual(result.products.map(product => product.name), selection.products.map(product => product.name));
  assert.deepEqual(result.products.map(product => product.status), ['ok', 'untracked', 'untracked']);
  assert.equal(result.products[0].balance, 5);
});

test('duplicate facility names use district then region; unresolved cycles remain ambiguous', () => {
  const east = fsContextSheets[0];
  const wrong = { ...east, id: 'wrong', region: 'Other Region' };
  assert.equal(lookupFsAllocation([east, wrong], fsContextCases.a).facility.id, 'fixture-east:tuni');
  const next = { ...east, id: 'next', month: 'November 2026' };
  const result = lookupFsAllocation([east, next], fsContextCases.a);
  assert.equal(result.status, 'ambiguous'); assert.equal(result.candidates.length, 2);
  assert.equal(lookupFsAllocation([{ ...east, active: false }], fsContextCases.a).status, 'not_found');
});

test('stored numeric balance is authoritative; invalid or ambiguous records never become fabricated zeroes', () => {
  const sheets = structuredClone(fsContextSheets);
  sheets[0].rows[0].vaccines['BCG Vaccine 0.05 mL'].allocation = 'not a number' as any;
  assert.equal(lookupFsAllocation(sheets, fsContextCases.a).products[0].balance, 6);
  sheets[0].rows[0].vaccines['BCG Vaccine 0.05 mL'].balance = 'bad';
  assert.throws(() => lookupFsAllocation(sheets, fsContextCases.a), /balance unavailable/);
  (sheets[0].rows[0].vaccines as any)['BCG Vaccine 0.05mL'] = { balance: 4 };
  assert.throws(() => lookupFsAllocation(sheets, fsContextCases.a), /Multiple allocation records/);
});

test('HTTP routes enforce auth as JSON, preserve order, log statuses and do not mutate source data', async () => {
  const app = express(), logs: any[] = [], before = JSON.stringify(fsContextSheets);
  let failRead = false;
  app.use('/api', startFsReadBudget);
  app.use('/api', createAuthentication(async token => {
    if (token !== 'fixture-valid' && token !== 'fixture-forbidden') throw new Error('Invalid token');
    return { uid: 'test', email: token + '@example.com', email_verified: true };
  }, async email => email.startsWith('fixture-forbidden') ? null : { id: 'test', name: 'Test CCA', email, role: 'cca', district: 'Test', createdAt: '' }, fsReadBudget));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/auth/me', (_req, res) => res.json(res.locals.authUser));
  const handlers = fsContextHandlers({ readSheets: async () => { if (failRead) throw new Error('Blueprint read unavailable'); return fsContextSheets; }, readCatalog: async () => ({}), applyCatalog() {}, log: entry => logs.push(entry) });
  app.get('/api/vaccine/companion/context', handlers.context);
  app.get('/api/vaccine/companion/facilities', handlers.facilities);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.deepEqual(await (await fetch(base + '/api/health')).json(), { status: 'ok' });
    for (const token of ['', 'invalid', 'fixture-forbidden']) {
      const response = await fetch(base + '/api/vaccine/companion/context?selection=' + encodeURIComponent(JSON.stringify(fsContextCases.a)), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      assert.equal(response.status, token === 'fixture-forbidden' ? 403 : 401);
      assert.match(response.headers.get('content-type') || '', /application\/json/);
      assert.equal(typeof (await response.json() as any).error, 'string');
    }
    const headers = { Authorization: 'Bearer fixture-valid' };
    assert.equal((await fetch(base + '/api/auth/me', { headers })).status, 200);
    assert.equal((await fetch(base + '/api/vaccine/companion/facilities', { headers })).status, 200);
    for (const selection of Object.values(fsContextCases)) {
      const response = await fetch(base + '/api/vaccine/companion/context?selection=' + encodeURIComponent(JSON.stringify(selection)), { headers });
      assert.equal(response.status, 200);
      const result = await response.json() as any;
      assert.equal(result.products.length, selection.products.length);
    }
    assert.equal(logs.length, 3); assert.equal(logs[0].products[0].status, 'ok');
    const invalid = await fetch(base + '/api/vaccine/companion/context?selection=invalid-json', { headers });
    assert.equal(invalid.status, 400); assert.equal(typeof (await invalid.json() as any).error, 'string');
    assert.equal(logs.at(-1).status, 'invalid_selection');
    failRead = true;
    const unavailable = await fetch(base + '/api/vaccine/companion/context?selection=' + encodeURIComponent(JSON.stringify(fsContextCases.a)), { headers });
    assert.equal(unavailable.status, 503); assert.equal(typeof (await unavailable.json() as any).error, 'string');
    assert.equal(JSON.stringify(fsContextSheets), before);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('the combined authentication/read budget returns JSON 503 in under eight seconds', async () => {
  const req: any = { path: '/vaccine/companion/context', method: 'GET', headers: { authorization: 'Bearer fixture-valid' } };
  const started = Date.now();
  startFsReadBudget(req, {} as any, () => {});
  let status = 0, body: any;
  const auth = createAuthentication(() => new Promise(() => {}), async () => null, fsReadBudget);
  await auth(req, { status(code: number) { status = code; return this; }, json(value: any) { body = value; } } as any, () => assert.fail('Timed-out auth must not continue'));
  assert.equal(status, 503); assert.equal(typeof body.error, 'string');
  assert.ok(Date.now() - started < 8000);
});
