import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generalInputFingerprint, sameGeneralAuditSources } from '../shared/generalAuditFingerprint';
import { restoreGeneralProductConfirmations } from '../src/utils/generalProductConfirmationPersistence';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import Inventory from '../src/components/GeneralInventory';
import { runGeneralAuditor, applyGeneralOrderLimitDecision } from './generalAuditor';
import { generalProductConfirmationHandler } from './generalProductConfirmation';
import { defaultProducts, applyCatalog } from './productCatalog';

const sources = { whatsappMessage: 'Orderer: John Mensah\nFacility: Alpha HC\n4 Paracetamol 500mg 20/20',
  fulfillmentConfirmation: 'Orderer: John Mensah\nFacility: Alpha HC\nParacetamol 500mg Tablet — 2 supplied' };
const seed = defaultProducts();
const actor = { id: 'cca', name: 'Test CCA' };
function audit(inputs = sources) {
  applyCatalog({ revision: 1, products: seed });
  return { ...runGeneralAuditor(inputs.whatsappMessage, inputs.fulfillmentConfirmation), ...inputs,
    auditEngine: 'general-deterministic-v1', id: 'saved-audit', timestamp: new Date().toISOString() };
}
async function send(handler: any, body: any) {
  let status = 200, data: any;
  await handler({ params: { id: 'saved-audit' }, body }, { locals: { authUser: actor },
    status(value: number) { status = value; return this; }, json(value: any) { data = value; return this; } });
  return { status, data };
}
function confirmationBody(record: ReturnType<typeof audit>) {
  const product = record.generalAudit.productVerifications![0];
  return { ...sources, key: product.key, productKey: product.options.find(option => option.fromFulfillment)!.key,
    customerContactConfirmed: true, inputFingerprint: generalInputFingerprint(record) };
}

test('source fingerprints ignore whitespace transport changes and audit metadata', () => {
  const formatted = { whatsappMessage: '\n  ' + sources.whatsappMessage.replaceAll('\n', '\r\n   ') + '  \n', fulfillmentConfirmation: sources.fulfillmentConfirmation + '\n' };
  assert.equal(generalInputFingerprint(formatted), generalInputFingerprint(sources));
  assert.equal(sameGeneralAuditSources(formatted, sources), true);
  for (const changed of [ { ...sources, whatsappMessage: sources.whatsappMessage.replace('20/20', '30/30') },
    { ...sources, fulfillmentConfirmation: sources.fulfillmentConfirmation.replace('Tablet', 'Suppository') } ]) {
    assert.notEqual(generalInputFingerprint(changed), generalInputFingerprint(sources));
  }
});

test('actual browser/server whitespace mismatch confirms immediately without a new audit', async () => {
  let stored = audit();
  let saves = 0;
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async record => { stored = record; saves++; } });
  const localInputs = { ...sources, whatsappMessage: '\n' + sources.whatsappMessage + '\n\n' };
  const browser = completeGeneralAuditRun(createGeneralAuditRun(localInputs, 1, {}, {}, true), stored);
  assert.notEqual(browser.whatsappMessage, stored.whatsappMessage, 'reproduce the original trimmed-source bug');
  const response = await send(handler, { ...confirmationBody(stored), whatsappMessage: browser.whatsappMessage, auditTimestamp: 'a metadata-only timestamp change' });
  assert.equal(response.status, 200);
  assert.equal(saves, 1);
  assert.equal(response.data.generalAudit.productVerifications[0].status, 'customer verified');
  assert.equal(response.data.generalAudit.productVerifications[0].confirmation.inputFingerprint, generalInputFingerprint(sources));
  assert.equal(response.data.generalAudit.semanticReviews?.some((review: any) => review.dosageFormKey), undefined);
  assert.equal(response.data.items[0].difference, 18);
  assert.equal(response.data.issueCount, 1);
  assert.equal(response.data.allMatch, false);
  const html = renderToStaticMarkup(createElement(Inventory, { items: response.data.items, details: response.data.generalAudit, onOrderLimit() {} }));
  assert.match(html, /text-amber-800/);
  assert.match(html, /ORDER LIMIT REVIEW/);
  assert.doesNotMatch(html, /Customer Confirmation Required|omits the dosage form/);
});

