import { useRef } from 'react';
import { generalProductDisplayName, type GeneralComparisonItem } from '../utils/generalAuditor';
import type { GeneralAuditDetails, GeneralProductVerification as Verification } from '../utils/generalAuditTypes';
import GeneralProductVerification from './GeneralProductVerification';
import { GeneralOrderLimitPrompt } from './GeneralFulfillmentSummary';

// Source evidence binds deferred and confirmed products to the same inventory card.
export function generalInventoryRows(items: GeneralComparisonItem[], details: GeneralAuditDetails) {
  const verifications = details.productVerifications || [];
  const related = (item: GeneralComparisonItem, product: Verification) => item.provenance.some(source =>
    [...product.requestedProducts, ...product.fulfillmentProducts].some(evidence => evidence.source === source.source && evidence.originalText === source.originalText));
  return [
    ...verifications.map(product => ({ key: product.key, product, items: items.filter(item => related(item, product)) })),
    ...items.filter(item => !verifications.some(product => related(item, product))).map(item => ({ key: item.fulfillment.key, product: undefined, items: [item] })),
  ].sort((a, b) => Math.min(...(a.product?.requestedProducts || a.items.flatMap(item => item.provenance)).map(source => source.line)) -
    Math.min(...(b.product?.requestedProducts || b.items.flatMap(item => item.provenance)).map(source => source.line)));
}

