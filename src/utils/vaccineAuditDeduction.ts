import { authFetch } from './authFetch';
import type { VaccineValidationResult } from '../types';

export interface VaccineAuditSnapshot {
  facilityId: string;
  orderSource: 'whatsapp' | 'fs_only';
  whatsappMessage: string;
  fulfillmentConfirmation: string;
  ccaUser: string;
}

// Deduct only the fulfilled quantities from a successful audit, using its ID for retries.
export async function deductValidatedVaccineAudit(audit: VaccineValidationResult, snapshot: VaccineAuditSnapshot, request: typeof fetch = authFetch) {
  if (!audit.isValid) return null;
  const facilityId = audit.facilityId || snapshot.facilityId;
  if (!audit.auditLogId || !facilityId || facilityId === 'auto') throw new Error('The audited facility or audit ID is unavailable. Run the audit again.');
  const supplied = audit.items.filter(item => item.fsQty > 0);
  if (!supplied.length || supplied.some(item => item.status !== 'valid' || !Number.isSafeInteger(item.fsQty))) {
    throw new Error('Only valid, positive fulfilled quantities can update the Blueprint.');
  }
  const response = await request('/api/vaccine/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facilityId, orderSource: snapshot.orderSource,
      items: supplied.map(item => ({ vaccine: item.vaccine, currentOrder: item.fsQty })),
      ccaUser: snapshot.ccaUser, orderId: audit.auditLogId,
      rawOrderText: snapshot.whatsappMessage, rawFsText: snapshot.fulfillmentConfirmation })
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || 'Allocation update failed.');
  return result;
}
