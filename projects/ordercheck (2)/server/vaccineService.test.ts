import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllFacilities, matchVaccineName, parseVaccineLinesDetailed, syncAllDistrictsToFacilities, validateVaccineOrder } from './vaccineService';

const fullNameMappings = [
  ['Bacille Calmette-Guerin Vaccine', 'BCG'],
  ['Bacille Calmette-Guerin Vaccine Diluent', 'BCG Diluent'],
  ['Diphtheria & Tetanus Vaccine', 'DT'],
  ['Inactivated Polio Vaccine', 'IPV'],
  ['Oral Polio Vaccine Dropper', 'OPV Dropper'],
  ['Oral Polio Vaccine (1&3)', 'OPV'],
  ['Pentavalent (5-in-1) Vaccine', 'Penta'],
  ['Pneumococcal Conjugate Vaccine', 'PCV'],
  ['Rotavirus Vaccine Dropper', 'Rota Dropper'],
  ['Rotavirus Vaccine', 'Rota'],
  ['Yellow Fever Vaccine', 'Yellow Fever'],
  ['Yellow Fever Vaccine Diluent', 'Yellow Fever Diluent']
] as const;

test('all named FS products map to their blueprint names', () => {
  for (const [fsName, expected] of fullNameMappings) {
    const actual = matchVaccineName(fsName);
    assert.equal(actual.canonical, expected, fsName);
    assert.equal(actual.confidence, 'high', fsName);
  }
});

test('diluent and dropper aliases take precedence over vaccine aliases', () => {
  assert.equal(matchVaccineName('  BACILLE   CALMETTE-GUERIN VACCINE DILUENT ').canonical, 'BCG Diluent');
  assert.equal(matchVaccineName('Rotavirus Vaccine Dropper').canonical, 'Rota Dropper');
  assert.equal(matchVaccineName('Oral Polio Vaccine Dropper').canonical, 'OPV Dropper');
  assert.equal(matchVaccineName('Rotavirus Vaccine').canonical, 'Rota');
  assert.equal(matchVaccineName('Oral Polio Vaccine (1&3)').canonical, 'OPV');
});

test('parsed FS products are classified as primary vaccines, diluents, or droppers', () => {
  const parsed = parseVaccineLinesDetailed([
    'BCG Vaccine [2/2]',
    'BCG Diluent [2/2]',
    'Oral Polio Vaccine (1&3) [3/3]',
    'Oral Polio Vaccine Dropper [3/3]',
    'Mystery Vaccine [1/1]'
  ].join('\n'));
  assert.deepEqual(parsed.items.map(item => [item.canonical, item.productType]), [
    ['BCG', 'PRIMARY_VACCINE'],
    ['BCG Diluent', 'DILUENT'],
    ['OPV', 'PRIMARY_VACCINE'],
    ['OPV Dropper', 'DROPPER'],
    ['Mystery Vaccine', 'OTHER_ACCESSORY']
  ]);
});

test('bracket quantities are parsed once and normalize all quantified products', () => {
  const text = [
    'Bacille Calmette-Guerin Vaccine [2/2]',
    'Bacille Calmette-Guerin Vaccine Diluent [2/2]',
    'Diphtheria & Tetanus Vaccine [1/1]',
    'Inactivated Polio Vaccine [2/2]',
    'Oral Polio Vaccine Dropper [3/3]',
    'Oral Polio Vaccine (1&3) [3/3]',
    'Pentavalent (5-in-1) Vaccine [4/4]',
    'Pneumococcal Conjugate Vaccine [15/15]',
    'Rotavirus Vaccine Dropper [3/3]',
    'Rotavirus Vaccine [3/3]',
    'Yellow Fever Vaccine [2/2]',
    'Yellow Fever Vaccine Diluent'
  ].join('\n');

  const result = parseVaccineLinesDetailed(text);
  assert.deepEqual(
    result.items.map(({ canonical, quantity }) => [canonical, quantity]),
    [
      ['BCG', 2],
      ['BCG Diluent', 2],
      ['DT', 1],
      ['IPV', 2],
      ['OPV Dropper', 3],
      ['OPV', 3],
      ['Penta', 4],
      ['PCV', 15],
      ['Rota Dropper', 3],
      ['Rota', 3],
      ['Yellow Fever', 2]
    ]
  );
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /MISSING_QUANTITY: "Yellow Fever Diluent"/);
  assert.doesNotMatch(result.errors[0], /UNKNOWN_PRODUCT/);
});

test('a truly unknown product stays unknown', () => {
  const result = parseVaccineLinesDetailed('Mystery Vaccine [2/2]');
  assert.equal(result.items[0]?.confidence, 'none');
  assert.equal(result.items[0]?.canonical, 'Mystery Vaccine');
});

