import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import Manager from '../src/components/GeneralFacilityManager';

const initial = { revision: 1, canEdit: true, facilities: [
  { key: 'source-a', source: 'test/a', name: 'Example HC', district: 'East', region: 'Northern', facilityType: 'Health Centre' },
  { key: 'source-b', source: 'test/b', name: 'Other CHPS', district: 'West', region: 'Eastern', facilityType: 'CHPS' }
] };
async function fixture({ canEdit = true, strict = false, failSave = false } = {}) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const before = Object.fromEntries(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'test' } });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const root = createRoot(document.getElementById('root'));
  let state = { ...structuredClone(initial), canEdit }, removed: any, updated = 0;
  const calls: any[] = [];
  const request = async (_url: any, init: any = {}) => {
    if (init.signal?.aborted) throw new Error('Aborted');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method || 'GET', body });
    if (init.method && failSave) return { ok: false, json: async () => ({ error: 'Could not save facilities.' }) } as Response;
    if (init.method === 'DELETE') { removed = state.facilities.find(record => record.key === body.key); state = { ...state, revision: state.revision + 1, facilities: state.facilities.filter(record => record.key !== body.key) }; }
    else if (init.method === 'POST') {
      const entry = body.action === 'restore' ? removed : { key: 'new', source: 'test/new', name: body.name, district: body.district, region: body.region, facilityType: body.facilityType };
      state = { ...state, revision: state.revision + 1, facilities: [...state.facilities, entry] };
    }
    return { ok: true, json: async () => structuredClone(state) } as Response;
  };
  await act(async () => { root.render(strict ? React.createElement(StrictMode, {}, React.createElement(Manager, { onUpdated: () => updated++, request })) : React.createElement(Manager, { onUpdated: () => updated++, request })); });
  const click = async (text: string) => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === text); assert.ok(button, `Missing ${text} button`); await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true })); }); };
  // Exercise the React field handler, since linkedom does not implement browser input tracking.
  const type = async (selector: string, value: string) => { const input: any = document.querySelector(selector); assert.ok(input); const props = input[Object.keys(input).find(key => key.startsWith('__reactProps'))!]; await act(async () => { props.onChange({ target: { value } }); }); };
  return { document, window, calls, click, type, get updated() { return updated; },
    async close() { await act(async () => root.unmount()); for (const [key, descriptor] of Object.entries(before)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; } }
  };
}

test('Facilities loads in Strict Mode, removes and restores a facility using the latest saved revision', async () => {
  const dom = await fixture({ strict: true });
  try {
    assert.match(dom.document.body.textContent, /Example HC/);
    const remove = dom.document.querySelector('button[aria-label="Remove Example HC in East"]');
    await act(async () => { remove.dispatchEvent(new dom.window.Event('click', { bubbles: true })); });
    assert.equal(dom.document.querySelectorAll('tbody tr').length, 1);
    assert.equal(dom.updated, 1);
    assert.deepEqual(dom.calls.find(call => call.method === 'DELETE').body, { key: 'source-a', revision: 1 });
    await dom.click('Undo removal');
    assert.equal(dom.document.querySelectorAll('tbody tr').length, 2);
    assert.equal(dom.updated, 2);
    assert.deepEqual(dom.calls.find(call => call.method === 'POST').body, { action: 'restore', key: 'source-a', revision: 2 });
  } finally { await dom.close(); }
});

test('add sends the entered facility and refreshes the searchable list after persistence', async () => {
  const dom = await fixture();
  try {
    await dom.type('input[name="name"]', 'New CHPS');
    await dom.type('input[name="district"]', 'Test District');
    await act(async () => { dom.document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(dom.updated, 1);
    assert.equal(dom.calls.find(call => call.method === 'POST').body.name, 'New CHPS');
    assert.equal(dom.document.querySelectorAll('tbody tr').length, 3);
    assert.equal((dom.document.querySelector('input[name="name"]') as HTMLInputElement).value, '');
    await dom.type('input[type="search"]', 'Test District');
    assert.equal(dom.document.querySelectorAll('tbody tr').length, 1);
    assert.match(dom.document.querySelector('tbody').textContent, /New CHPS/);
  } finally { await dom.close(); }
});

test('read-only roles have no write controls, and a failed removal keeps the saved facility visible', async () => {
  const readOnly = await fixture({ canEdit: false });
  try { assert.equal(readOnly.document.querySelector('form'), null); assert.equal(readOnly.document.querySelector('button[aria-label^="Remove"]'), null); }
  finally { await readOnly.close(); }
  const failed = await fixture({ failSave: true });
  try {
    const remove = failed.document.querySelector('button[aria-label^="Remove Example"]');
    await act(async () => { remove.dispatchEvent(new failed.window.Event('click', { bubbles: true })); });
    assert.equal(failed.document.querySelectorAll('tbody tr').length, 2);
    assert.match(failed.document.querySelector('[role="alert"]').textContent, /Could not save/);
    assert.equal(failed.updated, 0);
  } finally { await failed.close(); }
});
