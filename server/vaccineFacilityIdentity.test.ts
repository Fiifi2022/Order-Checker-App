import test from 'node:test';
import assert from 'node:assert/strict';
import {vaccineFacilityMentions, vaccineFacilityNamesMatch} from './vaccineFacilityIdentity';
import {getAllFacilities, syncAllDistrictsToFacilities, validateVaccineOrder} from './vaccineService';

const context = {records: [{name: 'Example Health Centre', verifiedAliases: ['Official Example'], source: 'test/example'}]};

test('vaccine facility reading uses source-backed prose and approved normalized aliases', () => {
  for (const [text, expected] of [
    ['Thank you Grace Akabati from Example H.C. for ordering with Zipline.', 'Example H.C'],
    ['This is Grace from Official-Example. Please send IPV 2.', 'Official-Example'],
    ['\n\n\n\n\nWe are ordering from Example HC.', 'Example HC'],
  ]) assert.deepEqual(vaccineFacilityMentions(text, context), [expected]);
  assert.equal(vaccineFacilityNamesMatch('Official-Example', 'Example HC', context), true);
  assert.equal(vaccineFacilityNamesMatch('Example HC', 'Example Hospital', context), false);
  assert.equal(vaccineFacilityNamesMatch('Example North HC', 'Example HC', context), false);
  assert.equal(vaccineFacilityNamesMatch('Example HC', 'Example HC 2', context), false);
  assert.deepEqual(vaccineFacilityMentions('Please send IPV 2.', context), []);
});

test('vaccine facility detection preserves explicit ordering facility and does not silently pick competing names', () => {
  assert.deepEqual(vaccineFacilityMentions('This is Grace from Example HC. Please deliver to Another HC.', context), ['Example HC']);
  assert.equal(vaccineFacilityMentions('We are ordering from Example HC or Another HC.', context).length, 2);
  assert.equal(vaccineFacilityMentions('Facility: Example HC\nFacility: Another HC', context).length, 2);
  const ambiguous = {records: [...context.records, {name: 'Another Health Centre', verifiedAliases: ['Official Example'], source: 'test/other'}]};
  assert.equal(vaccineFacilityNamesMatch('Official Example', 'Example HC', ambiguous), false);
});

test('vaccine audits recognise narrative facility names and preserve allocation and mismatch checks', () => {
  syncAllDistrictsToFacilities([{facility: 'Example Health Centre', vaccine: 'IPV', allocation: 10, remaining: 10, district: 'Test', sourceSheetId: 'test', sourceRowId: 'row'}]);
  const facility = getAllFacilities()[0];
  const audit = (confirmation: string, customer?: string) => validateVaccineOrder({facilityId: facility.id, recordAudit: false,
    facilityContext: context, orderSource: customer ? 'whatsapp' : 'fs_only', whatsappMessage: customer, fulfillmentConfirmation: confirmation});
  const fs = 'Thank you Grace from Example H.C. for ordering with Zipline.\nIPV [2/2]';
  const matched = audit(fs, 'This is Grace from Official-Example.\nIPV 2');
  assert.equal(matched.isValid, true, matched.errors.join('\n'));
  assert.equal(matched.facilityMismatch, false);
  assert.equal(matched.items[0].fsQty, 2);
  assert.equal(audit(fs.replace('[2/2]', '[11/11]')).isValid, false, 'Allocation remains enforced');
  for (const text of ['IPV [2/2]', fs.replace('Example H.C.', 'Another HC'), 'Example HC or Another HC\nIPV [2/2]']) {
    const failed = audit(text);
    assert.equal(failed.isValid, false, text);
    assert.equal(failed.facilityMismatch, true, text);
    assert.equal(failed.items.length, 0, 'Do not evaluate the wrong allocation');
  }
});
