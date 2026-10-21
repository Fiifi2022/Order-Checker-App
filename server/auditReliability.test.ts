import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { AuditTiming, AUDIT_HARD_TIMEOUT_MS, AUDIT_DELAY_MESSAGE } from '../shared/auditPerformance';
import { createAuditBudget, auditReadBudget, auditSignal, optionalAuditAi } from './auditBudget';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { interpretGeneralOrder } from './generalOrderInterpretation';
import { servedFacilityRecords } from './generalFacilityRecords';
import { compareGeneralFacilities } from '../src/utils/generalFacility';

const tick = () => new Promise(resolve => setImmediate(resolve));
const headers = 'Facility: Reliability HC\nOrderer: Test Operator\n';
function browser() {
  const source = readFileSync(new URL('../src/utils/authFetch.ts', import.meta.url), 'utf8').replace("import { auth } from '../firebase';", 'const auth = globalThis.mockAuth;');
  const code = buildSync({ stdin: { contents: source, resolveDir: fileURLToPath(new URL('../src/utils', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'browser', format: 'cjs', write: false, define: { 'import.meta.env': '{}' } }).outputFiles[0].text;
  const module = { exports: {} as any }, timers: { at: number; controller: AbortController }[] = [];
  let fetchedSignal: AbortSignal | undefined, resolveFetch!: (response: Response) => void, calls = 0;
  const context = { module, exports: module.exports, Headers, Request, URL, DOMException, Event,
    window: { location: { origin: 'https://example.test' }, dispatchEvent() {} },
    mockAuth: { authStateReady: async () => {}, currentUser: { getIdToken: async () => 'synthetic-token' } },
    AbortSignal: { any: AbortSignal.any.bind(AbortSignal), timeout: (at: number) => { const controller = new AbortController(); timers.push({ at, controller }); return controller.signal; } },
    fetch: async (_input: any, options: any) => { calls++; fetchedSignal = options.signal; return new Promise<Response>(resolve => { resolveFetch = resolve; }); }
  };
  vm.runInNewContext(code, context);
  return { fetch: module.exports.authFetch as typeof import('../src/utils/authFetch').authFetch, timers,
    advance(ms: number) { timers.filter(timer => timer.at <= ms).forEach(timer => timer.controller.abort(new DOMException('Timed out', 'TimeoutError'))); },
    complete() { resolveFetch(Response.json({ allMatch: true })); }, get signal() { return fetchedSignal; }, get calls() { return calls; } };
}

test('the actual browser request survives three seconds and accepts later results', async () => {
  const app = browser();
  const request = app.fetch('/api/verify', { method: 'POST' }); await tick();
  assert.equal(app.timers[0].at, AUDIT_HARD_TIMEOUT_MS);
  app.advance(3001); await tick();
  assert.equal(app.signal?.aborted, false);
  assert.equal(app.calls, 1);
  app.complete(); assert.equal((await request).ok, true);
  assert.match(AUDIT_DELAY_MESSAGE, /Please wait/);
});

test('the browser hard timeout rejects, while caller cancellation cannot return stale findings', async () => {
  const app = browser();
  const request = app.fetch('/api/verify', { method: 'POST' }); await tick();
  const rejected = assert.rejects(request, /could not be completed/);
  app.advance(AUDIT_HARD_TIMEOUT_MS); await rejected;
  assert.equal(app.signal?.aborted, true);
  app.complete(); await tick();
  const next = browser(), controller = new AbortController();
  const cancelled = next.fetch('/api/verify', { method: 'POST', signal: controller.signal }); await tick();
  const rejection = assert.rejects(cancelled, (error: any) => error.name === 'AbortError');
  controller.abort(); await rejection; next.complete();
});

test('server waits beyond its soft target and cleans up the deadline after responding', async () => {
  const req = Object.assign(new EventEmitter(), { method: 'POST', path: '/verify' });
  const res = Object.assign(new EventEmitter(), { writableFinished: false, statusCode: 200 });
  createAuditBudget(4500)(req as any, res as any, () => {});
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    const result = await auditReadBudget(req, () => new Promise(resolve => setTimeout(() => resolve('completed'), 3050)));
    assert.equal(result, 'completed'); assert.equal(auditSignal(req)?.aborted, false);
    res.writableFinished = true; res.emit('finish');
    assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
  } finally { clearTimeout(keepAlive); res.emit('finish'); }
});

test('disconnect cancels optional Gemini work and prevents subsequent reads', async () => {
  const req = Object.assign(new EventEmitter(), { method: 'POST', path: '/verify' });
  const res = Object.assign(new EventEmitter(), { writableFinished: false });
  createAuditBudget(5000)(req as any, res as any, () => {});
  let sdkSignal: AbortSignal | undefined;
  const pending = optionalAuditAi(async signal => { sdkSignal = signal; return new Promise(() => {}); }, 4000, auditSignal(req));
  const rejection = assert.rejects(pending, (error: any) => error.name === 'AbortError');
  res.emit('close'); await rejection; assert.equal(sdkSignal?.aborted, true);
  let called = false;
  await assert.rejects(auditReadBudget(req, async () => { called = true; })); assert.equal(called, false);
});

test('unreadable natural-language orders return manual review on AI outage, never success', async () => {
  const result = await runGeneralSemanticAudit(headers + 'Please send something suitable.', headers + 'PCM [5/5]', {}, {}, () => { throw new Error('offline'); });
  assert.equal(result.allMatch, false);
  assert.ok(result.generalAudit.semanticReviews?.length);
  assert.equal(result.issueCount, 0);
  assert.equal(result.items.some(item => item.status === 'extra item'), false);
  assert.equal(result.fulfilledOrder.products[0]?.quantity, 5);
  assert.match(result.fulfilledOrder.products[0]?.name || '', /PCM|Paracetamol/i);
});

test('timings expose only numeric aggregates, including extraction and final validation', async () => {
  const timing = new AuditTiming(true);
  await runGeneralSemanticAudit(headers + 'PCM - 5', headers + 'PCM [5/5]', {}, { timing, facilityContext: { records: [...servedFacilityRecords] } }, () => { throw new Error('unnecessary'); });
  const report = timing.snapshot();
  for (const stage of ['facilityIdentification', 'ordererIdentification', 'productExtraction', 'productNormalization', 'quantityVerification', 'finalValidation', 'deterministic']) assert.ok(stage in report.stagesMs, stage);
  assert.doesNotMatch(JSON.stringify(report), /Test Operator|Reliability|PCM|token/i);
  assert.equal(report.counts.productExtraction, 2, 'customer and fulfilment are extracted once on the fast path');
  assert.deepEqual(new AuditTiming().snapshot().stagesMs, {});
});

test('reference normalization cache observes edits without caching order outcomes', () => {
  const records = [{ id: 'one', name: 'Example HC', source: 'synthetic', verifiedAliases: ['Alternate HC'] }];
  const compare = () => compareGeneralFacilities('Example HC', 'Alternate HC', '', '', { records });
  assert.equal(compare().status, 'match');
  records[0].verifiedAliases = [];
  assert.equal(compare().status, 'mismatch');
});

test('Gemini evidence caches are isolated by authenticated account', async () => {
  const a = headers + 'Please send 5 PCM 500mg tablets today.';
  const b = headers + 'We have packed 5 Paracetamol 500mg tablets today.';
  let calls = 0;
  const pair = () => ({ customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 });
  const client = () => ({ models: { async generateContent() { calls++; return { text: JSON.stringify({ facility: pair(), orderer: pair(), customerProducts: [], fulfilmentProducts: [], possibleMissingProducts: [], possibleExtraProducts: [], semanticWarnings: [] }) }; } } });
  await interpretGeneralOrder(a, b, client, 500, { cacheScope: 'account-one' });
  await interpretGeneralOrder(a, b, client, 500, { cacheScope: 'account-one' });
  assert.equal(calls, 1);
  await interpretGeneralOrder(a, b, client, 500, { cacheScope: 'account-two' });
  assert.equal(calls, 2);
});
