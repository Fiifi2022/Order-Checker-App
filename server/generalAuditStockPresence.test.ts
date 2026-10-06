import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeGeneralProductName, parseGeneralProducts, preserveGeneralOutOfStockEvidence, runGeneralAuditor } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import Summary from '../src/components/GeneralFulfillmentSummary';

const adult = 'Simple Linctus 125mg/5ml Syrup (Adult)';
const paediatric = 'Simple Linctus 31.25mg/5ml Syrup (Paediatric)';
const request = `1. Multivitamin Syrup -15\n2. Paracetamol 120mg/5mL Syrup, 100mL -15\n3. ${adult} -5\n4. ${paediatric} -5`;
const stockHeader = 'We are currently out of stock for the following items:';
const fulfillment = `${stockHeader}\n\n- ${adult} [0/1]\n- ${paediatric} [0/1]\n\nWe can prepare the following items we have in stock for delivery:\n\n- Multivitamin Syrup [5/5]\n- Paracetamol 120mg/5mL Syrup, 100mL [5/5]`;

test('the exact supplied scenario separates stock availability from two real quantity differences', () => {
  const result = runGeneralAuditor(request, fulfillment);
  assert.deepEqual(result.items.map(item => item.status), ['quantity mismatch', 'quantity mismatch', 'out of stock', 'out of stock']);
  assert.equal(result.items.length, 4);
  assert.equal(result.issueCount, 2);
  assert.equal(result.generalAudit.counts.outOfStock, 2);
  assert.deepEqual(result.generalAudit.productCount, { requested: 4, found: 4, status: 'match' });
  for (const item of result.items.filter(item => item.name.startsWith('Simple Linctus'))) {
    assert.equal(item.fulfillment.fulfillmentStatus, 'out of stock');
    assert.equal(item.requested, '5');
    assert.equal(item.found, '0');
    assert.equal(item.fulfillment.orderLimitEligible, false);
    const evidence = item.provenance.find(product => product.source === 'fulfillment_confirmation')!;
    assert.equal(evidence.ratioRequestedQuantity, 1);
    assert.equal(evidence.stockSection, stockHeader);
  }
  assert.ok(result.generalAudit.discrepancies.every(issue => !issue.includes('Simple Linctus')));
  assert.match(result.generalAudit.message!, /2 requested products are currently out of stock/);
  const html = renderToStaticMarkup(createElement(Summary, { details: result.generalAudit }));
  const beforeStock = html.split('<h5 class="font-semibold">Out of Stock</h5>')[0];
  assert.doesNotMatch(beforeStock, /Simple Linctus/);
  assert.doesNotMatch(html, /Missing Products|Missing Packages|Extra Products/);
  const record = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage: request, fulfillmentConfirmation: fulfillment }, 1), { items: [{ name: adult, status: 'missing item' }], issueCount: 99 });
  assert.deepEqual(record.items.map(item => item.status), result.items.map(item => item.status));
});

test('the six requested presence tests use product identity before fulfillment availability', () => {
  for (const [customer, system, statuses, count] of [
    ['Simple Linctus Adult - 5', 'Simple Linctus Adult [0/1]', ['out of stock'], 0],
    ['Simple Linctus Paediatric - 5', 'Simple Linctus Paediatric [0/1]', ['out of stock'], 0],
    ['Simple Linctus Adult - 5\nSimple Linctus Paediatric - 5', 'Simple Linctus Adult [0/1]\nSimple Linctus Paediatric [0/1]', ['out of stock', 'out of stock'], 0],
    ['Simple Linctus Adult - 5', 'No Simple Linctus product anywhere.', ['missing item'], 1],
    ['Simple Linctus Adult - 5', 'Simple Linctus Adult [5/5]', ['match'], 0],
    ['Simple Linctus Adult - 5', 'Simple Linctus Adult [3/5]', ['quantity mismatch'], 1]
  ] as const) {
    const result = runGeneralAuditor(customer, system);
    assert.deepEqual(result.items.map(item => item.status), statuses);
    assert.equal(result.issueCount, count);
  }
});

test('all valid zero denominators override customer quantity and harmless name formatting', () => {
  for (const n of [1, 2, 5, 10, 25]) {
    for (const name of [adult, 'simple linctus 125 mg/5 ml syrup adult', 'Simple Linctus 125mg/5mL Syrup - Adult']) {
      const result = runGeneralAuditor(`${adult} - 5`, `- ${name} [0/${n}]`);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].status, 'out of stock');
      assert.equal(result.issueCount, 0);
      assert.equal(result.allMatch, true);
    }
  }
  assert.notEqual(normalizeGeneralProductName(adult), normalizeGeneralProductName(paediatric));
  assert.notEqual(normalizeGeneralProductName('Simple Linctus Adult'), normalizeGeneralProductName('Simple Linctus Paediatric'));
});

