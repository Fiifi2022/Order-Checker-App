import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralAuditor, summarizeGeneralProducts, reconcileGeneralProductReviews } from './generalAuditor';
import { runGeneralSemanticAudit as audit } from './generalSemanticAudit';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';
import type { GeneralSemanticReview } from '../src/utils/generalAuditTypes';
import Details from '../src/components/GeneralAuditDetails';
import Summary from '../src/components/GeneralFulfillmentSummary';
import Confidence from '../src/components/GeneralVerificationConfidence';

const header = 'Facility: Bagurugu CHPS\nOrderer: Adam Fauzia\n';
const products = 'HPV Vaccine: 25\n0.5ml Syringe and Needle: 50';
const supplied = 'Human Papilloma Virus Vaccine [25/25]\nDisp Syringe & Needle, 0.5ml [50/50]';
const offline = () => { throw Error('AI should not be needed'); };
const review = (originalText: string, source: GeneralSemanticReview['source'] = 'customer_request'): GeneralSemanticReview => ({ kind: 'unparsed_text', originalText, source, possibleMatches: [], reason: 'Product: Confirm the requested product.' });
const render = (result: ReturnType<typeof runGeneralAuditor>) => renderToStaticMarkup(createElement('div', null,
  createElement(Details, { details: result.generalAudit }), createElement(Summary, { details: result.generalAudit }),
  createElement(Confidence, { summary: result.auditSummary, allMatch: result.allMatch })));

for (const prefix of [header, 'Bagurugu CHPS\nAdam Fauzia\n', '- Bagurugu CHPS\n- Adam Fauzia\n']) {
  test(`Bagurugu final verification is consistent for header ${JSON.stringify(prefix)}`, async () => {
    let calls = 0;
    const inputs = { whatsappMessage: prefix + products, fulfillmentConfirmation: prefix + supplied };
    const result = await audit(inputs.whatsappMessage, inputs.fulfillmentConfirmation, {}, {}, () => { calls++; return offline(); });
    assert.equal(calls, 0);
    assert.equal(result.allMatch, true);
    assert.equal(result.verdict, 'NO DISCREPANCY');
    assert.equal(result.status, 'resolved');
    assert.equal(result.generalAudit.finalStatus, 'NO DISCREPANCY');
    assert.equal(result.generalAudit.facility.status, 'match');
    assert.equal(result.generalAudit.orderer.status, 'match');
    assert.deepEqual(result.items.map(item => item.status), ['match', 'match']);
    assert.deepEqual(result.generalAudit.warnings, []);
    assert.deepEqual(result.extractedOrder.unresolvedFields, []);
    assert.deepEqual(result.auditSummary, { totalChecks: 6, passedChecks: 6, failedChecks: 0, discrepancyCount: 0, confidence: 100 });
    const final = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...result, ...inputs });
    assert.equal(final.allMatch, true);
    assert.equal(final.status, 'resolved');
    assert.match(render(final), /ALL MATCHED/);
    assert.match(render(final), /NO DISCREPANCY/);
    assert.doesNotMatch(render(final), /ORDER DETAILS REQUIRED|REVIEW REQUIRED|Product: Confirm/);
  });
}

test('six validated checks cannot retain a seventh stale product penalty', () => {
  const base = runGeneralAuditor(header + products, header + supplied);
  const stale = [review('HPV Vaccine: 25'), review('Disp Syringe & Needle, 0.5ml [50/50]', 'fulfillment_confirmation')];
  const result = summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 2, 2, stale);
  assert.equal(result.allMatch, true);
  assert.equal(result.status, 'resolved');
  assert.equal(result.generalAudit.finalStatus, 'NO DISCREPANCY');
  assert.deepEqual(result.generalAudit.warnings, []);
  assert.deepEqual(result.generalAudit.semanticReviews || [], []);
  assert.equal(result.auditSummary.totalChecks, 6);
  assert.equal(result.auditSummary.failedChecks, 0);
  assert.equal(result.confidence, 100);
});

test('client completion rebuilds old status, warnings and 86% confidence from final evidence', () => {
  const inputs = { whatsappMessage: header + products, fulfillmentConfirmation: header + supplied };
  const base = runGeneralAuditor(inputs.whatsappMessage, inputs.fulfillmentConfirmation);
  const oldSummary = { ...base.auditSummary, totalChecks: 7, failedChecks: 1, reviewRequiredCount: 1, confidence: 86 };
  const stale = { ...base, ...inputs, allMatch: false, status: 'pending', verdict: 'REVIEW REQUIRED', confidence: 86, auditEngine: 'general-deterministic-v1', auditSummary: oldSummary,
    generalAudit: { ...base.generalAudit, auditSummary: oldSummary, semanticReviews: [review('HPV Vaccine: 25')], warnings: ['Product: Confirm the requested product.'], finalStatus: 'ORDER DETAILS REQUIRED' } };
  const result = completeGeneralAuditRun(createGeneralAuditRun(inputs, 2, {}, {}, true), stale);
  assert.equal(result.allMatch, true);
  assert.equal(result.status, 'resolved');
  assert.equal(result.verdict, 'NO DISCREPANCY');
  assert.equal(result.confidence, 100);
  assert.deepEqual(result.generalAudit.warnings, []);
  assert.doesNotMatch(render(result), /86%|REVIEW REQUIRED|ORDER DETAILS REQUIRED|Product: Confirm/);
});

