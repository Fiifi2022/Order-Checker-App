import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareGeneralFacilities, normalizeGeneralFacilityName, type GeneralFacilityRecord } from '../src/utils/generalFacility';
import { runGeneralAuditor, applyGeneralOrderLimitDecision } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import Details from '../src/components/GeneralAuditDetails';
import Summary from '../src/components/GeneralFulfillmentSummary';

const records: GeneralFacilityRecord[] = [
  { id: 'fs-yagaba-1', name: 'Yagaba Health Centre', district: 'District One', region: 'Region One', source: 'test/one' },
  { id: 'fs-yagaba-2', name: 'Yagaba HC', district: 'District Two', region: 'Region Two', source: 'test/two' },
];
const customer = 'Facility: Yagaba Health Centre\nOrderer: NYANKUNI MANYABE\nASV - 4 vials';
const system = 'Facility: Yagaba HC\nOrderer: NYANKUNI MANYABE\nASV [4/4]';
const compare = (left: string, right: string, customerExtra = '', systemExtra = '', data = records) => compareGeneralFacilities(left, right, `Facility: ${left}\n${customerExtra}`, `Facility: ${right}\n${systemExtra}`, { records: data });
const banned = /name resolves to multiple facility records|Verify the facility ID, district and region|Manually verify the facility before dispatch|Facility record:|Possible Facility Match|FACILITY REVIEW REQUIRED|Region One|Region Two/i;
const render = (details: Parameters<typeof Details>[0]['details']) => renderToStaticMarkup(createElement('div', null, createElement(Details, { details }), createElement(Summary, { details })));

for (const [left, right] of [['Yagaba Health Centre', 'Yagaba HC'], ['YAGABA H/C', 'yagaba health centre'], ['Yagaba CHPS', 'Yagaba Community-based Health Planning and Services'], ['Yagab Health Centre', 'Yagaba HC'], ['Yagaba Heath Centre', 'Yagaba Health Center']] as const) {
  test(`facility names match after normalization: ${left} / ${right}`, () => {
    const result = compare(left, right, '', '', []);
    assert.equal(result.status, 'match');
    assert.equal(result.identityStatus, 'unresolved');
    assert.equal(result.requiresDispatchConfirmation, true);
  });
}

test('duplicate names produce MATCH without choosing an arbitrary identity or showing ambiguity', async () => {
  for (const data of [records, [...records].reverse()]) {
    let calls = 0;
    const result = await runGeneralSemanticAudit(customer, system, {}, { facilityContext: { records: data } }, () => { calls++; throw Error('AI unnecessary'); });
    assert.equal(calls, 0);
    assert.equal(result.allMatch, true);
    assert.equal(result.issueCount, 0);
    assert.equal(result.generalAudit.facility.status, 'match');
    assert.equal(result.generalAudit.facility.identityStatus, 'unresolved');
    assert.equal(result.generalAudit.facility.customerFacilityId, undefined);
    assert.equal(result.generalAudit.facility.fulfillmentFacilityId, undefined);
    assert.deepEqual(result.generalAudit.dispatchReadiness, { canDispatchAutomatically: false, requiresFacilityConfirmation: true });
    assert.equal(result.canDispatchAutomatically, false);
    assert.deepEqual(result.generalAudit.warnings, []);
    assert.doesNotMatch(render(result.generalAudit), banned);
    assert.match(render(result.generalAudit), /Facility Name \(mandatory\)<\/span><span class="text-green-700">MATCH/);
  }
});

for (const scope of ['Facility ID: fs-yagaba-2', 'District: District Two', 'Region: Region Two']) {
  test(`Fulfilment System context resolves duplicates internally: ${scope}`, () => {
    const result = compare('Yagaba Health Centre', 'Yagaba HC', '', scope);
    assert.equal(result.status, 'match');
    assert.equal(result.identityStatus, 'resolved');
    assert.equal(result.customerFacilityId, 'fs-yagaba-2');
    assert.equal(result.fulfillmentFacilityId, 'fs-yagaba-2');
    assert.equal(result.requiresDispatchConfirmation, false);
    const audit = runGeneralAuditor(customer, system + '\n' + scope, {}, { facilityContext: { records } });
    assert.equal(audit.allMatch, true);
    assert.equal(audit.canDispatchAutomatically, true);
    assert.doesNotMatch(render(audit.generalAudit), banned);
  });
}

