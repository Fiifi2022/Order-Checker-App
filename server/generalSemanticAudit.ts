import { sameGeneralEvidenceOrigin } from '../src/utils/generalProductEvidence';
import { bindGeneralExtractionSources } from '../src/utils/generalExtractionSources';
import { matchGeneralClinicalProducts } from '../src/utils/generalProductMatching';
import { attachGeneralAiProductSuggestions } from './generalAiProductSuggestions';
import { resolveGeneralOrdererName } from './generalOrdererFallback';
import { getGeneralMedicalAmbiguity, resolveGeneralApprovedIdentity } from '../src/utils/generalMedicalTerminology';
import { generalEssentialReviewNotices, generalReviewField } from '../src/utils/generalAuditReviews';
import { extractGeneralOrderDeterministically, type StructuredGeneralOrder } from './generalOrderExtraction';
import { resolveGeneralOrderExtraction } from './generalHybridExtraction';
import { canAuditGeneralWithoutAi, generalInterpretationGaps, interpretGeneralOrder, type GeneralInterpretedAudit } from './generalOrderInterpretation';
import { runGeneralAuditor, enforceGeneralProductAssignments, parseGeneralProducts, extractGeneralInput, enforceGeneralIdentityMatches, preserveGeneralOutOfStockEvidence, preserveGeneralRequestedStockProducts, summarizeGeneralProducts, normalizeGeneralProductName, type GeneralAuditSupport } from './generalAuditor';

