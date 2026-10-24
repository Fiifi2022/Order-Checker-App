import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyCatalog, defaultProducts } from './productCatalog';
import { runGeneralAuditor, applyGeneralProductConfirmation, normalizeGeneralProductName } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { generalProductResults, generalAuditResult } from '../src/utils/generalProductResults';
import Inventory from '../src/components/GeneralInventory';
import AuditDetails from '../src/components/GeneralAuditDetails';
import { buildGeneralReport } from '../extension/general-report.js';
const header = 'Orderer: John Mensah\nFacility: Alpha HC\n';
const clinicalNames = ['Diclofenac 25mg/5mL Injection', 'Diclofenac 25mg/mL Injection, 3mL'];
function seed() { applyCatalog({ revision: 1001, products: [...defaultProducts(), ...clinicalNames.map((name, index) => ({ id: `result-${index}`, name, scope: 'general' as const, category: 'medicine', aliases: [], contextualAliases: [], note: '' }))] }); }
function audit(a: string, b: string, limits = {}) { seed(); return runGeneralAuditor(header + a, header + b, limits); }
function markup(record: ReturnType<typeof audit>) { return renderToStaticMarkup(createElement(Inventory, { items: record.items, details: record.generalAudit, onOrderLimit() {} })).replace(/<!--.*?-->/g, ''); }
const rows = (record: ReturnType<typeof audit>) => generalProductResults(record.items, record.generalAudit);
const forbidden = /Dosage \/ formulation|Confirm Dosage|Confirmed formulation|data-confirm-product|data-review-key|<select|customer-contact|Product \d+|Quantity Discrepancy|Product Discrepancy/;
for (const [name, customer, fulfillment, status, expected] of [
  ['exact product and quantity match', 'Multivitamin Syrup [5]', 'Multivitamin Syrup [5/5]', 'MATCH', undefined],
  ['verified abbreviation', 'ORS [5]', 'Oral Rehydration Salts [5/5]', 'MATCH', undefined],
  ['missing product', 'Multivitamin Syrup [5]\nORS [2]', 'ORS [2/2]', 'MISSING PRODUCT', /requested 5 units.*not found/],
  ['extra product', 'ORS [2]', 'ORS [2/2]\nMultivitamin Syrup [5/5]', 'EXTRA PRODUCT', /5 units.*without a corresponding customer request/],
  ['pending order limit', 'ORS [10]', 'ORS [5/10]', 'ORDER LIMIT REVIEW', /Shortfall: 5 units.*approved order limit/],
  ['quantity excess', 'ORS [5]', 'ORS [8/5]', 'QUANTITY EXCESS', /Excess: 3 units/],
] as const) {
  test(`shared product status and explanation: ${name}`, () => {
    const record = audit(customer, fulfillment); const result = rows(record).find(row => row.status === status)!;
    assert.ok(result); if (status === 'EXTRA PRODUCT') { assert.equal(result.requestedQuantity, 0); assert.equal(result.suppliedQuantity, 5); } if (expected) assert.match(result.reason!, expected); else assert.equal(result.reason, undefined);
    for (const html of [markup(record), buildGeneralReport(record)]) { assert.match(html, new RegExp(status)); assert.doesNotMatch(html, forbidden); }
  });
}
test('successful cards contain only one green result and no warning or redundant explanation', () => {
  const record = audit('Multivitamin Syrup [5]', 'Multivitamin Syrup [5/5]');
  for (const html of [markup(record), buildGeneralReport(record)]) {
    const card = html.match(/<article\b[\s\S]*?<\/article>/)![0];
    assert.equal((card.match(/role="status"/g) || []).length, 1);
    assert.match(card, /MATCH.*Product and quantity verified/); assert.doesNotMatch(card, /Reason:|Difference:|No discrepancy|identical|<details|<button|<input|<select/);
  }
  assert.equal(generalAuditResult(record.items, record.generalAudit, record.allMatch).title, 'AUDIT PASSED');
});
test('a missing product does not create a separate quantity discrepancy or duplicate warning', () => {
  const record = audit('Multivitamin Syrup [5]\nORS [2]', 'ORS [2/2]'); const result = rows(record);
  assert.equal(result.filter(row => row.status === 'MISSING PRODUCT').length, 1);
  assert.equal(result.filter(row => row.status === 'SHORTFALL' || row.status === 'QUANTITY EXCESS').length, 0);
  assert.equal((buildGeneralReport(record).match(/not found in the Fulfilment Confirmation/g) || []).length, 1);
  assert.equal(generalAuditResult(record.items, record.generalAudit, false).title, 'DISCREPANCY DETECTED');
});
test('a declined order limit explains the independent shortfall; an approved limit is recorded as verified', () => {
  const key = normalizeGeneralProductName('ORS');
  const declined = audit('ORS [10]', 'ORS [5/10]', { [key]: false });
  assert.equal(rows(declined)[0].status, 'SHORTFALL'); assert.match(rows(declined)[0].reason!, /Shortfall: 5 units.*No order limit/);
  const approved = audit('ORS [10]', 'ORS [5/10]', { [key]: true });
  assert.equal(rows(approved)[0].status, 'VERIFIED'); assert.match(rows(approved)[0].reason!, /Approved order limit recorded/);
  assert.match(markup(approved), /text-green-700/); assert.doesNotMatch(markup(approved), /Was an Order Limit/);
  assert.equal(generalAuditResult(approved.items, approved.generalAudit, approved.allMatch).title, 'AUDIT PASSED');
});
test('different concentrations remain clinical mismatches without a formulation confirmation panel', () => {
  const record = audit('Inj. ' + clinicalNames[0] + ' [7]', clinicalNames[1] + ' [7/7]');
  const result = rows(record); assert.equal(result.length, 1); assert.equal(result[0].status, 'PRODUCT DETAILS MISMATCH');
  assert.equal(result[0].requestedQuantity, 7); assert.equal(result[0].suppliedQuantity, 7);
  assert.match(result[0].reason!, /concentration/);
  for (const html of [markup(record), buildGeneralReport(record)]) { assert.doesNotMatch(html, forbidden); assert.match(html, /PRODUCT DETAILS MISMATCH/); assert.doesNotMatch(html, /Product and quantity verified/); }
  assert.equal(record.generalAudit.productVerifications?.[0].confirmation, undefined);
});
test('a unique conflicting strength is explained once rather than as unrelated missing and extra products', () => {
  const record = audit('Paracetamol 500mg Tablet [5]', 'Paracetamol 250mg Tablet [5/5]');
  const result = rows(record); assert.equal(result.length, 1); assert.equal(result[0].status, 'PRODUCT DETAILS MISMATCH');
  assert.match(result[0].reason!, /cannot be treated as equivalent/);
  assert.equal((markup(record).match(/<article/g) || []).length, 1);
  assert.equal(record.allMatch, false);
});
test('an uncertain or failed fulfilment extraction cannot be labelled a missing product', async () => {
  seed();
  const raw = audit('Multivitamin Syrup [5]', 'unreadable fulfilment text');
  assert.equal(rows(raw)[0].status, 'REVIEW REQUIRED'); assert.match(rows(raw)[0].reason!, /incomplete|unreadable/);
  const result = await runGeneralSemanticAudit(header + 'Multivitamin Syrup [5]', header + 'unreadable fulfilment text', {}, { semanticTimeoutMs: 0 }, () => { throw Error('offline'); });
  assert.equal(result.allMatch, false); assert.ok(!rows(result).some(row => row.status === 'MISSING PRODUCT'));
  assert.equal(generalAuditResult(result.items, result.generalAudit, result.allMatch).title, 'REVIEW REQUIRED');
});
test('unresolved fulfilment candidates block a false missing result even when another line is readable', () => {
  const record = audit('Multivitamin Syrup [5]', 'ORS [2/2]');
  record.generalAudit.semanticReviews = [{ source: 'fulfillment_confirmation', kind: 'unparsed_text', field: 'products', originalText: 'mult vit syr unclear', possibleMatches: ['Multivitamin Syrup'], reason: 'Unclear product name' }];
  assert.equal(rows(record).find(row => row.requested.length)!.status, 'REVIEW REQUIRED');
});
test('historical confirmations remain intact while their obsolete controls stay absent', () => {
  const record = audit('Paracetamol 500mg [7]', 'Paracetamol 500mg Tablet [7/7]');
  const target = record.generalAudit.productVerifications![0];
  const saved = applyGeneralProductConfirmation(record, target.key, target.options.find(option => option.fromFulfillment)!.key, true, { id: 'cca', name: 'CCA' }, '2026-10-24T12:00:00Z');
  const before = JSON.stringify(saved); assert.equal(rows(saved)[0].status, 'MATCH');
  assert.equal(rows(saved)[0].customer, 'Paracetamol 500mg');
  for (const html of [markup(saved), buildGeneralReport(saved)]) assert.doesNotMatch(html, forbidden);
  assert.equal(JSON.stringify(saved), before); assert.equal(saved.generalAudit.productVerifications![0].confirmation!.confirmedBy!.id, 'cca');
});
test('mixed orders share summary and card statuses without repeating detailed explanations elsewhere', () => {
  const record = audit('ORS [2]\nMultivitamin Syrup [5]\nParacetamol 500mg Tablet [10]', 'ORS [2/2]\nParacetamol 500mg Tablet [5/10]');
  assert.deepEqual(rows(record).map(row => row.status), ['MATCH', 'MISSING PRODUCT', 'ORDER LIMIT REVIEW']);
  const html = renderToStaticMarkup(createElement(AuditDetails, { items: record.items, details: record.generalAudit }));
  assert.doesNotMatch(html, /not found in the Fulfilment Confirmation|DISCREPANCY FOUND/);
  assert.equal(generalAuditResult(record.items, record.generalAudit, false).title, 'DISCREPANCY DETECTED');
  const quantityOnly = audit('ORS [10]', 'ORS [5/10]');
  assert.equal(generalAuditResult(quantityOnly.items, quantityOnly.generalAudit, false).title, 'QUANTITY VERIFICATION REQUIRED');
  assert.match(buildGeneralReport(quantityOnly), /class="verdict-pending"/);
});
test('AI-assisted recognition remains bounded and cannot clear an unresolved identity', async () => {
  seed(); const record = audit('Paracetamol 500mg [7]', 'Paracetamol 500mg Tablet [7/7]');
  const target = record.generalAudit.productVerifications![0]; target.kind = 'ai product match';
  assert.equal(rows(record)[0].status, 'REVIEW REQUIRED');
  assert.doesNotMatch(markup(record), /Product and quantity verified/); assert.equal(record.allMatch, false);
});

test('clinical review for one known product never downgrades unrelated genuine missing or extra products', () => {
  const record = audit('Inj. ' + clinicalNames[0] + ' [7]\nParacetamol 500mg Tablet [3]', clinicalNames[1] + ' [7/7]\nAmoxicillin 500mg Capsule [2/2]');
  const statuses = rows(record).map(row => row.status);
  assert.ok(statuses.includes('PRODUCT DETAILS MISMATCH'));
  assert.ok(statuses.includes('MISSING PRODUCT'));
  assert.ok(statuses.includes('EXTRA PRODUCT'));
  assert.ok(!statuses.includes('REVIEW REQUIRED'));
});
test('out-of-stock entries remain identified and receive one shortfall explanation', () => {
  const record = audit('ORS [10]', 'ORS [0/10]');
  assert.equal(rows(record)[0].status, 'SHORTFALL'); assert.match(rows(record)[0].reason!, /out of stock/);
  assert.doesNotMatch(markup(record), /MISSING PRODUCT|Was an Order Limit/);
});
