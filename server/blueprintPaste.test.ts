import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlueprintFile, parseBlueprintPaste, parseClipboardTsv } from '../src/utils/blueprintPaste';

const products = ['BCG', 'OPV'];

test('skips the complete four-row Blueprint header and maps reordered vaccine groups by their names', () => {
  const tsv = [
    '\t\t\tWest Mamprusi September 2026\t\t\t\t\t\t\t',
    'Processing\tCompleted\tFacility\tVACCINES\t\t\t\t\t\t\t',
    '\t\t\tOPV\t\t\t\tBCG\t\t\t',
    '\t\t\tCarry-over\tAllocation\tDistributed\tBalance\tCarry-over\tAllocation\tDistributed\tBalance',
    '2026-09-01\t\tClinic A\t10\t20\t5\t25\t2\t30\t3\t29'
  ].join('\n');
  const result = parseBlueprintPaste(tsv, products);
  assert.deepEqual(result.errors, []);
  assert.equal(result.skippedHeaderRows, 4);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].facility, 'Clinic A');
  assert.equal(result.rows[0].processing, '2026-09-01');
  assert.equal(result.rows[0].vaccines.OPV.carryOver, 10);
  assert.equal(result.rows[0].vaccines.BCG.allocation, 30);
});

test('keeps empty cells and an internal blank row in their original positions', () => {
  const data = [
    '2026-09-01\t\tClinic A\t1\t2\t\t\t3\t4\t\t',
    '\t\t\t\t\t\t\t\t\t\t',
    '2026-09-03\t\tClinic C\t5\t6\t\t\t7\t8\t\t'
  ].join('\n');
  const result = parseBlueprintPaste(data, products);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[1].facility, '');
  assert.equal(result.rows[2].facility, 'Clinic C');
  assert.equal(result.rows[0].vaccines.BCG.distributed, '');
  assert.equal(result.rows[0].vaccines.BCG.balance, 3);
});

test('supports comma-formatted quantities and rejects text in numeric allocation cells', () => {
  const good = parseBlueprintPaste('2026-09-01\t\tClinic A\t1,000\t500\t100\t1400\t2\t300\t50\t252', products);
  assert.equal(good.rows[0].vaccines.BCG.carryOver, 1000);
  const bad = parseBlueprintPaste('2026-09-01\t\tClinic A\tone\t500\t100\t\t2\t300\t50\t', products);
  assert.equal(bad.rows.length, 0);
  assert.match(bad.errors[0], /not a number/);
});

test('rejects ranges whose column count does not match a supported layout', () => {
  const result = parseBlueprintPaste('Clinic A\t10\t20\t30\t40', products);
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0], /Could not safely identify this range/);
});

test('TSV reader preserves quoted tabs and escaped quotes within a cell', () => {
  assert.deepEqual(parseClipboardTsv('"Clinic A\tEast"\t"The ""North"" Clinic"\r\n'), [
    ['Clinic A\tEast', 'The "North" Clinic']
  ]);
});

test('refuses allocation data rows with a missing facility instead of silently skipping them', () => {
  const result = parseBlueprintPaste('Facility\tBCG\tOPV\n\t10\t20', products);
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0], /no facility name/);
});

test('maps one-row export headers to product names when vaccine columns are reordered', () => {
  const tsv = [
    'Start Date\tCompleted Date\tFacility\tOPV Carry-over\tOPV Allocation\tOPV Distributed\tOPV Balance\tBCG Carry-over\tBCG Allocation\tBCG Distributed\tBCG Balance',
    '2026-09-01\t\tClinic A\t10\t20\t5\t25\t2\t30\t3\t29'
  ].join('\n');
  const result = parseBlueprintPaste(tsv, products);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].vaccines.OPV.allocation, 20);
  assert.equal(result.rows[0].vaccines.BCG.allocation, 30);
});


test('maps Delivery Site as part of a full facility row without shifting vaccine values', () => {
  const tsv = [
    ['Processing', 'Completed', 'Facility', 'Delivery Site', 'VACCINES', '', '', '', '', '', '', ''].join('\t'),
    ['', '', '', '', 'OPV', '', '', '', 'BCG', '', '', ''].join('\t'),
    ['', '', '', '', 'Carry-over', 'Allocation', 'Distributed', 'Balance', 'Carry-over', 'Allocation', 'Distributed', 'Balance'].join('\t'),
    ['2026-09-01', '', 'Clinic A', 'North Health Centre', '10', '20', '5', '25', '2', '30', '3', '29'].join('\t')
  ].join('\n');
  const result = parseBlueprintPaste(tsv, products);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].facility, 'Clinic A');
  assert.equal(result.rows[0].deliverySite, 'North Health Centre');
  assert.equal(result.rows[0].vaccines.OPV.carryOver, 10);
  assert.equal(result.rows[0].vaccines.BCG.allocation, 30);
});

test('keeps legacy facility-only spreadsheet layouts valid without shifting product allocations', () => {
  const result = parseBlueprintPaste('2026-09-01\t\tClinic A\t1\t2\t\t\t3\t4\t\t', products);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].deliverySite, undefined);
  assert.equal(result.rows[0].vaccines.OPV.carryOver, 3);
});

test('parses facility and Delivery Site followed by one allocation per product', () => {
  const result = parseBlueprintPaste('Clinic A\tNorth Health Centre\t100\t250', products);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].facility, 'Clinic A');
  assert.equal(result.rows[0].deliverySite, 'North Health Centre');
  assert.equal(result.rows[0].vaccines.BCG.allocation, 100);
  assert.equal(result.rows[0].vaccines.OPV.allocation, 250);
});

