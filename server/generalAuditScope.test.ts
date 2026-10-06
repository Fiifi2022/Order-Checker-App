import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseGeneralProducts, runGeneralAuditor } from './generalAuditor';
import Summary from '../src/components/GeneralFulfillmentSummary';
import Details from '../src/components/GeneralAuditDetails';

const headers = 'Facility: Vea HC\nOrderer: Mary Mensah\n';
const audit = (request: string, fulfillment: string) => runGeneralAuditor(headers + request, headers + fulfillment);

test('General Auditor handles the requested match, stock, absent, extra, mixed and quantity cases', () => {
  for (const [request, fulfillment, statuses, count] of [
    ['Paracetamol - 5', 'Paracetamol [5/5]', ['match'], 0],
    ['Paracetamol - 5', 'Paracetamol [0/5]', ['out of stock'], 0],
    ['Paracetamol - 5', 'ORS [5/5]', ['missing item', 'extra item'], 2],
    ['Paracetamol - 5\nORS - 4\nGloves - 10', 'Paracetamol [0/5]\nORT [4/4]\nGloves [10/10]', ['out of stock', 'match', 'match'], 0],
    ['Paracetamol - 5', 'Paracetamol [3/5]', ['quantity mismatch'], 1],
    ['Paracetamol - 5', 'Paracetamol [5/5]\nORS [2/2]', ['match', 'extra item'], 1]
  ] as const) {
    const result = audit(request, fulfillment);
    assert.deepEqual(result.items.map(item => item.status), statuses);
    assert.equal(result.issueCount, count);
    assert.equal(result.allMatch, count === 0);
    assert.equal(result.generalAudit.pendingOrderLimitCount, 0);
  }
});

test('affirmative per-product order-limit annotations automatically confirm short supply', () => {
  for (const fulfillment of [
    'Paracetamol [5/10] (order limit applied)',
    'Paracetamol - 5 — Order limit reached',
    'Paracetamol - 5 because the order limit was reached.',
    'Paracetamol - only 5 supplied due to the applicable order limit being reached',
    'Paracetamol [5/10] [Order limit enforced]'
  ]) {
    const result = audit('Paracetamol - 10', fulfillment);
    assert.equal(result.items.length, 1, fulfillment);
    assert.equal(result.items[0].status, 'order limit applied', fulfillment);
    assert.equal(result.items[0].requested, '10');
    assert.equal(result.items[0].found, '5');
    assert.equal(result.issueCount, 0);
    assert.equal(result.generalAudit.products[0].orderLimitDecision, true);
    assert.match(result.items[0].action, /applicable order limit was reached/);
    assert.match(result.generalAudit.message!, /affected by an order limit/);
    assert.equal(parseGeneralProducts(fulfillment, 'fulfillment_confirmation')[0].originalText, fulfillment);
  }
});

test('generic, uncertain or negative order-limit notes cannot waive a short quantity', () => {
  for (const note of ['Order limit may apply', 'Order limit was not applied', 'Order limit applied to ORS', 'Note: Order limit applied']) {
    const result = audit('Paracetamol - 10', `Paracetamol [5/10]\n${note}`);
    assert.equal(result.items[0].status, 'quantity mismatch', note);
    assert.equal(result.issueCount, 1);
    assert.deepEqual(result.generalAudit.orderLimitDecisions, {});
  }
});

