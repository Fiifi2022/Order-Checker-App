import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintColumnKey, visibleBlueprintColumns, deleteBlueprintColumnData } from '../src/utils/blueprintColumns';

const row = { id: 'r1', processing: 'Oct 1', completed: 'Oct 2', facility: 'Clinic', subDistrict: 'North', deliverySite: 'Depot', vaccines: { BCG: { carryOver: 2, allocation: 8, distributed: 4, balance: 6 }, OPV: { allocation: 10 } } };

test('columns A through E can all be deleted without changing vaccine data or the undo source', () => {
  const indexes = [0, 1, 2, 3, 4];
  const products = ['BCG', 'OPV'];
  const result = deleteBlueprintColumnData([row], products, indexes);
  assert.equal(result[0].processing, '');
  assert.equal(result[0].completed, '');
  assert.equal(result[0].facility, '');
  assert.equal(result[0].subDistrict, '');
  assert.equal(result[0].deliverySite, '');
  assert.deepEqual(result[0].vaccines, row.vaccines);
  assert.equal(row.facility, 'Clinic');
  assert.equal(row.processing, 'Oct 1');
  assert.deepEqual(visibleBlueprintColumns(products, indexes.map(index => blueprintColumnKey(index, products))), [5, 6, 7, 8, 9, 10, 11, 12]);
});

test('individual vaccine columns remain deleted when product groups are reordered', () => {
  const products = ['BCG', 'OPV'];
  const keys = [blueprintColumnKey(0, products), blueprintColumnKey(6, products)];
  const result = deleteBlueprintColumnData([row], products, [0, 6]);
  assert.equal(result[0].vaccines.BCG.allocation, '');
  assert.equal(result[0].vaccines.BCG.distributed, 4);
  assert.equal(result[0].vaccines.OPV.allocation, 10);
  assert.equal(row.vaccines.BCG.allocation, 8);
  const reordered = ['OPV', 'BCG'];
  assert.equal(visibleBlueprintColumns(reordered, keys).includes(10), false);
  assert.equal(visibleBlueprintColumns(reordered, keys).includes(6), true);
});

test('all columns may be deleted and an empty schema survives serialization', () => {
  const products = ['BCG'];
  const indexes = visibleBlueprintColumns(products, []);
  const saved = JSON.parse(JSON.stringify({ products, deletedColumnKeys: indexes.map(index => blueprintColumnKey(index, products)) }));
  assert.deepEqual(visibleBlueprintColumns(saved.products, saved.deletedColumnKeys), []);
  assert.deepEqual(visibleBlueprintColumns([], ['field:processing']), [1, 2, 3, 4]);
});
