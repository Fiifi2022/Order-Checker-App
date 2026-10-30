import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {runGeneralAuditor, applyGeneralOrderLimitDecision, summarizeGeneralProducts} from './generalAuditor';
import {createGeneralAuditRun, completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import Details from '../src/components/GeneralAuditDetails';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog} from '../shared/productCatalog';
import {generalAuditHistory} from './generalAuditMonitoring';

const catalog: ProductCatalog = {revision: 1200, products: [
  {id: 'rdt', name: 'Malaria Rapid Diagnostic Test Kit', scope: 'general', aliases: ['RDT'], contextualAliases: [], category: 'diagnostic', note: ''},
  {id: 'pcm', name: 'Paracetamol 500mg Tablet', scope: 'general', aliases: ['PCM'], contextualAliases: [], category: 'medicine', note: ''},
]};
const context = {records: [{name: 'Example Health Centre', district: 'North', verifiedAliases: ['Example HC'], id: 'example', source: 'test/example'},
  {name: 'Other Health Centre', id: 'other', source: 'test/other'}]};
const header = 'Orderer: Grace Akabati\nFacility: Example HC\n';
const customer = header + 'RDT 5', fulfillment = header + 'Malaria Rapid Diagnostic Test Kit [5/5]';
const audit = async (a = customer, b = fulfillment) => {
  applyCatalog(catalog);
  return runGeneralProductNameAudit(a, b, catalog, {facilityContext: context, semanticTimeoutMs: 0}, () => {throw Error('No Gemini expected');});
};

for (const [label, left, right] of [
  ['district', 'District: North', 'District: South'],
  ['dropsite', 'Dropsite: Gate one', 'Dropsite: Gate two'],
  ['delivery area', 'Delivery/Drop area: Front gate', 'Delivery/Drop area: Back gate'],
  ['phone and dates', 'Phone: 0241234567\nDate: 30/10/2026', 'Phone: 0209998888\nDate: 01/11/2026'],
  ['coordinates', 'GPS: 10.57, -0.21', 'GPS: 7.98, -1.92'],
  ['IDs and tracking', 'Order ID: AAA123\nTracking link: https://example.test/a', 'Order ID: BBB999\nTracking link: https://example.test/b'],
  ['patient data', 'Patient name: Mary\nAge: 19\nSex: Female\nMedical history: Hypertension', 'Patient name: John\nAge: 50\nSex: Male'],
  ['instructions', 'Delivery instructions: Leave at the front gate', 'Delivery instructions: Call on arrival'],
] as const) test(`${label} never affects four-parameter verdict, warnings or confidence`, async () => {
  const baseline = await audit(), result = await audit(customer + '\n' + left, fulfillment + '\n' + right);
  assert.equal(result.allMatch, true, JSON.stringify(result.generalAudit));
  assert.equal(result.issueCount, 0);
  assert.equal(result.generalAudit.finalStatus, 'NO DISCREPANCY');
  assert.equal(result.confidence, baseline.confidence);
  assert.deepEqual(result.generalAudit.warnings, baseline.generalAudit.warnings);
  assert.deepEqual(result.generalAudit.semanticReviews, baseline.generalAudit.semanticReviews);
});

for (const [label, a, b] of [
  ['facility', customer.replace('Example HC', 'Other Health Centre'), fulfillment],
  ['orderer', customer.replace('Grace Akabati', 'Mary Mensah'), fulfillment],
  ['missing', customer + '\nPCM 2', fulfillment],
  ['extra', customer, fulfillment + '\nParacetamol 500mg Tablet [2/2]'],
  ['quantity', customer, fulfillment.replace('[5/5]', '[6/6]')],
] as const) test(`confirmed ${label} mismatch remains a discrepancy`, async () => {
  const result = await audit(a, b);
  assert.equal(result.allMatch, false);
  assert.ok(result.issueCount > 0);
  assert.equal(result.generalAudit.finalStatus, 'DISCREPANCY DETECTED');
});

test('missing compulsory identity requires review; a simultaneous confirmed mismatch is retained', async () => {
  const missing = await audit(customer.replace('Orderer: Grace Akabati\n', ''), fulfillment);
  assert.equal(missing.generalAudit.finalStatus, 'REVIEW REQUIRED');
  assert.equal(missing.issueCount, 0);
  const combined = await audit(customer.replace('Orderer: Grace Akabati\n', ''), fulfillment.replace('[5/5]', '[6/6]'));
  assert.equal(combined.generalAudit.finalStatus, 'DISCREPANCY DETECTED');
  assert.ok(combined.generalAudit.auditSummary.reviewRequiredCount! > 0);
});

