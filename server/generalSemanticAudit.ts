import { interpretGeneralOrder, type GeneralInterpretedAudit } from './generalOrderInterpretation';
import { runGeneralAuditor, extractGeneralInput, enforceGeneralIdentityMatches, preserveGeneralOutOfStockEvidence, preserveGeneralRequestedStockProducts, summarizeGeneralProducts, normalizeGeneralProductName, type GeneralAuditSupport } from './generalAuditor';

export async function runGeneralSemanticAudit(customer: string, fulfilment: string, decisions: Record<string, boolean>, support: GeneralAuditSupport, getClient: () => any) {
  let interpreted: GeneralInterpretedAudit = await interpretGeneralOrder(customer, fulfilment, getClient);
  if (interpreted.semanticAnalysis.status === 'used') {
    interpreted.fulfilmentConfirmation = preserveGeneralOutOfStockEvidence(fulfilment, interpreted.fulfilmentConfirmation);
    interpreted.customerRequest = preserveGeneralRequestedStockProducts(customer, fulfilment, interpreted.customerRequest);
  }
  let result: ReturnType<typeof runGeneralAuditor>;
  try {
    result = runGeneralAuditor(interpreted.customerRequest, interpreted.fulfilmentConfirmation, decisions, { ...support, allowEmptyProductsForReview: interpreted.reviews.length > 0 });
  } catch {
    console.warn('[Audit semantics] deterministic fallback used', { scope: 'general', reason: 'interpreted inputs could not be audited' });
    interpreted = { customerRequest: customer, fulfilmentConfirmation: fulfilment, reviews: [], semanticAnalysis: { status: 'fallback', reason: 'Interpreted inputs rejected by deterministic audit' } };
    result = runGeneralAuditor(customer, fulfilment, decisions, support);
  }
  // Keep original identity evidence visible when a supported name variation was normalized.
  if (interpreted.semanticAnalysis.status === 'used') {
    const originalCustomer = extractGeneralInput(customer, 'customer_request');
    const originalSystem = extractGeneralInput(fulfilment, 'fulfillment_confirmation', originalCustomer.ordererName, originalCustomer.facilityName);
    for (const [field, key] of [['orderer', 'ordererName'], ['facility', 'facilityName']] as const) {
      const detail = result.generalAudit[field];
      if (originalCustomer[key] !== 'N/A') detail.whatsappValue = originalCustomer[key];
      if (originalSystem[key] !== 'N/A') detail.fulfillmentValue = originalSystem[key];
      result.meta[key] = detail;
      if (field === 'orderer') result.meta.customerName = detail; else result.meta.facility = detail;
    }
  }
  result = enforceGeneralIdentityMatches(result, customer, fulfilment);
  if (interpreted.reviews.length) {
    // Unresolved intentions cannot establish that a possible supplied candidate
    // is genuinely unrequested. Defer those comparisons for human review.
    const reviews = [...(result.generalAudit.semanticReviews || []), ...interpreted.reviews];
    const candidates = new Set(reviews.flatMap(review => review.possibleMatches).map(normalizeGeneralProductName));
    const items = result.items.filter(item => !(item.status === 'extra item' && candidates.has(item.fulfillment.key)));
    const details = result.generalAudit;
    result = { ...result, ...summarizeGeneralProducts(items, details.facility, details.orderer, details.phone,
      details.productCount.requested, details.productCount.found, reviews) };
  }
  return { ...result, auditEngine: 'general-deterministic-v1', semanticAnalysis: interpreted.semanticAnalysis };
}
