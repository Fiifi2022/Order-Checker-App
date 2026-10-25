import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCatalog, defaultProducts, saveCatalogProduct } from './productCatalog';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { canAuditGeneralWithoutAi, generalInterpretationGaps } from './generalOrderInterpretation';
import { isGeneralProductLogMatch } from '../src/utils/generalProductLog';
import { generalProductDisplayName, normalizeGeneralProductName, parseGeneralProducts, runGeneralAuditor } from './generalAuditor';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Inventory from '../src/components/GeneralInventory';

const header = 'Orderer: John Mensah\nFacility: Alpha HC\n';
const initialProducts = defaultProducts();
const seed = () => ({ revision: 1, products: structuredClone(initialProducts) });
const lookup = (name: string) => isGeneralProductLogMatch(name, normalizeGeneralProductName);
function customLog() {
  const catalog = saveCatalogProduct(seed(), { revision: 1, scope: 'general', name: 'Example Logistics Item', displayName: 'Example Display Item', fulfillmentSystemName: 'Warehouse Example Item', category: 'consumable', aliases: ['ELI', 'Local Example'], contextualAliases: [], note: '' }, 'warehouse@example.com');
  applyCatalog(catalog);
  return catalog;
}
test('saved Product Log names, display names, system names and aliases resolve before AI', async () => {
  customLog();
  for (const name of ['Example Logistics Item', 'Example Display Item', 'Warehouse Example Item', 'ELI', 'Local Example']) {
    assert.equal(lookup(name), true, name);
    let calls = 0;
    const result = await runGeneralSemanticAudit(header + name + ' - 2', header + 'Example Logistics Item [2/2]', {}, {}, () => { calls++; throw new Error('AI unavailable'); });
    assert.equal(calls, 0, name);
    assert.equal(result.allMatch, true, name);
  }
});
test('identical unknown names cannot bypass Product Log lookup', async () => {
  customLog();
  const request = header + 'Unlisted Mystery Widget - 2';
  const fulfillment = header + 'Unlisted Mystery Widget [2/2]';
  assert.equal(lookup('Unlisted Mystery Widget'), false);
  assert.equal(canAuditGeneralWithoutAi(request, fulfillment), false);
  assert.ok(generalInterpretationGaps(request, fulfillment).some(review => review.kind === 'product'));
  let calls = 0;
  const result = await runGeneralSemanticAudit(request, fulfillment, {}, { semanticCacheScope: 'unknown-log-name' }, () => { calls++; throw new Error('AI unavailable'); });
  assert.ok(calls > 0);
  assert.notEqual(result.semanticAnalysis.status, 'skipped');
});
test('alias changes invalidate prior lookup hits and misses', () => {
  const catalog = customLog();
  assert.equal(lookup('ELI'), true); assert.equal(lookup('New Example Alias'), false);
  const product = catalog.products.find(product => product.name === 'Example Logistics Item')!;
  applyCatalog(saveCatalogProduct(catalog, { ...product, revision: catalog.revision, aliases: ['New Example Alias'] }, 'warehouse@example.com'));
  assert.equal(lookup('ELI'), false); assert.equal(lookup('New Example Alias'), true);
});
test('known Product Log products retain clinical and quantity discrepancies without AI', async () => {
  applyCatalog(seed());
  let calls = 0;
  const result = await runGeneralSemanticAudit(header + 'PCM 500mg Tablet - 10', header + 'Paracetamol 250mg Tablet [5/10]', {}, {}, () => { calls++; throw new Error('AI unavailable'); });
  assert.equal(calls, 0); assert.equal(result.allMatch, false);
});
test('context-required aliases remain unresolved without supporting product context', () => {
  const catalog = customLog();
  const product = catalog.products.find(product => product.name === 'Example Logistics Item')!;
  applyCatalog(saveCatalogProduct(catalog, { ...product, revision: catalog.revision, aliases: ['EX'], contextualAliases: ['EX'] }, 'warehouse@example.com'));
  assert.equal(lookup('EX'), false);
});
test('extension order-limit decisions reuse the Product Log snapshot and custom aliases', async () => {
  const catalog = customLog();
  const record = runGeneralAuditor(header + 'ELI - 10', header + 'Example Logistics Item [5/10]');
  const { applyAuditProductLog, acknowledgeOrderLimit } = await import('../extension/order-limits.js');
  applyAuditProductLog(catalog);
  const acknowledged = acknowledgeOrderLimit(record, record.items[0].fulfillment.key, true);
  assert.equal(acknowledged.allMatch, true);
  assert.equal(acknowledged.items[0].fulfillment.orderLimitDecision, true);
  assert.throws(() => applyAuditProductLog({ revision: Number.NaN, products: [] }), /Product Log/);
});
function diclofenacLog() {
  const catalog = seed();
  const product = catalog.products.find(product => product.name === 'Diclofenac Injection, 25mg/ml In 3ml [5]')!;
  assert.ok(product);
  applyCatalog({ ...catalog, products: catalog.products.map(row => row.id === product.id ? {
    ...row, aliases: ['Inj. Diclofenac 25mg/5mL Injection', 'Diclofenac Inj. 25mg/ml', 'Diclofenac 25mg/ml', 'Inj. Diclofenac 75mg'],
  } : row) });
}
const dicloCustomer = 'Date: 23/10/2026\nName of Orderer: Kwaku Duah\nName of Health Facility: Woraso Health Centre\nDelivery/ Drop area:\nDistrict: Sekyere Kumawu\nProducts and Quantities:\nInj. Diclofenac 25mg/5mL Injection [7]';
const dicloFulfillment = 'Thank you Kwaku Duah from Woraso HC for ordering with Zipline. We have received your order (ID: KVDP8VHBXP). Use this link to track your order: https://orders.zipline.com/t/7/KVDP8VHBXP We will now prepare the following items for delivery:\nDiclofenac 25mg/mL Injection, 3mL [7/7]\nExpected delivery: between October 23, 2026 12:30 PM and October 23, 2026 06:00 PM. Let us know if any changes are required or contact 0800719102 if any questions.\nYou will receive your flight notifications via SMS';
test('the reported Diclofenac example keeps Inj. intact, uses the saved alias without AI, and explains its clinical conflict', async () => {
  diclofenacLog(); let calls = 0;
  const result = await runGeneralSemanticAudit(dicloCustomer, dicloFulfillment, {}, {}, () => { calls++; throw new Error('AI unavailable'); });
  assert.equal(calls, 0); assert.equal(result.allMatch, false);
  assert.equal(result.items.length, 0, 'no fabricated missing/extra product cards');
  const product = result.generalAudit.productVerifications![0];
  assert.equal(product.status, 'review required'); assert.equal(product.requestedQuantity, 7); assert.equal(product.suppliedQuantity, 7);
  assert.equal(product.requestedProducts[0].name, 'Inj. Diclofenac 25mg/5mL Injection');
  assert.equal(product.fulfillmentProducts.length, 1); assert.deepEqual(product.options, []);
  assert.match(product.reason!, /saved Product Log alias.*clinical specifications conflict/);
  assert.notEqual(normalizeGeneralProductName(product.requestedProducts[0].name), normalizeGeneralProductName(product.fulfillmentProducts[0].name));
  const html = renderToStaticMarkup(createElement(Inventory, { items: result.items, details: result.generalAudit, onOrderLimit() {} }));
  assert.match(html, /Review Required/); assert.doesNotMatch(html, /Confirm Product|Product: MATCH/);
});
test('a matching dotted Diclofenac alias pairs with the full system label without pack metadata duplication or AI', async () => {
  diclofenacLog(); let calls = 0;
  const result = await runGeneralSemanticAudit(dicloCustomer.replace('Inj. Diclofenac 25mg/5mL Injection', 'Diclofenac Inj. 25mg/ml'), dicloFulfillment, {}, {}, () => { calls++; throw new Error('AI unavailable'); });
  assert.equal(calls, 0); assert.equal(result.allMatch, true); assert.equal(result.items.length, 1);
  assert.equal(result.items[0].fulfillment.requested, 7); assert.equal(result.items[0].fulfillment.supplied, 7);
  assert.doesNotMatch(result.items[0].fulfillment.key, /\b5\b/);
});
test('saved dotted aliases retain order-limit quantity checks', async () => {
  diclofenacLog();
  const result = await runGeneralSemanticAudit(dicloCustomer.replace('Inj. Diclofenac 25mg/5mL Injection', 'Diclofenac Inj. 25mg/ml'), dicloFulfillment.replace('[7/7]', '[5/7]'), {}, {}, () => { throw new Error('AI unavailable'); });
  assert.equal(result.allMatch, false); assert.equal(result.items[0].fulfillment.requested, 7);
  assert.equal(result.items[0].fulfillment.supplied, 5); assert.equal(result.items[0].fulfillment.orderLimitEligible, true);
});
test('a saved total-content alias uses the explicit catalogue concentration and container volume', async () => {
  diclofenacLog(); let calls = 0;
  const result = await runGeneralSemanticAudit(dicloCustomer.replace('Inj. Diclofenac 25mg/5mL Injection', 'Inj. Diclofenac 75mg'), dicloFulfillment, {}, {}, () => { calls++; throw new Error('AI unavailable'); });
  assert.equal(calls, 0); assert.equal(result.allMatch, true); assert.equal(result.items.length, 1);
  assert.equal(result.items[0].fulfillment.supplied, 7);
});
test('trailing order quantities are separated before looking up the Product Log alias', () => {
  diclofenacLog();
  const name = 'Inj. Diclofenac 25mg/5mL Injection';
  for (const suffix of [' [7]', '[7]', ' [ 7 ]', ' (7)', '(7)', ' - 7', ' 7']) {
    const parsed = parseGeneralProducts(header + name + suffix, 'customer_request');
    assert.equal(parsed.length, 1, suffix);
    assert.equal(parsed[0].name, name, suffix);
    assert.equal(parsed[0].quantity, 7, suffix);
    assert.equal(parsed[0].normalizedName, normalizeGeneralProductName(name), suffix);
    assert.equal(lookup(parsed[0].name), true, suffix);
  }
  const supplied = parseGeneralProducts(header + 'Diclofenac 25mg/mL Injection, 3mL[7/7]', 'fulfillment_confirmation')[0];
  assert.equal(supplied.name, 'Diclofenac 25mg/mL Injection, 3mL');
  assert.equal(supplied.quantity, 7); assert.equal(supplied.ratioRequestedQuantity, 7);
});
test('product titles remove order quantities while keeping clinical numbers intact', () => {
  diclofenacLog();
  const name = 'Inj. Diclofenac 25mg/5mL Injection';
  for (const suffix of [' [7]', '[7]', ' (7)', ' [7/7]', ' - 7']) assert.equal(generalProductDisplayName(name + suffix), name);
  for (const name of ['Diclofenac 25mg/mL Injection, 3mL', 'Vitamin B12', 'Paracetamol 500mg Tablet', 'R21']) assert.equal(generalProductDisplayName(name), name);
});
