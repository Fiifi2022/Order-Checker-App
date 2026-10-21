import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import directory from './data/served-facilities.json';
import { readGeneralFacilityContext, mergeGeneralFacilityRecords, servedFacilityRecords } from './generalFacilityRecords';
import { compareGeneralFacilities, findGeneralFacilityNames } from '../src/utils/generalFacility';
import { runGeneralAuditor } from './generalAuditor';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';

const compare = (left: string, right: string, customer = '', system = '') =>
  compareGeneralFacilities(left, right, customer, system, { records: [...servedFacilityRecords] });

test('the supplied CSV is bundled with provenance, deduplicated without inventing IDs or aliases', () => {
  const raw = readFileSync(new URL('../data/health-facilities-2026-10-19.csv', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), directory.sourceSha256);
  assert.equal(directory.sourceRowCount, 1511);
  assert.equal(directory.recordCount, 1509);
  assert.equal(servedFacilityRecords.length, 1509);
  assert.equal(directory.duplicateRows.length, 2);
  assert.equal(directory.missingValues['Locality/District'], 5);
  assert.equal(directory.missingValues['Region/County'], 1);
  assert.ok(servedFacilityRecords.every(record => !record.id && !record.verifiedAliases && record.country === 'GHANA'));
  assert.equal(servedFacilityRecords.filter(record => record.name === 'Kasaam CHPS').length, 1);
  assert.equal(servedFacilityRecords.filter(record => record.name === 'Onyemso CHPS').length, 1);
});

test('served names and standard abbreviations resolve to the imported reference without a live database', async () => {
  const context = await readGeneralFacilityContext(async () => { throw new Error('offline'); });
  assert.equal(context.lookupUnavailable, true);
  assert.equal(context.records.length, 1509);
  const record = servedFacilityRecords.find(record => record.name === 'Asaam HC')!;
  assert.ok(record);
  const result = compare('ASAAM Health Centre', 'Asaam HC');
  assert.equal(result.status, 'match');
  assert.equal(result.verification, 'records');
  assert.equal(result.evidence[0].district, 'Asante Mampong');
  assert.equal(result.customerFacilityId, undefined);
  const available = await readGeneralFacilityContext(async () => []);
  assert.equal(available.records.length, 1509);
});

test('the CSV supports normalized Kotoso RHC/RCH names without changing its supplied facility group', () => {
  const kotoso = servedFacilityRecords.find(record => record.name === 'Kotoso RCH')!;
  assert.equal(kotoso.district, 'Kwahu East');
  assert.equal(kotoso.region, 'Eastern');
  assert.equal(kotoso.facilityType, 'CHPS');
  assert.equal(compare('Kotoso RCH', 'KOTOSO RCH').verification, 'records');
  assert.equal(compare('KOTOSO RHC', 'Kotoso RCH').status, 'match');
  assert.equal(kotoso.verifiedAliases, undefined);
});

test('same-name facilities in different districts remain distinct and cannot be cleared without location evidence', () => {
  const records = servedFacilityRecords.filter(record => record.name === 'Akutuase CHPS');
  assert.equal(records.length, 2);
  assert.notEqual(records[0].district, records[1].district);
  const unscoped = compare('Akutuase CHPS', 'AKUTUASE CHPS');
  assert.equal(unscoped.status, 'match');
  assert.equal(unscoped.identityStatus, 'unresolved');
  assert.equal(unscoped.requiresDispatchConfirmation, true);
  assert.equal(compare('Akutuase CHPS', 'AKUTUASE CHPS', 'District: Atiwa East', 'Region: Eastern').status, 'match');
  assert.equal(compare('Akutuase CHPS', 'AKUTUASE CHPS', 'District: Atiwa East', 'District: Asante Akim North').status, 'mismatch');
});

