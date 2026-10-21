import test from 'node:test';
import assert from 'node:assert/strict';
import { auditReadBudget, auditRemainingMs, isAuditRequest, optionalAuditAi, startAuditBudget, createAuditBudget } from './auditBudget';
import { AUDIT_TARGET_MS, AUDIT_SERVER_BUDGET_MS, AUDIT_AI_FALLBACK_MS } from '../shared/auditPerformance';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { servedFacilityRecords } from './generalFacilityRecords';
import { analyzeAuditLanguage } from './auditSemantics';

const headers = 'Facility: Asaam HC\nOrderer: Isaac Awuyem\n';
const never = () => new Promise<never>(() => {});

test('audit deadlines cover verification only and preserve confirmation transactions', async () => {
  assert.equal(AUDIT_TARGET_MS, 3000);
  assert.ok(AUDIT_SERVER_BUDGET_MS > AUDIT_TARGET_MS);
  assert.equal(AUDIT_AI_FALLBACK_MS, 4000);
  for (const path of ['/verify', '/vaccine/validate']) {
    assert.equal(isAuditRequest('POST', path), true);
    const req = { method: 'POST', path };
    startAuditBudget(req as any, {} as any, () => {});
    const initial = auditRemainingMs(req);
    await auditReadBudget(req, () => new Promise(resolve => setTimeout(resolve, 25)));
    assert.ok(auditRemainingMs(req) < initial - 10, 'later reads share the original deadline');
  }
  for (const path of ['/vaccine/confirm', '/vaccine/allocations/commit', '/products', '/scan-screenshot']) {
    assert.equal(isAuditRequest('POST', path), false);
  }
});

test('an unresponsive dependency is rejected within the shared server budget', async () => {
  const req = { method: 'POST', path: '/verify' };
  startAuditBudget(req as any, {} as any, () => {});
  const keepAlive = setTimeout(() => {}, 1000);
  createAuditBudget(30)(req as any, {} as any, () => {});
  const start = performance.now();
  await assert.rejects(auditReadBudget(req, never), (error: any) => error.code === 'AUDIT_TIMEOUT' && error.status === 503);
  assert.ok(performance.now() - start < 5000);
  let called = false;
  await assert.rejects(auditReadBudget(req, async () => { called = true; }));
  assert.equal(called, false);
  clearTimeout(keepAlive);
});

test('optional AI is aborted on time even when an SDK ignores its signal', async () => {
  let signal: AbortSignal | undefined;
  const started = performance.now();
  await assert.rejects(optionalAuditAi(async value => { signal = value; return never(); }, 20));
  assert.equal(signal?.aborted, true);
  assert.ok(performance.now() - started < 1000);
  let called = false;
  await assert.rejects(optionalAuditAi(async () => { called = true; }, 0));
  assert.equal(called, false);
});

test('known facility records and product rules complete without any AI calls', async t => {
  const started = performance.now();
  let calls = 0;
  const getClient = () => { calls++; throw new Error('Known data must not need AI'); };
  for (const [customer, fulfilment, matches] of [
    [headers + 'PCM - 5', headers + 'Paracetamol [5/5]', true],
    [headers + 'PCM - 5', headers.replace('Asaam HC', 'Another HC') + 'PCM [5/5]', false],
    [headers + 'PCM - 5', headers.replace('Isaac Awuyem', 'Mary Mensah') + 'PCM [5/5]', false],
    [headers + 'PCM - 5', headers + 'PCM [3/5]', false],
    [headers + 'PCM - 5', headers + 'PCM [0/5]', true],
    [headers + 'PCM - 5\nAmoxicillin - 2', headers + 'PCM [5/5]', false]
  ] as const) {
    const result = await runGeneralSemanticAudit(customer, fulfilment, {}, { facilityContext: { records: [...servedFacilityRecords] } }, getClient);
    assert.equal(result.semanticAnalysis.status, 'skipped');
    assert.equal(result.allMatch, matches, fulfilment);
  }
  assert.equal(calls, 0);
  const elapsed = performance.now() - started;
  t.diagnostic(`Six deterministic audits using all ${servedFacilityRecords.length} facility records: ${elapsed.toFixed(1)} ms total`);
  assert.ok(elapsed < AUDIT_TARGET_MS);
});

test('unresolved input gets one bounded AI fallback and retains explicit discrepancies', async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  const result = await runGeneralSemanticAudit(headers + 'Paracetmol - 5', headers + 'Paracetamol [5/5]', {}, { semanticTimeoutMs: 20 }, () => ({ models: {
    generateContent(options: any) { calls++; signal = options.config.abortSignal; return never(); }
  } }));
  assert.equal(calls, 1);
  assert.equal(signal?.aborted, true);
  assert.equal(result.semanticAnalysis.status, 'fallback');
  assert.equal(result.allMatch, false);
});

test('unresolved text cannot silently pass when the AI fallback times out', async () => {
  const raw = headers.replace('Asaam HC', 'Unresolved Timing HC') + 'PCM - 5\nAlso include something for the patient.';
  const result = await runGeneralSemanticAudit(raw, raw, {}, { semanticTimeoutMs: 20 }, () => ({ models: { generateContent: never } }));
  assert.equal(result.semanticAnalysis.status, 'fallback');
  assert.equal(result.allMatch, false);
  assert.match(result.generalAudit.semanticReviews?.[0].reason || '', /unresolved/);
});

test('vaccine aliases and explicit quantities also bypass AI', async () => {
  let calls = 0;
  const raw = 'Facility: Asaam HC\nBCG - 2\nBCG Diluent - 2';
  const result = await analyzeAuditLanguage(raw, raw, 'vaccine', () => { calls++; throw new Error('unnecessary'); });
  assert.equal(result.semanticAnalysis.status, 'skipped');
  assert.equal(calls, 0);
});
