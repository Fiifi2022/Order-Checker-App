import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import LayoutRow from '../src/components/BlueprintLayoutRow';
import { insertBlankColumns, layoutColumns, layoutColumnKey, rebaseBlueprintFormula } from '../src/utils/blueprintLayout';
const products = ['BCG', 'OPV'];
const keys = (blank: ReturnType<typeof insertBlankColumns>) => layoutColumns(products, [], blank).map(col => layoutColumnKey(col, products, blank));

test('one insertion creates one empty column between existing allocation fields', () => {
  const cols = insertBlankColumns([], products, [], 5, 'right', 1, ['notes']);
  assert.equal(cols.length, 1);
  assert.deepEqual(cols[0].headers, ['', '', '', '']);
  assert.deepEqual(keys(cols).slice(5, 9), ['vaccine:BCG:carryOver', 'blank:notes', 'vaccine:BCG:allocation', 'vaccine:BCG:distributed']);
  assert.deepEqual(products, ['BCG', 'OPV']);
});
for (const side of ['left', 'right'] as const) test(`inserts three individual blank columns ${side} of the selected field`, () => {
  const cols = insertBlankColumns([], products, [], 6, side, 3, ['a', 'b', 'c']);
  assert.equal(cols.length, 3);
  assert.equal(keys(cols).length, 16);
  assert.deepEqual(keys(cols).slice(side === 'left' ? 6 : 7, side === 'left' ? 9 : 10), ['blank:a', 'blank:b', 'blank:c']);
});

test('insertion beside another blank column respects the exact clicked position', () => {
  const one = insertBlankColumns([], products, [], 6, 'left', 1, ['one']);
  const two = insertBlankColumns(one, products, [], 13, 'left', 1, ['two']);
  assert.deepEqual(keys(two).slice(6, 9), ['blank:two', 'blank:one', 'vaccine:BCG:allocation']);
  const three = insertBlankColumns(two, products, [], 14, 'right', 1, ['three']);
  assert.deepEqual(keys(three).slice(6, 10), ['blank:two', 'blank:one', 'blank:three', 'vaccine:BCG:allocation']);
});

test('stable field keys preserve column positions when a different field is hidden', () => {
  const cols = insertBlankColumns([], products, [], 6, 'right', 1, ['notes']);
  const visible = layoutColumns(products, ['field:facility'], cols).map(col => layoutColumnKey(col, products, cols));
  assert.deepEqual(visible.slice(4, 8), ['vaccine:BCG:carryOver', 'vaccine:BCG:allocation', 'blank:notes', 'vaccine:BCG:distributed']);
});

test('A1 references including absolute references follow original cells through insertions', () => {
  const original = keys([]), added = keys(insertBlankColumns([], products, [], 6, 'left', 3, ['a', 'b', 'c']));
  assert.equal(rebaseBlueprintFormula('=F5+$G$5-H5', original, added, ['facility'], ['blank', 'facility']), '=F6+$J$6-K6');
  assert.equal(rebaseBlueprintFormula('=SUM(F5:H5)', original, added, ['facility'], ['facility']), '=SUM(F5:K5)');
});

test('formula strings and other-sheet references are not rewritten', () => {
  const before = keys([]), after = keys(insertBlankColumns([], products, [], 6, 'left', 1, ['a']));
  assert.equal(rebaseBlueprintFormula('="G5"&Other!G5&Other!$G$5&$G$5', before, after, ['r'], ['r']), '="G5"&Other!G5&Other!$G$5&$H$5');
});

test('formula references follow a moved blank column by identity', () => {
  const old = insertBlankColumns([], products, [], 6, 'left', 1, ['notes']);
  const moved = insertBlankColumns([], products, [], 9, 'right', 1, ['notes']);
  assert.equal(rebaseBlueprintFormula('=G5+H5', keys(old), keys(moved), ['r'], ['r']), '=K5+G5');
});

test('spanning allocation headers split around a blank column without absorbing it', () => {
  const base = [0, 1, 2, 3];
  const html = renderToStaticMarkup(React.createElement('table', {}, React.createElement('thead', {}, React.createElement(LayoutRow, {
    baseColumns: base, columns: [0, 1, 4, 2, 3], renderCell: col => React.createElement('th', { key: col, 'data-blank': true }, '')
  }, React.createElement('th', { colSpan: 4 }, 'BCG')))));
  const { document } = parseHTML(html);
  const cells = [...document.querySelectorAll('th')];
  assert.equal(cells.length, 3);
  assert.equal(cells[0].getAttribute('colSpan'), '2');
  assert.equal(cells[1].getAttribute('data-blank'), 'true');
  assert.equal(cells[2].getAttribute('colSpan'), '2');
  assert.equal(document.querySelectorAll('th[data-blank]').length, 1);
  assert.equal(cells.map(cell => cell.textContent).join(''), 'BCG');
});

test('plain rows render only blank editable cells, never inherited allocation cells', () => {
  const html = renderToStaticMarkup(React.createElement('table', {}, React.createElement('tbody', {}, React.createElement(LayoutRow, {
    baseColumns: [0, 1], columns: [0, 2, 1], plainRow: true, renderCell: col => React.createElement('td', { key: col }, React.createElement('input', { defaultValue: '' }))
  }, React.createElement('td', {}, 'existing allocation data')))));
  const { document } = parseHTML(html);
  assert.equal(document.querySelectorAll('input').length, 3);
  assert.ok([...document.querySelectorAll('input')].every(input => input.value === '' && !input.hasAttribute('readonly')));
  assert.ok(!html.includes('existing allocation data'));
});
