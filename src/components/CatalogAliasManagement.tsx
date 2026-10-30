import { useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch';
import type { CatalogAliasRecord, CatalogAliasEvent } from '../../shared/productCatalog';

type AliasData={revision:number;canEdit:boolean;products:{id:string;name:string}[];records:(CatalogAliasRecord & {ambiguous?:boolean})[]};
export default function CatalogAliasManagement({onUpdated}:{onUpdated:()=>void}) {
 const [data,setData]=useState<AliasData|null>(null),[query,setQuery]=useState(''),[filter,setFilter]=useState('pending');
 const [alias,setAlias]=useState(''),[productId,setProductId]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [selected,setSelected]=useState<CatalogAliasRecord|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [history,setHistory]=useState<CatalogAliasEvent[]>([]),[cursor,setCursor]=useState(''),[historyOpen,setHistoryOpen]=useState(false);
 const request=async(path:string,body?:unknown)=>{
  const response=await authFetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
  const json=await response.json();if(!response.ok)throw Error(json.error || 'Alias request failed.');return json;
 };
 const load=async()=>{const next=await request('/api/products/aliases');setData(next);if(!next.canEdit)setFilter('approved');};
 useEffect(()=>{void load().catch(error=>setMessage(error.message));},[]);
 const change=async(action:string,record?:CatalogAliasRecord)=>{
  if(!data || busy)return;setBusy(true);setMessage('');
  try {
   await request('/api/products/aliases',{revision:data.revision,action,id:record?.id,text:action==='propose'||action==='correct'?alias:record?.text,
    productId:action==='propose'||action==='correct'?productId:record?.productId,identityConfirmed:confirmed});
   setSelected(null);setAlias('');setProductId('');setConfirmed(false);await load();onUpdated();window.dispatchEvent(new Event('product-catalog-updated'));
   setMessage(action==='propose'?'Alias added for review.':'Alias updated. New audits use the current approved mappings.');
  }catch(error:any){setMessage(error.message);}finally{setBusy(false);}
 };
 const readHistory=async(more=false)=>{
  setBusy(true);try{const page=await request('/api/products/aliases/history'+(more&&cursor?`?cursor=${encodeURIComponent(cursor)}`:''));
   setHistory(previous=>more?[...previous,...page.events]:page.events);setCursor(page.nextCursor);setHistoryOpen(true);
  }catch(error:any){setMessage(error.message);}finally{setBusy(false);}
 };
 const names=new Map(data?.products.map(product=>[product.id,product.name]));
 const records=data?.records.filter(record=>(filter==='all'||(filter==='inactive'?!record.active&&record.status==='approved':record.status===filter))&&
  `${record.text} ${names.get(record.productId)||''}`.toLowerCase().includes(query.toLowerCase())) || [];
 return <section aria-label="Alias Management" className="mt-4 border rounded-xl p-4 space-y-3">
  <h3 className="font-bold text-purple-900">Alias Management</h3>
  <p className="text-sm text-slate-600">Suggestions require verified approval. Approved aliases are shared by the app and extension.</p>
  <div className="flex flex-wrap gap-2">
   <input aria-label="Search aliases by product name" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search alias or product" className="border rounded p-2 flex-1 min-w-40"/>
   <select aria-label="Alias status" value={filter} onChange={event=>setFilter(event.target.value)} className="border rounded p-2">{['pending','approved','rejected','inactive','all'].map(value=><option key={value}>{value}</option>)}</select>
   <button type="button" disabled={busy} onClick={()=>void load().catch(error=>setMessage(error.message))} className="border rounded p-2">Refresh aliases</button>
   {data?.canEdit&&<button type="button" disabled={busy} onClick={()=>void readHistory()} className="border rounded p-2">Alias history</button>}
  </div>
  {data?.canEdit&&<form onSubmit={event=>{event.preventDefault();void change(selected?'correct':'propose',selected||undefined);}} className="grid gap-2 sm:grid-cols-2">
   <input required maxLength={160} aria-label="Alias text" placeholder="Alias text" value={alias} onChange={event=>setAlias(event.target.value)} className="border rounded p-2"/>
   <select required aria-label="Canonical product" value={productId} onChange={event=>setProductId(event.target.value)} className="border rounded p-2 min-w-0 w-full"><option value="">Choose existing product</option>{data.products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}</select>
   <label className="text-sm sm:col-span-2"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> I have verified the product identity and any specification mapping.</label>
   <div className="flex gap-2 sm:col-span-2"><button disabled={busy||!!selected&&!confirmed} className="rounded bg-purple-800 text-white p-2">{selected?'Save verified correction':'Add alias for review'}</button>{selected&&<button type="button" onClick={()=>{setSelected(null);setAlias('');setProductId('');setConfirmed(false);}} className="border rounded p-2">Cancel correction</button>}</div>
  </form>}
  {message&&<p role="status" className="text-sm">{message}</p>}
  <div className="space-y-2 max-h-96 overflow-auto">{records.map(record=><article key={record.id} className="border rounded p-3 text-sm space-y-1">
   <strong>{record.text}</strong><p>{names.get(record.productId)||record.productId}</p>
   <p>{record.status}{!record.active&&record.status==='approved'?' · inactive':''} · {record.source}{record.confidence!==undefined?` · confidence ${Math.round(record.confidence*100)}%`:''}</p>
   {record.clinicalUncertainty&&record.status==='pending'&&<p className="text-amber-800">Clinical identity needs verification before approval.</p>}
   {record.ambiguous&&<p className="text-amber-800">This alias has competing product mappings. Review before approval.</p>}
   <p className="text-xs text-slate-500">Created: {record.createdAt?new Date(record.createdAt).toLocaleString():'Imported from existing catalogue'}{record.approvedBy?` · Approved by ${record.approvedBy}`:''}</p>
   {data?.canEdit&&<div className="flex flex-wrap gap-2">
    {record.status==='pending'&&<><button type="button" disabled={busy||!confirmed} onClick={()=>void change('approve',record)} className="border rounded p-2">Approve verified alias</button><button type="button" disabled={busy} onClick={()=>void change('reject',record)} className="border rounded p-2">Reject</button></>}
    {record.status==='approved'&&record.active&&<button type="button" disabled={busy} onClick={()=>void change('deactivate',record)} className="border rounded p-2">Deactivate</button>}
    <button type="button" disabled={busy} onClick={()=>{setSelected(record);setAlias(record.text);setProductId(record.productId);setConfirmed(false);}} className="border rounded p-2">Correct mapping</button>
   </div>}
  </article>)}{data&&!records.length&&<p className="text-sm text-slate-500">No aliases in this view.</p>}</div>
  {historyOpen&&<details open><summary>Alias history</summary><ol className="text-xs space-y-2 mt-2">{history.map(event=><li key={event.id}>{new Date(event.at).toLocaleString()} · {event.action} · {event.before&&event.before.text!==event.after.text?`${event.before.text} → ${event.after.text}`:event.after.text} · {event.before&&event.before.productId!==event.after.productId?`${names.get(event.before.productId)||'Previous product'} → `:''}{names.get(event.after.productId)||'Product'} · {event.actor}</li>)}</ol>{cursor&&<button type="button" disabled={busy} onClick={()=>void readHistory(true)} className="border rounded p-2 mt-2">Load earlier history</button>}</details>}
 </section>;
}
