import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareGeneralFacilities, findGeneralFacilityNames, type GeneralFacilityRecord } from '../src/utils/generalFacility';
import { runGeneralAuditor, applyGeneralOrderLimitDecision } from './generalAuditor';
import { generalFacilityRecords, readGeneralFacilityContext } from './generalFacilityRecords';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import Details from '../src/components/GeneralAuditDetails';
import Summary from '../src/components/GeneralFulfillmentSummary';
import Confidence from '../src/components/GeneralVerificationConfidence';

// These are explicit test records, not application defaults or invented live IDs.
const records: GeneralFacilityRecord[] = [
  { id: 'test-kotoso', name: 'Kotoso Rural Health Centre', verifiedAliases: ['Kotoso RCH'], district: 'Kwahu East', region: 'Eastern', source: 'test/kotoso' },
  { id: 'test-other', name: 'Another Facility', district: 'Other District', source: 'test/other' }
];
const compare = (customer: string, system: string, data: GeneralFacilityRecord[] = []) =>
  compareGeneralFacilities(customer, system, `Facility: ${customer}`, `Facility: ${system}`, { records: data });
const request = 'Orderer: Mary Mensah\nFacility: KOTOSO RHC\nORS - 5';
const supplied = 'Orderer: Mary Mensah\nFacility: Kotoso RCH\nORS [5/5]';
const audit = (data: GeneralFacilityRecord[] = []) => runGeneralAuditor(request, supplied, {}, { facilityContext: { records: data } });

test('directory detects normalized unlabelled names and approved aliases while retaining source wording', () => {
  const directory: GeneralFacilityRecord[] = [
    {name: 'Saint Mary Health Centre', verifiedAliases: ['SM Outreach'], source: 'test/saint'},
    {name: 'Official Yagaba', source: 'test/untyped'},
  ];
  for (const mention of ['SAINT-MARY H.C.', 'Saint Mary H. C.', 'Saint Mary Health Center', 'sm-outreach', 'Official-Yagaba']) {
    const found = findGeneralFacilityNames(`Please prepare the order from ${mention} for collection.`, directory);
    assert.equal(found.length, 1, JSON.stringify({mention, found}));
    assert.equal(found[0].replace(/\.$/, ''), mention.replace(/\.$/, ''));
  }
  assert.deepEqual(findGeneralFacilityNames('Order from Unofficial-Yagaba or Official-Yagabaville.', directory), []);
  assert.deepEqual(findGeneralFacilityNames('Official. Yagaba', directory), []);
  assert.equal(findGeneralFacilityNames('Official-Yagaba and sm-outreach both need supplies.', directory).length, 2);
  assert.equal(findGeneralFacilityNames('Please send ORS 5.', directory).length, 0);
});

test('requested case, space, punctuation and Ghana facility abbreviation scenarios normalize without dropping type', () => {
  for (const [left, right] of [
    ['KOTOSO RHC', 'Kotoso RHC'], ['Kotoso RHC', 'KOTOSO RHC'],
    ['Kotoso Rural Health Centre', 'Kotoso RHC'], ['Kotoso H.C.', 'KOTOSO Health Center'],
    ['Kotoso-RHC', 'Kotoso RHC'], ['Kotoso HSP', 'Kotoso Hospital'], ['Kotoso DH', 'Kotoso District Hospital'],
    ['Kotoso PC', 'Kotoso Polyclinic'], ['Kotoso DHD', 'Kotoso District Health Directorate'],
    ['Kotoso CHPS', 'Kotoso Community-based Health Planning and Services'], ['  Kotoso,   RHC ', 'Kotoso Rural Health Center']
  ]) assert.equal(compare(left, right).status, 'match', `${left} / ${right}`);
  assert.equal(compare('Kotoso HC', 'Kotoso Hospital').status, 'mismatch');
  assert.equal(compare('Kotoso RHC', 'Another facility').status, 'mismatch');
});

test('transposed abbreviations and minor typos match names while identity still needs evidence', () => {
  for (const other of ['Kotoso RCH', 'Kotos RHC', 'Kotsoo RHC']) {
    const result = compare('Kotoso RHC', other);
    assert.equal(result.status, 'match');
    assert.equal(result.identityStatus, 'unresolved');
    assert.equal(result.requiresDispatchConfirmation, true);
  }
  const verified = compare('Kotoso RHC', 'Kotoso RCH', records);
  assert.equal(verified.status, 'match');
  assert.equal(verified.verification, 'records');
  assert.equal(verified.customerFacilityId, 'test-kotoso');
  assert.equal(verified.fulfillmentFacilityId, 'test-kotoso');
  assert.equal(compare('Kotoso RHC', 'Kotoso RCH', [{ ...records[0], verifiedAliases: [] }]).status, 'match');
});

