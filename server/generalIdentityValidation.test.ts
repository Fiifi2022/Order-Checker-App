import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGeneralOrderLimitDecision, runGeneralAuditor } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GeneralAuditDetails from '../src/components/GeneralAuditDetails';

const customer = 'Facility: Alpha HC\nOrderer: Mary Abena Mensah\nPCM - 10';
const system = 'Facility: Beta HC\nOrderer: Jane Mensah\nPCM [5/10]';

test('facility and orderer differences are counted independently even after an order-limit Yes', () => {
  const initial = runGeneralAuditor(customer, system);
  assert.equal(initial.issueCount, 3);
  const confirmed = applyGeneralOrderLimitDecision(initial, initial.items[0].fulfillment.key, true);
  assert.equal(confirmed.items[0].status, 'order limit applied');
  assert.equal(confirmed.generalAudit.facility.status, 'mismatch');
  assert.equal(confirmed.generalAudit.orderer.status, 'mismatch');
  assert.equal(confirmed.issueCount, 2);
  assert.equal(confirmed.allMatch, false);
  assert.deepEqual(confirmed.insights, ['Orderer Name Mismatch', 'Facility Name Mismatch']);
});

test('current server responses cannot mark genuinely different raw identities as matching', () => {
  const fulfillment = system.replace('[5/10]', '[0/10]');
  const actual = runGeneralAuditor(customer, fulfillment);
  const orderer = { ...actual.generalAudit.orderer, status: 'match' as const };
  const facility = { ...actual.generalAudit.facility, status: 'match' as const };
  const record = { ...actual, issueCount: 0, allMatch: true,
    meta: { ...actual.meta, ordererName: orderer, customerName: orderer, facilityName: facility, facility },
    generalAudit: { ...actual.generalAudit, orderer, facility, discrepancies: [], finalStatus: 'CONFIRMED — NO DISCREPANCY' },
    whatsappMessage: customer, fulfillmentConfirmation: fulfillment, auditEngine: 'general-deterministic-v1' };
  const result = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage: customer, fulfillmentConfirmation: fulfillment }, 1, {}, {}, true), record);
  assert.equal(result.items[0].status, 'out of stock');
  assert.equal(result.issueCount, 2);
  assert.equal(result.allMatch, false);
  assert.equal(result.meta.facilityName.status, 'mismatch');
  assert.equal(result.meta.ordererName.status, 'mismatch');
  assert.equal(result.generalAudit.finalStatus, 'DISCREPANCY DETECTED');
  const staleSummary = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage: customer, fulfillmentConfirmation: fulfillment }, 2, {}, {}, true),
    { ...record, meta: actual.meta, generalAudit: actual.generalAudit });
  assert.equal(staleSummary.issueCount, 2);
  assert.equal(staleSummary.allMatch, false);
});

test('semantic first/surname rewriting cannot erase different complete orderer names', async () => {
  const fulfillment = 'Facility: Alpha Health Centre\nOrderer: Mary Akua Mensah\nPCM [10/10]';
  const absent = () => ({ customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 });
  const data = { facility: absent(), orderer: {
    customerRequest: { value: 'Mary Abena Mensah', sourceText: 'Orderer: Mary Abena Mensah', confidence: 0.99 },
    fulfilmentConfirmation: { value: 'Mary Akua Mensah', sourceText: 'Orderer: Mary Akua Mensah', confidence: 0.99 }, equivalent: true, confidence: 0.99 },
    customerProducts: [], fulfilmentProducts: [], possibleMissingProducts: [], possibleExtraProducts: [], semanticWarnings: [] };
  let calls = 0;
  const result = await runGeneralSemanticAudit(customer, fulfillment, {}, {}, () => ({ models: {
    async generateContent() { calls++; return { text: JSON.stringify(data) }; } } }));
  assert.equal(calls, 1);
  assert.equal(result.semanticAnalysis.status, 'used');
  assert.equal(result.generalAudit.orderer.whatsappValue, 'Mary Abena Mensah');
  assert.equal(result.generalAudit.orderer.fulfillmentValue, 'Mary Akua Mensah');
  assert.equal(result.generalAudit.orderer.status, 'mismatch');
  assert.equal(result.issueCount, 1);
  assert.equal(result.allMatch, false);
});

test('existing approved formatting aliases still match without false discrepancies', () => {
  const result = runGeneralAuditor(customer, 'Facility: Alpha Health Centre\nOrderer: Nurse Mary Mensah\nPCM [10/10]');
  assert.equal(result.generalAudit.facility.status, 'match');
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
});

const requiredRequest = 'Name of Orderer: Isaac Awuyem\nName of Health Facility: Gbimsi CHPS\nParacetamol - 5';