test('an unknown product without a quantity is reported as unknown, not as a known-name quantity issue', () => {
  const result = parseVaccineLinesDetailed('Mystery Vaccine');
  assert.equal(result.items.length, 0);
  assert.match(result.errors[0], /UNKNOWN_PRODUCT: "Mystery Vaccine"/);
  assert.doesNotMatch(result.errors[0], /MISSING_QUANTITY/);
});

test('paired FS products require both confirmation lines and equal quantities', () => {
  const facilityName = 'DILUENT ALLOCATION TEST CLINIC';
  const setAllocations = (diluentAllocation = 9, diluentRemaining = 7) => {
    syncAllDistrictsToFacilities([
      { facility: facilityName, vaccine: 'BCG', allocation: 10, taken: 2, remaining: 8, district: 'Test' },
      { facility: facilityName, vaccine: 'BCG Diluent', allocation: diluentAllocation, taken: diluentAllocation - diluentRemaining, remaining: diluentRemaining, district: 'Test' }
    ], 'unit test');
  };
  const audit = (diluentLine: string) => {
    const facility = getAllFacilities().find(item => item.facilityName === facilityName);
    assert.ok(facility);
    return validateVaccineOrder({
      facilityId: facility.id,
      orderSource: 'fs_only',
      fulfillmentConfirmation: `Facility: ${facilityName}\nBCG Vaccine [1/1]${diluentLine}`
    });
  };

  setAllocations();
  const equalQuantities = audit('\nBCG Diluent [1/1]');
  assert.equal(equalQuantities.isValid, true, equalQuantities.errors.join('\n'));

  const omittedCompanion = audit('');
  assert.equal(omittedCompanion.isValid, false);
  assert.ok(omittedCompanion.errors.some(error => error.includes('REQUIRED DILUENT MISSING')));

  const unequalQuantities = audit('\nBCG Diluent [2/2]');
  assert.equal(unequalQuantities.isValid, false);
  assert.ok(unequalQuantities.errors.some(error => error.includes('DILUENT QUANTITY MISMATCH')));

  const exhaustedCompanionFacility = 'ALLOCATED COMPANION BALANCE TEST CLINIC';
  syncAllDistrictsToFacilities([
    { facility: exhaustedCompanionFacility, vaccine: 'BCG', allocation: 10, remaining: 10, district: 'Test' },
    { facility: exhaustedCompanionFacility, vaccine: 'BCG Diluent', allocation: 2, taken: 2, remaining: 0, district: 'Test' }
  ], 'unit test');
  const exhaustedFacility = getAllFacilities().find(item => item.facilityName === exhaustedCompanionFacility);
  assert.ok(exhaustedFacility);
  const allocatedCompanionExhausted = validateVaccineOrder({
    facilityId: exhaustedFacility.id,
    orderSource: 'fs_only',
    fulfillmentConfirmation: `Facility: ${exhaustedCompanionFacility}\nBCG Vaccine [2/2]\nBCG Diluent [2/2]`
  });
  assert.equal(allocatedCompanionExhausted.isValid, false);
  assert.ok(allocatedCompanionExhausted.errors.some(error => error.includes('ALLOCATION EXHAUSTED') && error.includes('BCG Diluent')));
});

test('unallocated accessories are optional in the blueprint but still pair-check quantities', () => {
  const facilityName = 'OPTIONAL ACCESSORY TEST CLINIC';
  syncAllDistrictsToFacilities([
    { facility: facilityName, vaccine: 'BCG', allocation: 10, taken: 0, remaining: 10, district: 'Test' }
  ], 'unit test');

  const facility = getAllFacilities().find(item => item.facilityName === facilityName);
  assert.ok(facility);
  const audit = (diluentQuantity: number) => validateVaccineOrder({
    facilityId: facility.id,
    orderSource: 'fs_only',
    fulfillmentConfirmation: `Facility: ${facilityName}\nBCG Vaccine [2/2]\nBCG Diluent [${diluentQuantity}/${diluentQuantity}]`
  });

  const matchingPair = audit(2);
  assert.equal(matchingPair.isValid, true, matchingPair.errors.join('\n'));
  assert.ok(!matchingPair.errors.some(error => error.includes('NOT IN BLUEPRINT')));

  const mismatchedPair = audit(1);
  assert.equal(mismatchedPair.isValid, false);
  assert.ok(mismatchedPair.errors.some(error => error.includes('DILUENT QUANTITY MISMATCH')));
  assert.ok(!mismatchedPair.errors.some(error => error.includes('NOT IN BLUEPRINT')));
});

