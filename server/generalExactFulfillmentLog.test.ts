import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralSemanticAudit as audit } from './generalSemanticAudit';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';
import { classifyGeneralText, generalOrderRelevantText } from '../src/utils/generalTextClassification';
import Details from '../src/components/GeneralAuditDetails';
import Summary from '../src/components/GeneralFulfillmentSummary';
const customer = '21/10/26\nName: Adam Fouzia\u00a0\nFacility:Bagurugu CHPS\u00a0\nDistrict:Karaga district\u00a0\nProduct\nHPV vaccine…..25\n0.5ml syringe and needle 50  ';
const fulfillment = 'Thank you Adam Fauzia from Bagurugu CHPS for ordering with Zipline. We have received your order (ID: RH59X93V43). Use this link to track your order: https://orders.zipline.com/t/8/RH59X93V43 We will now prepare the following items for delivery:\nHuman Papilloma Virus Vaccine [25/25]\nDisp Syringe & Needle, 0.5mL [50/50]\nExpected delivery: between October 21, 2026 11:23 AM and October 21, 2026 01:23 PM. Let us know if any changes are required or contact +0800719102 if any questions.\nYou will receive your flight notifications via SMS';
const offline = () => { throw Error('AI should not be needed'); };
const render = (details: Parameters<typeof Details>[0]['details']) => renderToStaticMarkup(createElement('div', null, createElement(Details, { details }), createElement(Summary, { details })));

test('the exact supplied log accepts a minor orderer spelling difference without product warnings', async () => {
  let calls = 0;
  const result = await audit(customer, fulfillment, {}, {}, () => { calls++; return offline(); });
  assert.equal(calls, 0);
  assert.equal(result.allMatch, true);
  assert.equal(result.issueCount, 0);
  assert.equal(result.generalAudit.facility.status, 'match');
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.equal(result.generalAudit.orderer.nameMatchMethod, 'fuzzy');
  assert.equal(result.generalAudit.orderer.whatsappValue, 'Adam Fouzia');
  assert.equal(result.generalAudit.orderer.fulfillmentValue, 'Adam Fauzia');
  assert.deepEqual(result.items.map(item => [item.requested, item.found, item.status]), [['25', '25', 'match'], ['50', '50', 'match']]);
  assert.deepEqual(result.generalAudit.discrepancies, []);
  assert.deepEqual(result.generalAudit.warnings, []);
  assert.deepEqual(result.generalAudit.semanticReviews || [], []);
  assert.equal(result.confidence, 100);
  assert.equal(result.canDispatchAutomatically, false);
  assert.doesNotMatch(render(result.generalAudit), /Product: Confirm|CLARIFICATION REQUIRED|MANUAL REVIEW REQUIRED/);
});

test('the same full log is cleared when the actual orderer names agree', async () => {
  const message = customer.replace('Adam Fouzia', 'Adam Fauzia');
  const result = await audit(message, fulfillment, {}, {}, offline);
  assert.equal(result.allMatch, true);
  assert.equal(result.status, 'resolved');
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.equal(result.generalAudit.finalStatus, 'NO DISCREPANCY');
  assert.deepEqual(result.generalAudit.warnings, []);
  assert.equal(result.confidence, 100);
  assert.match(render(result.generalAudit), /MATCH — CLEARED/);
  const inputs = { whatsappMessage: message, fulfillmentConfirmation: fulfillment };
  const final = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...result, ...inputs });
  assert.equal(final.allMatch, true);
  assert.deepEqual(final.generalAudit.warnings, []);
});

for (const date of ['21/10/26', '21/10/2026', '21-10-26', '2026-10-21', '2026/10/21', '29/02/2024']) {
  test(`a valid standalone date is never an unresolved product: ${date}`, () => {
    assert.equal(classifyGeneralText(date).category, 'administrative');
    assert.equal(generalOrderRelevantText(date + '\nORS - 5'), '\nORS - 5');
  });
}
for (const text of ['21/10', '25/25', '50/50', '31/02/2026', '21/10/26 ORS - 5', 'Change the quantity on 21/10/26 to 10.']) {
  test(`date filtering cannot hide quantities or instructions: ${text}`, () => {
    assert.notEqual(classifyGeneralText(text).category, 'administrative');
  });
}
for (const heading of ['Product', 'Product:', 'Products', 'Products and quantities']) {
  test(`singular and plural product headings do not request product clarification: ${heading}`, async () => {
    assert.equal(classifyGeneralText(heading).category, 'mandatory_order');
    const result = await audit(customer.replace('Adam Fouzia', 'Adam Fauzia').replace('\nProduct\n', '\n' + heading + '\n'), fulfillment, {}, {}, offline);
    assert.equal(result.allMatch, true);
    assert.deepEqual(result.generalAudit.warnings, []);
  });
}


test('old server reviews of the date and product heading cannot survive client revalidation', async () => {
  const inputs = { whatsappMessage: customer.replace('Adam Fouzia', 'Adam Fauzia'), fulfillmentConfirmation: fulfillment };
  const base = await audit(inputs.whatsappMessage, inputs.fulfillmentConfirmation, {}, {}, offline);
  const reviews = ['21/10/26', 'Product'].map(originalText => ({ kind: 'unparsed_text' as const, field: 'products' as const, source: 'customer_request' as const, originalText, possibleMatches: [], reason: 'Product: Confirm the requested product.' }));
  const old = { ...base, ...inputs, allMatch: false, generalAudit: { ...base.generalAudit, semanticReviews: reviews, warnings: ['Product: Confirm the requested product.'] } };
  const final = completeGeneralAuditRun(createGeneralAuditRun(inputs, 2, {}, {}, true), old);
  assert.equal(final.allMatch, true);
  assert.deepEqual(final.generalAudit.warnings, []);
  assert.deepEqual(final.generalAudit.semanticReviews || [], []);
  assert.match(render(final.generalAudit), /MATCH — CLEARED/);
});