test('explicit textual stock markers and sections preserve product presence and evidence', () => {
  for (const marker of ['out of stock', 'currently out of stock', 'not currently in stock', 'currently unavailable', 'unavailable']) {
    for (const system of [`${adult} — ${marker}`, `${adult} [0/1] — ${marker}`, `${marker}:\n- ${adult} [0/1]`, `${marker}:\n- ${adult}`]) {
      const result = runGeneralAuditor(`${adult} - 5`, system);
      assert.equal(result.items.length, 1, system);
      assert.equal(result.items[0].status, 'out of stock', system);
      assert.equal(result.issueCount, 0);
      const evidence = result.items[0].provenance.find(product => product.source === 'fulfillment_confirmation')!;
      assert.ok(evidence.stockIndicator || evidence.stockSection);
    }
  }
  assert.equal(parseGeneralProducts(fulfillment, 'fulfillment_confirmation').length, 4);
  const blood = runGeneralAuditor('PRBC O- - 2', 'Packed Red Blood Cells O- — currently unavailable');
  assert.deepEqual(blood.items.map(item => item.status), ['out of stock']);
  assert.equal(blood.issueCount, 0);
});

test('stock context cannot waive positive quantities, malformed zero fractions, or absent products', () => {
  for (const quantity of ['[3/5]', '[0/0]', '[0/0.5]']) {
    const result = runGeneralAuditor(`${adult} - 5`, `${stockHeader}\n- ${adult} ${quantity}`);
    assert.equal(result.items[0].status, 'quantity mismatch', quantity);
    assert.equal(result.issueCount, 1);
  }
  const absent = runGeneralAuditor(`${adult} - 5\n${paediatric} - 5`, `${stockHeader}\n- ${adult} [0/1]`);
  assert.deepEqual(absent.items.map(item => item.status), ['out of stock', 'missing item']);
  assert.equal(absent.issueCount, 1);
  assert.equal(runGeneralAuditor(`${adult} - 5`, `${adult} [0/1]\n${adult} [3/5]`).items[0].status, 'quantity mismatch');
  const source = `Out of stock:\n- ${adult}\nIn stock\n- ${paediatric} [5/5]`;
  const evidence = parseGeneralProducts(source, 'fulfillment_confirmation');
  assert.equal(evidence[0].stockSection, 'Out of stock:');
  assert.equal(evidence[1].stockSection, undefined);
  assert.deepEqual(runGeneralAuditor(`${adult} - 5\n${paediatric} - 5`, source).items.map(item => item.status), ['out of stock', 'match']);
});

test('General semantic interpretation cannot truncate stock names or change zero fulfillment evidence', async () => {
  const customer = `Facility: Stock Presence HC\nOrderer: Isaac Awuyem\n${adult} - 5 units\n${paediatric} - 5 units`;
  const source = `${stockHeader}\n- ${adult} [0/1]\n- ${paediatric} [0/1]`;
  const field = () => ({ customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 });
  const data = { facility: field(), orderer: field(), customerProducts: [adult, paediatric].map(name => ({ name: name.replace(/ \([^)]*\)$/, ''), normalizedName: name.replace(/ \([^)]*\)$/, ''), sourceText: `${name} - 5 units`, quantity: 5, quantityText: '5 units', confidence: 0.99 })), fulfilmentProducts: [adult, paediatric].map(name => ({ name: name.replace(/ \([^)]*\)$/, ''), normalizedName: name.replace(/ \([^)]*\)$/, ''), sourceText: `- ${name} [0/1]`, quantity: 0, quantityText: '0/1', confidence: 0.99 })), possibleMissingProducts: [adult, paediatric], possibleExtraProducts: [], semanticWarnings: [] };
  let calls = 0;
  const result = await runGeneralSemanticAudit(customer, source, {}, {}, () => ({ models: { async generateContent() { calls++; return { text: JSON.stringify(data) }; } } }));
  assert.equal(calls, 1);
  assert.equal(result.semanticAnalysis.status, 'used');
  assert.deepEqual(result.items.map(item => item.status), ['out of stock', 'out of stock']);
  assert.equal(result.issueCount, 2);
  assert.deepEqual(result.items.map(item => item.name), [adult, paediatric]);
  assert.equal(result.items[0].provenance[1].originalText, `- ${adult} [0/1]`);
  assert.equal(preserveGeneralOutOfStockEvidence(`${adult} [0/1]`, 'Different product - 5'), `${adult} [0/1]`);
  assert.equal(preserveGeneralOutOfStockEvidence(`${adult} [0/0]`, 'Different product - 5'), 'Different product - 5');
});
