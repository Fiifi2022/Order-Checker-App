import { orderLimitAcknowledgementHandler } from './orderLimitAcknowledgement';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyCatalog, defaultProducts } from './productCatalog';
import { applyGeneralProductConfirmation, applyGeneralOrderLimitDecision, runGeneralAuditor } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { generalProductConfirmationHandler } from './generalProductConfirmation';
import Verification, { canConfirmGeneralProduct, GeneralProductVerificationControls } from '../src/components/GeneralProductVerification';
import Inventory from '../src/components/GeneralInventory';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';

const customer = 'Orderer: John Mensah\nFacility: Alpha HC\n4 Paracetamol 500mg 20/20';
const fulfillment = 'Orderer: John Mensah\nFacility: Alpha HC\nParacetamol 500mg Tablet — 2 supplied';
const actor = { id: 'cca-1', name: 'CCA Mary' };
const seedProducts = defaultProducts();
function initial() {
  applyCatalog({ revision: 1, products: seedProducts });
  return { ...runGeneralAuditor(customer, fulfillment), id: 'audit-test', timestamp: '2026-10-23T12:00:00Z', whatsappMessage: customer, fulfillmentConfirmation: fulfillment };
}
function choose(result: ReturnType<typeof initial>, form = 'Tablet') {
  const product = result.generalAudit.productVerifications![0];
  const option = product.options.find(option => new RegExp(`\\b${form}\\b`, 'i').test(option.name))!;
  assert.ok(option);
  return { product, option };
}

test('suggestions include the actual fulfilled tablet and only catalogue-supported alternatives', () => {
  const result = initial();
  const { product, option } = choose(result);
  assert.equal(product.status, 'customer confirmation required');
  assert.equal(product.suggestedProduct, 'Paracetamol 500mg Tablet');
  assert.equal(product.requestedQuantity, 20);
  assert.equal(product.suppliedQuantity, 2);
  assert.equal(product.requestedProducts[0].listNumber, 4);
  assert.equal(option.fromFulfillment, true);
  assert.ok(product.options.some(option => /suppository/i.test(option.name)));
  assert.ok(!product.options.some(option => /syrup/i.test(option.name)));
  assert.equal(product.confirmation, undefined);
  assert.equal(result.allMatch, false);
  const html = renderToStaticMarkup(createElement(Inventory, { items: result.items, details: result.generalAudit, onConfirm: async () => {}, onOrderLimit() {} }));
  assert.match(html, /REVIEW REQUIRED/);
  assert.match(html, /Fulfilment: Paracetamol 500mg Tablet/);
  assert.doesNotMatch(html, /Product: Confirm the requested product\./);
});

test('button requires both catalogue selection and explicit customer contact', () => {
  const { product, option } = choose(initial());
  for (const [selected, contacted, disabled, expected] of [
    ['', false, false, false], [option.key, false, false, false], ['', true, false, false],
    ['fake', true, false, false], [option.key, true, true, false], [option.key, true, false, true],
  ] as const) {
    assert.equal(canConfirmGeneralProduct(product, selected, contacted, disabled), expected);
    const html = renderToStaticMarkup(createElement(GeneralProductVerificationControls, {
      product, selected, contacted, disabled, onSelect() {}, onContact() {}, onConfirm() {},
    }));
    assert.equal(/<button[^>]* disabled=""/.test(html), !expected);
  }
});

