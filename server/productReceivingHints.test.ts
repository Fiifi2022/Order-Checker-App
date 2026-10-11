import test from 'node:test';
import assert from 'node:assert/strict';
import { productReceivingHints } from '../src/utils/productReceivingHints';
import { validateCatalogProduct, type CatalogProduct } from '../shared/productCatalog';
import { saveCatalogProduct, applyCatalog } from './productCatalog';
import { normalizeGeneralProductName } from './generalAuditor';
import { matchVaccineName } from './vaccineService';

const product: CatalogProduct = { id: 'a', scope: 'general', name: 'Sample 500mg Tablet', category: 'medicine', aliases: ['S500'], contextualAliases: [], note: '', fulfillmentSystemName: 'Sample Tabs 500mg', receivingDetails: 'Received in boxes of 10 tablets.' };

test('receiving reminders follow typed and scanned quantity lines without partial qualifier matches', () => {
  for (const text of ['S500 - 10 tablets', 'Sample Tabs 500mg [10/10]', 'Sample 500mg Tablet', 'Facility: Example\nSample 500mg Tablet: 10']) {
    assert.deepEqual(productReceivingHints(text, 'general', [product]).map(item => item.id), ['a']);
  }
  for (const text of ['Sample 250mg Tablet - 10', 'Sample - 10', 'Facility: Sample 500mg Tablet', '']) {
    assert.deepEqual(productReceivingHints(text, 'general', [product]), []);
  }
  assert.deepEqual(productReceivingHints('S500 - 10', 'vaccine', [product]), []);
});
test('context-required and overlapping aliases do not produce receiving reminders', () => {
  const contextual = { ...product, contextualAliases: ['S500'] };
  assert.deepEqual(productReceivingHints('S500 - 10', 'general', [contextual]), []);
  assert.deepEqual(productReceivingHints('S500 - 10', 'general', [product, { ...product, id: 'b' }]), []);
});
test('optional receiving fields validate, preserve on legacy saves and allow clearing', () => {
  assert.equal(validateCatalogProduct(product, product).receivingDetails, product.receivingDetails);
  const { receivingDetails, fulfillmentSystemName, ...legacy } = product;
  assert.equal(validateCatalogProduct(legacy, product).receivingDetails, receivingDetails);
  assert.equal(validateCatalogProduct({ ...product, receivingDetails: '', fulfillmentSystemName: '' }, product).receivingDetails, '');
  assert.throws(() => validateCatalogProduct({ ...product, fulfillmentSystemName: 'bad\nname' }, product));
  assert.throws(() => validateCatalogProduct({ ...product, receivingDetails: 'x'.repeat(2001) }, product));
});
test('saved system names drive both checkers and changed receiving details sync to the linked product', () => {
  const vaccine: CatalogProduct = { ...product, id: 'v', scope: 'vaccine', aliases: [], fulfillmentSystemName: '', receivingDetails: '' };
  const catalog = saveCatalogProduct({ revision: 1, products: [product, vaccine] }, { ...product, linkedProductId: 'v', fulfillmentSystemName: 'Logistics Sample 500mg', receivingDetails: 'Supply as individually packed tablets.', revision: 1 }, 'editor');
  const saved = catalog.products.find(item => item.id === 'a')!;
  const synced = catalog.products.find(item => item.id === 'v')!;
  assert.equal(synced.receivingDetails, saved.receivingDetails);
  assert.equal(synced.fulfillmentSystemName, saved.fulfillmentSystemName);
  applyCatalog(catalog);
  assert.equal(normalizeGeneralProductName('Logistics Sample 500mg'), normalizeGeneralProductName(product.name));
  assert.equal(matchVaccineName('Logistics Sample 500mg').canonical, product.name);
  assert.equal(productReceivingHints('Logistics Sample 500mg - 10', 'vaccine', catalog.products)[0].receivingDetails, saved.receivingDetails);
});
test('selecting an existing alias as the system name also syncs that alias and fields can be cleared', () => {
  const source = { ...product, fulfillmentSystemName: '', linkedProductId: 'v' };
  const target: CatalogProduct = { ...product, id: 'v', scope: 'vaccine', aliases: [], fulfillmentSystemName: '', receivingDetails: '', linkedProductId: 'a' };
  const catalog = saveCatalogProduct({ revision: 1, products: [source, target] }, { ...source, fulfillmentSystemName: 'S500', revision: 1 }, 'editor');
  assert.ok(catalog.products.find(item => item.id === 'v')!.aliases.includes('S500'));
  const cleared = saveCatalogProduct(catalog, { ...catalog.products.find(item => item.id === 'a'), fulfillmentSystemName: '', receivingDetails: '', revision: 2 }, 'editor');
  assert.equal(cleared.products.find(item => item.id === 'v')!.receivingDetails, '');
  assert.deepEqual(productReceivingHints('S500 - 10', 'vaccine', cleared.products), []);
});

test('authenticated companion reminder handler reads the shared catalog without writes or Gemini', async () => {
  const { productCatalogHandlers } = await import('./productCatalog');
  let writes = 0;
  const handlers = productCatalogHandlers({ read: async () => ({ revision: 8, products: [product] }), save: async () => { writes++; throw new Error('No writes'); } });
  const response: any = { statusCode: 200, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(data: unknown) { this.data = data; return this; } };
  await handlers.hints({ body: { scope: 'general', text: 'Sample 500mg Tablet [2/2]' } } as any, response, () => {});
  assert.equal(response.data.revision, 8);
  assert.equal(response.data.products[0].receivingDetails, product.receivingDetails);
  assert.equal(writes, 0);
  assert.equal(response.data.products[0].terminology, undefined);
  await handlers.hints({ body: { scope: 'bad', text: 'test' } } as any, response, () => {});
  assert.equal(response.statusCode, 400);
});

test('CCA can request read-only reminders while catalog saves and Gemini suggestions remain restricted', async () => {
  const { canAccess } = await import('./auth');
  assert.equal(canAccess('cca', 'POST', '/products/hints'), true);
  assert.equal(canAccess('cca', 'POST', '/products'), false);
  assert.equal(canAccess('cca', 'POST', '/products/suggest-aliases'), false);
  for (const role of ['auditor', 'warehouse', 'admin']) assert.equal(canAccess(role, 'POST', '/products'), true);
});
