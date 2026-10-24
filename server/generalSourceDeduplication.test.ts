import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyCatalog, defaultProducts } from './productCatalog';
import { runGeneralAuditor, parseGeneralProducts, normalizeGeneralProductName, prepareGeneralProductComparison, enforceGeneralProductAssignments, applyGeneralProductConfirmation } from './generalAuditor';
import { canonicalizeGeneralEvidence, generalEvidenceOrigin } from '../src/utils/generalProductEvidence';
import { matchGeneralClinicalProducts } from '../src/utils/generalProductMatching';
import { restoreGeneralProductConfirmations } from '../src/utils/generalProductConfirmationPersistence';
import { generalProductHeading } from '../src/utils/generalProductHeading';
import { generalInventoryRows } from '../src/utils/generalInventoryRows';
import Inventory from '../src/components/GeneralInventory';
import { buildGeneralReport } from '../extension/general-report.js';
import { generalProductConfirmationHandler } from './generalProductConfirmation';

const headers = 'Orderer: John Mensah\nFacility: Alpha HC\n';
const names = ['Diclofenac 25mg/5mL Injection', 'Diclofenac 25mg/mL Injection, 3mL'];
const products = [...defaultProducts(), ...names.map((name, i) => ({ id: `source-fixture-${i}`, name, scope: 'general' as const, category: 'medicine', aliases: [], contextualAliases: [], note: '' }))];
function seed() { applyCatalog({ revision: 500, products }); }
const match = (a: string, b: string) => matchGeneralClinicalProducts(a, b, normalizeGeneralProductName);
function fixture() {
  seed(); const whatsappMessage = headers + 'Inj. Diclofenac 25mg/5mL Injection [7]';
  const fulfillmentConfirmation = headers + 'Diclofenac 25mg/mL Injection, 3mL [7/7]';
  return { ...runGeneralAuditor(whatsappMessage, fulfillmentConfirmation), whatsappMessage, fulfillmentConfirmation, id: 'dedup-audit', auditEngine: 'general-deterministic-v1' };
}
for (const [left, right] of [['Inj. Diclofenac 25mg/5mL Injection', names[0]], ['Injection Artesunate 120mg', 'Artesunate 120mg Injection'], ['ARTEsunate 120mg Inj.', 'Injection Artesunate 120 mg'], ['PCM Tabs 500mg', 'Paracetamol 500mg Tablet']] as const) {
  test(`clinical formatting alone creates no confirmation: ${left}`, () => {
    seed(); const result = runGeneralAuditor(headers + left + ' [7]', headers + right + ' [7/7]');
    assert.equal(result.items.length, 1); assert.equal(result.items[0].status, 'match'); assert.equal(result.generalAudit.productVerifications?.length || 0, 0);
  });
}
test('multiple extraction methods recognize one source entry without adding its quantity', () => {
  seed(); const source = parseGeneralProducts(headers + 'Inj. Diclofenac 25mg/5mL Injection [7]', 'customer_request')[0];
  const gemini = { ...source, name: names[0], normalizedName: normalizeGeneralProductName(names[0]), extractionProvenance: [{ method: 'gemini', name: names[0], originalText: source.originalText, line: source.line }] };
  const entries = canonicalizeGeneralEvidence([source, gemini, source], match);
  assert.equal(entries.length, 1); assert.equal(entries[0].quantity, 7); assert.equal(entries[0].extractionProvenance?.length, 2);
  const supplied = parseGeneralProducts(headers + names[1] + ' [7/7]', 'fulfillment_confirmation');
  const compared = prepareGeneralProductComparison([source, gemini], [...supplied, ...supplied]);
  assert.equal(compared.items.length, 0); assert.equal(compared.verifications.length, 1); assert.equal(compared.verifications[0].requestedQuantity, 7); assert.equal(compared.verifications[0].suppliedQuantity, 7);
});
test('two genuine repeated order lines retain separate IDs and all requested quantities', () => {
  seed(); const request = headers + '1 Paracetamol 500mg 10/10\n2 Paracetamol 500mg 20/20';
  const result = runGeneralAuditor(request, headers + 'Paracetamol 500mg [30/30]');
  const entries = result.generalAudit.sourceEntries!.filter(source => source.source === 'customer_request');
  assert.equal(entries.length, 2); assert.equal(new Set(entries.map(generalEvidenceOrigin)).size, 2);
  assert.deepEqual(entries.map(source => source.quantity), [10, 20]); assert.equal(result.generalAudit.productVerifications?.[0].requestedQuantity ?? result.items[0]?.fulfillment.requested, 30);
  assert.equal(result.generalAudit.productCount.requested, 2);
  const identical = parseGeneralProducts('Paracetamol 500mg [10]\nParacetamol 500mg [10]', 'customer_request');
  assert.equal(canonicalizeGeneralEvidence([...identical, identical[0]], match).length, 2);
});
test('different clinical details, quantities, documents and unbound lines cannot be deduplicated', () => {
  seed(); const source = parseGeneralProducts('PCM 500mg Tablet [7]', 'customer_request')[0];
  for (const candidate of [
    { ...source, name: 'Paracetamol 250mg Tablet' }, { ...source, name: 'Paracetamol 500mg Injection' },
    { ...source, quantity: 8 }, { ...source, sourceEntryId: 'other-span' }, { ...source, documentId: 'other-document' },
    { ...source, sourceEntryId: undefined, sourceLineId: undefined, sourceSpan: undefined, line: 99 },
  ]) assert.equal(canonicalizeGeneralEvidence([source, candidate], match).length, 2);
});
function duplicated() {
  const record = fixture(); const product = record.generalAudit.productVerifications![0];
  const aiSource = { ...product.requestedProducts[0], sourceEntryId: undefined, name: names[0], normalizedName: normalizeGeneralProductName(names[0]), originalText: names[0] + ' [7]' };
  const candidate = { ...product, key: 'temporary-gemini-key', productName: names[0], requestedProducts: [aiSource], originalText: aiSource.originalText };
  const missing = runGeneralAuditor(headers + names[0] + ' [7]', headers + 'ORS [1/1]').items.find(item => item.status === 'missing item')!;
  return { ...record, items: [missing], generalAudit: { ...record.generalAudit, productVerifications: [product, candidate], semanticReviews: [...(record.generalAudit.semanticReviews || []), { ...record.generalAudit.semanticReviews![0], originalText: candidate.originalText, dosageFormKey: candidate.key }], productCount: { requested: 2, found: 1, status: 'mismatch' as const } } };
}
test('legacy deterministic and Gemini candidates become one canonical review, card and summary', () => {
  const record = duplicated(); const result = enforceGeneralProductAssignments(record, record.whatsappMessage, record.fulfillmentConfirmation);
  assert.equal(result.generalAudit.productVerifications?.length, 1); assert.equal(result.items.length, 0);
  assert.equal(result.generalAudit.productCount.requested, 1); assert.equal(result.generalAudit.productCount.found, 1);
  assert.equal(result.generalAudit.semanticReviews?.filter(review => review.dosageFormKey).length, 1);
  assert.equal(result.generalAudit.auditSummary?.reviewRequiredCount, 1);
  const product = result.generalAudit.productVerifications![0];
  assert.equal(product.requestedQuantity, 7); assert.equal(product.suppliedQuantity, 7);
  assert.equal(generalInventoryRows(result.items, result.generalAudit).length, 1);
  const app = renderToStaticMarkup(createElement(Inventory, { items: result.items, details: result.generalAudit, onOrderLimit() {} }));
  const extension = buildGeneralReport(result);
  assert.equal((app.match(/<article/g) || []).length, 1); assert.equal((extension.match(/<article/g) || []).length, 1);
  assert.match(app, /Requested: 7/); assert.match(extension, /Fulfilled: 7/);
  assert.match(app, /PRODUCT DETAILS MISMATCH/); assert.doesNotMatch(app, /Confirm Dosage|<select/); assert.doesNotMatch(app, /Product \d+ —/); assert.doesNotMatch(extension, /Product \d+ —/);
  assert.match(app, /<h4[^>]*>Diclofenac 25mg\/5mL Injection<\/h4>/);
});
test('duplicate source confirmations save once and immediately update one canonical record', async () => {
  let stored = duplicated(); let saves = 0;
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async value => { stored = value; saves++; } });
  const canonical = enforceGeneralProductAssignments(stored, stored.whatsappMessage, stored.fulfillmentConfirmation);
  const target = canonical.generalAudit.productVerifications![0]; const selected = target.options.find(option => option.fromFulfillment)!;
  let status = 200, response: any;
  await handler({ params: { id: stored.id }, body: { key: 'temporary-gemini-key', productKey: selected.key, customerContactConfirmed: true, whatsappMessage: stored.whatsappMessage, fulfillmentConfirmation: stored.fulfillmentConfirmation } } as any, { locals: { authUser: { id: 'cca', name: 'CCA' } }, status(code: number) { status = code; return this; }, json(value: any) { response = value; } } as any, () => {});
  assert.equal(status, 200); assert.equal(saves, 1); assert.equal(response.generalAudit.productVerifications.length, 1);
  assert.equal(response.items.length, 1); assert.equal(response.items[0].fulfillment.requested, 7); assert.equal(response.items[0].fulfillment.supplied, 7);
  assert.equal(response.generalAudit.productVerifications[0].confirmation.confirmedBy.id, 'cca');
  assert.equal(response.allMatch, true); assert.equal(response.generalAudit.productCount.requested, 1);
  const restored = restoreGeneralProductConfirmations(fixture(), response);
  assert.equal(restored.generalAudit.productVerifications?.length, 1); assert.equal(restored.allMatch, true);
});
test('titles retain clinical numbers and wrap without changing source data or IDs', () => {
  const record = fixture(); const original = JSON.stringify(record);
  assert.equal(generalProductHeading('Inj. Diclofenac 25mg/5mL Injection'), names[0]);
  assert.equal(generalProductHeading('Injection Artesunate 120mg'), 'Artesunate 120mg Injection');
  const product = record.generalAudit.productVerifications![0]; const long = 'Very long product description '.repeat(10) + '25mg/5mL Injection';
  const html = renderToStaticMarkup(createElement(Inventory, { items: [], details: { ...record.generalAudit, productVerifications: [{ ...product, productName: long }] }, onOrderLimit() {} }));
  assert.match(html, /break-words/); assert.match(html, /font-bold/); assert.match(html, /25mg\/5mL Injection/); assert.equal(JSON.stringify(record), original);
});