test('confirmed tablet retains shortfall 18 and records customer contact, timestamp and CCA', () => {
  const original = initial();
  const { product, option } = choose(original);
  const result = applyGeneralProductConfirmation(original, product.key, option.key, true, actor, '2026-10-23T12:01:00Z');
  assert.equal(result.whatsappMessage, customer);
  assert.equal(result.items[0].requested, '20');
  assert.equal(result.items[0].found, '2');
  assert.equal(result.items[0].difference, 18);
  assert.equal(result.items[0].status, 'quantity mismatch');
  assert.equal(result.issueCount, 1);
  assert.equal(result.allMatch, false);
  const rendered = renderToStaticMarkup(createElement(Inventory, { items: result.items, details: result.generalAudit, onOrderLimit() {} })).replace(/<[^>]*>/g, '');
  assert.match(rendered, /ORDER LIMIT REVIEW/);
  assert.match(rendered, /Shortfall: 18/);
  assert.match(rendered, /ORDER LIMIT REVIEW/);
  assert.equal(result.generalAudit.productVerifications![0].status, 'customer verified');
  assert.deepEqual(result.generalAudit.productVerifications![0].confirmation, {
    productName: 'Paracetamol 500mg Tablet', productKey: option.key, formulation: 'tablet', customerContactConfirmed: true,
    confirmedAt: '2026-10-23T12:01:00Z', confirmedBy: actor, inputFingerprint: original.inputFingerprint,
  });
  assert.equal(original.generalAudit.productVerifications![0].confirmation, undefined);
  assert.ok(result.items[0].fulfillment.orderLimitEligible);
  const limited = applyGeneralOrderLimitDecision(result, result.items[0].fulfillment.key, true);
  assert.equal(limited.issueCount, 0);
  assert.equal(limited.generalAudit.productVerifications![0].status, 'customer verified');
  assert.equal(limited.allMatch, true);
  const declined = applyGeneralOrderLimitDecision(result, result.items[0].fulfillment.key, false);
  const declinedHtml = renderToStaticMarkup(createElement(Inventory, { items: declined.items, details: declined.generalAudit, onOrderLimit() {} })).replace(/<[^>]*>/g, '');
  assert.match(declinedHtml, /SHORTFALL/);
});

test('customer rejection permits catalogue suppository selection and reports different products', () => {
  const result = initial();
  const { product, option } = choose(result, 'Suppository');
  const confirmed = applyGeneralProductConfirmation(result, product.key, option.key, true);
  assert.deepEqual(confirmed.items.map(item => item.status), ['missing item', 'extra item']);
  assert.equal(confirmed.issueCount, 2);
  assert.equal(confirmed.allMatch, false);
  assert.equal(confirmed.whatsappMessage, customer);
  assert.match(confirmed.generalAudit.productVerifications![0].confirmation!.productName, /suppository/i);
});

test('false contact, invented forms and stale catalogue selections cannot confirm', () => {
  const result = initial();
  const { product, option } = choose(result);
  assert.throws(() => applyGeneralProductConfirmation(result, product.key, option.key, false));
  assert.throws(() => applyGeneralProductConfirmation(result, product.key, 'Paracetamol 500mg syrup', true));
  applyCatalog({ revision: 2, products: [] });
  assert.throws(() => applyGeneralProductConfirmation(result, product.key, option.key, true));
});

test('a fresh audit and changed product invalidate prior confirmation while history retains the original', () => {
  const result = initial();
  const { product, option } = choose(result);
  const verified = applyGeneralProductConfirmation(result, product.key, option.key, true, actor);
  const rerun = runGeneralAuditor(customer, fulfillment);
  assert.equal(rerun.generalAudit.productVerifications![0].confirmation, undefined);
  const changed = runGeneralAuditor(customer.replace('500mg', '250mg'), fulfillment);
  assert.throws(() => applyGeneralProductConfirmation(changed, product.key, option.key, true));
  const inputs = { whatsappMessage: customer, fulfillmentConfirmation: fulfillment };
  const saved = completeGeneralAuditRun(createGeneralAuditRun(inputs, 2, {}, {}, true), { ...verified, auditEngine: 'general-deterministic-v1' });
  assert.equal(saved.generalAudit.productVerifications![0].confirmation!.confirmedBy!.name, actor.name);
  const html = renderToStaticMarkup(createElement(Verification, { product: saved.generalAudit.productVerifications![0] }));
  assert.match(html, /View verification details/);
  assert.match(html, /CCA Mary/);
});

