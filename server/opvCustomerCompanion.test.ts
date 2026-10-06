import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllFacilities, syncAllDistrictsToFacilities, validateVaccineOrder } from './vaccineService';

const facilityName = 'OPV CUSTOMER RULE TEST CLINIC';
function check(customer: string, fulfilment = 'OPV (One and Three) [10/10]\nOPV Dropper [10/10]', orderSource: 'whatsapp' | 'fs_only' = 'whatsapp') {
  syncAllDistrictsToFacilities(['OPV','OPV Dropper','Rota','Rota Dropper','BCG','BCG Diluent','IPV'].map(vaccine => ({ facility: facilityName, vaccine, allocation: 50, remaining: 50 })), 'unit test');
  return validateVaccineOrder({ facilityId: getAllFacilities()[0].id, orderSource, whatsappMessage: customer, fulfillmentConfirmation: `Facility: ${facilityName}\n${fulfilment}` });
}

test('OPV-only customer request passes when fulfilment includes the matching dropper', () => {
  const result = check('OPV 10');
  assert.equal(result.isValid,true,result.errors.join(' '));
  assert.equal(result.errors.length,0);
  const dropper = result.items.find(item => item.vaccine === 'OPV Dropper');
  assert.equal(dropper.requestedQty,0); assert.equal(dropper.fsQty,10);
  assert.equal(dropper.isUnexpected,undefined); assert.equal(dropper.status,'valid');
});

test('scenario 2: explicit customer and fulfilled OPV/dropper quantities match', () => {
  const result = check('OPV 10\nOPV Dropper 10');
  assert.equal(result.isValid,true,result.errors.join(' '));
});

test('scenario 3: explicitly requested dropper missing in fulfilment is blocked', () => {
  const result = check('OPV 10\nOPV Dropper 10','OPV (One and Three) [10/10]');
  assert.equal(result.isValid,false);
  assert.ok(result.errors.some(error => /OPV Dropper.*MISSING|REQUIRED ACCESSORY MISSING/.test(error)));
  assert.ok(!result.errors.some(error => /CUSTOMER REQUEST MISSING COMPANION/.test(error)));
});

test('every requested dropper alias satisfies customer presence without false extra flags', () => {
  for (const alias of ['OPV dropper','OPV vaccine dropper','Oral Polio Vaccine Dropper','oral polio dropper','polio dropper','dropper for OPV']) {
    const result = check(`OPV 10\n${alias} 10`);
    assert.equal(result.isValid,true,alias + ': ' + result.errors.join(' '));
  }
  assert.equal(check('OPV 10 with droppers').isValid,true);
});

test('presence without a quantity satisfies keyword requirement but still needs quantity validation', () => {
  const result = check('OPV 10\npolio dropper');
  assert.equal(result.isValid,false);
  assert.ok(result.errors.some(error => /MISSING_QUANTITY/.test(error)));
  assert.ok(!result.errors.some(error => /CUSTOMER REQUEST MISSING COMPANION/.test(error)));
});

test('fulfilment pair inequality remains a discrepancy independent of customer presence', () => {
  for (const customer of ['OPV 10','OPV 10\nOPV Dropper 10']) {
    const result = check(customer,'OPV [10/10]\nOPV Dropper [8/10]');
    assert.equal(result.isValid,false);
    assert.ok(result.errors.some(error => /ACCESSORY QUANTITY MISMATCH/.test(error)));
    assert.ok(!result.errors.some(error => /UNEXPECTED PRODUCT/.test(error)));
  }
});

test('other vaccine companions and FS-only audits retain existing behavior', () => {
  for (const [customer, fulfilment] of [['Rota 10','Rota [10/10]\nRota Dropper [10/10]'],['BCG 10','BCG [10/10]\nBCG Diluent [10/10]'],['IPV 10','IPV [10/10]']]) {
    assert.equal(check(customer,fulfilment).isValid,true,customer);
  }
  assert.equal(check('','OPV [10/10]\nOPV Dropper [10/10]','fs_only').isValid,true);
  assert.equal(check('OPV 10\nRota Dropper 10').isValid,false);
});

test('OPV-only fulfilment is blocked even when customer did not request a dropper', () => {
  const result = check('OPV 10','OPV [10/10]');
  assert.equal(result.isValid,false);
  assert.ok(result.errors.some(error => /REQUIRED ACCESSORY MISSING/.test(error)));
  assert.deepEqual(result.items.find(item => item.vaccine === 'OPV').companionDiscrepancy, {
    type: 'MISSING_COMPANION_PRODUCT', product: 'OPV', companion: 'OPV Dropper'
  });
});
