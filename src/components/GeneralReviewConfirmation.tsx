import {useRef,useState} from 'react';
import {canConfirmProductReview,generalReviewKey,reviewProductDrafts,reviewProductEvidence,type ReviewConfirmation} from '../../shared/generalReviewConfirmation';
import type {GeneralSemanticReview,GeneralOrderExtractionSnapshot} from '../utils/generalAuditTypes';
import type {GeneralComparisonItem} from '../utils/generalAuditor';

export default function GeneralReviewConfirmation({review,items,extraction,onConfirm,disabled=false}:{review:GeneralSemanticReview;items:GeneralComparisonItem[];extraction?:GeneralOrderExtractionSnapshot;onConfirm?:(decision:ReviewConfirmation)=>Promise<void>;disabled?:boolean}){
 const [rows,setRows]=useState(()=>reviewProductDrafts(items,review,extraction)),[verified,setVerified]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),busy=disabled||saving,evidence=reviewProductEvidence(items,review),sourceRows=reviewProductDrafts(items,review,extraction);
 if(!canConfirmProductReview(review)||!onConfirm)return null;
 const update=(index:number,field:string,value:string)=>{setRows(current=>current.map((row,i)=>i===index?{...row,[field]:value}:row));setVerified(false);setError('');};
 const submit=async()=>{if(busy||lock.current||!verified)return;lock.current=true;setSaving(true);setError('');try{await onConfirm({reviewKey:generalReviewKey(review),products:rows,verified:true});}catch(e:any){setError(e.message||'Confirmation could not be saved. Please retry.');}finally{lock.current=false;setSaving(false);}};
 return <div className="space-y-2" aria-label="Confirm source products and quantities">
  <p>Check the products and quantities in this source text, then confirm. Other differences remain checked separately.</p>
  {rows.map((row,index)=><fieldset key={index} disabled={busy} className="space-y-2 rounded border border-amber-200 p-2">
   <legend>Product {index+1}</legend>
   <p aria-label={`Review product ${index+1} name`}><span className="font-semibold">{review.source==='customer_request'?'Customer requested':'Fulfilment product'}:</span> {row.name}</p>
   <label className="block">{review.source==='customer_request'?'Requested quantity':'Fulfilled quantity'}<input aria-label={`Review product ${index+1} quantity`} readOnly={evidence.some(p=>p.line===row.line&&!p.quantityReview)||row.line===null&&!!sourceRows[index]?.quantity} type="number" min={review.source==='customer_request'?0.000001:0} step="any" value={row.quantity} onChange={e=>update(index,'quantity',e.target.value)} className="block w-full rounded border p-2"/></label>
   <label className="block">Unit (if stated)<input aria-label={`Review product ${index+1} unit`} readOnly={evidence.some(p=>p.line===row.line&&!p.quantityReview)||row.line===null&&!!sourceRows[index]?.quantity} maxLength={30} value={row.unit} onChange={e=>update(index,'unit',e.target.value)} className="block w-full rounded border p-2"/></label>
   {review.source==='fulfillment_confirmation'&&<label className="block">FS recorded requested quantity (if stated)<input aria-label={`Review product ${index+1} FS requested quantity`} readOnly={evidence.some(p=>p.line===row.line&&p.ratioRequestedQuantity!==undefined)||row.line===null&&!!sourceRows[index]?.confirmationRequested} type="number" min="0" step="any" value={row.confirmationRequested} onChange={e=>update(index,'confirmationRequested',e.target.value)} className="block w-full rounded border p-2"/></label>}
  </fieldset>)}
  {!rows.length&&<p role="status">No product name could be read from this source. Use the product suggestions to resolve its identity; no name has been assumed.</p>}
  <label className="flex gap-2"><input type="checkbox" checked={verified} disabled={busy||!rows.length} onChange={e=>setVerified(e.target.checked)}/>I have verified these products and quantities against the source message.</label>
  <button type="button" disabled={busy||!verified||!rows.length||rows.some(row=>!row.name.trim()||!row.quantity.trim())} onClick={()=>void submit()} className="rounded bg-green-700 px-3 py-2 text-white disabled:opacity-50">{saving?'Saving confirmation…':'Confirm Products & Quantities'}</button>
  {error&&<p role="alert" className="text-red-800">{error}</p>}
 </div>;
}
