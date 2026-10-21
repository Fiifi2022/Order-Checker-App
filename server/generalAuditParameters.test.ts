import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralAuditor, applyGeneralOrderLimitDecision, enforceGeneralIdentityMatches } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { servedFacilityRecords } from './generalFacilityRecords';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import GeneralAuditDetails from '../src/components/GeneralAuditDetails';
const headers = 'Name of Orderer: Kwame Mensah\nName of Health Facility: Gbimsi CHPS\n';
const optional = 'Delivery/Drop Area: Gbimsi\nDistrict: West Mamprusi\n';
const products = 'Products and Quantities:\n- Paracetamol Tablets — 10 boxes\n- Multivitamin Syrup — 5 bottles';
const support = { facilityContext: { records: [...servedFacilityRecords] } };
const audit = (customer: string, system: string, decisions = {}) => runGeneralAuditor(customer, system, decisions, support);
const html = (result: ReturnType<typeof runGeneralAuditor>) => renderToStaticMarkup(createElement(GeneralAuditDetails, { details: result.generalAudit }));

for (const [label, left, right] of [
  ['all five parameters match', optional, optional],
  ['delivery area absent from customer', 'District: West Mamprusi\n', optional],
  ['delivery area absent from fulfilment', optional, 'District: West Mamprusi\n'],
  ['district absent from customer', 'Delivery/Drop Area: Gbimsi\n', optional],
  ['district absent from fulfilment', optional, 'Delivery/Drop Area: Gbimsi\n'],
  ['both optional fields absent', '', ''],
  ['both optional fields supplied only by customer', optional, ''],
  ['both optional fields supplied only by fulfilment', '', optional],
  ['optional formatting variations', optional, 'Drop Area: GBIMSI.\nDistrict: West-Mamprusi District\n']
]) test(label, () => {
  const result = audit(headers + left + products, headers + right + products);
  assert.equal(result.allMatch, true); assert.equal(result.issueCount, 0);
  assert.equal(result.generalAudit.warnings?.length, 0);
  assert.equal(result.generalAudit.products.length, 2);
  assert.match(html(result), /Delivery\/Drop Area/); assert.match(html(result), /District/);
  assert.match(html(result), /VERIFIED MATCH/);
});

test('both optional conflicts are separate review discrepancies with their source values', () => {
  const result = audit(headers + optional + products, headers + 'Delivery/Drop Area: Walewale\nDistrict: East Mamprusi\n' + products);
  assert.equal(result.allMatch, false); assert.equal(result.generalAudit.dropArea?.status, 'mismatch');
  assert.equal(result.generalAudit.district?.status, 'mismatch'); assert.equal(result.issueCount, 2);
  assert.ok(result.insights.some(value => /Location Mismatch/.test(value)));
  assert.ok(result.insights.some(value => /District Mismatch/.test(value)));
  assert.match(html(result), /LOCATION MISMATCH/); assert.match(html(result), /DISTRICT MISMATCH/);
});

for (const side of ['customer', 'fulfilment'] as const) {
  for (const label of ['Name of Orderer', 'Name of Health Facility']) test(`missing required ${label} in ${side}`, () => {
    const missing = headers.split('\n').filter(line => !line.startsWith(label + ':')).join('\n') + products;
    const result = audit(side === 'customer' ? missing : headers + products, side === 'fulfilment' ? missing : headers + products);
    assert.equal(result.allMatch, false); assert.equal(result.issueCount, 0);
    assert.equal(result.auditSummary.missingRequiredCount, 1);
    assert.match(result.generalAudit.finalStatus, /MISSING REQUIRED INFORMATION/);
    assert.match(html(result), /MISSING REQUIRED INFORMATION/);
  });
}

test('missing orderer on both sides blocks approval; a facility is not an orderer', () => {
  const facilityOnly = 'Facility: Gbimsi CHPS\n' + products;
  for (const text of [facilityOnly, 'Orderer: Gbimsi CHPS\n' + facilityOnly, 'Orderer: Bare Name\nFacility: Bare Name\n' + products]) {
    const result = audit(text, text); assert.equal(result.allMatch, false); assert.equal(result.issueCount, 0);
    assert.equal(result.auditSummary.missingRequiredCount, 1);
  }
});

test('person in an explicit sentence is identified independently from the facility', () => {
  const result = audit('This is Kwame Mensah from Gbimsi CHPS.\n' + products, headers + products);
  assert.equal(result.generalAudit.orderer.status, 'match'); assert.equal(result.generalAudit.facility.status, 'match');
});

test('empty product lists are missing required information, never verified', () => {
  const result = audit(headers, headers); assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 0); assert.equal(result.auditSummary.missingRequiredCount, 1);
});

