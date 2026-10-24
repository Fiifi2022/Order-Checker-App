import { generalInventoryRows } from './generalInventoryRows';
import { generalProductHeading } from './generalProductHeading';
import type { GeneralComparisonItem, GeneralProductEvidence } from './generalAuditor';
import type { GeneralAuditDetails, GeneralSemanticReview } from './generalAuditTypes';

type Row = ReturnType<typeof generalInventoryRows>[number];
export type GeneralProductStatus = 'MATCH' | 'VERIFIED' | 'MISSING PRODUCT' | 'EXTRA PRODUCT' | 'ORDER LIMIT REVIEW' | 'SHORTFALL' | 'QUANTITY EXCESS' | 'PRODUCT DETAILS MISMATCH' | 'REVIEW REQUIRED';
const names = (sources: GeneralProductEvidence[]) => [...new Set(sources.map(source => source.name))].join('; ');
const relevant = (review: GeneralSemanticReview, sources: GeneralProductEvidence[], key: string) => review.dosageFormKey === key || sources.some(source => source.source === review.source && source.originalText.trim() === review.originalText.trim());
const productReview = (review: GeneralSemanticReview) => !['ordererName', 'facilityName', 'district', 'deliveryArea', 'dropArea'].includes(review.field || 'products');

/** A single presentation decision shared by the app, extension and audit banner.
 * Saved evidence and matching decisions remain authoritative; labels never grant clearance.
 */
