import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyCatalog, defaultProducts } from './productCatalog';
import { runGeneralAuditor, applyGeneralProductConfirmation, applyGeneralOrderLimitDecision, normalizeGeneralProductName, parseGeneralProducts } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { assignGeneralProductGroups, matchGeneralClinicalProducts } from '../src/utils/generalProductMatching';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import Inventory from '../src/components/GeneralInventory';

const headers = 'Orderer: John Mensah\nFacility: Alpha HC\n';
const rows = defaultProducts();
const custom = ['Loratadine', 'Loratadine 10mg Tablet', 'Metformin', 'Metformin 500mg Tablet', 'Samplemedicine', 'Samplemedicine 1000mg Tablet', 'Samplemedicine 1000mcg Tablet'].map((name, index) => ({
  id: `central-fixture-${index}`, scope: 'general' as const, category: 'medicine', name, aliases: [], contextualAliases: [], note: '',
}));
function seed() { applyCatalog({ revision: 101, products: [...rows, ...custom] }); }
const offline = () => { throw Object.assign(new Error('Gemini quota exhausted'), { status: 429 }); };
const run = (a: string, b: string) => runGeneralAuditor(headers + a, headers + b);

for (const [a, b] of [
  ['Artesunate 120mg Injection', 'Injection Artesunate 120mg'],
  ['PCM 500mg Tabs', 'Paracetamol 500mg Tablet'],
  ['Rocephin 1g Injection', 'Ceftriaxone 1g Injection'],
  ['Tablet Metformin 500 mg', 'Metformin 500mg Tablet'],
  ['Loratadine 10.0mg Tablet', 'Loratadine 10mg Tablet'],
  ['Loratadine 10000µg Tablet', 'Loratadine 10mg Tablet'],
  ['Ceftriaxone 1000mg Injection', 'Ceftriaxone 1g Injection'],
  ['Ciprofloxacin 200mg/100ml Infusion 100ml', 'Ciprofloxacin 2mg/ml Infusion 100ml'],
]) {
  test(`centralized exact/synonym/attribute matching: ${a}`, () => {
    seed();
    const result = run(a + ' - 15', b + ' [10/10]');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].status, 'quantity mismatch');
    assert.equal(result.items[0].difference, 5);
    assert.equal(result.items[0].fulfillment.orderLimitEligible, true);
    assert.equal(result.generalAudit.productVerifications?.length || 0, 0);
  });
}

for (const [a, b] of [['injection artesunate 120', 'Artesunate 120mg Injection'], ['Loratadine 10 Tablet', 'Loratadine 10mg Tablet']]) {
  test(`missing strength unit uses a unique explicit clinical counterpart: ${a}`, async () => {
    seed(); let calls = 0;
    const result = await runGeneralSemanticAudit(headers + a + ' -15', headers + b + ' [10/10]', {}, {}, () => { calls++; return offline(); });
    assert.equal(calls, 0);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].fulfillment.matchingStage, 'attributes');
    assert.equal(result.items[0].difference, 5);
    assert.equal(result.items[0].requested, '15');
    assert.equal(result.items[0].found, '10');
    assert.equal(result.items[0].fulfillment.clinicalAttributes!.measurements.length, 1);
    assert.equal(applyGeneralOrderLimitDecision(result, result.items[0].fulfillment.key, true).issueCount, 0);
  });
}

for (const [a, b] of [['paracetmol 500mg Tablet', 'Paracetamol 500mg Tablet'], ['Metformim 500mg Tablet', 'Metformin 500mg Tablet'], ['Loratadnie 10mg Tablet', 'Loratadine 10mg Tablet']]) {
  test(`safe OCR matching retains all clinical attributes: ${a}`, async () => {
    seed(); let calls = 0;
    const result = await runGeneralSemanticAudit(headers + a + ' 20/20', headers + b + ' [20/20]', {}, {}, () => { calls++; return offline(); });
    assert.equal(calls, 0);
    assert.equal(result.items[0].status, 'match');
    assert.ok(['fuzzy', 'exact', 'synonym'].includes(result.items[0].fulfillment.matchingStage!));
    assert.equal(result.allMatch, true);
  });
}

