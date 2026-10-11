import test from 'node:test';
import assert from 'node:assert/strict';
import { runGeneralAuditor } from './generalAuditor';
import { orderLimitAcknowledgementHandler } from './orderLimitAcknowledgement';
import { canAccess } from './auth';
import { acknowledgeOrderLimit } from '../extension/order-limits.js';

const original = () => ({ ...runGeneralAuditor('Facility: Alpha Clinic\nOrderer: Jane\nPCM - 10\nORS - 5', 'Facility: Beta Clinic\nOrderer: Jane\nPCM [5/10]'), id: 'existing', durationSec: 3, timestamp: 'original-time' });

test('browser acknowledgement makes no network request and preserves unrelated discrepancies and evidence', () => {
  const savedFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('Must not analyze again'); };
  try {
    const record = original(), key = record.items[0].fulfillment.key;
    const confirmed = acknowledgeOrderLimit(record, key, true);
    assert.equal(confirmed.items[0].status, 'order limit applied');
    assert.equal(confirmed.items[1], record.items[1]);
    assert.equal(confirmed.issueCount, 2); // Facility mismatch and missing ORS remain.
    assert.equal(confirmed.allMatch, false); assert.equal('status' in confirmed ? confirmed.status : undefined, 'pending');
    assert.equal(confirmed.durationSec, 3); assert.equal(confirmed.timestamp, 'original-time');
    assert.equal(confirmed.generalAudit.orderLimitDecisions[key], true);
    assert.equal(record.items[0].status, 'quantity mismatch');
  } finally { globalThis.fetch = savedFetch; }
});
test('acknowledgement endpoint updates the existing audit without starting another verification', async () => {
  let record: any = original(), saves = 0;
  const handler = orderLimitAcknowledgementHandler({ read: async () => record, save: async value => { record = value; saves++; } });
  const response: any = { code: 200, status(code: number) { this.code = code; return this; }, json(data: any) { this.data = data; } };
  const key = record.items[0].fulfillment.key;
  await handler({ params: { id: record.id }, body: { key, answer: true } } as any, response, () => {});
  assert.deepEqual(response.data, { acknowledged: true }); assert.equal(saves, 1);
  assert.equal(record.id, 'existing'); assert.equal(record.generalAudit.counts.orderLimited, 1);
  await handler({ params: { id: record.id }, body: { key: 'unknown', answer: true } } as any, response, () => {});
  assert.equal(response.code, 400); assert.equal(saves, 1);
  for (const role of ['cca', 'auditor', 'warehouse', 'admin']) assert.equal(canAccess(role, 'POST', '/audits/existing/order-limit'), true);
});
test('acknowledging the only pending limit confirms the result; declining restores its discrepancy', () => {
  const record = { ...runGeneralAuditor('PCM - 10', 'PCM [5/10]'), id: 'limit' };
  const key = record.items[0].fulfillment.key;
  const confirmed = acknowledgeOrderLimit(record, key, true);
  assert.equal(confirmed.allMatch, true); assert.equal('status' in confirmed ? confirmed.status : undefined, 'resolved');
  assert.equal(confirmed.issueCount, 0); assert.equal(confirmed.generalAudit.pendingOrderLimitCount, 0);
  assert.equal(acknowledgeOrderLimit(confirmed, key, false).allMatch, false);
});

test('quick acknowledgements for two products preserve both decisions in history', async () => {
  let record: any = { ...runGeneralAuditor('PCM - 10\nORS - 10', 'PCM [5/10]\nORS [5/10]'), id: 'two' };
  const keys = record.items.map((item: any) => item.fulfillment.key);
  const handler = orderLimitAcknowledgementHandler({ read: async () => record, save: async value => { await new Promise(resolve => setImmediate(resolve)); record = value; } });
  const response = () => ({ status() { return this; }, json() {} });
  await Promise.all(keys.map((key: string) => handler({ params: { id: 'two' }, body: { key, answer: true } } as any, response() as any, () => {})));
  assert.equal(record.generalAudit.counts.orderLimited, 2); assert.equal(record.allMatch, true);
});
