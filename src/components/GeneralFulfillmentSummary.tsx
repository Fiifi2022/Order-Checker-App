import { generalFacilityDisplayStatus } from '../utils/generalFacility';
import { generalAuditClarifications } from '../utils/generalAuditReviews';
import type { GeneralAuditDetails, GeneralProductResult } from '../utils/generalAuditTypes';
import { generalProductDisplayName } from '../utils/generalAuditor';
import GeneralProductCategoryBadge from './GeneralProductCategoryBadge';

export function GeneralProductName({ name }: { name: string }) {
  return <>{generalProductDisplayName(name)}</>;
}

export function GeneralOrderLimitPrompt({ product, onDecision, disabled = false }: {
  product: GeneralProductResult;
  onDecision: (key: string, answer: boolean) => void;
  disabled?: boolean;
}) {
  if (!product.orderLimitEligible) return null;
  const confirmed = product.orderLimitDecision === true && product.fulfillmentStatus === 'order limit applied';
  return <div className={`${confirmed ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'} border p-3 rounded-xl text-xs space-y-2`}>
    <p className="font-semibold">Was this quantity reduced because of an order limit?</p>
    <p><GeneralProductName name={product.name} /> — Requested: {product.requested} {product.requestedUnit}; Supplied: {product.supplied} {product.suppliedUnit}; Difference: {product.difference} {product.conversion?.unit || product.requestedUnit}</p>
    <div className="flex gap-2">
      {[true, false].map(answer => <button key={String(answer)} type="button" disabled={disabled}
        aria-pressed={product.orderLimitDecision === answer}
        onClick={() => onDecision(product.key, answer)}
        className={`px-4 py-2 rounded-lg border font-semibold disabled:opacity-50 ${product.orderLimitDecision === answer ? answer ? 'bg-green-700 text-white border-green-700' : 'bg-red-700 text-white border-red-700' : 'bg-white text-purple-800 border-purple-200'}`}>
        {answer ? 'Yes — reduced by order limit' : 'No — report discrepancy'}
      </button>)}
    </div>
    {product.orderLimitDecision === true && <p role="status" className="text-green-800">Approved — Order Limit Applied</p>}
    {product.orderLimitDecision === false && <p className="text-red-800">Quantity Discrepancy — Missing quantity: {product.difference}</p>}
  </div>;
}

