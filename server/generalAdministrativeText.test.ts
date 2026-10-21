import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { runGeneralAuditor, extractGeneralInput, applyGeneralOrderLimitDecision, summarizeGeneralProducts } from './generalAuditor';
import { classifyGeneralText, generalOrderRelevantText } from '../src/utils/generalTextClassification';
import Details from '../src/components/GeneralAuditDetails';
const h = 'Name of Orderer: Kwame Mensah\nName of Health Facility: Example Health Centre\n';
const p = 'Multivitamin Syrup — 5\nParacetamol 120mg/5mL Syrup, 100mL — 5';
const delivery = 'Expected delivery: between June 26, 2026 10:38 AM and June 26, 2026 12:38 PM.';
const contact = 'Let us know if any changes are required or contact 0800719102 if any questions.';
const offline = () => { throw Error('Gemini unavailable'); };
const check = (a = h + p, b = h + p) => runGeneralSemanticAudit(a, b, {}, {}, offline);

for (const footer of [delivery, contact, delivery + '\n' + contact, delivery + ' ' + contact,
  'Customer service: 0800719102', 'For assistance, please call 0800719102.',
  'Thank you for your order. This is an automated notification. Please do not reply.',
  'Regards,\nZipline Customer Support Team', 'Sent from my iPhone',
  'Estimated arrival: 2026-10-20 12:30 GMT.', 'Delivery time window: within 2 hours.',
  'Hello. We have received your order. Thank you.',
  'This message is intended for the named recipient only.']) {
  test(`administrative footer does not influence verification: ${footer.slice(0, 55)}`, async () => {
    let calls = 0;
    const result = await runGeneralSemanticAudit(h + p, h + p + '\n' + footer, {}, {}, () => { calls++; return offline(); });
    assert.equal(result.allMatch, true); assert.equal(result.issueCount, 0); assert.equal(result.confidence, 100);
    assert.equal(calls, 0); assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
    assert.equal(result.items.length, 2); assert.ok(result.items.every(item => item.status === 'match'));
    assert.equal('administrativeInformation' in result.generalAudit, false);
    assert.deepEqual(result.auditSummary, runGeneralAuditor(h + p, h + p).auditSummary);
  });
}

test('service contacts are neither products nor the orderer phone; genuine phone mismatches remain', async () => {
  const result = await check(h + 'Phone: 0241234567\n' + p, h + p + '\nCustomer service: 0800719102');
  assert.equal(result.items.length, 2); assert.equal(result.allMatch, true);
  assert.equal(result.generalAudit.phone.fulfillmentValue, 'N/A');
  const conflict = await check(h + 'Phone: 0241234567\n' + p, h + 'Phone: 0247654321\n' + p + '\n' + contact);
  assert.equal(conflict.generalAudit.phone.status, 'mismatch'); assert.equal(conflict.issueCount, 1);
  assert.equal(classifyGeneralText('0800719102').category, 'unresolved_order');
});

for (const [label, a, b] of [
  ['orderer missing', h.replace('Name of Orderer: Kwame Mensah\n', '') + p, h + p],
  ['facility missing', h + p, h.replace('Name of Health Facility: Example Health Centre\n', '') + p]
]) test(`${label} still blocks approval with administrative text`, async () => {
  const result = await check(a, b + '\n' + delivery + '\n' + contact);
  assert.equal(result.allMatch, false); assert.equal(result.auditSummary.missingRequiredCount, 1);
  assert.equal(result.issueCount, 0); assert.ok(result.confidence < 100);
});

for (const [label, a, b] of [
  ['product discrepancy', h + p, h + 'Amoxicillin — 5\nParacetamol 120mg/5mL Syrup, 100mL — 5'],
  ['quantity discrepancy', h + p, h + p.replace('Syrup — 5', 'Syrup — 8')],
  ['clinical strength discrepancy', h + p, h + p.replace('120mg', '250mg')]
]) test(`${label} survives notification classification`, async () => {
  const result = await check(a, b + '\n' + delivery + '\n' + contact);
  assert.equal(result.allMatch, false); assert.ok(result.issueCount > 0);
});

test('unrecognized product stays unresolved rather than being an administrative footer', async () => {
  const result = await check(h + p + '\nMystery preparation — 3', h + p + '\n' + delivery);
  assert.equal(result.allMatch, false);
  assert.ok(result.generalAudit.semanticReviews?.some(review => /Mystery preparation/.test(review.originalText)));
});

test('stock and order-limit exemptions remain valid and silently discard administrative text after acknowledgement', async () => {
  for (const value of ['Multivitamin Syrup [0/5]', 'Multivitamin Syrup [3/5] (order limit applied)']) {
    const result = await check(h + 'Multivitamin Syrup — 5', h + value + '\n' + delivery);
    assert.equal(result.allMatch, true); assert.equal(result.issueCount, 0);
  }
  const pending = await check(h + 'Multivitamin Syrup — 5', h + 'Multivitamin Syrup [3/5]\n' + delivery);
  const approved = applyGeneralOrderLimitDecision(pending, pending.items[0].fulfillment.key, true);
  assert.equal(approved.allMatch, true); assert.equal('administrativeInformation' in approved.generalAudit, false);
});

