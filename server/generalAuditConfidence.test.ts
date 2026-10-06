import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyGeneralOrderLimitDecision, buildGeneralAuditCheckSummary, runGeneralAuditor } from './generalAuditor';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';
import Confidence from '../src/components/GeneralVerificationConfidence';

const headers = 'Orderer: Isaac Awuyem\nFacility: Gbimsi CHPS\n';
const request = headers + 'Paracetamol - 5\nORS - 5';
const fulfillment = headers + 'Paracetamol [5/5]\nORS [5/5]';
const score = (customer = request, system = fulfillment) => runGeneralAuditor(customer, system);
const render = (result: ReturnType<typeof score>) => renderToStaticMarkup(createElement(Confidence, { summary: result.auditSummary }));

test('perfect audit scores both identities and each paired product and quantity: six of six', () => {
  const result = score();
  assert.deepEqual(result.auditSummary, { totalChecks: 6, passedChecks: 6, failedChecks: 0, discrepancyCount: 0, confidence: 100 });
  assert.equal(result.generalAudit.auditSummary, result.auditSummary);
  assert.equal(result.confidence, result.auditSummary.confidence);
  assert.match(render(result), /100%/);
  assert.match(render(result), /SYSTEM MATCH/);
  assert.match(render(result), /stroke="#22C55E"/);
});

test('one quantity or identity mismatch scores five of six and displays 83% discrepancy', () => {
  for (const system of [fulfillment.replace('ORS [5/5]', 'ORS [3/5]'), fulfillment.replace('Isaac Awuyem', 'John Adams'), fulfillment.replace('Gbimsi CHPS', 'Gambaga Health Centre')]) {
    const result = score(request, system);
    assert.deepEqual(result.auditSummary, { totalChecks: 6, passedChecks: 5, failedChecks: 1, discrepancyCount: 1, confidence: 83 });
    assert.equal(result.issueCount, 1);
    assert.equal(result.allMatch, false);
    const html = render(result);
    assert.match(html, /83%/);
    assert.match(html, /DISCREPANCY DETECTED/);
    assert.doesNotMatch(html, /SYSTEM MATCH|#22C55E/);
  }
});

test('three failed checks out of eight round 62.5% to 63%', () => {
  const result = score(request + '\nAmoxicillin - 5', fulfillment.replace('Isaac Awuyem', 'John Adams').replace('Gbimsi CHPS', 'Gambaga Health Centre').replace('ORS [5/5]', 'ORS [3/5]') + '\nAmoxicillin [5/5]');
  assert.deepEqual(result.auditSummary, { totalChecks: 8, passedChecks: 5, failedChecks: 3, discrepancyCount: 3, confidence: 63 });
  assert.match(render(result), /stroke="#EF4444"/);
});

test('missing and extra products each fail once without fictitious quantity checks', () => {
  const missing = score(headers + 'Paracetamol - 5', headers + 'No fulfilled products.');
  assert.deepEqual(missing.auditSummary, { totalChecks: 3, passedChecks: 2, failedChecks: 1, discrepancyCount: 1, confidence: 67 });
  const extra = score(headers + 'Paracetamol - 5', headers + 'Paracetamol [5/5]\nORS [5/5]');
  assert.deepEqual(extra.auditSummary, { totalChecks: 5, passedChecks: 4, failedChecks: 1, discrepancyCount: 1, confidence: 80 });
  const duplicates = score(headers + 'PCM - 2\nParacetamol - 3', headers + 'Paracetamol [3/5]');
  assert.equal(duplicates.items.length, 1);
  assert.equal(duplicates.auditSummary.totalChecks, 4);
  assert.equal(duplicates.auditSummary.failedChecks, 1);
});

test('valid stock and confirmed limits pass without changing the original requested quantities', () => {
  const stock = score(request, fulfillment.replace('ORS [5/5]', 'ORS [0/1]'));
  assert.equal(stock.confidence, 100);
  assert.equal(stock.issueCount, 0);
  assert.equal(stock.auditSummary.totalChecks, 6);
  assert.match(render(stock), /SYSTEM MATCH/);
  const initial = score(request, fulfillment.replace('ORS [5/5]', 'ORS [3/5]'));
  const key = initial.items[1].fulfillment.key;
  const confirmed = applyGeneralOrderLimitDecision(initial, key, true);
  assert.equal(confirmed.confidence, 100);
  assert.equal(confirmed.auditSummary.failedChecks, 0);
  assert.equal(confirmed.items[1].requested, '5');
  assert.equal(confirmed.items[1].found, '3');
  assert.equal(applyGeneralOrderLimitDecision(confirmed, key, false).confidence, 83);
  const informational = score(headers + 'PCM - 5', headers + 'PCM [5/5]\nORS [0/1]');
  assert.equal(informational.auditSummary.totalChecks, 4);
  assert.equal(informational.confidence, 100);
});

test('missing requested identities fail, and available optional phone checks are scored', () => {
  const missing = score(request, 'Paracetamol [5/5]\nORS [5/5]');
  assert.deepEqual(missing.auditSummary, { totalChecks: 6, passedChecks: 4, failedChecks: 2, discrepancyCount: 2, confidence: 67 });
  const phone = score(request + '\nPhone: 0241234567', fulfillment + '\nPhone: 0247654321');
  assert.equal(phone.auditSummary.totalChecks, 7);
  assert.equal(phone.auditSummary.passedChecks, 6);
  assert.equal(phone.confidence, 86);
  const absent = score('PCM - 5', 'PCM [5/5]');
  assert.equal(absent.auditSummary.totalChecks, 2); // No invented identity or phone validations.
});

test('accepted server scores are rebuilt from the same final comparison that drives the banner', () => {
  const system = fulfillment.replace('ORS [5/5]', 'ORS [3/5]');
  const run = createGeneralAuditRun({ whatsappMessage: request, fulfillmentConfirmation: system }, 1, {}, {}, true);
  const response = { ...score(request, system), confidence: 100, auditEngine: 'general-deterministic-v1', whatsappMessage: request, fulfillmentConfirmation: system };
  const result = completeGeneralAuditRun(run, response);
  assert.equal(result.confidence, 83);
  assert.equal(result.issueCount, result.auditSummary.discrepancyCount);
  assert.equal(result.generalAudit.auditSummary, result.auditSummary);
  assert.match(render(result), /DISCREPANCY DETECTED/);
});

test('large audit rounding cannot hide a failure behind 100% or a green ring', () => {
  const products = Array.from({ length: 250 }, (_, i) => `Product ${i}`);
  const result = score(headers + products.map(name => `${name} - 5`).join('\n'), headers + products.map((name, i) => `${name} [${i === 0 ? 3 : 5}/5]`).join('\n'));
  assert.equal(result.auditSummary.totalChecks, 502);
  assert.equal(result.confidence, 99);
  assert.equal(result.issueCount, 1);
  assert.doesNotMatch(render(result), /SYSTEM MATCH|#22C55E/);
  const noChecks = buildGeneralAuditCheckSummary([], { whatsappValue: 'N/A', fulfillmentValue: 'N/A', status: 'missing from customer request' }, { whatsappValue: 'N/A', fulfillmentValue: 'N/A', status: 'missing from customer request' }, { whatsappValue: 'N/A', fulfillmentValue: 'N/A', status: 'missing from customer request' }, 0);
  assert.equal(noChecks.confidence, 0);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Confidence, { summary: noChecks })), /SYSTEM MATCH/);
});
