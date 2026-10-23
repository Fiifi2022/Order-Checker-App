import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareGeneralOrdererNames, matchGeneralOrdererNames } from '../src/utils/generalOrdererName';
import { runGeneralAuditor, enforceGeneralIdentityMatches, applyGeneralOrderLimitDecision } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import GeneralAuditDetails from '../src/components/GeneralAuditDetails';

const examples = [
  ['Ekobor Samuel Jnr', 'Samuel Ekobor Jnr', 'match'],
  ['John Kwame Mensah', 'Mensah John Kwame', 'match'],
  ['Mohammed Abdul Rahman', 'Rahman Mohammed Abdul', 'match'],
  ['Akosua Serwaa', 'Serwaa Akosua', 'match'],
  ['Samuel Ekobor Junior', 'Ekobor Samuel Jnr', 'match'],
  ['John Kwame Mensah', 'John Kwame Boateng', 'mismatch'],
  ['Samuel Ekobor Jnr', 'Samuel Ekobor Snr', 'mismatch'],
  ['Emmanuel Kofi Boateng', 'Kofi Emmanuel Boateng', 'match'],
] as const;
const request = (name: string) => `Facility: Alpha HC\nName of Orderer: ${name}\nParacetamol - 10`;
const confirmation = (name: string) => `Facility: Alpha HC\nName of Orderer: ${name}\nParacetamol [10/10]`;
for (const [left, right, status] of examples) {
  test(`${left} / ${right}: ${status} without Gemini`, async () => {
    assert.equal(matchGeneralOrdererNames(left, right).status, status);
    assert.equal(matchGeneralOrdererNames(right, left).status, status);
    let aiCalls = 0;
    const result = await runGeneralSemanticAudit(request(left), confirmation(right), {}, {}, () => { aiCalls++; throw new Error('Clear name comparisons must not initialize Gemini'); });
    assert.equal(aiCalls, 0);
    assert.equal(result.generalAudit.orderer.status, status);
    assert.equal(result.issueCount, status === 'mismatch' ? 1 : 0);
    assert.equal(result.allMatch, status === 'match');
  });
}

for (const [left, right] of [
  [' Mr.  EKOBOR, Samuel Jnr. ', 'samuel ekobor junior'],
  ['Samuel Ekobor Senior', 'Ekobor Samuel Sr'],
  ['Sam Ekobor', 'Ekobor Samuel'],
  ['Emman Kofi Boateng', 'Boateng Emmanuel Kofi'],
  ['John K. Mensah', 'Mensah John Kwame'],
  ['Mary Abena Mensah', 'Nurse Mary Mensah'],
  ['Mary Abena Mensah', 'Mensah Mary'],
  ['John Kwame Kofi Mensah', 'Kwame Mensah John'],
  ['Mary Abena Mensah Jnr', 'Mensah Mary Junior'],
  ['Samuel Ekobor', 'Ekobor Samule'],
  ['Samuel Ekobor', 'Ekobor Samue1'],
  ["Mary O’Neill", "O'Neill Mary"],
  ['Akosua Serwaa', 'Serwaa Akósua'],
]) test(`normalized, middle-name or fuzzy variation: ${left} / ${right}`, () => {
  assert.equal(matchGeneralOrdererNames(left, right).status, 'match');
});

for (const [left, right, status] of [
  ['John Kwame Mensah Junior', 'Mensah John Kwame Senior', 'mismatch'],
  ['John Kwame Mensah Kojo', 'Mensah John Kwame Boateng', 'mismatch'],
  ['Mary Abena Mensah', 'Mary Akua Mensah', 'mismatch'],
  ['John Mensah', 'Jane Mensah', 'mismatch'],
  ['John Mensah', 'John Boateng', 'mismatch'],
  ['John Kwame Mensah', 'John Kwame', 'review required'],
  ['J Mensah', 'John Mensah', 'review required'],
  ['John K Mensah', 'John A Mensah', 'mismatch'],
  ['Samuel Ekobor Jnr', 'Samuel Ekobor', 'review required'],
  ['John Mensah Mensah', 'John John Mensah', 'review required'],
  ['Samuel', 'Samuel', 'review required'],
  ['N/A', 'N/A', 'review required'],
  ['', '', 'review required'],
] as const) test(`partial names and conflicts: ${left} / ${right}`, () => {
  assert.equal(matchGeneralOrdererNames(left, right).status, status);
});

test('uncertain names require review without adding a discrepancy or granting clearance', () => {
  const result = runGeneralAuditor(request('John Mensah'), confirmation('J Mensah'));
  assert.equal(result.generalAudit.orderer.status, 'review required');
  assert.equal(result.generalAudit.finalStatus, 'REVIEW REQUIRED');
  assert.equal(result.issueCount, 0);
  assert.match(result.generalAudit.message, /requires review/);
  assert.equal(result.allMatch, false);
  assert.equal(result.auditSummary.reviewRequiredCount, 1);
  assert.ok(result.confidence < 100);
  assert.equal(enforceGeneralIdentityMatches({ ...result, allMatch: true }, request('John Mensah'), confirmation('J Mensah')).allMatch, false);
  const html = renderToStaticMarkup(createElement(GeneralAuditDetails, { details: result.generalAudit }));
  assert.match(html, /REVIEW REQUIRED/);
  assert.match(html, /Reason:/);
});

