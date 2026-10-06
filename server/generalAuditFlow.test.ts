import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GeneralAuditDetails from '../src/components/GeneralAuditDetails';
import { createGeneralAuditRun, completeGeneralAuditRun, isCurrentGeneralAuditRun } from '../src/utils/generalAuditRun';

const customerRequestRaw = `Date*: 26th June, 2026
Name of Orderer: Isaac Awuyem
Name of Health Facility: Gbimsi CHPS
Delivery/ Drop area: Gbimsi
District: West Mamprusi
Products and Quantities:
1. Multivitamin Syrup - 5
2. Paracetamol 120mg/5mL Syrup, 100mL - 5`;
const fulfillmentRaw = `Zipline. We have received your order.
- Multivitamin Syrup [5/5]
- Paracetamol 120mg/5mL Syrup, 100mL [5/5]`;
const inputs = { whatsappMessage: customerRequestRaw, fulfillmentConfirmation: fulfillmentRaw };
const legacyResponse = {
  id: 'current-audit', timestamp: '2026-10-03T12:00:00Z',
  verdict: 'Orderer Name Missing, Facility Name Missing', allMatch: false, issueCount: 2,
  meta: { customerName: { whatsappValue: 'N/A', fulfillmentValue: 'N/A', status: 'mismatch' } },
  insights: ['Orderer Name Missing', 'Facility Name Missing'],
  items: [{ name: 'Unrelated old product', status: 'missing item' }],
  whatsappMessage: 'old request', fulfillmentConfirmation: 'old confirmation'
};

function renderDetails(record: ReturnType<typeof completeGeneralAuditRun>) {
  return renderToStaticMarkup(React.createElement(GeneralAuditDetails, { details: record.generalAudit }));
}

test('current raw inputs survive parsing, a legacy API response, and actual field rendering', () => {
  const run = createGeneralAuditRun(inputs, 1);
  assert.deepEqual(run.inputs, inputs);
  assert.equal(run.comparison.meta.ordererName.whatsappValue, 'Isaac Awuyem');
  assert.equal(run.comparison.meta.facilityName.whatsappValue, 'Gbimsi CHPS');
  const record = completeGeneralAuditRun(run, legacyResponse);
  assert.equal(record.id, 'current-audit');
  assert.equal(record.whatsappMessage, customerRequestRaw);
  assert.equal(record.fulfillmentConfirmation, fulfillmentRaw);
  assert.equal(record.verdict, 'DISCREPANCY');
  assert.equal(record.issueCount, 2);
  assert.deepEqual(record.items.map(item => item.name), ['Multivitamin Syrup', 'Paracetamol 120mg/5mL Syrup, 100mL']);
  const html = renderDetails(record);
  assert.match(html, /Customer Request: Isaac Awuyem/);
  assert.match(html, /Customer Request: Gbimsi CHPS/);
  assert.match(html, /ORDERER NAME NOT FOUND/);
  assert.match(html, /FACILITY NOT FOUND/);
  assert.match(html, /System Entry: Not found/);
  assert.match(html, /System Entry: Not available/);
  assert.doesNotMatch(JSON.stringify(record) + html, /Orderer Name Missing|Facility Name Missing|Unrelated old product/);
});

test('matching system headers render matching statuses from the same current snapshot', () => {
  const run = createGeneralAuditRun({ ...inputs, fulfillmentConfirmation: 'Orderer: ISAAC AWUYEM\nFacility: GBIMSI CHPS\n' + fulfillmentRaw }, 2);
  const record = completeGeneralAuditRun(run, legacyResponse);
  assert.equal(record.generalAudit.orderer.status, 'match');
  assert.equal(record.generalAudit.facility.status, 'match');
  assert.equal(record.allMatch, true);
  assert.doesNotMatch(renderDetails(record), /MISSING|MISMATCH|NOT AVAILABLE/);
});

test('different system names render mismatches rather than missing customer fields', () => {
  const run = createGeneralAuditRun({ ...inputs, fulfillmentConfirmation: 'Orderer: John Mensah\nFacility: Walewale Hospital\n' + fulfillmentRaw }, 3);
  const record = completeGeneralAuditRun(run, { ...legacyResponse, verdict: 'NO DISCREPANCY', allMatch: true });
  const html = renderDetails(record);
  assert.equal(record.issueCount, 2);
  assert.equal(record.allMatch, false);
  assert.match(html, /ORDERER NAME MISMATCH/);
  assert.match(html, /FACILITY NAME MISMATCH/);
  assert.match(html, /Customer Request: Isaac Awuyem/);
  assert.match(html, /System Entry: John Mensah/);
  assert.doesNotMatch(html, /MISSING/);
});

test('missing customer fields use customer-specific states even if system is also empty', () => {
  for (const system of [fulfillmentRaw, 'Orderer: John Mensah\nFacility: Walewale Hospital\n' + fulfillmentRaw]) {
    const record = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage: 'Multivitamin Syrup - 5\nParacetamol 120mg/5mL Syrup, 100mL - 5', fulfillmentConfirmation: system }, 4), {});
    assert.equal(record.generalAudit.orderer.status, 'missing from customer request');
    assert.equal(record.generalAudit.facility.status, 'missing from customer request');
    const html = renderDetails(record);
    assert.match(html, /ORDERER NAME NOT FOUND/);
    assert.match(html, /FACILITY NOT FOUND/);
  }
});

