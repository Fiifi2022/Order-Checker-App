import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { buildSync } from 'esbuild';
import { respondAsync, sendFsMessage, withTimeout } from './fs-messaging.js';

const workerCode = buildSync({ entryPoints: ['extension/background-entry.js'], bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
const fsUrl = 'https://fulfillment-gh3-production.platform.flyzipline.com/v3/orders/Draft?';
const sender = { url: fsUrl, tab: { id: 7 } };
const panelSender = { url: 'chrome-extension://test/popup.html' };
const selection = { facility: { name: 'Gbangu CHPS', district: 'East Mamprusi', region: 'North East' }, draft: null, order: [] };
function worker({ stored = {}, fail = '', fetchError = false, missingTab = false, delaySet, beforeFetch } = {}) {
  stored.authSession ||= { idToken: 'fixture-token', email: 'test@example.com', expiresAt: Date.now() + 600000 };
  let listener, removed, updated, changed, fetches = 0;
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const area = {
    async get(key) { if (fail === 'get') throw new Error('Session read failed'); return key === null ? { ...stored } : { [key]: stored[key] }; },
    async set(data) { if (fail === 'set') throw new Error('Session write failed'); if (delaySet) await delaySet(data); Object.assign(stored, data); },
    async remove(key) { delete stored[key]; },
  };
  const chrome = {
    runtime: { getURL: () => 'chrome-extension://test/', onMessage: { addListener(fn) { listener = fn; } } },
    storage: { session: area, local: { async get() { return {}; } }, onChanged: { addListener(fn) { changed = fn; } } },
    tabs: {
      async get() { if (missingTab) throw new Error('No tab with id: 7'); return sender.tab; },
      async sendMessage() { if (missingTab) throw new Error('Receiving end does not exist'); return { success: true }; },
      onRemoved: { addListener(fn) { removed = fn; } }, onUpdated: { addListener(fn) { updated = fn; } },
    },
  };
  const fetch = async () => {
    fetches++;
    if (beforeFetch) await beforeFetch();
    if (fetchError) throw new Error('localhost connection refused');
    return { ok: true, async json() { return { status: 'matched', facility: { id: 'sheet:gbangu', facilityName: 'Gbangu CHPS', district: 'East Mamprusi', region: 'North East' }, products: [] }; } };
  };
  vm.runInNewContext(workerCode, { chrome, fetch, URL, URLSearchParams, AbortController, Date: Clock, setTimeout, clearTimeout, console: { warn() {} } });
  return {
    request: (message, from = sender) => new Promise(resolve => { assert.equal(listener(message, from, resolve), true); }),
    listener, stored, removed: id => removed(id), updated: (id, info) => updated(id, info), changed: (data, areaName) => changed(data, areaName),
    get fetches() { return fetches; },
    advance(ms) { now += ms; },
  };
}

test('allocation cache expires and concurrent identical lookups share a single authenticated read', async () => {
  const service = worker();
  await service.request({ type: 'FS_SELECTION', selection });
  await service.request({ type: 'FS_SELECTION', selection });
  assert.equal(service.fetches, 1);
  service.advance(30001);
  await service.request({ type: 'FS_SELECTION', selection });
  assert.equal(service.fetches, 2);
  await service.request({ type: 'FS_SELECTION', selection, refresh: true });
  assert.equal(service.fetches, 3);
  let finish;
  const blocked = worker({ beforeFetch: () => new Promise(resolve => { finish = resolve; }) });
  const first = blocked.request({ type: 'FS_SELECTION', selection });
  await new Promise(resolve => setImmediate(resolve));
  const second = blocked.request({ type: 'FS_SELECTION', selection });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(blocked.fetches, 1);
  finish();
  assert.equal((await first).stale, true);
  assert.equal((await second).allocation.status, 'matched');
});

test('capture listener never claims FS messages and reports capture exceptions', async () => {
  let listener, response;
  vm.runInNewContext(await readFile(new URL('./content.js', import.meta.url), 'utf8'), {
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } }, console: { log() {} },
    window: { getSelection() { throw new Error('Selection unavailable'); } },
  });
  assert.equal(listener({ type: 'FS_REFRESH' }, {}, () => { throw new Error('Must not respond'); }), false);
  assert.equal(listener({ action: 'scrape' }, {}, value => { response = value; }), false);
  assert.match(response.error, /Selection unavailable/);
});

