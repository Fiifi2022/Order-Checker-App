import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Details from '../src/components/GeneralAuditDetails';
import Summary from '../src/components/GeneralFulfillmentSummary';
import { runGeneralSemanticAudit as audit } from './generalSemanticAudit';
import { runGeneralAuditor, summarizeGeneralProducts } from './generalAuditor';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import { generalEssentialReviewNotices } from '../src/utils/generalAuditReviews';
import { classifyGeneralText, generalOrderRelevantText } from '../src/utils/generalTextClassification';
import type { GeneralSemanticReview } from '../src/utils/generalAuditTypes';

const h = 'Facility: Yagaba Health Centre\nOrderer: NYANKUNI MANYABE\n';
const fulfilled = h + 'Anti Snake Serum Injection [4/4]';
const example = 'Hi ZIPLINE. Please we need ASV for continuous case management. Facility; Yagaba health centre. Name of Orderer; NYANKUNI MANYABE. Quantity 4vails.';
const clinical = 'Client name: Iddrisu Hardi\nStatus\nHeavy swelling\nBSCT greater than 30 minutes with no clotting\nPatient age: 19\nSex: male\nContact number: 0241234567';
const offline = () => { throw new Error('AI should be unnecessary'); };
const html = (details: Parameters<typeof Details>[0]['details']) => renderToStaticMarkup(createElement('div', null, createElement(Details, { details }), createElement(Summary, { details })));
const banned = /MANUAL REVIEW REQUIRED — UNRESOLVED TEXT|Product or quantity remains unresolved|Iddrisu Hardi|Heavy swelling|BSCT|0241234567/;

test('Yagaba ASV request ignores all patient context, skips Gemini, and renders no warning cards', async () => {
  let calls = 0;
  const request = example + '\n' + clinical;
  const result = await audit(request, fulfilled, {}, {}, () => { calls++; return offline(); });
  assert.equal(calls, 0);
  assert.equal(result.allMatch, true);
  assert.equal(result.issueCount, 0);
  assert.deepEqual(result.generalAudit.warnings, []);
  assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
  assert.equal(result.extractedOrder.ordererName, 'NYANKUNI MANYABE');
  assert.equal(result.extractedOrder.products[0].quantity, 4);
  assert.equal(result.extractedOrder.products[0].unit, 'vial');
  const rendered = html(result.generalAudit);
  assert.doesNotMatch(rendered, banned);
  assert.doesNotMatch(rendered, /role="status"|bg-red-50/);
  const inputs = { whatsappMessage: request, fulfillmentConfirmation: fulfilled };
  const accepted = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...result, ...inputs });
  assert.equal(accepted.allMatch, true);
  assert.deepEqual(accepted.generalAudit.warnings, []);
});

for (const value of ['Client name Iddrisu Hardi', 'Client name-Iddrisu Hardi', 'Status-heavy swelling', '19 yrs', 'Patient name: Iddrisu Hardi', 'Patient\nIddrisu Hardi', 'Client name; Iddrisu Hardi', 'Age/Sex: 19/M', '19 years old male', 'Sex: male', 'Heavy swelling', 'Status: critical', 'Clinical observations: no clotting', 'Status: patient referred to Yagaba health facility', 'Symptoms: heavy swelling and bleeding', 'BSCT greater than 30 minutes with no clotting', 'BP: 90/60', '0241234567', 'Contact number: 0241234567']) {
  test(`non-order context is ignored: ${value.replace(/\n/g, ' / ')}`, async () => {
    let calls = 0;
    const result = await audit(h + 'ASV - 4 vials\n' + value, fulfilled, {}, {}, () => { calls++; return offline(); });
    assert.equal(calls, 0);
    assert.equal(result.allMatch, true);
    assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
    assert.deepEqual(result.generalAudit.warnings, []);
  });
}

test('ignored clauses can share a line with an explicit order without losing its quantity', async () => {
  const result = await audit(h + 'Client name: Iddrisu Hardi, Please send ASV 4 vials; Status: Heavy swelling; BSCT >30 minutes', fulfilled, {}, {}, offline);
  assert.equal(result.allMatch, true);
  assert.equal(result.extractedOrder.products[0].quantity, 4);
  assert.doesNotMatch(html(result.generalAudit), banned);
});

test('pure deterministic auditing and old review reconciliation exclude patient context too', () => {
  const base = runGeneralAuditor(h + 'ASV - 4 vials', fulfilled);
  const result = runGeneralAuditor(h + 'ASV - 4 vials\n' + clinical, fulfilled + '\n' + clinical);
  assert.equal(result.allMatch, true);
  assert.deepEqual(result.auditSummary, base.auditSummary);
  const reviews: GeneralSemanticReview[] = clinical.split('\n').map(originalText => ({ kind: 'unparsed_text', originalText, source: 'customer_request', possibleMatches: [], reason: 'Stale unresolved warning' }));
  const rebuilt = summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 1, 1, reviews);
  assert.equal(rebuilt.allMatch, true);
  assert.deepEqual(rebuilt.generalAudit.warnings, []);
  assert.equal(generalEssentialReviewNotices(reviews).length, 0);
});

