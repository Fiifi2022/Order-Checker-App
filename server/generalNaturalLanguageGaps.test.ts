import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCatalog, defaultProducts} from './productCatalog';
import {changeCatalogueAlias} from './catalogAliasLearning';
import {extractGeneralOrderDeterministically as extract} from './generalOrderExtraction';
import {resolveGeneralOrderExtraction} from './generalHybridExtraction';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import type {ProductCatalog} from '../shared/productCatalog';

const directory = {records: ['Zebilla Hospital', 'Anyinofi Health Centre', 'Sakogu Health Centre'].map(name => ({name, source: `test/${name}`}))};
const catalog = (): ProductCatalog => ({revision: 890, products: defaultProducts()});
const local = (text: string) => {applyCatalog(catalog()); return extract(text, 'customer_request', directory);};
const noAI = () => {throw Error('Locally recognised orders must not acquire Gemini');};

test('A: titled natural-language order retains ambiguous product, quantity and course review', async () => {
  const message = 'Mr Timothy Ndebugre from Zebilla Hospital I need full course of ARV venom -4';
  const result = local(message);
  assert.equal(result.order.ordererName, 'Timothy Ndebugre');
  assert.equal(result.order.facilityName, 'Zebilla Hospital');
  assert.deepEqual(result.order.products, [{name: 'ARV venom', quantity: 4, unit: null}]);
  for (const field of ['products', 'quantity', 'unit']) assert.ok(result.order.unresolvedFields.includes(field));
  assert.ok(result.quantityReviews?.[0].originalText.includes('full course'));
  const audited = await runGeneralProductNameAudit(message, 'Orderer: Timothy Ndebugre\nFacility: Zebilla Hospital\nASV [4/4]', catalog(), {facilityContext: directory, semanticTimeoutMs: 0}, noAI);
  assert.equal(audited.allMatch, false);
  assert.ok(audited.generalAudit.semanticReviews?.some(review => /full course/i.test(review.reason)));
  assert.equal(audited.generalAudit.extraction?.customer.products[0].quantity, 4);
});

test('B: normal conversation resolves locally without a Gemini client', async () => {
  const text = 'This is Emmanuel Adomako from Anyinofi HC. Please send 20 Paracetamol 500mg tablets.';
  const result = local(text);
  assert.equal(result.order.ordererName, 'Emmanuel Adomako');
  assert.equal(result.order.facilityName, 'Anyinofi HC');
  assert.deepEqual(result.order.products.map(product => [product.name, product.quantity]), [['Paracetamol 500mg tablets', 20]]);
  let calls = 0;
  const audited = await runGeneralProductNameAudit(text, 'Thank you Emmanuel Adomako from Anyinofi HC for ordering with Zipline.\nParacetamol 500mg Tablet [20/20]', catalog(), {facilityContext: directory}, () => {calls++; return noAI();});
  assert.equal(audited.allMatch, true, JSON.stringify(audited.generalAudit));
  assert.equal(calls, 0);
});

test('C: single sender name and two independently quantified products are extracted', () => {
  const result = local('My name is Justice from Sakogu HC. Kindly send 5 Oxytocin and 10 Artesunate injections.');
  assert.equal(result.order.ordererName, 'Justice');
  assert.equal(result.order.facilityName, 'Sakogu HC');
  assert.deepEqual(result.order.products.map(product => [product.name, product.quantity]), [['Oxytocin', 5], ['Artesunate injections', 10]]);
});

test('D/E/F: facility-led prose, ambiguous acronym and strength remain distinct from sender and quantity', () => {
  const facilityOnly = local('Zebilla Hospital urgently needs 4 vials of ASV.');
  assert.equal(facilityOnly.order.facilityName, 'Zebilla Hospital');
  assert.equal(facilityOnly.order.ordererName, null);
  assert.ok(facilityOnly.order.unresolvedFields.includes('ordererName'));
  assert.equal(facilityOnly.order.products[0].quantity, 4);
  assert.equal(facilityOnly.order.products[0].unit, 'vial');
  const ambiguous = local('We need 4 ARV.');
  assert.equal(ambiguous.order.products[0].name, 'ARV');
  assert.ok(ambiguous.order.unresolvedFields.includes('products'));
  assert.ok(ambiguous.identityReviews?.length);
  const strength = local('Please send Artesunate 120mg injection -10.');
  assert.deepEqual(strength.order.products, [{name: 'Artesunate 120mg injection', quantity: 10, unit: null}]);
});

for (const introduction of ['Mr Timothy Ndebugre from', 'Mrs Timothy Ndebugre at', 'Ms Timothy Ndebugre from', 'Dr Timothy Ndebugre of', 'Nurse Timothy Ndebugre from', 'Officer Timothy Ndebugre at', 'This is Timothy Ndebugre from', 'I am Timothy Ndebugre calling from']) {
  test(`name introduction: ${introduction}`, () => {
    const result = local(`${introduction} Zebilla Hospital. Please send ASV 4.`);
    assert.equal(result.order.ordererName, 'Timothy Ndebugre');
    assert.equal(result.order.facilityName, 'Zebilla Hospital');
    assert.equal(result.order.products[0].quantity, 4);
  });
}

