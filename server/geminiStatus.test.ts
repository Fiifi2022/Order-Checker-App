import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { GeminiUsageTracker } from './geminiUsage';

const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const routeStart = source.indexOf("app.get('/api/gemini-status'");
const routes = source.slice(routeStart, source.indexOf('// Helper endpoint for Order Verification', routeStart));
function harness(tracker: GeminiUsageTracker) {
  const handlers = new Map<string, any>();
  vm.runInNewContext(ts.transpile(routes), {
    app: { get(path: string, callback: any) { handlers.set(path, callback); } },
    geminiUsage: tracker,
    getGeminiClient() { throw new Error('Status/diagnostics must never initialize Gemini'); }
  });
  return { request(path = '/api/gemini-status') {
    let body: any;
    handlers.get(path)({}, { setHeader() {}, json(value: any) { body = JSON.parse(JSON.stringify(value)); } });
    return body;
  }, handlers };
}

test('status and diagnostics read local state repeatedly without client initialization or generation', () => {
  const tracker = new GeminiUsageTracker(), app = harness(tracker);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(app.request(), { status: 'off' });
    assert.equal(app.request('/api/speedtest').geminiStatus, 'off');
  }
  assert.ok(routeStart < source.indexOf('API route not found:'));
  assert.doesNotMatch(routes, /generateContent|getGeminiClient|setInterval|setTimeout/);
});

test('idle Gemini reports Off without inspecting configuration or consuming quota', () => {
  assert.deepEqual(new GeminiUsageTracker().getStatus(), { status: 'off' });
});

test('actual request publishes Ready, Processing and Done', async () => {
  const tracker = new GeminiUsageTracker(), changes: string[] = [];
  const unsubscribe = tracker.subscribe(() => changes.push(tracker.getStatus().status));
  await tracker.run(async () => { assert.equal(tracker.getStatus().status, 'processing'); return 'response'; });
  assert.deepEqual(changes, ['ready', 'processing', 'done']);
  assert.equal(tracker.getStatus().status, 'done');
  unsubscribe();
});

test('429 has one attempt and passive status reads never trigger more usage', async () => {
  const tracker = new GeminiUsageTracker(); let calls = 0;
  await assert.rejects(tracker.run(async () => { calls++; throw Object.assign(new Error('secret'), { status: 429 }); }));
  assert.equal(calls, 1);
  const app = harness(tracker);
  assert.deepEqual(app.request(), { status: 'quota_exceeded' });
  assert.deepEqual(app.request(), { status: 'quota_exceeded' });
  assert.equal(calls, 1);
  await tracker.run(async () => { calls++; });
  assert.equal(calls, 2); assert.equal(tracker.getStatus().status, 'done');
});

test('network, timeout, authentication and invalid-response failures report Unavailable', async () => {
  for (const status of [undefined, 400, 401, 403, 503]) {
    const tracker = new GeminiUsageTracker();
    await assert.rejects(tracker.run(async () => { throw Object.assign(new Error('private key'), { status }); }));
    assert.deepEqual(tracker.getStatus(), { status: 'unavailable' });
    assert.doesNotMatch(JSON.stringify(tracker.getStatus()), /private key/);
  }
});

test('concurrent audits keep Processing until all live requests finish', async () => {
  const tracker = new GeminiUsageTracker(); let finish: () => void;
  const pending = tracker.run(() => new Promise<void>(resolve => { finish = resolve; }));
  await tracker.run(async () => {});
  assert.equal(tracker.getStatus().status, 'processing');
  finish!(); await pending;
  assert.equal(tracker.getStatus().status, 'done');
});