test('order limits cannot waive extras, excess, unit mistakes, or zero fulfillment', () => {
  for (const [request, fulfillment, statuses, count] of [
    ['Paracetamol - 10', 'Paracetamol [12/10] (order limit applied)', ['quantity mismatch'], 1],
    ['Paracetamol - 10 packs', 'Paracetamol - 5 bottles (order limit applied)', ['quantity mismatch'], 1],
    ['Paracetamol - 10', 'Paracetamol [0/10] (order limit applied)', ['out of stock'], 0],
    ['Paracetamol - 10', 'Paracetamol [10/10]\nORS [2/2] (order limit applied)', ['match', 'extra item'], 1]
  ] as const) {
    const result = audit(request, fulfillment);
    assert.deepEqual(result.items.map(item => item.status), statuses);
    assert.equal(result.issueCount, count);
  }
  const duplicates = audit('Paracetamol - 10', 'Paracetamol [2/5] (order limit applied)\nParacetamol [3/5]');
  assert.equal(duplicates.items.length, 1);
  assert.equal(duplicates.items[0].status, 'quantity mismatch');
});

test('General Auditor medical aliases preserve strength, form, and identity distinctions', () => {
  for (const [left, right] of [['PCM', 'Paracetamol'], ['ACT', 'AL'], ['AL', 'Coartem'], ['RDT', 'Malaria RDT'], ['ORS', 'ORT'], ['Gloves', 'Glove']]) {
    assert.equal(audit(`${left} - 5`, `${right} [5/5]`).issueCount, 0);
  }
  for (const [left, right] of [['RDT', 'HIV RDT'], ['PCM 500mg Tablet', 'Paracetamol 250mg Tablet'], ['Simple Linctus 125mg/5ml Syrup Adult', 'Simple Linctus 31.25mg/5ml Syrup Paediatric']]) {
    assert.deepEqual(audit(`${left} - 5`, `${right} [5/5]`).items.map(item => item.status), ['missing item', 'extra item']);
  }
});

test('orderer matching allows first/surname and titles without erasing different identities', () => {
  for (const name of ['Nurse MARY  MENSAH', 'Dr. Mary Abena Mensah', 'Mary, Mensah']) {
    const result = runGeneralAuditor(headers + 'ORS - 5', `Facility: Vea Health Centre\nOrderer: ${name}\nORS [5/5]`);
    assert.equal(result.generalAudit.orderer.status, 'match', name);
  }
  const different = runGeneralAuditor('Orderer: Mary Abena Mensah\nORS - 5', 'Orderer: Mary Akua Mensah\nORS - 5');
  assert.equal(different.generalAudit.orderer.status, 'mismatch');
  const unrelated = runGeneralAuditor(headers + 'ORS - 5', 'Facility: Vea HC\nOrderer: Jane Mensah\nContact: Mary Mensah\nORS - 5');
  assert.equal(unrelated.generalAudit.orderer.status, 'mismatch');
});

test('General Auditor verdicts show operational statuses and missing-name warnings separately', () => {
  const result = audit('Paracetamol - 5\nORS - 10\nCeftriaxone - 4\nGloves - 6', 'Paracetamol [0/5]\nORS [10/10]\nCeftriaxone [0/4]\nGloves [6/6]');
  assert.equal(result.generalAudit.message, 'Order matches, with 2 products currently out of stock.');
  const html = renderToStaticMarkup(createElement(Summary, { details: result.generalAudit }));
  assert.match(html, /Order matches, with 2 products currently out of stock/);
  assert.doesNotMatch(html, /Missing Products|Extra Products|Quantity Discrepancies/);
  assert.equal(audit('ORS - 5', 'ORS - 5').generalAudit.message, 'All audit checks passed — ready for dispatch.');
  assert.equal(audit('ORS - 5', 'ORT - 3').generalAudit.message, '1 discrepancy found — review before dispatch.');
  const absentNames = runGeneralAuditor('ORS - 5', 'ORS - 5');
  assert.equal(absentNames.issueCount, 0);
  assert.deepEqual(absentNames.generalAudit.warnings, ['ORDERER NAME NOT FOUND', 'FACILITY NOT FOUND']);
  const fields = renderToStaticMarkup(createElement(Details, { details: absentNames.generalAudit }));
  assert.match(fields, /ORDERER NAME NOT FOUND/);
  assert.match(fields, /FACILITY NOT FOUND/);
});