export default function GeneralFulfillmentSummary({ details }: { details: GeneralAuditDetails }) {
  const notices = generalAuditClarifications(details);
  const fieldWarnings = new Set(notices.map(notice => notice.message));
  const obsoleteWarning = /ORDERER NAME NOT FOUND|FACILITY NOT FOUND|MISSING REQUIRED INFORMATION —|UNRESOLVED TEXT|Product or quantity remains unresolved|Some text could not be verified automatically|FACILITY REVIEW REQUIRED|multiple facility records|Verify the facility ID|Manually verify the facility|Possible facility match|Facility: Confirm/i;
  const facilityNameMatched = generalFacilityDisplayStatus(details.facility) === 'match';
  const reviewCount = Math.max(0, (details.auditSummary?.reviewRequiredCount || 0) - Number(details.facility.status === 'review required' && facilityNameMatched));
  const status = /POSSIBLE FACILITY MATCH/i.test(details.finalStatus) ? 'ORDER CHECKS' : /UNRESOLVED TEXT/i.test(details.finalStatus) ? notices.length ? 'ORDER DETAILS REQUIRED' : 'ORDER CHECKS' : details.finalStatus;
  const warnings = (details.warnings || []).filter(warning => !fieldWarnings.has(warning) && !obsoleteWarning.test(warning));
  const groups: {status: string; kind?: string; title: string; review?: boolean}[] = [
    {status: 'discrepancy', review: true, title: 'Product Identity Review'},
    { status: 'discrepancy', kind: 'identity', title: 'Product Identity Discrepancies' },
    { status: 'discrepancy', kind: 'missing', title: 'Missing Products' },
    { status: 'discrepancy', kind: 'extra', title: 'Extra Products' },
    { status: 'discrepancy', kind: 'quantity', title: 'Quantity Discrepancies' },
    { status: 'quantity review', title: 'Out of Stock — Quantity Review Required' },
    { status: 'pending order limit', title: 'Awaiting Order Limit Validation' },
    { status: 'fully supplied', title: details.productComparisonMode === 'names_only' ? 'Matched Product Names' : 'Fully Supplied / In Stock' },
    { status: 'order limit applied', title: 'Order Limit Applied' },
    { status: 'out of stock', title: 'Out of Stock' }
  ];
  const metadata = [details.facility.status === 'mismatch' && 'Facility Mismatch', details.orderer.status === 'mismatch' && 'Orderer Name Mismatch'].filter(Boolean);
  return <section className="bg-white p-5 rounded-2xl border border-purple-100 shadow-sm space-y-4" aria-label="Fulfillment summary">
    <h4 className="font-bold text-[#3B1A5E]">{status}</h4>
    {details.message && !obsoleteWarning.test(details.message) && <p className="text-sm">{details.message}</p>}
    {!!warnings.length && <div className="text-xs text-amber-800"><h5 className="font-semibold">Warnings</h5><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
    {metadata.length > 0 && <div className="text-xs text-red-800"><h5 className="font-semibold">Metadata Discrepancies</h5><ul>{metadata.map(issue => <li key={String(issue)}>{issue}</li>)}</ul></div>}
    {groups.map(group => {
      const products = details.products.filter(product => product.fulfillmentStatus === group.status && (!group.kind || product.discrepancyKind === group.kind) && Boolean(product.identityReviewRequired) === Boolean(group.review));
      return products.length ? <div key={group.title} className={`text-xs space-y-1 ${group.review || ['out of stock','quantity review'].includes(group.status) ? 'text-amber-800' : ''}`}>
        <h5 className="font-semibold">{group.title}</h5>
        <ul className="list-disc pl-4 space-y-1">{products.map(product => <li key={product.key}>
          <GeneralProductCategoryBadge category={product.category} />{' '}
          <GeneralProductName name={product.name} /> — {product.identityError || product.quantityError || (details.productComparisonMode === 'names_only' ? group.status === 'fully supplied' ? 'Name matched' : 'Name not matched' : product.conversion || product.requestedUnit !== product.suppliedUnit
            ? `Requested ${product.requested} ${product.requestedUnit}; Supplied ${product.supplied} ${product.suppliedUnit}`
            : group.status === 'order limit applied' ? `Requested ${product.requested}, Supplied ${product.supplied}, Difference ${product.difference}; Reason: Order Limit` : `${product.supplied}/${product.requested} supplied/requested`)}
          {product.conversion && <p>Quantity Verified Using Packaging Conversion: {product.conversion.description}. Equivalent quantities: requested {product.conversion.requested}, supplied {product.conversion.supplied} {product.conversion.unit}.</p>}
          {product.registeredOutOfStock && <p>Listed in current OSU register (supporting information).</p>}
          {group.status === 'out of stock' && <p>{product.stockStatus === 'partially out of stock' ? 'PARTIALLY OUT OF STOCK' : 'OUT OF STOCK'} — Out of stock: {product.outOfStockQuantity ?? product.difference}.</p>}
        </li>)}</ul>
      </div> : null;
    })}
    <p className="text-xs font-semibold">Audit Result: {details.discrepancies.length ? 'Discrepancy Detected' : details.auditSummary?.missingRequiredCount ? 'Missing Required Information' : reviewCount ? 'Clarification Required' : details.productTotals?.quantityReview ? 'Out of Stock — Quantity Review Required' : details.pendingOrderLimitCount ? 'Awaiting Order Limit Validation' : details.productComparisonMode === 'names_only' ? 'MATCH — PRODUCT NAMES VERIFIED' : details.productComparisonMode === 'names_and_quantities' ? 'Audit Passed — All compulsory order information and products match.' : 'MATCH — CLEARED'}</p>
  </section>;
}
