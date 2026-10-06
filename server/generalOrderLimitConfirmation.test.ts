import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { applyGeneralOrderLimitDecision, runGeneralAuditor } from './generalAuditor';
import { GeneralOrderLimitPrompt } from '../src/components/GeneralFulfillmentSummary';

test('clicking Yes immediately confirms the item and yields a green order without another comparison', () => {
  let result = runGeneralAuditor('Paracetamol - 10', 'Paracetamol [5/10]');
  const key = result.items[0].fulfillment.key;
  const panel = GeneralOrderLimitPrompt({ product: result.generalAudit.products[0],
    onDecision(productKey, answer) { result = applyGeneralOrderLimitDecision(result, productKey, answer); } });
  const buttons = panel!.props.children[2].props.children;
  buttons[0].props.onClick();
  assert.equal(result.items[0].status, 'order limit applied');
  assert.equal(result.items[0].requested, '10');
  assert.equal(result.items[0].found, '5');
  assert.equal(result.items[0].difference, 5);
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
  assert.deepEqual(result.insights, []);
  assert.equal(result.generalAudit.finalStatus, 'ORDER LIMIT APPLIED — CONFIRMED');
  assert.equal(result.generalAudit.orderLimitDecisions[key], true);
  const html = renderToStaticMarkup(createElement(GeneralOrderLimitPrompt, {
    product: result.generalAudit.products[0], onDecision() {} }));
  assert.match(html, /bg-green-50 border-green-200/);
  assert.match(html, /aria-pressed="true"[^>]*bg-green-700/);
  assert.doesNotMatch(html, /bg-amber-50|Quantity Discrepancy/);
});

test('confirmed limit retains unrelated products and authoritative semantic header checks', () => {
  const raw = runGeneralAuditor('Facility: Alpha Clinic\nOrderer: Jane Smith\nPCM - 10\nORS - 5',
    'Facility: Beta Clinic\nOrderer: John Doe\nPCM [5/10]');
  const record = { ...raw, id: 'audit-123', semanticAnalysis: { status: 'used' } };
  const result = applyGeneralOrderLimitDecision(record, raw.items[0].fulfillment.key, true);
  assert.equal(result.id, record.id);
  assert.equal(result.semanticAnalysis, record.semanticAnalysis);
  assert.equal(result.meta, record.meta);
  assert.equal(result.items[1], record.items[1]);
  assert.equal(result.issueCount, 3); // Facility, orderer, and genuinely missing ORS.
  assert.equal(result.allMatch, false);
  assert.equal(result.generalAudit.finalStatus, 'DISCREPANCY DETECTED');
  assert.equal(result.generalAudit.counts.orderLimited, 1);
  assert.equal(raw.items[0].status, 'quantity mismatch'); // Original result stays unchanged.
});

test('each answer applies to its own product and No restores the quantity discrepancy', () => {
  const original = runGeneralAuditor('PCM - 10\nORS - 10', 'PCM [5/10]\nORS [5/10]');
  const first = applyGeneralOrderLimitDecision(original, original.items[0].fulfillment.key, true);
  assert.equal(first.issueCount, 1);
  assert.equal(first.allMatch, false);
  const second = applyGeneralOrderLimitDecision(first, first.items[1].fulfillment.key, true);
  assert.equal(second.issueCount, 0);
  assert.equal(second.allMatch, true);
  const denied = applyGeneralOrderLimitDecision(second, second.items[0].fulfillment.key, false);
  assert.equal(denied.issueCount, 1);
  assert.equal(denied.items[0].status, 'quantity mismatch');
  assert.equal(denied.generalAudit.counts.orderLimited, 1);
  assert.equal(denied.items[1].status, 'order limit applied');
});

test('zero stock, excess quantities, missing products, and unknown keys cannot be waived', () => {
  for (const system of ['PCM [0/10]', 'PCM [15/10]', 'No fulfilled products.']) {
    const result = runGeneralAuditor('PCM - 10', system);
    assert.equal(applyGeneralOrderLimitDecision(result, result.items[0].fulfillment.key, true), result);
  }
  const result = runGeneralAuditor('PCM - 10', 'PCM [5/10]');
  assert.equal(applyGeneralOrderLimitDecision(result, 'unknown', true), result);
});
