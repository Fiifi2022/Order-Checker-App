import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGeneralProducts, runGeneralAuditor, applyGeneralOrderLimitDecision, applyGeneralProductConfirmation, normalizeGeneralProductName } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { applyCatalog, defaultProducts } from './productCatalog';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';

const headers = 'Name of Orderer: John Mensah\nName of Health Facility: Alpha HC\nProducts and Quantities:\n';
const offline = () => { throw new Error('AI unavailable'); };
function catalog(forms = ['Tablet']) {
  const products = defaultProducts().filter(product => !/paracetamol/i.test(product.name) || !/500\s*mg/i.test(product.name));
  applyCatalog({ revision: 10, products: [...products, ...forms.map(form => ({
    id: `test-pcm-${form}`, scope: 'general' as const, name: `Paracetamol 500mg ${form}`,
    category: 'medicine', aliases: [], contextualAliases: [], note: 'Specific catalogue formulation',
  }))] });
}

for (const prefix of ['1 ', '1. ', '1) ', '(1) ', '1 - ']) {
  for (const quantity of [5, 10, 20, 50, 100]) {
    test(`extract list marker ${prefix} separately from ${quantity}/${quantity}`, () => {
      const raw = `${prefix}Paracetamol 500mg ${quantity}/${quantity}`;
      const [product] = parseGeneralProducts(raw, 'customer_request');
      assert.equal(product.listNumber, 1);
      assert.equal(product.name, 'Paracetamol 500mg');
      assert.equal(product.strength, '500mg');
      assert.equal(product.quantity, quantity);
      assert.equal(product.quantityNotation, `${quantity}/${quantity}`);
      assert.equal(product.originalText, raw);
    });
  }
}

test('genuine leading quantities and leading strengths retain their meanings', () => {
  for (const raw of ['2 boxes of Paracetamol 500mg', '20 Paracetamol 500mg']) {
    const [product] = parseGeneralProducts(raw, 'customer_request');
    assert.equal(product.quantity, raw.startsWith('2 boxes') ? 2 : 20);
    assert.equal(product.listNumber, undefined);
    assert.equal(product.name, 'Paracetamol 500mg');
  }
  const [strengthFirst] = parseGeneralProducts('500mg Paracetamol 100/100', 'customer_request');
  assert.equal(strengthFirst.quantity, 100);
  assert.equal(strengthFirst.listNumber, undefined);
  assert.equal(strengthFirst.strength, '500mg');
});

test('exact requested example matches catalogue identity and compares its shortfall independently without AI', async () => {
  catalog();
  let calls = 0;
  const customer = headers + '4 Paracetamol 500mg 20/20';
  const fulfillment = headers + 'Paracetamol 500mg Tablet — 2 supplied';
  const initial = await runGeneralSemanticAudit(customer, fulfillment, {}, {}, () => { calls++; return offline(); });
  assert.equal(calls, 0);
  const verification = initial.generalAudit.productVerifications![0];
  assert.equal(verification.status, 'customer confirmation required');
  assert.equal(initial.allMatch, false);
  const result = applyGeneralProductConfirmation(initial, verification.key, verification.options.find(option => option.fromFulfillment)!.key, true);
  assert.equal(result.items.length, 1);
  const [item] = result.items;
  assert.equal(item.provenance[0].listNumber, 4);
  assert.equal(item.requested, '20');
  assert.equal(item.found, '2');
  assert.equal(item.difference, 18);
  assert.equal(item.status, 'quantity mismatch');
  assert.equal(item.fulfillment.orderLimitEligible, true);
  assert.equal(item.fulfillment.orderLimitDecision, undefined);
  assert.equal(result.issueCount, 1);
  assert.equal(result.allMatch, false);
  assert.deepEqual(result.generalAudit.semanticReviews || [], []);
  const approved = applyGeneralOrderLimitDecision(result, item.fulfillment.key, true);
  assert.equal(approved.items[0].status, 'order limit applied');
  assert.equal(approved.issueCount, 0);
  assert.equal(applyGeneralOrderLimitDecision(result, item.fulfillment.key, false).issueCount, 1);
  const inputs = { whatsappMessage: customer, fulfillmentConfirmation: fulfillment };
  const saved = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...result, ...inputs });
  assert.equal(saved.items[0].requested, '20');
  assert.equal(saved.generalAudit.products[0].difference, 18);
});