export default function GeneralInventory({ items, details, onConfirm, onOrderLimit, disabled = false }: {
  items: GeneralComparisonItem[]; details: GeneralAuditDetails; onConfirm?: (key: string, productKey: string) => Promise<void>;
  onOrderLimit: (key: string, answer: boolean) => void; disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const rows = generalInventoryRows(items, details);
  const pending = rows.filter(row => row.product?.status === 'customer confirmation required');
  const open = (key: string) => {
    const card = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-product-key]') || []).find(card => card.dataset.productKey === key);
    const panel = card?.querySelector<HTMLDetailsElement>('[data-product-details]');
    if (panel) {
      panel.open = true;
      const verification = panel.querySelector('details');
      if (verification) verification.open = true;
      panel.querySelector('summary')?.focus();
    }
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  return <div ref={root} className="space-y-3" aria-label="Inventory product comparisons">
    {details.productComparisonMode && <p className="text-xs text-slate-600">{details.productComparisonMode === 'names_only' ? 'Product names only' : 'Product names and quantities'}</p>}
    {pending.length > 0 && <nav aria-label="Products awaiting customer verification" className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs space-y-2">
      <p>{pending.length} {pending.length === 1 ? 'product requires' : 'products require'} customer verification.</p>
      <div className="flex flex-wrap gap-2">{pending.map(row => <button type="button" key={row.key} onClick={() => open(row.key)} className="text-purple-800 underline p-1">{row.product!.productName}</button>)}</div>
    </nav>}
    {rows.map(({ key, product, items: compared }, index) => {
      const requested = product?.requestedProducts || compared.flatMap(item => item.provenance.filter(source => source.source === 'customer_request'));
      const fulfilled = product?.fulfillmentProducts || compared.flatMap(item => item.provenance.filter(source => source.source === 'fulfillment_confirmation'));
      const paired = compared.find(item => item.provenance.some(source => source.source === 'customer_request'));
      const quantity = paired?.fulfillment || compared[0]?.fulfillment;
      const pendingConfirmation = product?.status === 'customer confirmation required';
      const requiresReview = product?.status === 'review required';
      const discrepancy = product?.confirmation ? product.reviewState === 'product discrepancy' : !pendingConfirmation && compared.some(item => ['missing item', 'extra item', 'vaccine pairing mismatch', 'product identity discrepancy'].includes(item.status));
      const productStatus = requiresReview ? 'Review Required' : pendingConfirmation ? 'Customer Confirmation Required' : compared.some(item=>item.status==='product identity discrepancy') ? 'Product Identity Discrepancy' : discrepancy ? 'Product Discrepancy' : product?.confirmation ? 'Customer Verified — Product Match' : 'MATCH';
      const quantityStatus = quantity?.quantityReviewRequired ? 'OUT OF STOCK — QUANTITY REVIEW REQUIRED' : requiresReview ? 'Awaiting product review' : pendingConfirmation ? 'Awaiting product verification' : quantity?.orderLimitEligible && quantity.orderLimitDecision === undefined ? 'Order Limit Verification Required' : quantity?.fulfillmentStatus === 'order limit applied' ? 'Order Limit Applied' : quantity?.fulfillmentStatus === 'out of stock' ? quantity.stockStatus === 'partially out of stock' ? 'PARTIALLY OUT OF STOCK' : 'OUT OF STOCK' : quantity?.fulfillmentStatus === 'discrepancy' ? 'Quantity Discrepancy' : 'Match';
      const requestedQuantity = product?.requestedQuantity ?? quantity?.requested ?? 0;
      const suppliedQuantity = product?.suppliedQuantity ?? compared[0]?.fulfillment.supplied ?? 0;
      const comparable = new Set([...requested, ...fulfilled].map(source => source.unit)).size <= 1 && fulfilled.length > 0;
      const summaryStatus = requiresReview || pendingConfirmation || discrepancy ? productStatus : quantityStatus === 'Match' ? productStatus : quantityStatus;
      const summaryColor = pendingConfirmation || /Required|Awaiting|OUT OF STOCK/.test(summaryStatus) ? 'text-amber-800' : discrepancy || /Discrepancy/.test(summaryStatus) ? 'text-red-800' : 'text-green-700';
      return <article key={key} data-product-key={key} className="min-w-0 bg-white border border-purple-100 rounded-xl p-4 shadow-sm space-y-3 text-xs break-words" aria-label={`Product ${index + 1}: ${product?.productName || compared[0]?.name}`}>
        <details data-product-details>
        <summary className="cursor-pointer text-base font-bold text-[#3B1A5E] leading-snug rounded focus-visible:outline-2 focus-visible:outline-purple-700">
          <h4 className="inline">{generalProductDisplayName(product?.productName || compared[0]?.name || '')}</h4>
          <span className={`block mt-1 text-xs font-semibold ${summaryColor}`}>{summaryStatus}</span>
          {details.productComparisonMode !== 'names_only' && <span className="block mt-1 text-xs font-normal text-slate-600">Requested: {quantity?.requestedQuantityMissing ? 'Not provided' : requestedQuantity} {quantity?.requestedUnit || requested[0]?.unit} · Fulfilled: {quantity?.suppliedQuantityMissing ? 'Not provided' : suppliedQuantity} {quantity?.suppliedUnit || fulfilled[0]?.unit}</span>}
          {quantity?.confirmationRequested !== undefined && <span className="block mt-1 text-xs font-normal text-slate-600">Fulfilment confirmation quantity: [{suppliedQuantity}/{quantity.confirmationRequested}]</span>}
          {quantity?.quantityReviewRequired && <span className="block mt-1 text-xs font-normal text-amber-800">{quantity.quantityError}</span>}
        </summary>
        {quantity?.outOfStockQuantity !== undefined && <p className="text-amber-800">Out of stock: {quantity.outOfStockQuantity} {quantity.conversion?.unit || quantity.requestedUnit}</p>}
        <div className="pt-3 space-y-3">
        <div className="space-y-1 text-slate-700">
          <p>Customer: {product?.productName || [...new Set(requested.map(source => source.name))].join('; ') || 'Not requested'}</p>
          <p>Fulfilment: {[...new Set(fulfilled.map(source => source.name))].join('; ') || 'Not fulfilled'}</p>
        </div>
        <p role="status" className={`font-semibold ${requiresReview || pendingConfirmation ? 'text-amber-800' : discrepancy ? 'text-red-800' : 'text-green-700'}`}>Product: {productStatus}</p>
        {requiresReview && product.reason && <p className="text-amber-800">{product.reason}</p>}
        {details.productComparisonMode !== 'names_only' && <p className={/Required|Awaiting|OUT OF STOCK/.test(quantityStatus) ? 'text-amber-800' : /Discrepancy/.test(quantityStatus) ? 'text-red-800' : 'text-slate-700'}>Quantity: {quantity?.quantityError || (pendingConfirmation && comparable && suppliedQuantity > 0 && suppliedQuantity < requestedQuantity ? 'Order Limit Verification Required — confirm product first' : quantityStatus)}</p>}
        {!details.productComparisonMode && <p className="text-slate-600">Dosage / formulation: {requiresReview ? 'Review Product Log alias' : pendingConfirmation ? 'Customer confirmation required' : discrepancy ? 'Review product discrepancy' : product?.confirmation ? 'Confirmed with customer' : 'No confirmation required'}</p>}
        {quantity?.conversion && <p>Packaging conversion: {quantity.conversion.description}</p>}
        {product && <GeneralProductVerification product={product} onConfirm={onConfirm} disabled={disabled} />}
        </div>
        </details>
        {quantity?.orderLimitEligible && <GeneralOrderLimitPrompt product={quantity} onDecision={onOrderLimit} disabled={disabled} />}
      </article>;
    })}
  </div>;
}
