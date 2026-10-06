import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runGeneralAuditor, normalizeGeneralProductName } from './generalAuditor';
import catalogue from '../src/utils/generalPackagingCatalogue.json';
import { generalAuditAnalytics, generalRuleDiagnostics } from './generalAuditMonitoring';

test('packaging snapshot contains only existing approved catalogue entries', () => {
  const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const section = source.split('Official Product Internal Quantities Catalog')[1].split('Audit Verification Rules')[0];
  const entries = [...section.matchAll(/\* "(.+?)": (\d+)/g)].map(match => ({ name: match[1].replace(/\\"/g, '"'), internalQuantity: Number(match[2]) }));
  assert.deepEqual(catalogue, entries.slice(0, catalogue.length));
});
test('approved conversions compare equivalent quantities and preserve explicit units', () => {
  for (const [customer, system] of [['ORS - 1 box', 'ORS - 25 units'], ['ORS - 25 units', 'ORS - 1 box']]) {
    const result = runGeneralAuditor(customer, system);
    assert.equal(result.allMatch, true); assert.equal(result.generalAudit.products[0].conversion?.factor, 25);
  }
  for (const [customer, system] of [['Product A - 1 box', 'Product A - 25 units'], ['ORS - 1 box', 'ORS - 25 boxes'], ['Amoxicillin 250mg Capsule - 1 box', 'Amoxicillin 250mg Capsule - 100 capsules']]) {
    const result = runGeneralAuditor(customer, system); assert.equal(result.allMatch, false); assert.equal(result.generalAudit.products[0].conversion, undefined);
  }
});
test('converted shortages are discrepancies until a limit is confirmed', () => {
  const result = runGeneralAuditor('ORS - 1 box', 'ORS - 20 units');
  assert.equal(result.generalAudit.pendingOrderLimitCount, 0);
  assert.equal(result.issueCount, 1);
  const approved = runGeneralAuditor('ORS - 1 box', 'ORS - 20 units', { [normalizeGeneralProductName('ORS')]: true });
  assert.equal(approved.allMatch, true); assert.equal(approved.generalAudit.products[0].difference, 5);
  const excess = runGeneralAuditor('ORS - 1 box', 'ORS - 30 units', { [normalizeGeneralProductName('ORS')]: true });
  assert.equal(excess.issueCount, 1); assert.equal(excess.generalAudit.pendingOrderLimitCount, 0);
});
test('Ghana phone formatting matches, missing is optional, different numbers fail', () => {
  const customer = 'Phone: 0241234567\nORS - 5';
  for (const phone of ['+233241234567', '00233 24 123 4567', '024-123-4567']) assert.equal(runGeneralAuditor(customer, `Phone: ${phone}\nORS - 5`).allMatch, true, phone);
  assert.equal(runGeneralAuditor(customer, 'ORS - 5').allMatch, true);
  const different = runGeneralAuditor(customer, 'Phone: 0241234568\nORS - 5');
  assert.equal(different.generalAudit.phone.status, 'mismatch'); assert.equal(different.issueCount, 1);
});
test('aliases preserve clinical strengths and forms', () => {
  for (const [left, right] of [['PCM', 'Paracetamol'], ['Amox', 'Amoxicillin'], ['ORS', 'Oral Rehydration Salts'], ['ACT/AL', 'Coartem'], ['Coartem 20/120mg Tablet', 'Artemether/Lumefantrine 20/120mg Tablet']]) assert.equal(runGeneralAuditor(`${left} - 5`, `${right} - 5`).allMatch, true);
  for (const [left, right] of [['PCM 500mg Tablet', 'Paracetamol 250mg Tablet'], ['Amox 250mg Capsule', 'Amoxicillin 250mg Syrup']]) assert.equal(runGeneralAuditor(`${left} - 5`, `${right} - 5`).issueCount, 2);
});
test('facility locality and orderer identities normalize without accepting different identities', () => {
  const customer = 'Facility: Vea Health Centre\nOrderer: Mary A. Mensah\nORS - 5';
  const supplied = 'Facility: VEA Hospital\nOrderer: Nurse Mary Mensah\nORS - 5';
  assert.equal(runGeneralAuditor(customer, supplied).allMatch, true);
  assert.equal(runGeneralAuditor(customer, supplied.replace('VEA Hospital', 'Kade Hospital')).generalAudit.facility.status, 'mismatch');
  assert.equal(runGeneralAuditor(customer, supplied.replace('Mary Mensah', 'Jane Mensah')).generalAudit.orderer.status, 'mismatch');
});
test('OSU is supporting evidence and never adds products or overrides actual quantities', () => {
  const positive = runGeneralAuditor('ORS - 5', 'ORS - 5', {}, { osuItems: ['ORS', 'Amoxicillin'] });
  assert.equal(positive.allMatch, true); assert.equal(positive.generalAudit.products.length, 1);
  assert.equal(positive.generalAudit.products[0].registeredOutOfStock, true);
  assert.equal(positive.generalAudit.products[0].fulfillmentStatus, 'fully supplied');
  assert.equal(runGeneralAuditor('ORS - 5', 'ORS (0/5)').generalAudit.finalStatus, 'OUT OF STOCK — CONFIRMED');
});
test('General analytics exclude vaccine, demo, and legitimate shortages from discrepancy rates', () => {
  const record = (id: string, request: string, supplied: string, extra = {}) => ({ id, ...runGeneralAuditor(request, supplied), durationSec: 2, ...extra });
  const rows = [record('stock', 'ORS - 1', 'ORS (0/1)'), record('error', 'ORS - 1', 'ORS - 2', { status: 'resolved' }), record('limit', 'ORS - 2', 'ORS - 1 (order limit applied)'), record('demo', 'ORS - 1', 'ORS - 2', { isDemo: true }), { id: 'vaccine', auditScope: 'vaccine_checker' }];
  const metrics = generalAuditAnalytics(rows);
  assert.equal(metrics.totalAudits, 3); assert.equal(metrics.discrepancyRate, 33.3); assert.equal(metrics.successfulAudits, 2); assert.equal(metrics.resolutionRate, 100); assert.equal(metrics.pendingOrderLimitAudits, 0);
  assert.ok(generalRuleDiagnostics().every(row => row.ok));
});

test('a full mixed order distinguishes metadata, missing, extra and quantity errors from stock', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { default: Summary } = await import('../src/components/GeneralFulfillmentSummary');
  const result = runGeneralAuditor('Facility: Vea HC\nProduct A - 1\nProduct B - 1\nProduct C - 1', 'Facility: Kade Hospital\nProduct A (0/1)\nProduct C - 2\nProduct D - 1');
  assert.equal(result.generalAudit.finalStatus, 'DISCREPANCY DETECTED');
  assert.equal(result.generalAudit.counts.outOfStock, 1);
  assert.equal(result.generalAudit.products.filter(row => row.fulfillmentStatus === 'discrepancy').length, 3);
  const html = renderToStaticMarkup(createElement(Summary, { details: result.generalAudit }));
  for (const label of ['Metadata Discrepancies', 'Missing Products', 'Extra Products', 'Quantity Discrepancies', 'Out of Stock']) assert.ok(html.includes(label));
  assert.ok(html.indexOf('Quantity Discrepancies') < html.indexOf('Out of Stock'));
});
