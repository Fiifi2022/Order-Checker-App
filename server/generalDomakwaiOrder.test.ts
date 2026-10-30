import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractGeneralInput, parseGeneralProducts, runGeneralAuditor } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { extractGeneralOrderDeterministically } from './generalOrderExtraction';
import { classifyGeneralText } from '../src/utils/generalTextClassification';
import Summary from '../src/components/GeneralFulfillmentSummary';

const product = 'Sulphadoxine/Pyrimethamine 500mg/25mg Tablet';
const customer = `Hello! Thank you for contacting Zipline. To accurately process your request, kindly complete the below form:
Date: 26-10-26
Name of Orderer: Frimpong Vivian
Name of Health Facility:Dumakwai chps
Delivery / Drop area:Infront of facility Dumakwai chps
District: Juaben
ProductsQuantities:${product} 50 blisters`;
const fulfillment = `Thank you Frimpong Vivian from Domakwai CHPS for ordering with Zipline. We have received your order (ID: FANUU6TLGP).
Use this link to track your order:
https://orders.zipline.com/t/7/FANUU6TLGP We will now prepare the following items for delivery:
- ${product} [5/5]
Expected delivery: between October 26, 2026 10:39 AM and October 26, 2026 12:39 PM. Let us know if any changes are required or contact 0800719102 if any questions.
You will receive your flight notifications via SMS.`;

for (const heading of ['ProductsQuantities:', 'ProductsAndQuantities:', 'Products Quantities:', 'Products and Quantities:', 'Products & Quantities:']) {
  test(`compact request label preserves medicine, strength and blister quantity: ${heading}`, () => {
    const input = customer.replace('ProductsQuantities:', heading);
    const parsed = parseGeneralProducts(input, 'customer_request');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, product);
    assert.equal(parsed[0].quantity, 50);
    assert.equal(parsed[0].unit, 'blister');
    assert.equal(extractGeneralInput(input, 'customer_request').facilityName, 'Dumakwai chps');
    assert.equal(extractGeneralOrderDeterministically(input, 'customer_request').order.products[0].quantity, 50);
  });
}

test('screenshot compares both identities and equivalent 50 blisters / 5 FS packs without AI or unrelated findings', async () => {
  let calls = 0;
  const result = await runGeneralSemanticAudit(customer, fulfillment, {}, {}, () => { calls++; throw Error('Routine templates and explicit quantities need no AI'); });
  assert.equal(calls, 0);
  assert.equal(result.allMatch, true);
  assert.equal(result.issueCount, 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'match');
  assert.equal(result.items[0].fulfillment.requested, 50);
  assert.equal(result.items[0].fulfillment.supplied, 5);
  assert.equal(result.items[0].fulfillment.suppliedUnit, 'pack');
  assert.equal(result.items[0].fulfillment.conversion?.requested, 50);
  assert.equal(result.items[0].fulfillment.conversion?.supplied, 50);
  assert.equal(result.items[0].difference, 0);
  assert.equal(result.generalAudit.facility.whatsappValue, 'Dumakwai chps');
  assert.equal(result.generalAudit.facility.fulfillmentValue, 'Domakwai CHPS');
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.equal(result.generalAudit.facility.status, 'match');
  assert.equal(result.canDispatchAutomatically, false, 'A name comparison does not invent an official facility identity');
  assert.deepEqual(result.generalAudit.semanticReviews || [], []);
  const html = renderToStaticMarkup(createElement(Summary, { details: result.generalAudit }));
  assert.match(html, /1 pack = 10 blisters/);
});

test('the same order still catches changed facility, orderer, medicine, strength and pack quantities', () => {
  assert.equal(runGeneralAuditor(customer, fulfillment.replace('Domakwai CHPS', 'Gbangu CHPS')).generalAudit.facility.status, 'mismatch');
  assert.equal(runGeneralAuditor(customer, fulfillment.replace('Frimpong Vivian', 'Kennedy Namanteng')).generalAudit.orderer.status, 'mismatch');
  for (const name of ['Paracetamol 500mg Tablet', 'Sulphadoxine/Pyrimethamine 250mg/12.5mg Tablet', 'Sulphadoxine/Pyrimethamine/Amodiaquine 500mg/25mg/153mg Tablet']) {
    const result = runGeneralAuditor(customer, fulfillment.replace(product, name));
    assert.equal(result.allMatch, false);
    assert.ok(result.items.some(item => item.status === 'missing item'));
    assert.ok(result.items.every(item => !item.fulfillment.conversion));
  }
  const short = runGeneralAuditor(customer, fulfillment.replace('[5/5]', '[4/5]'));
  assert.equal(short.items[0].status, 'quantity mismatch');
  assert.equal(short.items[0].difference, 10);
  assert.equal(short.allMatch, false);
  assert.equal(runGeneralAuditor(customer, fulfillment.replace('[5/5]', '[6/6]')).items[0].status, 'quantity mismatch');
});

test('pack presentation is product and unit specific; explicit units take precedence', () => {
  const request = customer.replace('ProductsQuantities:', 'Products and Quantities:');
  assert.equal(runGeneralAuditor(request, fulfillment.replace('[5/5]', '5 packs')).items[0].status, 'match');
  const tablets = runGeneralAuditor(request, fulfillment.replace('[5/5]', '5 tablets'));
  assert.equal(tablets.items[0].status, 'quantity mismatch');
  assert.equal(tablets.items[0].fulfillment.conversion, undefined);
  const other = runGeneralAuditor(request.replace(product, 'Paracetamol 500mg Tablet'), fulfillment.replace(product, 'Paracetamol 500mg Tablet'));
  assert.equal(other.items[0].status, 'quantity mismatch');
  assert.equal(other.items[0].fulfillment.conversion, undefined);
});

test('administrative template recognition cannot hide appended products or order changes', () => {
  for (const text of ['To accurately process your request, kindly complete the below form: add Paracetamol 500mg - 3',
    'We have received your order (ID: FANUU6TLGP). Change the facility to Gbangu CHPS.',
    'https://orders.zipline.com/t/7/FANUU6TLGP We will now prepare the following items for delivery: Paracetamol 500mg [3/3]']) {
    assert.notEqual(classifyGeneralText(text).category, 'administrative');
  }
});

test('proportional combination tablet strengths never become equivalent concentrations', async () => {
  const { matchGeneralClinicalProducts } = await import('../src/utils/generalProductMatching');
  const { normalizeGeneralProductName } = await import('./generalAuditor');
  for (const [requested, supplied] of [
    [product, 'Sulphadoxine/Pyrimethamine 250mg/12.5mg Tablet'],
    ['Artemether/Lumefantrine 20mg/120mg Tablet', 'Artemether/Lumefantrine 40mg/240mg Tablet'],
  ]) assert.equal(matchGeneralClinicalProducts(requested, supplied, normalizeGeneralProductName).stage, 'distinct');
  assert.equal(matchGeneralClinicalProducts(product, 'Sulphadoxine/Pyrimethamine 0.5g/25mg Tablet', normalizeGeneralProductName).confident, true);
});