test('cosmetic source edits retain confirmation while material clinical changes invalidate only the affected product', () => {
  const base = fixture(), product = base.generalAudit.productVerifications![0];
  const confirmed = applyGeneralProductConfirmation(base, product.key, product.options.find(option => option.fromFulfillment)!.key, true, { id: 'cca', name: 'CCA' }, '2026-10-24T12:00:00Z');
  const whatsappMessage = base.whatsappMessage.replace('Inj. Diclofenac', 'Injection DICLOFENAC');
  const fresh = { ...runGeneralAuditor(whatsappMessage, base.fulfillmentConfirmation), whatsappMessage, fulfillmentConfirmation: base.fulfillmentConfirmation, id: base.id };
  const restored = restoreGeneralProductConfirmations(fresh, confirmed);
  assert.equal(restored.allMatch, true); assert.equal(restored.generalAudit.productVerifications?.[0].confirmation?.confirmedAt, '2026-10-24T12:00:00Z');
  const changedSource = base.whatsappMessage.replace('25mg/5mL', '50mg/5mL');
  const changed = { ...runGeneralAuditor(changedSource, base.fulfillmentConfirmation), whatsappMessage: changedSource, fulfillmentConfirmation: base.fulfillmentConfirmation, id: base.id };
  assert.equal(restoreGeneralProductConfirmations(changed, confirmed).generalAudit.productVerifications?.[0]?.confirmation, undefined);
});