test('zero/partial stockouts and approved order limits remain operational exceptions', async () => {
  for (const text of ['Malaria Rapid Diagnostic Test Kit [0/1]', 'Malaria Rapid Diagnostic Test Kit [3/5] — partially out of stock']) {
    const result = await audit(customer, header + text);
    assert.equal(result.allMatch, true); assert.equal(result.generalAudit.finalStatus, 'NO DISCREPANCY');
    assert.equal(result.generalAudit.counts.outOfStock, 1);
  }
  const pending = await audit(customer, fulfillment.replace('[5/5]', '[3/5]'));
  const approved = applyGeneralOrderLimitDecision(pending, 'rdt', true);
  assert.equal(approved.allMatch, true); assert.equal(approved.generalAudit.finalStatus, 'NO DISCREPANCY');
});

test('mixed optional metadata retains both product additions and explicit amendments', async () => {
  for (const text of ['Delivery instructions: Front gate, please add PCM 2', 'Please deliver to the front gate with PCM 2', 'District: North; PCM 2']) {
    const result = await audit(customer + '\n' + text, fulfillment);
    assert.equal(result.allMatch, false, text);
    assert.ok(result.items.some(item => item.provenance.some(source => /PCM/.test(source.name))), text);
  }
  const amendment = await audit(customer + '\nDistrict: North, increase the quantity of RDT from 5 to 10.', fulfillment);
  assert.equal(amendment.allMatch, false);
  assert.ok(amendment.generalAudit.semanticReviews?.some(review => /increase.*RDT/i.test(review.originalText)));
});

test('backend completion, stored JSON and both interfaces retain exactly the four compulsory decisions', async () => {
  const input = {whatsappMessage: customer + '\nDistrict: North\nDropsite: Gate 1', fulfillmentConfirmation: fulfillment + '\nDistrict: South\nDropsite: Gate 2'};
  const backend = await audit(input.whatsappMessage, input.fulfillmentConfirmation);
  const stored = JSON.parse(JSON.stringify({...backend, ...input}));
  const accepted = completeGeneralAuditRun(createGeneralAuditRun(input, 1, {}, {facilityContext: context}, true), stored);
  assert.equal(accepted.allMatch, true); assert.equal(accepted.generalAudit.finalStatus, 'NO DISCREPANCY');
  for (const html of [renderToStaticMarkup(createElement(Details, {details: accepted.generalAudit})), buildGeneralReport(accepted)]) {
    assert.match(html, /Products/); assert.match(html, /Quantities/);
    assert.doesNotMatch(html, /District|Dropsite|Delivery.*Drop area|Phone|Date|GPS/);
  }
  const legacy = runGeneralAuditor(customer, fulfillment);
  const ignored = {whatsappValue: 'A', fulfillmentValue: 'B', status: 'mismatch' as const};
  const rebuilt = summarizeGeneralProducts(legacy.items, legacy.generalAudit.facility, legacy.generalAudit.orderer,
    ignored, 1, 1, [{field: 'facilityName', source: 'customer_request', originalText: 'District: Another district', possibleMatches: [], reason: 'Legacy warning'}],
    {...legacy.generalAudit, dropArea: ignored, district: ignored});
  assert.equal(rebuilt.allMatch, true);
  assert.equal(rebuilt.confidence, accepted.confidence);
  assert.equal(rebuilt.issueCount, 0);
  const legacyStored = {...stored, id: 'legacy-audit', allMatch: false, issueCount: 2, confidence: 50,
    generalAudit: {...stored.generalAudit, finalStatus: 'DISCREPANCY DETECTED',
      dropArea: ignored, district: ignored, discrepancies: ['District Mismatch', 'Location Mismatch — Delivery/Drop Area'],
      warnings: ['District differs.'], semanticReviews: [{field: 'facilityName', source: 'customer_request', originalText: 'District: North', possibleMatches: [], reason: 'District differs.'}]}};
  const history = generalAuditHistory([legacyStored]);
  assert.equal(history[0].allMatch, true); assert.equal(history[0].issueCount, 0); assert.equal(history[0].confidence, 100);
  assert.equal(history[0].generalAudit.finalStatus, 'NO DISCREPANCY');
  assert.equal(legacyStored.issueCount, 2, 'History projection must not rewrite the original saved record');
});
