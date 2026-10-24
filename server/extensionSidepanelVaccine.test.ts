import test from 'node:test';
import assert from 'node:assert/strict';
import { commitAllocation, normalizeDeductions, vaccineAuditBody } from '../extension/sidepanel-vaccine-api.js';

const audit = { verificationId: 'vaccine-audit', orderId: 'vaccine-audit', facilityId: 'facility-1', canCommit: true, isValid: true, allMatch: true, items: [{ vaccine: 'BCG', fsQty: 2 }] };
const receipt = { success: true, allocationStatus: 'deducted', orderId: 'vaccine-audit', facilityId: 'facility-1', transaction: { id: 'vaccine-audit', facilityId: 'facility-1', status: 'confirmed', items: [{ vaccine: 'BCG', currentOrder: 2, remainingBefore: 10, remainingAfter: 8 }] } };

test('supplied vaccine side panel uses the current idempotent, receipt-verified allocation contract', async () => {
  const calls: any[] = [];
  const result = await commitAllocation(async (url: string, options: any) => { calls.push({ url, options }); return receipt; }, { audit });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), { orderId: audit.verificationId, facilityId: audit.facilityId });
  assert.equal(result.transaction.id, audit.verificationId);
  assert.deepEqual(normalizeDeductions(result), [{ name: 'BCG', before: 10, deducted: 2, after: 8 }]);
});

test('ambiguous or unrelated deduction responses never become a success or trigger a second POST', async () => {
  for (const response of [{ committed: true, deducted: true }, { ...receipt, transaction: { ...receipt.transaction, id: 'different-order' } }]) {
    const calls: any[] = [];
    await assert.rejects(commitAllocation(async (url: string, options: any) => { calls.push({ url, options }); return response; }, { audit }), /pending verification/);
    assert.equal(calls.filter(call => call.options?.method === 'POST').length, 1);
    assert.equal(calls.length, 2, 'one GET checks whether the original write was saved');
  }
});

test('failed or unauthorized audits cannot reach allocation writes', async () => {
  for (const changed of [{ ...audit, canCommit: false }, { ...audit, isValid: false }, { ...audit, allMatch: false }]) {
    let writes = 0;
    await assert.rejects(commitAllocation(async () => { writes++; return receipt; }, { audit: changed }));
    assert.equal(writes, 0);
  }
});

test('supplied vaccine form keeps the current audit modes and never deducts during verification', () => {
  const body = vaccineAuditBody({ mode: 'fulfillment', facility: { id: 'facility-1', name: 'Facility' }, whatsapp: 'ignored', fulfillment: 'BCG [2/2]', revision: 12 });
  assert.equal(body.auditMode, 'fulfillment_only'); assert.equal(body.whatsappMessage, '');
  assert.equal(body.deductAllocation, false); assert.equal(body.auditScope, 'vaccine_checker');
});
