import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateGeneralAuditSummary,
  getGeneralAuditorAction,
  isExplicitZeroFulfillment,
  normalizeFacilityName,
  normalizeGhanaPhone,
  quantitiesMatchWithInternalQuantity,
  reconcileGeneralQuantityStatus
} from './generalAuditRules';

test('full zero fulfillment is out of stock while positive partial fulfillment is not', () => {
  assert.equal(isExplicitZeroFulfillment('0/5'), true);
  assert.equal(isExplicitZeroFulfillment('0 of 5'), true);
  assert.equal(isExplicitZeroFulfillment('0 vials'), true);
  assert.equal(isExplicitZeroFulfillment('3/10'), false);
  assert.equal(isExplicitZeroFulfillment('3 units'), false);
});

test('configured package quantities match the corresponding internal quantity', () => {
  assert.equal(quantitiesMatchWithInternalQuantity('2 boxes', '50 sachets', 25), true);
  assert.equal(quantitiesMatchWithInternalQuantity('1 box', '25 tests', 25), true);
  assert.equal(quantitiesMatchWithInternalQuantity('10 packs', '3 packs', 25), false);
  assert.equal(quantitiesMatchWithInternalQuantity('2 packs', '50 packs', 25), false);
  assert.equal(quantitiesMatchWithInternalQuantity('2', '50', 25), false);
});

test('Ghana phone formats normalize to the same local number', () => {
  assert.equal(normalizeGhanaPhone('0244123456'), normalizeGhanaPhone('+233244123456'));
  assert.equal(normalizeGhanaPhone('0244123456'), normalizeGhanaPhone('233244123456'));
});

test('facility suffixes normalize without erasing a different town', () => {
  assert.equal(normalizeFacilityName('Kade HC'), normalizeFacilityName('Kade Health Center'));
  assert.notEqual(normalizeFacilityName('Kade Health Center'), normalizeFacilityName('Kumasi Health Center'));
});

test('out-of-stock rows do not count as discrepancies, but real discrepancies still do', () => {
  const shortageOnly = calculateGeneralAuditSummary([
    { name: 'BCG Vaccine', status: 'out of stock' }
  ], []);
  assert.equal(shortageOnly.issueCount, 0);
  assert.equal(shortageOnly.allMatch, true);
  assert.equal(shortageOnly.verdict, 'The requested product(s) are currently out of stock');

  const mixed = calculateGeneralAuditSummary([
    { name: 'BCG Vaccine', status: 'out of stock' },
    { name: 'Rotavirus Vaccine Dropper', status: 'quantity mismatch' }
  ], []);
  assert.equal(mixed.issueCount, 1);
  assert.equal(mixed.allMatch, false);
  assert.match(mixed.verdict, /Rotavirus Vaccine Dropper \(quantity mismatch\)/);
});


test('General Auditor corrects both false matches and false mismatches from model output', () => {
  assert.equal(reconcileGeneralQuantityStatus('match', 'requested: 5 units', 'found: 3 units'), 'quantity mismatch');
  assert.equal(reconcileGeneralQuantityStatus('quantity mismatch', '2 boxes', '50 sachets', 25), 'match');
  assert.equal(reconcileGeneralQuantityStatus('missing item', '5 packs', '3 packs'), 'quantity mismatch');
  assert.equal(reconcileGeneralQuantityStatus('missing item', '5 packs', 'None'), 'missing item');
  assert.equal(reconcileGeneralQuantityStatus('match', '5 packs', 'None'), 'missing item');
});

test('General Auditor asks whether a requested product was omitted from fulfillment', () => {
  assert.equal(getGeneralAuditorAction('missing item', 'Amoxicillin', '5 packs'), 'Verify whether Amoxicillin was omitted from the Fulfilment order.');
});

test('zero fractions override every model status only with a positive whole denominator', () => {
  for (const status of ['match', 'missing item', 'extra item', 'quantity mismatch', 'out of stock']) {
    for (const n of [1, 2, 5, 10, 25]) {
      assert.equal(reconcileGeneralQuantityStatus(status, '5', `[0/${n}]`), 'out of stock');
      assert.equal(reconcileGeneralQuantityStatus(status, 'None', `[0/${n}]`), 'out of stock');
    }
  }
  for (const value of ['0/0', '0/2.5', '10/5', '0.0/5', '-0/5', '3/10']) {
    assert.equal(isExplicitZeroFulfillment(value), false, value);
  }
  assert.equal(getGeneralAuditorAction('out of stock'), 'This requested product is out of stock and was not fulfilled.');
});