test('uncertain source provenance and conflicting extraction quantities stay under review', () => {
  seed(); const source = parseGeneralProducts('PCM 500mg Tablet [7]', 'customer_request')[0];
  const supplied = parseGeneralProducts('Paracetamol 500mg Tablet [7/7]', 'fulfillment_confirmation');
  const conflict = prepareGeneralProductComparison([source, { ...source, quantity: 14 }], supplied);
  assert.ok(conflict.reviews.some(review => /disagree/.test(review.reason))); assert.equal(conflict.verifications.length, 0);
  const unbound = { ...source, sourceEntryId: undefined, sourceLineId: undefined, sourceSpan: undefined, line: 0 };
  const uncertain = prepareGeneralProductComparison([unbound, { ...unbound }], supplied);
  assert.equal(uncertain.sourceEntries.filter(entry => entry.source === 'customer_request').length, 2);
  assert.ok(uncertain.reviews.some(review => /source line is uncertain/.test(review.reason))); assert.equal(uncertain.verifications.length, 0);
});

test('canonical source-entry snapshots cannot retain a second interpreted copy of one raw line', () => {
  const record = duplicated(); const candidate = record.generalAudit.productVerifications![1].requestedProducts[0];
  const result = enforceGeneralProductAssignments({ ...record, generalAudit: { ...record.generalAudit, sourceEntries: [...record.generalAudit.sourceEntries!, candidate] } }, record.whatsappMessage, record.fulfillmentConfirmation);
  assert.equal(result.generalAudit.productCount.requested, 1);
  assert.equal(result.generalAudit.sourceEntries!.filter(source => source.source === 'customer_request').length, 1);
  assert.equal(result.generalAudit.productVerifications!.length, 1);
});

test('a saved confirmed canonical entry clears stale duplicate candidate reviews and keeps one history', () => {
  const base = fixture(), target = base.generalAudit.productVerifications![0];
  const confirmed = applyGeneralProductConfirmation(base, target.key, target.options.find(option => option.fromFulfillment)!.key, true, { id: 'cca', name: 'CCA' });
  const review = base.generalAudit.semanticReviews![0];
  const legacy = { ...confirmed, generalAudit: { ...confirmed.generalAudit, productVerifications: [...confirmed.generalAudit.productVerifications!, { ...target, key: 'stale-candidate' }], semanticReviews: [{ ...review, dosageFormKey: 'stale-candidate' }] } };
  const restored = enforceGeneralProductAssignments(legacy, base.whatsappMessage, base.fulfillmentConfirmation);
  assert.equal(restored.allMatch, true); assert.equal(restored.generalAudit.productVerifications!.length, 1);
  assert.equal(restored.generalAudit.semanticReviews?.length || 0, 0); assert.equal(restored.generalAudit.auditSummary?.reviewRequiredCount || 0, 0);
  assert.equal(restored.generalAudit.productVerifications![0].confirmationHistory?.length || 0, 0);
});