test('equivalent word order and abbreviations preserve specified formulation and strength', () => {
  catalog();
  const target = normalizeGeneralProductName('Paracetamol 500mg Tablet');
  assert.notEqual(normalizeGeneralProductName('Paracetamol 500mg'), target);
  for (const name of ['PCM 500mg Tabs', 'Paracetamol Tabs 500mg']) {
    assert.equal(normalizeGeneralProductName(name), target, name);
  }
  for (const name of ['Paracetamol 250mg Tablet', 'Paracetamol 500mg Suppository']) {
    assert.notEqual(normalizeGeneralProductName(name), target);
  }
});

test('catalogue ambiguity cannot supply a missing formulation', () => {
  catalog(['Tablet', 'Suppository']);
  const result = runGeneralAuditor(headers + '4 Paracetamol 500mg 20/20', headers + 'Paracetamol 500mg Tablet — 2 supplied');
  assert.equal(result.allMatch, false);
  assert.ok(result.generalAudit.semanticReviews?.some(review => /dosage form/.test(review.reason)));
});

test('numbered multi-product orders preserve stock status and actual fulfillment numerators', async () => {
  catalog();
  const customer = headers + '1. Paracetamol 500mg 20/20\n2) Amoxicillin 500mg Capsule 10/10\n(3) Metronidazole 200mg Tablet 5/5\n4 - Ibuprofen 400mg Tablet 15/15';
  const fulfillment = headers + 'Paracetamol 500mg Tablet [0/20]\nAmoxicillin 500mg Capsule [0/5]\nMetronidazole 200mg Tablet [5/5]\nIbuprofen 400mg Tablet [15/15]';
  const initial = await runGeneralSemanticAudit(customer, fulfillment, {}, {}, offline);
  const verification = initial.generalAudit.productVerifications![0];
  const result = applyGeneralProductConfirmation(initial, verification.key, verification.options.find(option => option.fromFulfillment)!.key, true);
  assert.deepEqual(result.items.map(item => item.requested), ['20', '10', '5', '15']);
  assert.deepEqual(result.items.map(item => item.found), ['0', '0', '5', '15']);
  assert.deepEqual(result.items.map(item => item.status), ['out of stock', 'out of stock', 'match', 'match']);
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
});

for (const line of ['4 Paracetamol 500mg 20/10', '2 boxes of Paracetamol 500mg 20/20']) {
  test(`unclear quantity remains under review without Gemini: ${line}`, async () => {
    catalog();
    const [parsed] = parseGeneralProducts(line, 'customer_request');
    assert.ok(parsed.quantityReview);
    assert.ok(parsed.quantityNotation);
    const result = await runGeneralSemanticAudit(headers + line, headers + 'Paracetamol 500mg Tablet [20/20]', {}, {}, offline);
    assert.equal(result.allMatch, false);
    assert.ok(result.generalAudit.semanticReviews?.length);
    assert.ok(!result.items.some(item => item.status === 'match'));
  });
}

test('unequal fulfillment ratios retain supplied quantity and established limit handling', () => {
  catalog();
  const initial = runGeneralAuditor(headers + '4 Paracetamol 500mg 20/20', headers + 'Paracetamol 500mg Tablet [2/20] (order limit applied)');
  const verification = initial.generalAudit.productVerifications![0];
  const result = applyGeneralProductConfirmation(initial, verification.key, verification.options.find(option => option.fromFulfillment)!.key, true);
  assert.equal(result.items[0].found, '2');
  assert.equal(result.items[0].difference, 18);
  assert.equal(result.items[0].status, 'order limit applied');
  assert.equal(result.issueCount, 0);
});
