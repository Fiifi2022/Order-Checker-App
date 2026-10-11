import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogAliasAssistant, validateAliasSuggestions } from './catalogAliasAssistant';
import { defaultProducts, saveCatalogProduct, applyCatalog } from './productCatalog';
import { catalogCounterpart } from '../shared/productCatalog';
import { normalizeGeneralProductName } from './generalAuditor';
import { matchVaccineName } from './vaccineService';

const catalog = { revision: 1, products: defaultProducts() };
const opv = catalog.products.find(product => product.scope === 'vaccine' && product.name === 'OPV')!;
const candidate = { alias: 'Oral Polio Local Label', kind: 'alias', requiresContext: false, reason: 'Candidate for local review.' };
test('suggestions are bounded, deduplicated, and exclude conflicts and ambiguous vaccine terms', () => {
  const data = { suggestions: [candidate, { ...candidate }, { ...candidate, alias: 'OPV' }, { ...candidate, alias: 'IPV' }, { ...candidate, alias: 'Polio', requiresContext: true }] };
  assert.deepEqual(validateAliasSuggestions(data, opv, catalog), [candidate]);
  assert.throws(() => validateAliasSuggestions({ suggestions: [{ ...candidate, alias: 42 }] }, opv, catalog));
});
test('Gemini suggestions require management access and do not modify the catalog', async () => {
  let calls = 0, status = 200, body: any;
  const snapshot = JSON.stringify(catalog);
  const handler = catalogAliasAssistant({ read: async () => catalog, getClient: () => ({ models: { async generateContent(options: any) {
    calls++; assert.equal(options.config.httpOptions.retryOptions.attempts, 1);
    assert.equal(JSON.parse(options.contents).product.name, 'OPV');
    return { text: JSON.stringify({ suggestions: [candidate] }) };
  } } }) });
  const res: any = { locals: { authUser: { role: 'cca', email: 'member@example.com' } }, setHeader() {}, status(code: number) { status = code; return this; }, json(value: any) { body = value; } };
  await handler({ body: { ...opv, revision: 1 } } as any, res, () => {});
  assert.equal(status, 403); assert.equal(calls, 0);
  res.locals.authUser.roles = ['cca', 'warehouse']; status = 200;
  await handler({ body: { ...opv, revision: 1 } } as any, res, () => {});
  assert.equal(status, 200); assert.deepEqual(body.suggestions, [candidate]); assert.equal(calls, 1);
  assert.equal(JSON.stringify(catalog), snapshot);
  await handler({ body: { ...opv, revision: 0 } } as any, res, () => {});
  assert.equal(status, 409); assert.equal(calls, 1);
});
test('quota failures preserve manual editing and never retry', async () => {
  let calls = 0, status = 200, body: any;
  const handler = catalogAliasAssistant({ read: async () => catalog, getClient: () => ({ models: { async generateContent() {
    calls++; throw Object.assign(new Error('private SDK details'), { status: 429 });
  } } }) });
  const res: any = { locals: { authUser: { role: 'auditor', email: 'compliance@example.com' } }, setHeader() {}, status(code: number) { status = code; return this; }, json(value: any) { body = value; } };
  await handler({ body: { ...opv, revision: 1 } } as any, res, () => {});
  assert.equal(calls, 1); assert.equal(status, 429); assert.match(body.error, /manually/); assert.doesNotMatch(body.error, /private/);
});
test('approved aliases sync atomically and match in both engines, including after reload', () => {
  const counterpart = catalogCounterpart(opv, catalog.products)!;
  assert.equal(counterpart.name, 'Oral Polio Vaccine');
  let saved = saveCatalogProduct(catalog, { ...opv, revision: 1, linkedProductId: counterpart.id, aliases: [...opv.aliases, candidate.alias] }, 'warehouse@example.com');
  const general = saved.products.find(product => product.id === counterpart.id)!;
  assert.ok(general.aliases.includes(candidate.alias)); assert.equal(general.linkedProductId, opv.id);
  applyCatalog(JSON.parse(JSON.stringify(saved)));
  assert.equal(matchVaccineName(candidate.alias).canonical, 'OPV');
  assert.equal(normalizeGeneralProductName(candidate.alias), normalizeGeneralProductName('Oral Polio Vaccine'));
  saved = saveCatalogProduct(saved, { ...general, revision: saved.revision, aliases: [...general.aliases, 'OPV Reviewed Abbreviation'] }, 'compliance@example.com');
  assert.ok(saved.products.find(product => product.id === opv.id)!.aliases.includes('OPV Reviewed Abbreviation'));
  const ambiguous = { ...general, revision: saved.revision, aliases: [...general.aliases, 'Unclear Polio'], contextualAliases: [...general.contextualAliases, 'Unclear Polio'] };
  assert.throws(() => saveCatalogProduct(saved, ambiguous, 'admin'), /Context-required/);
  assert.throws(() => saveCatalogProduct(saved, { ...general, revision: saved.revision, aliases: [...general.aliases, 'IPV'] }, 'admin'), /already belongs/);
  applyCatalog(catalog);
});
