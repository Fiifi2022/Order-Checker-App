import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuditInputClear} from './audit-input-clear.js';
import {createFsScriptSync} from './fs-script.js';

function harness() {
  let elapsed = 0, next = 0, clears = 0;
  const tasks = new Map();
  const state = {result: {allMatch: true, issueCount: 0, generalAudit: {decision: 'match'}},
    context: 'account:backend', revision: 0, inputs: ['Customer request', 'FS confirmation'], busy: false};
  const controller = createAuditInputClear({getState: () => ({...state, inputs: [...state.inputs]}),
    clearInputs() {clears++; state.inputs = ['', ''];},
    setTimer(fn, delay) {tasks.set(++next, {fn, due: elapsed + delay}); return next;},
    clearTimer(id) {tasks.delete(id);}});
  return {state, controller, get clears() {return clears;}, advance(ms) {elapsed += ms; for (const [id, task] of tasks) if (task.due <= elapsed) {tasks.delete(id); task.fn();}}};
}

test('passed audit clears both inputs at five seconds and preserves its result', () => {
  const h = harness(), record = h.state.result;
  assert.equal(h.controller.schedule(), true);
  h.advance(4999); assert.equal(h.clears, 0);
  h.advance(1); assert.equal(h.clears, 1);
  assert.deepEqual(h.state.inputs, ['', '']);
  assert.equal(h.state.result, record);
  assert.equal(h.controller.pending, false);
});

test('discrepancies, reviews, pending order limits and busy confirmations retain inputs', () => {
  for (const modify of [s => s.result.allMatch = false, s => s.result.issueCount = 1,
    s => s.result.generalAudit.decision = 'review', s => s.result.generalAudit.pendingOrderLimitCount = 1,
    s => s.busy = true]) {
    const h = harness(); modify(h.state);
    assert.equal(h.controller.schedule(), false); h.advance(5000); assert.equal(h.clears, 0);
  }
  const h = harness(); assert.equal(h.controller.schedule({hold: true}), false);
});

test('edits, account changes, replacement audits and cancellation cannot erase new work', () => {
  for (const modify of [s => s.inputs[0] = 'Next order', s => s.context = 'different account',
    s => s.revision++, s => s.result = {...s.result}, s => s.busy = true]) {
    const h = harness(); h.controller.schedule(); modify(h.state); h.advance(5000); assert.equal(h.clears, 0);
  }
  const h = harness(); h.controller.schedule(); h.controller.cancel(); h.advance(5000); assert.equal(h.clears, 0);
});

test('a newer successful audit gets its own full five seconds', () => {
  const h = harness(); h.controller.schedule(); h.advance(4000);
  h.state.result = {...h.state.result}; h.controller.schedule();
  h.advance(1000); assert.equal(h.clears, 0);
  h.advance(4000); assert.equal(h.clears, 1);
});

test('unchanged FS script updates do not refill an automatically cleared field', () => {
  const field = {value: '', addEventListener() {}};
  const sync = createFsScriptSync({field, onChanged() {}, persist() {}});
  const script = {orderKey: 'first', text: 'First order confirmation'};
  sync.apply(script); field.value = ''; sync.apply(script); assert.equal(field.value, '');
  sync.apply({orderKey: 'second', text: 'Next order confirmation'}); assert.equal(field.value, 'Next order confirmation');
});
