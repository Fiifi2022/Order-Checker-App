import { generalFacilityNamesMatch } from './generalFacility';
import type { GeneralAuditDetails, GeneralSemanticReview } from './generalAuditTypes';
import { classifyGeneralText, generalOrderRelevantText } from './generalTextClassification';

export type GeneralEssentialField = 'ordererName' | 'facilityName' | 'products' | 'quantity';
export interface GeneralEssentialNotice { field: GeneralEssentialField; message: string }
/** The same four field decisions drive the website and extension. */
export function generalFourParameterStatuses(details: GeneralAuditDetails) {
  if (!details.facility || !details.orderer || !details.productCount || !Array.isArray(details.products)) {
    return {facility: details.facility?.status || 'review required' as const, orderer: details.orderer?.status || 'review required' as const,
      products: 'review required' as const, quantities: 'review required' as const};
  }
  const notices = generalAuditClarifications(details);
  const identity = (status: GeneralAuditDetails['orderer']['status']) => ['match', 'mismatch'].includes(status) ? status : 'review required' as const;
  const products = !details.productCount.requested || !details.productCount.found ? 'review required' as const
    : details.products.some(product => product.fulfillmentStatus === 'discrepancy' && product.discrepancyKind !== 'quantity')
      ? details.decision === 'review' ? 'review required' as const : 'mismatch' as const
      : details.productVerifications?.some(product => product.status !== 'customer verified') || notices.some(notice => notice.field === 'products') ? 'review required' as const : 'match' as const;
  const quantities = details.products.some(product => product.discrepancyKind === 'quantity' && product.fulfillmentStatus === 'discrepancy' &&
    !product.requestedQuantityMissing && !product.suppliedQuantityMissing && !product.quantityReviewRequired) ? 'mismatch' as const
    : details.pendingOrderLimitCount || products !== 'match' || notices.some(notice => notice.field === 'quantity') ||
      details.products.some(product => product.quantityReviewRequired || product.requestedQuantityMissing || product.suppliedQuantityMissing) ? 'review required' as const : 'match' as const;
  return {facility: identity(details.facility.status), orderer: identity(details.orderer.status), products, quantities};
}

/** Explicit metadata labels take priority over a generic extraction category. */
export function generalReviewField(review: GeneralSemanticReview): GeneralEssentialField {
  const text = generalOrderRelevantText(review.originalText).trim();
  const amendment = classifyGeneralText(text).orderChange;
  if (!text.includes('\n')) {
    if (/^(?:name of orderer|orderer name|orderer|ordered by|requested by|requester|customer name|sender|recipient|fulfilment recipient|fulfillment recipient|customer|authorized contact|name)\s*[:;=]/i.test(text)) return 'ordererName';
    if (/^(?:name of health facility|health facility|facility name|name of facility|facility|hospital|clinic|destination|delivery facility|delivery site|deliver to|order for)\s*[:;=]/i.test(text)) return 'facilityName';
  }
  return review.field || (/^(?:quantity|qty|amount)\b/i.test(text) || /(?:quantity (?:was not specified|is missing|cannot be read)|missing (?:requested )?quantity)/i.test(review.reason) ? 'quantity'
    : review.kind === 'product' ? 'products'
    : amendment && /\b(?:orderer|recipient)\b/i.test(text) ? 'ordererName'
    : amendment && /\b(?:facility|hospital|clinic|chps|destination|district|drop area)\b/i.test(text) ? 'facilityName'
    : amendment && /\b(?:quantity|qty|amount)\b/i.test(text) ? 'quantity' : 'products');
}

/** Source evidence for the specific warning; never infer it from matched products. */
export function generalReviewEvidence(reviews: GeneralSemanticReview[] = [], field: GeneralEssentialField): GeneralSemanticReview[] {
  const seen = new Set<string>();
  return reviews.flatMap(review => {
    const originalText = generalOrderRelevantText(review.originalText).trim();
    if (!originalText || generalReviewField({ ...review, originalText }) !== field) return [];
    const key = JSON.stringify([review.source, originalText]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...review, originalText }];
  });
}

/** Older extraction responses may repeat a generic warning as their reason. */
export function generalReviewExplanation(review: GeneralSemanticReview): string {
  const reason = review.reason?.trim();
  if (reason && !/^(?:Products?(?: and quantities)?|Quantity|Orderer|Facility): Confirm\b/i.test(reason)) return reason;
  switch (generalReviewField(review)) {
    case 'ordererName': return 'This name could not be confidently verified. Confirm the person placing the order.';
    case 'facilityName': return 'This facility could not be confidently verified. Confirm the requesting health facility.';
    case 'quantity': return 'The quantity is missing or unclear. Confirm the quantity for this line.';
    default: return 'This line could not be confidently interpreted. Confirm the product name and quantity before dispatch.';
  }
}

/** Keep source evidence internally, but display each uncertain essential field once. */
export function generalEssentialReviewNotices(reviews: GeneralSemanticReview[] = []): GeneralEssentialNotice[] {
  const fields = new Set<GeneralEssentialField>();
  for (const review of reviews) {
    if (generalOrderRelevantText(review.originalText).trim()) fields.add(generalReviewField(review));
  }
  const notices: GeneralEssentialNotice[] = [];
  if (fields.has('ordererName')) notices.push({ field: 'ordererName', message: 'Orderer: Confirm the name of the person placing the order.' });
  if (fields.has('facilityName')) notices.push({ field: 'facilityName', message: 'Facility: Confirm the requesting health facility.' });
  if (fields.has('products')) notices.push({ field: 'products', message: fields.has('quantity') ? 'Products and quantities: Confirm the requested products and quantities.' : 'Product: Confirm the requested product.' });
  else if (fields.has('quantity')) notices.push({ field: 'quantity', message: 'Quantity: Confirm the requested quantity.' });
  return notices;
}

/** One clarification per essential field, shared by audit output and rendering. */
export function generalAuditClarifications(details: Pick<GeneralAuditDetails, 'facility' | 'orderer' | 'productCount' | 'semanticReviews'>): GeneralEssentialNotice[] {
  const notices = generalEssentialReviewNotices(details.semanticReviews);
  const add = (field: GeneralEssentialField, message: string) => {
    if (!notices.some(notice => notice.field === field)) notices.push({ field, message });
  };
  if (!['match', 'mismatch'].includes(details.orderer.status)) add('ordererName', 'Orderer: Confirm the name of the person placing the order.');
  // Duplicate directory identities are internal. Only an absent or ambiguous
  // source name needs clarification; a matching display name does not.
  if (['missing from customer request', 'not available in system entry'].includes(details.facility.status) ||
      details.facility.status === 'review required' && !generalFacilityNamesMatch(details.facility.whatsappValue, details.facility.fulfillmentValue)) {
    add('facilityName', 'Facility: Confirm the requesting health facility.');
  }
  if ((!details.productCount.requested || !details.productCount.found) && !notices.some(notice => notice.field === 'products' || notice.field === 'quantity')) {
    add('products', 'Products and quantities: Confirm the requested products and quantities.');
  }
  return notices;
}