test('explicit different identifiers override identical or similar names and AI suggestions', () => {
  const result = compareGeneralFacilities('Kotoso RHC', 'Kotoso RHC', 'Facility ID: one', 'Facility ID: two', {
    records, aiSuggestion: { customer: 'Kotoso RHC', fulfillment: 'Kotoso RHC', confidence: 1 }
  });
  assert.equal(result.status, 'mismatch');
  assert.match(result.reason!, /identifiers are different/);
  const other = compare('Kotoso RHC', 'Another Facility', records);
  assert.equal(other.status, 'mismatch');
  assert.notEqual(other.customerFacilityId, other.fulfillmentFacilityId);
});

test('district, region and official IDs distinguish duplicated facility names', () => {
  const duplicates = [records[0], { ...records[0], id: 'test-kotoso-2', district: 'Other District', region: 'Other Region', source: 'test/kotoso-2' }];
  const unscoped = compare('Kotoso RHC', 'Kotoso RHC', duplicates);
  assert.equal(unscoped.status, 'match');
  assert.equal(unscoped.identityStatus, 'unresolved');
  assert.equal(unscoped.requiresDispatchConfirmation, true);
  const scoped = compareGeneralFacilities('Kotoso RHC', 'Kotoso RCH', 'District: Kwahu East', 'Region: Eastern', { records: duplicates });
  assert.equal(scoped.status, 'match');
  const different = compareGeneralFacilities('Kotoso RHC', 'Kotoso RHC', 'District: Kwahu East', 'District: Other District', { records: duplicates });
  assert.equal(different.status, 'mismatch');
  assert.equal(compareGeneralFacilities('Kotoso RHC', 'Kotoso RHC', 'District: A', 'District: B').status, 'match');
});

test('extracts independent facilities from WhatsApp prose and standalone names without replacing explicit destinations', () => {
  for (const message of ['Please send ORS from KOTOSO RHC.', 'We need ORS for KOTOSO RHC please.', 'KOTOSO RHC', 'Hello, KOTOSO RHC needs ORS.', 'Good morning, KOTOSO RHC needs ORS.', "I’m the in charge of KOTOSO RHC.", 'This is KOTOSO RHC.']) {
    const result = runGeneralAuditor(`Orderer: Mary Mensah\n${message}\nORS - 5`, supplied, {}, { facilityContext: { records } });
    assert.equal(result.generalAudit.facility.whatsappValue, 'KOTOSO RHC', message);
    assert.equal(result.generalAudit.facility.status, 'match', message);
    assert.equal(result.allMatch, true);
  }
  assert.equal(findGeneralFacilityNames('District: Kotoso\nContact: Mary Mensah').length, 0);
  const result = runGeneralAuditor(request, 'Orderer: Mary Mensah\nFacility: Another Facility\nNote: Kotoso RHC called.\nORS [5/5]', {}, { facilityContext: { records } });
  assert.equal(result.generalAudit.facility.fulfillmentValue, 'Another Facility');
  assert.equal(result.generalAudit.facility.status, 'mismatch');
});

test('multiple unstructured facilities are reviewable rather than silently choosing the first', () => {
  const result = compareGeneralFacilities('N/A', 'Kotoso RHC', 'Deliver to Kotoso RHC or to Kade HC.', 'Facility: Kotoso RHC');
  assert.equal(result.status, 'review required');
});

test('matching names pass the audit without exposing identity warnings or changing product decisions', () => {
  const result = audit();
  assert.equal(result.allMatch, true);
  assert.equal(result.issueCount, 0);
  assert.equal(result.verdict, 'MATCH');
  assert.equal(result.auditSummary.reviewRequiredCount || 0, 0);
  assert.equal(result.confidence, 100);
  assert.equal(result.canDispatchAutomatically, false);
  assert.equal(result.requiresFacilityConfirmation, true);
  assert.equal(result.items[0].status, 'match');
  const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit })) +
    renderToStaticMarkup(createElement(Summary, { details: result.generalAudit })) +
    renderToStaticMarkup(createElement(Confidence, { summary: result.auditSummary }));
  assert.match(html, /KOTOSO RHC/);
  assert.match(html, /Kotoso RCH/);
  assert.match(html, /SYSTEM MATCH/);
  assert.doesNotMatch(html, /REVIEW REQUIRED|before dispatch|FACILITY NAME MISMATCH|DISCREPANCY FOUND|multiple facility records/);
  const verified = audit(records);
  assert.equal(verified.allMatch, true);
  assert.match(renderToStaticMarkup(createElement(Details, { details: verified.generalAudit })), /MATCH/);
});

