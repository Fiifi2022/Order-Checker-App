import test from 'node:test';
import assert from 'node:assert/strict';
import { CLINICAL_PAIRINGS } from '../shared/vaccinePairing';
import { runGeneralAuditor, applyGeneralOrderLimitDecision } from './generalAuditor';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import { applyCatalog, defaultProducts } from './productCatalog';

const header = 'Facility: Pairing CHPS\nOrderer: Test User\n';
const audit = (customer: string, system: string) => runGeneralAuditor(header + customer, header + system);

test('all six vaccine companions are accepted without an explicit customer request', () => {
  for (const [vaccine, pairing] of Object.entries(CLINICAL_PAIRINGS)) {
    const result = audit(`${vaccine} - 10`, `${vaccine} [10/10]\n${pairing.name} [10/10]`);
    assert.equal(result.allMatch, true, vaccine + ': ' + result.insights.join(' '));
    assert.equal(result.issueCount, 0);
    assert.equal(result.generalAudit.productCount.status, 'match');
    assert.equal(result.items.length, 2);
    assert.ok(result.items.every(item => item.status === 'match'));
  }
});
test('missing, unequal and orphan companions block dispatch for every pairing', () => {
  for (const [vaccine, pairing] of Object.entries(CLINICAL_PAIRINGS)) {
    for (const [customer, system, message] of [
      [`${vaccine} - 10`, `${vaccine} [10/10]`, /missing/],
      [`${vaccine} - 10`, `${vaccine} [10/10]\n${pairing.name} [8/8]`, /quantity mismatch/],
      [`${pairing.name} - 10`, `${pairing.name} [10/10]`, /Orphan/],
    ] as const) {
      const result = audit(customer, system);
      assert.equal(result.allMatch, false, vaccine);
      assert.ok(result.items.some(item => item.status === 'vaccine pairing mismatch'));
      assert.ok(result.generalAudit.discrepancies.some(error => message.test(error)));
      assert.ok(result.confidence < 100);
    }
  }
});
test('zero-supply vaccines need no companion, including an explicitly requested absent companion', () => {
  for (const [vaccine, pairing] of Object.entries(CLINICAL_PAIRINGS)) {
    for (const customer of [`${vaccine} - 10`, `${vaccine} - 10\n${pairing.name} - 10`]) {
      const result = audit(customer, `${vaccine} [0/10]`);
      assert.equal(result.allMatch, true, vaccine);
      assert.equal(result.issueCount, 0);
    }
    assert.equal(audit(`${vaccine} - 10`, `${vaccine} [0/10]\n${pairing.name} [10/10]`).allMatch, false);
  }
});
test('pairing is independent of medicines and explicit customer companion quantities', () => {
  assert.equal(audit('OPV - 10\nOPV Dropper - 8', 'OPV [10/10]\nOPV Dropper [10/10]').allMatch, false);
  assert.equal(audit('IPV - 10', 'IPV [10/10]').allMatch, true);
  const mixed = audit('OPV - 10\nParacetamol - 2', 'OPV [10/10]\nOPV Dropper [10/10]\nParacetamol [1/2]');
  assert.equal(mixed.issueCount, 1);
  assert.equal(mixed.items.find(item => item.name === 'Paracetamol')?.status, 'quantity mismatch');
  assert.equal(audit('OPV - 10', 'OPV [10/10]\nRota Dropper [10/10]').allMatch, false);
});
test('catalog full names and locally approved aliases use the same pairing rules', () => {
  const originalProducts = defaultProducts();
  const products = structuredClone(originalProducts);
  const opv = products.find(product => product.scope === 'vaccine' && product.name === 'OPV')!;
  opv.aliases.push('Local Oral Vaccine');
  try {
    applyCatalog({ revision: 2, products });
    const result = audit('Local Oral Vaccine - 10', 'Oral Polio Vaccine [10/10]\nOral Polio Vaccine Dropper [10/10]');
    assert.equal(result.allMatch, true);
    assert.equal(result.items.length, 2);
  } finally { applyCatalog({ revision: 1, products: originalProducts }); }
});
test('dose quantities use the Vaccine Checker doses-per-vial rules for pairing', () => {
  assert.equal(audit('OPV - 200 doses', 'OPV - 200 doses\nOPV Dropper - 10 pieces').allMatch, true);
  assert.equal(audit('OPV - 200 doses', 'OPV - 200 doses\nOPV Dropper - 200 pieces').allMatch, false);
});
test('order-limit acknowledgement cannot waive pairing failures and rendering remains stable', () => {
  const result = audit('OPV - 10', 'OPV [5/10]\nOPV Dropper [3/10]');
  const primary = result.items.find(item => item.name === 'OPV')!;
  assert.equal(applyGeneralOrderLimitDecision(result, primary.fulfillment.key, true).allMatch, false);
  const inputs = { whatsappMessage: header + 'OPV - 10', fulfillmentConfirmation: header + 'OPV [10/10]\nOPV Dropper [10/10]' };
  const run = createGeneralAuditRun(inputs, 1);
  const rendered = completeGeneralAuditRun(run, { ...run.comparison, ...inputs, auditEngine: 'general-deterministic-v1' });
  assert.equal(rendered.allMatch, true);
  assert.deepEqual(rendered.generalAudit.productCount, { requested: 2, found: 2, status: 'match' });
});
