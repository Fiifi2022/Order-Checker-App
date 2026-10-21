import test from 'node:test';
import assert from 'node:assert/strict';
import { extractGeneralOrderDeterministically as extract, validateStructuredGeneralOrder, redactGeneralClinicalText } from './generalOrderExtraction';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import { runGeneralSemanticAudit as audit } from './generalSemanticAudit';

const header = 'Facility: Yagaba Health Centre\nOrderer: NYANKUNI MANYABE\n';
const fulfillment = header + 'Anti Snake Serum Injection [4/4]';
const unavailable = () => { throw new Error('AI must not be called'); };
const empty = () => ({ facilityName: null, ordererName: null, products: [], deliveryArea: null, district: null, unresolvedFields: [], extractionConfidence: 0.99 });
const conversational = 'Hi ZIPLINE. Please we need ASV for continuous case management. Facility; Yagaba health centre. Name of Orderer; NYANKUNI MANYABE. Quantity 4vails.';

test('ASV example extracts deterministically and ignores age 19 and BSCT >30 minutes', async () => {
  const message = conversational + '\nPatient Name: PRIVATE PATIENT\nAge: 19\nSex: Male\nBSCT greater than 30 minutes\nContact: 0241234567';
  const result = await audit(message, fulfillment, {}, {}, unavailable);
  assert.equal(result.semanticAnalysis.status, 'skipped');
  assert.equal(result.allMatch, true);
  assert.equal(result.extractedOrder.facilityName, 'Yagaba health centre');
  assert.equal(result.extractedOrder.ordererName, 'NYANKUNI MANYABE');
  assert.deepEqual(result.extractedOrder.products, [{ name: 'Anti Snake Serum Injection', quantity: 4, unit: 'vial' }]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'match');
});

test('multiple products in sentences and quantities before/after names stay independently associated', async () => {
  const result = await audit(header + 'Please send us four vails ASV and ORS 2 paks.', header + 'ASV [4/4]\nORS - 2 packs', {}, {}, unavailable);
  assert.equal(result.allMatch, true);
  assert.deepEqual(result.extractedOrder.products.map(p => [p.quantity, p.unit]), [[4, 'vial'], [2, 'pack']]);
});

for (const [raw, expected] of [['4vails', 'vial'], ['4 vialls', 'vial'], ['four vials', 'vial'], ['4boxs', 'box'], ['4 boex', 'box'], ['4paks', 'pack'], ['4 pakcs', 'pack'], ['4dozes', 'dose'], ['4 dosses', 'dose']] as const) {
  test(`quantity spelling: ${raw}`, () => {
    const result = extract(header + `Product: ASV\nQty: ${raw}`, 'customer_request');
    assert.deepEqual(result.order.products.map(p => [p.quantity, p.unit]), [[4, expected]]);
    assert.deepEqual(result.order.unresolvedFields, []);
  });
}

test('adjacent product/quantity pairs and single quantity before a product are supported', () => {
  assert.deepEqual(extract(header + 'Medicine: ASV\nQty: 4 vials\nDrug: ORS\nAmount: 2 packs', 'customer_request').order.products.map(p => p.quantity), [4, 2]);
  assert.equal(extract(header + 'Qty: four vials\nASV', 'customer_request').order.products[0]?.quantity, 4);
});

test('optional locations may be absent, while provided values are extracted', async () => {
  const result = await audit(conversational, fulfillment, {}, {}, unavailable);
  assert.equal(result.issueCount, 0);
  assert.equal(result.extractedOrder.deliveryArea, null);
  assert.equal(result.extractedOrder.district, null);
  const order = extract(conversational + '\nDrop area: Main gate\nDistrict: Mamprugu Moagduri', 'customer_request').order;
  assert.equal(order.deliveryArea, 'Main gate');
  assert.equal(order.district, 'Mamprugu Moagduri');
});

test('explicit catalogue synonyms and common spelling corrections preserve medicine identity', async () => {
  const result = await audit(header + 'Please send Paracetmol 4 packs', header + 'Paracetamol - 4 packs', {}, {}, unavailable);
  assert.equal(result.allMatch, true);
  const synonym = await audit(header + 'Please send Anti Snake Venom 4 vials', fulfillment, {}, {}, unavailable);
  assert.equal(synonym.allMatch, true);
});

test('a bare official facility name is found using the supplied directory', async () => {
  const message = 'Ordered By: NYANKUNI MANYABE\nOrdering from Official Yagaba\nPlease send ASV 4 vials';
  const result = await audit(message, 'Facility: Official Yagaba\nOrderer: NYANKUNI MANYABE\nASV [4/4]', {}, {
    facilityContext: { records: [{ id: 'facility-1', name: 'Official Yagaba', source: 'test-directory' }] },
  }, unavailable);
  assert.equal(result.extractedOrder.facilityName, 'Official Yagaba');
  assert.equal(result.generalAudit.facility.status, 'match');
});

