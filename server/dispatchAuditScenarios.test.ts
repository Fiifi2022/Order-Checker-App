import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchAuditScenarios as scenarios} from '../src/data/dispatchAuditScenarios';
import {readFileSync} from 'node:fs';

const scenario = (id: string) => scenarios.find(item => item.id === id)!;

test('PDF examples replace old dispatch demos and each has a category and source page', () => {
  assert.equal(scenarios.length, 7);
  assert.equal(new Set(scenarios.map(item => item.id)).size, scenarios.length);
  assert.equal(new Set(scenarios.map(item => item.category)).size, 5);
  for (const item of scenarios) {
    assert.ok(item.title && item.category && item.description);
    assert.ok(item.sourcePages.length && item.sourcePages.every(page => page >= 1 && page <= 6));
    assert.match(item.fulfillmentConfirmation, /^Thank you .+ from .+ for ordering with Zipline\./);
    assert.ok(!item.fulfillmentConfirmation.includes('--- PAGE'));
  }
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<DispatchAuditScenarios onSelect={applySampleData}/);
  assert.doesNotMatch(app, /Perfect Order Match|Extra Cargo Manifest|discrepancy_qty/);
  const handler = app.slice(app.indexOf('const applySampleData'), app.indexOf('const verifyOrder'));
  assert.match(handler, /setIsDemoAudit\(true\)/);
  assert.match(handler, /invalidateGeneralAudit\(\)/);
  assert.match(handler, /setGeneralImageReset/);
  assert.match(handler, /setWhatsappMessage\(scenario.customerRequest\)/);
  assert.match(handler, /setFulfillmentConfirmation\(scenario.fulfillmentConfirmation\)/);
});

test('PDF stockout and discrepancy values are preserved without making outcomes up', () => {
  assert.match(scenario('nominal-order').fulfillmentConfirmation, /Multivitamin Syrup \[5\/5\]/);
  assert.match(scenario('out-of-stock').customerRequest, /Multivitamin Syrup -5/);
  assert.match(scenario('out-of-stock').fulfillmentConfirmation, /Multivitamin Syrup \[0\/1\]/);
  assert.match(scenario('partial-out-of-stock').customerRequest, /Multivitamin Syrup -15/);
  assert.match(scenario('partial-out-of-stock').fulfillmentConfirmation, /Multivitamin Syrup \[5\/5\]/);
  assert.match(scenario('order-mismatch').fulfillmentConfirmation, /Ringers Lactate \[5\/5\]/);
  assert.match(scenario('facility-mismatch').customerRequest, /Gbimsi CHPS/);
  assert.match(scenario('facility-mismatch').fulfillmentConfirmation, /from Karaga CHPS/);
});

test('vaccine examples retain source abbreviations and quantities', () => {
  assert.match(scenario('katigri-vaccines').customerRequest, /OPV -2/);
  assert.match(scenario('katigri-vaccines').fulfillmentConfirmation, /Oral Polio Vaccine \(1&3\) \[3\/3\]/);
  for (const id of ['bimbagu-confirmation', 'kpasenkpe-confirmation']) {
    assert.equal(scenario(id), undefined);
  }
  assert.match(scenario('asv-arv').customerRequest, /2026\nName of Orderer/);
  assert.match(scenario('asv-arv').customerRequest, /ASV -5/);
  assert.match(scenario('asv-arv').fulfillmentConfirmation, /Anti rabies vaccine \[5\/5\]/);
});
