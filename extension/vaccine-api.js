import { normalizeCompanionAuditMode, companionVerificationReference } from './audit-contract.js';

function refreshAllocationAdvice() {
  try { void globalThis.chrome?.runtime?.sendMessage({ type: 'FS_REFRESH_ALL' })?.catch(() => {}); }
  catch { /* Other tabs also refresh periodically if the extension is reloading. */ }
}

export async function auditVaccineOrder(request, { mode, facilityId, whatsappMessage, fulfillmentConfirmation }) {
  const auditMode = normalizeCompanionAuditMode(mode);
  if (!auditMode) throw new Error('Select WhatsApp + Fulfilment or Fulfilment Only.');
  whatsappMessage = typeof whatsappMessage === 'string' ? whatsappMessage : '';
  fulfillmentConfirmation = typeof fulfillmentConfirmation === 'string' ? fulfillmentConfirmation : '';
  if (!facilityId) throw new Error('Select the facility and allocation cycle first.');
  if (!fulfillmentConfirmation.trim()) throw new Error('Paste the Fulfilment System confirmation.');
  if (auditMode !== 'fulfillment_only' && !whatsappMessage.trim()) throw new Error('Paste the customer request or select Fulfilment Only.');
  const data = await request('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auditScope: 'vaccine_checker', auditMode, facilityId,
      whatsappMessage: auditMode === 'fulfillment_only' ? '' : whatsappMessage, fulfillmentConfirmation, checkSource: 'companion_extension' }) });
  if (typeof data.allMatch !== 'boolean' || typeof data.isValid !== 'boolean' || !Array.isArray(data.items) || !data.allocationStatus) throw new Error('Unexpected vaccine audit response. Update the backend and extension together.');
  if (data.allMatch && !data.items.length) throw new Error('The backend returned no audited products. Review the confirmation before dispatch.');
  const orderId = companionVerificationReference(data);
  if (!orderId) throw new Error('The vaccine audit did not return a usable verification reference. Update the backend, then run Audit & Update Allocation again.');
  return { ...data, verificationId: orderId, orderId };
}
// A persisted, matching transaction is authoritative even when older backends
// omit response wrapper fields. Never infer deduction from balances alone.
export function verifiedDeductionReceipt(data, audit) {
  const orderId = companionVerificationReference(audit);
  const transaction = data?.transaction;
  if (!transaction || transaction.id !== orderId || !Array.isArray(transaction.items)) return null;
  if (transaction.status !== undefined && transaction.status !== 'confirmed') return null;
  if (transaction.status !== 'confirmed' && !(data.success === true && data.allocationStatus === 'deducted')) return null;
  const facilityIds = [transaction.facilityId, data.facilityId, data.updatedFacility?.id].filter(value => value !== undefined);
  if (!facilityIds.length || facilityIds.some(value => value !== audit.facilityId)) return null;
  if ([data.orderId, transaction.orderId].some(value => value !== undefined && value !== orderId)) return null;
  if (transaction.items.some(item => !Number.isSafeInteger(item.currentOrder) || item.currentOrder <= 0 || !Number.isFinite(item.remainingAfter) || item.remainingAfter < 0 || !audit.items.some(product => product.vaccine === item.vaccine && Number(product.fsQty) === item.currentOrder))) return null;
  return { ...data, success: true, allocationStatus: 'deducted', orderId, facilityId: audit.facilityId, transaction };
}
export function pendingDeductionStatus() {
  const error = new Error('Allocation status pending verification');
  error.allocationPending = true;
  return error;
}
export async function commitVaccineOrder(request, audit) {
  if (!audit.canCommit || !audit.isValid || audit.allMatch !== true) throw new Error('Complete all required audit checks before confirming fulfilment.');
  const orderId = companionVerificationReference(audit);
  if (!orderId || !audit.facilityId) throw new Error('Run a vaccine allocation audit to obtain its saved verification reference and facility before updating allocation.');
  try {
    const data = await request('/api/vaccine/allocations/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, facilityId: audit.facilityId }) });
    const saved = verifiedDeductionReceipt(data, audit);
    if (saved) { refreshAllocationAdvice(); return saved; }
  } catch (error) {
    // Input/permission conflicts are definitive rejections; retain their reason.
    if ([400, 401, 403, 404, 409, 422].includes(error.status)) throw error;
  }
  // A missing wrapper or a lost response can follow a successful commit.
  // Confirm using GET only; never POST again to discover the outcome.
  const prior = await getDeductionStatus(request, audit);
  if (prior.allocationStatus === 'deducted') return prior;
  throw pendingDeductionStatus();
}

export async function getDeductionStatus(request, audit) {
  const orderId = companionVerificationReference(audit);
  if (!orderId || !audit.facilityId) throw new Error('Run the vaccine allocation audit again to obtain its saved verification reference.');
  try {
    const data = await request(`/api/vaccine/allocations/commit/${encodeURIComponent(orderId)}`);
    const saved = verifiedDeductionReceipt(data, audit);
    if (saved) { refreshAllocationAdvice(); return saved; }
    if (data?.allocationStatus === 'awaiting_confirmation' && data.orderId === orderId && data.facilityId === audit.facilityId && !data.transaction) return data;
  } catch { /* A failed lookup cannot establish whether the write committed. */ }
  throw pendingDeductionStatus();
}