test('multiple possible quantity associations stay unresolved rather than guessing', async () => {
  const result = await audit(header + 'ASV\nORS\nQuantity: 4 vials\nQuantity: 2 packs', header + 'ASV - 4 vials\nORS - 2 packs', {}, { semanticTimeoutMs: 10 }, () => ({ models: { generateContent: async () => { throw new Error('offline'); } } }));
  assert.equal(result.allMatch, false);
  assert.ok(result.extractedOrder.unresolvedFields.includes('products'));
  assert.equal(result.issueCount, 0);
  assert.match(result.generalAudit.finalStatus, /REQUIRED|MISSING/);
});

test('missing essential identity requests only that field and keeps deterministic products/facility', async () => {
  const input = 'Facility: Yagaba Health Centre\nDuty nurse is NYANKUNI MANYABE\nASV - 4 vials';
  let calls = 0;
  const result = await audit(input, fulfillment, {}, { semanticCacheScope: 'partial-field-test' }, () => ({ models: { async generateContent(options: any) {
    calls++;
    const payload = JSON.parse(options.contents);
    assert.deepEqual(Object.keys(payload), ['customer']);
    assert.deepEqual(payload.customer.unresolvedFields, ['ordererName']);
    assert.equal(JSON.stringify(payload).includes('ASV'), false);
    assert.equal(JSON.stringify(payload).includes('Yagaba'), false);
    return { text: JSON.stringify({ customer: { ...empty(), ordererName: 'NYANKUNI MANYABE', facilityName: 'Invented Hospital', products: [{ name: 'ORS', quantity: 999, unit: 'pack' }] } }) };
  } } }));
  assert.equal(calls, 1);
  assert.equal(result.allMatch, true);
  assert.equal(result.extractedOrder.facilityName, 'Yagaba Health Centre');
  assert.equal(result.extractedOrder.products[0].quantity, 4);
});

for (const failure of ['error', '429', 'timeout', 'invalid schema', 'invented identity'] as const) {
  test(`Gemini ${failure} preserves deterministic fields and needs review`, async () => {
    let calls = 0;
    const started = Date.now();
    const result = await audit('Facility: Yagaba Health Centre\nASV - 4 vials', fulfillment, {}, { semanticTimeoutMs: 20, semanticCacheScope: `failure-${failure}` }, () => ({ models: { async generateContent() {
      calls++;
      if (failure === 'timeout') return new Promise(() => {});
      if (failure === 'invalid schema') return { text: JSON.stringify({ customer: { ...empty(), extractionConfidence: 3 } }) };
      if (failure === 'invented identity') return { text: JSON.stringify({ customer: { ...empty(), ordererName: 'INVENTED PERSON' } }) };
      throw Object.assign(new Error(failure), { status: failure === '429' ? 429 : 503 });
    } } }));
    assert.equal(calls, 1);
    assert.ok(Date.now() - started < 2000);
    assert.equal(result.extractedOrder.products[0].quantity, 4);
    assert.equal(result.extractedOrder.ordererName, null);
    assert.equal(result.issueCount, 0);
    assert.equal(result.allMatch, false);
    assert.match(result.generalAudit.finalStatus, /REQUIRED|MISSING/);
  });
}

test('identical concurrent extraction requests share one Gemini request', async () => {
  let calls = 0;
  const client = { models: { async generateContent() { calls++; await new Promise(resolve => setTimeout(resolve, 15)); return { text: JSON.stringify({ customer: { ...empty(), ordererName: 'NYANKUNI MANYABE' } }) }; } } };
  const text = 'Facility: Yagaba Health Centre\nSigned NYANKUNI MANYABE\nPlease send ASV 4 vials';
  const results = await Promise.all([audit(text, fulfillment, {}, { semanticCacheScope: 'dedup-test' }, () => client), audit(text, fulfillment, {}, { semanticCacheScope: 'dedup-test' }, () => client)]);
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.allMatch));
});

test('quota exhaustion prevents another request on different unresolved text during cooldown', async () => {
  let calls = 0;
  const client = { models: { async generateContent() { calls++; throw Object.assign(new Error('quota'), { status: 429 }); } } };
  for (const quantity of [4, 5]) await audit(`Facility: Yagaba Health Centre\nASV - ${quantity} vials`, fulfillment, {}, { semanticCacheScope: 'quota-test' }, () => client);
  assert.equal(calls, 1);
});

test('schema validation rejects invalid quantities and confidence, and redaction removes patient details', () => {
  assert.equal(validateStructuredGeneralOrder(empty()), true);
  for (const bad of [{ ...empty(), products: [{ name: 'ASV', quantity: -1, unit: 'vial' }] }, { ...empty(), products: [{ name: 'ASV', quantity: '4', unit: 'vial' }] }, { ...empty(), extractionConfidence: 2 }, { ...empty(), unresolvedFields: ['inventedField'] }]) assert.equal(validateStructuredGeneralOrder(bad), false);
  const redacted = redactGeneralClinicalText('Patient Name: PRIVATE PATIENT\nAge: 19\nBSCT >30 minutes\nContact: 0241234567\nASV - 4 vials');
  assert.doesNotMatch(redacted, /PRIVATE PATIENT|19|30|0241234567/);
  assert.match(redacted, /ASV - 4 vials/);
});

