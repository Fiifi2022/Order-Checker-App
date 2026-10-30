import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeGeneralDocument } from '../src/utils/generalDocumentStructure';
import { classifyGeneralText, generalOrderRelevantText } from '../src/utils/generalTextClassification';
import { parseGeneralProducts, runGeneralAuditor, applyGeneralProductConfirmation } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { extractGeneralOrderDeterministically } from './generalOrderExtraction';

const headers = 'Name of Orderer: Obed Kamkam\nName of Health Facility: Amantenaman Health Centre\n';
const fs = headers + 'Artesunate 120mg Injection [10/10]\nCiprofloxacin 2mg/mL Infusion 100mL [10/10]';
const products = 'injection artesunate 120 -15\nInjection cipro -15';
const offline = () => { throw new Error('AI must not interpret headings'); };

for (const heading of ['Products & Quantities:', 'PRODUCTS  AND   QUANTITIES', 'Product and Quantity:',
  'Products Requested:', 'Medicines Requested:', 'Items Requested:', 'Order Details:',
  'Products / Quantities：', 'Pr0ducts & Quantlties:', 'Products and Quantities:6/6',
  'Requested medical supplies for this visit:', 'Treatment requisition overview:', 'Treatment requisition overview', 'Prod & Qty:', 'Meds reqd:', 'Products and Quantities (All in vials)', 'Vaccine requisition (All in Vials)']) {
  test(`structural heading contributes no product or unresolved finding: ${heading}`, async () => {
    const source = headers + heading + '\n' + products;
    const document = recognizeGeneralDocument(source, classifyGeneralText);
    assert.ok(['HEADING', 'ADMINISTRATIVE_HEADING'].includes(document.lines[2].kind));
    assert.equal(document.originalText, source);
    assert.equal(document.lines[2].originalText, heading);
    assert.equal(parseGeneralProducts(source, 'customer_request').length, 2);
    let calls = 0;
    const result = await runGeneralSemanticAudit(source, fs, {}, {}, () => { calls++; return offline(); });
    assert.equal(calls, 0);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].status, 'quantity mismatch');
    assert.equal(result.items[0].difference, 5);
    assert.equal(result.generalAudit.productVerifications?.length, 1);
    assert.ok(!JSON.stringify(result.generalAudit.semanticReviews).includes(heading));
  });
}

test('multi-line fields keep their relationship, original lines and product evidence', async () => {
  const text = 'Date:\n23rd October 2026\nName of Orderer:\nObed\nKamkam\nName of Health Facility:\nAmantenaman Health Centre\nDelivery/Drop Area:\nFacility\nDistrict:\nAsante Akim North\nProducts & Quantities:\n' + products;
  const document = recognizeGeneralDocument(text, classifyGeneralText);
  assert.equal(document.lines.length, text.split('\n').length);
  assert.equal(document.lines[3].kind, 'FIELD_VALUE');
  assert.equal(document.lines[3].labelLine, 3);
  const extracted = extractGeneralOrderDeterministically(text, 'customer_request');
  assert.equal(extracted.order.ordererName, 'Obed Kamkam');
  assert.equal(extracted.order.facilityName, 'Amantenaman Health Centre');
  assert.equal(extracted.order.deliveryArea, 'Facility');
  assert.equal(extracted.order.district, 'Asante Akim North');
  assert.deepEqual(parseGeneralProducts(text, 'customer_request').map(product => product.quantity), [15, 15]);
  const result = await runGeneralSemanticAudit(text, fs, {}, {}, offline);
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.equal(result.generalAudit.facility.status, 'match');
});

for (const prefix of ['Products:', 'Medicines requested:', 'Items requested =', 'Products and Quantities', 'Product and Quantity', 'Medicines Requested']) {
  test(`an inline heading retains the product value: ${prefix}`, () => {
    const source = headers + prefix + ' Paracetamol 500mg - 20';
    const result = runGeneralAuditor(source, headers + 'Paracetamol 500mg [20/20]');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].status, 'match');
    assert.equal(result.items[0].requested, '20');
  });
}

test('numbering, slash quantities, strengths and missing headings remain independent', () => {
  const source = headers + '1 Paracetamol 500mg 20/20\n2 Artesunate injection 120mg 10/10';
  const result = runGeneralAuditor(source, headers + 'Paracetamol 500mg [20/20]\nArtesunate 120mg Injection [10/10]');
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every(item => item.status === 'match'));
  assert.deepEqual(parseGeneralProducts(source, 'customer_request').map(product => product.listNumber), [1, 2]);
});

