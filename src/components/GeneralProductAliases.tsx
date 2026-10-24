import { useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch';
import type { GeneralProductAliasState } from '../../shared/generalProductAliases';
import type { CatalogProduct } from '../../shared/productCatalog';

export function LearnGeneralProductAlias({ auditId, productKey, canonicalKey, disabled }: { auditId: string; productKey: string; canonicalKey?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(false); setMessage(''); }, [auditId, productKey, canonicalKey]);
  const save = async () => {
    if (busy || saved) return;
    setBusy(true); setMessage('');
    try {
      const response = await authFetch('/api/general/product-aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', approvePermanently: true, auditId, key: productKey }) });
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      if (!Array.isArray(data.aliases) || !data.aliases.some((alias: any) => alias.status === 'approved')) throw Error('The server did not return a saved alias. Please retry.');
      setSaved(true); setMessage('Verified wording saved for future audits. Clinical details will still be checked.');
    } catch (error: any) { setMessage(error.message || 'Could not save the name. Please retry.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-1"><button type="button" onClick={save} disabled={disabled || busy || saved} className="text-purple-800 underline disabled:opacity-50">{busy ? 'Saving verified wording…' : saved ? 'Verified wording saved' : 'Approve and save this wording for future audits'}</button>{message && <p role={saved ? 'status' : 'alert'}>{message}</p>}</div>;
}
export function GeneralProductAliasDictionary() {
  const [state, setState] = useState<(GeneralProductAliasState & { products: CatalogProduct[] }) | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const load = async () => {
    setBusy(true); setError('');
    try { const response = await authFetch('/api/general/product-aliases'); const data = await response.json(); if (!response.ok) throw Error(data.error); setState(data); }
    catch (error: any) { setError(error.message); } finally { setBusy(false); }
  };
  const change = async (id: string, action: 'correct' | 'disable') => {
    if (busy || !state) return; setBusy(true); setError('');
    try {
      const response = await authFetch('/api/general/product-aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, revision: state.revision, catalogProductId: selected[id] || state.aliases.find(alias => alias.id === id)?.catalogProductId }) });
      const data = await response.json(); if (!response.ok) throw Error(data.error); setState({ ...data, products: state.products });
    } catch (error: any) { setError(error.message || 'Could not update the dictionary.'); } finally { setBusy(false); }
  };
  return <details className="border rounded-xl p-3 mb-4 text-sm" onToggle={event => { if (event.currentTarget.open && !state && !busy) void load(); }}>
    <summary className="font-semibold cursor-pointer">Verified Product Name Alias Dictionary</summary>
    <p className="my-2 text-slate-600">Approve wording from a verified inventory card. Changes here apply to future General Auditor orders.</p>
    <button type="button" disabled={busy} onClick={load} className="underline">Reload dictionary</button>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {state?.aliases.length === 0 && <p>No verified wording has been saved.</p>}
    <div className="max-h-80 overflow-y-auto space-y-3 mt-3">{state?.aliases.map(alias => <article key={alias.id} className="border rounded-lg p-3 space-y-2">
      <p><strong>{alias.originalWording}</strong> → {alias.canonicalName}</p>
      <p>{alias.status} · {alias.recognition} · {alias.confirmedBy.name} · {alias.confirmedAt}</p>
      <label className="block">Correct catalogue product<select aria-label={`Correct alias ${alias.originalWording}`} className="block border rounded p-2 w-full" disabled={busy} value={selected[alias.id] || alias.catalogProductId} onChange={event => setSelected({ ...selected, [alias.id]: event.target.value })}>{state.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      <div className="flex gap-4"><button type="button" disabled={busy} onClick={() => change(alias.id, 'correct')} className="underline">{alias.status === 'disabled' ? 'Approve and reactivate' : 'Save correction'}</button><button type="button" disabled={busy || alias.status === 'disabled'} onClick={() => change(alias.id, 'disable')} className="underline text-red-800">Disable alias</button></div>
      <details><summary>Editing history</summary>{alias.history.map((entry, index) => <p key={index}>{entry.action} · {entry.actor.name} · {entry.at} · {state.products.find(product => product.id === entry.catalogProductId)?.name || entry.catalogProductId}</p>)}</details>
    </article>)}</div>
  </details>;
}
