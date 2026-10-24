import { canonicalGeneralSource, generalInputFingerprint, sameGeneralAuditSources, type GeneralAuditSources } from '../../shared/generalAuditFingerprint';
import { applyGeneralProductConfirmation, applyGeneralOrderLimitDecision, type runGeneralAuditor } from './generalAuditor';

/** Replay only previously explicit customer decisions against unchanged sources. */
export function restoreGeneralProductConfirmations<T extends ReturnType<typeof runGeneralAuditor> & GeneralAuditSources>(fresh: T, saved: T | null | undefined): T {
  if (!saved) return fresh;
  const inputFingerprint = generalInputFingerprint(fresh);
  let result = { ...fresh, inputFingerprint };
  for (const verified of saved.generalAudit.productVerifications || []) {
    const confirmation = verified.confirmation;
    if (!confirmation) continue;
    // Bind to this product's original request and fulfilment evidence, independent
    // of line positions and other products in the order.
    const signature = (product: typeof verified) => JSON.stringify([product.productName,
      ...[product.requestedProducts, product.fulfillmentProducts].map(sources => sources.map(source =>
        [canonicalGeneralSource(source.originalText), source.quantity, source.unit]).sort())]);
    const candidates = result.generalAudit.productVerifications?.filter(product => product.status !== 'customer verified' && signature(product) === signature(verified));
    const target = candidates?.length === 1 ? candidates[0] : undefined;
    if (!target) continue;
    try {
      result = applyGeneralProductConfirmation(result, target.key, confirmation.productKey, true, confirmation.confirmedBy, confirmation.confirmedAt);
      const restored = result.generalAudit.productVerifications?.find(product => product.key === target.key);
      if (restored && verified.confirmationHistory) restored.confirmationHistory = verified.confirmationHistory;
    } catch { /* A removed catalogue formulation requires fresh clarification. */ }
  }
  for (const [key, answer] of Object.entries((sameGeneralAuditSources(fresh, saved) ? saved.generalAudit.orderLimitDecisions : {}) || {})) {
    result = applyGeneralOrderLimitDecision(result, key, answer);
  }
  return { ...result, finalVerdict: result.generalAudit.finalStatus, generalCounts: result.generalAudit.counts,
    resolutionNotes: result.allMatch ? result.generalAudit.finalStatus : '', resolvedAt: result.allMatch ? new Date().toISOString() : null } as T;
}
