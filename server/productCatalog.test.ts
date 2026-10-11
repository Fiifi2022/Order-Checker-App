import { runGeneralSemanticAudit } from './generalSemanticAudit';
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProducts, applyCatalog, saveCatalogProduct, productCatalogHandlers } from './productCatalog';
import { canAccess } from './auth';
import { normalizeGeneralProductName, runGeneralAuditor } from './generalAuditor';
import { matchVaccineName } from './vaccineService';
import { type ProductCatalog } from '../shared/productCatalog';

const seed: ProductCatalog = { revision: 1, products: defaultProducts() };

test('catalog seeds medicine vocabulary, package products, and vaccine companions', () => {
  assert.ok(seed.products.length > 300);
  assert.ok(seed.products.some(product => product.scope === 'general' && product.aliases.includes('PCM')));
  assert.ok(seed.products.some(product => product.name === 'OPV Dropper'));
  assert.ok(seed.products.some(product => product.name === 'Abacavir/Lamivudine 120mg/60mg Tablet'));
  assert.equal(new Set(seed.products.map(product => product.id)).size, seed.products.length);
});
test('applying the seeded catalog preserves product qualifiers and established matching', () => {
  const names = ['PCM 500mg Tablet', 'PCM syrup 120mg/5ml', 'NS 500ml', 'PRBC O+', 'PRBC O-', 'ASV Injection', 'ARV Injection', 'OPV Dropper', 'PCM 250mg Tablet'];
  const before = names.map(normalizeGeneralProductName);
  applyCatalog(seed);
  assert.deepEqual(names.map(normalizeGeneralProductName), before);
  assert.notEqual(normalizeGeneralProductName('PCM 500mg Tablet'), normalizeGeneralProductName('PCM 250mg Tablet'));
  assert.notEqual(normalizeGeneralProductName('PRBC O+'), normalizeGeneralProductName('PRBC O-'));
});
test('new products and edited aliases drive deterministic matching and reload correctly', async () => {
  let catalog = saveCatalogProduct(seed, { revision: 1, scope: 'general', name: 'Example Logistics Item', category: 'consumable', aliases: ['ELI'], contextualAliases: [], note: '' }, 'admin@example.com');
  applyCatalog(catalog);
  assert.equal(normalizeGeneralProductName('ELI'), normalizeGeneralProductName('Example Logistics Item'));
  const audit = runGeneralAuditor('Facility: Gbimsi CHPS\nOrderer: Isaac Awuyem\nELI - 2', 'Facility: Gbimsi CHPS\nOrderer: Isaac Awuyem\nExample Logistics Item [2/2]');
  assert.equal(audit.allMatch, true);
  let geminiCalls = 0;
  const semantic = await runGeneralSemanticAudit('Facility: Gbimsi CHPS\nOrderer: Isaac Awuyem\nELI - 2', 'Facility: Gbimsi CHPS\nOrderer: Isaac Awuyem\nExample Logistics Item [2/2]', {}, {}, () => { geminiCalls++; throw new Error('Gemini should not be needed'); });
  assert.equal(semantic.allMatch, true);
  assert.equal(geminiCalls, 0);
  const product = catalog.products.find(product => product.name === 'Example Logistics Item')!;
  catalog = saveCatalogProduct(catalog, { ...product, revision: catalog.revision, aliases: ['Logistics Widget'] }, 'warehouse@example.com');
  applyCatalog(JSON.parse(JSON.stringify(catalog)));
  assert.equal(normalizeGeneralProductName('Logistics Widget'), normalizeGeneralProductName(product.name));
  assert.notEqual(normalizeGeneralProductName('ELI'), normalizeGeneralProductName(product.name));
  const opv = catalog.products.find(product => product.scope === 'vaccine' && product.name === 'OPV')!;
  catalog = saveCatalogProduct(catalog, { ...opv, revision: catalog.revision, aliases: [...opv.aliases, 'Local Polio Name'] }, 'compliance@example.com');
  applyCatalog(catalog);
  assert.equal(matchVaccineName('Local Polio Name').canonical, 'OPV');
  applyCatalog(seed);
});
test('catalog edits reject alias conflicts, stale revisions, and invalid payloads', () => {
  const draft = { revision: 1, scope: 'general', name: 'New Item', category: 'consumable', aliases: ['PCM'], contextualAliases: [], note: '' };
  assert.throws(() => saveCatalogProduct(seed, draft, 'admin'), /already belongs/);
  assert.throws(() => saveCatalogProduct(seed, { ...draft, revision: 0 }, 'admin'), /catalog changed/);
  assert.throws(() => saveCatalogProduct(seed, { ...draft, aliases: 'admin' }, 'admin'), /Aliases/);
  assert.throws(() => saveCatalogProduct(seed, { ...draft, aliases: ['NewAlias'], contextualAliases: ['Unknown'] }, 'admin'), /context-required/);
});
test('catalog editing requires a management role, including secondary roles', async () => {
  for (const role of ['warehouse', 'dco', 'auditor', 'admin']) assert.equal(canAccess(role, 'POST', '/products'), true);
  assert.equal(canAccess('cca', 'POST', '/products'), false);
  assert.equal(canAccess('cca', 'GET', '/products'), true);
  let writes = 0, status = 200;
  const handlers = productCatalogHandlers({ read: async () => seed, save: async () => { writes++; return seed; } });
  const response: any = { locals: { authUser: { role: 'cca', email: 'member@example.com' } }, setHeader() {}, status(value: number) { status = value; return this; }, json() {} };
  await handlers.save({ body: {} } as any, response, () => {});
  assert.equal(status, 403); assert.equal(writes, 0);
  response.locals.authUser.roles = ['cca', 'auditor'];
  await handlers.save({ body: {} } as any, response, () => {});
  assert.equal(writes, 1);
});

test('product names can be edited without changing allocation identity or losing existing aliases', () => {
  const original = seed.products.find(product => product.scope === 'vaccine' && product.name === 'OPV')!;
  const saved = saveCatalogProduct(seed, { ...original, revision: seed.revision, displayName: 'Local Oral Polio Vaccine' }, 'admin@example.com');
  const renamed = saved.products.find(product => product.id === original.id)!;
  assert.equal(renamed.name, 'OPV');
  assert.equal(renamed.displayName, 'Local Oral Polio Vaccine');
  assert.ok(renamed.aliases.includes('Local Oral Polio Vaccine'));
  for (const alias of original.aliases) assert.ok(renamed.aliases.includes(alias));
  applyCatalog(JSON.parse(JSON.stringify(saved)));
  assert.equal(matchVaccineName('Local Oral Polio Vaccine').canonical, 'OPV');
  assert.equal(matchVaccineName('OPV').canonical, 'OPV');
  assert.throws(() => saveCatalogProduct(seed, { ...original, revision: 1, displayName: 'IPV' }, 'admin'), /already belongs/);
  applyCatalog(seed);
});
test('catalog reads report current edit permissions rather than a stale browser role', async () => {
  const handlers = productCatalogHandlers({ read: async () => seed, save: async () => seed });
  let body: any;
  const response: any = { locals: { authUser: { role: 'cca', roles: ['cca', 'warehouse'] } }, setHeader() {}, json(value: any) { body = value; }, status() { return this; } };
  await handlers.read({} as any, response, () => {});
  assert.equal(body.canEdit, true);
  assert.deepEqual(body.accessRoles, ['cca', 'warehouse']);
  response.locals.authUser.roles = ['cca'];
  await handlers.read({} as any, response, () => {});
  assert.equal(body.canEdit, false);
  assert.deepEqual(body.accessRoles, ['cca']);
});
