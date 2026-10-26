import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { buildReport } from './report.js';

const documentFor = record => parseHTML(`<main>${buildReport(record).html}</main>`).document;

test('general report leads with the verdict and separates visible findings, products and identity', () => {
  const document = documentFor({ allMatch: false, issueCount: 1, items: [], generalAudit: {
    message: 'Review <order>', discrepancies: ['Facility <mismatch>'], productVerifications: [],
    facility: { status: 'mismatch', whatsappValue: 'Facility A', fulfillmentValue: 'Facility B' },
    orderer: { status: 'match' },
  } });
  const main = document.querySelector('main');
  assert.ok(main.firstElementChild.classList.contains('audit-highlight'));
  assert.ok(main.firstElementChild.classList.contains('verdict-bad'));
  assert.equal(main.firstElementChild.querySelector('.verdict-badge').textContent, 'Discrepancies: 1');
  assert.equal(main.firstElementChild.querySelector('.highlight-types').textContent, 'Facility name mismatch');
  assert.equal(main.firstElementChild.querySelector('.verdict-text'), null);
  assert.deepEqual([...main.children].map(node => node.getAttribute('aria-label')), [
    'Audit summary', 'Discrepancies', 'Inventory Cross Examination', 'Identity and order checks',
  ]);
  assert.equal(document.querySelector('.audit-findings li').textContent, 'Facility <mismatch>');
  assert.equal(document.querySelector('.audit-findings').closest('details'), null);
  assert.equal(document.querySelector('mismatch'), null);
});

test('clean general report has a success highlight without a discrepancy section', () => {
  const document = documentFor({ allMatch: true, issueCount: 0, items: [], generalAudit: {
    message: 'Order verified', discrepancies: [], productVerifications: [],
  } });
  assert.ok(document.querySelector('main').firstElementChild.classList.contains('verdict-ok'));
  assert.equal(document.querySelector('main').firstElementChild.textContent, 'Order verified');
  assert.equal(document.querySelector('.audit-findings'), null);
});

test('quantity breakdown is shown only for an applied order limit and labels the unfulfilled remainder', () => {
  const render = (fulfillmentStatus, supplied, decision) => documentFor({
    allMatch: fulfillmentStatus === 'fully supplied', issueCount: 0,
    items: [{ name: 'Product A', status: 'match', provenance: [
      { source: 'customer_request', name: 'Product A', originalText: 'Product A 5', line: 1, unit: 'vials' },
      { source: 'fulfillment_confirmation', name: 'Product A', originalText: `Product A ${supplied}`, line: 1, unit: 'vials' },
    ], fulfillment: { requested: 5, supplied, difference: 5 - supplied,
      requestedUnit: 'vials', suppliedUnit: 'vials', fulfillmentStatus,
      orderLimitEligible: true, orderLimitDecision: decision } }],
    generalAudit: { message: 'Audit complete', discrepancies: [], productVerifications: [] },
  });
  for (const [status, supplied, decision] of [
    ['fully supplied', 5, undefined], ['pending order limit', 3, undefined], ['discrepancy', 3, false],
  ]) assert.equal(render(status, supplied, decision).querySelector('.general-quantities'), null, status);
  const applied = render('order limit applied', 3, true);
  assert.deepEqual([...applied.querySelectorAll('.general-quantities span')].map(node => node.textContent), [
    'Requested: 5 vials', 'Fulfilled: 3 vials', 'Remaining to fulfil: 2 vials',
  ]);
  assert.equal(applied.querySelector('.general-product h4').textContent, 'Product A');
});

test('vaccine report separates summary, findings, products and order details while retaining limit actions', () => {
  const document = documentFor({ allMatch: false, issueCount: 1, verdict: 'Check quantities',
    items: [{ name: 'Product A', requested: 5, found: 3, status: 'quantity mismatch',
      fulfillment: { orderLimitEligible: true } }],
    meta: { facilityName: { whatsappValue: 'Facility A' } },
  });
  const main = document.querySelector('main');
  assert.ok(main.firstElementChild.classList.contains('audit-highlight'));
  assert.equal(main.firstElementChild.querySelector('.verdict-badge').textContent, 'Discrepancy alert (1)');
  assert.equal(main.firstElementChild.querySelector('.highlight-types').textContent, 'Quantity mismatch');
  assert.equal(main.children[1].getAttribute('aria-label'), 'Discrepancies');
  assert.equal(main.children[2].getAttribute('aria-label'), 'Product results');
  assert.ok(document.querySelector('[data-limit="yes"]'));
  assert.match(main.lastElementChild.textContent, /Order details/);
});
