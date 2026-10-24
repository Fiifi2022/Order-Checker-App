import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCatalog, defaultProducts } from './productCatalog';
import { changeGeneralProductAlias, generalAliasApprovalEvidence, generalProductAliasHandlers } from './generalProductAliases';
import { emptyGeneralProductAliases } from '../shared/generalProductAliases';
import { runGeneralAuditor, normalizeGeneralProductName, applyGeneralProductConfirmation } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { attachGeneralAiProductSuggestions } from './generalAiProductSuggestions';
import { generalProductConfirmationHandler } from './generalProductConfirmation';
import { generalAiCandidateEligible } from '../src/utils/generalAiProductSuggestion';
import { canAccess } from './auth';
import Inventory from '../src/components/GeneralInventory';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { restoreGeneralProductConfirmations } from '../src/utils/generalProductConfirmationPersistence';
import { buildGeneralReport, setupGeneralProductReview } from '../extension/general-report.js';

const actor = { id: 'cca-one', name: 'CCA One' };
const names = ['Paracetamol 500mg Tablet', 'Paracetamol 250mg Tablet', 'Diclofenac 25mg/mL Injection 3mL', 'Diclofenac 25mg/5mL Injection', 'Ciprofloxacin 2mg/mL Infusion 100mL'];
const products = [...defaultProducts(), ...names.map((name, i) => ({ id: `learning-${i}`, name, scope: 'general' as const, category: 'medicine', aliases: [], contextualAliases: [], note: '' }))];
const catalog = { revision: 300, products };
const headers = 'Orderer: John Mensah\nFacility: Alpha HC\n';
const run = (a: string, b: string) => runGeneralAuditor(headers + a, headers + b);
const approve = (wording = 'Peecee 500mg Tabs', id = 'learning-0', state = emptyGeneralProductAliases()) => changeGeneralProductAlias(state, { action: 'approve', originalWording: wording, catalogProductId: id }, catalog, actor, '2026-10-24T01:00:00Z');
function seed() { applyCatalog(catalog); }

