import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as policy from '../shared/auditPerformance';
import { createGeneralAuditRun, isCurrentGeneralAuditRun } from '../src/utils/generalAuditRun';
const tick = () => new Promise(resolve => setImmediate(resolve));
function app() {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const runGeneralVerification =');
  const code = source.slice(start, source.indexOf('// Dispatch discrepancy resolution logic', start)).replace('import.meta.env.VITE_AUDIT_HARD_TIMEOUT_MS', 'undefined');
  let currentTime = 0, calls = 0, error: any = null, result: any = null, loading = false, elapsed = 0;
  const pending: ((response: Response) => void)[] = [];
  const timers: { callback: () => void; at: number; interval: boolean; active: boolean }[] = [];
  const clock = (callback: () => void, ms: number, interval = false) => { const timer = { callback, at: currentTime + ms, interval, active: true }; timers.push(timer); return timer; };
  const requestRef: any = { current: null }, revision = { current: 0 };
  const inputs = { current: { whatsappMessage: 'Facility: Synthetic HC\nOrderer: Test User\nPCM - 5', fulfillmentConfirmation: 'Facility: Synthetic HC\nOrderer: Test User\nPCM [5/5]' } };
  const invalidate = () => { revision.current++; requestRef.current?.abort(); requestRef.current = null; result = null; loading = false; };
  const context: any = vm.createContext({ ...policy, result: null, currentGeneralInputs: inputs, generalAuditRequest: requestRef, generalAuditRevision: revision,
    invalidateGeneralAudit: invalidate, AbortController, createGeneralAuditRun, isCurrentGeneralAuditRun,
    Date: { now: () => currentTime }, crypto: { randomUUID: () => 'synthetic-id' }, activeUser: null, isDemoAudit: false,
    setLoading(value: boolean) { loading = value; }, setError(value: any) { error = value; }, setResult(value: any) { result = value; }, setVerificationTime(value: number) { elapsed = value; },
    setPromptedItems() {}, setGeneralServiceWarning() {}, setCatalogRevision() {}, applyGeneralCatalog() {}, completeGeneralAuditRun: (_run: any, value: any) => value,
    console: { error() {} },
    setTimeout: (callback: () => void, ms: number) => clock(callback, ms), setInterval: (callback: () => void, ms: number) => clock(callback, ms, true),
    clearTimeout: (timer: any) => { if (timer) timer.active = false; }, clearInterval: (timer: any) => { if (timer) timer.active = false; },
    authFetch: async (_url: string, options: any) => { calls++; return policy.waitForAudit(new Promise<Response>(resolve => pending.push(resolve)), options.signal); }
  });
  vm.runInContext(ts.transpile(code + '\nglobalThis.run = runGeneralVerification;'), context);
  return { run: () => context.run(), inputs, invalidate,
    advance(ms: number) { currentTime = ms; for (const timer of timers) if (timer.active && timer.at <= ms) { if (!timer.interval) timer.active = false; timer.callback(); } },
    complete(index = 0) { pending[index](Response.json({ allMatch: true, productCatalog: { revision: 1, products: [] } })); },
    get state() { return { calls, error, result, loading, elapsed }; } };
}

test('General Auditor waits after three seconds, then renders results without a duplicate submission', async () => {
  const ui = app(); const pending = ui.run(); await ui.run();
  assert.equal(ui.state.calls, 1);
  ui.advance(3200);
  assert.equal(ui.state.loading, true); assert.equal(ui.state.error, null); assert.ok(ui.state.elapsed >= 3);
  ui.complete(); await pending;
  assert.equal(ui.state.result.allMatch, true); assert.equal(ui.state.loading, false);
});

test('General Auditor hard timeout preserves inputs and permits a retry', async () => {
  const ui = app(), original = { ...ui.inputs.current }; const pending = ui.run();
  ui.advance(policy.AUDIT_HARD_TIMEOUT_MS); await pending;
  assert.equal(ui.state.result, null); assert.match(ui.state.error, /Please retry/); assert.equal(ui.state.loading, false);
  assert.deepEqual(ui.inputs.current, original);
  const retry = ui.run(); assert.equal(ui.state.calls, 2); ui.complete(1); await retry;
  assert.equal(ui.state.result.allMatch, true);
});

test('changing inputs cancels the old audit and discards its late result', async () => {
  const ui = app(); const pending = ui.run(); ui.invalidate(); ui.inputs.current.whatsappMessage += '\nAmoxicillin - 2'; await pending;
  ui.complete(); await tick();
  assert.equal(ui.state.result, null); assert.equal(ui.state.error, null);
});