for (const [a, b] of [
  ['Paracetamol 250mg Tablet', 'Paracetamol 500mg Tablet'],
  ['Paracetamol 500mg Tablet', 'Paracetamol 500mg Suppository'],
  ['Ciprofloxacin 2mg/ml Infusion 100ml', 'Ciprofloxacin 4mg/ml Infusion 100ml'],
  ['Ceftriaxone 1g Injection IV', 'Ceftriaxone 1g Injection IM'],
  ['Metformin 500mg Tablet XR', 'Metformin 500mg Tablet'],
  ['Loratadnie 10mg Tablet', 'Loratadine 20mg Tablet'],
]) {
  test(`clinical conflicts are never overridden by similarity: ${a} vs ${b}`, () => {
    seed();
    const decision = matchGeneralClinicalProducts(a, b, normalizeGeneralProductName);
    assert.equal(decision.confident, false);
    assert.equal(decision.stage, 'distinct');
    const result = run(a + ' - 5', b + ' [5/5]');
    assert.equal(result.allMatch, false);
    assert.ok(result.issueCount > 0);
  });
}

test('reported multi-product order has one match/shortfall and one formulation verification, never false extras', async () => {
  seed(); let calls = 0;
  const customer = headers + 'injection artesunate 120 -15\ninjection cipro -15';
  const fulfillment = headers + 'Artesunate 120mg Injection [10/10]\nCiprofloxacin 2mg/mL Infusion 100mL [10/10]';
  const initial = await runGeneralSemanticAudit(customer, fulfillment, {}, {}, () => { calls++; return offline(); });
  assert.equal(calls, 0);
  assert.equal(initial.items.length, 1);
  assert.equal(initial.items[0].status, 'quantity mismatch');
  assert.equal(initial.items[0].difference, 5);
  const product = initial.generalAudit.productVerifications![0];
  assert.match(product.productName, /cipro/);
  assert.equal(product.requestedQuantity, 15);
  assert.equal(product.suppliedQuantity, 10);
  assert.match(product.reason!, /formulation/);
  assert.equal(product.options[0].name, 'Ciprofloxacin 2mg/mL Infusion 100mL');
  const html = renderToStaticMarkup(createElement(Inventory, { items: initial.items, details: initial.generalAudit, onOrderLimit() {} }));
  assert.match(html, /Order Limit Verification Required — confirm product first/);
  assert.ok(!initial.items.some(item => ['extra item', 'missing item'].includes(item.status)));
  const confirmed = applyGeneralProductConfirmation(initial, product.key, product.options[0].key, true, { id: 'cca', name: 'CCA' });
  assert.equal(confirmed.items.length, 2);
  assert.ok(confirmed.items.every(item => item.status === 'quantity mismatch' && item.difference === 5));
  assert.equal(confirmed.generalAudit.productVerifications![0].status, 'customer verified');
  assert.equal(confirmed.issueCount, 2);
  assert.equal(confirmed.allMatch, false);
  const inputs = { whatsappMessage: customer, fulfillmentConfirmation: fulfillment };
  const accepted = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...confirmed, ...inputs });
  assert.equal(accepted.items.length, 2);
  assert.ok(accepted.items.every(item => item.status === 'quantity mismatch'));
});

test('true extra/missing products remain discrepancies in a partially unresolved order', async () => {
  seed();
  const result = await runGeneralSemanticAudit(headers + 'injection cipro -15\nLoratadine 10mg Tablet - 3',
    headers + 'Ciprofloxacin 2mg/ml Infusion 100ml [10/10]\nMetformin 500mg Tablet [4/4]', {}, {}, offline);
  assert.ok(result.generalAudit.productVerifications?.length);
  assert.ok(result.items.some(item => item.status === 'missing item' && /Loratadine/.test(item.name)));
  assert.ok(result.items.some(item => item.status === 'extra item' && /Metformin/.test(item.name)));
});

test('competing strength-unit candidates remain one unresolved group rather than missing/extra duplicates', () => {
  seed();
  const result = run('Samplemedicine 1000 Tablet - 5', 'Samplemedicine 1000mg Tablet [5/5]\nSamplemedicine 1000mcg Tablet [5/5]');
  assert.equal(result.items.length, 0);
  const product = result.generalAudit.productVerifications![0];
  assert.ok(product.options.filter(option => option.fromFulfillment).length === 2);
  const confirmed = applyGeneralProductConfirmation(result, product.key, product.options.find(option => /1000mg/.test(option.name))!.key, true);
  assert.equal(confirmed.items.filter(item => item.status === 'match').length, 1);
  assert.equal(confirmed.items.filter(item => item.status === 'extra item').length, 1);
});