test('prose can identify exact served names without a facility suffix and keeps missing geography unknown', () => {
  const record = servedFacilityRecords.find(record => record.name === 'Abuakwa South')!;
  assert.ok(record);
  const result = runGeneralAuditor('Orderer: Mary Mensah\nPlease send supplies to Abuakwa South.\nORS - 5',
    'Orderer: Mary Mensah\nFacility: Abuakwa South\nORS [5/5]', {}, { facilityContext: { records: [...servedFacilityRecords] } });
  assert.equal(result.generalAudit.facility.status, 'match');
  assert.equal(result.allMatch, true);
  assert.equal(servedFacilityRecords.find(record => record.name === 'Korania CHPS')!.district, '');
  assert.equal(servedFacilityRecords.find(record => record.name === 'Akyem Banso (Atiwa West) CHPS')!.region, '');
  assert.deepEqual(findGeneralFacilityNames('Pataban-Onyemso CHPS', [...servedFacilityRecords]), ['Pataban-Onyemso CHPS']);
});

test('matching saved records enrich the served directory without introducing duplicate identities', () => {
  const primary = servedFacilityRecords.find(record => record.name === 'Asaam HC')!;
  const linked = { ...primary, name: 'Asaam Health Centre', id: 'test-official-asaam', source: 'test/saved/asaam', verifiedAliases: ['Asaam Clinic Approved Alias'] };
  const combined = mergeGeneralFacilityRecords([primary], [linked]);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].id, 'test-official-asaam');
  assert.ok(combined[0].sources.includes(primary.source));
  assert.ok(combined[0].sources.includes(linked.source));
  const result = compareGeneralFacilities('Asaam HC', 'Asaam Clinic Approved Alias', '', '', { records: combined });
  assert.equal(result.status, 'match');
  assert.equal(result.fulfillmentFacilityId, 'test-official-asaam');
  const conflicting = mergeGeneralFacilityRecords([primary], [linked, { ...linked, id: 'test-different-id', source: 'test/other' }]);
  assert.equal(conflicting.length, 3);
  const unresolved = compareGeneralFacilities('Asaam HC', 'Asaam Health Centre', '', '', { records: conflicting });
  assert.equal(unresolved.status, 'match');
  assert.equal(unresolved.identityStatus, 'unresolved');
  assert.equal(unresolved.fulfillmentFacilityId, undefined);
  const otherDistrict = mergeGeneralFacilityRecords([primary], [{ ...linked, district: 'Other District' }]);
  assert.equal(otherDistrict.length, 2);
});

test('CSV-backed verification survives final client reconciliation with only relevant reference evidence', () => {
  const whatsappMessage = 'Orderer: Mary Mensah\nFacility: Asaam Health Centre\nORS - 5';
  const fulfillmentConfirmation = 'Orderer: Mary Mensah\nFacility: Asaam HC\nORS [5/5]';
  const audit = runGeneralAuditor(whatsappMessage, fulfillmentConfirmation, {}, { facilityContext: { records: [...servedFacilityRecords] } });
  const record = { ...audit, auditEngine: 'general-deterministic-v1', whatsappMessage, fulfillmentConfirmation };
  const final = completeGeneralAuditRun(createGeneralAuditRun({ whatsappMessage, fulfillmentConfirmation }, 1), record);
  assert.equal(final.generalAudit.facility.verification, 'records');
  assert.equal(final.generalAudit.facility.evidence.length, 1);
  assert.equal(final.generalAudit.facility.evidence[0].name, 'Asaam HC');
  assert.equal(final.allMatch, true);
});

test('complete official prose mentions do not count their embedded prefixes or locality as a second facility', () => {
  for (const name of ['Fosuansa CHPS (CR)', 'Akokoo (Abuakwa South) CHPS', 'Onomabo CHPS-AMA', 'Baptist Medical Center District HSP']) {
    const text = `Please send supplies to ${name}.`;
    assert.deepEqual(findGeneralFacilityNames(text, [...servedFacilityRecords]), [name]);
    const result = runGeneralAuditor(`Orderer: Test Operator\n${text}\nMultivitamin Syrup - 5 bottles`,
      `Orderer: Test Operator\nFacility: ${name}\nMultivitamin Syrup [5/5] bottles`, {}, { facilityContext: { records: [...servedFacilityRecords] } });
    assert.equal(result.generalAudit.facility.status, 'match', name);
  }
  const two = findGeneralFacilityNames('Send to Akokoo (Abuakwa South) CHPS or to Abuakwa South.', [...servedFacilityRecords]);
  assert.equal(two.length, 2, 'separate source mentions still require review');
});
