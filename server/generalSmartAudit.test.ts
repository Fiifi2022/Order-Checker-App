import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {extractGeneralOrderDeterministically} from './generalOrderExtraction';
import {resolveGeneralOrderExtraction} from './generalHybridExtraction';
import {createGeneralCatalogResolver} from '../src/utils/generalProductLog';
import {prepareGeneralFacilityContext, compareGeneralFacilities} from '../src/utils/generalFacility';
import type {ProductCatalog} from '../shared/productCatalog';
import {applyGeneralOrderLimitDecision} from './generalAuditor';
import {createGeneralAuditRun, completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import {buildGeneralReport} from '../extension/general-report.js';

const products: ProductCatalog = {revision: 1100, products: [
  {id: 'p500', scope: 'general', name: 'Paracetamol 500mg Tablet', aliases: ['PCM 500mg'], displayName: 'Pain relief 500mg Tablet', fulfillmentSystemName: 'Paracetamol 500mg Tablets', contextualAliases: [], category: 'medicine', note: ''},
  {id: 'p250', scope: 'general', name: 'Paracetamol 250mg Tablet', aliases: [], contextualAliases: [], category: 'medicine', note: ''},
  {id: 'psyr', scope: 'general', name: 'Paracetamol 120mg/5ml Syrup, 100ml', aliases: [], contextualAliases: [], category: 'medicine', note: ''},
  {id: 'rdt', scope: 'general', name: 'Malaria Rapid Diagnostic Test Kit', aliases: ['RDT'], contextualAliases: [], category: 'diagnostic', note: ''},
]};
const facilityContext = {revision: 1, records: [
  {id: 'zeb', name: 'Zebilla Hospital', verifiedAliases: ['ZB Referral'], source: 'test/zeb'},
  {id: 'other', name: 'Zebilla Community Hospital', source: 'test/other'},
  {id: 'north', name: 'North Zebilla Hospital', source: 'test/north'},
]};
const header = (facility = 'Zebilla Hospital') => `Orderer: Timothy Ndebugre\nFacility: ${facility}\n`;
async function audit(customer: string, fulfillment: string, options: any = {}, client?: any) {
  applyCatalog(products);
  let calls = 0;
  const result = await runGeneralProductNameAudit(customer, fulfillment, products, {facilityContext, semanticCacheScope: customer + fulfillment, ...options}, () => ({models: {async generateContent(args: any) {
    calls++;
    if (!client) throw Error('Fully recognised order must not call Gemini');
    return client(args);
  }}}));
  assert.equal(result.geminiMetrics.calls, calls);
  return {result, calls};
}

for (const name of ['Paracetamol 500mg Tablet', 'PCM 500mg', 'Pain relief 500mg Tablet', 'Paracetamol 500mg Tablets']) {
  test(`catalogue name, alias, display and FS wording resolve without Gemini: ${name}`, async () => {
    const {result, calls} = await audit(header() + `${name} - 20`, header('ZB Referral') + 'Paracetamol 500mg Tablets [20/20]');
    assert.equal(calls, 0);
    assert.equal(result.allMatch, true, JSON.stringify(result.generalAudit));
    assert.equal(result.auditDecision, 'match');
    assert.equal(result.items[0].catalogProductId, 'p500');
    assert.equal(result.items[0].catalogCategory, 'medicine');
  });
}

for (const [label, customer, fulfillment] of [
  ['strength', 'PCM 500mg - 5', 'Paracetamol 250mg Tablet [5/5]'],
  ['formulation', 'PCM 500mg - 5', 'Paracetamol 120mg/5ml Syrup, 100ml [5/5]'],
  ['missing', 'PCM 500mg - 5\nRDT - 2', 'Paracetamol 500mg Tablet [5/5]'],
  ['extra', 'PCM 500mg - 5', 'Paracetamol 500mg Tablet [5/5]\nMalaria Rapid Diagnostic Test Kit [2/2]'],
  ['quantity', 'PCM 500mg - 5', 'Paracetamol 500mg Tablet [6/6]'],
] as const) {
  test(`genuine ${label} differences remain discrepancies without Gemini`, async () => {
    const {result, calls} = await audit(header() + customer, header() + fulfillment);
    assert.equal(calls, 0); assert.equal(result.allMatch, false); assert.equal(result.auditDecision, 'discrepancy');
  });
}

test('facility exact names, approved aliases and registered word-order variations resolve safely', async () => {
  for (const facility of ['Zebilla Hospital', 'Zebilla HSP', 'ZB Referral']) {
    const {result, calls} = await audit(header(facility) + 'PCM 500mg - 5', header() + 'Paracetamol 500mg Tablet [5/5]');
    assert.equal(result.allMatch, true, facility); assert.equal(calls, 0);
    assert.equal(result.generalAudit.facility.customerFacilityId, 'zeb');
  }
  const prepared = prepareGeneralFacilityContext(facilityContext);
  assert.equal(compareGeneralFacilities('Zebilla North Hospital', 'North Zebilla Hospital', '', '', prepared).status, 'match');
  const wrong = await audit(header('Zebilla Community Hospital') + 'PCM 500mg - 5', header() + 'Paracetamol 500mg Tablet [5/5]');
  assert.equal(wrong.result.auditDecision, 'discrepancy');
});

test('titled requests extract the sender independently of the facility', async () => {
  const {result, calls} = await audit('Mr Timothy Ndebugre needs four vials of RDT.\nFacility: Zebilla Hospital', header() + 'Malaria Rapid Diagnostic Test Kit [4/4]');
  assert.equal(result.generalAudit.orderer.whatsappValue, 'Timothy Ndebugre');
  assert.equal(result.allMatch, true, JSON.stringify(result.generalAudit));
  assert.equal(calls, 0);
});

test('stockouts, partial stockouts and approved order limits retain their existing exceptions', async () => {
  for (const fulfillment of ['Malaria Rapid Diagnostic Test Kit [0/1]', 'Malaria Rapid Diagnostic Test Kit [3/5] — partially out of stock']) {
    const {result, calls} = await audit(header() + 'RDT - 5', header() + fulfillment);
    assert.equal(result.allMatch, true, JSON.stringify(result.generalAudit)); assert.equal(calls, 0);
  }
  const limited = await audit(header() + 'RDT - 5', header() + 'Malaria Rapid Diagnostic Test Kit [3/5]', {generalOrderLimitDecisions: {rdt: true}});
  assert.equal(limited.result.allMatch, true); assert.equal(limited.calls, 0);
  const pending = await audit(header() + 'RDT - 5', header() + 'Malaria Rapid Diagnostic Test Kit [3/5]');
  assert.equal(pending.result.generalAudit.decision, 'review');
  const approved = applyGeneralOrderLimitDecision(pending.result, 'rdt', true);
  assert.equal(approved.allMatch, true); assert.equal(approved.generalAudit.decision, 'match');
  const rejected = applyGeneralOrderLimitDecision(pending.result, 'rdt', false);
  assert.equal(rejected.allMatch, false); assert.equal(rejected.generalAudit.decision, 'discrepancy');
});

test('unknown product Gemini suggestions remain pending and quota failures retain known products', async () => {
  const source = header() + 'Fevercare 500mg Tablet - 5\nRDT - 2';
  const fs = header() + 'Paracetamol 500mg Tablet [5/5]\nMalaria Rapid Diagnostic Test Kit [2/2]';
  const suggested = await audit(source, fs, {}, async (args: any) => {
    assert.match(args.contents, /Fevercare/);
    assert.doesNotMatch(args.contents, /Timothy|Zebilla/);
    return {text: JSON.stringify({matches: [{alias: 'Fevercare 500mg Tablet', productId: 'p500', confidence: 0.99, clinicalUncertainty: true}]})};
  });
  assert.equal(suggested.calls, 1); assert.equal(suggested.result.allMatch, false);
  assert.equal(suggested.result.auditDecision, 'review');
  assert.equal(suggested.result.generalAudit.finalStatus, 'REVIEW REQUIRED');
  assert.equal(suggested.result.aliasLearning.saved, 0);
  const input = {whatsappMessage: source, fulfillmentConfirmation: fs};
  const accepted = completeGeneralAuditRun(createGeneralAuditRun(input, 1, {}, {}, true), {...suggested.result, ...input});
  assert.equal(accepted.generalAudit.decision, 'review');
  const report = buildGeneralReport(accepted);
  assert.match(report, /audit-highlight verdict-pending/);
  assert.match(report, /verdict-badge">REVIEW REQUIRED/);
  const quota = await audit(source.replace('Fevercare', 'Unknowncare'), fs, {}, async () => {throw Object.assign(Error('quota'), {status: 429});});
  assert.equal(quota.calls, 1); assert.equal(quota.result.allMatch, false);
  assert.ok(quota.result.items.some(item => item.catalogProductId === 'rdt' && item.status === 'match'));
});

test('exact canonical labels and approved aliases retain priority over display and FS labels', () => {
  const legacy = structuredClone(products.products);
  legacy[1].displayName = 'PCM 500mg';
  legacy[1].fulfillmentSystemName = 'Pain relief 500mg Tablet';
  const resolve = createGeneralCatalogResolver(legacy);
  assert.equal(resolve('PCM 500mg').product?.id, 'p500');
  assert.equal(resolve('Pain relief 500mg Tablet').product?.id, 'p500');
  assert.equal(resolve('Paracetamol 250mg Tablet').product?.id, 'p250');
});

test('audit-local repository snapshots stay stable while the next audit sees catalogue and directory edits', () => {
  const source = structuredClone(products.products), first = createGeneralCatalogResolver(source);
  assert.equal(first('PCM 500mg').product?.id, 'p500');
  source[0].aliases = ['New approved wording'];
  const second = createGeneralCatalogResolver(source);
  assert.equal(second('New approved wording').product?.id, 'p500');
  assert.equal(second('PCM 500mg').source === 'Alias', false);
  assert.equal(first('PCM 500mg').product?.id, 'p500');
  const mutable = structuredClone(facilityContext), prepared = prepareGeneralFacilityContext(mutable);
  mutable.records[0].verifiedAliases = ['New Referral']; mutable.revision++;
  assert.equal(compareGeneralFacilities('ZB Referral', 'Zebilla Hospital', '', '', prepared).status, 'match');
  assert.notEqual(compareGeneralFacilities('ZB Referral', 'Zebilla Hospital', '', '', prepareGeneralFacilityContext(mutable)).status, 'match');
});

test('facility suggestions are directory-validated, remain reviewable and are invalidated by directory changes', async () => {
  applyCatalog(products);
  const a = extractGeneralOrderDeterministically('Orderer: Timothy Ndebugre\nCalling from Zebilla receiving point\nRDT 2', 'customer_request', facilityContext);
  const b = extractGeneralOrderDeterministically(header() + 'RDT 2', 'fulfillment_confirmation', facilityContext);
  let calls = 0;
  const client = {models: {async generateContent(args: any) {
    calls++;
    assert.doesNotMatch(args.contents, /Timothy/);
    return {text: JSON.stringify({customer: {facilityName: 'Zebilla Hospital', ordererName: null, products: [], deliveryArea: null, district: null, unresolvedFields: [], extractionConfidence: 0.99}})};
  }}};
  const support = {facilityContext, semanticCacheScope: 'smart-facility-revision', semanticTimeoutMs: 1000};
  const first = await resolveGeneralOrderExtraction(a, b, () => client, support);
  assert.equal(first.customer.order.facilityName, null);
  assert.ok(first.reviews.some(review => review.possibleMatches.includes('Zebilla Hospital') && review.requiresConfirmation));
  const changed = await resolveGeneralOrderExtraction(a, b, () => client, {...support, facilityContext: {revision: 2, records: []}});
  assert.equal(calls, 2);
  assert.ok(changed.reviews.every(review => !review.possibleMatches.includes('Zebilla Hospital')));
});
