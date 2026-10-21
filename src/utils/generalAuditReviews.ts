import type { GeneralSemanticReview } from './generalAuditTypes';
import { classifyGeneralText, generalOrderRelevantText } from './generalTextClassification';

export type GeneralEssentialField = 'ordererName' | 'facilityName' | 'products' | 'quantity';
export interface GeneralEssentialNotice { field: GeneralEssentialField; message: string }

/** Keep source evidence internally, but display each uncertain essential field once. */
export function generalEssentialReviewNotices(reviews: GeneralSemanticReview[] = []): GeneralEssentialNotice[] {
  const fields = new Set<GeneralEssentialField>();
  for (const review of reviews) {
    const text = generalOrderRelevantText(review.originalText).trim();
    if (!text) continue;
    const amendment = classifyGeneralText(text).orderChange;
    const field = review.field || (/^(?:quantity|qty|amount)\b/i.test(text) || /(?:quantity (?:was not specified|is missing|cannot be read)|missing (?:requested )?quantity)/i.test(review.reason) ? 'quantity'
      : review.kind === 'product' ? 'products'
      : /^(?:name of orderer|orderer|ordered by|requested by|recipient)\s*[:;=]/i.test(text) || amendment && /\b(?:orderer|recipient)\b/i.test(text) ? 'ordererName'
      : /^(?:name of health facility|health facility|facility|hospital)\s*[:;=]/i.test(text) || amendment && /\b(?:facility|hospital|clinic|chps|destination|district|drop area)\b/i.test(text) ? 'facilityName'
      : amendment && /\b(?:quantity|qty|amount)\b/i.test(text) ? 'quantity' : 'products');
    fields.add(field);
  }
  const notices: GeneralEssentialNotice[] = [];
  if (fields.has('ordererName')) notices.push({ field: 'ordererName', message: 'Orderer: Confirm the name of the person placing the order.' });
  if (fields.has('facilityName')) notices.push({ field: 'facilityName', message: 'Facility: Confirm the requesting health facility.' });
  if (fields.has('products')) notices.push({ field: 'products', message: fields.has('quantity') ? 'Products and quantities: Confirm the requested products and quantities.' : 'Product: Confirm the requested product.' });
  else if (fields.has('quantity')) notices.push({ field: 'quantity', message: 'Quantity: Confirm the requested quantity.' });
  return notices;
}
