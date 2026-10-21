import test from 'node:test';
import assert from 'node:assert/strict';
import { resizedBlueprintDimension } from '../src/utils/blueprintSizing';
test('individual columns grow and shrink below their original widths', () => {
  assert.equal(resizedBlueprintDimension('column', 140, 60), 200);
  assert.equal(resizedBlueprintDimension('column', 200, -90), 110);
});
test('row heights grow and shrink while retaining usable bounds', () => {
  assert.equal(resizedBlueprintDimension('row', 32, 40), 72);
  assert.equal(resizedBlueprintDimension('row', 72, -30), 42);
  assert.equal(resizedBlueprintDimension('row', 42, -1000), 24);
});
test('screen-pixel drag deltas respect spreadsheet zoom', () => {
  assert.equal(resizedBlueprintDimension('column', 110, 30, 150), 130);
  assert.equal(resizedBlueprintDimension('row', 40, -10, 50), 24);
});
test('invalid or excessive sizes cannot hide a column or create unbounded rows', () => {
  assert.equal(resizedBlueprintDimension('column', 140, -10000), 36);
  assert.equal(resizedBlueprintDimension('column', 140, 10000), 1200);
  assert.equal(resizedBlueprintDimension('row', 32, 10000), 600);
  assert.equal(resizedBlueprintDimension('column', 140, NaN), 140);
});
