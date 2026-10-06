import { compareGeneralProducts, enforceGeneralIdentityMatches, normalizeGeneralProductName, parseGeneralProducts, runGeneralAuditor, summarizeGeneralProducts, type GeneralAuditSupport } from './generalAuditor';
import { traceGeneralAudit } from './generalAuditDebug';

export interface GeneralAuditInputs {
  whatsappMessage: string;
  fulfillmentConfirmation: string;
}

export function createGeneralAuditRun(inputs: GeneralAuditInputs, revision: number, orderLimitDecisions: Record<string, boolean> = {}, support: GeneralAuditSupport = {}, deferComparison = false) {
  const snapshot = { ...inputs };
  return { inputs: snapshot, revision, orderLimitDecisions: { ...orderLimitDecisions }, support: { osuItems: [...(support.osuItems || [])] }, comparison: deferComparison ? null : runGeneralAuditor(snapshot.whatsappMessage, snapshot.fulfillmentConfirmation, { ...orderLimitDecisions }, { osuItems: [...(support.osuItems || [])] }) };
}

export type GeneralAuditRun = ReturnType<typeof createGeneralAuditRun>;

export function isCurrentGeneralAuditRun(run: GeneralAuditRun, current: GeneralAuditInputs, revision: number, signal: AbortSignal) {
  return !signal.aborted && run.revision === revision &&
    run.inputs.whatsappMessage === current.whatsappMessage &&
    run.inputs.fulfillmentConfirmation === current.fulfillmentConfirmation;
}

// Current backend comparisons include evidence-grounded semantics and authoritative
// deterministic rules. Older responses still use the existing local comparison.
export function completeGeneralAuditRun<T extends Record<string, unknown>>(run: GeneralAuditRun, record: T) {
  const serverResult = record.auditEngine === 'general-deterministic-v1' &&
    record.whatsappMessage === run.inputs.whatsappMessage.trim() &&
    record.fulfillmentConfirmation === run.inputs.fulfillmentConfirmation.trim() &&
    Array.isArray(record.items) && record.generalAudit && record.meta &&
    typeof record.allMatch === 'boolean' && typeof record.issueCount === 'number';
  let comparison: ReturnType<typeof runGeneralAuditor> = serverResult
    ? record as T & ReturnType<typeof runGeneralAuditor>
    : run.comparison || runGeneralAuditor(run.inputs.whatsappMessage, run.inputs.fulfillmentConfirmation, run.orderLimitDecisions, run.support);
  // Apply today's approved aliases at the rendering boundary too. A backend
  // response from an older process can otherwise retain ambiguity plus an extra
  // row even though both current source names already have the same identity.
  const approvedPairs = compareGeneralProducts(run.inputs.whatsappMessage, run.inputs.fulfillmentConfirmation,
    { ...comparison.generalAudit.orderLimitDecisions, ...run.orderLimitDecisions }, run.support)
    .filter(item => item.provenance.some(product => product.source === 'customer_request' && product.canonicalId) &&
      item.provenance.some(product => product.source === 'fulfillment_confirmation' && product.canonicalId));
  if (approvedPairs.length) {
    const keys = new Set(approvedPairs.map(item => item.fulfillment.key));
    const items = comparison.items.filter(item => !keys.has(normalizeGeneralProductName(item.name)) &&
      !item.provenance?.some(product => keys.has(product.normalizedName)));
    items.push(...approvedPairs);
    const reviews = (comparison.generalAudit.semanticReviews || []).filter(review =>
      !parseGeneralProducts(review.originalText, review.source).some(product => keys.has(product.normalizedName)));
    const requestedCount = items.filter(item => item.provenance.some(product => product.source === 'customer_request')).length;
    const foundCount = items.filter(item => item.provenance.some(product => product.source === 'fulfillment_confirmation') &&
      (item.fulfillment.supplied > 0 || item.provenance.some(product => product.source === 'customer_request'))).length;
    comparison = { ...comparison, ...summarizeGeneralProducts(items, comparison.generalAudit.facility,
      comparison.generalAudit.orderer, comparison.generalAudit.phone, requestedCount, foundCount, reviews) };
  }
  // Current-engine responses can still carry contradictory missing/extra rows.
  // Reconcile only colliding identities; retain valid semantic products and all
  // facility/orderer/phone decisions from the authoritative server comparison.
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of comparison.items) {
    const key = normalizeGeneralProductName(item.name);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  if (duplicates.size) {
    const repaired = compareGeneralProducts(run.inputs.whatsappMessage, run.inputs.fulfillmentConfirmation,
      { ...comparison.generalAudit.orderLimitDecisions, ...run.orderLimitDecisions }, run.support)
      .filter(item => duplicates.has(normalizeGeneralProductName(item.name)));
    if ([...duplicates].some(key => !repaired.some(item => normalizeGeneralProductName(item.name) === key))) {
      throw new Error('Unable to reconcile duplicate General Auditor products from the current inputs. Please retry the audit.');
    }
    const emitted = new Set<string>();
    const items = comparison.items.flatMap(item => {
      const key = normalizeGeneralProductName(item.name);
      if (!duplicates.has(key)) return [item];
      if (emitted.has(key)) return [];
      emitted.add(key);
      return repaired.filter(product => normalizeGeneralProductName(product.name) === key);
    });
    const requestedCount = items.filter(item => item.provenance.some(product => product.source === 'customer_request')).length;
    const foundCount = items.filter(item => item.provenance.some(product => product.source === 'fulfillment_confirmation') &&
      (item.fulfillment.supplied > 0 || item.provenance.some(product => product.source === 'customer_request'))).length;
    comparison = { ...comparison, ...summarizeGeneralProducts(items, comparison.generalAudit.facility,
      comparison.generalAudit.orderer, comparison.generalAudit.phone, requestedCount, foundCount, comparison.generalAudit.semanticReviews) };
  }
  comparison = enforceGeneralIdentityMatches(comparison, run.inputs.whatsappMessage, run.inputs.fulfillmentConfirmation);
  // Recalculate from the accepted final comparison, including older server scores.
  const details = comparison.generalAudit;
  comparison = { ...comparison, ...summarizeGeneralProducts(comparison.items, details.facility, details.orderer,
    details.phone, details.productCount.requested, details.productCount.found, details.semanticReviews) };
  const result = { ...record, ...comparison, ...run.inputs };
  traceGeneralAudit('beforeRendering', { generalAuditResult: result });
  return result;
}