test('delivery instructions and captions are excluded without hiding unknown medicines or amendments', async () => {
  const text = headers + 'Products & Quantities:\nUnknown injection - 10\nAdditional instructions:\nPlease deliver tomorrow morning';
  const document = recognizeGeneralDocument(text, classifyGeneralText);
  assert.equal(document.lines[3].kind, 'PRODUCT_ENTRY');
  assert.equal(document.lines[5].kind, 'CUSTOMER_NOTE');
  const result = await runGeneralSemanticAudit(text, headers + 'Paracetamol 500mg [10/10]', {}, {}, () => { throw Error('offline'); });
  assert.equal(result.allMatch, false);
  assert.ok(result.generalAudit.semanticReviews?.some(review => /Unknown injection/.test(review.originalText)));
  assert.ok(!JSON.stringify(result.generalAudit.semanticReviews).includes('deliver tomorrow'));
  assert.match(generalOrderRelevantText('Notes:\nPlease change the quantity of Paracetamol from 5 to 10.'), /change the quantity/);
});

test('customer-confirmed products keep independent quantities after document recalculation', () => {
  const source = headers + 'Products & Quantities:\n' + products;
  const result = runGeneralAuditor(source, fs);
  const pending = result.generalAudit.productVerifications![0];
  const confirmed = applyGeneralProductConfirmation(result, pending.key, pending.options.find(option => option.fromFulfillment)!.key, true);
  assert.equal(confirmed.generalAudit.productVerifications![0].status, 'customer verified');
  assert.equal(confirmed.items.length, 2);
  assert.ok(confirmed.items.every(item => item.status === 'quantity mismatch' && item.difference === 5));
});


test('AI receives ambiguous product evidence without headings and cannot invent a product from a heading count', async () => {
  let calls = 0, aiContents = '';
  const result = await runGeneralSemanticAudit(headers + 'Products & Quantities:6/6\nZZQ - 4 vials',
    headers + 'Anti Snake Serum Injection [4/4]', {}, { semanticCacheScope: 'document-heading-adversarial' }, () => ({ models: { async generateContent(request: any) {
      calls++;
      aiContents = request.contents;
      return { text: JSON.stringify({ customer: { facilityName: null, ordererName: null, deliveryArea: null, district: null,
        products: [{ name: 'Products & Quantities', quantity: 6, unit: 'vial' }], unresolvedFields: [], extractionConfidence: 1 } }) };
    } } }));
  assert.equal(calls, 1);
  assert.doesNotMatch(aiContents, /Products & Quantities|6\/6/);
  assert.equal(result.allMatch, false);
  assert.ok(!result.extractedOrder.products.some(product => /Quantities/.test(product.name)));
  assert.ok(result.generalAudit.semanticReviews?.some(review => /ZZQ/.test(review.originalText)));
});


test('a generic product name is not stripped as a missing-colon heading', () => {
  const result = parseGeneralProducts('Product A - 5', 'customer_request');
  assert.equal(result[0].name, 'Product A');
  assert.equal(result[0].quantity, 5);
});


test('generic medicine words with explicit quantities remain product evidence rather than captions', async () => {
  for (const text of ['vaccine - 5', 'vaccine: 5', 'injection - 5']) {
    assert.equal(parseGeneralProducts(text, 'customer_request')[0].quantity, 5);
  }
  const result = await runGeneralSemanticAudit(headers + 'vaccine - 5', headers + 'vaccine [5/5]', {}, {}, () => { throw Error('offline'); });
  assert.equal(result.allMatch, false);
  assert.equal(result.generalAudit.semanticReviews?.length, 1);
});


test('identity section captions do not replace labelled identities or become product reviews', async () => {
  const source = 'Customer information\nName of Orderer: Obed Kamkam\nFacility details\nName of Health Facility: Amantenaman Health Centre\nProducts requested:\nParacetamol 500mg - 20';
  const result = await runGeneralSemanticAudit(source, headers + 'Paracetamol 500mg [20/20]', {}, {}, offline);
  assert.equal(result.allMatch, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
});

test('repeated structural preprocessing is stable and excludes optional destination instructions', () => {
  const source = headers + 'Products & Quantities:\n' + products + '\nPlease deliver tomorrow morning to Gbimsi CHPS';
  const projected = generalOrderRelevantText(source);
  assert.equal(generalOrderRelevantText(projected), projected);
  assert.doesNotMatch(projected, /Gbimsi CHPS/);
});
