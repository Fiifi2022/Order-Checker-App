import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { buildSync } from 'esbuild';
import { createFsAdapter } from './fs-adapter.js';
const fixture = await readFile(new URL('./fixtures/fs-add-order.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 150));
function browser(html, send) {
 const { document, window } = parseHTML(html);
 let observer, shadow, refreshCallback;
 const attach = window.Element.prototype.attachShadow;
 window.Element.prototype.attachShadow = function(options) { const result = attach.call(this, options); if (this.id === 'order-checker-vaccine-allocation') shadow = result; return result; };
 let listener;
 const messageListeners = new Set();
 const scheduleTimeout = (callback, ms) => { if (ms === 30000) { refreshCallback = callback; return { unref() {} }; } return setTimeout(callback, ms); };
 const sandbox = { document, window, innerWidth: 1200, innerHeight: 800, console, setTimeout: scheduleTimeout, clearTimeout,
  MutationObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() {} },
  chrome: { runtime: { sendMessage: send, onMessage: { addListener(fn) { listener = fn; messageListeners.add(fn); }, removeListener(fn) { messageListeners.delete(fn); } } } } };
 for (const el of document.querySelectorAll('input,select,button,[role="combobox"],[role="alert"],[aria-live]')) el.getBoundingClientRect = () => ({ top: 200, left: 250, right: 400, bottom: 230 });
 const code = buildSync({ entryPoints: ['extension/fs-content-entry.js'], bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
 const context = vm.createContext(sandbox);
 vm.runInContext(code, context);
 return { document, window, notify(target = document.querySelector('form') || document.documentElement) { observer([{ target }]); }, message(data, respond = () => {}) { return listener(data, {}, respond); },
  reinject() { vm.runInContext(code, context); }, refresh() { assert.ok(refreshCallback); refreshCallback(); }, get listenerCount() { return messageListeners.size; },
  get shadow() { return shadow; }, get host() { return document.getElementById('order-checker-vaccine-allocation'); } };
}
const allocate = message => ({ selection: message.selection, allocation: { status: 'matched', facility: { facilityName: 'Mumford HC', district: 'Gomoa West' }, products: [...message.selection.order, ...(message.selection.draft ? [message.selection.draft] : [])].map(p => ({ ...p, canonical: p.name.includes('Polio') ? 'OPV' : 'BCG', balance: p.name.includes('Polio') ? 9 : 12, status: 'available' })) } });
test('automatic refresh replaces changed Blueprint balances, clears while checking and recovers after failure', async () => {
 let balance = 120, failed = false;
 const messages = [];
 const page = browser(fixture, async message => {
   messages.push(message);
   if (failed) throw Error('Network disconnected');
   const state = allocate(message);
   state.allocation.products.forEach(product => { product.balance = balance; });
   return state;
 });
 await tick();
 page.document.getElementById('product').dataset.selectedName = 'BCG';
 page.document.getElementById('quantity').value = '1';
 page.notify(); await tick();
 assert.match(page.shadow.querySelector('div').textContent, /Available: 120/);
 balance = 90; page.refresh();
 assert.ok(!page.shadow.querySelector('div').textContent.includes('Available: 120'));
 await tick();
 assert.match(page.shadow.querySelector('div').textContent, /Available: 90/);
 assert.equal(messages.at(-1).refresh, true);
 failed = true; page.refresh(); await tick();
 assert.match(page.shadow.querySelector('div').textContent, /Allocation unavailable/);
 assert.ok(!page.shadow.querySelector('div').textContent.includes('Available: 90'));
 failed = false; balance = 80; page.window.dispatchEvent(new page.window.Event('online')); await tick();
 assert.match(page.shadow.querySelector('div').textContent, /Available: 80/);
 assert.ok(messages.every(message => message.type === 'FS_SELECTION'));
});
test('Add New Order adapter reads only confirmed accessible selections and relevant product rows', () => {
 const { document } = parseHTML(fixture), adapter = createFsAdapter(document);
 assert.equal(adapter.read().facility.name, 'Mumford HC'); assert.equal(adapter.read().facility.region, 'Central');
 const product = document.getElementById('product'); product.dataset.selectedName = 'Bacille Calmette-Guerin Vaccine';
 document.getElementById('quantity').value = '5';
 assert.equal(adapter.read().draft.quantity, '5');
 document.querySelector('tbody').innerHTML = '<tr><td>Bacille Calmette-Guerin Vaccine</td><td>5</td></tr><tr><td>OPV</td><td>3</td></tr>';
 assert.equal(adapter.read().order.length, 2);
 document.querySelector('tbody tr').remove(); assert.equal(adapter.read().order[0].name, 'OPV');
 product.replaceWith(Object.assign(document.createElement('input'), { id: 'product', value: 'BCG search query' }));
 assert.equal(adapter.read().draft, null);
});
test('inline indicator stays during quantity and failed Add, hides on confirmed row, next vaccine updates; added items stay in panel context', async () => {
 const messages = [], page = browser(fixture, async message => { messages.push(message); return allocate(message); });
 await tick(); assert.equal(page.host.style.display, 'none');
 const product = page.document.getElementById('product'), quantity = page.document.getElementById('quantity');
 product.dataset.selectedName = 'Bacille Calmette-Guerin Vaccine'; quantity.value = '5'; page.notify(); await tick();
 assert.equal(page.host.style.display, 'block'); assert.match(page.shadow.querySelector('div').textContent, /Available: 12/); assert.match(page.shadow.querySelector('div').textContent, /Available: 12/);
 quantity.value = '15'; quantity.dispatchEvent(new page.window.Event('input', { bubbles: true })); await tick();
 assert.equal(page.host.style.display, 'block'); assert.match(page.shadow.querySelector('div').textContent, /Available: 12/);
 page.document.querySelector('button').dispatchEvent(new page.window.Event('click', { bubbles: true }));
 page.document.getElementById('fs-validation').textContent = 'Out of stock'; page.notify(); await tick();
 assert.equal(page.host.style.display, 'block');
 quantity.value = '5'; page.notify(); await tick();
 page.document.querySelector('button').dispatchEvent(new page.window.Event('click', { bubbles: true }));
 page.document.querySelector('tbody').innerHTML = '<tr><td>Bacille Calmette-Guerin Vaccine</td><td>5</td></tr>'; page.notify(); await tick();
 assert.equal(page.host.style.display, 'none'); assert.equal(messages.at(-1).selection.order[0].quantity, '5'); assert.equal(messages.at(-1).selection.draft, null);
 page.notify(); await tick(); assert.equal(page.host.style.display, 'none');
 product.dataset.selectedName = 'Oral Polio Vaccine (1&3)'; quantity.value = '3'; page.notify(); await tick();
 assert.equal(page.host.style.display, 'block'); assert.match(page.shadow.querySelector('div').textContent, /Available: 9/);
 page.document.querySelector('button').dispatchEvent(new page.window.Event('click', { bubbles: true }));
 page.document.querySelector('tbody').innerHTML += '<tr><td>Oral Polio Vaccine (1&3)</td><td>3</td></tr>'; page.notify(); await tick();
 assert.equal(page.host.style.display, 'none'); assert.equal(messages.at(-1).selection.order.length, 2);
 page.document.querySelector('tbody tr').remove(); page.notify(); await tick(); assert.equal(messages.at(-1).selection.order.length, 1);
 assert.ok(messages.every(m => m.type === 'FS_SELECTION'));
});
test('a slow previous allocation cannot overwrite a newer facility or vaccine; network failure stays unavailable', async () => {
 let finish;
 const page = browser(fixture, async message => {
   if (message.selection.draft?.name === 'BCG') return new Promise(resolve => { finish = () => resolve(allocate(message)); });
   if (message.selection.facility.name === 'Unavailable HC') throw new Error('unreachable');
   return allocate(message);
 });
 await tick(); const product = page.document.getElementById('product'); product.dataset.selectedName = 'BCG'; page.notify(); await tick();
 product.dataset.selectedName = 'Oral Polio Vaccine (1&3)'; page.notify(); await tick(); finish(); await tick();
 assert.match(page.shadow.querySelector('div').textContent, /Available: 9/);
 page.document.getElementById('facility').dataset.selectedName = 'Unavailable HC'; page.notify(); await tick();
 assert.match(page.shadow.querySelector('div').textContent, /unavailable/i); assert.ok(!page.shadow.querySelector('div').textContent.includes('Available: 9'));
});

test('background uses authenticated read-only lookup, rejects other websites, discards stale responses and reuses balance for typing', async () => {
 let handle, finishOld, installed, calls = [], injections = [];
 const stored = { authSession: { idToken: 'test-only-token', expiresAt: Date.now() + 600000 } };
 const area = { async get(key) { return key === null ? { ...stored } : { [key]: stored[key] }; }, async set(data) { Object.assign(stored, data); }, async remove(key) { delete stored[key]; } };
 const listeners = { addListener() {} };
 const chrome = { storage: { session: area, local: { async get() { return {}; } }, onChanged: listeners }, tabs: { onRemoved: listeners, onUpdated: listeners, async sendMessage() {}, async query() { return [{ id: 7, url: 'https://fulfillment-gh3-production.platform.flyzipline.com/v3/orders/Draft' }, { id: 9, url: 'https://unrelated.example' }]; } }, permissions: { async contains() { return true; } }, scripting: { async executeScript(options) { injections.push(options); } }, runtime: { onInstalled: { addListener(fn) { installed = fn; } }, getURL: () => 'chrome-extension://test/', onMessage: { addListener(fn) { handle = fn; } } } };
 const fetch = async (url, options) => {
   calls.push({ url, options });
   const input = JSON.parse(new URL(url).searchParams.get('selection'));
   if (input.products[0]?.name === 'BCG') await new Promise(resolve => { finishOld = resolve; });
   return { ok: true, async json() { return { status: 'matched', products: input.products.map(p => ({ ...p, balance: 12 })) }; } };
 };
 vm.runInNewContext(buildSync({ entryPoints: ['extension/background.js'], bundle: true, write: false, format: 'iife' }).outputFiles[0].text, { chrome, fetch, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, console });
 installed(); await new Promise(resolve => setImmediate(resolve));
 assert.equal(injections.length, 1); assert.equal(injections[0].target.tabId, 7); assert.equal(injections[0].files[0], 'fs-content.js');
 const sender = { url: 'https://fulfillment-gh1-production.platform.flyzipline.com/v3/orders/Draft', tab: { id: 7 } };
 const selection = name => ({ facility: { name: 'Mumford HC' }, draft: { name, quantity: '5' }, order: [] });
 const rejection = await new Promise(resolve => handle({ type: 'FS_SELECTION', selection: selection('BCG') }, { ...sender, url: 'https://unrelated.example' }, resolve)); assert.match(rejection.error, /not enabled/);
 const gh3Sender = { ...sender, url: 'https://fulfillment-gh3-production.platform.flyzipline.com/v3/orders/Draft', tab: { id: 8 } };
 const gh3 = await new Promise(resolve => handle({ type: 'FS_SELECTION', selection: selection('OPV') }, gh3Sender, resolve));
 assert.equal(gh3.allocation.status, 'matched'); assert.equal(stored['fsContext:8'].tabId, 8);
 calls = [];
 const request = message => new Promise(resolve => handle(message, sender, resolve));
 const old = request({ type: 'FS_SELECTION', selection: selection('BCG') }); await new Promise(resolve => setImmediate(resolve));
 const latest = await request({ type: 'FS_SELECTION', selection: selection('OPV') }); finishOld();
 assert.equal((await old).stale, true); assert.equal(latest.allocation.products[0].name, 'OPV'); assert.equal(stored['fsContext:7'].selection.draft.name, 'OPV');
 const changed = selection('OPV'); changed.draft.quantity = '15';
 await request({ type: 'FS_SELECTION', selection: changed }); assert.equal(calls.length, 2);
 assert.equal(stored['fsContext:7'].allocation.products[0].quantity, '15');
 await request({ type: 'FS_SELECTION', selection: changed, refresh: true }); assert.equal(calls.length, 3);
 changed.script = { orderKey: 'order-one', text: 'Customer script.\nKeep cold!' };
 await request({ type: 'FS_SELECTION', selection: changed });
 assert.equal(stored['fsContext:7'].selection.script.text, changed.script.text);
 assert.equal(calls.length, 3, 'Script changes reuse allocation advice instead of fetching or writing balances.');
 assert.ok(calls.every(call => call.url.startsWith('http://localhost:3000/api/vaccine/companion/context?') && !call.options.method && call.options.headers.Authorization === 'Bearer test-only-token'));
});

test('side panel renders draft separately, retains added products, removes deleted rows and resolves ambiguity manually', async () => {
 const { setupFsPanel } = await import('./fs-panel.js');
 const { document } = parseHTML('<div id="fsLiveContext"></div><select id="fsManualFacility"></select><button id="fsRefresh"></button>');
 const previous = { document: globalThis.document, chrome: globalThis.chrome };
 let changed, state, manualRequest, facilities = [];
 const live = { tabId: 7, selection: { facility: { name: 'Mumford HC' }, draft: { name: 'OPV', quantity: '3' }, order: [{ name: 'BCG', quantity: '5' }] }, allocation: { status: 'matched', facility: { facilityName: 'Mumford HC', district: 'Gomoa West' }, products: [{ name: 'BCG', canonical: 'BCG', quantity: '5', balance: 12 }, { name: 'OPV', canonical: 'OPV', quantity: '3', balance: 9 }] } };
 state = live;
 globalThis.document = document;
 globalThis.chrome = { tabs: { async query() { return [{ id: 7, url: 'https://fulfillment-gh1-production.platform.flyzipline.com/v3/orders/Draft' }]; }, async get() { return { id: 7, url: 'https://fulfillment-gh1-production.platform.flyzipline.com/v3/orders/Draft' }; }, async sendMessage(id, message) { return message.type === 'FS_DIAGNOSTICS' ? { formFound: true, selection: state.selection, bridgeVersion: '2.3.21' } : state; }, onActivated: { addListener() {} }, onUpdated: { addListener() {} } }, storage: { session: { async get() { return { 'fsContext:7': state }; } }, onChanged: { addListener(fn) { changed = fn; } } }, runtime: { getManifest() { return { content_scripts: [{ js: ['fs-content.js'], matches: ['https://fulfillment-gh1-production.platform.flyzipline.com/*'] }] }; }, async sendMessage(message) { manualRequest = message; return state; } } };
 try {
   setupFsPanel({ onFacility(facility) { facilities.push(facility); } }); await new Promise(resolve => setImmediate(resolve));
   const box = document.getElementById('fsLiveContext'); assert.match(box.textContent, /In order: BCG/); assert.match(box.textContent, /Draft: OPV/); assert.ok(!box.textContent.includes('PCV'));
   state = { ...live, selection: { ...live.selection, draft: null, order: [live.selection.order[0], live.selection.draft] } };
   changed({ 'fsContext:7': { newValue: state } }, 'session'); assert.match(box.textContent, /In order: OPV/); assert.ok(!box.textContent.includes('Draft:'));
   state = { ...state, selection: { ...state.selection, order: [live.selection.draft] }, allocation: { ...state.allocation, products: [state.allocation.products[1]] } };
   changed({ 'fsContext:7': { newValue: state } }, 'session'); assert.ok(!box.textContent.includes('BCG'));
   state = { ...state, allocation: { status: 'ambiguous', message: 'Select manually', candidates: [{ id: 'a:b', facilityName: 'Mumford HC', district: 'Gomoa West', cycle: 'October 2026' }] } };
   changed({ 'fsContext:7': { newValue: state } }, 'session'); const manual = document.getElementById('fsManualFacility'); assert.equal(manual.hidden, false); manual.querySelector('option[value="a:b"]').selected = true; manual.dispatchEvent(new document.defaultView.Event('change')); await new Promise(resolve => setImmediate(resolve));
   assert.equal(manualRequest.type, 'FS_MANUAL'); assert.equal(manualRequest.facilityId, 'a:b'); assert.equal(facilities.at(-1).name, 'Mumford HC'); assert.equal(facilities.at(-1).allocationStatus, 'ambiguous');
   state = { ...live, selection: { ...live.selection, draft: null, order: [] }, allocation: { ...live.allocation, products: [] } };
   changed({ 'fsContext:7': { newValue: state } }, 'session');
   assert.match(box.textContent, /No requested products yet/);
   assert.match(box.textContent, /Open the product picker in FS/);
 } finally { globalThis.document = previous.document; globalThis.chrome = previous.chrome; }
});

test('div-based React Select and aria-labelledby readonly widgets work without test attributes', () => {
 const { document } = parseHTML(`<div id="app"><h1>Add New Order</h1><div class="order-card">
 <div><label for="facility-input">Facility</label><div class="select"><div><div class="css-123-singleValue">Mumford HC</div><div><input id="facility-input" role="combobox" aria-autocomplete="list" value=""></div></div></div></div>
 <div><span id="product-label">Product</span><input role="combobox" aria-labelledby="product-label" readonly value="Bacille Calmette-Guerin Vaccine"></div>
 <div><label for="qty">Quantity *</label><input id="qty" value="5"></div>
 <table><tr><th>Product</th><th>Qty</th></tr><tbody><tr><td>BCG</td><td>5</td></tr></tbody></table>
 </div></div>`);
 const adapter = createFsAdapter(document);
 assert.ok(adapter.root()); assert.equal(adapter.read().facility.name, 'Mumford HC');
 assert.equal(adapter.read().draft.name, 'Bacille Calmette-Guerin Vaccine'); assert.equal(adapter.read().draft.quantity, '5');
 assert.equal(adapter.read().order[0].quantity, '5'); assert.equal(adapter.diagnostics().formFound, true);
 document.getElementById('qty').remove(); assert.ok(adapter.root()); assert.equal(adapter.read().facility.name, 'Mumford HC');
 assert.equal(adapter.diagnostics().quantityControl, false);
});

test('connection diagnostics reveal missing FS markup without transmitting unrelated page text', async () => {
 const messages = [], page = browser('<html><body><div>Unrelated private notes</div></body></html>', async message => { messages.push(message); return { error: 'Form not detected.' }; });
 await tick(); assert.equal(messages[0].diagnostics.formFound, false);
 assert.ok(!JSON.stringify(messages).includes('Unrelated private notes'));
 let details;
 // Diagnostic response contains only control-presence flags.
 const { document } = parseHTML(fixture); details = createFsAdapter(document).diagnostics();
 assert.deepEqual(Object.keys(details).sort(), ['facilityControl', 'formFound', 'productControl', 'quantityControl', 'tableFound']);
});

test('plain React field captions detect product and quantity without semantic labels', () => {
 const { document } = parseHTML(`<html><body><div><div><span>Facility</span><input readonly value="Mumford HC"></div>
 <section><div><p>Product *</p><div><button aria-haspopup="listbox"><span>BCG</span></button></div></div>
 <div><div>Requested Qty</div><div><input type="number" value="5"></div></div><button>Add</button></section></div></body></html>`);
 const adapter = createFsAdapter(document);
 assert.equal(adapter.diagnostics().formFound, true);
 assert.equal(adapter.diagnostics().productControl, true);
 assert.equal(adapter.diagnostics().quantityControl, true);
 assert.equal(adapter.read().facility.name, 'Mumford HC');
 assert.deepEqual(adapter.read().draft, { name: 'BCG', id: '', quantity: '5' });
});

test('product placeholder identifies a React Select input without treating typed search as selection', () => {
 const { document } = parseHTML(`<main><h1>Add New Order</h1><input aria-label="Facility" readonly value="Mumford HC">
 <div><span class="css-singleValue">OPV</span><input placeholder="Select product" value="typed search"></div>
 <input placeholder="Quantity" type="number" value="3"></main>`);
 const adapter = createFsAdapter(document);
 assert.equal(adapter.read().draft.name, 'OPV');
 assert.equal(adapter.read().draft.quantity, '3');
 document.querySelector('.css-singleValue').remove();
 assert.equal(adapter.read().draft, null);
});

test('unassociated text captions cannot borrow a facility or unrelated widget', () => {
 const { document } = parseHTML(`<main><h1>Add New Order</h1><div><label for="facility">Facility</label>
 <input id="facility" readonly value="Mumford HC"><span>Product</span></div>
 <section><span>Quantity</span><input aria-label="Patient name"><input aria-label="Notes"></section></main>`);
 const adapter = createFsAdapter(document);
 assert.equal(adapter.diagnostics().productControl, false);
 assert.equal(adapter.diagnostics().quantityControl, false);
 assert.equal(adapter.read().draft, null);
});

test('empty Requested Products screen retains facility and detects entry controls when opened', () => {
 const { document } = parseHTML(`<html><body><div id="order-screen"><div><label for="facility">Facility</label>
 <input id="facility" readonly value="Mumford HC"></div><section><h2>Requested Products</h2>
 <table><thead><tr><th>Product</th><th>Qty</th></tr></thead><tbody><tr><td colspan="2">No requested products.</td></tr></tbody></table>
 <div id="entry"></div></section></div></body></html>`);
 const adapter = createFsAdapter(document);
 assert.deepEqual(adapter.diagnostics(), { formFound: true, facilityControl: true, productControl: false, quantityControl: false, tableFound: true });
 assert.equal(adapter.read().facility.name, 'Mumford HC');
 assert.equal(adapter.read().draft, null);
 assert.deepEqual(adapter.read().order, []);
 document.getElementById('entry').innerHTML = '<label for="product">Product</label><input id="product" readonly value="BCG"><label for="quantity">Quantity</label><input id="quantity" type="number" value="5">';
 assert.equal(adapter.diagnostics().productControl, true);
 assert.equal(adapter.diagnostics().quantityControl, true);
 assert.deepEqual(adapter.read().draft, { name: 'BCG', id: '', quantity: '5' });
 document.querySelector('tbody').innerHTML = '<tr><td>BCG</td><td>5</td></tr>';
 document.getElementById('entry').replaceChildren();
 assert.equal(adapter.read().draft, null);
 assert.deepEqual(adapter.read().order, [{ name: 'BCG', id: '', quantity: '5' }]);
});

test('Requested Products heading supports an empty screen before table columns mount', () => {
 const { document } = parseHTML('<html><body><div><input aria-label="Facility" readonly value="Mumford HC"><section><h3>Requested Products</h3><p>No requested products.</p></section></div></body></html>');
 const adapter = createFsAdapter(document);
 assert.equal(adapter.diagnostics().formFound, true);
 assert.equal(adapter.read().facility.name, 'Mumford HC');
 assert.deepEqual(adapter.read().order, []);
});

test('already-selected Gbangu CHPS is captured initially with district/region and DOM-only facility changes', async () => {
 const html = await readFile(new URL('./fixtures/fs-gbangu-order.html', import.meta.url), 'utf8');
 const messages = [], page = browser(html, async message => { messages.push(message); return allocate(message); });
 await tick();
 assert.deepEqual(JSON.parse(JSON.stringify(messages[0].selection.facility)), { id: '', name: 'Gbangu CHPS', district: 'East Mamprusi', region: 'North East' });
 assert.equal(messages[0].selection.draft, null);
 let snapshot;
 assert.equal(page.message({ type: 'FS_DIAGNOSTICS' }, result => { snapshot = result; }), false);
 assert.equal(snapshot.selection.facility.name, 'Gbangu CHPS');
 const refreshed = await new Promise(resolve => { assert.equal(page.message({ type: 'FS_REFRESH' }, resolve), true); });
 assert.equal(refreshed.selection.facility.district, 'East Mamprusi');
 page.document.querySelector('.selected-singleValue').textContent = 'Other CHPS';
 page.document.querySelector('dd').textContent = 'Other District';
 page.notify(page.document.querySelector('section')); await tick();
 assert.equal(messages.at(-1).selection.facility.name, 'Other CHPS');
 assert.equal(messages.at(-1).selection.facility.district, 'Other District');
 assert.equal(page.message({ type: 'UNRELATED' }), false);
});

test('scoped static facility label/value pairs do not require a search input', () => {
 const { document } = parseHTML('<html><body><main><dl><dt>Facility</dt><dd>Gbangu CHPS</dd><dt>District</dt><dd>East Mamprusi</dd><dt>Region</dt><dd>North East</dd></dl><p>Unrelated private note</p></main></body></html>');
 const adapter = createFsAdapter(document);
 assert.deepEqual(adapter.read().facility, { name: 'Gbangu CHPS', id: '', district: 'East Mamprusi', region: 'North East' });
 assert.equal(adapter.diagnostics().formFound, true);
 assert.ok(!JSON.stringify(adapter.read()).includes('private note'));
});

test('same-version reinjection after extension reload replaces the bridge and its listeners', async () => {
 const messages = [], page = browser(fixture, async message => { messages.push(message); return allocate(message); });
 await tick();
 page.reinject(); await tick();
 assert.equal(page.listenerCount, 1);
 assert.equal(page.document.querySelectorAll('#order-checker-vaccine-allocation').length, 1);
 assert.equal(messages.length, 2);
 page.document.getElementById('product').dataset.selectedName = 'BCG';
 page.document.getElementById('quantity').value = '5';
 page.document.getElementById('quantity').dispatchEvent(new page.window.Event('input', { bubbles: true }));
 await tick();
 assert.equal(messages.length, 3);
 assert.equal(page.host.style.display, 'block');
});

test('Package & Script travels through initial and mutation snapshots, then clears when a new order starts', async () => {
 const html = fixture.replace('<section aria-label="Requested Products">', '<section><h2>Package &amp; Script</h2><div><div id="dynamic-first">Line one.<br>Line two!</div><button aria-label="Edit script">Edit</button></div></section><section aria-label="Requested Products">').replace('<h1>Add New Order</h1>', '<button>Add Order</button><h1>Add New Order</h1>');
 const messages = [], page = browser(html, async message => { messages.push(message); return allocate(message); });
 await tick();
 assert.equal(messages[0].selection.script.text, 'Line one.\nLine two!');
 page.document.getElementById('dynamic-first').innerHTML = 'Updated.<br>Still exact?';
 page.notify(page.document.getElementById('dynamic-first')); await tick();
 assert.equal(messages.at(-1).selection.script.text, 'Updated.\nStill exact?');
 page.document.querySelector('main > button').dispatchEvent(new page.window.Event('click', { bubbles: true }));
 await tick();
 assert.equal(messages.at(-1).selection.script.text, null);
 page.document.getElementById('dynamic-first').remove();
 page.notify(); await tick();
 assert.equal(messages.at(-1).selection.script.text, null);
});