test('explicit alias approval preserves wording, canonical ID, clinical constraints, actor and history', () => {
  seed(); const state = approve(); const alias = state.aliases[0];
  assert.equal(alias.originalWording, 'Peecee 500mg Tabs'); assert.equal(alias.catalogProductId, 'learning-0');
  assert.equal(alias.confirmedBy.id, actor.id); assert.equal(alias.history[0].action, 'approved'); assert.equal(alias.recognition, 'complete');
  assert.deepEqual(alias.constraints.measurements, ['500mg']);
  assert.notEqual(normalizeGeneralProductName(alias.originalWording), normalizeGeneralProductName(alias.canonicalName));
  applyCatalog({ ...catalog, productNameAliases: state });
  assert.equal(normalizeGeneralProductName(alias.originalWording), normalizeGeneralProductName(alias.canonicalName));
  assert.equal(run('Peecee 500mg Tabs -7', 'Paracetamol 500mg Tablet [7/7]').allMatch, true);
  assert.equal(run('Tabs Peecee 500mg -7', 'Paracetamol 500mg Tablet [7/7]').allMatch, true);
  assert.equal(run('Peecee 250mg Tabs -7', 'Paracetamol 500mg Tablet [7/7]').allMatch, false);
});
test('approved aliases avoid Gemini in future audits, including quota exhaustion', async () => {
  seed(); applyCatalog({ ...catalog, productNameAliases: approve() }); let calls = 0;
  const result = await runGeneralSemanticAudit(headers + 'Peecee 500mg Tabs -7', headers + 'Paracetamol 500mg Tablet [7/7]', {}, {}, () => { calls++; throw Object.assign(Error('quota'), { status: 429 }); });
  assert.equal(result.allMatch, true); assert.equal(calls, 0);
});
test('learning does not fill omitted strength or dosage form', () => {
  seed(); const state = approve('Peecee'); assert.equal(state.aliases[0].recognition, 'identity only');
  applyCatalog({ ...catalog, productNameAliases: state });
  const result = run('Peecee -7', 'Paracetamol 500mg Tablet [7/7]');
  assert.equal(result.allMatch, false); assert.equal(result.generalAudit.productVerifications?.length, 1);
});
test('duplicate approval is idempotent and conflicting dictionary edits require the current revision', () => {
  seed(); const state = approve(); assert.deepEqual(approve('  Peecee 500mg Tabs  ', 'learning-0', state), state);
  assert.throws(() => approve('Peecee 500mg Tabs', 'learning-1', state), /conflict|already exists/);
  assert.throws(() => changeGeneralProductAlias(state, { action: 'disable', id: state.aliases[0].id, revision: 0 }, catalog, actor), /changed/);
});
test('disable, correction and reactivation retain the complete editing history', () => {
  seed(); let state = approve(); const id = state.aliases[0].id;
  state = changeGeneralProductAlias(state, { action: 'disable', id, revision: state.revision }, catalog, actor);
  applyCatalog({ ...catalog, productNameAliases: state }); assert.notEqual(normalizeGeneralProductName('Peecee 500mg Tabs'), normalizeGeneralProductName(names[0]));
  state = changeGeneralProductAlias(state, { action: 'correct', id, revision: state.revision, catalogProductId: 'learning-0' }, catalog, actor);
  assert.deepEqual(state.aliases[0].history.map(entry => entry.action), ['approved', 'disabled', 'corrected']);
  assert.equal(state.aliases[0].status, 'approved');
});
for (const [wording, id] of [['PCM 250mg Tablet', 'learning-0'], ['PCM 500mg Injection', 'learning-0'], ['Paracetamol 500mg Tablet oral', 'learning-0'], ['Paracetamol 500mg Tablet SR', 'learning-0'], ['Ibuprofen 500mg Tablet', 'learning-0'], ['Diclofenac 25mg/5mL Injection', 'learning-2']] as const) {
  test(`permanent learning cannot override clinical evidence: ${wording}`, () => {
    seed();
    // Missing route on the canonical entry is retained as source evidence, not erased.
    if (/oral/.test(wording)) { assert.equal(approve(wording, id).aliases[0].recognition, 'identity only'); return; }
    assert.throws(() => approve(wording, id), /conflict/);
  });
}
test('saved-audit evidence cannot be replaced by caller-supplied wording or catalogue IDs', async () => {
  seed(); const record = { ...run('PCM Tabs 500mg -7', 'Paracetamol 500mg Tablet [7/7]'), id: 'audit-one' };
  const evidence = generalAliasApprovalEvidence(record, record.items[0].fulfillment.key, catalog);
  assert.equal(evidence.originalWording, 'PCM Tabs 500mg'); assert.equal(evidence.catalogProductId, 'learning-0');
  assert.throws(() => generalAliasApprovalEvidence(record, 'forged', catalog), /saved audit/);
  const handlers = generalProductAliasHandlers({ readCatalog: async () => catalog, readAudit: async () => record, change: async input => approve(input.originalWording, input.catalogProductId) });
  let status = 200, response: any;
  await handlers.save({ body: { action: 'approve', auditId: record.id, key: record.items[0].fulfillment.key, approvePermanently: true, originalWording: 'forged', catalogProductId: 'learning-1' } } as any, { locals: { authUser: { ...actor, role: 'cca' } }, setHeader() {}, status(code: number) { status = code; return this; }, json(value: any) { response = value; } } as any, () => {});
  assert.equal(status, 200); assert.equal(response.aliases[0].originalWording, 'PCM Tabs 500mg');
  assert.equal(canAccess('cca', 'POST', '/general/product-aliases'), true); assert.equal(canAccess('invalid', 'POST', '/general/product-aliases'), false);
});
function aiFixture() {
  seed(); const customer = headers + 'Peecee 500mg Tabs -7', fulfillment = headers + 'Paracetamol 500mg Tablet [7/7]';
  const base = runGeneralAuditor(customer, fulfillment);
  const result = attachGeneralAiProductSuggestions({ ...base, semanticAnalysis: { status: 'used' }, generalAudit: { ...base.generalAudit, semanticReviews: [{ source: 'customer_request' as const, kind: 'product' as const, originalText: 'Peecee 500mg Tabs -7', possibleMatches: [names[0], 'Invented medicine'], reason: 'Informal name may refer to Paracetamol; confirm with the customer.' }] } }, customer, fulfillment);
  return { ...result, id: 'ai-audit', whatsappMessage: customer, fulfillmentConfirmation: fulfillment };
}
test('AI candidates are catalogue-backed, require customer verification, and confirmation never learns automatically', () => {
  const record = aiFixture(), product = record.generalAudit.productVerifications![0];
  assert.equal(product.kind, 'ai product match'); assert.equal(product.options.length, 1); assert.equal(product.options[0].catalogProductId, 'learning-0');
  assert.equal(record.allMatch, false);
  assert.throws(() => applyGeneralProductConfirmation(record, product.key, product.options[0].key, false));
  const confirmed = applyGeneralProductConfirmation(record, product.key, product.options[0].key, true, actor);
  assert.equal(confirmed.items[0].status, 'match'); assert.equal(confirmed.generalAudit.productVerifications![0].confirmation?.confirmedBy?.id, actor.id);
  assert.notEqual(normalizeGeneralProductName('Peecee 500mg Tabs'), normalizeGeneralProductName(names[0]));
});
test('rejecting an AI suggestion persists rejection without clearing product review', async () => {
  const record = aiFixture(), product = record.generalAudit.productVerifications![0]; let saved: any, status = 200;
  const handler = generalProductConfirmationHandler({ read: async () => record, save: async value => { saved = value; } });
  await handler({ params: { id: record.id }, body: { key: product.key, productKey: product.options[0].key, rejectSuggestion: true, whatsappMessage: record.whatsappMessage, fulfillmentConfirmation: record.fulfillmentConfirmation } } as any, { locals: { authUser: actor }, status(code: number) { status = code; return this; }, json() {} } as any, () => {});
  assert.equal(status, 200); assert.equal(saved.allMatch, false); assert.equal(saved.generalAudit.productVerifications[0].options.length, 0);
  assert.equal(saved.generalAudit.productVerifications[0].rejectedSuggestions[0].rejectedBy.id, actor.id);
  assert.throws(() => applyGeneralProductConfirmation(saved, product.key, product.options[0].key, true), /current catalogue/);
});
test('AI cannot offer known different ingredients, strengths, generic placeholders or fabricated catalogue entries', () => {
  seed();
  for (const source of ['Ibuprofen 500mg Tablet', 'PCM 250mg Tablet', 'unknown medicine', 'something']) assert.equal(generalAiCandidateEligible(source, names[0], normalizeGeneralProductName), false, source);
});
test('different concentrations require verification while equal quantities remain a match in both app and extension', () => {
  seed(); const record = run('Diclofenac 25mg/5mL Injection -7', 'Diclofenac 25mg/mL Injection 3mL [7/7]');
  assert.equal(record.allMatch, false); assert.equal(record.generalAudit.productVerifications?.length, 1);
  const html = renderToStaticMarkup(createElement(Inventory, { items: record.items, details: record.generalAudit, onOrderLimit() {} }));
  assert.match(html, /PRODUCT DETAILS MISMATCH/); assert.doesNotMatch(html, /Confirm Dosage|<select/);
  assert.match(buildGeneralReport(record), /PRODUCT DETAILS MISMATCH/);
  assert.throws(() => approve('Diclofenac 25mg/5mL Injection', 'learning-2'), /concentration/);
});