test('a genuine missing ASV quantity produces one concise quantity warning despite many clinical lines', async () => {
  let calls = 0;
  const result = await audit(h + 'Please send ASV\n' + clinical, fulfilled, {}, { semanticCacheScope: 'essential-quantity-warning' }, () => ({ models: { async generateContent(options: any) {
    calls++;
    assert.doesNotMatch(options.contents, /Iddrisu|swelling|BSCT|0241234567|19/);
    throw new Error('offline');
  } } }));
  assert.equal(calls, 1);
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 0);
  assert.deepEqual(result.generalAudit.warnings, ['Quantity: Confirm the requested quantity.']);
  assert.equal(result.generalAudit.finalStatus, 'ORDER DETAILS REQUIRED');
  const rendered = html(result.generalAudit);
  assert.equal((rendered.match(/Quantity: Confirm the requested quantity\./g) || []).length, 1);
  assert.equal((rendered.match(/role="status"/g) || []).length, 1);
  assert.doesNotMatch(rendered, banned);
  assert.doesNotMatch(rendered, /bg-red-50/);
});

test('several unclear products and quantity fragments are grouped by field rather than source line', () => {
  const reviews: GeneralSemanticReview[] = ['Unclear product A - 4', 'Unclear product B - 2', 'Quantity: unknown', 'Quantity: unclear'].map(originalText => ({ kind: 'unparsed_text', originalText, source: 'customer_request', possibleMatches: [], reason: 'Uncertain extraction' }));
  assert.deepEqual(generalEssentialReviewNotices(reviews), [{ field: 'products', message: 'Products and quantities: Confirm the requested products and quantities.' }]);
  const base = runGeneralAuditor(h + 'ASV - 4 vials', fulfilled);
  const rebuilt = summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 1, 1, reviews);
  assert.equal(rebuilt.issueCount, 0);
  assert.equal(rebuilt.allMatch, false);
  assert.deepEqual(rebuilt.generalAudit.warnings, ['Products and quantities: Confirm the requested products and quantities.']);
  assert.equal((html(rebuilt.generalAudit).match(/role="status"/g) || []).length, 1);
});

test('true identity and quantity conflicts remain discrepancies, while missing optional locations do not', async () => {
  const conflict = await audit(example + '\n' + clinical, fulfilled.replace('NYANKUNI MANYABE', 'OTHER ORDERER').replace('[4/4]', '[3/4]'), {}, {}, offline);
  assert.equal(conflict.generalAudit.orderer.status, 'mismatch');
  assert.equal(conflict.items[0].status, 'quantity mismatch');
  assert.equal(conflict.issueCount, 2);
  assert.equal(conflict.generalAudit.dropArea?.status, 'optional not provided');
  assert.equal(conflict.generalAudit.district?.status, 'optional not provided');
  assert.doesNotMatch(html(conflict.generalAudit), banned);
});

test('stock exemptions and product synonyms still apply when clinical context is present', async () => {
  const result = await audit(h + 'Please send ASV 4 vials\n' + clinical, h + 'Anti Snake Serum Injection [0/4]', {}, {}, offline);
  assert.equal(result.items[0].status, 'out of stock');
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
});

test('explicit order amendments inside a status clause remain essential order evidence', () => {
  const text = 'Status: heavy swelling; change the ASV quantity from 4 to 5';
  assert.match(generalOrderRelevantText(text), /change the ASV quantity from 4 to 5/);
  assert.equal(classifyGeneralText('Change the ASV quantity from 4 to 5').orderChange, true);
});


test('a clinical word within a product name cannot turn its warning into a facility warning', () => {
  const notices = generalEssentialReviewNotices([{ kind: 'product', originalText: 'Hospital grade gloves - 5', source: 'customer_request', possibleMatches: [], reason: 'Unknown product specification' }]);
  assert.deepEqual(notices, [{ field: 'products', message: 'Product: Confirm the requested product.' }]);
});

test('old stored clinical warnings cannot reappear as unresolved-text cards', () => {
  const result = runGeneralAuditor(h + 'ASV - 4 vials', fulfilled);
  const details = { ...result.generalAudit, finalStatus: 'MANUAL REVIEW REQUIRED — UNRESOLVED TEXT', message: 'Some text could not be verified automatically.', warnings: ['UNRESOLVED TEXT — MANUAL REVIEW REQUIRED', 'Product or quantity remains unresolved. Needs Review before dispatch; this is not a confirmed mismatch.'], semanticReviews: [{ kind: 'unparsed_text' as const, originalText: 'Heavy swelling', source: 'customer_request' as const, possibleMatches: [], reason: 'Old warning' }] };
  assert.doesNotMatch(html(details), banned);
  assert.doesNotMatch(html(details), /role="status"|bg-red-50/);
});


test('a product-only ASV line identifies the missing field as quantity', async () => {
  const result = await audit(h + 'ASV', fulfilled, {}, { semanticCacheScope: 'bare-asv-missing-quantity' }, () => { throw new Error('offline'); });
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 0);
  assert.deepEqual(result.generalAudit.warnings, ['Quantity: Confirm the requested quantity.']);
});


test('clinical filtering preserves a named stock-section exemption without demanding its quantity', async () => {
  const request = h + 'ASV - 4 vials\nORS - 2 packs\n' + clinical;
  const result = await audit(request, h + 'ASV [4/4]\nOut of stock:\n- ORS', {}, {}, offline);
  assert.deepEqual(result.items.map(item => item.status), ['match', 'out of stock']);
  assert.equal(result.allMatch, true);
  assert.equal(result.issueCount, 0);
  assert.deepEqual(result.generalAudit.warnings, []);
});
