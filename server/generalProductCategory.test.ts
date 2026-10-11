import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyCatalog, defaultProducts, saveCatalogProduct } from './productCatalog';
import { runGeneralAuditor } from './generalAuditor';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import GeneralProductCategoryBadge from '../src/components/GeneralProductCategoryBadge';
import GeneralFulfillmentSummary from '../src/components/GeneralFulfillmentSummary';
import type { ProductCatalog } from '../shared/productCatalog';

const seed: ProductCatalog = { revision: 1, products: defaultProducts() };
const headers = 'Facility: Category CHPS\nOrderer: Test User\n';

test('mixed orders classify vaccines, medical products and companions through catalog identities', () => {
  applyCatalog(seed);
  const expected = new Map([
    ['OPV', 'Vaccine'], ['OPV Dropper', 'Vaccine Companion'], ['IPV vaccine', 'Vaccine'],
    ['Gardasil', 'Vaccine'], ['ARV', 'Vaccine'], ['HRIG', 'Medical Product'], ['ASV', 'Medical Product'],
    ['PCM 500mg Tablet', 'Medical Product'], ['NS 500ml', 'Medical Product'],
    ['PRBC O+', 'Blood Product'], ['Malaria RDT', 'Diagnostic Product'], ['Gloves', 'Consumable'], ['Soloshot 0.5ml', 'Consumable'],
  ]);
  const names = [...expected.keys()];
  const result = runGeneralAuditor(headers + names.map(name => `${name} - 2`).join('\n'), headers + names.map(name => `${name} [2/2]`).join('\n'));
  assert.equal(result.allMatch, true);
  assert.equal(result.issueCount, 0);
  for (const item of result.items) {
    const requestedName = item.provenance.find(product => product.source === 'customer_request')!.name;
    assert.equal(item.category, expected.get(requestedName), item.name);
    assert.equal(item.fulfillment.category, item.category);
  }
  const summary = renderToStaticMarkup(createElement(GeneralFulfillmentSummary, { details: result.generalAudit }));
  for (const category of new Set(expected.values())) assert.ok(summary.includes(category), category);
  const vaccineBadge = renderToStaticMarkup(createElement(GeneralProductCategoryBadge, { category: 'Vaccine' }));
  const medicineBadge = renderToStaticMarkup(createElement(GeneralProductCategoryBadge, { category: 'Medical Product' }));
  assert.match(vaccineBadge, /teal/);
  assert.match(medicineBadge, /blue/);
});
test('catalog category edits are reflected by aliases and new vaccines after reload', () => {
  const created = saveCatalogProduct(seed, { revision: 1, scope: 'general', name: 'Local Logistics Product', category: 'consumable', aliases: ['LLP'], contextualAliases: [], note: '' }, 'admin@example.com');
  try {
    applyCatalog(created);
    assert.equal(runGeneralAuditor(headers + 'LLP - 2', headers + 'Local Logistics Product [2/2]').items[0].category, 'Consumable');
    const product = created.products.find(product => product.name === 'Local Logistics Product')!;
    const changed = saveCatalogProduct(created, { ...product, revision: created.revision, category: 'medicine' }, 'admin@example.com');
    applyCatalog(JSON.parse(JSON.stringify(changed)));
    assert.equal(runGeneralAuditor(headers + 'LLP - 2', headers + 'Local Logistics Product [2/2]').items[0].category, 'Medical Product');
    const vaccine = saveCatalogProduct(changed, { revision: changed.revision, scope: 'vaccine', name: 'Example Vaccine', category: 'vaccine', aliases: ['EVX'], contextualAliases: [], note: '' }, 'admin@example.com');
    applyCatalog(vaccine);
    assert.equal(runGeneralAuditor(headers + 'EVX - 2', headers + 'Example Vaccine [2/2]').items[0].category, 'Vaccine');
  } finally { applyCatalog(seed); }
});
test('older response labels are corrected at the rendering boundary', () => {
  applyCatalog(seed);
  const inputs = { whatsappMessage: headers + 'OPV - 2\nParacetamol - 2', fulfillmentConfirmation: headers + 'OPV [2/2]\nOPV Dropper [2/2]\nParacetamol [2/2]' };
  const run = createGeneralAuditRun(inputs, 1);
  const stale = { ...run.comparison!, ...inputs, auditEngine: 'general-deterministic-v1',
    items: run.comparison!.items.map(item => ({ ...item, category: 'Medical Product', fulfillment: { ...item.fulfillment, category: 'Medical Product' } })) };
  const corrected = completeGeneralAuditRun(run, stale);
  assert.equal(corrected.allMatch, true);
  assert.deepEqual(corrected.items.map(item => item.category), ['Vaccine', 'Medical Product', 'Vaccine Companion']);
});
test('declared consumables with vaccine wording and overlapping aliases remain consumables', () => {
  const products = structuredClone(seed.products);
  products.push({ id: 'cooler', scope: 'general', name: 'Vaccine Cold Box', category: 'consumable', aliases: ['ColdBoxAlias'], contextualAliases: [], note: '' });
  products.find(product => product.scope === 'vaccine' && product.name === 'OPV')!.aliases.push('ColdBoxAlias');
  try {
    applyCatalog({ revision: 2, products });
    const result = runGeneralAuditor(headers + 'ColdBoxAlias - 2', headers + 'Vaccine Cold Box [2/2]');
    assert.equal(result.allMatch, true);
    assert.equal(result.items[0].category, 'Consumable');
  } finally { applyCatalog(seed); }
});
test('standalone companion acknowledgement preserves a custom vaccine category from the backend', async () => {
  const catalog = saveCatalogProduct(seed, { revision: 1, scope: 'vaccine', name: 'Example Vaccine', category: 'vaccine', aliases: ['EVX'], contextualAliases: [], note: '' }, 'admin@example.com');
  try {
    applyCatalog(catalog);
    const result = runGeneralAuditor(headers + 'EVX - 2', headers + 'Example Vaccine [1/2]');
    const { acknowledgeOrderLimit } = await import('../extension/order-limits.js');
    const acknowledged = acknowledgeOrderLimit(result, result.items[0].fulfillment.key, true);
    assert.equal(acknowledged.allMatch, true);
    assert.equal(acknowledged.items[0].category, 'Vaccine');
    assert.equal(acknowledged.items[0].fulfillment.category, 'Vaccine');
  } finally { applyCatalog(seed); }
});
