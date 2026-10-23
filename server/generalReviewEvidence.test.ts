import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Details from '../src/components/GeneralAuditDetails';
import { generalEssentialReviewNotices, generalReviewEvidence } from '../src/utils/generalAuditReviews';
import { runGeneralAuditor, summarizeGeneralProducts } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';
import type { GeneralSemanticReview } from '../src/utils/generalAuditTypes';

const customer = 'Name: Ekobor Samuel Jnr\nFacility: Alpha HC\nParacetamol - 10';
const fulfillment = 'Customer Name: Samuel Ekobor Junior\nFacility: Alpha HC\nParacetamol [10/10]';
const review = (originalText: string, source: GeneralSemanticReview['source'] = 'customer_request'): GeneralSemanticReview => ({
  kind: 'unparsed_text', field: 'products', source, originalText, possibleMatches: [], reason: 'Product: Confirm the requested product.'
});

for (const label of ['Name', 'Customer Name', 'Orderer Name', 'Name of Orderer', 'Requested By', 'Requester', 'Sender', 'Recipient', 'Fulfilment Recipient', 'Customer', 'Authorized Contact']) {
  test(`resolved ${label} metadata cannot leave a generic product warning`, () => {
    const requested = `${label}: Ekobor Samuel Jnr\nFacility: Alpha HC\nParacetamol - 10`;
    const base = runGeneralAuditor(requested, fulfillment);
    assert.equal(base.generalAudit.orderer.status, 'match');
    const stale = [review(`${label}: Ekobor Samuel Jnr`)];
    assert.deepEqual(generalEssentialReviewNotices(stale).map(notice => notice.field), ['ordererName']);
    const result = summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 1, 1, stale);
    assert.equal(result.allMatch, true);
    assert.deepEqual(result.generalAudit.semanticReviews || [], []);
    assert.deepEqual(result.generalAudit.warnings, []);
    assert.doesNotMatch(renderToStaticMarkup(createElement(Details, { details: result.generalAudit })), /Confirm the requested product/);
  });
}

test('an unresolved name stays an orderer review and cannot be silently approved', () => {
  const base = runGeneralAuditor(customer, fulfillment.replace('Samuel Ekobor Junior', 'S Ekobor'));
  const reviews = [review('Customer Name: S Ekobor', 'fulfillment_confirmation')];
  const result = summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 1, 1, reviews);
  assert.equal(result.allMatch, false);
  assert.equal(result.generalAudit.orderer.status, 'review required');
  assert.deepEqual(generalEssentialReviewNotices(result.generalAudit.semanticReviews).map(notice => notice.field), ['ordererName']);
  const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit }));
  assert.match(html, /Customer Name: S Ekobor/);
  assert.match(html, /Fulfilment Confirmation — text requiring review:/);
  assert.doesNotMatch(html, /Product: Confirm the requested product/);
});

test('client revalidation removes stale product warnings for verified name fields', () => {
  const base = runGeneralAuditor(customer, fulfillment);
  const inputs = { whatsappMessage: customer, fulfillmentConfirmation: fulfillment };
  const stale = { ...base, ...inputs, auditEngine: 'general-deterministic-v1', allMatch: false,
    generalAudit: { ...base.generalAudit, semanticReviews: [review('Name: Ekobor Samuel Jnr')], warnings: ['Product: Confirm the requested product.'] } };
  const result = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), stale);
  assert.equal(result.allMatch, true);
  assert.deepEqual(result.generalAudit.warnings, []);
});

test('real product uncertainty shows its original source, reason and candidates without granting clearance', () => {
  const base = runGeneralAuditor(customer, fulfillment);
  const originalText = 'Cough syrup - 2';
  const entry: GeneralSemanticReview = { kind: 'product', source: 'customer_request', originalText, possibleMatches: ['Adult cough syrup', 'Paediatric cough syrup'], reason: 'Adult or paediatric formulation was not specified.' };
  const result = summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 1, 1, [entry]);
  assert.equal(result.allMatch, false);
  const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit }));
  assert.match(html, /Customer Request — text requiring review:/);
  assert.match(html, /Cough syrup - 2/);
  assert.match(html, /Reason: Adult or paediatric formulation was not specified/);
  assert.match(html, /Possible matches: Adult cough syrup, Paediatric cough syrup/);
  assert.match(html, /Product: Confirm the requested product/);
});

test('generic fallback warnings show the exact unresolved line when Gemini is unavailable', async () => {
  const line = 'Please include an additional product for the patient.';
  const result = await runGeneralSemanticAudit(customer + '\n' + line, fulfillment, {}, {}, () => { throw new Error('offline'); });
  assert.equal(result.allMatch, false);
  assert.equal(result.items[0].status, 'match');
  const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit }));
  assert.match(html, /Please include an additional product for the patient/);
  assert.match(html, /Customer Request — text requiring review:/);
});

test('review evidence is deduplicated by source and field, and administrative text remains excluded', () => {
  const product = review('Unknown mixture - 2');
  const reviews = [product, { ...product }, { ...product, source: 'fulfillment_confirmation' as const }, review('Name: Ekobor Samuel Jnr'), review('Sent from my iPhone')];
  assert.equal(generalReviewEvidence(reviews, 'products').length, 2);
  assert.equal(generalReviewEvidence(reviews, 'ordererName').length, 1);
});

test('clinical product wording and mixed lines cannot be reclassified as identity metadata', () => {
  for (const text of ['Hospital grade gloves - 5', 'Name of Orderer: Ekobor Samuel Jnr\nUnknown mixture - 2', 'Please change the quantity to 3']) {
    const entry = review(text);
    if (!text.includes('change')) assert.equal(generalEssentialReviewNotices([entry])[0].field, 'products');
    const base = runGeneralAuditor(customer, fulfillment);
    const result = summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 1, 1, [entry]);
    assert.equal(result.allMatch, false);
    assert.equal(result.generalAudit.semanticReviews?.length, 1);
  }
});