test('maps facility-starting product groups after the Delivery Site column', () => {
  const result = parseBlueprintPaste('Clinic A\tNorth Health Centre\t10\t20\t5\t25\t2\t30\t3\t29', products, 'from_facility');
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].deliverySite, 'North Health Centre');
  assert.equal(result.rows[0].vaccines.BCG.carryOver, 10);
  assert.equal(result.rows[0].vaccines.OPV.allocation, 30);
});


test('imports a complete workbook with title metadata, Delivery Site, dates, and recomputed balance', () => {
  const result = parseBlueprintFile([
    ['', '', '', 'West Mamprusi September 2026'],
    ['Processing', 'Completed', 'Facility', 'Delivery Site', 'VACCINES', '', '', ''],
    ['', '', '', '', 'OPV', '', '', ''],
    ['', '', '', '', 'Carry-over', 'Allocation', 'Distributed', 'Balance'],
    ['2026-09-01', '', 'Clinic A', 'North Health Centre', '10', '20', '5', '999']
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.district, 'West Mamprusi');
  assert.equal(result.month, 'September 2026');
  assert.deepEqual(result.products, ['OPV']);
  assert.equal(result.rows[0].facility, 'Clinic A');
  assert.equal(result.rows[0].deliverySite, 'North Health Centre');
  assert.equal(result.rows[0].processing, '2026-09-01');
  assert.equal(result.rows[0].vaccines.OPV.balance, 25);
});

test('imports legacy facility-only workbook columns without shifting quantities', () => {
  const result = parseBlueprintFile([
    ['Processing', 'Completed', 'Facility', 'VACCINES'],
    ['', '', '', 'BCG'],
    ['', '', '', 'Carry-over', 'Allocation', 'Distributed', 'Balance'],
    ['2026-09-01', '', 'Clinic A', '5', '9', '3', '11']
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].deliverySite, undefined);
  assert.equal(result.rows[0].vaccines.BCG.allocation, 9);
  assert.equal(result.rows[0].vaccines.BCG.balance, 11);
});

test('rejects malformed workbook quantities and missing facility before returning any rows', () => {
  const base = [
    ['Processing', 'Completed', 'Facility', 'Delivery Site', 'VACCINES', '', '', ''],
    ['', '', '', '', 'BCG', '', '', ''],
    ['', '', '', '', 'Carry-over', 'Allocation', 'Distributed', 'Balance'],
    ['2026-09-01', '', 'Clinic A', 'North', 'not a quantity', '2', '1', '']
  ];
  const badQuantity = parseBlueprintFile(base);
  assert.equal(badQuantity.rows.length, 0);
  assert.match(badQuantity.errors[0], /not a number/);
  base[3] = ['2026-09-01', '', '', 'North', '5', '2', '1', ''];
  const missingFacility = parseBlueprintFile(base);
  assert.equal(missingFacility.rows.length, 0);
  assert.match(missingFacility.errors[0], /no facility name/);
});


test('imports flat CSV headers by product and subcolumn names without relying on column positions', () => {
  const result = parseBlueprintFile([
    ['Processing Date', 'Completion Date', 'Facility', 'Delivery Site', 'OPV Carry-over', 'OPV Allocation', 'OPV Distributed', 'OPV Balance'],
    ['2026-09-01', '', 'Clinic A', 'North Site', '10', '20', '5', '25']
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].facility, 'Clinic A');
  assert.equal(result.rows[0].deliverySite, 'North Site');
  assert.equal(result.rows[0].vaccines.OPV.allocation, 20);
  assert.equal(result.rows[0].vaccines.OPV.balance, 25);
});


test('imports Sub-district and Delivery Site before product columns without shifting vaccine values', () => {
  const result = parseBlueprintFile([
    ['West Mamprusi September 2026'],
    ['Processing', 'Completed', 'Facility', 'Sub-district', 'Delivery Site', 'VACCINES', '', '', ''],
    ['', '', '', '', '', 'BCG', '', '', ''],
    ['', '', '', '', '', 'Carry-over', 'Allocation', 'Distributed', 'Balance'],
    ['2026-09-01', '', 'Clinic A', 'North Sub-district', 'North Health Centre', '10', '20', '5', '25']
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].facility, 'Clinic A');
  assert.equal(result.rows[0].subDistrict, 'North Sub-district');
  assert.equal(result.rows[0].deliverySite, 'North Health Centre');
  assert.equal(result.rows[0].vaccines.BCG.allocation, 20);
});

test('pastes a full row with Sub-district and Delivery Site using header alignment', () => {
  const result = parseBlueprintPaste([
    'Processing\tCompleted\tFacility\tSub-district\tDelivery Site\tVACCINES\t\t\t',
    '\t\t\t\t\tBCG\t\t\t',
    '\t\t\t\t\tCarry-over\tAllocation\tDistributed\tBalance',
    '2026-09-01\t\tClinic A\tNorth Sub-district\tNorth Health Centre\t10\t20\t5\t25'
  ].join('\n'), ['BCG']);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].subDistrict, 'North Sub-district');
  assert.equal(result.rows[0].deliverySite, 'North Health Centre');
  assert.equal(result.rows[0].vaccines.BCG.allocation, 20);
});
