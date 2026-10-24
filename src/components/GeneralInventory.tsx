import { LearnGeneralProductAlias } from './GeneralProductAliases';
import type { GeneralComparisonItem } from '../utils/generalAuditor';
import type { GeneralAuditDetails } from '../utils/generalAuditTypes';
import { GeneralOrderLimitPrompt } from './GeneralFulfillmentSummary';
import { generalProductResults } from '../utils/generalProductResults';

export { generalInventoryRows } from '../utils/generalInventoryRows';

export default function GeneralInventory({ items, details, onOrderLimit, auditId, disabled = false }: {
  auditId?: string; items: GeneralComparisonItem[]; details: GeneralAuditDetails; onConfirm?: (key: string, productKey: string, rejectSuggestion?: boolean) => Promise<void>;
  onOrderLimit: (key: string, answer: boolean) => void; disabled?: boolean;
}) {
  return <div className="space-y-3" aria-label="Inventory product comparisons">
    {generalProductResults(items, details).map(result => <article key={result.key} data-product-key={result.key}
      className="min-w-0 bg-white border border-purple-100 rounded-xl p-4 shadow-sm space-y-3 text-xs break-words" aria-label={result.name}>
      <h4 className="text-base font-bold text-[#3B1A5E] leading-snug">{result.name}</h4>
      <div className="space-y-1 text-slate-700"><p>Customer: {result.customer}</p><p>Fulfilment: {result.fulfillment}</p></div>
      {result.requested.length > 1 && <details><summary>Original requested entries ({result.requested.length})</summary>{result.requested.map(source => <p key={source.sourceEntryId || source.line}>{source.originalText}</p>)}</details>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-700">
        <span>Requested: {result.requestedQuantity} {result.quantity?.requestedUnit || result.requested[0]?.unit}</span>
        <span>Fulfilled: {result.suppliedQuantity} {result.quantity?.suppliedUnit || result.fulfilled[0]?.unit}</span>
      </div>
      <p role="status" className={`font-semibold ${result.tone === 'matched' ? 'text-green-700' : result.tone === 'pending' ? 'text-amber-800' : 'text-red-800'}`}>Status: {result.status}{result.status === 'MATCH' ? ' — Product and quantity verified' : ''}</p>
      {result.reason && <p className="text-slate-700"><strong>Reason:</strong> {result.reason}</p>}
      {result.quantity?.orderLimitEligible && result.quantity.orderLimitDecision === undefined && <GeneralOrderLimitPrompt product={result.quantity} onDecision={onOrderLimit} disabled={disabled} />}
      {auditId && result.tone === 'matched' && result.customer.toLowerCase() !== result.fulfillment.toLowerCase() && <LearnGeneralProductAlias auditId={auditId} productKey={result.key} canonicalKey={result.product?.confirmation?.productKey || result.quantity?.key} disabled={disabled} />}
    </article>)}
  </div>;
}