test('greetings independently identify the orderer and facility even when products match', () => {
  for (const [greeting, issues, ordererStatus, facilityStatus] of [
    ['Thank you Isaac Awuyem from Gbimsi CHPS ...', 0, 'match', 'match'],
    ['Thank you John Adams from Gbimsi CHPS ...', 1, 'mismatch', 'match'],
    ['Thank you Isaac Awuyem from Gambaga Health Centre ...', 1, 'match', 'mismatch'],
    ['Thank you John Adams from Gambaga Health Centre ...', 2, 'mismatch', 'mismatch']
  ] as const) {
    const result = runGeneralAuditor(requiredRequest, `${greeting}\nParacetamol [5/5]`);
    assert.equal(result.items[0].status, 'match');
    assert.equal(result.generalAudit.orderer.status, ordererStatus);
    assert.equal(result.generalAudit.facility.status, facilityStatus);
    assert.equal(result.issueCount, issues);
    assert.equal(result.allMatch, issues === 0);
    assert.equal(result.generalAudit.message, issues === 0 ? 'All audit checks passed — ready for dispatch.' :
      `${issues} discrepanc${issues === 1 ? 'y' : 'ies'} found — review before dispatch.`);
  }
});

test('identity searches cover the entire fulfillment rather than stopping at the product list', () => {
  const fulfillment = 'Your products are ready.\nParacetamol [5/5]\n\nDispatch notes:\nThank you Mr. ISAAC   AWUYEM from GBIMSI CHPS Compound.';
  const result = runGeneralAuditor(requiredRequest, fulfillment);
  assert.equal(result.issueCount, 0);
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.equal(result.generalAudit.facility.status, 'match');
});

test('explicit greeting facilities accept bare names and Hosp abbreviations without matching different places', () => {
  for (const [requested, supplied] of [['Gbimsi CHPS', 'Gbimsi'], ['Gbimsi CHPS', 'Gbimsi CHPS Compound'], ['Kade Hosp', 'Kade Hospital'], ['Kade HC', 'Kade Health Center']]) {
    const result = runGeneralAuditor(requiredRequest.replace('Gbimsi CHPS', requested), `Thank you Isaac Awuyem from ${supplied}.\nParacetamol [5/5]`);
    assert.equal(result.issueCount, 0);
  }
  const changed = runGeneralAuditor(requiredRequest, 'Thank you Isaac Awuyem from Walewale.\nParacetamol [5/5]');
  assert.equal(changed.generalAudit.facility.status, 'mismatch');
  assert.equal(changed.issueCount, 1);
});

test('missing requested identity fields require review and cannot be waived by an order limit', () => {
  for (const [identity, count] of [['', 2], ['Orderer: Isaac Awuyem', 1], ['Facility: Gbimsi CHPS', 1]] as const) {
    const result = runGeneralAuditor(requiredRequest, `${identity}\nParacetamol [3/5]`);
    assert.equal(result.issueCount, count + 1);
    const confirmed = applyGeneralOrderLimitDecision(result, result.items[0].fulfillment.key, true);
    assert.equal(confirmed.issueCount, count);
    assert.equal(confirmed.allMatch, false);
    assert.equal(confirmed.generalAudit.finalStatus, 'DISCREPANCY DETECTED');
    const html = renderToStaticMarkup(createElement(GeneralAuditDetails, { details: confirmed.generalAudit }));
    assert.match(html, /Review required/);
    assert.match(html, /Verify (?:the facility|the orderer&#x27;s name) before dispatch/);
    assert.match(html, /text-red-700/);
  }
  const stock = runGeneralAuditor(requiredRequest, 'Paracetamol [0/1]');
  assert.equal(stock.items[0].status, 'out of stock');
  assert.equal(stock.issueCount, 2); // Only the two missing identity checks.
  assert.deepEqual(stock.generalAudit.discrepancies, ['Orderer Name Not Found', 'Facility Not Found']);
});

test('accepted server responses cannot invent absent identity fields to bypass required review', () => {
  const fulfillment = 'Paracetamol [5/5]';
  const actual = runGeneralAuditor(requiredRequest, fulfillment);
  const orderer = { ...actual.generalAudit.orderer, fulfillmentValue: 'Isaac Awuyem', status: 'match' as const };
  const facility = { ...actual.generalAudit.facility, fulfillmentValue: 'Gbimsi CHPS', status: 'match' as const };
  const response = { ...actual, allMatch: true, issueCount: 0, generalAudit: { ...actual.generalAudit, orderer, facility },
    auditEngine: 'general-deterministic-v1', whatsappMessage: requiredRequest, fulfillmentConfirmation: fulfillment };
  const result = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage: requiredRequest, fulfillmentConfirmation: fulfillment }, 1, {}, {}, true), response);
  assert.equal(result.issueCount, 2);
  assert.equal(result.allMatch, false);
  assert.equal(result.generalAudit.orderer.fulfillmentValue, 'N/A');
  assert.equal(result.generalAudit.facility.fulfillmentValue, 'N/A');
});