test('async response wrapper settles both thrown exceptions and successful tasks', async () => {
  const success = await new Promise(resolve => assert.equal(respondAsync(resolve, async () => ({ success: true })), true));
  assert.equal(success.success, true);
  const failure = await new Promise(resolve => respondAsync(resolve, () => { throw new Error('Unexpected failure'); }));
  assert.match(failure.error, /Unexpected failure/);
});

test('missing receivers, closed channels and never-resolving messages produce bounded errors', async () => {
  for (const message of ['Receiving end does not exist', 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received']) {
    await assert.rejects(sendFsMessage({ tabs: { async sendMessage() { throw new Error(message); } } }, 7, { type: 'FS_REFRESH' }), error => error.code === 'FS_CONTENT_UNAVAILABLE' && error.message.includes(message));
  }
  await assert.rejects(sendFsMessage({ tabs: { sendMessage() { return new Promise(() => {}); } } }, 7, {}, 10), error => error.code === 'FS_TIMEOUT');
  await assert.rejects(withTimeout(() => new Promise(() => {}), 10), /timed out/);
});

test('worker responds to storage read/write errors on every asynchronous branch', async () => {
  for (const fail of ['get', 'set']) {
    const service = worker({ fail });
    const response = await service.request({ type: 'FS_SELECTION', selection, diagnostics: { formFound: fail !== 'set' } });
    assert.match(response.error, /Session (read|write) failed/);
  }
  const service = worker({ fail: 'get' });
  assert.match((await service.request({ type: 'FS_REFRESH_ALL' }, panelSender)).error, /Session read failed/);
  const missing = worker({ missingTab: true });
  assert.match((await missing.request({ type: 'FS_MANUAL', tabId: 7 }, panelSender)).error, /No tab/);
  assert.equal(service.listener({ type: 'UNRELATED' }, sender, () => {}), false);
});

test('service-worker restart refreshes already-selected facilities from persisted session context', async () => {
  const first = worker();
  const state = await first.request({ type: 'FS_SELECTION', selection, refresh: true });
  assert.equal(state.allocation.facility.facilityName, 'Gbangu CHPS');
  const restarted = worker({ stored: first.stored });
  const refreshed = await restarted.request({ type: 'FS_SELECTION', selection, refresh: true });
  assert.equal(refreshed.selection.facility.region, 'North East');
  assert.equal(refreshed.loading, false);
  assert.equal(restarted.fetches, 1);
});

test('worker reports backend failure and waiting for facility without writing allocations', async () => {
  const failing = worker({ fetchError: true });
  const failed = await failing.request({ type: 'FS_SELECTION', selection });
  assert.equal(failed.code, 'BACKEND_UNREACHABLE');
  assert.equal(failed.loading, false);
  assert.equal(failed.selection.facility.name, 'Gbangu CHPS');
  const empty = worker();
  assert.equal((await empty.request({ type: 'FS_SELECTION', selection: { facility: {}, order: [] } })).allocation.status, 'no_facility');
  assert.equal(empty.fetches, 0);
});

test('disconnected FS tabs clear state and refresh failures are returned to the caller', async () => {
  const service = worker({ missingTab: true, stored: { 'fsContext:7': { tabId: 7, selection } } });
  const response = await service.request({ type: 'FS_REFRESH_ALL' }, panelSender);
  assert.equal(response.success, false);
  assert.match(response.errors[0], /Receiving end/);
  service.removed(7);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.stored['fsContext:7'], undefined);
  service.stored['fsContext:7'] = { tabId: 7, selection };
  service.updated(7, { url: 'https://example.com/' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.stored['fsContext:7'], undefined);
});

test('closing a tab during a delayed storage write cannot restore its old facility state', async () => {
  let release;
  const service = worker({ delaySet: () => new Promise(resolve => { release = resolve; }) });
  const pending = service.request({ type: 'FS_SELECTION', selection });
  await new Promise(resolve => setImmediate(resolve));
  service.removed(7); release();
  assert.equal((await pending).stale, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.stored['fsContext:7'], undefined);
  assert.equal(service.fetches, 0);
});

test('token refresh retains context while account changes invalidate it', async () => {
  const service = worker();
  await service.request({ type: 'FS_SELECTION', selection });
  service.changed({ authSession: { oldValue: { email: 'test@example.com' }, newValue: { email: 'test@example.com', idToken: 'new-token' } } }, 'session');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.stored['fsContext:7'].selection.facility.name, 'Gbangu CHPS');
  service.changed({ authSession: { oldValue: { email: 'test@example.com' }, newValue: { email: 'other@example.com' } } }, 'session');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.stored['fsContext:7'], undefined);
});