test('confirmed formulations are not created by deterministic or AI suggestions', async () => {
  initial();
  let calls = 0;
  const result = await runGeneralSemanticAudit(customer, fulfillment, {}, {}, () => { calls++; throw Error('offline'); });
  assert.equal(calls, 0);
  assert.equal(result.generalAudit.productVerifications![0].confirmation, undefined);
  assert.equal(result.allMatch, false);
});

async function request(handler: any, body: any, user: any = actor) {
  let status = 200, data: any;
  const res = { locals: { authUser: user }, status(code: number) { status = code; return this; }, json(value: any) { data = value; return this; } };
  await handler({ params: { id: 'audit-test' }, body }, res);
  return { status, data };
}

test('confirmation endpoint saves the authenticated actor and preserves raw input in audit history', async () => {
  let stored = initial();
  const { product, option } = choose(stored);
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async record => { stored = record; } });
  const body = { key: product.key, productKey: option.key, customerContactConfirmed: true, whatsappMessage: customer,
    fulfillmentConfirmation: fulfillment, auditTimestamp: stored.timestamp, actor: { id: 'forged', name: 'Forged' } };
  const response = await request(handler, body);
  assert.equal(response.status, 200);
  assert.equal(stored.generalAudit.productVerifications![0].confirmation!.confirmedBy!.id, actor.id);
  assert.equal(stored.whatsappMessage, customer);
  assert.equal(stored.issueCount, 1);
  assert.equal(stored.items[0].difference, 18);
  assert.equal((await request(handler, body)).status, 200, 'a retry returns the same saved confirmation');
});

test('endpoint rejects stale input, rerun snapshots and missing contact without changing history', async () => {
  const stored = initial();
  const { product, option } = choose(stored);
  let writes = 0;
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async () => { writes++; } });
  const body = { key: product.key, productKey: option.key, customerContactConfirmed: true, whatsappMessage: customer,
    fulfillmentConfirmation: fulfillment, auditTimestamp: stored.timestamp };
  assert.equal((await request(handler, { ...body, whatsappMessage: customer + ' changed' })).status, 409);
  assert.equal((await request(handler, { ...body, fulfillmentConfirmation: fulfillment.replace('2 supplied', '3 supplied') })).status, 409);
  assert.equal((await request(handler, { ...body, customerContactConfirmed: false })).status, 400);
  assert.equal(writes, 0);
});

test('storage failure does not mark an unsaved confirmation verified', async () => {
  const stored = initial();
  const { product, option } = choose(stored);
  const handler = generalProductConfirmationHandler({ read: async () => stored, save: async () => { throw Error('offline'); } });
  assert.equal((await request(handler, { key: product.key, productKey: option.key, customerContactConfirmed: true,
    whatsappMessage: customer, fulfillmentConfirmation: fulfillment, auditTimestamp: stored.timestamp })).status, 503);
  assert.equal(stored.generalAudit.productVerifications![0].confirmation, undefined);
});

test('confirming one product leaves other confirmations, stock exemptions and quantity limits independent', () => {
  const products = [...seedProducts, { id: 'amox-500-capsule', scope: 'general' as const, name: 'Amoxicillin 500mg Capsule',
    category: 'medicine', aliases: [], contextualAliases: [], note: '' }];
  applyCatalog({ revision: 3, products });
  const requestText = customer + '\n5 Amoxicillin 500mg 10/10';
  const suppliedText = fulfillment + '\nAmoxicillin 500mg Capsule [0/10]';
  const initialResult = runGeneralAuditor(requestText, suppliedText);
  assert.equal(initialResult.generalAudit.productVerifications!.length, 2);
  const first = initialResult.generalAudit.productVerifications![0];
  const firstResult = applyGeneralProductConfirmation(initialResult, first.key, first.options.find(option => option.fromFulfillment)!.key, true, actor);
  assert.equal(firstResult.generalAudit.productVerifications!.filter(product => product.status === 'customer verified').length, 1);
  assert.equal(firstResult.generalAudit.productVerifications!.filter(product => product.status === 'customer confirmation required').length, 1);
  assert.equal(firstResult.allMatch, false);
  const limit = applyGeneralOrderLimitDecision(firstResult, firstResult.items[0].fulfillment.key, true);
  const second = limit.generalAudit.productVerifications!.find(product => product.status === 'customer confirmation required')!;
  const final = applyGeneralProductConfirmation(limit, second.key, second.options.find(option => option.fromFulfillment)!.key, true, actor);
  assert.equal(final.generalAudit.productVerifications!.filter(product => product.status === 'customer verified').length, 2);
  assert.equal(final.items[0].status, 'order limit applied');
  assert.equal(final.items[1].status, 'out of stock');
  assert.equal(final.issueCount, 0);
  assert.equal(final.allMatch, true);
});

