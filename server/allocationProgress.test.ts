import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { getAllocationStatus, getAllocationFacilityStatus, getAllocationCellStyle, getExcelBaseFormatting, isAllocationWorksheet } from '../src/utils/allocationProgress';
import { parseBlueprintFile } from '../src/utils/blueprintPaste';

for (const [carryOver, allocation] of [[0, 10], [3, 7]]) {
  test(`live distribution and corrections with carry-over ${carryOver}`, () => {
    const vaccine = { carryOver, allocation, distributed: 0, balance: 999 };
    for (const [distributed, expected] of [[0, 'not_started'], [1, 'in_progress'], [5, 'in_progress'], [10, 'completed'], [8, 'in_progress'], [0, 'not_started']] as const) {
      vaccine.distributed = distributed;
      // Deliberately stale balance cannot override the actual formula.
      assert.equal(getAllocationStatus(vaccine), expected);
      assert.equal(getAllocationStatus(JSON.parse(JSON.stringify(vaccine))), expected);
    }
  });
}

test('carry-over contributes to available quantity; unused vaccines are never completed', () => {
  assert.equal(getAllocationStatus({ carryOver: 2, allocation: 8, distributed: 8 }), 'in_progress');
  assert.equal(getAllocationStatus({ carryOver: 2, allocation: 8, distributed: 10 }), 'completed');
  for (const vaccine of [undefined, {}, { carryOver: 0, allocation: 0, distributed: 0 }, { allocation: '', distributed: '' }]) {
    assert.equal(getAllocationStatus(vaccine), 'not_applicable');
  }
  assert.equal(getAllocationStatus({ allocation: 10, distributed: 11 }), 'over_distributed');
});

test('each vaccine is independent and quantity entry is pending at facility level', () => {
  const row = { facility: 'Facility A', processing: '2026-10-03', vaccines: {
    BCG: { allocation: 10, distributed: 10 }, OPV: { allocation: 5, distributed: 2 }, Rota: { allocation: 4, distributed: 0 }
  } };
  assert.deepEqual(Object.values(row.vaccines).map(getAllocationStatus), ['completed', 'in_progress', 'not_started']);
  assert.equal(getAllocationFacilityStatus(row, ['BCG', 'OPV', 'Rota']), 'in_progress');
  assert.equal(getAllocationFacilityStatus({ ...row, vaccines: { Rota: row.vaccines.Rota } }, ['Rota']), 'pending');
  assert.equal(getAllocationFacilityStatus({ facility: 'Clinic', vaccines: { BCG: { allocation: 0 } } }, ['BCG']), 'pending');
});

test('selection and status overlays never destroy original formatting', () => {
  for (const colour of ['#FFFFFF', '#FFF2CC', '#FFA500', '#808080', '#123456']) {
    const base = { backgroundColor: colour, fontWeight: 700, borderRight: '1px solid black' };
    const original = { ...base };
    for (const selected of [false, true]) {
      assert.equal(getAllocationCellStyle(base, 'in_progress', selected).backgroundColor, '#FEF08A');
      assert.equal(getAllocationCellStyle(base, 'completed', selected).backgroundColor, '#DCFCE7');
      assert.equal(getAllocationCellStyle(base, 'not_started', selected).backgroundColor, colour);
      assert.equal(getAllocationCellStyle(base, 'not_applicable', selected).backgroundColor, colour);
      assert.equal(getAllocationCellStyle(base, undefined, selected).backgroundColor, colour);
      if (selected) assert.match(getAllocationCellStyle(base, 'completed', true).boxShadow!, /inset/);
    }
    assert.deepEqual(base, original);
    assert.deepEqual(getAllocationCellStyle(JSON.parse(JSON.stringify(base)), 'not_started', false), original);
  }
});

test('only allocation worksheets receive progress overlays, including after tab renames', () => {
  assert.equal(isAllocationWorksheet({ worksheetRole: 'allocation', sheetName: 'Renamed' }), true);
  assert.equal(isAllocationWorksheet({ worksheetRole: 'other', sheetName: 'Allocation' }), false);
  assert.equal(isAllocationWorksheet({ sheetName: ' Allocation Sheet ' }), true);
  assert.equal(isAllocationWorksheet({}), true); // Legacy district/cycle allocation.
  for (const sheetName of ['Summary', 'Notes', 'Districts', 'Sheet2', 'Order Checker', 'Vaccine Checker']) {
    assert.equal(isAllocationWorksheet({ sheetName }), false);
  }
});

test('Excel import maps original fills to the correct row and vaccine despite blank rows', () => {
  const data = [
    ['Start Date', 'Completed', 'Facility', 'Sub-district', 'Delivery Site', 'BCG Carry-over', 'BCG Allocation', 'BCG Distributed', 'BCG Balance'],
    ['', '', 'Clinic A', '', '', 0, 10, 0, 10],
    [],
    ['', '', 'Clinic B', '', '', 0, 5, 2, 3]
  ];
  const parsed = parseBlueprintFile(data);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.sourceRowIndexes, [1, 3]);
  assert.deepEqual(parsed.sourceColumnIndexes, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet.G2.s = { patternType: 'solid', fgColor: { rgb: 'FFF2CC' } };
  const base = getExcelBaseFormatting(sheet[XLSX.utils.encode_cell({ r: parsed.sourceRowIndexes![0], c: parsed.sourceColumnIndexes![6]! })].s);
  assert.equal(base.backgroundColor, '#FFF2CC');
  assert.equal(getAllocationCellStyle(base, getAllocationStatus(parsed.rows[0].vaccines.BCG), true).backgroundColor, '#FFF2CC');
  assert.equal(getExcelBaseFormatting({ patternType: 'solid', fgColor: { rgb: 'FFFFA500' } }).backgroundColor, '#FFA500');
});

test('grouped workbook headings preserve source columns for compact layouts', () => {
  const parsed = parseBlueprintFile([
    ['Facility', 'Delivery Site', 'VACCINES'],
    ['', '', 'BCG', '', '', '', 'OPV'],
    ['', '', 'Carry-over', 'Allocation', 'Distributed', 'Balance', 'Carry-over', 'Allocation', 'Distributed', 'Balance'],
    ['Clinic', 'Site', 2, 8, 8, 2, 0, 4, 0, 4]
  ]);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.sourceRowIndexes, [3]);
  assert.deepEqual(parsed.sourceColumnIndexes, [null, null, 0, null, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(getAllocationStatus(parsed.rows[0].vaccines.BCG), 'in_progress');
  assert.equal(getAllocationStatus(parsed.rows[0].vaccines.OPV), 'not_started');
});
