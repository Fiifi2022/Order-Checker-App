import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseGeneralProducts, normalizeGeneralProductName, runGeneralAuditor } from './generalAuditor';
import { extractGeneralOrderDeterministically } from './generalOrderExtraction';
import { runGeneralSemanticAudit as audit } from './generalSemanticAudit';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';
import Details from '../src/components/GeneralAuditDetails';
import Summary from '../src/components/GeneralFulfillmentSummary';

const header = 'Facility: Cedar HC\nOrderer: Ama Boateng\n';
const request = '-Human Papilloma Virus Vaccine….25\n-0.5ml syringe and needle 50';
const fulfillment = 'Human Papilloma Virus Vaccine [25/25]\nDisp Syringe & Needle, 0.5ml [50/50]';
const offline = () => { throw Error('No AI needed for explicit names and quantities'); };

test('exact HPV and decimal-capacity syringe order extracts both products independently', async () => {
  const evidence = parseGeneralProducts(request, 'customer_request');
  assert.deepEqual(evidence.map(product => [product.name, product.quantity, product.line]), [
    ['Human Papilloma Virus Vaccine', 25, 1], ['0.5ml syringe and needle', 50, 2],
  ]);
  assert.equal(evidence[1].normalizedName, normalizeGeneralProductName('Disp Syringe & Needle, 0.5ml'));
  const extracted = extractGeneralOrderDeterministically(header + request, 'customer_request');
  assert.deepEqual(extracted.order.products.map(product => product.quantity), [25, 50]);
  assert.deepEqual(extracted.order.unresolvedFields, []);
  let calls = 0;
  const result = await audit(header + request, header + fulfillment, {}, {}, () => { calls++; return offline(); });
  assert.equal(calls, 0);
  assert.equal(result.allMatch, true);
  assert.equal(result.issueCount, 0);
  assert.equal(result.generalAudit.facility.status, 'match');
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.deepEqual(result.items.map(item => [item.requested, item.found, item.status]), [['25', '25', 'match'], ['50', '50', 'match']]);
  assert.deepEqual(result.generalAudit.productCount, { requested: 2, found: 2, status: 'match' });
  assert.deepEqual(result.generalAudit.warnings, []);
  const html = renderToStaticMarkup(createElement('div', null, createElement(Details, { details: result.generalAudit }), createElement(Summary, { details: result.generalAudit })));
  assert.doesNotMatch(html, /MANUAL REVIEW REQUIRED|role="status"|Missing Products|Extra Products/);
  assert.match(html, /25\/25/);
  assert.match(html, /50\/50/);
  const inputs = { whatsappMessage: header + request, fulfillmentConfirmation: header + fulfillment };
  const final = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...result, ...inputs });
  assert.equal(final.allMatch, true);
  assert.equal(final.items.length, 2);
});

for (const separator of [' ', '.', '....', '…', '….', ':', '-', '—', '=', ' · ']) {
  test(`multiple products accept quantity separator ${JSON.stringify(separator)}`, async () => {
    const text = `-Human Papilloma Virus Vaccine${separator}25\n-0.5 ml syringe and needle${separator}50`;
    const result = await audit(header + text, header + fulfillment, {}, {}, offline);
    assert.equal(result.allMatch, true);
    assert.deepEqual(result.items.map(item => item.requested), ['25', '50']);
    assert.deepEqual(result.generalAudit.warnings, []);
  });
}

for (const text of [
  '1. Human Papilloma Virus Vaccine:25\n2. 0.5ml syringe and needle 50',
  '•Human Papilloma Virus Vaccine….25\n•0.5 ml syringe and needle 50',
  '25 Human Papilloma Virus Vaccine\n50 0.5ml syringe and needle',
  '-Human Papilloma Virus Vaccine….25\\\n-0.5ml syringe and needle 50',
  '0.5ml syringe and needle 50\nHuman Papilloma Virus Vaccine….25',
]) test(`multi-product formatting preserves decimal specifications: ${text.slice(0, 40)}`, async () => {
  const result = await audit(header + text, header + fulfillment, {}, {}, offline);
  assert.equal(result.allMatch, true);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => Number(item.requested)).sort((a, b) => a - b), [25, 50]);
});

for (const line of ['0.5 ml syringe and needle', '250 mg Amoxicillin', '0.9% Saline']) {
  test(`a leading specification never supplies a missing quantity: ${line}`, () => {
    assert.deepEqual(parseGeneralProducts(line, 'customer_request'), []);
  });
}

test('missing syringe quantity invokes fallback once and never fabricates a mismatch', async () => {
  let calls = 0;
  const result = await audit(header + 'HPV - 25\n0.5 ml syringe and needle', header + fulfillment, {}, { semanticCacheScope: 'syringe-missing-quantity-regression' }, () => {
    calls++;
    throw Error('offline');
  });
  assert.equal(calls, 1);
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 0);
  assert.deepEqual(result.generalAudit.warnings, ['Quantity: Confirm the requested quantity.']);
  assert.equal(result.items[0].status, 'match');
});

test('genuinely unclear quantities retain fallback and do not become missing-product discrepancies', async () => {
  let calls = 0;
  const result = await audit(header + 'Human Papilloma Virus Vaccine….unknown\n0.5ml syringe and needle 50', header + fulfillment, {}, { semanticCacheScope: 'hpv-unclear-quantity-regression' }, () => {
    calls++;
    throw Error('offline');
  });
  assert.equal(calls, 1);
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 0);
  assert.equal(result.items[0].status, 'match');
  assert.ok(result.generalAudit.warnings?.length);
});

test('actual quantity differences remain discrepancies with the dotted and decimal-leading order', async () => {
  const result = await audit(header + request, header + fulfillment.replace('[50/50]', '[60/60]'), {}, {}, offline);
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 1);
  assert.equal(result.items.find(item => /syringe/i.test(item.name))?.status, 'quantity mismatch');
});

test('different syringe capacities stay different products after normalization', () => {
  const result = runGeneralAuditor(header + request, header + fulfillment.replace('0.5ml', '1ml'));
  assert.equal(result.allMatch, false);
  assert.notEqual(normalizeGeneralProductName('0.5ml syringe and needle'), normalizeGeneralProductName('Disp Syringe & Needle, 1ml'));
  assert.ok(result.items.some(item => item.status === 'missing item'));
  assert.ok(result.items.some(item => item.status === 'extra item'));
});