test('matching incomplete source names cannot clear a pending formulation confirmation', () => {
  initial();
  const result = runGeneralAuditor(customer, fulfillment.replace('Paracetamol 500mg Tablet — 2 supplied', 'Paracetamol 500mg — 20 supplied'));
  assert.equal(result.generalAudit.productVerifications![0].status, 'customer confirmation required');
  assert.equal(result.generalAudit.productVerifications![0].fulfillmentProducts[0].quantity, 20);
  assert.ok(result.generalAudit.semanticReviews?.some(review => review.dosageFormKey));
  assert.equal(result.allMatch, false);
});

test('missing forms without an explicit strength can use catalogue aliases without inventing a strength', () => {
  initial();
  const result = runGeneralAuditor(customer.replace('500mg ', ''), fulfillment.replace('500mg ', ''));
  const verification = result.generalAudit.productVerifications![0];
  assert.equal(verification.status, 'customer confirmation required');
  assert.equal(verification.suggestedProduct, 'Paracetamol Tablet');
  assert.ok(verification.options.every(option => !/\d/.test(option.name)));
  assert.equal(result.allMatch, false);
});

test('concurrent product confirmation cannot overwrite an approved limit on another product', async () => {
  initial();
  const requestText = customer + '\nORS - 10';
  const suppliedText = fulfillment + '\nORS [5/10]';
  let stored: any = { ...runGeneralAuditor(requestText, suppliedText), id: 'audit-test', timestamp: 'audit-snapshot', whatsappMessage: requestText, fulfillmentConfirmation: suppliedText };
  const { product, option } = choose(stored);
  let releaseSave!: () => void;
  const gate = new Promise<void>(resolve => { releaseSave = resolve; });
  const limit = orderLimitAcknowledgementHandler({ read: async () => stored, save: async record => { await gate; stored = record; } });
  const confirm = generalProductConfirmationHandler({ read: async () => stored, save: async record => { stored = record; } });
  const savingLimit = request(limit, { key: stored.items[0].fulfillment.key, answer: true });
  const savingProduct = request(confirm, { key: product.key, productKey: option.key, customerContactConfirmed: true,
    whatsappMessage: requestText, fulfillmentConfirmation: suppliedText, auditTimestamp: stored.timestamp });
  releaseSave();
  const responses = await Promise.all([savingLimit, savingProduct]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(stored.items.find((item: any) => item.name === 'ORS').status, 'order limit applied');
  assert.equal(stored.generalAudit.productVerifications[0].status, 'customer verified');
  assert.equal(stored.issueCount, 1, 'the paracetamol shortfall still needs its own limit decision');
});

test('confirmed formulation also reaches structured extraction and persisted comparison values', async () => {
  initial();
  const raw = await runGeneralSemanticAudit(customer, fulfillment, {}, {}, () => { throw Error('offline'); });
  const product = raw.generalAudit.productVerifications![0];
  const confirmed = applyGeneralProductConfirmation(raw, product.key, product.options.find(option => option.fromFulfillment)!.key, true);
  assert.equal(confirmed.extractedOrder.products[0].name, 'Paracetamol 500mg Tablet');
  assert.equal(confirmed.extractedOrder.products[0].quantity, 20);
  assert.ok(!confirmed.extractedOrder.unresolvedFields!.includes('products'));
  assert.equal(confirmed.generalAudit.products[0].difference, 18);
  assert.equal(confirmed.issueCount, 1);
});
