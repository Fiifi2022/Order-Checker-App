import { generalConfirmationPolicy } from '../utils/generalProductConfirmationPolicy';
import { normalizeGeneralProductName } from '../utils/generalAuditor';
import { useEffect, useRef, useState } from 'react';
import type { GeneralProductVerification as Verification } from '../utils/generalAuditTypes';

export const canConfirmGeneralProduct = (product: Verification, selected: string, contacted: boolean, disabled = false) =>
  !disabled && generalConfirmationPolicy(product, normalizeGeneralProductName).state === 'dosage/formulation confirmation required' && product.status === 'customer confirmation required' && contacted && generalConfirmationPolicy(product, normalizeGeneralProductName).options.some(option => option.key === selected);

export function GeneralProductVerificationControls({ product, selected, contacted, disabled, onSelect, onContact, onConfirm }: {
  product: Verification; selected: string; contacted: boolean; disabled: boolean;
  onSelect: (value: string) => void; onContact: (value: boolean) => void; onConfirm: () => void;
}) {
  return <div className="space-y-3">
    <label className="block space-y-1">Select the product confirmed by the customer
      <select aria-label={`Confirmed formulation for ${product.productName}`} value={selected} disabled={disabled}
        onChange={event => onSelect(event.target.value)} className="block w-full rounded-lg border border-amber-300 bg-white p-2 text-slate-800">
        <option value="">Select a product</option>
        {product.options.map(option => <option key={option.key} value={option.key}>{option.name}{option.fromFulfillment ? ' — recorded in fulfilment' : ''}</option>)}
      </select>
    </label>
    <label className="flex items-start gap-2">
      <input type="checkbox" checked={contacted} disabled={disabled} onChange={event => onContact(event.target.checked)} />
      <span>I have contacted the customer and confirmed that this is the correct product and dosage form.</span>
    </label>
    <button type="button" disabled={!canConfirmGeneralProduct(product, selected, contacted, disabled)} onClick={onConfirm}
      className="rounded-lg bg-[#5C2D91] px-3 py-2 font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed">{disabled ? 'Saving confirmation…' : 'Confirm Product'}</button>
  </div>;
}

export default function GeneralProductVerification({ product, onConfirm, disabled = false }: {
  product: Verification; onConfirm?: (key: string, productKey: string, rejectSuggestion?: boolean) => Promise<void>; disabled?: boolean;
}) {
  const savingRequest = useRef(false);
  const panel = useRef<HTMLDetailsElement>(null);
  const [selected, setSelected] = useState('');
  const [contacted, setContacted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const sourceIdentity = JSON.stringify([product.productName, ...[product.requestedProducts, product.fulfillmentProducts].map(sources => sources.map(source => [source.originalText, source.quantity, source.unit]))]);
  useEffect(() => {
    setSelected(''); setContacted(false); setError('');
    if (panel.current) panel.current.open = false;
  }, [sourceIdentity]);
  const editableProduct = { ...product, confirmation: undefined, status: 'customer confirmation required' as const };
  const reject = async () => {
    if (!selected || !onConfirm || saving || disabled) return;
    setSaving(true); setError('');
    try { await onConfirm(product.key, selected, true); setSelected(''); setContacted(false); } catch (error: any) { setError(error.message || 'Could not save rejection.'); } finally { setSaving(false); }
  };
  const confirm = async () => {
    if (!onConfirm || !canConfirmGeneralProduct(editableProduct, selected, contacted, disabled || saving || savingRequest.current)) return;
    savingRequest.current = true;
    setSaving(true); setError('');
    try { await onConfirm(product.key, selected); if (panel.current) panel.current.open = false; setContacted(false); }
    catch (error: any) { setError(error.message || 'Confirmation could not be saved. Please retry.'); }
    finally { savingRequest.current = false; setSaving(false); }
  };
  const policy = generalConfirmationPolicy(product, normalizeGeneralProductName);
  if (policy.state !== 'dosage/formulation confirmation required' && policy.state !== 'product match' && policy.state !== 'product discrepancy') return null;
  return <details ref={panel} className="text-xs rounded-lg border border-purple-200 p-3" aria-label={`Product verification: ${product.productName}`}>
    <summary className="cursor-pointer font-semibold text-[#5C2D91] rounded focus-visible:outline-2 focus-visible:outline-purple-700">
      {product.confirmation ? 'View verification details / Correct confirmation' : product.kind === 'ai product match' ? 'AI-Suggested Product Match — Verification Required' : 'Confirm Dosage / Formulation'}
    </summary>
    <div className="pt-3 space-y-3">
      <p>Requested: {product.productName}</p>
      <p>Suggested: {product.suggestedProduct || 'Select a catalogue product'}</p>
      {!product.confirmation && product.reason && <p>{product.reason}</p>}
      <p>Confirm the exact formulation with the customer.</p>
      {product.rejectedSuggestions?.length ? <p>{product.rejectedSuggestions.length} suggestion(s) rejected. The product still requires verification.</p> : null}
      {product.confirmation && <div className="text-slate-600 space-y-1">
        <p>Confirmed: {product.confirmation.productName}</p>
        <p>Confirmed by: {product.confirmation.confirmedBy?.name || 'CCA'} — <time dateTime={product.confirmation.confirmedAt}>{product.confirmation.confirmedAt}</time></p>
        {product.confirmationHistory?.map((entry, index) => <p key={index}>Previous: {entry.productName} — {entry.confirmedBy?.name || 'CCA'} — {entry.confirmedAt}</p>)}
      </div>}
      {onConfirm && <GeneralProductVerificationControls product={editableProduct} selected={selected} contacted={contacted} disabled={disabled || saving}
        onSelect={value => { setSelected(value); setContacted(false); }} onContact={setContacted} onConfirm={confirm} />}
      {onConfirm && product.kind === 'ai product match' && !product.confirmation && <button type="button" disabled={saving || disabled || !selected} onClick={reject} className="text-red-800 underline">Reject selected AI suggestion</button>}
      {error && <p role="alert" className="text-red-800">{error}</p>}
      {saving && <p role="status">Saving confirmation…</p>}
    </div>
  </details>;
}