export function generalProductResult(row: Row, details: GeneralAuditDetails) {
  const { product, items } = row;
  const requested = product?.requestedProducts || items.flatMap(item => item.provenance.filter(source => source.source === 'customer_request'));
  const fulfilled = product?.fulfillmentProducts || items.flatMap(item => item.provenance.filter(source => source.source === 'fulfillment_confirmation'));
  const quantity = items.find(item => item.provenance.some(source => source.source === 'customer_request'))?.fulfillment || items[0]?.fulfillment;
  const requestedQuantity = requested.length ? product?.requestedQuantity ?? quantity?.requested ?? 0 : 0;
  const suppliedQuantity = product?.suppliedQuantity ?? quantity?.supplied ?? 0;
  const name = generalProductHeading(product?.productName || items[0]?.name || requested[0]?.name || fulfilled[0]?.name || 'Product review');
  const reviews = (details.semanticReviews || []).filter(productReview);
  const ownReviews = reviews.filter(review => relevant(review, [...requested, ...fulfilled], row.key));
  const evidence = details.sourceEntries || [];
  const fulfillmentReadable = evidence.some(source => source.source === 'fulfillment_confirmation') || details.products.some(source => source.fulfillmentStatus !== 'discrepancy' || source.discrepancyKind !== 'missing') || fulfilled.length > 0;
  const uncertainFulfillment = reviews.some(review => review.source === 'fulfillment_confirmation' && !review.dosageFormKey) || evidence.some(source => source.source === 'fulfillment_confirmation' && (source.quantityReview || source.sourceReview));
  const unit = quantity?.requestedUnit || requested[0]?.unit || 'units';
  const difference = quantity?.difference ?? Math.abs(requestedQuantity - suppliedQuantity);
  const base = { ...row, name, requested, fulfilled, quantity, requestedQuantity, suppliedQuantity, difference, unit,
    customer: product?.productName || names(requested) || 'Not requested', fulfillment: names(fulfilled) || 'Not found' };
  const result = (status: GeneralProductStatus, reason?: string) => ({ ...base, status, reason, tone: status === 'MATCH' || status === 'VERIFIED' ? 'matched' as const : status === 'ORDER LIMIT REVIEW' || status === 'REVIEW REQUIRED' ? 'pending' as const : 'discrepancy' as const });
  if (requested.some(source => source.sourceReview || source.quantityReview) || fulfilled.some(source => source.sourceReview || source.quantityReview))
    return result('REVIEW REQUIRED', 'The product or quantity could not be read reliably. Check the original order entry before dispatch.');
  if (product && !product.confirmation) {
    const left = requested[0]?.clinicalAttributes, right = fulfilled[0]?.clinicalAttributes;
    const conflict = left && right && left.ingredient === right.ingredient &&
      (['measurements', 'forms', 'routes', 'releases', 'qualifiers'] as const).find(field => left[field].length && right[field].length && JSON.stringify(left[field]) !== JSON.stringify(right[field]));
    if (conflict) return result('PRODUCT DETAILS MISMATCH', `Customer: ${base.customer}. Fulfilment: ${base.fulfillment}. The recorded ${conflict === 'measurements' ? 'strength, concentration or package size' : conflict === 'forms' ? 'product forms' : conflict === 'releases' ? 'release types' : conflict} differ; verify the exact product before dispatch.${suppliedQuantity !== requestedQuantity ? ` Quantities also differ: ${requestedQuantity} requested, ${suppliedQuantity} fulfilled.` : ''}`);
    return result('REVIEW REQUIRED', `The requested product cannot yet be verified against ${fulfilled.length ? base.fulfillment : 'the fulfilment entry'}. Check the original product details before dispatch.${suppliedQuantity !== requestedQuantity ? ` Quantities also differ: ${requestedQuantity} requested, ${suppliedQuantity} fulfilled.` : ''}`);
  }
  if (product?.reviewState === 'product discrepancy') return result('PRODUCT DETAILS MISMATCH', `The saved customer-confirmed product (${product.confirmation?.productName || base.customer}) differs from ${base.fulfillment} in Fulfilment Confirmation.`);
  if (ownReviews.length) return result('REVIEW REQUIRED', 'The product entry contains unresolved information. Verify the original product and quantity before dispatch.');
  if (items.some(item => item.status === 'missing item')) {
    if (!fulfillmentReadable || uncertainFulfillment) return result('REVIEW REQUIRED', `The Fulfilment Confirmation is incomplete or contains unreadable product information. Verify it before deciding whether ${name} is missing.`);
    return result('MISSING PRODUCT', `The customer requested ${requestedQuantity} ${unit} of ${name}, but the product was not found in the Fulfilment Confirmation.`);
  }
  if (items.some(item => item.status === 'extra item')) {
    if (reviews.some(review => review.source === 'customer_request' && !review.dosageFormKey)) return result('REVIEW REQUIRED', 'The Customer Request contains unreadable product information. Verify it before classifying this product as extra.');
    return result('EXTRA PRODUCT', `${suppliedQuantity} ${quantity?.suppliedUnit || fulfilled[0]?.unit || 'units'} of ${name} appear in Fulfilment Confirmation without a corresponding customer request.`);
  }
  if (items.some(item => item.status === 'vaccine pairing mismatch')) return result('PRODUCT DETAILS MISMATCH', 'The supplied vaccine and its required companion quantities do not satisfy the pairing rules. Check both entries.');
  if (quantity?.fulfillmentStatus === 'out of stock') return result('SHORTFALL', `${name} is recorded as out of stock: ${requestedQuantity} ${unit} requested and 0 fulfilled. The product was identified; it is unavailable.`);
  if (quantity?.fulfillmentStatus === 'order limit applied' && quantity.orderLimitDecision === true) return result('VERIFIED', `Approved order limit recorded: ${requestedQuantity} ${unit} requested, ${suppliedQuantity} fulfilled; difference ${difference} ${quantity.conversion?.unit || unit}.`);
  if (quantity?.orderLimitEligible && quantity.orderLimitDecision === undefined) return result('ORDER LIMIT REVIEW', `${requestedQuantity} ${unit} requested; ${suppliedQuantity} ${quantity.suppliedUnit || unit} fulfilled. Shortfall: ${difference} ${quantity.conversion?.unit || unit}. Verify whether an approved order limit applies.`);
  if (quantity?.fulfillmentStatus === 'discrepancy' || items.some(item => item.status === 'quantity mismatch')) {
    if (quantity?.requestedUnit && quantity.suppliedUnit && quantity.requestedUnit !== quantity.suppliedUnit && !quantity.conversion)
      return result('REVIEW REQUIRED', `Quantities use different units: ${requestedQuantity} ${quantity.requestedUnit} requested and ${suppliedQuantity} ${quantity.suppliedUnit} fulfilled. No verified packaging conversion is available.`);
    return (quantity?.conversion?.supplied ?? suppliedQuantity) > (quantity?.conversion?.requested ?? requestedQuantity) ? result('QUANTITY EXCESS', `${requestedQuantity} ${unit} requested; ${suppliedQuantity} ${quantity?.suppliedUnit || unit} fulfilled. Excess: ${difference} ${quantity?.conversion?.unit || unit}.`) :
      result('SHORTFALL', `${requestedQuantity} ${unit} requested; ${suppliedQuantity} ${quantity?.suppliedUnit || unit} fulfilled. Shortfall: ${difference} ${quantity?.conversion?.unit || unit}.${quantity?.orderLimitDecision === false ? ' No order limit was applied.' : ''}`);
  }
  if (!items.length || !requested.length || !fulfilled.length) return result('REVIEW REQUIRED', 'There is insufficient product evidence to verify this entry. Check both source documents.');
  return result('MATCH');
}
export function generalProductResults(items: GeneralComparisonItem[], details: GeneralAuditDetails) {
  const results = generalInventoryRows(items, details).map(row => generalProductResult(row, details));
  const paired = new Map<string, typeof results[number]>();
  const consumed = new Set<string>();
  // A unique clinically conflicting counterpart explains a single underlying
  // product-details issue. It is never approved as an equivalent medicine.
  const conflict = (a: typeof results[number], b: typeof results[number]) => {
    const left = a.requested[0]?.clinicalAttributes, right = b.fulfilled[0]?.clinicalAttributes;
    return left && right && left.ingredient && left.ingredient === right.ingredient &&
      (['measurements', 'forms', 'routes', 'releases', 'qualifiers'] as const).some(field => left[field].length && right[field].length && JSON.stringify(left[field]) !== JSON.stringify(right[field]));
  };
  for (const missing of results.filter(row => row.status === 'MISSING PRODUCT')) {
    const candidates = results.filter(row => row.status === 'EXTRA PRODUCT' && conflict(missing, row));
    if (candidates.length !== 1 || results.filter(row => row.status === 'MISSING PRODUCT' && conflict(row, candidates[0])).length !== 1) continue;
    const extra = candidates[0]; consumed.add(extra.key);
    paired.set(missing.key, { ...missing, items: [...missing.items, ...extra.items], fulfilled: extra.fulfilled, fulfillment: extra.fulfillment,
      suppliedQuantity: extra.suppliedQuantity, difference: Math.abs(missing.requestedQuantity - extra.suppliedQuantity), status: 'PRODUCT DETAILS MISMATCH',
      reason: `Customer: ${missing.customer}. Fulfilment: ${extra.fulfillment}. The recorded product details differ; these products cannot be treated as equivalent.${missing.requestedQuantity !== extra.suppliedQuantity ? ` Quantities also differ: ${missing.requestedQuantity} requested, ${extra.suppliedQuantity} fulfilled.` : ''}`, tone: 'discrepancy' });
  }
  return results.filter(row => !consumed.has(row.key)).map(row => paired.get(row.key) || row);
}

