// Deterministic local measurements; no Firebase or Gemini requests.
import { runGeneralSemanticAudit } from '../server/generalSemanticAudit';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const h = 'Name of Orderer: Kwame Mensah\nName of Health Facility: Example Health Centre\n';
const p = 'Multivitamin Syrup — 5\nParacetamol 120mg/5mL Syrup, 100mL — 5';
const delivery = 'Expected delivery: between June 26, 2026 10:38 AM and June 26, 2026 12:38 PM.';
const contact = 'Let us know if any changes are required or contact 0800719102 if any questions.';
// Captured from actual pre-change local runs, before applying this fix. These
// values are historical observations, not re-measured by this script.
const before = [
  { name: 'split_footer', allMatch: false, confidence: 75, issueCount: 0, reviews: 2, aiCalls: 1 },
  { name: 'combined_footer', allMatch: false, confidence: 86, issueCount: 0, reviews: 1, aiCalls: 1 },
  { name: 'service_phone', allMatch: false, confidence: 67, issueCount: 3, reviews: 1, aiCalls: 1 }
];
const after: any[] = [];
for (const [name, a, b] of [['split_footer', h+p, h+p+'\n'+delivery+'\n'+contact], ['combined_footer', h+p, h+p+'\n'+delivery+' '+contact], ['service_phone', h+'Phone: 0241234567\n'+p, h+p+'\nCustomer service: 0800719102']]) {
  let calls = 0;
  const start = performance.now();
  const result = await runGeneralSemanticAudit(a, b, {}, {}, () => { calls++; throw Error('AI unavailable'); });
  assert.equal(result.allMatch, true); assert.equal(result.confidence, 100); assert.equal(result.issueCount, 0); assert.equal(calls, 0);
  after.push({ name, allMatch: result.allMatch, confidence: result.confidence, issueCount: result.issueCount, reviews: result.generalAudit.semanticReviews?.length || 0, aiCalls: calls,
    ignoredTextInOutput: 'administrativeInformation' in result.generalAudit, elapsedMs: performance.now() - start, phone: result.generalAudit.phone });
}
const times = [];
for (let i = 0; i < 20; i++) { const start = performance.now(); const r = await runGeneralSemanticAudit(h+p, h+p+'\n'+delivery+'\n'+contact, {}, {}, () => { throw Error('Must not request AI'); }); assert.equal(r.allMatch, true); times.push(performance.now() - start); }
times.sort((a,b) => a-b);
const report = { scope: 'Actual local General Auditor runs with AI unavailable; not deployed end-to-end performance', beforeCaptured: '2026-10-20, before edits', before, after,
  deterministicTiming: { samples: times.length, meanMs: times.reduce((a,b)=>a+b,0)/times.length, medianMs: (times[9]+times[10])/2, p95Ms: times[18] } };
writeFileSync('docs/validation/administrative-text-results.json', JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify(report));