test('comma introductions are recognised but patient introductions and absent names are not invented', () => {
  assert.equal(local('Timothy Ndebugre, Zebilla Hospital, please send 4 vials of ASV').order.ordererName, 'Timothy Ndebugre');
  assert.equal(local('My name is Dr Timothy Ndebugre. Facility: Zebilla Hospital\nASV 4').order.ordererName, 'Timothy Ndebugre');
  assert.equal(local('Patient name: Mr Timothy Ndebugre from Zebilla Hospital\nPlease send ASV 4.').order.ordererName, null);
});

for (const wording of ['ASV -4', 'ASV x4', 'ASV 4', 'ASV quantity 4', '4 ASV', 'Four vials of ASV', 'ASV (4)', 'Please send me 4 ASV', 'We are requesting ASV 4', 'Can you send ASV 4']) {
  test(`quantity format: ${wording}`, () => {
    assert.equal(local(wording).order.products[0]?.quantity, 4);
  });
}

test('questions, units, ratios, strengths and numbered lists retain their separate meaning', () => {
  assert.equal(local('Can you help us with 10 boxes of Paracetamol?').order.products[0]?.quantity, 10);
  assert.equal(local('Please supply 5 vials of Oxytocin').order.products[0]?.unit, 'vial');
  assert.equal(local('Kindly send Artesunate injection 120mg -10').order.products[0]?.quantity, 10);
  assert.equal(local('Paracetamol 20/20').order.products[0]?.quantity, 20);
  assert.equal(local('1. ASV -4\nAge: 19\nDate: 30/10/2026\nPhone: 0241234567').order.products[0]?.quantity, 4);
});

test('G: Gemini quota failure preserves recognised fields and the original course review', async () => {
  const customer = local('Mr Timothy Ndebugre from Zebilla Hospital I need full course of ARV venom -4');
  const fulfillment = extract('Facility: Zebilla Hospital\nOrderer: Timothy Ndebugre\nASV 4', 'fulfillment_confirmation', directory);
  let calls = 0;
  const result = await resolveGeneralOrderExtraction(customer, fulfillment, () => ({models: {async generateContent() {
    calls++; throw Object.assign(Error('quota exceeded'), {status: 429});
  }}}), {facilityContext: directory, semanticTimeoutMs: 1000, semanticCacheScope: 'natural-gaps-quota'});
  assert.equal(calls, 1);
  assert.equal(result.semanticAnalysis.status, 'fallback');
  assert.deepEqual(result.customer.order, customer.order);
  assert.ok(result.customer.quantityReviews?.length);
});

test('a recognised product cannot clear a full-course unit review or an unclear acronym', async () => {
  const saved = catalog(); applyCatalog(saved);
  for (const wording of ['full course of ASV -4', '4 ARV']) {
    const result = await runGeneralProductNameAudit(`Mr Timothy Ndebugre from Zebilla Hospital I need ${wording}`, 'Orderer: Timothy Ndebugre\nFacility: Zebilla Hospital\nASV [4/4]', saved, {facilityContext: directory, semanticTimeoutMs: 0}, noAI);
    assert.equal(result.allMatch, false);
    assert.ok(result.generalAudit.semanticReviews?.some(review => review.requiresConfirmation));
    assert.equal(result.generalAudit.extraction?.customer.products[0].quantity, 4);
  }
});

test('H: approved alias learning is reused by sentence auditing without Gemini', async () => {
  let saved: ProductCatalog = {revision: 900, products: [{id: 'asv', scope: 'general', name: 'Anti Snake Serum Injection', aliases: ['ASV'], contextualAliases: [], category: 'medicine', note: ''}]};
  const proposal = changeCatalogueAlias(saved, {revision: saved.revision, action: 'propose', text: 'Local venom supply', productId: 'asv', confidence: 0.99}, 'Gemini', true);
  saved = proposal.catalog;
  assert.equal(saved.aliasRecords?.at(-1)?.status, 'pending');
  saved = changeCatalogueAlias(saved, {revision: saved.revision, action: 'approve', id: saved.aliasRecords!.at(-1)!.id, identityConfirmed: true}, 'Test administrator').catalog;
  applyCatalog(saved);
  let calls = 0;
  const result = await runGeneralProductNameAudit('Mr Timothy Ndebugre from Zebilla Hospital I need Local venom supply -4', 'Orderer: Timothy Ndebugre\nFacility: Zebilla Hospital\nASV [4/4]', saved, {facilityContext: directory}, () => {calls++; return noAI();});
  assert.equal(result.allMatch, true, JSON.stringify(result.generalAudit));
  assert.equal(calls, 0);
});
