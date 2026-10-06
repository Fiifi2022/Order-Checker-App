import test from 'node:test';
import assert from 'node:assert/strict';
import { getBlueprintProgressStatus } from '../src/utils/blueprintProgress';

const products = ['BCG', 'OPV'];

test('untouched facilities stay pending even with blank vaccine cells', () => {
  assert.equal(getBlueprintProgressStatus({ facility: 'Clinic', vaccines: { BCG: { allocation: '', distributed: '' } } }, products), 'pending');
  assert.equal(getBlueprintProgressStatus({ facility: '', vaccines: { BCG: { allocation: 10 } } }, products), 'pending');
});

test('quantity entry and an explicit start date mark a facility in progress', () => {
  for (const vaccines of [{ BCG: { allocation: 10 } }, { BCG: { carryOver: '5' } }, { BCG: { allocation: 10, distributed: 4 } }]) {
    assert.equal(getBlueprintProgressStatus({ facility: 'Clinic', vaccines }, products), 'in_progress');
  }
  assert.equal(getBlueprintProgressStatus({ facility: 'Clinic', processing: '2026-10-02' }, products), 'in_progress');
});

test('completion requires zero balance for every entered vaccine', () => {
  assert.equal(getBlueprintProgressStatus({ facility: 'Clinic', vaccines: { BCG: { carryOver: 2, allocation: 8, distributed: 10 }, OPV: { allocation: '' } } }, products), 'completed');
  assert.equal(getBlueprintProgressStatus({ facility: 'Clinic', vaccines: { BCG: { allocation: 10, distributed: 10 }, OPV: { allocation: 5 } } }, products), 'in_progress');
  assert.equal(getBlueprintProgressStatus({ facility: 'Clinic', vaccines: { BCG: { allocation: 0 } } }, products), 'completed');
  assert.equal(getBlueprintProgressStatus({ facility: 'Clinic', vaccines: { BCG: { allocation: 5, distributed: 6 } } }, products), 'in_progress');
});

test('updating quantities reopens a completed facility', () => {
  const row = { facility: 'Clinic', vaccines: { BCG: { allocation: 10, distributed: 10 } } };
  assert.equal(getBlueprintProgressStatus(row, products), 'completed');
  row.vaccines.BCG.allocation = 15;
  assert.equal(getBlueprintProgressStatus(row, products), 'in_progress');
});