async function auditGeneralExtractedText(customer: string, fulfilment: string, decisions: Record<string, boolean>, support: GeneralAuditSupport, getClient: () => any, override?: GeneralInterpretedAudit) {
  // Always run reference/rule validation before considering optional interpretation.
  let first: ReturnType<typeof runGeneralAuditor> | undefined;
  let extracted: Parameters<typeof canAuditGeneralWithoutAi>[2];
  const requestSupport = { ...support, onExtraction: (customer: any, fulfillment: any) => { extracted = { customer, fulfillment }; } };
  try { first = support.timing ? support.timing.measure('deterministic', () => runGeneralAuditor(customer, fulfilment, decisions, requestSupport)) : runGeneralAuditor(customer, fulfilment, decisions, requestSupport); } catch { /* Unreadable intent may need the bounded fallback. */ }
  if (!override && first && canAuditGeneralWithoutAi(customer, fulfilment, extracted)) return { ...first, auditEngine: 'general-deterministic-v1',
    semanticAnalysis: { status: 'skipped' as const, reason: 'Deterministic reference checks completed; AI unnecessary' } };
  const interpret = () => interpretGeneralOrder(customer, fulfilment, getClient, support.semanticTimeoutMs, { signal: support.signal, cacheScope: support.semanticCacheScope, needsInterpretation: true });
  let interpreted: GeneralInterpretedAudit = override || await (support.timing ? support.timing.measureAsync('gemini', interpret) : interpret());
  if (interpreted.semanticAnalysis.status === 'used') {
    interpreted.fulfilmentConfirmation = preserveGeneralOutOfStockEvidence(fulfilment, interpreted.fulfilmentConfirmation);
    interpreted.customerRequest = preserveGeneralRequestedStockProducts(customer, fulfilment, interpreted.customerRequest);
    // A formulation suggested by AI or fulfilment is never customer consent.
    // Keep each known missing-form source line unresolved until the CCA acts.
    if (first?.generalAudit.productVerifications?.length) {
      const lines = interpreted.customerRequest.split(/\r?\n/);
      for (const verification of first.generalAudit.productVerifications) {
        for (const product of verification.requestedProducts) {
          // The original document line can differ from the cleaned/AI line.
          // Resolve the consumed source instead of inserting at a card/line index.
          const recognized = parseGeneralProducts(interpreted.customerRequest, 'customer_request').filter(candidate => {
            const bound = support.canonicalProductEvidence?.([candidate], 'customer_request') || [candidate];
            return bound.some(evidence => sameGeneralEvidenceOrigin(evidence, product));
          });
          if (recognized.length) for (const candidate of recognized) lines[candidate.line - 1] = product.originalText;
          else lines.push(product.originalText);
        }
      }
      interpreted.customerRequest = lines.join('\n');
    }
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
  if (interpreted.semanticAnalysis.status === 'fallback' && !override) {
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

function deferUncertainProducts<T extends ReturnType<typeof runGeneralAuditor>>(result: T, customerUncertain: boolean, fulfillmentUncertain: boolean): T {
  const reviews = result.generalAudit.semanticReviews || [];
  const unresolved = new Set(reviews.map(review => JSON.stringify([review.source, review.originalText.trim()])));
  const clinicalStem = (name: string) => normalizeGeneralProductName(name.replace(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|l|iu)\b/gi, '').replace(/[\d/.,]+/g, ' '));
  const clinicalCounterpart = (item: typeof result.items[number]) => ['missing item', 'extra item'].includes(item.status) && result.items.some(other =>
    other.status === (item.status === 'missing item' ? 'extra item' : 'missing item') && clinicalStem(item.name) === clinicalStem(other.name));
  const items = result.items.filter(item => !(!clinicalCounterpart(item) && (customerUncertain && item.status === 'extra item' || fulfillmentUncertain && item.status === 'missing item')) &&
    !item.provenance.some(product => unresolved.has(JSON.stringify([product.source, product.originalText.trim()]))));
  if (items.length === result.items.length) return result;
  const detail = result.generalAudit;
  return { ...result, ...summarizeGeneralProducts(items, detail.facility, detail.orderer, detail.phone,
    detail.productCount.requested, detail.productCount.found, detail.semanticReviews, detail) };
}
function finalStructuredOrder(order: StructuredGeneralOrder, source: 'customer_request' | 'fulfillment_confirmation', result: ReturnType<typeof runGeneralAuditor>): StructuredGeneralOrder {
  const details = result.generalAudit;
  const field = source === 'customer_request' ? 'whatsappValue' : 'fulfillmentValue';
  const sources = details.sourceEntries?.filter(product => product.source === source && !product.sourceReview &&
    (order.products.some(known => matchGeneralClinicalProducts(product.name, known.name, normalizeGeneralProductName).confident &&
      product.quantity === known.quantity && product.unit === (known.unit || '')) ||
      result.items.some(item => item.provenance.some(evidence => evidence.sourceEntryId === product.sourceEntryId))));
  const products = sources?.length ? sources.map(product => ({ name: resolveGeneralApprovedIdentity(product.name)?.canonicalName || product.name, quantity: product.quantity, unit: product.unit })) : order.products;
  const facilityName = details.facility[field] === 'N/A' ? null : details.facility[field];
  const ordererName = details.orderer[field] === 'N/A' ? null : details.orderer[field];
  const unresolvedFields = [!facilityName ? 'facilityName' : '', !ordererName ? 'ordererName' : '',
    !products.length || generalEssentialReviewNotices(details.semanticReviews?.filter(review => review.source === source)).some(notice => notice.field === 'products' || notice.field === 'quantity') ? 'products' : ''].filter(Boolean);
  return { ...order, facilityName, ordererName, products, unresolvedFields, extractionConfidence: unresolvedFields.length ? 0 : 1 };
}

/** General-only preprocessing. Vaccine audits and spreadsheets never enter this path. */
export async function runGeneralSemanticAudit(customer: string, fulfilment: string, decisions: Record<string, boolean>, support: GeneralAuditSupport, getClient: () => any) {
  support = { ...support, canonicalProductEvidence: (products, source) => bindGeneralExtractionSources(products, source === 'customer_request' ? customer : fulfilment, source) };
  let a = extractGeneralOrderDeterministically(customer, 'customer_request', support.facilityContext);
  let b = extractGeneralOrderDeterministically(fulfilment, 'fulfillment_confirmation', support.facilityContext, a.order);
  // Exact, explicit product names on both sides do not require a catalogue
  // substitute. Apply this rule before routing so incidental clinical text cannot
  // make a previously auditable product ambiguous. Quantities remain independent.
  const requested = extractGeneralInput(a.text, 'customer_request').products;
  const supplied = extractGeneralInput(b.text, 'fulfillment_confirmation').products;
  const explicitNames = requested.filter(product => !getGeneralMedicalAmbiguity(product.name) &&
    !/\b(?:need|want|send|give|please|pls|request|instead|replace|change)\b/i.test(product.name) &&
    supplied.some(other => other.normalizedName === product.normalizedName && !getGeneralMedicalAmbiguity(other.name)))
    .map(product => product.name);
  if (explicitNames.length && [a, b].some(input => input.order.unresolvedFields.includes('products'))) {
    a = extractGeneralOrderDeterministically(customer, 'customer_request', support.facilityContext, undefined, explicitNames);
    b = extractGeneralOrderDeterministically(fulfilment, 'fulfillment_confirmation', support.facilityContext, a.order, explicitNames);
  }
  // Retain the established evidence-rich interpreter for existing complex catalogue
  // requests. Newly recognized conversational structures use the field-scoped schema.
  const hybrid = a.changed || b.changed || Boolean(a.missingQuantityProducts?.length || b.missingQuantityProducts?.length) || /^(?:quantity|qty|amount)\s*[:=]/im.test(`${customer}\n${fulfilment}`) ||
    [...a.unresolvedText, ...b.unresolvedText].some(line => /^[A-Z]{2,6}\s*[-:=]\s*\d/.test(line)) || !a.order.facilityName || !a.order.ordererName || !b.order.facilityName || !b.order.ordererName;
  if (!hybrid) {
    const audited = await auditGeneralExtractedText(customer, fulfilment, decisions, support, getClient);
    const reviews = audited.generalAudit.semanticReviews || [];
    let result = deferUncertainProducts(audited, reviews.some(review => review.source === 'customer_request' && !review.dosageFormKey && !['ordererName', 'facilityName'].includes(generalReviewField(review))), reviews.some(review => review.source === 'fulfillment_confirmation' && !review.dosageFormKey && !['ordererName', 'facilityName'].includes(generalReviewField(review))));
    result = await resolveGeneralOrdererName(result, support, getClient);
    result = enforceGeneralProductAssignments(result, customer, fulfilment, support);
    return { ...attachGeneralAiProductSuggestions(result, customer, fulfilment), extractedOrder: finalStructuredOrder(a.order, 'customer_request', result), fulfilledOrder: finalStructuredOrder(b.order, 'fulfillment_confirmation', result) };
  }
  const extraction = await resolveGeneralOrderExtraction(a, b, getClient, support);
  // Unreadable text is review evidence, never a fabricated product comparison.
  const auditable = (input: typeof a) => input.text.split('\n').map(line => input.unresolvedText.includes(line) ? '' : line).join('\n');
  const customerText = auditable(extraction.customer), fulfillmentText = auditable(extraction.fulfillment);
  let result = await auditGeneralExtractedText(customerText, fulfillmentText, decisions, { ...support, allowEmptyProductsForReview: true }, getClient, {
    customerRequest: customerText, fulfilmentConfirmation: fulfillmentText, reviews: extraction.reviews, semanticAnalysis: extraction.semanticAnalysis,
  });
  // An uncertain opposite side cannot prove that a product was omitted or added.
  // Independently established quantity conflicts continue to be discrepancies.
  const customerUncertain = extraction.customer.order.unresolvedFields.includes('products');
  const fulfillmentUncertain = extraction.fulfillment.order.unresolvedFields.includes('products');
  result = deferUncertainProducts(result, customerUncertain, fulfillmentUncertain);
  result = await resolveGeneralOrdererName(result, support, getClient);
  result = enforceGeneralProductAssignments(result, customer, fulfilment, support);
  return { ...attachGeneralAiProductSuggestions(result, customer, fulfilment), extractedOrder: finalStructuredOrder(extraction.customer.order, 'customer_request', result), fulfilledOrder: finalStructuredOrder(extraction.fulfillment.order, 'fulfillment_confirmation', result) };
}
