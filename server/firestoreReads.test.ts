import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceFreshRead, measureFirestoreRead, firestoreReadReport, firestoreReadContext } from './firestoreReads';
import { currentBlueprintHandler } from './currentBlueprint';
import { readFileSync } from 'node:fs';

test('in-flight catalogue reads are shared but every subsequent request revalidates', async () => {
  let calls = 0, revision = 1;
  const read = coalesceFreshRead(async () => { calls++; return { revision }; });
  const results = await Promise.all(Array.from({ length: 20 }, read));
  assert.equal(calls, 1); assert.ok(results.every(result => result.revision === 1));
  revision = 2;
  assert.equal((await read()).revision, 2); assert.equal(calls, 2);
  let fail = true;
  const retry = coalesceFreshRead(async () => { if (fail) throw Error('Unavailable'); return 3; });
  await assert.rejects(retry()); fail = false; assert.equal(await retry(), 3);
});

test('read diagnostics count successful results and failures without recording private values', async () => {
  const req: any = { route: { path: '/api/test-fixed-route' } };
  await new Promise<void>((resolve, reject) => firestoreReadContext(req, {} as any, () => {
    void (async () => {
      await measureFirestoreRead('user_roles', async () => ({ docs: [{ email: 'private@example.invalid', id: 'private-id' }] }));
      await measureFirestoreRead('user_roles', async () => ({ docs: [] }));
      await assert.rejects(measureFirestoreRead('user_roles', async () => { throw Error('secret-token'); }));
    })().then(resolve, reject);
  }));
  const report = firestoreReadReport();
  const row = report.operations.find(row => row.route === '/api/test-fixed-route' && row.collection === 'user_roles')!;
  assert.deepEqual(row, { route: '/api/test-fixed-route', collection: 'user_roles', operations: 3, returnedDocuments: 1, minimumReadEstimate: 2, failures: 1 });
  assert.doesNotMatch(JSON.stringify(report), /private@example|private-id|secret-token/);
});

async function current(read: (id: string) => Promise<any>, id = 'sheet-1') {
  let status = 200, body: any;
  const headers: any = {};
  await currentBlueprintHandler(read)({ params: { id } } as any, { setHeader(key: string, value: string) { headers[key] = value; }, status(code: number) { status = code; return this; }, json(value: any) { body = value; } } as any, () => {});
  return { status, body, headers };
}
test('visible sheet refresh reads only the requested document and never reuses an old balance', async () => {
  let remaining = 20; const reads: string[] = [];
  const read = async (id: string) => { reads.push(id); return { rows: [{ vaccines: { OPV: { balance: remaining } } }] }; };
  assert.equal((await current(read)).body.sheet.rows[0].vaccines.OPV.balance, 20);
  remaining = 17;
  const result = await current(read);
  assert.equal(result.body.sheet.rows[0].vaccines.OPV.balance, 17);
  assert.deepEqual(reads, ['sheet-1', 'sheet-1']);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal((await current(async () => null)).status, 404);
  assert.equal((await current(async () => { throw Error('quota'); })).status, 503);
  assert.equal((await current(read, 'invalid/path')).status, 400);
});

test('read reduction wiring keeps authorization fresh, input hints local and polling scoped with cleanup', () => {
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const authStart = server.indexOf("app.use('/api', createAuthentication(");
  const authCode = server.slice(authStart, server.indexOf('// One versioned catalog', authStart));
  assert.match(authCode, /user_roles/); assert.doesNotMatch(authCode, /coalesceFreshRead|user_profiles/);
  assert.doesNotMatch(server, /void ensureVaccineHistoryLoaded\(\)/);
  const frontend = readFileSync(new URL('../src/components/VaccineAllocationBlueprint.tsx', import.meta.url), 'utf8');
  const polling = frontend.slice(frontend.indexOf('const liveSheetRef'), frontend.indexOf('  useEffect(() => () =>', frontend.indexOf('const liveSheetRef')));
  assert.match(polling, /encodeURIComponent\(activeDistrictId\).*\/current/);
  assert.match(polling, /controller.abort\(\)/); assert.match(polling, /clearInterval/);
  assert.match(polling, /document.hidden/); assert.match(polling, /setLiveSheetWarning/);
  assert.match(polling, /current.hasUnsavedChanges/);
  const hints = readFileSync(new URL('../src/components/ProductReceivingHints.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(hints, /\}, \[text/);
});

test('committed reference edits invalidate in-flight readers without clearing a newer read', async () => {
  const releases: ((value: number) => void)[] = [];
  const read = coalesceFreshRead(() => new Promise<number>(resolve => releases.push(resolve)));
  const old = read(); await Promise.resolve(); read.invalidate();
  const fresh = read(); await Promise.resolve();
  releases[0](1); await old;
  assert.equal(read(), fresh, 'old completion must not evict a new pending read');
  releases[1](2); assert.equal(await fresh, 2);
});

test('raw read-only endpoints skip catalog reads but matching and writes always refresh vocabulary', async () => {
  const { needsProductCatalog } = await import('./catalogReadPolicy');
  for (const path of ['/vaccine/blueprint-districts/sheet/current', '/vaccine/dhd-inventory', '/vaccine/transactions', '/vaccine/audit-logs', '/vaccine/companion/context']) {
    assert.equal(needsProductCatalog('GET', path), false, path);
  }
  for (const [method, path] of [['POST', '/verify'], ['POST', '/vaccine/validate'], ['POST', '/vaccine/allocations/commit'], ['POST', '/vaccine/blueprint-districts'], ['GET', '/vaccine/aliases'], ['GET', '/vaccine/allocations']]) {
    assert.equal(needsProductCatalog(method, path), true, path);
  }
});
