// Browser entry: reuse the portal's acknowledgement rules without another audit request.
export { acknowledgeOrderLimit } from '../shared/orderLimitAcknowledgement';
export { generalProductDisplayName } from '../src/utils/generalAuditor';
import { applyGeneralCatalog } from '../src/utils/productCatalog';
import { setCatalogRevision, type ProductCatalog } from '../shared/productCatalog';
export function applyAuditProductLog(catalog: ProductCatalog) {
  if (!catalog || !Number.isSafeInteger(catalog.revision) || !Array.isArray(catalog.products)) throw new Error('The audit Product Log could not be loaded. Update the backend and retry.');
  setCatalogRevision(catalog.revision);
  applyGeneralCatalog(catalog.products);
}
