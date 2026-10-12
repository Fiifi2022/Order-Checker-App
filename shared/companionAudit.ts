export type CompanionAuditMode = 'whatsapp_and_fulfillment' | 'fulfillment_only';

// Keep the earlier internal spelling compatible with installed companions.
export function normalizeCompanionAuditMode(value: unknown): CompanionAuditMode | undefined {
  if (value === 'whatsapp_and_fulfillment' || value === 'customer_fulfillment') return 'whatsapp_and_fulfillment';
  if (value === 'fulfillment_only') return value;
  return undefined;
}

// A reference is meaningful only when the backend has saved its approval.
// Do not invent an ID or substitute a customer/FS shipment reference here.
export function companionVerificationReference(audit: any): string | undefined {
  const value = audit?.verificationId || audit?.auditId || audit?.auditLogId || audit?.orderId;
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,179}$/.test(value) ? value : undefined;
}

export interface CompanionVerificationResponse {
  [key: string]: unknown;
  auditId: string;
  verificationId: string;
  auditMode: CompanionAuditMode;
  allMatch: boolean;
  items: Array<Record<string, any>>;
  discrepancies: string[];
  facilityId: string;
  facilityName: string;
  isValid: boolean;
  canCommit: boolean;
  orderId: string;
  auditStatus: 'passed' | 'failed' | 'requires_review';
  allocationStatus: string;
}