export function generalAuditResult(items: GeneralComparisonItem[], details: GeneralAuditDetails, allMatch: boolean) {
  const products = generalProductResults(items, details);
  const failed = products.filter(product => product.tone === 'discrepancy');
  const pending = products.filter(product => product.tone === 'pending');
  if (failed.length || [details.facility, details.orderer, details.dropArea, details.district].some(field => field?.status === 'mismatch')) return { title: 'DISCREPANCY DETECTED', message: `${failed.length ? `${failed.length} product${failed.length === 1 ? '' : 's'} ${failed.length === 1 ? 'requires' : 'require'} correction. See the relevant product cards.` : 'Required order identity or location details differ.'}`, tone: 'discrepancy' };
  if (pending.length && pending.every(product => product.status === 'ORDER LIMIT REVIEW')) return { title: 'QUANTITY VERIFICATION REQUIRED', message: `${pending.length === 1 ? 'One product has' : `${pending.length} products have`} a quantity difference requiring review.`, tone: 'pending' };
  if (!products.length || !details.productCount.requested || !details.productCount.found || pending.length || !allMatch || details.auditSummary?.reviewRequiredCount || details.auditSummary?.missingRequiredCount) return { title: 'REVIEW REQUIRED', message: 'Complete the outstanding product or order checks before dispatch.', tone: 'pending' };
  return { title: 'AUDIT PASSED', message: 'All required product and quantity checks passed.', tone: 'matched' };
}