for (const label of ['District', 'Delivery/Drop Area']) test(`${label} remains optional, with genuine two-sided conflicts retained`, async () => {
  const a = h + `${label}: One Place\n` + p;
  assert.equal((await check(a, h + p + '\n' + delivery)).allMatch, true);
  const conflict = await check(a, h + `${label}: Another Place\n` + p + '\n' + contact);
  assert.equal(conflict.allMatch, false); assert.ok(conflict.issueCount > 0);
});

for (const change of ['Please deliver to a different facility.', 'Change the quantity from 5 to 10.',
  'Use the new dropsite at Gbimsi.', 'Thank you. Change the quantity from 5 to 10.',
  delivery + ' Change the quantity from 5 to 10.', contact + ' Please deliver to a different facility.',
  'We have received your order for Kwame Mensah. Change the quantity from 5 to 10.',
  'Please include an additional product for the patient.', 'Notes: Cancel this order.', 'Notes: Increase to 10.']) {
  test(`real order instruction cannot be hidden by a footer: ${change.slice(0, 50)}`, async () => {
    assert.notEqual(classifyGeneralText(change).category, 'administrative');
    const result = await check(h + p, h + p + '\n' + change);
    assert.equal(result.allMatch, false); assert.ok(result.generalAudit.auditSummary?.reviewRequiredCount);
    assert.ok(result.generalAudit.semanticReviews?.some(review => review.originalText === generalOrderRelevantText(change).trim()));
    assert.equal(result.items.length, 2, 'instructions are not fabricated product rows');
    assert.equal(result.items[0].fulfillment.supplied, 5);
  });
}

test('dates, phone numbers, broad acknowledgements and delivery words alone do not prove irrelevance', () => {
  for (const text of ['Deliver 5 bottles of Paracetamol tomorrow.', 'Expected delivery: 5 bottles.',
    'Expected delivery: 5', 'Call 0241234567 to change the quantity to 10.',
    'Hello please include something for the patient.', 'Zipline. Please send a new product.',
    'Customer support says use a different facility.', 'Paracetamol — 5 on June 26, 2026.']) {
    assert.notEqual(classifyGeneralText(text).category, 'administrative', text);
  }
});

test('line provenance is preserved and administrative text is absent from results', async () => {
  const raw = h + p + '\n' + delivery + '\n' + contact;
  assert.equal(generalOrderRelevantText(raw).split('\n').length, raw.split('\n').length);
  assert.equal(extractGeneralInput(raw, 'fulfillment_confirmation').products[0].line, 3);
  const result = await check(h + p, raw);
  const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit }));
  assert.doesNotMatch(html, /IGNORED|Expected delivery|0800719102/);
  assert.doesNotMatch(html, /MANUAL REVIEW REQUIRED/);
});

test('a valid-looking AI response cannot erase an original order-change instruction', async () => {
  const pair = () => ({ customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 });
  const change = 'Change the quantity from 5 to 10.';
  const result = await runGeneralSemanticAudit(h + p, h + p + '\n' + change, {}, {}, () => ({ models: { generateContent: async () => ({ text: JSON.stringify({ facility: pair(), orderer: pair(), customerProducts: [], fulfilmentProducts: [], semanticWarnings: [] }) }) } }));
  assert.equal(result.allMatch, false); assert.ok(result.generalAudit.semanticReviews?.some(review => review.originalText === change));
  assert.equal(result.generalAudit.semanticReviews?.filter(review => review.originalText === change).length, 1);
});

test('an AI ambiguity opinion about an administrative footer cannot make it a product review', async () => {
  const unresolved = 'Please include an additional product for the patient.';
  const pair = () => ({ customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 });
  const product = { status: 'AMBIGUOUS_PRODUCT', originalText: delivery, interpretedProduct: null, canonicalProductName: null,
    acronymDetected: null, acronymMeaning: null, synonymsDetected: [], brandNameDetected: null, genericName: null, dosage: null, formulation: null, strength: null,
    quantity: null, quantityText: null, unit: null, confidence: 0.1, reasoningNote: 'Unknown', possibleMatches: [] };
  const result = await runGeneralSemanticAudit(h + p + '\n' + unresolved, h + p + '\n' + delivery, {}, {}, () => ({ models: { generateContent: async () => ({ text: JSON.stringify({ facility: pair(), orderer: pair(), customerProducts: [], fulfilmentProducts: [product], semanticWarnings: [] }) }) } }));
  assert.equal(result.allMatch, false, 'the genuinely unresolved product request is still reviewed');
  assert.ok(result.generalAudit.semanticReviews?.every(review => review.originalText !== delivery));
  assert.ok(result.items.every(item => item.status === 'match'));
});

test('summary rebuilds exclude stale administrative reviews while retaining real unresolved changes', () => {
  const result = runGeneralAuditor(h+p, h+p);
  const detail = result.generalAudit;
  const review = (originalText: string) => ({ kind: 'unparsed_text' as const, source: 'fulfillment_confirmation' as const, originalText, possibleMatches: [], reason: 'Old unresolved text warning' });
  const rebuild = (text: string) => summarizeGeneralProducts(result.items, detail.facility, detail.orderer, detail.phone, detail.productCount.requested, detail.productCount.found, [review(text)], detail);
  assert.equal(rebuild(delivery).allMatch, true);
  assert.equal(rebuild(delivery).confidence, 100);
  assert.equal(rebuild('Change the quantity from 5 to 10.').allMatch, false);
});
