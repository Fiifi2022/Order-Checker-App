import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Details from '../src/components/GeneralAuditDetails';
import { runGeneralAuditor, parseGeneralProducts, normalizeGeneralProductName, applyGeneralOrderLimitDecision } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { applyCatalog, defaultProducts } from './productCatalog';
import { generalOrderRelevantText } from '../src/utils/generalTextClassification';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';

export const customer = `*Date*23/10/2026
Name of Orderer:Emmanuel
Name of Health Facility:Anyinofi Health Centre
Delivery/ Drop area:NEAR THE HEALTH CENTER
District:SAP
Products and Quantities:6/6
1 Disp Syringe and needle 10mls 20/20
2 Disp Syringe and needle 5mls 20/20
3 Artesunate injection 120mg 10/10
4 Paracetamol 500mg 20/20
5 Benzathine penicillin 2.4miu injection 20/20
6 Given set (infusion) 20/20`;
export const fulfillment = `Thank you Emmanuel Adomako from Anyinofi HC for ordering with Zipline. We have received your order (ID: ENRZ89X9GY). We are currently out of stock for the following items:
- Infusion Giving Set [0/1]
We can prepare the following items we have in stock for delivery:
- Artesunate 120mg injection [10/10]
- Benzathine Penicillin 2.4MIU Injection [10/10]
- Disp Syringe & Needle, 5mL [20/20]
- Paracetamol 500mg Tablet [2/2]
- Disp Syringe & Needle, 10ml [20/20]
Please reach out to the nearest stock for the rest of the order. Once re-stocked, we will notify you and be able to deliver the rest, if still needed. Let us know if any changes are required or contact 0800719102 if any questions.
You will receive your flight notifications via SMS
Use this link to track your order: https://orders.zipline.com/t/7/ENRZ89X9GY`;

const offline = () => { throw Error('Gemini unavailable'); };
const seed = () => applyCatalog({ revision: 1, products: defaultProducts() });

test('the exact numbered order reads six product quantities rather than the six list indices', () => {
  seed();
  const products = parseGeneralProducts(customer, 'customer_request');
  assert.equal(products.length, 6);
  assert.deepEqual(products.map(product => product.quantity), [20, 20, 10, 20, 20, 20]);
  assert.deepEqual(products.map(product => product.ratioRequestedQuantity), [20, 20, 10, 20, 20, 20]);
  assert.equal(products[2].name, 'Artesunate injection 120mg');
  assert.ok(products.every(product => !/\d+\/\d+/.test(product.name)));
  assert.equal(products[0].originalText, '1 Disp Syringe and needle 10mls 20/20');
  assert.equal(products[0].line, 7);
});

test('the exact screenshot order matches clear products, retains the stock exemption and reports only confirmed discrepancies', async () => {
  seed();
  const result = await runGeneralSemanticAudit(customer, fulfillment, {}, {}, offline);
  assert.equal(result.generalAudit.facility.status, 'match');
  assert.equal(result.generalAudit.orderer.status, 'review required');
  assert.equal(result.issueCount, 1);
  assert.equal(result.allMatch, false);
  assert.ok(result.confidence > 20 && result.confidence < 100);
  assert.ok(result.items.every(item => !['missing item', 'extra item'].includes(item.status)));
  assert.equal(result.items.find(item => /Artesunate/i.test(item.name))?.status, 'match');
  assert.equal(result.items.filter(item => /syringe/i.test(item.name)).length, 2);
  assert.ok(result.items.filter(item => /syringe/i.test(item.name)).every(item => item.status === 'match'));
  const penicillin = result.items.find(item => /Benzathine/i.test(item.name))!;
  assert.equal(penicillin.status, 'quantity mismatch');
  assert.equal(penicillin.requested, '20');
  assert.equal(penicillin.found, '10');
  const givingSet = result.items.find(item => /Given set/i.test(item.name))!;
  assert.equal(givingSet.status, 'out of stock');
  assert.equal(givingSet.requested, '20');
  assert.equal(givingSet.found, '0');
  const reviews = result.generalAudit.semanticReviews!;
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].originalText, '4 Paracetamol 500mg 20/20');
  assert.match(reviews[0].reason, /omits the dosage form/);
  assert.match(reviews[0].reason, /Requested quantity: 20/);
  assert.match(reviews[0].reason, /2 supplied/);
  assert.equal(result.generalAudit.dropArea?.status, 'optional not provided');
  assert.equal(result.generalAudit.district?.status, 'optional not provided');
  const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit }));
  assert.doesNotMatch(html, /Artesunate[^<]*missing|Artesunate[^<]*extra|Date23\/10/);
  const inputs = { whatsappMessage: customer, fulfillmentConfirmation: fulfillment };
  const accepted = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...result, ...inputs });
  assert.equal(accepted.issueCount, 1);
  assert.equal(accepted.generalAudit.semanticReviews?.length, 1);
  const acknowledged = applyGeneralOrderLimitDecision(result, penicillin.fulfillment.key, true);
  assert.equal(acknowledged.issueCount, 0);
  assert.equal(acknowledged.allMatch, false, 'unconfirmed identity and dosage form still prevent approval');
});

