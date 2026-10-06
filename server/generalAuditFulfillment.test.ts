import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeGeneralProductName, runGeneralAuditor } from './generalAuditor';
import { createGeneralAuditRun, completeGeneralAuditRun, isCurrentGeneralAuditRun } from '../src/utils/generalAuditRun';
import GeneralFulfillmentSummary, { GeneralOrderLimitPrompt } from '../src/components/GeneralFulfillmentSummary';

const limit = (product: string, answer: boolean) => ({ [normalizeGeneralProductName(product)]: answer });
const summaryMarkup = (result: ReturnType<typeof runGeneralAuditor>) => renderToStaticMarkup(React.createElement(GeneralFulfillmentSummary, { details: result.generalAudit }));

// Actual quantities are preserved; the operational decision changes classification only.
test('mixed stock availability confirms without any discrepancy and groups every product', () => {
  const result = runGeneralAuditor('Product A - 1\nProduct B - 1\nProduct C - 1\nProduct D - 1', 'Product A - 1/1\nProduct B - 0/1\nProduct C - 1/1\nProduct D - 0/1');
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
  assert.equal(result.generalAudit.stockStatus, 'partially out of stock');
  assert.equal(result.generalAudit.finalStatus, 'PARTIALLY OUT OF STOCK — CONFIRMED');
  assert.deepEqual(result.items.map(item => item.status), ['match', 'out of stock', 'match', 'out of stock']);
  const html = summaryMarkup(result);
  for (const text of ['Fully Supplied / In Stock', 'Out of Stock', 'Product A — 1/1', 'Product B — 0/1', 'Product C — 1/1', 'Product D — 0/1', 'Confirmed — No Discrepancy']) assert.ok(html.includes(text), text);
});

test('fully out of stock confirms all identified products and lists each unavailable quantity', () => {
  const result = runGeneralAuditor('Product A - 1\nProduct B - 2\nProduct C - 1', 'Product A (0/1)\nProduct B (0/2)\nProduct C (0/1)');
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
  assert.equal(result.generalAudit.stockStatus, 'out of stock');
  assert.equal(result.generalAudit.finalStatus, 'OUT OF STOCK — CONFIRMED');
  assert.equal(result.generalAudit.products.length, 3);
  assert.ok(result.generalAudit.products.every(product => product.fulfillmentStatus === 'out of stock'));
  assert.match(summaryMarkup(result), /Product B — 0\/2/);
});

test('unexplained lower quantities are discrepancies while allowing a confirmed limit answer', () => {
  const result = runGeneralAuditor('Product A - 10', 'Product A - 5');
  assert.equal(result.items[0].status, 'quantity mismatch');
  assert.equal(result.generalAudit.pendingOrderLimitCount, 0);
  assert.equal(result.issueCount, 1);
  assert.equal(result.allMatch, false);
  assert.equal(result.generalAudit.discrepancies.length, 1);
  assert.equal(result.generalAudit.finalStatus, 'DISCREPANCY DETECTED');
  const product = result.generalAudit.products[0];
  const html = renderToStaticMarkup(React.createElement(GeneralOrderLimitPrompt, { product, onDecision() {} }));
  assert.match(html, /Was an Order Limit applied to this product\?/);
  assert.match(html, />Yes<\/button>/);
  assert.match(html, />No<\/button>/);
  assert.match(summaryMarkup(result), /Quantity Discrepancies/);
  assert.doesNotMatch(summaryMarkup(result), /Confirmed — No Discrepancy/);
});

test('Yes confirms the order limit while preserving requested, supplied and difference values', () => {
  const result = runGeneralAuditor('Product A - 10', 'Product A - 5', limit('Product A', true));
  assert.equal(result.items[0].status, 'order limit applied');
  assert.equal(result.items[0].requested, '10');
  assert.equal(result.items[0].found, '5');
  assert.equal(result.items[0].difference, 5);
  assert.equal(result.items[0].provenance.length, 2);
  assert.equal(result.generalAudit.products[0].orderLimitDecision, true);
  assert.equal(result.allMatch, true);
  assert.equal(result.issueCount, 0);
  assert.equal(result.generalAudit.finalStatus, 'ORDER LIMIT APPLIED — CONFIRMED');
  assert.match(summaryMarkup(result), /Requested 10, Supplied 5, Difference 5; Reason: Order Limit/);
});

test('No creates the quantity discrepancy rather than a stock-shortage exemption', () => {
  const result = runGeneralAuditor('Product A - 10', 'Product A - 5', limit('Product A', false));
  assert.equal(result.items[0].status, 'quantity mismatch');
  assert.equal(result.issueCount, 1);
  assert.equal(result.allMatch, false);
  assert.equal(result.generalAudit.finalStatus, 'DISCREPANCY DETECTED');
  assert.match(result.generalAudit.discrepancies[0], /requested 10, entered 5, difference 5/);
  assert.match(summaryMarkup(result), /Quantity Discrepancies/);
});