test('missing products and actual quantity differences retain their specific discrepancies', () => {
  const missing = audit(headers + products, headers + 'Paracetamol Tablets — 10 boxes');
  assert.equal(missing.items.find(item => item.name === 'Multivitamin Syrup')?.status, 'missing item');
  const quantity = audit(headers + products, headers + products.replace('10 boxes', '12 boxes'));
  assert.equal(quantity.items.find(item => item.name === 'Paracetamol Tablets')?.status, 'quantity mismatch');
  assert.equal(quantity.issueCount, 1);
});

test('stock and explicit order-limit exceptions remain verified when optional fields are omitted', () => {
  const left = headers + 'Multivitamin Syrup - 5';
  for (const right of ['Multivitamin Syrup [0/5]', 'Multivitamin Syrup - 3 (order limit applied)']) {
    const result = audit(left, headers + right); assert.equal(result.allMatch, true); assert.equal(result.issueCount, 0);
  }
});

test('answering an order-limit prompt cannot erase location conflicts or required-field warnings', () => {
  for (const right of [headers.replace('Name of Orderer: Kwame Mensah\n', ''), headers + 'District: East Mamprusi\n']) {
    const pending = audit(headers + optional + 'Multivitamin Syrup - 5', right + 'Multivitamin Syrup [3/5]');
    const result = applyGeneralOrderLimitDecision(pending, pending.items[0].fulfillment.key, true);
    assert.equal(result.allMatch, false);
    assert.ok(result.auditSummary.missingRequiredCount || result.generalAudit.district?.status === 'mismatch');
  }
});

test('Gemini unavailable does not affect exact products or omitted optional fields', async () => {
  let calls = 0;
  const result = await runGeneralSemanticAudit(headers + optional + products, headers + products, {}, support, () => { calls++; throw Error('Unavailable'); });
  assert.equal(result.allMatch, true); assert.equal(calls, 0); assert.equal(result.semanticAnalysis.status, 'skipped');
  const fallback = await runGeneralSemanticAudit(headers + optional + products + '\nPlease include something unusual.', headers + products, {}, support, () => { throw Error('Unavailable'); });
  assert.equal(fallback.generalAudit.dropArea?.status, 'optional not provided');
  assert.equal(fallback.generalAudit.district?.status, 'optional not provided');
  assert.equal(fallback.generalAudit.products.every(item => item.fulfillmentStatus === 'fully supplied'), true);
});

test('accepted server results cannot waive explicit location conflicts or missing source identities', () => {
  const customer = headers + optional + products;
  const system = headers.replace('Name of Orderer: Kwame Mensah\n', '') + 'District: East Mamprusi\n' + products;
  const forged = audit(headers + optional + products, headers + optional + products);
  const enforced = enforceGeneralIdentityMatches(forged, customer, system, support.facilityContext);
  assert.equal(enforced.allMatch, false); assert.equal(enforced.generalAudit.district?.status, 'mismatch');
  assert.equal(enforced.auditSummary.missingRequiredCount, 1);
  const result = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage: customer, fulfillmentConfirmation: system }, 1, {}, support, true), { ...forged, auditEngine: 'general-deterministic-v1' });
  assert.equal(result.allMatch, false); assert.equal(result.generalAudit.district?.status, 'mismatch');
});

test('district alias equivalence requires a verified mapping; similar unverified spellings conflict', () => {
  const a = headers + 'District: Test District Name\n' + products, b = headers + 'District: TDN\n' + products;
  const explicit = runGeneralAuditor(a, b, {}, { facilityContext: { districtAliases: [{ name: 'Test District Name', verifiedAliases: ['TDN'] }] } });
  assert.equal(explicit.generalAudit.district?.status, 'match');
  assert.equal(audit(a, b).generalAudit.district?.status, 'mismatch');
});

test('unavailable placeholders cannot become verified mandatory names or optional locations', () => {
  for (const value of ['N/A', 'Not available', 'Unknown', 'Not specified']) {
    const result = audit(headers.replace('Kwame Mensah', value) + `Drop Area: ${value}\n` + products,
      headers.replace('Kwame Mensah', value) + `Drop Area: ${value}\n` + products);
    assert.equal(result.allMatch, false); assert.equal(result.issueCount, 0);
    assert.equal(result.auditSummary.missingRequiredCount, 1);
    assert.equal(result.generalAudit.dropArea?.status, 'optional not provided');
  }
});

test('an unclear additional product keeps verified items while the product field needs confirmation', async () => {
  const result = await runGeneralSemanticAudit(headers + products + '\nInclude something unusual.', headers + products, {}, support, () => { throw Error('Unavailable'); });
  assert.equal(result.allMatch, false);
  const markup = html(result);
  assert.match(markup, /Products and Quantities \(mandatory\)<\/span><span class="text-amber-800">MANUAL REVIEW REQUIRED/);
  assert.ok(result.items.every(item => item.status === 'match'));
});