test('verified identity survives API completion and order-limit acknowledgements; new inputs discard stale identity', () => {
  const server = { ...audit(records), auditEngine: 'general-deterministic-v1', whatsappMessage: request, fulfillmentConfirmation: supplied };
  const result = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage: request, fulfillmentConfirmation: supplied }, 1), server);
  assert.equal(result.generalAudit.facility.status, 'match');
  assert.equal(result.generalAudit.facility.verification, 'records');
  const changed = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage: request, fulfillmentConfirmation: supplied.replace('Kotoso RCH', 'Another Facility') }, 2), server);
  assert.equal(changed.generalAudit.facility.status, 'mismatch');
  const short = runGeneralAuditor(request, supplied.replace('[5/5]', '[3/5]'));
  const confirmed = applyGeneralOrderLimitDecision(short, short.items[0].fulfillment.key, true);
  assert.equal(confirmed.generalAudit.facility.status, 'match');
  assert.equal(confirmed.allMatch, true);
  assert.equal(confirmed.canDispatchAutomatically, false);
  const person = runGeneralAuditor(request, supplied.replace('Mary Mensah', 'Jane Mensah'), {}, { facilityContext: { records } });
  assert.equal(person.generalAudit.orderer.status, 'mismatch');
  assert.equal(person.issueCount, 1);
});

test('server records use real saved identifiers and explicitly verified aliases; outage never uses demo records', async () => {
  const rows = generalFacilityRecords([{ id: 'sheet', district: 'Kwahu East', rows: [
    { id: 'row', facility: 'Kotoso RHC', fsFacilityId: 'real-id', verifiedAliases: ['Kotoso RCH'], aliases: ['unverified', { name: 'Verified alias', verified: true }] },
    { id: 'another-row', facility: 'Other HC' }
  ] }]);
  assert.equal(rows[0].id, 'real-id');
  assert.deepEqual(rows[0].verifiedAliases, ['Kotoso RCH', 'Verified alias']);
  assert.equal(rows[1].id, undefined);
  assert.deepEqual(await readGeneralFacilityContext(async () => { throw new Error('offline'); }, 2500, []), { records: [], lookupUnavailable: true });
  assert.deepEqual(await readGeneralFacilityContext(() => new Promise(() => {}), 5, []), { records: [], lookupUnavailable: true });
});

test('Gemini suggestions cannot resolve identity or override authoritative record IDs', async () => {
  const pair = { customerRequest: { value: 'KOTOSO RHC', sourceText: 'Facility: KOTOSO RHC', confidence: 0.99 },
    fulfilmentConfirmation: { value: 'Kotoso RCH', sourceText: 'Facility: Kotoso RCH', confidence: 0.99 }, equivalent: true, confidence: 0.99 };
  const data = { facility: pair, orderer: { customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 }, customerProducts: [], fulfilmentProducts: [], possibleMissingProducts: [], possibleExtraProducts: [], semanticWarnings: [] };
  const getClient = () => ({ models: { generateContent: async () => ({ text: JSON.stringify(data) }) } });
  const result = await runGeneralSemanticAudit(request, supplied, {}, {}, getClient);
  assert.equal(result.generalAudit.facility.status, 'match');
  assert.equal(result.allMatch, true);
  assert.equal(result.canDispatchAutomatically, false);
  const mismatch = await runGeneralSemanticAudit(request + '\nFacility ID: one', supplied + '\nFacility ID: two', {}, { facilityContext: { records } }, getClient);
  assert.equal(mismatch.generalAudit.facility.status, 'mismatch');
});


test('contradictory directory geography and names cannot pass because their normalized spelling agrees', () => {
  const wrongDistrict = compareGeneralFacilities('Kotoso RHC', 'Kotoso RHC', '', 'District: Wrong District', { records });
  assert.equal(wrongDistrict.status, 'match');
  assert.equal(wrongDistrict.identityStatus, 'unresolved');
  assert.equal(wrongDistrict.requiresDispatchConfirmation, true);
  const wrongIdentity = compareGeneralFacilities('Kotoso RHC', 'Another Facility', 'Facility ID: test-kotoso', 'Facility ID: test-kotoso', { records });
  assert.equal(wrongIdentity.status, 'mismatch');
  assert.equal(compare('RHC', 'RHC').status, 'review required');
});


test('a semantic guess cannot choose one of several facilities in the original customer message', () => {
  const whatsappMessage = 'Orderer: Mary Mensah\nDeliver to Kotoso RHC or to Kade HC.\nORS - 5';
  const fulfillmentConfirmation = 'Orderer: Mary Mensah\nFacility: Kotoso RHC\nORS [5/5]';
  const guessed = runGeneralAuditor('Orderer: Mary Mensah\nFacility: Kotoso RHC\nORS - 5', fulfillmentConfirmation);
  const record = { ...guessed, auditEngine: 'general-deterministic-v1', whatsappMessage, fulfillmentConfirmation };
  const result = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage, fulfillmentConfirmation }, 1), record);
  assert.equal(result.generalAudit.facility.status, 'review required');
  assert.equal(result.allMatch, false);
  assert.match(result.generalAudit.facility.whatsappValue, /Kade HC/);
});
