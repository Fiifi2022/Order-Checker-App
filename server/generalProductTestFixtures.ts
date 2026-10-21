// Product-only regression fixtures provide the now-mandatory identities. Tests
// of missing/mismatched identity fields continue using the real auditor directly.
import { extractGeneralInput, runGeneralAuditor } from './generalAuditor';
import { createGeneralAuditRun } from '../src/utils/generalAuditRun';
export function withRequiredGeneralHeaders(text: string, reference = '') {
  const identity = extractGeneralInput(text, 'customer_request');
  const other = extractGeneralInput(reference, 'customer_request');
  return text + (identity.ordererName === 'N/A' ? `\nOrderer: ${other.ordererName === 'N/A' ? 'Test Operator' : other.ordererName}` : '') +
    (identity.facilityName === 'N/A' ? `\nFacility: ${other.facilityName === 'N/A' ? 'Test Health Centre' : other.facilityName}` : '');
}
export function runGeneralProductFixture(...args: Parameters<typeof runGeneralAuditor>) {
  return runGeneralAuditor(withRequiredGeneralHeaders(args[0], args[1]), withRequiredGeneralHeaders(args[1], args[0]), args[2], args[3]);
}
export function createGeneralProductRun(...args: Parameters<typeof createGeneralAuditRun>) {
  return createGeneralAuditRun({ whatsappMessage: withRequiredGeneralHeaders(args[0].whatsappMessage, args[0].fulfillmentConfirmation), fulfillmentConfirmation: withRequiredGeneralHeaders(args[0].fulfillmentConfirmation, args[0].whatsappMessage) }, ...args.slice(1) as [number, ...any[]]);
}
