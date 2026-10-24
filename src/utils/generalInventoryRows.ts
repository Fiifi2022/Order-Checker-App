import { sameGeneralEvidenceOrigin } from './generalProductEvidence';
import type { GeneralComparisonItem } from './generalAuditor';
import type { GeneralAuditDetails, GeneralProductVerification as Verification } from './generalAuditTypes';

// Source evidence binds deferred and confirmed products to the same inventory card.
export function generalInventoryRows(items: GeneralComparisonItem[], details: GeneralAuditDetails) {
  const verifications = details.productVerifications || [];
  const related = (item: GeneralComparisonItem, product: Verification) => item.provenance.some(source =>
    [...product.requestedProducts, ...product.fulfillmentProducts].some(evidence => sameGeneralEvidenceOrigin(evidence, source)));
  return [
    ...verifications.map(product => ({ key: product.key, product, items: items.filter(item => related(item, product)) })),
    ...items.filter(item => !verifications.some(product => related(item, product))).map(item => ({ key: item.fulfillment.key, product: undefined, items: [item] })),
  ].sort((a, b) => Math.min(...(a.product?.requestedProducts || a.items.flatMap(item => item.provenance)).map(source => source.line)) -
    Math.min(...(b.product?.requestedProducts || b.items.flatMap(item => item.provenance)).map(source => source.line)));
}