test('exact duplicates and split fulfillment still aggregate quantities without cross-pairing clinical variants', () => {
  seed();
  const result = run('PCM 500mg Tabs - 5\nParacetamol 500mg Tablet - 5\nParacetamol 250mg Tablet - 3',
    'Paracetamol 500mg Tablet [4/4]\nParacetamol 500mg Tablet [6/6]\nParacetamol 250mg Tablet [3/3]');
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => item.requested), ['10', '3']);
  assert.ok(result.items.every(item => item.status === 'match'));
});

test('product numbering, source quantities and stock zeroes remain independent of clinical assignment', () => {
  seed();
  const requested = '4 Paracetamol 500mg 20/20';
  assert.equal(parseGeneralProducts(requested, 'customer_request')[0].listNumber, 4);
  assert.equal(parseGeneralProducts('injection artesunate 120 -15', 'customer_request')[0].quantity, 15);
  const result = run('Loratadine 10 Tablet 100/100', 'Loratadine 10mg Tablet [0/100]');
  assert.equal(result.items[0].status, 'out of stock');
  assert.equal(result.items[0].requested, '100');
  assert.equal(result.items[0].found, '0');
});

test('a legacy or AI-interpreted extra is repaired against complete original requests at the frontend boundary', () => {
  seed();
  const customer = headers + 'injection artesunate 120 -15';
  const fulfillment = headers + 'Artesunate 120mg Injection [10/10]';
  const wrong = runGeneralAuditor(headers + 'Unrelated Medicine - 15', fulfillment);
  const inputs = { whatsappMessage: customer, fulfillmentConfirmation: fulfillment };
  // Model an older service that emitted separate source-backed missing/extra rows.
  const source = parseGeneralProducts(customer, 'customer_request')[0];
  wrong.items[0] = { ...wrong.items[0], name: source.name, provenance: [source] };
  const accepted = completeGeneralAuditRun(createGeneralAuditRun(inputs, 2, {}, {}, true), { ...wrong, ...inputs, auditEngine: 'general-deterministic-v1' });
  assert.equal(accepted.items.length, 1);
  assert.equal(accepted.items[0].status, 'quantity mismatch');
  assert.equal(accepted.items[0].difference, 5);
});

test('unrecognized formulation qualifiers remain review candidates, while explicit sizes remain distinct', () => {
  seed();
  const result = run('Loratadine 10mg coated Tablet - 3', 'Loratadine 10mg Tablet [3/3]');
  assert.equal(result.items.length, 0);
  assert.equal(result.generalAudit.productVerifications![0].status, 'customer confirmation required');
  assert.equal(matchGeneralClinicalProducts('Latex Gloves M', 'Latex Gloves L', normalizeGeneralProductName).stage, 'distinct');
});


test('canonical identity takes priority and assignment never reuses a fulfilled group', () => {
  seed();
  const group = (key: string, name: string) => ({ key, name, products: [] });
  const assigned = assignGeneralProductGroups([
    group('incomplete', 'Loratadine 10 Tablet'), group('exact', 'Loratadine 10mg Tablet'),
  ], [group('fulfilled', 'Loratadine 10mg Tablet')], normalizeGeneralProductName);
  assert.equal(assigned.pairs.length, 1);
  assert.equal(assigned.pairs[0].requested.key, 'exact');
  const duplicateKeys = assignGeneralProductGroups([
    group('first', 'Metformin 500mg Tablet'), group('second', 'Metformin 500mg Tablet'),
  ], [group('fulfilled', 'Metformin 500mg Tablet')], normalizeGeneralProductName);
  assert.equal(duplicateKeys.pairs.length, 1);
  assert.equal(new Set(duplicateKeys.pairs.map(pair => pair.fulfilled.key)).size, duplicateKeys.pairs.length);
});

test('polite source prefixes preserve a recognized product and independent quantity comparison', async () => {
  seed(); let calls = 0;
  const result = await runGeneralSemanticAudit(headers + 'please send us Metformin 500mg Tablet - 15',
    headers + 'Metformin 500mg Tablet [10/10]', {}, {}, () => { calls++; return offline(); });
  assert.equal(calls, 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'quantity mismatch');
  assert.equal(result.items[0].difference, 5);
});