test('Gemini rich interpretation becomes an inline candidate through the complete audit pipeline', async () => {
  seed(); let calls = 0;
  const row = 'Peecee 500mg Tabs -7', counterpart = 'Paracetamol 500mg Tablet [7/7]';
  const entry = { status: 'AMBIGUOUS_PRODUCT', originalText: row, interpretedProduct: null, canonicalProductName: null, acronymDetected: null, acronymMeaning: null, synonymsDetected: [], brandNameDetected: null, genericName: null, dosage: null, formulation: null, strength: null, quantity: 7, quantityText: '7', unit: null, confidence: 0.7, reasoningNote: 'Confirm informal wording.', possibleMatches: [names[0]] };
  const absent = { customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 };
  const result = await runGeneralSemanticAudit(headers + row, headers + counterpart, {}, { semanticCacheScope: 'new-alias-rich' }, () => ({ models: { async generateContent() { calls++; return { text: JSON.stringify({ orderer: absent, facility: absent, customerProducts: [entry], fulfilmentProducts: [], semanticWarnings: [] }) }; } } }));
  assert.equal(calls, 1); assert.equal(result.generalAudit.productVerifications?.[0].kind, 'ai product match'); assert.equal(result.allMatch, false);
  const product = result.generalAudit.productVerifications![0];
  assert.equal(applyGeneralProductConfirmation(result, product.key, product.options[0].key, true, actor).allMatch, true);
});
test('hybrid extraction can suggest catalogue IDs without inventing resolved product fields', async () => {
  seed(); let calls = 0;
  const row = 'Peecee 500mg Tabs -7';
  const empty = { facilityName: null, ordererName: null, products: [], deliveryArea: null, district: null, unresolvedFields: ['products'], extractionConfidence: 0.7 };
  const result = await runGeneralSemanticAudit(row, 'Paracetamol 500mg Tablet [7/7]', {}, { semanticCacheScope: 'new-alias-hybrid' }, () => ({ models: { async generateContent(options: any) { calls++;
    assert.ok(JSON.parse(options.contents).productCatalogue.some((product: any) => product.id === 'learning-0'));
    return { text: JSON.stringify({ customer: empty, fulfillment: empty, productMatchSuggestions: [{ originalText: row, catalogueProductIds: ['learning-0', 'invented'], reason: 'Informal wording needs customer verification.' }] }) };
  } } }));
  assert.equal(calls, 1); assert.equal(result.generalAudit.productVerifications?.[0].kind, 'ai product match'); assert.equal(result.allMatch, false);
  assert.equal(result.generalAudit.productVerifications?.[0].options.length, 1);
});
test('ambiguous approved aliases require review and cannot claim the same fulfillment twice', () => {
  seed(); const state = approve(); state.aliases.push({ ...state.aliases[0], id: 'conflicting-entry', catalogProductId: 'learning-1', canonicalName: names[1] });
  applyCatalog({ ...catalog, productNameAliases: state }); assert.notEqual(normalizeGeneralProductName('Peecee 500mg Tabs'), normalizeGeneralProductName(names[0]));
  assert.equal(run('Peecee 500mg Tabs -7', 'Paracetamol 500mg Tablet [7/7]').allMatch, false);
});

