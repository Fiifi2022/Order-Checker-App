import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConfirmedDhdTopUp, preserveDhdTopUpsOnStaleSheet, type BlueprintTopUpSheet, type DhdInventory } from './dhdInventory';

const inventory: DhdInventory = { district: 'North', stocks: { BCG: 8 }, history: [], updatedAt: '' };
const sheet: BlueprintTopUpSheet = {
  id: 'north_sep', district: 'North', month: 'September', products: ['BCG'],
  rows: [{ id: 'facility-row', facility: 'Clinic A', vaccines: { BCG: { carryOver: 2, allocation: 5, distributed: 7, balance: 0 } } }]
};

test('confirmed top-up deducts district stock and adds only the facility overage to allocation', () => {
  const result = applyConfirmedDhdTopUp({ inventory, sheet, rowId: 'facility-row', vaccine: 'BCG', quantity: 3, distributedAfter: 10, requestId: 'request-1', user: 'Agent', now: '2026-09-29T10:00:00Z' });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.inventory.stocks.BCG, 5);
  assert.equal(result.sheet.rows[0].vaccines.BCG.allocation, 8);
  assert.equal(result.sheet.rows[0].vaccines.BCG.distributed, 10);
  assert.equal(result.sheet.rows[0].vaccines.BCG.balance, 0);
  assert.equal(result.entry.facility, 'Clinic A');
  assert.equal(result.entry.quantity, 3);
});

test('replayed top-up request is idempotent', () => {
  const first = applyConfirmedDhdTopUp({ inventory, sheet, rowId: 'facility-row', vaccine: 'BCG', quantity: 3, distributedAfter: 10, requestId: 'request-2', user: 'Agent' });
  assert.equal(first.success, true);
  if (!first.success) return;
  const replay = applyConfirmedDhdTopUp({ inventory: first.inventory, sheet: first.sheet, rowId: 'facility-row', vaccine: 'BCG', quantity: 3, distributedAfter: 10, requestId: 'request-2', user: 'Agent' });
  assert.equal(replay.success, true);
  if (!replay.success) return;
  assert.equal(replay.duplicate, true);
  assert.equal(replay.inventory.history.length, 1);
  assert.equal(replay.inventory.stocks.BCG, 5);
});

test('insufficient DHD stock or invalid quantity leaves both records unchanged', () => {
  const result = applyConfirmedDhdTopUp({ inventory: { ...inventory, stocks: { BCG: 2 } }, sheet, rowId: 'facility-row', vaccine: 'BCG', quantity: 3, distributedAfter: 10, requestId: 'request-3', user: 'Agent' });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.status, 409);
  assert.equal(inventory.stocks.BCG, 8);
  assert.equal(sheet.rows[0].vaccines.BCG.allocation, 5);
});

test('delayed Blueprint saves preserve a confirmed DHD top-up and its distribution', () => {
  const topUp = applyConfirmedDhdTopUp({
    inventory, sheet, rowId: 'facility-row', vaccine: 'BCG', quantity: 3,
    distributedAfter: 10, requestId: 'request-stale-save', user: 'Agent'
  });
  assert.equal(topUp.success, true);
  if (!topUp.success) return;
  const staleSheet: BlueprintTopUpSheet = {
    ...sheet,
    rows: [{ ...sheet.rows[0], vaccines: { BCG: { carryOver: 2, allocation: 5, distributed: 7, balance: 0 } } }]
  };
  const reconciled = preserveDhdTopUpsOnStaleSheet(staleSheet, topUp.sheet);
  assert.equal(reconciled.rows[0].vaccines.BCG.allocation, 8);
  assert.equal(reconciled.rows[0].vaccines.BCG.distributed, 10);
  assert.equal(reconciled.rows[0].vaccines.BCG.dhdTopUpTotal, 3);
});


test('deleting a vaccine column preserves deletion even after a confirmed DHD top-up', () => {
  const current: BlueprintTopUpSheet = {
    ...sheet,
    rows: [{ ...sheet.rows[0], vaccines: { BCG: { allocation: 8, distributed: 10, dhdTopUpTotal: 3 } } }]
  };
  const deletedColumn: BlueprintTopUpSheet = {
    ...sheet, products: [], rows: [{ ...sheet.rows[0], vaccines: {} }]
  };
  const saved = preserveDhdTopUpsOnStaleSheet(deletedColumn, current);
  assert.deepEqual(saved.products, []);
  assert.deepEqual(saved.rows[0].vaccines, {});
  assert.deepEqual(preserveDhdTopUpsOnStaleSheet({ ...current, rows: [] }, current).rows, []);
});


test('saving an individual deleted quantity column does not restore its DHD top-up value', () => {
  const current: BlueprintTopUpSheet = {
    ...sheet, rows: [{ ...sheet.rows[0], vaccines: { BCG: { allocation: 8, distributed: 10, dhdTopUpTotal: 3 } } }]
  };
  const incoming: BlueprintTopUpSheet = {
    ...sheet, deletedColumnKeys: ['vaccine:BCG:allocation'],
    rows: [{ ...sheet.rows[0], vaccines: { BCG: { allocation: '', distributed: 10 } } }]
  };
  const saved = preserveDhdTopUpsOnStaleSheet(incoming, current);
  assert.equal(saved.rows[0].vaccines.BCG.allocation, '');
  assert.equal(saved.rows[0].vaccines.BCG.distributed, 10);
});
