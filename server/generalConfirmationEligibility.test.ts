import { applyCatalog, defaultProducts } from './productCatalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { applyGeneralProductConfirmation, normalizeGeneralProductName, parseGeneralProducts, runGeneralAuditor, summarizeGeneralProducts } from './generalAuditor';
import { generalConfirmationPolicy } from '../src/utils/generalProductConfirmationPolicy';
import { generalOrderRelevantText } from '../src/utils/generalTextClassification';
import Details from '../src/components/GeneralAuditDetails';
import Inventory from '../src/components/GeneralInventory';
import Verification, { canConfirmGeneralProduct } from '../src/components/GeneralProductVerification';

const headers = 'Orderer: Obed Kamkam\nFacility: Amantenaman Health Centre\n';
const offline = () => { throw Error('AI should not interpret ordinary captions'); };
const markup = (result: ReturnType<typeof runGeneralAuditor>) => renderToStaticMarkup(createElement('div', null, createElement(Details, { details: result.generalAudit }), createElement(Inventory, { items: result.items, details: result.generalAudit, onOrderLimit() {} })));
for (const caption of ['We urgently need:', 'We kindly request the following items:', 'I require:', 'FULFILMENT SYSTEM LOG:',
  'Fulfillment confirmation record:', 'SYSTEM AUDIT LOG:', 'Products & Quantities:', 'Products Requested:',
  'Thank you for ordering.', 'We will now prepare your items.', 'Expected delivery:', 'Please deliver urgently.', 'Kindly expedite delivery.']) {
  test(`ordinary text creates no product, review record or confirmation controls: ${caption}`, async () => {
    let calls = 0;
    const source = headers + caption + '\nParacetamol 500mg Tablet - 20';
    const result = await runGeneralSemanticAudit(source, headers + caption + '\nParacetamol 500mg Tablet [20/20]', {}, {}, () => { calls++; return offline(); });
    assert.equal(calls, 0);
    assert.equal(result.allMatch, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.issueCount, 0);
    assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
    assert.equal(result.generalAudit.productVerifications?.length || 0, 0);
    assert.doesNotMatch(markup(result), /Confirm Product|CUSTOMER CONFIRMATION REQUIRED|PRODUCT IDENTIFICATION REVIEW/);
  });
}

test('introductory text with an inline medicine retains the actual product and quantity', async () => {
  const result = await runGeneralSemanticAudit(headers + 'We urgently need: Paracetamol 500mg Tablet - 20', headers + 'Paracetamol 500mg Tablet [20/20]', {}, {}, offline);
  assert.equal(result.allMatch, true);
  assert.equal(result.items[0].requested, '20');
});

test('unidentified medicines receive identification review without formulation controls', async () => {
  const result = await runGeneralSemanticAudit(headers + 'Unknown antibiotic injection - 10', headers + 'Ciprofloxacin 2mg/ml Infusion 100ml [10/10]', {}, {}, () => { throw Error('offline'); });
  assert.equal(result.allMatch, false);
  assert.ok(result.generalAudit.semanticReviews?.some(review => review.reviewState === 'product identification review' && /Unknown antibiotic/.test(review.originalText)));
  assert.equal(result.generalAudit.productVerifications?.length || 0, 0);
  assert.match(markup(result), /PRODUCT IDENTIFICATION REVIEW/);
  assert.doesNotMatch(markup(result), /Confirm Product|DOSAGE \/ FORMULATION CONFIRMATION REQUIRED/);
});

test('unclear quantities receive quantity review rather than formulation confirmation', async () => {
  const result = await runGeneralSemanticAudit(headers + 'Paracetamol 500mg Tablet 10/20', headers + 'Paracetamol 500mg Tablet [10/10]', {}, {}, () => { throw Error('offline'); });
  assert.equal(result.allMatch, false);
  assert.ok(result.generalAudit.semanticReviews?.some(review => review.reviewState === 'quantity review'));
  assert.equal(result.generalAudit.productVerifications?.length || 0, 0);
  assert.match(markup(result), /QUANTITY REVIEW/);
  assert.doesNotMatch(markup(result), /Confirm Product/);
});

