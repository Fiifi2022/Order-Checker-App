import {generalFacilityDisplayStatus} from './generalFacility';
import type {GeneralAuditDetails, GeneralFieldResult} from './generalAuditTypes';
import {generalFourParameterStatuses, generalReviewExplanation} from './generalAuditReviews';
import {generalProductFindingText} from '../../shared/generalProductFinding';

/** Display existing findings only; never change the audit decision or its severity. */
export function generalFieldFindingLabel(label: string, field: Pick<GeneralFieldResult, 'status' | 'reason'>): string {
  if (field.status === 'missing from customer request') return `${label} missing from customer request`;
  if (field.status === 'not available in system entry') return `${label} missing from fulfilment`;
  if (field.status === 'mismatch') return `${label} mismatch`;
  return field.reason?.trim() || `${label} could not be verified`;
}

export function generalAuditFindingLabel(details: GeneralAuditDetails): string {
  return generalProductFindingText(auditFindingLabel(details));
}
function auditFindingLabel(details: GeneralAuditDetails): string {
  const issues = details.discrepancies.filter(Boolean).map(issue => ({
    FACILITY_MISMATCH: 'Facility name mismatch', ORDERER_NAME_MISMATCH: 'Orderer name mismatch',
    ORDERER_NAME_NOT_FOUND: 'Orderer name missing', FACILITY_NOT_FOUND: 'Facility name missing',
  }[issue] || issue));
  if (issues.length) return [...new Set(issues)].join('; ');
  for (const [label, field] of [['Facility name', {...details.facility, status: generalFacilityDisplayStatus(details.facility)}], ['Orderer name', details.orderer]] as const) {
    if (!['match', 'informational', 'optional not provided'].includes(field.status)) return generalFieldFindingLabel(label, field);
  }
  const product = details.productVerifications?.find(item => item.status === 'review required' || item.status === 'customer confirmation required');
  if (product) return `${product.productName}: ${product.reason || 'Product identity could not be verified'}`;
  const quantity = details.products.find(item => item.quantityReviewRequired || item.requestedQuantityMissing || item.suppliedQuantityMissing || item.identityReviewRequired);
  if (quantity) return `${quantity.name}: ${quantity.quantityError || quantity.identityError || (quantity.requestedQuantityMissing ? 'Requested quantity missing' : quantity.suppliedQuantityMissing ? 'Fulfilled quantity missing' : quantity.quantityReviewRequired ? 'Recorded requested quantity differs' : 'Product identity could not be verified')}`;
  const review = details.semanticReviews?.[0];
  if (review) return generalReviewExplanation(review);
  if (details.pendingOrderLimitCount) return 'Reduced quantity: order limit not confirmed';
  const statuses = generalFourParameterStatuses(details);
  if (statuses.products !== 'match') return 'Product identity could not be verified';
  if (statuses.quantities !== 'match') return 'Quantity could not be verified';
  return details.message || 'Order information could not be verified';
}


/** Use only after the audit has cleared; availability does not change identity validation. */
export function generalAuditConfirmedLabel(details: Pick<GeneralAuditDetails, 'stockStatus'>): string {
  return details.stockStatus === 'out of stock' || details.stockStatus === 'partially out of stock'
    ? 'ORDER CONFIRMED, BUT OUT OF STOCK'
    : 'ORDER CONFIRMED, CLEAR TO LAUNCH';
}
