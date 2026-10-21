import { canAuditGeneralWithoutAi, generalInterpretationGaps, interpretGeneralOrder, type GeneralInterpretedAudit } from './generalOrderInterpretation';
import { runGeneralAuditor, extractGeneralInput, enforceGeneralIdentityMatches, preserveGeneralOutOfStockEvidence, preserveGeneralRequestedStockProducts, summarizeGeneralProducts, normalizeGeneralProductName, type GeneralAuditSupport } from './generalAuditor';

export async function runGeneralSemanticAudit(customer: string, fulfilment: string, decisions: Record<string, boolean>, support: GeneralAuditSupport, getClient: () => any) {
  // Always run reference/rule validation before considering optional interpretation.
  let first: ReturnType<typeof runGeneralAuditor> | undefined;
  let extracted: Parameters<typeof canAuditGeneralWithoutAi>[2];
  const requestSupport = { ...support, onExtraction: (customer: any, fulfillment: any) => { extracted = { customer, fulfillment }; } };
  try { first = support.timing ? support.timing.measure('deterministic', () => runGeneralAuditor(customer, fulfilment, decisions, requestSupport)) : runGeneralAuditor(customer, fulfilment, decisions, requestSupport); } catch { /* Unreadable intent may need the bounded fallback. */ }
  if (first && canAuditGeneralWithoutAi(customer, fulfilment, extracted)) return { ...first, auditEngine: 'general-deterministic-v1',
    semanticAnalysis: { status: 'skipped' as const, reason: 'Deterministic reference checks completed; AI unnecessary' } };
  const interpret = () => interpretGeneralOrder(customer, fulfilment, getClient, support.semanticTimeoutMs, { signal: support.signal, cacheScope: support.semanticCacheScope, needsInterpretation: true });
  let interpreted: GeneralInterpretedAudit = await (support.timing ? support.timing.measureAsync('gemini', interpret) : interpret());
  if (interpreted.semanticAnalysis.status === 'used') {
    interpreted.fulfilmentConfirmation = preserveGeneralOutOfStockEvidence(fulfilment, interpreted.fulfilmentConfirmation);
    interpreted.customerRequest = preserveGeneralRequestedStockProducts(customer, fulfilment, interpreted.customerRequest);
    // A structurally valid AI response can still omit an unrelated source line.
    // Keep that line under review rather than approving a partially read order.
    for (const review of generalInterpretationGaps(interpreted.customerRequest, interpreted.fulfilmentConfirmation)) {
      if (review.kind === 'unparsed_text' && !interpreted.reviews.some(existing => existing.source === review.source && existing.originalText === review.originalText)) {
        interpreted.reviews.push(review);
      }
    }
  }
  let result: ReturnType<typeof runGeneralAuditor>;
  try {
    result = interpreted.semanticAnalysis.status !== 'used' && first ? first : runGeneralAuditor(interpreted.customerRequest, interpreted.fulfilmentConfirmation, decisions, { ...support, allowEmptyProductsForReview: interpreted.reviews.length > 0 });
  } catch {
    console.warn('[Audit semantics] deterministic fallback used', { scope: 'general', reason: 'interpreted inputs could not be audited' });
    interpreted = { customerRequest: customer, fulfilmentConfirmation: fulfilment, reviews: [], semanticAnalysis: { status: 'fallback', reason: 'Interpreted inputs rejected by deterministic audit' } };
    interpreted.reviews = generalInterpretationGaps(customer, fulfilment, extracted);
    result = runGeneralAuditor(customer, fulfilment, decisions, { ...support, allowEmptyProductsForReview: true });
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
  if (interpreted.semanticAnalysis.status === 'fallback') {
    // AI availability cannot turn verified products or an entire order into an
    // ambiguous product. Only unresolved source lines receive review entries.
    const existingReviews = result.generalAudit.semanticReviews || [];
    const existingIdentities = new Set(existingReviews.flatMap(review =>
      extractGeneralInput(review.originalText, review.source).products.map(product => product.normalizedName)));
    interpreted.reviews = generalInterpretationGaps(customer, fulfilment, extracted).filter(review => {
      const products = extractGeneralInput(review.originalText, review.source).products;
      return !products.some(product => existingIdentities.has(product.normalizedName));
    });
  }
  const facilityPair = interpreted.semanticAnalysis.interpretation?.facility || interpreted.semanticAnalysis.evidence?.facility;
  const facilityContext = { ...support.facilityContext };
  if (facilityPair?.equivalent && facilityPair.confidence >= 0.95 && facilityPair.customerRequest && facilityPair.fulfilmentConfirmation &&
    facilityPair.customerRequest.confidence >= 0.95 && facilityPair.fulfilmentConfirmation.confidence >= 0.95 &&
    customer.includes(facilityPair.customerRequest.sourceText) && facilityPair.customerRequest.sourceText.includes(facilityPair.customerRequest.value) &&
    fulfilment.includes(facilityPair.fulfilmentConfirmation.sourceText) && facilityPair.fulfilmentConfirmation.sourceText.includes(facilityPair.fulfilmentConfirmation.value)) {
    facilityContext.aiSuggestion = { customer: facilityPair.customerRequest.value, fulfillment: facilityPair.fulfilmentConfirmation.value, confidence: facilityPair.confidence };
  }
  if (interpreted.semanticAnalysis.status === 'used') result = enforceGeneralIdentityMatches(result, customer, fulfilment, facilityContext);
  if (interpreted.reviews.length) {
    // Unresolved intentions cannot establish that a possible supplied candidate
    // is genuinely unrequested. Defer those comparisons for human review.
    const reviews = [...new Map([...(result.generalAudit.semanticReviews || []), ...interpreted.reviews].map(review => [JSON.stringify([review.source, review.originalText.trim()]), review])).values()];
    const candidates = new Set(reviews.flatMap(review => review.possibleMatches).map(normalizeGeneralProductName));
    const items = result.items.filter(item => !(item.status === 'extra item' && candidates.has(item.fulfillment.key)));
    const details = result.generalAudit;
    result = { ...result, ...summarizeGeneralProducts(items, details.facility, details.orderer, details.phone,
      details.productCount.requested, details.productCount.found, reviews, details) };
  }
  return { ...result, auditEngine: 'general-deterministic-v1', semanticAnalysis: interpreted.semanticAnalysis };
}
