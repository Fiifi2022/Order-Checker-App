import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { applyCatalog, defaultProducts } from './productCatalog';
import { applyGeneralProductConfirmation, runGeneralAuditor } from './generalAuditor';
import { buildGeneralReport, setupGeneralProductReview } from '../extension/general-report.js';
import { rememberGeneralAudit, restoreGeneralAudit } from '../extension/general-session.js';
import { generalProductConfirmationHandler } from './generalProductConfirmation';
const sources = { whatsappMessage: 'Orderer: Obed Kamkam\nFacility: Amantenaman Health Centre\nParacetamol 500mg -20\nORS -10', fulfillmentConfirmation: 'Orderer: Obed Kamkam\nFacility: Amantenaman Health Centre\nParacetamol 500mg Tablet [2/20]\nORS [5/10]' };
function initial(inputs = sources) { applyCatalog({ revision: 1, products: defaultProducts() }); return { ...runGeneralAuditor(inputs.whatsappMessage, inputs.fulfillmentConfirmation), ...inputs, id: 'extension-audit' }; }
const noControls = /data-review-key|data-confirm-product|data-customer-contact|<select|Confirm Dosage|Dosage \/ formulation/;
test('extension inventory explains independent product and quantity reviews without formulation controls', () => {
  const record = initial(), html = buildGeneralReport(record);
  assert.equal((html.match(/<article/g) || []).length, 2);
  assert.match(html, /REVIEW REQUIRED/); assert.match(html, /ORDER LIMIT REVIEW/);
  assert.match(html, /20 requested, 2 fulfilled/); assert.doesNotMatch(html, noControls);
  const unsafe = structuredClone(record); unsafe.generalAudit.productVerifications![0].productName = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(buildGeneralReport(unsafe), /<img src=x/);
});
test('rendering unresolved extension results cannot send a confirmation or mutate saved history', () => {
  const { document, window } = parseHTML('<div id="results"></div>'); const root = document.getElementById('results')!;
  const record = initial(), before = JSON.stringify(record); let calls = 0;
  const controller = setupGeneralProductReview({ root, request: async () => { calls++; }, getResult: () => record, getSources: () => record, contextKey: () => 'cca', onSaved() {}, rerender() {} });
  root.innerHTML = controller.render(record);
  root.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(calls, 0); assert.equal(JSON.stringify(record), before);
  assert.equal(root.querySelector('[data-confirm-product]'), null);
});
test('persisted product confirmation still updates shared statuses while preserving independent quantities', async () => {
  let record = initial(); const target = record.generalAudit.productVerifications![0]; let saves = 0;
  const handler = generalProductConfirmationHandler({ read: async () => record, save: async updated => { record = updated; saves++; } });
  let status = 200;
  await handler({ params: { id: record.id }, body: { ...sources, key: target.key, productKey: target.options.find(option => option.fromFulfillment)!.key, customerContactConfirmed: true } } as any, { locals: { authUser: { id: 'cca', name: 'CCA' } }, status(value: number) { status = value; return this; }, json() {} } as any, () => {});
  assert.equal(status, 200); assert.equal(saves, 1); assert.ok(record.generalAudit.productVerifications![0].confirmation);
  assert.equal(record.items.find(item => item.name === 'ORS')!.difference, 5);
  const html = buildGeneralReport(record); assert.match(html, /Shortfall: 18/); assert.doesNotMatch(html, noControls);
});
test('a failed legacy confirmation save cannot display a successful product result', async () => {
  const record = initial(), target = record.generalAudit.productVerifications![0], before = JSON.stringify(record); let status = 200;
  const handler = generalProductConfirmationHandler({ read: async () => record, save: async () => { throw Error('offline'); } });
  await handler({ params: { id: record.id }, body: { ...sources, key: target.key, productKey: target.options[0].key, customerContactConfirmed: true } } as any, { locals: { authUser: { id: 'cca', name: 'CCA' } }, status(value: number) { status = value; return this; }, json() {} } as any, () => {});
  assert.equal(status, 503); assert.equal(JSON.stringify(record), before);
  assert.match(buildGeneralReport(record), /REVIEW REQUIRED/); assert.doesNotMatch(buildGeneralReport(record), /Product and quantity verified/);
});
test('saved extension confirmation restores only matching inputs, backend and signed-in account', async () => {
  const original = (globalThis as any).chrome; let storage: any = { authSession: { email: 'cca@example.com' } }; let reads = 0;
  (globalThis as any).chrome = { storage: { session: { async get() { return storage; }, async set(value: any) { Object.assign(storage, value); } } } };
  try {
    const record = initial(), product = record.generalAudit.productVerifications![0];
    const saved = applyGeneralProductConfirmation(record, product.key, product.options[0].key, true);
    await rememberGeneralAudit(saved, 'http://localhost:3000'); const request = async () => { reads++; return saved; };
    assert.ok((await restoreGeneralAudit(request, 'http://localhost:3000', sources))?.generalAudit.productVerifications![0].confirmation);
    assert.equal(await restoreGeneralAudit(request, 'https://other.example.com', sources), null);
    assert.equal(await restoreGeneralAudit(request, 'http://localhost:3000', { ...sources, whatsappMessage: sources.whatsappMessage + '\nORS -1' }), null);
    storage.authSession = { email: 'different@example.com' };
    assert.equal(await restoreGeneralAudit(request, 'http://localhost:3000', sources), null); assert.equal(reads, 1);
  } finally { (globalThis as any).chrome = original; }
});
test('multiple uncertain medicines retain independent review records and render without obsolete panels', () => {
  const record = initial({ whatsappMessage: sources.whatsappMessage + '\nInjection cipro -15', fulfillmentConfirmation: sources.fulfillmentConfirmation + '\nCiprofloxacin 2mg/mL Infusion 100mL [10/10]' });
  const [first, other] = record.generalAudit.productVerifications!;
  const saved = applyGeneralProductConfirmation(record, first.key, first.options.find(option => option.fromFulfillment)!.key, true);
  assert.equal(saved.generalAudit.productVerifications!.find(product => product.key === other.key)!.confirmation, undefined);
  assert.equal((buildGeneralReport(saved).match(/<article/g) || []).length, 3);
  assert.doesNotMatch(buildGeneralReport(saved), noControls);
});