test('approval is explicit and storage failures cannot report a learned alias', async () => {
  seed(); const record = { ...run('PCM Tabs 500mg -7', 'Paracetamol 500mg Tablet [7/7]'), id: 'alias-save' };
  let writes = 0;
  const handlers = generalProductAliasHandlers({ readCatalog: async () => catalog, readAudit: async () => record, change: async () => { writes++; throw Error('storage unavailable'); } });
  const send = async (body: any, role = 'cca') => {
    let status = 200, value: any;
    await handlers.save({ body } as any, { locals: { authUser: { ...actor, role } }, setHeader() {}, status(code: number) { status = code; return this; }, json(data: any) { value = data; } } as any, () => {});
    return { status, value };
  };
  const input = { action: 'approve', auditId: record.id, key: record.items[0].fulfillment.key };
  assert.equal((await send(input)).status, 400); assert.equal(writes, 0);
  assert.equal((await send({ ...input, approvePermanently: true }, 'unapproved')).status, 403); assert.equal(writes, 0);
  const failed = await send({ ...input, approvePermanently: true }); assert.equal(failed.status, 503); assert.equal(failed.value.aliases, undefined);
});
test('a newly conflicting catalogue alias prevents automatic learned recognition', () => {
  seed(); const state = approve();
  const changed = { ...catalog, products: [...products, { ...products.find(product => product.id === 'learning-1')!, id: 'conflicting-catalogue-alias', aliases: ['Peecee 500mg Tabs'] }], productNameAliases: state };
  applyCatalog(changed);
  assert.equal(run('Peecee 500mg Tabs -7', 'Paracetamol 500mg Tablet [7/7]').allMatch, false);
});