test('accessories without blueprint rows are pair-checked; missing and orphan companions fail', () => {
  const facilityName = 'OPTIONAL ACCESSORY TEST CLINIC';
  syncAllDistrictsToFacilities([
    { facility: facilityName, vaccine: 'BCG', allocation: 10, taken: 0, remaining: 10, district: 'Test' }
  ], 'unit test');

  const facility = getAllFacilities().find(item => item.facilityName === facilityName);
  assert.ok(facility);
  const audit = (lines: string) => validateVaccineOrder({
    facilityId: facility.id,
    orderSource: 'fs_only',
    fulfillmentConfirmation: `Facility: ${facilityName}\n${lines}`
  });

  const equalPair = audit('BCG Vaccine [2/2]\nBCG Diluent [2/2]');
  assert.equal(equalPair.isValid, true, equalPair.errors.join('\n'));
  assert.equal(equalPair.items.find(item => item.vaccine === 'BCG Diluent')?.isNotAllocated, false);

  const missingDiluent = audit('BCG Vaccine [2/2]');
  assert.equal(missingDiluent.isValid, false);
  assert.ok(missingDiluent.errors.some(error => error.includes('REQUIRED DILUENT MISSING')));
  assert.ok(!missingDiluent.errors.some(error => error.includes('PRODUCT NOT ALLOCATED') && error.includes('BCG Diluent')));

  const orphanDiluent = audit('BCG Diluent [2/2]');
  assert.equal(orphanDiluent.isValid, false);
  assert.ok(orphanDiluent.errors.some(error => error.includes('ORPHAN DILUENT')));
  assert.ok(!orphanDiluent.errors.some(error => error.includes('PRODUCT NOT ALLOCATED') && error.includes('BCG Diluent')));
});

test('primary vaccine allocation remains strict when an accessory pair matches', () => {
  const facilityName = 'STRICT PRIMARY ALLOCATION TEST CLINIC';
  syncAllDistrictsToFacilities([
    { facility: facilityName, vaccine: 'Rota', allocation: 3, taken: 0, remaining: 3, district: 'Test' }
  ], 'unit test');

  const facility = getAllFacilities().find(item => item.facilityName === facilityName);
  assert.ok(facility);
  const overAllocation = validateVaccineOrder({
    facilityId: facility.id,
    orderSource: 'fs_only',
    fulfillmentConfirmation: `Facility: ${facilityName}\nRotavirus Vaccine [4/4]\nRotavirus Vaccine Dropper [4/4]`
  });
  assert.equal(overAllocation.isValid, false);
  assert.ok(overAllocation.errors.some(error => error.includes('ALLOCATION EXCEEDED') && error.includes('Rota')));
  assert.ok(!overAllocation.errors.some(error => error.includes('PRODUCT NOT ALLOCATED') && error.includes('Rota Dropper')));

  const unallocatedPrimaryFacility = 'UNALLOCATED PRIMARY TEST CLINIC';
  syncAllDistrictsToFacilities([
    { facility: unallocatedPrimaryFacility, vaccine: 'BCG', allocation: 0, taken: 0, remaining: 0, district: 'Test' }
  ], 'unit test');
  const unallocatedFacility = getAllFacilities().find(item => item.facilityName === unallocatedPrimaryFacility);
  assert.ok(unallocatedFacility);
  const missingBlueprint = validateVaccineOrder({
    facilityId: unallocatedFacility.id,
    orderSource: 'fs_only',
    fulfillmentConfirmation: `Facility: ${unallocatedPrimaryFacility}\nOPV [2/2]\nOPV Dropper [2/2]`
  });
  assert.equal(missingBlueprint.isValid, false);
  assert.ok(missingBlueprint.errors.some(error => error.includes('PRODUCT NOT ALLOCATED') && error.includes('OPV')));
});

test('a facility mismatch flags only the facility and skips product allocation checks', () => {
  const selectedFacilityName = 'FACILITY TARGET TEST CLINIC';
  const fsFacilityName = 'DIFFERENT FS DESTINATION CLINIC';
  syncAllDistrictsToFacilities([
    { facility: selectedFacilityName, vaccine: 'BCG', allocation: 2, remaining: 2, district: 'Test' },
    { facility: fsFacilityName, vaccine: 'OPV', allocation: 2, remaining: 2, district: 'Test' }
  ], 'unit test');

  const selectedFacility = getAllFacilities().find(item => item.facilityName === selectedFacilityName);
  assert.ok(selectedFacility);
  const result = validateVaccineOrder({
    facilityId: selectedFacility.id,
    orderSource: 'fs_only',
    fulfillmentConfirmation: `Facility: ${fsFacilityName}\nOPV [5/5]\nMystery Vaccine [3/3]`
  });

  assert.equal(result.isValid, false);
  assert.equal(result.facilityMismatch, true);
  assert.equal(result.items.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /FACILITY MISMATCH/);
  assert.doesNotMatch(result.errors.join('\n'), /ALLOCATION|PRODUCT NOT ALLOCATED|UNKNOWN_PRODUCT/);
});