test('combined order limit, stock shortage and full supply produces the valid combined summary', () => {
  const customer = 'Product A - 10\nProduct B - 2\nProduct C - 4';
  const system = 'Product A - 5\nProduct B - 0/2\nProduct C - 4/4';
  const pending = runGeneralAuditor(customer, system);
  assert.deepEqual(pending.items.map(item => item.status), ['quantity mismatch', 'out of stock', 'match']);
  assert.equal(pending.issueCount, 1);
  assert.equal(pending.allMatch, false);
  const confirmed = runGeneralAuditor(customer, system, limit('Product A', true));
  assert.equal(confirmed.allMatch, true);
  assert.equal(confirmed.generalAudit.finalStatus, 'PARTIALLY FULFILLED — CONFIRMED');
  assert.deepEqual(confirmed.items.map(item => item.status), ['order limit applied', 'out of stock', 'match']);
  const html = summaryMarkup(confirmed);
  for (const text of ['Product C — 4/4', 'Product A — Requested 10, Supplied 5', 'Product B — 0/2', 'Confirmed — No Discrepancy']) assert.ok(html.includes(text));
});

test('every reduced product requires its own answer and previously answered products remain separate', () => {
  const customer = 'Product A - 10\nProduct B - 8';
  const system = 'Product A (5/10)\nProduct B (4/8)';
  const first = runGeneralAuditor(customer, system, limit('Product A', true));
  assert.equal(first.generalAudit.pendingOrderLimitCount, 0);
  assert.equal(first.issueCount, 1);
  assert.equal(first.allMatch, false);
  const decisions = { ...first.generalAudit.orderLimitDecisions, ...limit('Product B', false) };
  const second = runGeneralAuditor(customer, system, decisions);
  assert.equal(second.generalAudit.pendingOrderLimitCount, 0);
  assert.equal(second.issueCount, 1);
  assert.equal(second.items[0].status, 'order limit applied');
  assert.equal(second.items[1].status, 'quantity mismatch');
});

test('order-limit answers cannot exempt excess supply, unit differences, missing or extra products', () => {
  for (const [customer, system, expected] of [
    ['Product A - 10', 'Product A (12/10)', ['quantity mismatch']],
    ['Product A - 10 packs', 'Product A - 5 bottles', ['quantity mismatch']],
    ['Product A - 10', 'Product B - 5', ['missing item', 'extra item']]
  ] as const) {
    const result = runGeneralAuditor(customer, system, { ...limit('Product A', true), ...limit('Product B', true) });
    assert.deepEqual(result.items.map(item => item.status), expected);
    assert.equal(result.allMatch, false);
    assert.ok(result.issueCount > 0);
    assert.ok(result.generalAudit.products.every(product => !product.orderLimitEligible));
    assert.deepEqual(result.generalAudit.orderLimitDecisions, {});
  }
});

test('order-limit confirmation preserves facility, orderer and missing-item discrepancies', () => {
  const customer = 'Facility: Gbimsi CHPS\nOrderer: Isaac Awuyem\nProduct A - 10\nProduct B - 1';
  const system = 'Facility: Walewale Hospital\nOrderer: John Mensah\nProduct A - 5';
  const result = runGeneralAuditor(customer, system, limit('Product A', true));
  assert.equal(result.items[0].status, 'order limit applied');
  assert.equal(result.items[1].status, 'missing item');
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 3); // Two names and one missing product.
  assert.equal(result.generalAudit.finalStatus, 'DISCREPANCY DETECTED');
  assert.deepEqual(result.generalAudit.discrepancies.slice(0, 2), ['Orderer Name Mismatch', 'Facility Name Mismatch']);
});

test('duplicate product lines are aggregated before classifying order limits and full stock shortages', () => {
  const result = runGeneralAuditor('Product A - 6\nProduct A - 4\nProduct B - 2', 'Product A (0/5)\nProduct A (5/5)\nProduct B - out of stock', limit('Product A', true));
  assert.equal(result.generalAudit.products.length, 2);
  assert.deepEqual(result.items.map(item => item.status), ['order limit applied', 'out of stock']);
  assert.equal(result.items[0].requested, '10');
  assert.equal(result.items[0].found, '5');
  assert.equal(result.allMatch, true);
});