test('saved decisions persist on refresh, reopening, recalculation and unrelated limit resolution', async () => {
  let stored = audit();
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async record => { stored = record; } });
  await send(handler, confirmationBody(stored));
  const saved = JSON.parse(JSON.stringify(stored));
  const originalConfirmation = saved.generalAudit.productVerifications[0].confirmation;
  const reopened = completeGeneralAuditRun(createGeneralAuditRun(sources, 2, {}, {}, true), saved);
  assert.deepEqual(reopened.generalAudit.productVerifications![0].confirmation, originalConfirmation);
  const recalculated = restoreGeneralProductConfirmations(audit(), saved);
  assert.deepEqual(recalculated.generalAudit.productVerifications![0].confirmation, originalConfirmation);
  assert.equal(recalculated.items[0].difference, 18);
  assert.equal(recalculated.issueCount, 1);
  const acknowledged = applyGeneralOrderLimitDecision(recalculated, recalculated.items[0].fulfillment.key, true);
  assert.deepEqual(acknowledged.generalAudit.productVerifications![0].confirmation, originalConfirmation);
  assert.equal(acknowledged.items[0].status, 'order limit applied');
  const recomputedLimited = restoreGeneralProductConfirmations(audit(), acknowledged);
  assert.equal(recomputedLimited.items[0].status, 'order limit applied');
  assert.deepEqual(recomputedLimited.generalAudit.productVerifications![0].confirmation, originalConfirmation);
});

test('material source changes reject a stale click and invalidate saved confirmations on recalculation', async () => {
  let stored = audit();
  const body = confirmationBody(stored);
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async record => { stored = record; } });
  const stale = await send(handler, { ...body, fulfillmentConfirmation: sources.fulfillmentConfirmation.replace('2 supplied', '3 supplied') });
  assert.equal(stale.status, 409);
  await send(handler, body);
  const changed = audit({ ...sources, whatsappMessage: sources.whatsappMessage.replace('20/20', '30/30') });
  const recalculated = restoreGeneralProductConfirmations(changed, stored);
  assert.equal(recalculated.generalAudit.productVerifications![0].status, 'customer confirmation required');
  assert.equal(recalculated.generalAudit.productVerifications![0].confirmation, undefined);
});

test('concurrent duplicate clicks save exactly one confirmation with one original timestamp', async () => {
  let stored = audit();
  let saves = 0;
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async record => { saves++; stored = record; } });
  const body = confirmationBody(stored);
  const [first, retry] = await Promise.all([send(handler, body), send(handler, body)]);
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(saves, 1);
  assert.deepEqual(first.data.generalAudit.productVerifications[0].confirmation, retry.data.generalAudit.productVerifications[0].confirmation);
  assert.equal(stored.generalAudit.productVerifications!.filter(product => product.confirmation).length, 1);
});

test('failed saving keeps the product under review and never reports success', async () => {
  const stored = audit();
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async () => { throw Error('offline'); } });
  const response = await send(handler, confirmationBody(stored));
  assert.equal(response.status, 503);
  const html = renderToStaticMarkup(createElement(Inventory, { items: stored.items, details: stored.generalAudit, onOrderLimit() {} }));
  assert.match(html, /text-amber-800/);
  assert.match(html, /REVIEW REQUIRED/);
  assert.doesNotMatch(html, /Product successfully confirmed|CUSTOMER VERIFIED/);
});

test('the actual UI confirmation handler immediately accepts the saved result despite transport whitespace', async () => {
  let stored = audit();
  const rawInputs = { ...sources, whatsappMessage: '\n  ' + sources.whatsappMessage + '\n' };
  const browser = completeGeneralAuditRun(createGeneralAuditRun(rawInputs, 1, {}, {}, true), stored);
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async record => { stored = record; } });
  let rendered: any = browser, requests = 0;
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const confirmGeneralProduct = async');
  const end = source.indexOf('  const answerGeneralOrderLimit', start);
  const context: any = vm.createContext({ result: browser, loading: false, productConfirmationInFlight: { current: false },
    currentGeneralInputs: { current: rawInputs }, generalAuditRevision: { current: 9 },
    sameGeneralAuditSources, generalInputFingerprint,
    setSavingProductConfirmation() {}, setResult(record: any) { rendered = record; }, fetchHistory() {},
    async authFetch(_url: string, options: any) {
      requests++;
      const response = await send(handler, JSON.parse(options.body));
      return { ok: response.status === 200, json: async () => response.data };
    },
  });
  vm.runInContext(ts.transpile(source.slice(start, end).replace('const confirmGeneralProduct =', 'globalThis.confirmGeneralProduct =')), context);
  const body = confirmationBody(stored);
  await context.confirmGeneralProduct(body.key, body.productKey);
  assert.equal(requests, 1, 'only the confirmation save is requested; Run Audit is never invoked');
  assert.equal(rendered.generalAudit.productVerifications[0].status, 'customer verified');
  assert.equal(rendered.items[0].difference, 18);
  assert.equal(rendered.allMatch, false);
  const html = renderToStaticMarkup(createElement(Inventory, { items: rendered.items, details: rendered.generalAudit, onOrderLimit() {} }));
  assert.match(html, /ORDER LIMIT REVIEW/);
  assert.match(html, /text-amber-800/);
});
