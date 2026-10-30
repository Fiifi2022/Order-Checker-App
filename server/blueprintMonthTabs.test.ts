import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement, act, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import BlueprintMonthTabs from '../src/components/BlueprintMonthTabs';

test('month dropdowns scope districts to their month and open the exact worksheet', async () => {
  const {window} = parseHTML('<html><body><div id="root"></div></body></html>');
  const properties = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(properties.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperties(globalThis, {
    window: {value: window, configurable: true}, document: {value: window.document, configurable: true},
    HTMLElement: {value: window.HTMLElement, configurable: true},
    IS_REACT_ACT_ENVIRONMENT: {value: true, configurable: true, writable: true}
  });
  const root = createRoot(window.document.getElementById('root')!);
  const selected: string[] = [];
  const sheets = [
    {id: 'oct-north', district: 'North', month: 'October 2026'},
    {id: 'nov-north', district: 'North', month: 'November 2026'},
    {id: 'oct-south', district: 'South', month: 'October 2026'},
    {id: 'oct-other', district: 'South', month: 'October 2026', sheetName: 'Other worksheet'}
  ];
  function Harness() {
    const [active, setActive] = useState('oct-north');
    return createElement(BlueprintMonthTabs, {sheets, activeSheetId: active, onSelect: id => {selected.push(id); setActive(id);}});
  }
  const click = async (label: string) => {
    const button = [...window.document.querySelectorAll('button')].find(button => button.textContent === label);
    assert.ok(button, `Missing button ${label}`);
    await act(async () => {button.dispatchEvent(new window.Event('click', {bubbles: true}));});
  };
  try {
    await act(async () => {root.render(createElement(Harness));});
    assert.equal(window.document.querySelectorAll('button').length, 2);
    await click('October 2026');
    assert.equal(window.document.querySelector('[role="group"]')?.getAttribute('aria-label'), 'Districts for October 2026');
    assert.equal(window.document.querySelectorAll('[role="group"] button').length, 3);
    assert.equal(window.document.querySelector('[aria-current="page"]')?.textContent, 'North');
    await click('SouthOther worksheet');
    assert.deepEqual(selected, ['oct-other']);
    assert.equal(window.document.querySelector('[role="group"]'), null);
    await click('November 2026');
    assert.equal(window.document.querySelectorAll('[role="group"] button').length, 1);
    await click('North');
    assert.deepEqual(selected, ['oct-other', 'nov-north']);
    await click('November 2026');
    await click('November 2026');
    assert.equal(window.document.querySelector('[role="group"]'), null);
    await click('October 2026');
    await act(async () => {window.document.body.dispatchEvent(new window.Event('pointerdown', {bubbles: true}));});
    assert.equal(window.document.querySelector('[role="group"]'), null);
  } finally {
    await act(async () => root.unmount());
    for (const key of properties) {
      const descriptor = saved.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
