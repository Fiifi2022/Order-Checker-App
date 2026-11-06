import GeneralVaccineAccessories from './GeneralVaccineAccessories';
import {useState} from 'react';
import type {GeneralStructuredPreview,GeneralStructuredProduct,GeneralExtractionSubmission,GeneralExtractionEdit} from '../../shared/generalStructuredExtraction';
export default function GeneralExtractionPreview({preview,onCompare,onCancel,disabled=false}:{preview:GeneralStructuredPreview;onCompare:(submission:GeneralExtractionSubmission)=>Promise<void>;onCancel:()=>void;disabled?:boolean}){
 const [draft,setDraft]=useState(()=>structuredClone(preview)),[editing,setEditing]=useState<string[]>([]),[confirmed,setConfirmed]=useState<string[]>([]);
 const [edits,setEdits]=useState<GeneralExtractionEdit[]>([]),[reason,setReason]=useState(''),[acknowledged,setAcknowledged]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const change=(source:'customer'|'fulfillment',field:'orderer'|'facility'|'products',value:string|GeneralStructuredProduct[]|null)=>{
  setDraft(current=>({...current,[source]:{...current[source],[field]:field==='products'?value:{value,status:value?'extracted':'not detected'}}} as GeneralStructuredPreview));
  setEdits(current=>[...current.filter(edit=>edit.source!==source||edit.field!==field),{source,field,value}]);setAcknowledged(false);
 };
 const productChange=(side:'customer'|'fulfillment',index:number,field:'name'|'quantity'|'unit'|'confirmationRequested',value:string)=>{
  change(side,'products',draft[side].products.map((p,i)=>i===index?{...p,[field]:['quantity','confirmationRequested'].includes(field)?value.trim()===''?null:Number(value):value,
   ...(field==='quantity'?{status:value.trim()===''?'ambiguous' as const:'extracted' as const,reason:value.trim()===''?'Quantity not detected.':undefined}:{})}:p));
 };
 const proceed=async()=>{if(busy||disabled)return;setBusy(true);setError('');try{await onCompare({version:1,inputFingerprint:preview.inputFingerprint,catalogRevision:preview.catalogRevision,edits,confirmedFields:confirmed,reason,acknowledged});}catch(e){setError(e instanceof Error?e.message:'Comparison could not start.');}finally{setBusy(false);}};
 const needsAck=edits.length>0||confirmed.length>0;
 return <section aria-label="Structured extraction preview" className="rounded-2xl border border-purple-200 bg-white p-5 space-y-4">
  <h3 className="font-bold text-lg">Extracted order details</h3>
  <p className="text-sm text-slate-600">Both messages have been parsed separately. Check the fields below before comparison. Patient and delivery details are excluded from auditing.</p>
  <div className="grid gap-5 lg:grid-cols-2">{(['customer','fulfillment'] as const).map(side=><section key={side} aria-label={side==='customer'?'Extracted customer request':'Extracted FS confirmation'} className="rounded-xl border p-4 space-y-3">
   <h4 className="font-semibold">{side==='customer'?'Customer Request':'FS Confirmation'}</h4>
   {(['orderer','facility'] as const).map(field=>{const key=`${side}.${field}`,value=draft[side][field];return <div key={field} className="space-y-1">
    <label className="block font-medium text-sm">{field==='orderer'?'Orderer name':'Facility name'}{editing.includes(key)?<input aria-label={`${side} ${field}`} className="block w-full border rounded p-2" value={value.value||''} disabled={busy||disabled} onChange={event=>change(side,field,event.target.value)}/>:<span className="block font-normal">{value.value||'Not detected'}</span>}</label>
    <p className={`text-xs ${value.status==='extracted'?'text-green-800':'text-amber-800'}`}>{confirmed.includes(key)?'CCA verified extraction':value.status}{value.reason?` — ${value.reason}`:''}</p>
    <div className="flex gap-3 text-sm">{value.status==='ambiguous'&&value.value&&!confirmed.includes(key)&&<button type="button" disabled={busy||disabled} className="text-green-800 underline" onClick={()=>{setConfirmed(current=>[...current,key]);setAcknowledged(false);}}>Confirm extraction</button>}
     <button type="button" disabled={busy||disabled} className="underline" onClick={()=>setEditing(current=>[...new Set([...current,key])])}>Edit {field==='orderer'?'orderer':'facility'}</button>
     {value.status!=='extracted'&&value.value&&<button type="button" disabled={busy||disabled} className="text-red-800 underline" onClick={()=>change(side,field,null)}>Reject extraction</button>}
    </div>
   </div>;})}
   <div className="space-y-2"><h5 className="font-medium text-sm">Products and quantities</h5>
    {draft[side].products.length===0&&<p className="text-amber-800 text-sm">No product entries detected. Correct extraction or continue to audit the available fields.</p>}
    {draft[side].products.map((p,index)=><div key={index} className="rounded border p-2 space-y-1 text-sm">
     {editing.includes(`${side}.products`)?<>
      <label className="block">Product<input aria-label={`${side} product ${index+1} name`} className="block border rounded p-1 w-full" value={p.name} disabled={busy||disabled} onChange={e=>productChange(side,index,'name',e.target.value)}/></label>
      <div className="flex flex-wrap gap-2"><label>Quantity<input type="number" min="0" step="any" aria-label={`${side} product ${index+1} quantity`} className="block border rounded p-1 w-24" value={p.quantity??''} disabled={busy||disabled} onChange={e=>productChange(side,index,'quantity',e.target.value)}/></label>
       <label>Unit<input aria-label={`${side} product ${index+1} unit`} className="block border rounded p-1 w-24" value={p.unit} disabled={busy||disabled} onChange={e=>productChange(side,index,'unit',e.target.value)}/></label>
       {side==='fulfillment'&&<label>FS requested<input type="number" min="0" step="any" aria-label={`${side} product ${index+1} recorded quantity`} className="block border rounded p-1 w-24" value={p.confirmationRequested??''} disabled={busy||disabled} onChange={e=>productChange(side,index,'confirmationRequested',e.target.value)}/></label>}
      </div><button type="button" disabled={busy||disabled} className="text-red-800 underline" onClick={()=>change(side,'products',draft[side].products.filter((_,i)=>i!==index))}>Remove entry {index+1}</button>
     </>:<><p className="font-medium">{p.name}</p><p>{side==='customer'?'Requested':'Fulfilled'}: {p.quantity??'Not detected'} {p.unit}{side==='fulfillment'&&p.confirmationRequested!==null?` · FS records ${p.confirmationRequested} requested`:''}</p></>}
     {p.stockout||side==='fulfillment'&&p.quantity===0&&Number(p.confirmationRequested)>0?<p className="text-amber-800">Stockout recorded</p>:null}{p.orderLimit&&<p>Order limit recorded</p>}
     {p.status!=='extracted'&&<p className="text-amber-800">{p.reason||'Confirm the extracted quantity.'}</p>}
     {p.status!=='extracted'&&!editing.includes(`${side}.products`)&&<button type="button" disabled={busy||disabled} className="text-red-800 underline" onClick={()=>change(side,'products',draft[side].products.filter((_,i)=>i!==index))}>Reject entry {index+1}</button>}
     <details><summary>Source wording</summary><p className="whitespace-pre-wrap">{p.originalText}</p></details>
    </div>)}
    {!!draft[side].unreadProducts.length&&<p className="text-amber-800 text-sm">Product wording needs clarification: {draft[side].unreadProducts.join('; ')}</p>}
    <button type="button" disabled={busy||disabled} className="underline text-sm" onClick={()=>setEditing(current=>[...new Set([...current,`${side}.products`])])}>Edit products</button>
    {editing.includes(`${side}.products`)&&<button type="button" disabled={busy||disabled} className="underline text-sm ml-3" onClick={()=>change(side,'products',[...draft[side].products,{name:'',quantity:null,unit:'',confirmationRequested:null,originalText:'CCA added from original source',status:'ambiguous',stockout:false,orderLimit:false}])}>Add product</button>}
   </div>
   <details><summary>Original order text (patient details removed)</summary><pre className="whitespace-pre-wrap text-xs">{preview[side].sourceText}</pre></details>
  </section>)}</div>
  {preview.accessoryChecks?.length&&edits.length===0?<GeneralVaccineAccessories rows={preview.accessoryChecks}/>:null}
  {edits.length>0&&<label className="block text-sm">Reason for manual correction<input aria-label="Extraction correction reason" className="block w-full border rounded p-2" value={reason} maxLength={500} disabled={busy||disabled} onChange={e=>setReason(e.target.value)}/></label>}
  {needsAck&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={busy||disabled} onChange={e=>setAcknowledged(e.target.checked)}/>I checked these corrections or confirmations against the original messages.</label>}
  <div className="flex gap-3"><button type="button" disabled={busy||disabled||needsAck&&!acknowledged||edits.length>0&&!reason.trim()} className="rounded bg-purple-800 text-white p-3 disabled:opacity-50" onClick={()=>void proceed()}>Compare and audit</button><button type="button" disabled={busy||disabled} className="underline" onClick={onCancel}>Back to messages</button></div>
  {error&&<p role="alert" className="text-red-800">{error}</p>}
 </section>;
}