test('explicitly completing the missing name and dosage form reveals both actual quantity shortfalls without AI', async () => {
  seed();
  const clarified = customer.replace('Name of Orderer:Emmanuel', 'Name of Orderer:Emmanuel Adomako')
    .replace('4 Paracetamol 500mg 20/20', '4 Paracetamol 500mg Tablet 20/20');
  let calls = 0;
  const result = await runGeneralSemanticAudit(clarified, fulfillment, {}, {}, () => { calls++; return offline(); });
  assert.equal(calls, 0);
  assert.equal(result.issueCount, 2);
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.deepEqual(result.generalAudit.semanticReviews || [], []);
  assert.deepEqual(result.items.filter(item => item.status === 'quantity mismatch').map(item => [item.requested, item.found]), [['20', '2'], ['20', '10']]);
});

for (const line of ['250 mg Amoxicillin 10/10', '0.5 ml syringe and needle 20/20', '10 mls syringe and needle 20/20', '20/120mg Coartem 10/10', '31.25mg Simple Linctus 10/10']) {
  test(`numbered ratio recognition preserves a leading clinical specification: ${line}`, () => {
    const product = parseGeneralProducts(line, 'customer_request')[0];
    assert.ok(product.name.startsWith(line.split(' ')[0]));
    assert.equal(product.quantity, Number(line.match(/(\d+)\/\d+$/)![1]));
  });
}

test('ordinary quantity-first orders and concentration-only medicine lines retain their rules', async () => {
  assert.equal(parseGeneralProducts('20 Paracetamol 500mg Tablet', 'customer_request')[0].quantity, 20);
  assert.equal(parseGeneralProducts('20 Paracetamol syrup 120/5', 'customer_request')[0].quantity, 20);
  const concentration = await runGeneralSemanticAudit('Orderer: Test Operator\nFacility: Alpha HC\nParacetamol syrup 120/5',
    'Orderer: Test Operator\nFacility: Alpha HC\nParacetamol syrup 120/5', {}, {}, offline);
  assert.equal(concentration.allMatch, false);
  assert.ok(concentration.generalAudit.semanticReviews?.length);
});

test('syringe capacities, strength units and different giving-set products remain distinct', () => {
  seed();
  assert.equal(normalizeGeneralProductName('Disp Syringe and needle 10mls'), normalizeGeneralProductName('Disp Syringe & Needle, 10ml'));
  assert.notEqual(normalizeGeneralProductName('Disp Syringe and needle 10mls'), normalizeGeneralProductName('Disp Syringe & Needle, 5ml'));
  assert.notEqual(normalizeGeneralProductName('Benzathine penicillin 2.4miu injection'), normalizeGeneralProductName('Benzathine penicillin 1.2miu injection'));
  assert.notEqual(normalizeGeneralProductName('Benzathine penicillin 2.4miu injection'), normalizeGeneralProductName('Benzathine penicillin 2.4iu injection'));
  assert.equal(normalizeGeneralProductName('Given set (infusion)'), normalizeGeneralProductName('Infusion Giving Set'));
  assert.notEqual(normalizeGeneralProductName('Given set (infusion)'), normalizeGeneralProductName('Blood Giving Set'));
});

test('formatted complete dates are excluded while partial dates and mixed product lines are retained', () => {
  assert.equal(generalOrderRelevantText('*Date*23/10/2026').trim(), '');
  for (const text of ['*Date*23/10', '*Date*23/10/2026 Paracetamol - 20', 'Change the quantity on 23/10/2026 to 10']) {
    assert.ok(generalOrderRelevantText(text).trim());
  }
});

test('omitted medicine forms require review while conflicting specified forms and strengths remain discrepancies', () => {
  seed();
  const header = 'Orderer: Test Operator\nFacility: Alpha HC\n';
  const missingForm = runGeneralAuditor(header + 'Paracetamol 500mg - 20', header + 'Paracetamol 500mg Tablet [2/20]');
  assert.equal(missingForm.issueCount, 0);
  assert.equal(missingForm.allMatch, false);
  assert.match(missingForm.generalAudit.semanticReviews![0].reason, /omits the dosage form/);
  for (const [requested, supplied] of [['Paracetamol 500mg Tablet', 'Paracetamol 500mg Suppository'], ['Paracetamol 500mg', 'Paracetamol 250mg Tablet']]) {
    const result = runGeneralAuditor(header + requested + ' - 20', header + supplied + ' [2/20]');
    assert.equal(result.issueCount, 2);
    assert.equal(result.allMatch, false);
  }
});