for (const [request, fulfilled] of [['Paracetamol 500mg 20/20', 'Paracetamol 500mg Tablet [20/20]'],
  ['Injection cipro -15', 'Ciprofloxacin 2mg/mL Infusion 100mL [10/10]']]) {
  test(`identified formulation uncertainty retains confirmation and independent quantities: ${request}`, () => {
    const result = runGeneralAuditor(headers + request, headers + fulfilled);
    const product = result.generalAudit.productVerifications![0];
    assert.equal(product.reviewState, 'dosage/formulation confirmation required');
    assert.equal(generalConfirmationPolicy(product, normalizeGeneralProductName).state, 'dosage/formulation confirmation required');
    assert.match(markup(result), /Confirm Product Identity/);
    const option = product.options.find(option => option.fromFulfillment)!;
    assert.equal(canConfirmGeneralProduct(product, option.key, false), false);
    assert.equal(canConfirmGeneralProduct(product, option.key, true), true);
    const confirmed = applyGeneralProductConfirmation(result, product.key, option.key, true);
    assert.equal(confirmed.generalAudit.productVerifications![0].reviewState, 'product match');
    assert.match(markup(confirmed), /Customer Verified — Product Match/);
    if (/cipro/i.test(request)) {
      assert.equal(confirmed.items[0].status, 'quantity mismatch');
      assert.equal(confirmed.items[0].difference, 5);
      assert.equal(confirmed.items[0].fulfillment.productStatus, 'product match');
      assert.equal(confirmed.allMatch, false);
    }
  });
}

test('explicit strength conflicts remain discrepancies', () => {
  const result = runGeneralAuditor(headers + 'Paracetamol 250mg Tablet - 20', headers + 'Paracetamol 500mg Tablet [20/20]');
  assert.equal(result.allMatch, false);
  assert.ok(result.items.every(item => item.fulfillment.productStatus === 'product discrepancy'));
  assert.equal(result.generalAudit.productVerifications?.length || 0, 0);
});

test('older or AI-generated heading confirmation records are removed from underlying audit data', () => {
  const base = runGeneralAuditor(headers + 'Paracetamol 500mg Tablet - 20', headers + 'Paracetamol 500mg Tablet [20/20]');
  const fixture = runGeneralAuditor(headers + 'Paracetamol 500mg - 20', headers + 'Paracetamol 500mg Tablet [20/20]').generalAudit.productVerifications![0];
  for (const heading of ['We urgently need:', 'FULFILMENT SYSTEM LOG:']) {
    const invalid = { ...fixture, originalText: heading, requestedProducts: fixture.requestedProducts.map(source => ({ ...source, originalText: heading })) };
    assert.equal(canConfirmGeneralProduct(invalid, invalid.options[0].key, true), false);
    assert.equal(renderToStaticMarkup(createElement(Verification, { product: invalid })), '');
    assert.throws(() => applyGeneralProductConfirmation({ ...base, generalAudit: { ...base.generalAudit, productVerifications: [invalid] } }, invalid.key, invalid.options[0].key, true), /identification or quantity review/);
    const d = base.generalAudit;
    const clean = summarizeGeneralProducts(base.items, d.facility, d.orderer, d.phone, 1, 1,
      [{ dosageFormKey: invalid.key, kind: 'product', source: 'customer_request', originalText: heading, possibleMatches: ['Paracetamol'], reason: 'AI classified this as a product' }], { ...d, productVerifications: [invalid] });
    assert.equal(clean.allMatch, true);
    assert.equal(clean.generalAudit.productVerifications?.length || 0, 0);
    assert.equal(clean.generalAudit.semanticReviews?.length || 0, 0);
  }
});

test('administrative filtering preserves real amendments, named products and stock section boundaries', () => {
  assert.equal(generalOrderRelevantText('Please deliver urgently to a different facility.').trim(), '');
  assert.equal(parseGeneralProducts('We urgently need: Unknown injection - 10', 'customer_request').length, 1);
  const result = runGeneralAuditor(headers + 'ORS - 2 packs\nParacetamol 500mg Tablet - 20', headers + 'Out of stock:\n- ORS\nWe will now prepare your items.\nParacetamol 500mg Tablet [20/20]');
  assert.deepEqual(result.items.map(item => item.status), ['out of stock', 'match']);
});


test('a customer-verified different formulation remains a product discrepancy', () => {
  applyCatalog({ revision: 1, products: defaultProducts() });
  const result = runGeneralAuditor(headers + 'Paracetamol 500mg - 20', headers + 'Paracetamol 500mg Tablet [20/20]');
  const product = result.generalAudit.productVerifications![0];
  const different = product.options.find(option => !option.fromFulfillment)!;
  const confirmed = applyGeneralProductConfirmation(result, product.key, different.key, true);
  assert.equal(confirmed.generalAudit.productVerifications![0].reviewState, 'product discrepancy');
  assert.equal(confirmed.allMatch, false);
  assert.match(markup(confirmed), /Product Discrepancy/);
});
