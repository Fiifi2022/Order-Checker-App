import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGeneralProductName, parseGeneralProducts, runGeneralAuditor } from './generalAuditor';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';

const adult = 'Simple Linctus 125mg/5ml Syrup (Adult)';
const child = 'Simple Linctus 31.25mg/5ml Syrup (Paediatric)';
const customer = `3. ${adult} -5\n4. ${child} -5`;
const fulfillment = `We are currently out of stock for the following items:\n\n- ${adult} [0/1]\n- ${child} [0/1]`;
const inputs = { whatsappMessage: customer, fulfillmentConfirmation: fulfillment };

function duplicatedResponse(request = customer, system = fulfillment) {
  const result = runGeneralAuditor(request, system);
  const items = result.items.flatMap(item => item.status === 'out of stock' ? [
    { ...item, status: 'missing item' as const, found: 'None', action: 'Add missing product' },
    { ...item, name: item.name.toLowerCase().replace(/[()]/g, ''), status: 'extra item' as const, requested: 'None', action: 'Remove extra product' }
  ] : [item]);
  return { ...result, items, issueCount: 4, allMatch: false, auditEngine: 'general-deterministic-v1',
    whatsappMessage: request, fulfillmentConfirmation: system, semanticAnalysis: { status: 'used' } };
}

test('exact Simple Linctus input produces two stock cards with zero quantity retained', () => {
  assert.deepEqual(parseGeneralProducts(fulfillment, 'fulfillment_confirmation').map(item => [item.quantity, item.ratioRequestedQuantity]), [[0, 1], [0, 1]]);
  const result = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), {
    ...runGeneralAuditor(customer, fulfillment), ...inputs, auditEngine: 'general-deterministic-v1'
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.generalAudit.products.length, 2);
  assert.deepEqual(result.items.map(item => [item.status, item.requested, item.found]), [['out of stock', '5', '0'], ['out of stock', '5', '0']]);
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
  assert.deepEqual(result.insights, []);
  for (const item of result.items) assert.doesNotMatch(item.action, /add|remove|correct|remind/i);
});

test('current-engine duplicate missing/extra rows are reconciled before rendering and summaries rebuilt', () => {
  const record = duplicatedResponse();
  assert.equal(record.items.length, 4); // Reproduce the formerly trusted server response.
  const result = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), record);
  assert.equal(result.items.length, 2);
  assert.equal(new Set(result.items.map(item => normalizeGeneralProductName(item.name))).size, 2);
  assert.deepEqual(result.items.map(item => item.status), ['out of stock', 'out of stock']);
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
  assert.equal(result.generalAudit.counts.outOfStock, 2);
  assert.equal(result.generalAudit.products.length, 2);
  assert.deepEqual(result.generalAudit.discrepancies, []);
  assert.equal(result.semanticAnalysis.status, 'used');
});

test('duplicate repair retains header mismatches and other semantic product decisions', () => {
  const request = `Facility: Alpha Clinic\nOrderer: Jane Smith\n${customer}\nParacetamol - 5`;
  const system = `Facility: Beta Clinic\nOrderer: John Doe\n${fulfillment}\nParacetamol [3/5]`;
  const record = duplicatedResponse(request, system);
  const original = record.items.at(-1)!;
  const result = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage: request, fulfillmentConfirmation: system }, 1, {}, {}, true), record);
  assert.equal(result.items.length, 3);
  assert.equal(result.items.at(-1), original);
  assert.equal(result.meta, record.meta);
  assert.equal(result.generalAudit.facility.status, 'mismatch');
  assert.equal(result.generalAudit.orderer.status, 'mismatch');
  assert.equal(result.issueCount, 3);
  assert.equal(result.allMatch, false);
  assert.equal(result.generalAudit.finalStatus, 'DISCREPANCY DETECTED');
});

test('normalization, consumption, and quantity checks preserve distinct clinical products', () => {
  for (const variant of [adult, 'Simple Linctus 125mg/5mL Syrup (Adult)', 'simple linctus 125 mg/5 ml syrup adult', 'Simple Linctus 125mg / 5ml Syrup - Adult']) {
    const result = runGeneralAuditor(customer, `${variant} [0/1]\n${child} [0/1]`);
    assert.deepEqual(result.items.map(item => item.status), ['out of stock', 'out of stock']);
    assert.equal(result.issueCount, 0);
  }
  assert.notEqual(normalizeGeneralProductName(adult), normalizeGeneralProductName(child));
  for (const [request, system, status] of [
    ['Paracetamol - 5', 'Paracetamol [5/5]', 'match'],
    ['Paracetamol - 5', 'Paracetamol [0/5]', 'out of stock'],
    ['Paracetamol - 5', 'No fulfilled products.', 'missing item'],
    ['No requested products.', 'ORS [5/5]', 'extra item'],
    ['Paracetamol - 5', 'Paracetamol [3/5]', 'quantity mismatch']
  ]) assert.deepEqual(runGeneralAuditor(request, system).items.map(item => item.status), [status]);
});