test('the exact Katigri FS confirmation passes with primary rows only in the blueprint', () => {
  const facilityName = 'Katigri CHPS';
  const primaryAllocations = [
    ['BCG', 2],
    ['DT', 1],
    ['IPV', 2],
    ['OPV', 3],
    ['Penta', 4],
    ['PCV', 15],
    ['Rota', 3],
    ['Yellow Fever', 2]
  ] as const;
  syncAllDistrictsToFacilities(primaryAllocations.map(([vaccine, quantity]) => ({
    facility: facilityName,
    vaccine,
    allocation: quantity,
    taken: 0,
    remaining: quantity,
    district: 'MMD'
  })), 'unit test');

  const facility = getAllFacilities().find(item => item.facilityName === facilityName);
  assert.ok(facility);
  const confirmation = [
    `Facility: ${facilityName}`,
    'Bacille Calmette-Guerin Vaccine [2/2]',
    'Bacille Calmette-Guerin Vaccine Diluent [2/2]',
    'Diphtheria & Tetanus Vaccine [1/1]',
    'Inactivated Polio Vaccine [2/2]',
    'Oral Polio Vaccine Dropper [3/3]',
    'Oral Polio Vaccine (1&3) [3/3]',
    'Pentavalent (5-in-1) Vaccine [4/4]',
    'Pneumococcal Conjugate Vaccine [15/15]',
    'Rotavirus Vaccine Dropper [3/3]',
    'Rotavirus Vaccine [3/3]',
    'Yellow Fever Vaccine [2/2]',
    'Yellow Fever Vaccine Diluent [2/2]'
  ].join('\n');

  const result = validateVaccineOrder({
    facilityId: facility.id,
    orderSource: 'fs_only',
    fulfillmentConfirmation: confirmation
  });
  assert.equal(result.isValid, true, result.errors.join('\n'));
  assert.deepEqual(result.errors, []);
  for (const companion of ['BCG Diluent', 'OPV Dropper', 'Rota Dropper', 'Yellow Fever Diluent']) {
    assert.ok(!result.errors.some(error => error.includes('NOT IN BLUEPRINT') && error.includes(companion)));
    assert.equal(result.items.find(item => item.vaccine === companion)?.isNotAllocated, false);
  }
});

test('YF, MR, OPV, and Rota accessories only flag pair quantity mismatches', () => {
  const facilityName = 'ALL PAIRS TEST CLINIC';
  const pairs = [
    { vaccine: 'Yellow Fever Vaccine', vaccineKey: 'Yellow Fever', accessory: 'Yellow Fever Vaccine Diluent', accessoryKey: 'Yellow Fever Diluent', type: 'DILUENT' },
    { vaccine: 'Measles Rubella Vaccine', vaccineKey: 'MR', accessory: 'MR Diluent', accessoryKey: 'MR Diluent', type: 'DILUENT' },
    { vaccine: 'Oral Polio Vaccine (1&3)', vaccineKey: 'OPV', accessory: 'Oral Polio Vaccine Dropper', accessoryKey: 'OPV Dropper', type: 'DROPPER' },
    { vaccine: 'Rotavirus Vaccine', vaccineKey: 'Rota', accessory: 'Rotavirus Vaccine Dropper', accessoryKey: 'Rota Dropper', type: 'DROPPER' }
  ];
  syncAllDistrictsToFacilities(pairs.flatMap(pair => [
    { facility: facilityName, vaccine: pair.vaccineKey, allocation: 10, remaining: 10, district: 'Test' },
    { facility: facilityName, vaccine: pair.accessoryKey, allocation: 10, remaining: 10, district: 'Test' }
  ]), 'unit test');

  const facility = getAllFacilities().find(item => item.facilityName === facilityName);
  assert.ok(facility);
  const check = (mismatchIndex = -1) => {
    const lines = pairs.flatMap((pair, index) => [
      `${pair.vaccine} [2/2]`,
      `${pair.accessory} [${index === mismatchIndex ? 1 : 2}/${index === mismatchIndex ? 1 : 2}]`
    ]);
    return validateVaccineOrder({
      facilityId: facility.id,
      orderSource: 'fs_only',
      fulfillmentConfirmation: `Facility: ${facilityName}\n${lines.join('\n')}`
    });
  };

  const allEqual = check();
  assert.equal(allEqual.isValid, true, allEqual.errors.join('\n'));
  for (const [index, pair] of pairs.entries()) {
    const mismatched = check(index);
    assert.equal(mismatched.isValid, false, pair.vaccine);
    assert.ok(mismatched.errors.some(error => error.includes(pair.type === 'DILUENT' ? 'DILUENT QUANTITY MISMATCH' : 'ACCESSORY QUANTITY MISMATCH')), pair.vaccine);
  }
});
