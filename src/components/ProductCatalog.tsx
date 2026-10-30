import CatalogAliasManagement from './CatalogAliasManagement';
import CatalogHealthPanel from './CatalogHealthPanel';
import { inspectCatalogHealth } from '../../shared/catalogHealth';
import type { AliasSuggestion } from '../../shared/productCatalog';
import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Plus, Save, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { applyGeneralCatalog } from '../utils/productCatalog';
import { catalogCounterpart, setCatalogRevision } from '../../shared/productCatalog';
import type { CatalogProduct, ProductCatalog as StoredCatalog } from '../../shared/productCatalog';

type CatalogData = StoredCatalog & { canEdit?: boolean; accessRoles?: string[] };
const emptyProduct = (): CatalogProduct => ({ id: '', scope: 'general', name: '', category: 'medicine', aliases: [], contextualAliases: [], note: '' });
export default function ProductCatalog({ canEdit: initialCanEdit, onClose, onUpdated }: { canEdit: boolean; onClose: () => void; onUpdated: () => void }) {
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const canEdit = catalog?.canEdit ?? initialCanEdit;
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [showAliasManagement,setShowAliasManagement]=useState(false);
  const [showHealth,setShowHealth]=useState(false);
  const [previewMessage,setPreviewMessage]=useState('');
  const [draft, setDraft] = useState<CatalogProduct | null>(null);
  const [aliases, setAliases] = useState('');
  const [contextual, setContextual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [suggestions, setSuggestions] = useState<AliasSuggestion[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const accept = (data: CatalogData) => { setCatalog(previous => ({ ...data, canEdit: data.canEdit ?? previous?.canEdit ?? initialCanEdit, accessRoles: data.accessRoles ?? previous?.accessRoles })); setCatalogRevision(data.revision); applyGeneralCatalog(data.products); };
  const load = async () => {
    setBusy(true); setError('');
    try { const response = await authFetch('/api/products'); const data = await response.json(); if (!response.ok) throw new Error(data.error); accept(data); setDraft(null); setSuggestions([]); setSelectedSuggestions([]); }
    catch (error: any) { setError(error.message || 'Could not load products.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(()=>{setPreviewMessage('');},[draft,aliases,contextual,catalog?.revision]);
  const edit = (product: CatalogProduct) => { setDraft({ ...product, linkedProductId: product.linkedProductId !== undefined ? product.linkedProductId : (catalog ? catalogCounterpart(product, catalog.products)?.id : '') || '' }); setPreviewMessage(''); setSuggestions([]); setSelectedSuggestions([]); setAliases(product.aliases.join('\n')); setContextual(product.contextualAliases.join('\n')); setError(''); setMessage(''); };
  const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
  const health=useMemo(()=>catalog?inspectCatalogHealth(catalog):null,[catalog]);
  const preview = async () => {
    if(!draft || !catalog || busy || !canEdit) return;
    setBusy(true);setError('');setPreviewMessage('');
    try {
      const response=await authFetch('/api/products/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,id:draft.id || undefined,aliases:lines(aliases),contextualAliases:lines(contextual),revision:catalog.revision})});
      const data=await response.json();if(!response.ok)throw Error(data.error || 'Could not preview changes.');
      setPreviewMessage(`Preview only — not saved. ${data.resolved.length} findings resolved; ${data.introduced.length} new findings. ${data.health.errorCount} conflicts or errors remain in the catalogue. ${data.introduced.length ? 'New findings: ' + data.introduced.map((issue: {title:string;labels:string[]})=>issue.title + (issue.labels.length ? ' (' + issue.labels.join(', ') + ')' : '')).join('; ') : ''}`);
    } catch(error:any) {setError(error.message);} finally {setBusy(false);}
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!draft || !catalog) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await authFetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, id: draft.id || undefined, aliases: lines(aliases), contextualAliases: lines(contextual), revision: catalog.revision }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save product.');
      accept(data); setDraft(null); setSuggestions([]); setSelectedSuggestions([]); setMessage(draft.linkedProductId ? 'Product saved. New aliases and changed receiving details synced to Vaccine Checker and General Auditor.' : 'Product saved. New audits will use these aliases.'); window.dispatchEvent(new Event('product-catalog-updated')); onUpdated();
    } catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  };
  const suggest = async () => {
    if (!draft || !catalog) return;
    setBusy(true); setError(''); setMessage(''); setSuggestions([]); setSelectedSuggestions([]);
    try {
      const response = await authFetch('/api/products/suggest-aliases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, id: draft.id || undefined, aliases: lines(aliases), contextualAliases: lines(contextual), revision: catalog.revision }),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not get suggestions.');
      if(Number.isSafeInteger(data.revision)) setCatalog(previous=>previous?{...previous,revision:data.revision}:previous);
      if(data.queueStatus==='unavailable') setMessage('Suggestions are available, but the pending-review queue could not be saved. Reload if the catalogue changed.');
      setSuggestions(data.suggestions);
      if (!data.suggestions.length) setMessage('Gemini found no additional unambiguous aliases. You can add your own below.');
    } catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  };
  const deleteProduct = async () => {
    if (busy || !canEdit || !catalog || !draft?.id) return;
    const product = catalog.products.find(product => product.id === draft.id);
    if (!product || !window.confirm(`Delete “${product.displayName || product.name}” from the catalogue? Its aliases will be deactivated. Linked products and past audits will be kept.`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await authFetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: product.id, revision: catalog.revision }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not delete product.');
      accept(data); setDraft(null); setSuggestions([]); setSelectedSuggestions([]);
      setMessage('Product deleted from the catalogue.');
      window.dispatchEvent(new Event('product-catalog-updated')); onUpdated();
    } catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  };
  const addSuggestions = () => {
    const selected = suggestions.filter(suggestion => selectedSuggestions.includes(suggestion.alias));
    setAliases([...new Set([...lines(aliases), ...selected.map(suggestion => suggestion.alias)])].join('\n'));
    setContextual([...new Set([...lines(contextual), ...selected.filter(suggestion => suggestion.requiresContext).map(suggestion => suggestion.alias)])].join('\n'));
    setSuggestions([]); setSelectedSuggestions([]);
    setMessage('Suggestions added to the draft. Save product to publish and sync them.');
  };
  const products = (catalog?.products || []).filter(product => (scope === 'all' || product.scope === scope) && [product.displayName || product.name, product.name, product.category, product.fulfillmentSystemName || '', ...product.aliases].some(value => value.toLowerCase().includes(query.toLowerCase())));
  return <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-3 sm:p-6">
    <section role="dialog" aria-modal="true" aria-labelledby="product-catalog-title" className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
      <header className="bg-[#3B1A5E] text-white p-5 flex items-start justify-between gap-3"><div><h2 id="product-catalog-title" className="text-xl font-bold">Product Catalog</h2><p className="text-sm text-purple-200 mt-1">Maintain product names and aliases used to match orders.</p></div><button aria-label="Close product catalog" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10"><X size={20} /></button></header>
      <div className="px-4 pt-4"><button type="button" disabled={!health || busy} aria-expanded={showHealth} onClick={()=>setShowHealth(value=>!value)} className="border rounded p-2 text-sm mr-2">Catalogue health{health ? ` (${health.errorCount + health.warningCount})` : ''}</button><button type="button" onClick={()=>setShowAliasManagement(value=>!value)} className="border rounded p-2 text-sm">Alias Management</button></div>
      <div className="p-4 border-b flex flex-wrap gap-3 items-center"><label className="flex items-center gap-2 flex-1 min-w-48 border rounded-lg px-3"><Search size={16} /><input aria-label="Search products and aliases" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search products or aliases" className="py-2 w-full outline-none text-sm" /></label><select aria-label="Product scope" value={scope} onChange={event => setScope(event.target.value)} className="border rounded-lg p-2 text-sm"><option value="all">All products</option><option value="general">General Auditor</option><option value="vaccine">Vaccine Checker</option></select><button disabled={busy} onClick={() => void load()} className="border rounded-lg p-2 flex gap-2 text-sm"><RefreshCw size={16} />Reload</button>{canEdit && <button disabled={busy || !catalog} onClick={() => edit(emptyProduct())} className="bg-purple-800 text-white rounded-lg p-2 flex gap-2 text-sm"><Plus size={16} />Add product</button>}</div>
      <div className="overflow-y-auto p-4">{catalog && !canEdit && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-3 text-sm text-amber-900">Read-only access. Your assigned roles: {catalog.accessRoles?.join(', ') || 'unavailable'}. Catalog editing requires Administrator, Warehouse, or Compliance access.</p>}{error && <p role="alert" className="p-3 mb-3 rounded-lg bg-red-50 text-red-800 text-sm">{error}</p>}{message && <p role="status" className="p-3 mb-3 rounded-lg bg-emerald-50 text-emerald-800 text-sm">{message}</p>}
        {showAliasManagement&&<CatalogAliasManagement onUpdated={()=>{void load();onUpdated();}}/>}
        {showHealth && health && catalog && <CatalogHealthPanel report={health} products={catalog.products} canEdit={canEdit} onEdit={product=>{setShowHealth(false);edit(product);}} onAliases={()=>setShowAliasManagement(true)}/>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5"><div><p className="text-xs text-slate-500 mb-2">{busy ? 'Loading…' : `${products.length} products`}</p><div className="space-y-2 max-h-[60vh] overflow-y-auto">{products.map(product => <button disabled={busy} key={product.id} onClick={() => edit(product)} className={`w-full text-left p-3 border rounded-xl hover:border-purple-400 ${draft?.id === product.id ? 'bg-purple-50 border-purple-400' : ''}`}><strong className="block text-sm">{product.displayName || product.name}</strong><span className="block text-xs text-purple-800">{product.scope === 'general' ? 'General Auditor' : 'Vaccine Checker'} · {product.category}</span><span className="block text-xs text-slate-500 mt-1 break-words">{product.aliases.join(' · ') || 'No additional aliases'}</span></button>)}</div></div>
          {draft ? <form onSubmit={save} className="space-y-3"><h3 className="font-bold">{draft.id ? 'Product details' : 'New product'}</h3><fieldset disabled={busy || !canEdit} className="space-y-3">{canEdit && <div className="rounded-xl border border-purple-200 bg-purple-50 p-3 space-y-3">
                <button type="button" disabled={!(draft.displayName ?? draft.name).trim()} onClick={() => void suggest()} className="flex items-center gap-2 rounded-lg bg-purple-800 text-white px-3 py-2 text-sm disabled:opacity-50"><Sparkles size={16} />{busy ? 'Working…' : 'Suggest aliases with Gemini'}</button>
                <p className="text-xs text-purple-900">Review established names and abbreviations, then select the ones to add. Suggestions stay in your draft until you save.</p>
                {suggestions.map(suggestion => <label key={suggestion.alias} className="flex gap-2 text-sm"><input type="checkbox" checked={selectedSuggestions.includes(suggestion.alias)} onChange={event => setSelectedSuggestions(current => event.target.checked ? [...current, suggestion.alias] : current.filter(alias => alias !== suggestion.alias))} /><span><strong>{suggestion.alias}</strong> · {suggestion.kind}{suggestion.requiresContext && ' · Context required'}<span className="block text-xs text-slate-600">{suggestion.reason}</span></span></label>)}
                {!!suggestions.length && <button type="button" disabled={!selectedSuggestions.length} onClick={addSuggestions} className="border border-purple-400 rounded-lg px-3 py-2 text-sm disabled:opacity-50">Add selected suggestions</button>}
              </div>}<label className="block text-sm">Product name<input required maxLength={160} value={draft.displayName ?? draft.name} onChange={event => setDraft(draft.id ? { ...draft, displayName: event.target.value } : { ...draft, name: event.target.value, displayName: event.target.value })} className="block border rounded-lg p-2 w-full mt-1 disabled:bg-slate-50" /></label><label className="block text-sm">Used in<select disabled={!!draft.id} value={draft.scope} onChange={event => setDraft({ ...draft, scope: event.target.value as 'general' | 'vaccine', linkedProductId: '', category: event.target.value === 'vaccine' ? 'vaccine' : 'medicine' })} className="block border rounded-lg p-2 w-full mt-1"><option value="general">General Auditor</option><option value="vaccine">Vaccine Checker</option></select></label><label className="block text-sm">Category<input required maxLength={60} value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })} className="block border rounded-lg p-2 w-full mt-1" /></label>
              <label className="block text-sm">Sync new aliases to<select value={draft.linkedProductId || ''} onChange={event => setDraft({ ...draft, linkedProductId: event.target.value })} className="block border rounded-lg p-2 w-full mt-1"><option value="">This checker only</option>{catalog?.products.filter(product => product.scope !== draft.scope).map(product => <option key={product.id} value={product.id}>{product.displayName || product.name} — {product.scope === 'vaccine' ? 'Vaccine Checker' : 'General Auditor'}</option>)}</select><span className="block text-xs text-slate-500 mt-1">Select the same product in the other checker to share newly added aliases and abbreviations.</span></label>
              <label className="block text-sm">Fulfillment System name (optional)<input maxLength={160} value={draft.fulfillmentSystemName || ''} onChange={event => setDraft({ ...draft, fulfillmentSystemName: event.target.value })} placeholder="Exact product name shown in the Fulfillment System" className="block border rounded-lg p-2 w-full mt-1" /><span className="text-xs text-slate-500">Also recognized as an alias when checking orders.</span></label>
              <label className="block text-sm">How this product is received / supplied (optional)<textarea rows={3} maxLength={2000} value={draft.receivingDetails || ''} onChange={event => setDraft({ ...draft, receivingDetails: event.target.value })} placeholder="e.g. Received as a box containing 10 individually packed units" className="block border rounded-lg p-2 w-full mt-1" /><span className="text-xs text-slate-500">Appears when this product is entered or recognized in scanned text. This reminder does not change quantity calculations.</span></label>
              <label className="block text-sm">Aliases — one per line<textarea rows={6} value={aliases} onChange={event => setAliases(event.target.value)} className="block border rounded-lg p-2 w-full mt-1" /></label>{draft.scope === 'general' && <label className="block text-sm">Aliases requiring context — one per line<textarea rows={2} value={contextual} onChange={event => setContextual(event.target.value)} className="block border rounded-lg p-2 w-full mt-1" /></label>}<label className="block text-sm">Notes<textarea rows={3} maxLength={2000} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} className="block border rounded-lg p-2 w-full mt-1" /></label>{canEdit && <button type="button" disabled={busy} onClick={()=>void preview()} className="border border-purple-300 rounded-lg px-4 py-2 text-sm">Preview catalogue changes</button>}{previewMessage && <p role="status" className="text-sm text-purple-900">{previewMessage}</p>}{canEdit && <button className="bg-purple-800 text-white rounded-lg px-4 py-2 text-sm flex gap-2 items-center"><Save size={16} />{busy ? 'Saving…' : 'Save product'}</button>}{canEdit && draft.id && <button type="button" onClick={() => void deleteProduct()} className="border border-red-300 text-red-700 rounded-lg px-4 py-2 text-sm flex gap-2 items-center"><Trash2 size={16} />Delete product</button>}</fieldset><p className="text-xs text-slate-500">Keep different strengths, formulations, and vaccine companions distinct. Adding an alias does not change quantities or allocation rules.</p></form> : <div className="rounded-xl border border-purple-200 bg-purple-50 p-5 mt-6 space-y-3"><h3 className="font-bold text-purple-900 flex items-center gap-2"><Sparkles size={18} />Gemini alias assistant</h3><p className="text-sm text-purple-900">{canEdit ? 'Select a product from the list, then click Suggest aliases with Gemini. Review the suggestions and choose a matching product to sync new aliases to the other checker.' : 'Select a product to view its aliases. Administrator, Warehouse, and Compliance roles can request Gemini suggestions and save changes.'}</p>{canEdit && <button type="button" disabled className="rounded-lg bg-purple-800 text-white px-3 py-2 text-sm opacity-50">Select a product to get suggestions</button>}</div>}
        </div>
      </div>
    </section>
  </div>;
}