test('new audit snapshots reset prior order-limit answers and reject stale confirmations', () => {
  const inputs = { whatsappMessage: 'Product A - 10', fulfillmentConfirmation: 'Product A - 5' };
  const approved = createGeneralAuditRun(inputs, 1, limit('Product A', true));
  const stored = completeGeneralAuditRun(approved, { id: 'audit-current', verdict: 'Discrepancy' });
  assert.equal(stored.items[0].status, 'order limit applied');
  assert.equal(stored.generalAudit.orderLimitDecisions[normalizeGeneralProductName('Product A')], true);
  assert.equal(stored.id, 'audit-current');
  const edited = { ...inputs, fulfillmentConfirmation: 'Product A - 4' };
  const current = createGeneralAuditRun(edited, 2);
  assert.equal(current.comparison.items[0].status, 'quantity mismatch');
  assert.equal(current.comparison.allMatch, false);
  assert.deepEqual(current.comparison.generalAudit.orderLimitDecisions, {});
  assert.equal(isCurrentGeneralAuditRun(approved, edited, 2, new AbortController().signal), false);
});

test('malformed or inherited order-limit answers cannot silently waive discrepancies', () => {
  for (const decisions of [{ [normalizeGeneralProductName('Product A')]: 'yes' }, Object.create(limit('Product A', true))]) {
    const result = runGeneralAuditor('Product A - 10', 'Product A - 5', decisions as Record<string, boolean>);
    assert.equal(result.items[0].status, 'quantity mismatch');
    assert.equal(result.allMatch, false);
  }
});

test('Simple Linctus adult and paediatric zero fractions each have one informational status', () => {
  const names = ['Paracetamol', 'Simple Linctus 125mg/5ml Syrup Adult', 'Amoxicillin', 'Simple Linctus 31.25mg/5ml Syrup Paediatric'];
  const quantities = [5, 5, 10, 5];
  const result = runGeneralAuditor(names.map((name, i) => `${name} - ${quantities[i]}`).join('\n'),
    names.map((name, i) => `${name} [${i % 2 === 0 ? quantities[i] : 0}/${quantities[i]}]`).join('\n'));
  assert.deepEqual(result.items.map(item => item.status), ['match', 'out of stock', 'match', 'out of stock']);
  assert.equal(result.items.length, 4);
  assert.equal(new Set(result.generalAudit.products.map(product => product.key)).size, 4);
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
  assert.deepEqual(result.generalAudit.discrepancies, []);
  for (const item of result.items.filter(item => item.status === 'out of stock')) {
    assert.equal(item.action, 'This requested product is out of stock and was not fulfilled.');
    assert.equal(item.fulfillment.orderLimitEligible, false);
  }
  assert.doesNotMatch(summaryMarkup(result), /Missing Products|Extra Products|Quantity Discrepancies|Remind agent/);
});

test('all positive integer zero fractions take priority over extra-item checks', () => {
  for (const n of [1, 2, 5, 10, 25]) {
    for (const format of [`0/${n}`, `[0/${n}]`, `( 0 / ${n} )`]) {
      const result = runGeneralAuditor('PCM - 5', `Paracetamol [5/5]\nSimple Linctus Syrup ${format}`);
      assert.deepEqual(result.items.map(item => item.status), ['match', 'out of stock']);
      assert.equal(result.issueCount, 0, format);
      assert.equal(result.allMatch, true);
      assert.equal(result.generalAudit.stockStatus, 'in stock');
      assert.deepEqual(result.generalAudit.productCount, { requested: 1, found: 1, status: 'match' });
      assert.match(summaryMarkup(result), new RegExp(`Simple Linctus Syrup — 0/${n}`));
    }
  }
});

test('zero or fractional denominators do not receive an out-of-stock exemption', () => {
  for (const fraction of ['0/0', '0/0.5', '0/2.5']) {
    const result = runGeneralAuditor('Amoxicillin - 5', `Amox [${fraction}]`);
    assert.equal(result.items[0].status, 'quantity mismatch', fraction);
    assert.equal(result.issueCount, 1);
  }
});

test('canonical aliases and reordered names are grouped before zero-supply classification', () => {
  const result = runGeneralAuditor('Amoxicillin - 5\nSimple Linctus 125mg/5ml Syrup Adult - 5',
    'Amox [0/5]\nAdult Simple Linctus Syrup 125mg/5ml [0/2]\nSimple Linctus 125mg/5ml Syrup Adult [0/3]');
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => item.status), ['out of stock', 'out of stock']);
  assert.equal(result.issueCount, 0);
});

test('only positive unrequested fulfillment becomes extra and stock does not waive metadata errors', () => {
  const result = runGeneralAuditor('Facility: Kade HC\nOrderer: Isaac Awuyem\nAmoxicillin - 5',
    'Facility: Other HC\nOrderer: John Mensah\nAmox [0/5]\nORS [0/0]\nParacetamol [2/2]');
  assert.deepEqual(result.items.map(item => item.status), ['out of stock', 'extra item']);
  assert.equal(result.issueCount, 3); // Facility, orderer and positive extra product.
  assert.ok(result.generalAudit.discrepancies.includes('Facility Name Mismatch'));
  assert.ok(result.generalAudit.discrepancies.includes('Orderer Name Mismatch'));
});