test('extension AI candidates remain under review without selection or confirmation controls', () => {
  const record = aiFixture(), original = JSON.stringify(record);
  const html = buildGeneralReport(record);
  assert.match(html, /REVIEW REQUIRED/);
  assert.doesNotMatch(html, /<select|data-reject-suggestion|data-confirm-product|Confirm Dosage/);
  assert.equal(JSON.stringify(record), original);
  assert.equal(record.generalAudit.productVerifications![0].confirmation, undefined);
});
test('extension wording approval reports a successful save only after the explicit API action', async () => {
  seed(); const record = { ...run('PCM Tabs 500mg -7', 'Paracetamol 500mg Tablet [7/7]'), id: 'extension-alias', whatsappMessage: headers + 'PCM Tabs 500mg -7', fulfillmentConfirmation: headers + 'Paracetamol 500mg Tablet [7/7]' };
  let calls = 0, offline = true;
  const { document, window } = parseHTML('<div id="root"></div>'); const root = document.getElementById('root')!;
  const controller = setupGeneralProductReview({ root, getResult: () => record, getSources: () => record, contextKey: () => 'same-account', onSaved() {}, rerender: () => { root.innerHTML = controller.render(record); },
    request: async (url: string, options: any) => {
      calls++; assert.equal(url, '/api/general/product-aliases'); const input = JSON.parse(options.body);
      assert.equal(input.approvePermanently, true); assert.equal(input.auditId, record.id);
      if (offline) throw Error('Dictionary save failed. Retry.');
      return changeGeneralProductAlias(emptyGeneralProductAliases(), { action: 'approve', ...generalAliasApprovalEvidence(record, input.key, catalog) }, catalog, actor);
    },
  });
  root.innerHTML = controller.render(record); assert.equal(calls, 0);
  const click = () => root.querySelector('[data-learn-alias]')!.dispatchEvent(new window.Event('click', { bubbles: true }));
  click(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 1); assert.match(root.textContent!, /Dictionary save failed/); assert.doesNotMatch(root.textContent!, /Verified wording saved/);
  offline = false; click(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 2); assert.match(root.textContent!, /Verified wording saved for future audits/);
});

test('reordered learned compound wording cannot move doses between constituent names', () => {
  seed(); const product = { id: 'learned-compound', name: 'Amoxicillin 500mg Clavulanic Acid 125mg Tablet', scope: 'general' as const, category: 'medicine', aliases: [], contextualAliases: [], note: '' };
  const compoundCatalog = { ...catalog, products: [...products, product] }; applyCatalog(compoundCatalog);
  const state = changeGeneralProductAlias(emptyGeneralProductAliases(), { action: 'approve', originalWording: 'Foo 500mg Bar 125mg Tablet', catalogProductId: product.id }, compoundCatalog, actor);
  applyCatalog({ ...compoundCatalog, productNameAliases: state });
  assert.equal(normalizeGeneralProductName('Foo 500mg Bar 125mg Tablet'), normalizeGeneralProductName(product.name));
  assert.notEqual(normalizeGeneralProductName('Bar 500mg Foo 125mg Tablet'), normalizeGeneralProductName(product.name));
});