test('clinical numbers alone never supply an absent order quantity', async () => {
  const result = await audit(header + 'Please send ASV\nAge: 19\nBSCT greater than 30 minutes', fulfillment, {}, { semanticTimeoutMs: 10, semanticCacheScope: 'no-quantity' }, () => ({ models: { generateContent: async () => { throw new Error('offline'); } } }));
  assert.deepEqual(result.extractedOrder.products, []);
  assert.ok(result.extractedOrder.unresolvedFields.includes('products'));
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, false);
});

test('contact differences do not create a mismatch but genuine quantity conflicts remain', async () => {
  const result = await audit(header + 'Phone: 0241234567\nPlease send ASV 4 vials', header + 'Phone: 0247654321\nASV [3/4]', {}, {}, unavailable);
  assert.equal(result.generalAudit.phone.status, 'optional not provided');
  assert.equal(result.items[0].status, 'quantity mismatch');
  assert.equal(result.issueCount, 1);
});


test('client rendering retains the independently extracted names and ASV quantity', async () => {
  const inputs = { whatsappMessage: conversational, fulfillmentConfirmation: fulfillment };
  const backend = await audit(inputs.whatsappMessage, inputs.fulfillmentConfirmation, {}, {}, unavailable);
  const result = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...backend, ...inputs });
  assert.equal(result.allMatch, true);
  assert.equal(result.generalAudit.orderer.whatsappValue, 'NYANKUNI MANYABE');
  assert.equal(result.items[0].fulfillment.requested, 4);
});

test('conflicting identity labels are review evidence and cannot be selected by the model', async () => {
  const result = await audit(header + 'Orderer: SOMEONE ELSE\nPlease send ASV 4 vials', fulfillment, {}, { semanticCacheScope: 'conflicting-identities' }, () => ({ models: { async generateContent() {
    return { text: JSON.stringify({ customer: { ...empty(), ordererName: 'NYANKUNI MANYABE' } }) };
  } } }));
  assert.equal(result.extractedOrder.ordererName, null);
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 0);
});


test('unknown acronyms remain reviewable without inventing an unrelated product', async () => {
  const result = await audit(header + 'ZZQ - 4 vials', fulfillment, {}, { semanticCacheScope: 'unknown-abbreviation' }, () => ({ models: { async generateContent() {
    return { text: JSON.stringify({ customer: { ...empty(), products: [{ name: 'Anti Snake Serum Injection', quantity: 4, unit: 'vial' }] } }) };
  } } }));
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 0);
  assert.ok(result.extractedOrder.unresolvedFields.includes('products'));
  assert.deepEqual(result.extractedOrder.products, []);
});

test('validated AI may resolve an unsupported quantity phrase while retaining the supplied product', async () => {
  let calls = 0;
  const text = 'Facility; Yagaba Health Centre; Orderer; NYANKUNI MANYABE; We request ASV total of 4 vials';
  const result = await audit(text, fulfillment, {}, { semanticCacheScope: 'unsupported-quantity-phrase' }, () => ({ models: { async generateContent() {
    calls++;
    return { text: JSON.stringify({ customer: { ...empty(), products: [{ name: 'ASV', quantity: 4, unit: 'vial' }] } }) };
  } } }));
  assert.equal(calls, 1);
  assert.equal(result.semanticAnalysis.status, 'used');
  assert.equal(result.allMatch, true);
  assert.equal(result.extractedOrder.products[0].quantity, 4);
});


test('a conversational self-introduction can share a line with the facility and requested products', async () => {
  const result = await audit('Hello ZIPLINE, I am NYANKUNI MANYABE from Yagaba Health Centre and we need 4vails ASV', fulfillment, {}, {}, unavailable);
  assert.equal(result.allMatch, true);
  assert.equal(result.extractedOrder.ordererName, 'NYANKUNI MANYABE');
  assert.equal(result.extractedOrder.facilityName, 'Yagaba Health Centre');
  assert.equal(result.extractedOrder.products[0].quantity, 4);
});

test('a model cannot promote a clinical age to an absent requested quantity', async () => {
  const result = await audit(header + 'Please send ASV\nAge: 19\nBSCT >30 minutes', fulfillment, {}, { semanticCacheScope: 'invented-age-quantity' }, () => ({ models: { async generateContent(options: any) {
    assert.doesNotMatch(options.contents, /19|30/);
    return { text: JSON.stringify({ customer: { ...empty(), products: [{ name: 'ASV', quantity: 19, unit: 'vial' }] } }) };
  } } }));
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 0);
  assert.deepEqual(result.extractedOrder.products, []);
});
