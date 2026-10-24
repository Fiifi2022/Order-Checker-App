import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyCatalog, defaultProducts } from './productCatalog';
import { runGeneralAuditor, applyGeneralProductConfirmation } from './generalAuditor';
import { restoreGeneralProductConfirmations } from '../src/utils/generalProductConfirmationPersistence';
import Inventory, { generalInventoryRows } from '../src/components/GeneralInventory';
import { generalProductConfirmationHandler } from './generalProductConfirmation';

const customer = 'Orderer: John Mensah\nFacility: Alpha HC\nParacetamol 500mg 20/20\nORS - 10';
const fulfillment = 'Orderer: John Mensah\nFacility: Alpha HC\nParacetamol 500mg Tablet — 2 supplied\nORS [5/10]';
function audit(request = customer, supplied = fulfillment) {
  applyCatalog({ revision: 1, products: defaultProducts() });
  return { ...runGeneralAuditor(request, supplied), whatsappMessage: request, fulfillmentConfirmation: supplied, id: 'inventory' };
}
const markup = (record: ReturnType<typeof audit>) => renderToStaticMarkup(createElement(Inventory, {
  items: record.items, details: record.generalAudit, onConfirm: async () => {}, onOrderLimit() {},
})).replace(/<!--.*?-->/g, '');

test('all comparisons include deferred products, full names and separate quantities', () => {
  const record = audit();
  const rows = generalInventoryRows(record.items, record.generalAudit);
  assert.equal(rows.length, 2);
  const html = markup(record);
  assert.equal((html.match(/<article/g) || []).length, 2);
  assert.match(html, /Paracetamol 500mg Tablet/);
  assert.match(html, /Requested: 20/);
  assert.match(html, /Fulfilled: 2/);
  assert.match(html, /20 requested, 2 fulfilled/);
  assert.match(html, /REVIEW REQUIRED/);
  assert.doesNotMatch(html, /<details|<select|Confirm Dosage|customer verification/);
  assert.match(html, /flex flex-wrap/);
  assert.match(html, /min-w-0/);
});

test('unrelated source edits retain confirmation; relevant fulfilment changes invalidate it', () => {
  const initial = audit();
  const product = initial.generalAudit.productVerifications![0];
  const verified = applyGeneralProductConfirmation(initial, product.key, product.options.find(option => option.fromFulfillment)!.key, true, { id: 'cca', name: 'CCA' });
  const saved = JSON.parse(JSON.stringify(verified));
  const restored = restoreGeneralProductConfirmations(audit(customer.replace('ORS - 10', 'ORS - 12')), saved);
  assert.equal(restored.generalAudit.productVerifications![0].status, 'customer verified');
  assert.equal(restored.items.find(item => item.name === 'ORS')!.fulfillment.requested, 12);
  const invalidated = restoreGeneralProductConfirmations(audit(customer, fulfillment.replace('2 supplied', '3 supplied')), saved);
  assert.equal(invalidated.generalAudit.productVerifications![0].confirmation, undefined);
});

test('correction records the previous actor and formulation and preserves other quantities', async () => {
  let stored = audit();
  const product = stored.generalAudit.productVerifications![0];
  const tablet = product.options.find(option => option.fromFulfillment)!;
  const suppository = product.options.find(option => /suppository/i.test(option.name))!;
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async record => { stored = record; } });
  const send = async (productKey: string, previousProductKey?: string) => {
    let status = 200;
    await handler({ params: { id: 'inventory' }, body: { key: product.key, productKey, previousProductKey,
      whatsappMessage: customer, fulfillmentConfirmation: fulfillment, customerContactConfirmed: true } } as any,
      { locals: { authUser: { id: 'cca', name: 'CCA' } }, status(code: number) { status = code; return this; }, json() {} } as any, () => {});
    return status;
  };
  assert.equal(await send(tablet.key), 200);
  assert.equal(await send(suppository.key), 409, 'stale corrections require the last saved selection');
  assert.equal(await send(suppository.key, tablet.key), 200);
  const corrected = stored.generalAudit.productVerifications![0];
  assert.equal(corrected.confirmationHistory?.[0].productKey, tablet.key);
  assert.equal(corrected.confirmationHistory?.[0].confirmedBy?.name, 'CCA');
  assert.equal(corrected.confirmation?.productKey, suppository.key);
  assert.match(markup(stored), /PRODUCT DETAILS MISMATCH/);
  assert.equal(stored.items.find(item => item.name === 'ORS')!.difference, 5);
  assert.equal(stored.allMatch, false);
  assert.equal(await send(tablet.key, suppository.key), 200);
  assert.equal(stored.generalAudit.productVerifications![0].confirmationHistory?.length, 2);
  assert.match(markup(stored), /ORDER LIMIT REVIEW/);
  assert.match(markup(stored), /ORDER LIMIT REVIEW/);
});

test('multiple pending products retain independent source quantities without confirmation navigation', () => {
  const record = audit(customer + '\nInjection cipro -15', fulfillment + '\nCiprofloxacin 2mg/mL Infusion 100mL [10/10]');
  const html = markup(record);
  assert.equal((html.match(/<article/g) || []).length, 3);
  assert.doesNotMatch(html, /<nav|<select|Confirm Dosage|data-confirm-product/);
  assert.match(html, /Requested: 20/); assert.match(html, /Requested: 15/);
  const changed = audit(customer + '\nInjection cipro -15', fulfillment + '\nCiprofloxacin 2mg/mL Infusion 100mL [9/10]');
  const next = markup(changed);
  assert.match(next, /Fulfilled: 9/); assert.match(next, /Fulfilled: 2/);
  assert.equal(changed.generalAudit.productVerifications!.length, 2);
});
