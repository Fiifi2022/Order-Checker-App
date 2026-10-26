import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { setupFsPanel } from './fs-panel.js';

const url = 'https://fulfillment-gh3-production.platform.flyzipline.com/v3/orders/Draft?';
const tick = () => new Promise(resolve => setImmediate(resolve));
const makeState = (id = 7, name = 'Gbangu CHPS') => ({ tabId: id, selection: { facility: { name, district: 'East Mamprusi', region: 'North East' }, draft: null, order: [] }, allocation: { status: 'matched', facility: { id: `sheet:${name}`, facilityName: name, district: 'East Mamprusi', region: 'North East' }, products: [] } });

test('opening the panel repairs a missing bridge and shows the installed build', async () => {
 const { document } = parseHTML('<details><span id="fsBuildVersion"></span><div id="fsLiveContext"></div><div id="fsConnectionStatus"></div><select id="fsManualFacility"></select><button id="fsRefresh"></button><button id="fsCheckConnection"></button></details>');
 const previous = { document: globalThis.document, chrome: globalThis.chrome };
 let connected = false, injections = 0;
 const events = { addListener() {} };
 globalThis.document = document;
 globalThis.chrome = {
   runtime: { getManifest: () => ({ version: '2.3.21', content_scripts: [{ js: ['fs-content.js'], matches: ['https://fulfillment-gh3-production.platform.flyzipline.com/*'] }] }) },
   tabs: { async query() { return [{ id: 7, url }]; }, async get() { return { id: 7, url }; },
     async sendMessage(_id, message) {
       if (!connected) throw Error('Receiving end does not exist');
       return message.type === 'FS_DIAGNOSTICS' ? { formFound: true, bridgeVersion: '2.3.21', selection: makeState().selection } : makeState();
     }, onActivated: events, onUpdated: events, onRemoved: events },
   permissions: { async contains() { return true; } },
   scripting: { async executeScript() { injections++; connected = true; } },
   storage: { session: { async get() { return {}; } }, onChanged: events },
 };
 try {
   setupFsPanel({ onFacility() {} });
   await tick(); await tick();
   assert.equal(injections, 1);
   assert.equal(document.getElementById('fsBuildVersion').textContent, 'v2.3.21');
   assert.equal(document.getElementById('fsConnectionStatus').textContent, 'Connected to FS');
 } finally { globalThis.document = previous.document; globalThis.chrome = previous.chrome; }
});

test('side panel snapshots the active FS tab, follows facility changes and clears disconnected state', async () => {
 const { document } = parseHTML('<div id="fsLiveContext"></div><div id="fsConnectionStatus"></div><select id="fsManualFacility"></select><button id="fsRefresh"></button><button id="fsCheckConnection"></button>');
 const previous = { document: globalThis.document, chrome: globalThis.chrome };
 let active = { id: 7, url }, state = makeState(), changed, activated, removed, updated, failure, pending, release;
 const synced = [], scripts = [], sent = [];
 const chrome = {
   runtime: { getManifest: () => ({ content_scripts: [{ js: ['fs-content.js'], matches: ['https://fulfillment-gh3-production.platform.flyzipline.com/*'] }] }) },
   tabs: {
     async query() { return active ? [active] : []; }, async get() { return active; },
     async sendMessage(id, message, options) {
       sent.push({ id, type: message.type, options });
       if (failure) throw new Error(failure);
       if (message.type === 'FS_DIAGNOSTICS') return { formFound: true, bridgeVersion: '2.3.21', selection: state.selection };
       if (pending) { const saved = state; await new Promise(resolve => { release = resolve; }); return saved; }
       return state;
     },
     onActivated: { addListener(fn) { activated = fn; } }, onRemoved: { addListener(fn) { removed = fn; } }, onUpdated: { addListener(fn) { updated = fn; } },
   },
   storage: { session: { async get() { return {}; } }, onChanged: { addListener(fn) { changed = fn; } } },
 };
 globalThis.document = document; globalThis.chrome = chrome;
 try {
   setupFsPanel({ onFacility: facility => synced.push(facility), onScript: script => scripts.push(script) }); await tick();
   const box = document.getElementById('fsLiveContext'), status = document.getElementById('fsConnectionStatus');
   assert.match(box.textContent, /Gbangu CHPS.*East Mamprusi.*North East/);
   assert.equal(status.textContent, 'Connected to FS');
   assert.equal(synced.at(-1).id, 'sheet:Gbangu CHPS');
   assert.ok(sent.every(message => message.id === 7 && message.options.frameId === 0));
   state = { ...state, selection: { ...state.selection, script: { orderKey: 'first', text: 'Customer script.\nSecond line!' } } };
   changed({ 'fsContext:7': { newValue: state } }, 'session');
   assert.equal(scripts.at(-1).text, 'Customer script.\nSecond line!');
   state = { ...makeState(), allocation: { status: 'not_found', products: [] } };
   changed({ 'fsContext:7': { newValue: state } }, 'session');
   assert.equal(status.textContent, 'Facility not found in Allocation Blueprint');
   assert.equal(synced.at(-1).name, 'Gbangu CHPS');
   assert.equal(synced.at(-1).allocationStatus, 'not_found');
   state = { ...makeState(), code: 'BACKEND_UNREACHABLE', error: 'localhost connection refused', allocation: null };
   changed({ 'fsContext:7': { newValue: state } }, 'session');
   assert.match(status.textContent, /Backend unreachable/);
   state = makeState(); pending = true; activated(); await tick();
   active = { id: 8, url }; state = makeState(8, 'Other CHPS'); pending = false; activated(); await tick();
   assert.equal(synced.at(-1).facilityName, 'Other CHPS');
   release(); await tick();
   assert.match(box.textContent, /Other CHPS/); assert.ok(!box.textContent.includes('Gbangu'));
   state = { ...makeState(8), selection: { facility: {}, draft: null, order: [] }, allocation: { status: 'no_facility', products: [] } };
   changed({ 'fsContext:8': { newValue: state } }, 'session');
   assert.equal(status.textContent, 'Waiting for facility selection');
   updated(8, { status: 'loading' });
   assert.equal(synced.at(-1), null);
   state = makeState(8); activated(); await tick(); removed(8);
   assert.match(status.textContent, /FS tab not found/);
   failure = 'message channel closed before a response was received'; activated(); await tick();
   assert.match(status.textContent, /FS content script unavailable.*message channel closed/);
   assert.ok(!status.textContent.includes('Connecting to FS'));
   active = null; failure = null; activated(); await tick();
   assert.match(status.textContent, /FS tab not found/);
 } finally { globalThis.document = previous.document; globalThis.chrome = previous.chrome; }
});