test('match display retains both source names and explains reordered components', () => {
  const result = runGeneralAuditor(request(examples[0][0]), confirmation(examples[0][1]));
  const html = renderToStaticMarkup(createElement(GeneralAuditDetails, { details: result.generalAudit }));
  assert.match(html, /Customer Request: Ekobor Samuel Jnr/);
  assert.match(html, /Fulfilment Confirmation: Samuel Ekobor Jnr/);
  assert.match(html, /All three name components match regardless of arrangement/);
});

test('WhatsApp greetings and OCR-extracted text use the shared matching pipeline', () => {
  const result = runGeneralAuditor(request('Ekobor Samuel Jnr'), 'Thank you Samuel Ekobor Junior from Alpha HC.\nParacetamol [10/10]');
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.equal(result.allMatch, true);
  const ocr = runGeneralAuditor(request('Samuel Ekobor'), confirmation('Samue1 Ekobor'));
  assert.equal(ocr.generalAudit.orderer.nameMatchMethod, 'fuzzy');
});

test('order limits cannot waive a conflicting name or an uncertain name', () => {
  for (const name of ['John Boateng', 'J Mensah']) {
    const initial = runGeneralAuditor(request('John Mensah'), confirmation(name).replace('[10/10]', '[5/10]'));
    const result = applyGeneralOrderLimitDecision(initial, initial.items[0].fulfillment.key, true);
    assert.equal(result.allMatch, false);
    assert.notEqual(result.generalAudit.orderer.status, 'match');
  }
});

function client(response: object) {
  let calls = 0;
  return { get calls() { return calls; }, models: { async generateContent() { calls++; return { text: JSON.stringify(response) }; } } };
}
test('only ambiguous names call Gemini and low confidence never becomes a match', async () => {
  const ai = client({ decision: 'match', confidence: 0.8, reason: 'Possible abbreviation.' });
  const result = await runGeneralSemanticAudit(request('John Mensah'), confirmation('J Mensah'), {}, { semanticCacheScope: 'low-confidence' }, () => ai);
  assert.equal(ai.calls, 1);
  assert.equal(result.generalAudit.orderer.status, 'review required');
  assert.equal(result.allMatch, false);
});

test('Gemini cannot approve insufficient initials even when claiming high confidence', async () => {
  const ai = client({ decision: 'match', confidence: 1, reason: 'Same initial.' });
  const result = await runGeneralSemanticAudit(request('John Mensah'), confirmation('J Mensah'), {}, { semanticCacheScope: 'initials' }, () => ai);
  assert.equal(ai.calls, 1);
  assert.equal(result.generalAudit.orderer.status, 'review required');
});

test('high-confidence Gemini can resolve multiple small spelling differences with grounded component coverage', async () => {
  const a = 'John Kwame Mensah', b = 'John Kwami Mensha';
  assert.equal(matchGeneralOrdererNames(a, b).status, 'review required');
  const ai = client({ decision: 'match', confidence: 0.99, reason: 'The two differing components have minor transcription errors; all components align.' });
  const result = await runGeneralSemanticAudit(request(a), confirmation(b), {}, { semanticCacheScope: 'multi-typo' }, () => ai);
  assert.equal(ai.calls, 1);
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.equal(result.generalAudit.orderer.nameMatchMethod, 'gemini');
  assert.equal(result.allMatch, true);
  assert.equal(enforceGeneralIdentityMatches(result, request(a), confirmation(b)).allMatch, true);
  assert.equal(enforceGeneralIdentityMatches(result, request(a), confirmation('John Kwame Boateng')).generalAudit.orderer.status, 'mismatch');
});

test('Gemini unavailable, exhausted quota, invalid output and timeout leave names under review', async () => {
  const failures = [
    async () => { throw new Error('No API key'); },
    async () => { throw Object.assign(new Error('Quota'), { status: 429 }); },
    async () => ({ text: 'invalid JSON' }),
    async () => ({ text: JSON.stringify({ decision: 'match', confidence: 2, reason: 'invalid score' }) }),
    async () => new Promise(() => {}),
  ];
  for (const [index, generateContent] of failures.entries()) {
    const result = await runGeneralSemanticAudit(request('John Mensah'), confirmation('J Mensah'), {}, { semanticCacheScope: `failure-${index}`, semanticTimeoutMs: 30 }, () => ({ models: { generateContent } }));
    assert.equal(result.generalAudit.orderer.status, 'review required');
    assert.equal(result.allMatch, false);
    assert.equal(result.issueCount, 0);
  }
});

test('name AI evidence cannot waive deterministic conflicts or be reused with different names', () => {
  const evidence = { customer: 'John Kwame Mensah', fulfillment: 'John Kwame Boateng', decision: 'match' as const, confidence: 1, reason: 'Trust me' };
  assert.equal(compareGeneralOrdererNames(evidence.customer, evidence.fulfillment, evidence).status, 'mismatch');
  assert.equal(compareGeneralOrdererNames('John Mensah', 'J Mensah', evidence).status, 'review required');
});

test('quota cooldown and repeated identical uncertain pairs avoid duplicate Gemini calls', async () => {
  let calls = 0;
  const ai = { models: { async generateContent() { calls++; throw Object.assign(new Error('quota'), { status: 429 }); } } };
  for (const name of ['J Mensah', 'Jo Mensah']) {
    const result = await runGeneralSemanticAudit(request('John Mensah'), confirmation(name), {}, { semanticCacheScope: 'quota-cooldown' }, () => ai);
    assert.equal(result.generalAudit.orderer.status, 'review required');
    assert.equal(result.allMatch, false);
  }
  assert.equal(calls, 1);
});