for (const text of ['Mystery preparation - 3', 'HPV Vaccine: unknown', 'HPV Vaccine: 25\nPlease include something else.', 'Change the quantity from 25 to 10.']) {
  test(`final matching rows cannot waive genuinely unresolved text: ${text}`, () => {
    const base = runGeneralAuditor(header + products, header + supplied);
    const result = summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 2, 2, [review(text)]);
    assert.equal(result.allMatch, false);
    assert.equal(result.status, 'pending');
    assert.ok(result.confidence < 100);
    assert.equal(result.canDispatchAutomatically, false);
    assert.ok(result.generalAudit.warnings?.length);
  });
}

test('a different source quantity or unit cannot clear an unresolved review', () => {
  const base = runGeneralAuditor(header + products, header + supplied);
  for (const entry of [review('HPV Vaccine: 26'), review('HPV Vaccine: 25 packs'), review('0.5ml Syringe and Needle [49/50]', 'fulfillment_confirmation')]) {
    assert.deepEqual(reconcileGeneralProductReviews(base.items, [entry]), [entry]);
  }
});

for (const [label, system] of [
  ['quantity', supplied.replace('[50/50]', '[60/60]')],
  ['missing product', 'Human Papilloma Virus Vaccine [25/25]'],
  ['additional product', supplied + '\nORS [2/2]'],
  ['different capacity', supplied.replace('0.5ml', '1ml')],
] as const) test(`genuine ${label} differences stay discrepancies after review cleanup`, async () => {
  const result = await audit(header + products, header + system, {}, {}, offline);
  assert.equal(result.allMatch, false);
  assert.equal(result.status, 'pending');
  assert.ok(result.issueCount > 0);
  assert.ok(result.auditSummary.failedChecks > 0);
  assert.equal(result.canDispatchAutomatically, false);
});

for (const [label, changed] of [['orderer', header.replace('Adam Fauzia', 'Mary Mensah')], ['facility', header.replace('Bagurugu', 'Cedar')]] as const) {
  test(`a different ${label} keeps the final audit unresolved`, async () => {
    const result = await audit(header + products, changed + supplied, {}, {}, offline);
    assert.equal(result.allMatch, false);
    assert.equal(result.issueCount, 1);
    assert.equal(result.status, 'pending');
  });
}

test('optional omissions and normalization do not change the final confidence checks', async () => {
  const result = await audit(header + products, header.replace('CHPS', 'Community-based Health Planning and Services') + supplied, {}, {}, offline);
  assert.equal(result.allMatch, true);
  assert.equal(result.auditSummary.totalChecks, 6);
  assert.equal(result.auditSummary.failedChecks, 0);
});

test('the confidence gauge uses verified status independently of its numeric score', () => {
  const base = runGeneralAuditor(header + products, header + supplied);
  const html = renderToStaticMarkup(createElement(Confidence, { allMatch: true, summary: { ...base.auditSummary, confidence: 86 } }));
  assert.match(html, /86%/);
  assert.match(html, /SYSTEM MATCH/);
  assert.doesNotMatch(html, /REVIEW REQUIRED/);
});

test('a new audit cannot inherit a prior run review or verified status', () => {
  const previous = { whatsappMessage: header + products, fulfillmentConfirmation: header + supplied };
  const old = runGeneralAuditor(previous.whatsappMessage, previous.fulfillmentConfirmation);
  const inputs = { ...previous, fulfillmentConfirmation: header + supplied.replace('[50/50]', '[60/60]') };
  const current = completeGeneralAuditRun(createGeneralAuditRun(inputs, 3, {}, {}, true), { ...old, ...previous, auditEngine: 'general-deterministic-v1' });
  assert.equal(current.allMatch, false);
  assert.equal(current.issueCount, 1);
  assert.equal(current.status, 'pending');
});


test('identical vague instructions cannot clear their own unresolved product review', () => {
  for (const name of ['Need Multivitamin Syrup for children', "Children's unlisted mixture"]) {
    const line = `${name} - 5 bottles`;
    const base = runGeneralAuditor(header + line, header + line);
    const result = summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 1, 1, [review(line)]);
    assert.equal(result.allMatch, false);
    assert.ok(result.generalAudit.warnings?.length);
  }
});
