import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralAuditor, summarizeGeneralProducts } from './generalAuditor';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import type { GeneralSemanticReview } from '../src/utils/generalAuditTypes';
import Details from '../src/components/GeneralAuditDetails';
import Summary from '../src/components/GeneralFulfillmentSummary';
import Confidence from '../src/components/GeneralVerificationConfidence';
const customer = 'Facility: Bagurugu CHPS\nOrderer: Adam Fauzia\nHPV Vaccine: 25\n0.5ml Syringe and Needle: 50';
const system = 'Facility: Bagurugu CHPS\nOrderer: Adam Fauzia\nHuman Papilloma Virus Vaccine [25/25]\nDisp Syringe & Needle, 0.5ml [50/50]';
const markup = (result: ReturnType<typeof runGeneralAuditor>) => renderToStaticMarkup(createElement('div', null,
  createElement(Details, { details: result.generalAudit }), createElement(Summary, { details: result.generalAudit }),
  createElement(Confidence, { summary: result.auditSummary, allMatch: result.allMatch })));
const review = (field: GeneralSemanticReview['field'], originalText: string): GeneralSemanticReview => ({ field, kind: 'unparsed_text', originalText, source: 'customer_request', possibleMatches: [], reason: 'Previous extraction uncertainty' });

test('correct orders receive clearance after source-grounded identity and product reviews resolve', () => {
  const base = runGeneralAuditor(customer, system);
  const reviews = [review('ordererName', 'Orderer: Adam Fauzia'), review('facilityName', 'Facility: Bagurugu CHPS'), review('products', 'HPV Vaccine: 25')];
  const final = { ...base, ...summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 2, 2, reviews) };
  assert.equal(final.allMatch, true);
  assert.equal(final.status, 'resolved');
  assert.equal(final.verdict, 'NO DISCREPANCY');
  assert.deepEqual(final.generalAudit.warnings, []);
  assert.equal(final.auditSummary.failedChecks, 0);
  assert.match(markup(final), /MATCH — CLEARED/);
  assert.doesNotMatch(markup(final), /MANUAL REVIEW REQUIRED|Manual Review Required|CLARIFICATION REQUIRED/);
  assert.equal(final.canDispatchAutomatically, false, 'audit clearance alone cannot select an unresolved dispatch identity');
});

test('client completion grants clearance using current verified fields rather than stale identity reviews', () => {
  const base = runGeneralAuditor(customer, system);
  const inputs = { whatsappMessage: customer, fulfillmentConfirmation: system };
  const old = { ...base, ...inputs, auditEngine: 'general-deterministic-v1', allMatch: false,
    generalAudit: { ...base.generalAudit, semanticReviews: [review('ordererName', 'Orderer: Adam Fauzia')], finalStatus: 'MANUAL REVIEW REQUIRED' } };
  const final = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), old);
  assert.equal(final.allMatch, true);
  assert.equal(final.status, 'resolved');
  assert.match(markup(final), /MATCH — CLEARED/);
  assert.doesNotMatch(markup(final), /MANUAL REVIEW REQUIRED/);
});

for (const entry of [review('ordererName', 'Orderer: Different Person'), review('facilityName', 'Facility: Cedar HC'), review('ordererName', 'Change the orderer to Adam Fauzia.'), review('ordererName', 'Orderer: Adam Fauzia\nPlease add another item.')]) {
  test(`a genuinely unresolved instruction cannot be cleared: ${entry.originalText}`, () => {
    const base = runGeneralAuditor(customer, system);
    const final = { ...base, ...summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 2, 2, [entry]) };
    assert.equal(final.allMatch, false);
    assert.equal(final.status, 'pending');
    assert.ok(final.generalAudit.warnings?.length);
    assert.doesNotMatch(markup(final), /MATCH — CLEARED|MANUAL REVIEW REQUIRED|Manual Review Required/);
    assert.match(markup(final), /Confirm/);
  });
}

test('an actual quantity discrepancy still blocks clearance', () => {
  const result = runGeneralAuditor(customer, system.replace('[50/50]', '[60/60]'));
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 1);
  assert.doesNotMatch(markup(result), /MATCH — CLEARED/);
});

test('missing identity asks for the specific information without a generic manual-review label', async () => {
  const result = await runGeneralSemanticAudit(customer.replace('Orderer: Adam Fauzia\n', ''), system, {}, { semanticTimeoutMs: 0 }, () => { throw Error('offline'); });
  assert.equal(result.allMatch, false);
  assert.equal(result.status, 'pending');
  assert.match(markup(result), /Orderer: Confirm the name/);
  assert.doesNotMatch(markup(result), /MANUAL REVIEW REQUIRED|Manual Review Required|MATCH — CLEARED/);
});