test('input edits, newer runs, and cancellation each reject a pending General Auditor result', () => {
  const run = createGeneralAuditRun(inputs, 5);
  const controller = new AbortController();
  assert.equal(isCurrentGeneralAuditRun(run, inputs, 5, controller.signal), true);
  assert.equal(isCurrentGeneralAuditRun(run, { ...inputs, whatsappMessage: inputs.whatsappMessage.replace('Isaac Awuyem', 'John Mensah') }, 5, controller.signal), false);
  assert.equal(isCurrentGeneralAuditRun(run, { ...inputs, fulfillmentConfirmation: inputs.fulfillmentConfirmation + '\nFacility: Walewale Hospital' }, 5, controller.signal), false);
  assert.equal(isCurrentGeneralAuditRun(run, inputs, 6, controller.signal), false);
  controller.abort();
  assert.equal(isCurrentGeneralAuditRun(run, inputs, 5, controller.signal), false);
});

test('the request snapshot cannot change while awaiting its server record', () => {
  const mutableInputs = { ...inputs };
  const run = createGeneralAuditRun(mutableInputs, 6);
  mutableInputs.whatsappMessage = 'Orderer: John Mensah\nORS - 2';
  assert.equal(run.inputs.whatsappMessage, customerRequestRaw);
  assert.equal(completeGeneralAuditRun(run, {}).generalAudit.orderer.whatsappValue, 'Isaac Awuyem');
});


test('orderer found in fulfillment sentence survives API completion and renders MATCH', () => {
  const run = createGeneralAuditRun({ ...inputs, fulfillmentConfirmation: 'Zipline. We have received your order for Isaac Awuyem.\n' + fulfillmentRaw }, 7);
  const record = completeGeneralAuditRun(run, legacyResponse);
  assert.equal(record.generalAudit.orderer.status, 'match');
  const html = renderDetails(record);
  assert.match(html, /System Entry: Isaac Awuyem/);
  assert.match(html, /FACILITY NOT FOUND/);
  assert.doesNotMatch(html, /ORDERER NAME MISMATCH|ORDERER NAME MISSING/);
});

test('different sentence orderer renders the current name and an orderer discrepancy', () => {
  const record = completeGeneralAuditRun(createGeneralAuditRun({ ...inputs, fulfillmentConfirmation: 'Order received for John Mensah.\n' + fulfillmentRaw }, 8), {});
  assert.equal(record.issueCount, 2);
  assert.equal(record.verdict, 'DISCREPANCY');
  const html = renderDetails(record);
  assert.match(html, /System Entry: John Mensah/);
  assert.match(html, /ORDERER NAME MISMATCH/);
  assert.match(html, /Orderer Name Mismatch/);
});


test('facility prose produces current comparison and rendered statuses despite a legacy response', () => {
  for (const [message, value, status] of [
    ['Zipline. We have received your order for delivery to Gbimsi CHPS.', 'Gbimsi CHPS', 'match'],
    ['Order received for Walewale Hospital.', 'Walewale Hospital', 'mismatch'],
    ['Zipline. We have received your order.', 'N/A', 'not available in system entry']
  ]) {
    const record = completeGeneralAuditRun(createGeneralAuditRun({ ...inputs, fulfillmentConfirmation: message + '\n' + fulfillmentRaw }, 9), legacyResponse);
    assert.equal(record.generalAudit.facility.whatsappValue, 'Gbimsi CHPS');
    assert.equal(record.generalAudit.facility.fulfillmentValue, value);
    assert.equal(record.generalAudit.facility.status, status);
    const html = renderDetails(record);
    assert.match(html, /Customer Request: Gbimsi CHPS/);
    assert.ok(html.includes(`System Entry: ${value === 'N/A' ? 'Not available' : value}`));
    if (status === 'mismatch') assert.match(html, /FACILITY NAME MISMATCH/);
    assert.doesNotMatch(html, /Facility Name Missing|FACILITY NAME MISSING FROM CUSTOMER REQUEST/);
  }
});

test('one current sentence can identify person and destination without merging them', () => {
  const record = completeGeneralAuditRun(createGeneralAuditRun({ ...inputs, fulfillmentConfirmation: 'Zipline. We have received your order for Isaac Awuyem at Gbimsi CHPS.\n' + fulfillmentRaw }, 10), legacyResponse);
  assert.equal(record.generalAudit.orderer.fulfillmentValue, 'Isaac Awuyem');
  assert.equal(record.generalAudit.facility.fulfillmentValue, 'Gbimsi CHPS');
  assert.equal(record.generalAudit.orderer.status, 'match');
  assert.equal(record.generalAudit.facility.status, 'match');
  assert.equal(record.allMatch, true);
});


test('API completion preserves an out-of-stock record without reviving a legacy quantity discrepancy', () => {
  const run = createGeneralAuditRun({ whatsappMessage: 'Facility: Gbimsi CHPS\nOrderer: Isaac Awuyem\nORS - 1', fulfillmentConfirmation: 'Facility: Gbimsi CHPS\nOrderer: Isaac Awuyem\nORS (0/1)' }, 11);
  const record = completeGeneralAuditRun(run, { ...legacyResponse, verdict: 'ORS quantity mismatch' });
  assert.equal(record.items[0].status, 'out of stock');
  assert.equal(record.items[0].found, '0');
  assert.equal(record.hasOutOfStockItems, true);
  assert.equal(record.issueCount, 0);
  assert.equal(record.verdict, 'NO DISCREPANCY');
  assert.doesNotMatch(renderDetails(record), /DISCREPANCY FOUND|MISMATCH/);
});
