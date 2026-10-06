import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generalProductDisplayName, normalizeGeneralProductName, parseGeneralProducts, runGeneralAuditor, stripGeneralListPrefix } from './generalAuditor';
import { GeneralProductName } from '../src/components/GeneralFulfillmentSummary';

const adult = 'Simple Linctus 125mg/5ml Syrup (Adult)';
const child = 'Simple Linctus 31.25mg/5ml Syrup (Paediatric)';

test('all requested list markers are removed before parsing and canonical matching', () => {
  for (const prefix of ['1. ', '2.', '3) ', '4)', '2)', '1 - ', '2 – ', '- ', '-', '• ', '* ', '*']) {
    const raw = `${prefix}${adult} -5`;
    const parsed = parseGeneralProducts(raw, 'customer_request');
    assert.equal(parsed.length, 1, raw);
    assert.equal(parsed[0].name, adult, raw);
    assert.equal(parsed[0].quantity, 5);
    assert.equal(parsed[0].originalText, raw);
    assert.equal(parsed[0].normalizedName, normalizeGeneralProductName(adult));
    assert.equal(normalizeGeneralProductName(`${prefix}${adult}`), normalizeGeneralProductName(adult));
    const result = runGeneralAuditor(raw, `- ${adult} [0/1]`);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].name, adult);
    assert.equal(result.items[0].status, 'out of stock');
    assert.equal(result.issueCount, 0);
  }
});

test('compact-numbered Adult and Paediatric stock products produce exactly two clean card titles', () => {
  const customer = `3.${adult} -5\n4.${child} -5`;
  const fulfillment = `- ${adult} [0/1]\n- ${child} [0/1]`;
  const result = runGeneralAuditor(customer, fulfillment);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => [item.name, item.status, item.requested, item.found]), [
    [adult, 'out of stock', '5', '0'], [child, 'out of stock', '5', '0']
  ]);
  assert.equal(result.issueCount, 0);
  const html = renderToStaticMarkup(createElement('div', null, result.items.map(item =>
    createElement('h4', { key: item.fulfillment.key }, createElement(GeneralProductName, { name: item.name })))));
  assert.equal((html.match(/<h4>/g) ?? []).length, 2);
  assert.equal(html, `<div><h4>${adult}</h4><h4>${child}</h4></div>`);
});

test('General display boundary cleans prefixed and raw legacy titles without rendering quantities', () => {
  for (const raw of [`3.${adult}`, `3. ${adult} -5`, `4)${child} [0/1]`, `1 - ${adult}`, `• ${adult}`]) {
    const expected = raw.includes('Paediatric') ? child : adult;
    assert.equal(generalProductDisplayName(raw), expected);
    assert.equal(renderToStaticMarkup(createElement(GeneralProductName, { name: raw })), expected);
  }
});

test('dosage numbers, decimal strengths, compound strengths, and blood Rh remain intact', () => {
  for (const name of [adult, child, 'Paracetamol 120mg/5mL Syrup, 100mL', 'Amoxicillin 500mg', 'Artemether Lumefantrine 20/120mg', '31.25mg/5ml Simple Linctus', '500mg Amoxicillin', '100ml Syrup', 'Vitamin B-12', 'PRBC O-']) {
    assert.equal(stripGeneralListPrefix(name), name);
    assert.equal(generalProductDisplayName(name), name);
    const product = parseGeneralProducts(`2. ${name} -5`, 'customer_request')[0];
    assert.equal(product.name, name);
    assert.equal(product.quantity, 5);
  }
  assert.notEqual(normalizeGeneralProductName(adult), normalizeGeneralProductName(child));
});

test('numbered stock sections retain zero and unreadable numbered products still fail validation', () => {
  const result = runGeneralAuditor(`3.${adult} -5`, `Out of stock:\n3.${adult}`);
  assert.deepEqual(result.items.map(item => [item.status, item.found]), [['out of stock', '0']]);
  assert.throws(() => runGeneralAuditor(`3.${adult} -unknown`, `${adult} [5/5]`), /Unable to read the product quantity/);
});
