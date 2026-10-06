import type { GeneralAuditDetails, GeneralProductResult } from '../utils/generalAuditTypes';
import { generalProductDisplayName } from '../utils/generalAuditor';

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
    <p className="font-semibold">Was an Order Limit applied to this product?</p>
    <p><GeneralProductName name={product.name} /> — Requested: {product.requested} {product.requestedUnit}; Supplied: {product.supplied} {product.suppliedUnit}; Difference: {product.difference} {product.conversion?.unit || product.requestedUnit}</p>
    <div className="flex gap-2">
      {[true, false].map(answer => <button key={String(answer)} type="button" disabled={disabled}
        aria-pressed={product.orderLimitDecision === answer}
        onClick={() => onDecision(product.key, answer)}
        className={`px-4 py-2 rounded-lg border font-semibold disabled:opacity-50 ${product.orderLimitDecision === answer ? answer ? 'bg-green-700 text-white border-green-700' : 'bg-red-700 text-white border-red-700' : 'bg-white text-purple-800 border-purple-200'}`}>
        {answer ? 'Yes' : 'No'}
      </button>)}
    </div>
    {product.orderLimitDecision === true && <p className="text-green-800">Order Limit Applied — Reason: Order Limit</p>}
    {product.orderLimitDecision === false && <p className="text-red-800">Quantity Discrepancy — Missing quantity: {product.difference}</p>}
  </div>;
}

export default function GeneralFulfillmentSummary({ details }: { details: GeneralAuditDetails }) {
  const groups = [
    { status: 'discrepancy', kind: 'missing', title: 'Missing Products' },
    { status: 'discrepancy', kind: 'extra', title: 'Extra Products' },
    { status: 'discrepancy', kind: 'quantity', title: 'Quantity Discrepancies' },
    { status: 'pending order limit', title: 'Awaiting Order Limit Validation' },
    { status: 'fully supplied', title: 'Fully Supplied / In Stock' },
    { status: 'order limit applied', title: 'Order Limit Applied' },
    { status: 'out of stock', title: 'Out of Stock' }
  ];
  const metadata = [details.facility.status === 'mismatch' ? 'Facility Mismatch' : details.facility.status === 'not available in system entry' && 'Facility Not Found — review required', details.orderer.status === 'mismatch' ? 'Orderer Name Mismatch' : details.orderer.status === 'not available in system entry' && 'Orderer Name Not Found — review required', details.phone.status === 'mismatch' && 'Phone Number Mismatch'].filter(Boolean);
  return <section className="bg-white p-5 rounded-2xl border border-purple-100 shadow-sm space-y-4" aria-label="Fulfillment summary">
    <h4 className="font-bold text-[#3B1A5E]">{details.finalStatus}</h4>
    {details.message && <p className="text-sm">{details.message}</p>}
    {!!details.warnings?.length && <div className="text-xs text-amber-800"><h5 className="font-semibold">Warnings</h5><ul>{details.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
    {metadata.length > 0 && <div className="text-xs text-red-800"><h5 className="font-semibold">Metadata Discrepancies</h5><ul>{metadata.map(issue => <li key={String(issue)}>{issue}</li>)}</ul></div>}
    {groups.map(group => {
      const products = details.products.filter(product => product.fulfillmentStatus === group.status && (!group.kind || product.discrepancyKind === group.kind));
      return products.length ? <div key={group.title} className="text-xs space-y-1">
        <h5 className="font-semibold">{group.title}</h5>
        <ul className="list-disc pl-4 space-y-1">{products.map(product => <li key={product.key}>
          <GeneralProductName name={product.name} /> — {product.conversion || product.requestedUnit !== product.suppliedUnit
            ? `Requested ${product.requested} ${product.requestedUnit}; Supplied ${product.supplied} ${product.suppliedUnit}`
            : group.status === 'order limit applied' ? `Requested ${product.requested}, Supplied ${product.supplied}, Difference ${product.difference}; Reason: Order Limit` : `${product.supplied}/${product.requested} supplied/requested`}
          {product.conversion && <p>Quantity Verified Using Packaging Conversion: {product.conversion.description}. Equivalent quantities: requested {product.conversion.requested}, supplied {product.conversion.supplied} {product.conversion.unit}.</p>}
          {product.registeredOutOfStock && <p>Listed in current OSU register (supporting information).</p>}
          {group.status === 'out of stock' && <p>This requested product is out of stock and was not fulfilled.</p>}
        </li>)}</ul>
      </div> : null;
    })}
    <p className="text-xs font-semibold">Audit Result: {details.discrepancies.length ? 'Discrepancy Detected' : details.pendingOrderLimitCount ? 'Awaiting Order Limit Validation' : 'Confirmed — No Discrepancy'}</p>
  </section>;
}