test('a geography shared by two real IDs cannot resolve an arbitrary record', () => {
  const samePlace = records.map(record => ({ ...record, district: 'Same District', region: 'Same Region' }));
  const result = compare('Yagaba HC', 'Yagaba Health Centre', '', 'District: Same District', samePlace);
  assert.equal(result.status, 'match');
  assert.equal(result.identityStatus, 'unresolved');
  assert.equal(result.fulfillmentFacilityId, undefined);
  assert.equal(result.requiresDispatchConfirmation, true);
});

test('minor spelling differences cannot override genuine reference-ID conflicts', () => {
  assert.equal(compare('Yagaba HC', 'Yagaba HC', 'Facility ID: fs-yagaba-1', 'Facility ID: fs-yagaba-2').status, 'mismatch');
  assert.equal(compare('Yagaba HC', 'Yagaba Hospital').status, 'mismatch');
  assert.equal(compare('Yagaba HC', 'Another Facility').status, 'mismatch');
  assert.equal(compare('Site 1 HC', 'Site 2 HC', '', '', []).status, 'mismatch');
});

test('name-only matching never authorizes automatic dispatch without a resolved target', () => {
  const result = runGeneralAuditor(customer, system);
  assert.equal(result.allMatch, true);
  assert.equal(result.canDispatchAutomatically, false);
  assert.equal(result.requiresFacilityConfirmation, true);
  assert.doesNotMatch(result.generalAudit.message || '', /ready for dispatch/i);
});

test('client completion and order-limit decisions preserve unresolved duplicate identities', () => {
  const server = runGeneralAuditor(customer, system, {}, { facilityContext: { records } });
  const inputs = { whatsappMessage: customer, fulfillmentConfirmation: system };
  const result = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...server, ...inputs, auditEngine: 'general-deterministic-v1' });
  assert.equal(result.generalAudit.facility.status, 'match');
  assert.equal(result.canDispatchAutomatically, false);
  assert.equal(result.generalAudit.facility.fulfillmentFacilityId, undefined);
  const short = runGeneralAuditor(customer, system.replace('[4/4]', '[3/4]'), {}, { facilityContext: { records } });
  const confirmed = applyGeneralOrderLimitDecision(short, short.items[0].fulfillment.key, true);
  assert.equal(confirmed.canDispatchAutomatically, false);
});

test('new input discards an earlier resolved duplicate identity', () => {
  const before = runGeneralAuditor(customer, system + '\nFacility ID: fs-yagaba-2', {}, { facilityContext: { records } });
  const inputs = { whatsappMessage: customer, fulfillmentConfirmation: system };
  const result = completeGeneralAuditRun(createGeneralAuditRun(inputs, 2, {}, { facilityContext: { records } }, true), { ...before, whatsappMessage: customer, fulfillmentConfirmation: system + '\nFacility ID: fs-yagaba-2', auditEngine: 'general-deterministic-v1' });
  assert.equal(result.generalAudit.facility.identityStatus, 'unresolved');
  assert.equal(result.generalAudit.facility.fulfillmentFacilityId, undefined);
  assert.equal(result.canDispatchAutomatically, false);
});

test('old duplicate-record results cannot expose record lists or facility ambiguity notices', () => {
  const result = runGeneralAuditor(customer, system);
  const details = { ...result.generalAudit, facility: { ...result.generalAudit.facility, status: 'review required' as const, reason: 'The name resolves to multiple facility records. Verify the facility ID, district and region.', evidence: records }, warnings: ['FACILITY REVIEW REQUIRED'], finalStatus: 'REVIEW REQUIRED — POSSIBLE FACILITY MATCH', message: 'Possible facility match. Manually verify the facility before dispatch.' };
  const markup = render(details);
  assert.doesNotMatch(markup, banned);
  assert.match(markup, /Facility Name \(mandatory\)<\/span><span class="text-green-700">MATCH/);
  assert.doesNotMatch(markup, /role="status"/);
});

test('normalization keeps genuinely different facility types distinct', () => {
  assert.notEqual(normalizeGeneralFacilityName('Yagaba HC'), normalizeGeneralFacilityName('Yagaba CHPS'));
  assert.notEqual(normalizeGeneralFacilityName('Yagaba HC'), normalizeGeneralFacilityName('Yagaba Hospital'));
});
