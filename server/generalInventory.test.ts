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

test('all comparisons include deferred products and summary quantities without a repeated quantity row', () => {
  const record = audit();
  const rows = generalInventoryRows(record.items, record.generalAudit);
  assert.equal(rows.length, 2);
  const html = markup(record);
  assert.equal((html.match(/<article/g) || []).length, 2);
  assert.match(html, /Paracetamol 500mg Tablet/);
  assert.match(html, /Requested: 20/);
  assert.match(html, /Fulfilled: 2/);
  assert.doesNotMatch(html, /<span>Requested:|<span>Fulfilled:|<span>Difference:/);
  assert.match(html, /1 product requires customer verification/);
  assert.equal((html.match(/<details/g) || []).length, 3);
  assert.equal((html.match(/data-product-details/g) || []).length, 2);
  assert.match(html, /<summary[^>]*><h4 class="inline">Paracetamol 500mg<\/h4><span[^>]*>Customer Confirmation Required<\/span><span[^>]*>Requested: 20 .*Fulfilled: 2 .*<\/span><\/summary>/);
  assert.ok(html.indexOf('<details') < html.indexOf('</article>'), 'controls belong to the relevant card');
  assert.doesNotMatch(html, /<details[^>]* open/);
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
  assert.match(markup(stored), /Product Discrepancy/);
  assert.equal(stored.items.find(item => item.name === 'ORS')!.difference, 5);
  assert.equal(stored.allMatch, false);
  assert.equal(await send(tablet.key, suppository.key), 200);
  assert.equal(stored.generalAudit.productVerifications![0].confirmationHistory?.length, 2);
  assert.match(markup(stored), /Customer Verified — Product Match/);
  assert.match(markup(stored), /Order Limit Verification Required/);
});

test('pending-product navigation opens only the selected inline panel', async () => {
  const { parseHTML } = await import('linkedom');
  const { window } = parseHTML('<html><body><div id="inventory"></div></body></html>');
  const previous = { window: globalThis.window, document: globalThis.document, act: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(window.document.getElementById('inventory')!);
  try {
    const record = audit(customer + '\nInjection cipro -15', fulfillment + '\nCiprofloxacin 2mg/mL Infusion 100mL [10/10]');
    await act(async () => { root.render(createElement(Inventory, { items: record.items, details: record.generalAudit, onConfirm: async () => {}, onOrderLimit() {} })); });
    window.document.querySelectorAll('article').forEach(card => { (card as any).scrollIntoView = () => {}; });
    const buttons = window.document.querySelectorAll('nav button');
    const panels = window.document.querySelectorAll('article details[aria-label]');
    assert.equal(buttons.length, 2);
    assert.equal(panels.length, 2);
    await act(async () => { buttons[1].dispatchEvent(new window.Event('click', { bubbles: true })); });
    assert.equal((panels[1] as HTMLDetailsElement).open, true);
    assert.equal((panels[1].parentElement!.parentElement as HTMLDetailsElement).open, true, 'navigation reveals the product details');
    assert.ok(!(panels[0] as HTMLDetailsElement).open);
    await act(async () => { buttons[0].dispatchEvent(new window.Event('click', { bubbles: true })); });
    assert.equal((panels[0] as HTMLDetailsElement).open, true);
    assert.equal((panels[1] as HTMLDetailsElement).open, true, 'other product stays open');
    const changed = audit(customer + '\nInjection cipro -15', fulfillment + '\nCiprofloxacin 2mg/mL Infusion 100mL [9/10]');
    await act(async () => { root.render(createElement(Inventory, { items: changed.items, details: changed.generalAudit, onConfirm: async () => {}, onOrderLimit() {} })); });
    assert.equal((panels[0] as HTMLDetailsElement).open, true, 'unrelated product retains its panel state');
    assert.equal((panels[1] as HTMLDetailsElement).open, false, 'changed product resets stale verification controls');
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act });
  }
});