test('status stream pushes state and unsubscribes on disconnect without heartbeat or reconnect timers', async () => {
  const tracker = new GeminiUsageTracker(), app = harness(tracker);
  const frames: string[] = []; let disconnect: () => void;
  app.handlers.get('/api/gemini-status/events')({}, { setHeader() {}, flushHeaders() {}, write(frame: string) { frames.push(frame); }, on(event: string, callback: () => void) { assert.equal(event, 'close'); disconnect = callback; } });
  await tracker.run(async () => {});
  assert.deepEqual(frames.map(frame => JSON.parse(frame.slice(6)).status), ['off', 'ready', 'processing', 'done']);
  disconnect!(); await tracker.run(async () => {});
  assert.equal(frames.length, 4);
  const component = readFileSync(new URL('../src/components/GeminiStatus.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(component, /setInterval|setTimeout|fetch\(/);
  assert.match(component, /controller\.abort\(\)/);
});

test('legacy audit generation also stops after one quota failure without model switching', async () => {
  const tracker = new GeminiUsageTracker(); let calls = 0;
  const start = source.indexOf('async function generateAuditContent(');
  const helper = source.slice(start, source.indexOf('// Health-check endpoint', start));
  const context = vm.createContext({ geminiUsage: tracker });
  vm.runInContext(ts.transpile(helper), context);
  await assert.rejects(context.generateAuditContent({ models: { async generateContent(options: any) {
    calls++; assert.equal(options.config.httpOptions.retryOptions.attempts, 1);
    throw Object.assign(new Error('quota'), { status: 429 });
  } } }, { model: 'gemini-3.1-flash-lite', contents: 'actual audit input' }));
  assert.equal(calls, 1); assert.equal(tracker.getStatus().status, 'quota_exceeded');
});

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('Done returns to Off once, with no requests or recurring idle work', async () => {
  const tracker = new GeminiUsageTracker(20), changes: string[] = [];
  let calls = 0;
  const unsubscribe = tracker.subscribe(() => changes.push(tracker.getStatus().status));
  await tracker.run(async () => { calls++; });
  assert.equal(tracker.getStatus().status, 'done');
  await pause(50);
  assert.equal(tracker.getStatus().status, 'off');
  assert.deepEqual(changes, ['ready', 'processing', 'done', 'off']);
  await pause(30);
  assert.equal(changes.length, 4);
  assert.equal(calls, 1);
  unsubscribe();
});

test('a new request cancels the old Off timer and gets its own completion lifecycle', async () => {
  const tracker = new GeminiUsageTracker(20), changes: string[] = [];
  const unsubscribe = tracker.subscribe(() => changes.push(tracker.getStatus().status));
  await tracker.run(async () => {});
  let finish!: () => void;
  const pending = tracker.run(() => new Promise<void>(resolve => { finish = resolve; }));
  await pause(50);
  assert.equal(tracker.getStatus().status, 'processing');
  assert.deepEqual(changes, ['ready', 'processing', 'done', 'ready', 'processing']);
  finish(); await pending;
  assert.equal(tracker.getStatus().status, 'done');
  await pause(50);
  assert.equal(tracker.getStatus().status, 'off');
  assert.deepEqual(changes.slice(-2), ['done', 'off']);
  unsubscribe();
});

test('failures are visible briefly, then Gemini goes Off without retrying', async () => {
  for (const [code, expected] of [[429, 'quota_exceeded'], [503, 'unavailable']] as const) {
    const tracker = new GeminiUsageTracker(20), changes: string[] = [];
    let calls = 0;
    const unsubscribe = tracker.subscribe(() => changes.push(tracker.getStatus().status));
    await assert.rejects(tracker.run(async () => { calls++; throw Object.assign(new Error('request failed'), { status: code }); }));
    assert.equal(tracker.getStatus().status, expected);
    await pause(50);
    assert.deepEqual(changes, ['ready', 'processing', expected, 'off']);
    assert.equal(calls, 1);
    unsubscribe();
  }
});

test('a concurrent success cannot hide a quota failure while all requests drain', async () => {
  const tracker = new GeminiUsageTracker(20);
  let finish!: () => void;
  const pending = tracker.run(() => new Promise<void>(resolve => { finish = resolve; }));
  await assert.rejects(tracker.run(async () => { throw Object.assign(new Error('quota'), { status: 429 }); }));
  await pause(50);
  assert.equal(tracker.getStatus().status, 'processing');
  finish(); await pending;
  assert.equal(tracker.getStatus().status, 'quota_exceeded');
  await pause(50);
  assert.equal(tracker.getStatus().status, 'off');
});

test('the status stream reports the final Off transition and the badge starts Off', async () => {
  const tracker = new GeminiUsageTracker(20), app = harness(tracker), frames: string[] = [];
  let disconnect!: () => void;
  app.handlers.get('/api/gemini-status/events')({}, { setHeader() {}, flushHeaders() {}, write(frame: string) { frames.push(frame); }, on(_event: string, callback: () => void) { disconnect = callback; } });
  await tracker.run(async () => {});
  await pause(50);
  assert.deepEqual(frames.map(frame => JSON.parse(frame.slice(6)).status), ['off', 'ready', 'processing', 'done', 'off']);
  disconnect();
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: GeminiStatus } = await import('../src/components/GeminiStatus');
  assert.match(renderToStaticMarkup(createElement(GeminiStatus)), /Gemini: Off/);
});
