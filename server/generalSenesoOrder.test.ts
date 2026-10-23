import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Details from '../src/components/GeneralAuditDetails';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { normalizeGeneralProductName } from './generalAuditor';
import { applyCatalog, defaultProducts } from './productCatalog';
import { classifyGeneralText } from '../src/utils/generalTextClassification';

export const customer = `Date: 23/10/2026
Name of Orderer: Ekobor Samuel Jnr.
Name of Health Facility: Seneso CHPS
Delivery/ Drop area: Seneso CHPS compound
 District : Sekyere Afram Plains
 Vaccine requisition (All in Vials)
BCG - 1
OPV - 1
PCV - 4
PENTA - 2
IPV - 2
ROTA - 4
Y/F - 2
M/R - 3
MEN A - 2
TD - 1
Please, Kindly make it available on time`;
export const fulfillment = `Thank you Samuel Ekobor from Seneso CHPS for ordering with Zipline. We have received your order (ID: 04D6Z82J5Z). We are currently out of stock for the following items:
Inactivated Polio Vaccine [0/1]
Yellow Fever Vaccine Diluent [0/1]
Yellow Fever Vaccine [0/1]
 We will now prepare the following items for delivery:
Bacille Calmette-Guerin Vaccine Diluent [1/1]
Bacille Calmette-Guerin Vaccine [1/1]
Diphtheria & Tetanus Vaccine [1/1]
Measles and Rubella Vaccine Diluent [3/3]
Measles & Rubella Vaccine [3/3]
Meningococcal Conjugate A Vaccine Diluent [2/2]
Meningococcal Conjugate A Vaccine [2/2]
Oral Polio Vaccine (1&3) [1/1]
Oral Polio Vaccine Dropper [1/1]
Pentavalent (5-in-1) Vaccine [2/2]
Pneumococcal Conjugate Vaccine [1/1]
Rotavirus Vaccine Dropper [4/4]
Rotavirus Vaccine [4/4]
Please reach out to the nearest stock for these items. Once re-stocked, we will notify you and be able to deliver them. Let us know if any changes are required or contact 0800719102 if any questions.
You will receive your flight notifications via SMS
Use this link to track your order: https://orders.zipline.com/t/7/04D6Z82J5Z`;

const seed = () => applyCatalog({ revision: 1, products: defaultProducts() });

test('the supplied Seneso order has no generic product review and retains the real PCV shortfall', async () => {
  seed();
  const result = await runGeneralSemanticAudit(customer, fulfillment, {}, {}, () => { throw Error('Gemini unavailable'); });
  assert.deepEqual(result.generalAudit.semanticReviews || [], []);
  assert.equal(result.semanticAnalysis.status, 'skipped');
  assert.equal(result.items.filter(item => item.provenance.some(evidence => evidence.source === 'customer_request')).length, 10);
  assert.equal(result.issueCount, 3);
  assert.equal(result.items.find(item => item.name === 'TD')?.status, 'missing item');
  assert.equal(result.items.find(item => item.name === 'Diphtheria & Tetanus Vaccine')?.status, 'extra item');
  assert.equal(result.allMatch, false);
  const pcv = result.items.find(item => item.name === 'PCV')!;
  assert.equal(pcv.status, 'quantity mismatch');
  assert.equal(pcv.requested, '4');
  assert.equal(pcv.found, '1');
  assert.equal(result.items.find(item => item.name === 'IPV')?.status, 'out of stock');
  assert.equal(result.items.find(item => item.name === 'Y/F')?.status, 'out of stock');
  assert.equal(result.items.find(item => item.name === 'M/R')?.status, 'match');
  assert.ok(!result.items.some(item => item.status === 'vaccine pairing mismatch'));
  assert.equal(result.generalAudit.orderer.status, 'review required');
  assert.match(result.generalAudit.orderer.reason!, /suffix is missing/);
  const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit }));
  assert.doesNotMatch(html, /Product: Confirm the requested product/);
  assert.doesNotMatch(result.generalAudit.warnings!.join(' '), /Product:/);
});

test('resolved names and the supplied vaccine spellings need no Gemini calls', async () => {
  seed();
  let calls = 0;
  const confirmedName = fulfillment.replace('Samuel Ekobor from', 'Samuel Ekobor Junior from');
  const result = await runGeneralSemanticAudit(customer, confirmedName, {}, {}, () => { calls++; throw Error('AI unnecessary'); });
  assert.equal(calls, 0);
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.deepEqual(result.generalAudit.semanticReviews || [], []);
  assert.equal(result.issueCount, 3); // PCV shortfall and the existing Td/DT identity distinction remain.
});

test('requisition and fulfilment headings are sections, not uncertain products or quantities', () => {
  for (const text of ['Vaccine requisition (All in Vials)', 'Vaccine requisition', 'We will now prepare the following items for delivery:']) {
    assert.equal(classifyGeneralText(text).category, 'mandatory_order', text);
  }
  for (const text of ['Please, Kindly make it available on time',
    'Please reach out to the nearest stock for these items.',
    'Once re-stocked, we will notify you and be able to deliver them.',
    'Use this link to track your order: https://orders.zipline.com/t/7/04D6Z82J5Z']) {
    assert.equal(classifyGeneralText(text).category, 'administrative', text);
  }
});

test('recognizing routine templates cannot hide named products, quantity changes or extra instructions', () => {
  for (const text of ['Vaccine requisition (BCG - 2)', 'Vaccine requisition (All in Vials) BCG - 2',
    'Please, Kindly make BCG - 2 available on time',
    'Please reach out to the nearest stock for BCG - 2.',
    'Once re-stocked, we will notify you and be able to deliver BCG - 2.',
    'Please reach out to the nearest stock for these items and change the district.',
    'Use this link to track your order: https://orders.zipline.com/t/7/id please add BCG - 2']) {
    assert.notEqual(classifyGeneralText(text).category, 'administrative', text);
    assert.notEqual(classifyGeneralText(text).category, 'mandatory_order', text);
  }
});

test('vaccine spelling normalization preserves vaccine, diluent, strength and product distinctions', () => {
  seed();
  assert.equal(normalizeGeneralProductName('Y/F'), normalizeGeneralProductName('YF'));
  assert.equal(normalizeGeneralProductName('M/R'), normalizeGeneralProductName('MR'));
  assert.equal(normalizeGeneralProductName('Measles and Rubella Vaccine Diluent'), normalizeGeneralProductName('MR Diluent'));
  for (const [left, right] of [['Y/F', 'YF Diluent'], ['M/R', 'MR Diluent'], ['M/R', 'Measles Vaccine'], ['Y/F', 'IPV'], ['M/R 10 doses', 'MR 20 doses']]) {
    assert.notEqual(normalizeGeneralProductName(left), normalizeGeneralProductName(right));
  }
});
