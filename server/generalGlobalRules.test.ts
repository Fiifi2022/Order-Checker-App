import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Details from '../src/components/GeneralAuditDetails';
import Summary from '../src/components/GeneralFulfillmentSummary';
import { runGeneralSemanticAudit as audit } from './generalSemanticAudit';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';
import { compareGeneralFacilities } from '../src/utils/generalFacility';

const offline = () => { throw Error('AI is unnecessary for explicit order details'); };
const context = ['Patient: Private Person', 'Age: 43', 'Sex: Female', 'Patient needs monitoring', 'Symptoms: difficulty breathing', 'Contact: 0241234567', 'Hope you are doing well.', 'Our nurse is on leave today.'].join('\n');
const markup = (result: Awaited<ReturnType<typeof audit>>) => renderToStaticMarkup(createElement('div', null,
  createElement(Details, { details: result.generalAudit }), createElement(Summary, { details: result.generalAudit })));
const banned = /UNRESOLVED TEXT|multiple facility records|Manually verify the facility|Facility record:|Private Person|0241234567/;
const cases = [
  { name: 'structured single product', facility: 'Cedar Health Centre', fs: 'CEDAR H/C', person: 'Ama Boateng', request: 'ORS - 2 packs', supplied: 'ORS - 2 packs' },
  { name: 'multiple products and aliases', facility: 'Willow CHPS', fs: 'Willow Community-based Health Planning and Services', person: 'Kojo Owusu', request: 'Please send us four vails ASV and ORS 2 paks.', supplied: 'Anti Snake Serum Injection [4/4]\nORS - 2 packs' },
  { name: 'explicit product outside the catalogue', facility: 'Maple HC', fs: 'Maple Health Centre', person: 'Adjoa Asante', request: 'Custom Dressing - 3 packs', supplied: 'Custom Dressing - 3 packs' },
  { name: 'spelling and quantity corrections', facility: 'Spruce Health Centre', fs: 'Spruce HC', person: 'Yaw Opoku', request: 'Please send Paracetmol 4 packs', supplied: 'Paracetamol - 4 packs' },
];
for (const row of cases) for (const informal of [false, true]) {
  test(`global recognition: ${row.name}, ${informal ? 'informal' : 'structured'}`, async () => {
    const request = (informal ? `I am ${row.person} from ${row.facility}.\n` : `*Facility:* ${row.facility}\n*Orderer:* ${row.person}\n`) + row.request + '\n' + context;
    const fulfillmentConfirmation = `Facility: ${row.fs}\nOrderer: ${row.person}\n${row.supplied}\nThanks in advance.`;
    let calls = 0;
    const result = await audit(request, fulfillmentConfirmation, {}, {}, () => { calls++; return offline(); });
    assert.equal(calls, 0);
    assert.equal(result.allMatch, true);
    assert.equal(result.issueCount, 0);
    assert.equal(result.extractedOrder.ordererName, row.person);
    assert.equal(result.extractedOrder.facilityName, row.facility);
    assert.equal(result.extractedOrder.products.length, row.name.startsWith('multiple') ? 2 : 1);
    assert.deepEqual(result.generalAudit.warnings, []);
    assert.equal(result.canDispatchAutomatically, false, 'name-only recognition cannot authorize dispatch');
    assert.doesNotMatch(markup(result), banned);
    const inputs = { whatsappMessage: request, fulfillmentConfirmation };
    const final = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...result, ...inputs });
    assert.equal(final.allMatch, true);
    assert.equal(final.canDispatchAutomatically, false);
  });
}

for (const [label, supply, issue] of [
  ['orderer', 'Facility: Cedar HC\nOrderer: Different Person\nORS - 2 packs\nASV - 4 vials', 'Orderer Name Mismatch'],
  ['facility', 'Facility: Willow HC\nOrderer: Ama Boateng\nORS - 2 packs\nASV - 4 vials', 'Facility Name Mismatch'],
  ['quantity', 'ORS - 5 packs\nASV - 4 vials', 'quantity mismatch'],
  ['missing product', 'ASV - 4 vials', 'missing from System Entry'],
  ['extra product', 'ORS - 2 packs\nASV - 4 vials\nAmoxicillin - 2 packs', 'extra in System Entry'],
] as const) test(`irrelevant text cannot hide a genuine ${label} discrepancy`, async () => {
  const header = 'Facility: Cedar HC\nOrderer: Ama Boateng\n';
  const result = await audit(header + 'ORS - 2 packs\nASV - 4 vials\n' + context,
    (supply.startsWith('Facility:') ? '' : header) + supply + '\n' + context, {}, {}, offline);
  assert.equal(result.allMatch, false);
  assert.ok(result.issueCount > 0);
  assert.match(result.generalAudit.discrepancies.join('\n'), new RegExp(issue));
  assert.doesNotMatch(markup(result), banned);
});

test('a missing essential field produces one clarification across both result panels', async () => {
  const result = await audit('Facility: Cedar HC\nORS - 2 packs\n' + context,
    'Facility: Cedar HC\nOrderer: Ama Boateng\nORS - 2 packs', {}, { semanticTimeoutMs: 0 }, offline);
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 0);
  assert.equal(result.canDispatchAutomatically, false);
  assert.deepEqual(result.generalAudit.warnings, ['Orderer: Confirm the name of the person placing the order.']);
  assert.equal((markup(result).match(/Orderer: Confirm the name/g) || []).length, 1);
});

test('a missing quantity produces one clarification even with unrelated conversation', async () => {
  const header = 'Facility: Maple HC\nOrderer: Adjoa Asante\n';
  const result = await audit(header + 'ORS\n' + context, header + 'ORS - 2 packs', {}, { semanticTimeoutMs: 0 }, offline);
  assert.deepEqual(result.generalAudit.warnings, ['Quantity: Confirm the requested quantity.']);
  assert.equal((markup(result).match(/QUANTITY REVIEW/g) || []).length, 1);
  assert.equal(result.canDispatchAutomatically, false);
});

test('typos resolve duplicate identities only with authoritative Fulfilment context', () => {
  const records = [
    { id: 'one', name: 'Cedar Health Centre', district: 'North', source: 'test/one' },
    { id: 'two', name: 'Cedar HC', district: 'South', source: 'test/two' },
  ];
  const scoped = compareGeneralFacilities('Ceder HC', 'Cedar HC', '', 'Facility ID: two', { records });
  assert.equal(scoped.status, 'match');
  assert.equal(scoped.fulfillmentFacilityId, 'two');
  assert.equal(scoped.requiresDispatchConfirmation, false);
  const unresolved = compareGeneralFacilities('Ceder HC', 'Cedar HC', '', '', { records });
  assert.equal(unresolved.status, 'match');
  assert.equal(unresolved.fulfillmentFacilityId, undefined);
  assert.equal(unresolved.requiresDispatchConfirmation, true);
});

test('an unknown, unpaired request and an explicit amendment remain unresolved', async () => {
  const header = 'Facility: Cedar HC\nOrderer: Ama Boateng\n';
  for (const extra of ['Mystery preparation - 3', 'Change the quantity from 2 to 10.']) {
    const result = await audit(header + 'ORS - 2 packs\n' + extra + '\n' + context, header + 'ORS - 2 packs', {}, { semanticTimeoutMs: 0 }, offline);
    assert.equal(result.allMatch, false);
    assert.equal(result.canDispatchAutomatically, false);
    assert.ok(result.generalAudit.warnings?.length);
    assert.doesNotMatch(markup(result), banned);
  }
});
