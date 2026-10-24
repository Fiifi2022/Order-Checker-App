import { generalAliasCatalog } from '../shared/generalProductAliases';
import { generalAiCandidateEligible } from '../src/utils/generalAiProductSuggestion';
import { normalizeGeneralProductName, parseGeneralProducts, summarizeGeneralProducts, type runGeneralAuditor } from './generalAuditor';
import type { GeneralProductVerification } from '../src/utils/generalAuditTypes';

/** Only Gemini candidates already validated against the live catalogue become controls. */
export function attachGeneralAiProductSuggestions<T extends ReturnType<typeof runGeneralAuditor>>(result: T, customer: string, fulfillment: string): T {
  const semantic = (result as any).semanticAnalysis;
  if (semantic?.status !== 'used') return result;
  const details = result.generalAudit;
  const verifications = [...(details.productVerifications || [])];
  const supplied = parseGeneralProducts(fulfillment, 'fulfillment_confirmation');
  const requested = parseGeneralProducts(customer, 'customer_request');
  let reviews = [...(details.semanticReviews || [])];
  let items = result.items;
  let changed = false;
  for (const review of reviews) {
    if (review.source !== 'customer_request' || !review.possibleMatches?.length || review.dosageFormKey) continue;
    const sources = requested.filter(source => source.originalText.trim() === review.originalText.trim());
    if (sources.length !== 1 || sources[0].quantityReview || sources[0].quantity <= 0) continue;
    const source = sources[0];
    if (verifications.some(product => product.requestedProducts.some(existing => existing.originalText === source.originalText))) continue;
    const options = [...new Set(review.possibleMatches)].flatMap(name => {
      const canonical = generalAliasCatalog().filter(product => product.name === name);
      if (canonical.length !== 1 || !generalAiCandidateEligible(source.name, name, normalizeGeneralProductName)) return [];
      return [{ key: normalizeGeneralProductName(name), name, catalogProductId: canonical[0].id, fromFulfillment: supplied.some(product => product.normalizedName === normalizeGeneralProductName(name)), reason: review.reason }];
    });
    if (!options.length) continue;
    const candidates = supplied.filter(product => options.some(option => option.key === product.normalizedName));
    // A supplied row already established for another requested product is not available.
    if (candidates.some(candidate => verifications.some(product => product.fulfillmentProducts.some(existing => existing.originalText === candidate.originalText && existing.source === candidate.source)))) continue;
    if (candidates.some(candidate => items.some(item => item.provenance.some(p => p.source === 'customer_request' && p.originalText !== source.originalText) && item.provenance.some(p => p.source === candidate.source && p.originalText === candidate.originalText)))) continue;
    const key = JSON.stringify([source.source, source.line, source.originalText, 'ai suggestion']);
    const product: GeneralProductVerification = { key, kind: 'ai product match', productName: source.name, originalText: source.originalText,
      reason: review.reason, requestedQuantity: source.quantity, suppliedQuantity: candidates.reduce((sum, row) => sum + row.quantity, 0), suggestedProduct: options.find(option => option.fromFulfillment)?.name || options[0].name,
      options, status: 'customer confirmation required', requestedProducts: [source], fulfillmentProducts: candidates };
    verifications.push(product);
    reviews = reviews.map(existing => existing === review ? { ...existing, dosageFormKey: key } : existing);
    items = items.filter(item => !item.provenance.some(p => p.source === source.source && p.originalText === source.originalText || candidates.some(candidate => p.source === candidate.source && p.originalText === candidate.originalText)));
    changed = true;
  }
  if (!changed) return result;
  return { ...result, ...summarizeGeneralProducts(items, details.facility, details.orderer, details.phone, details.productCount.requested, details.productCount.found, reviews, { ...details, productVerifications: verifications }) };
}
