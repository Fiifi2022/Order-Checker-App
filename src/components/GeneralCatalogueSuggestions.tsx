import {useState} from 'react';
import type {GeneralAuditDetails} from '../utils/generalAuditTypes';
import {productResearchNextSteps} from '../../shared/productResearch';
import {generalFsProductSuggestionOptions,type GeneralFsProductSource} from '../utils/generalFsProductSuggestions';
export type ResearchAction=(alias:string,action:'research'|'reject'|'confirm'|'keep',productId?:string,saveAlias?:boolean)=>Promise<void>;
function Suggestion({suggestion,fsProducts,onChoose,onAction,disabled,offerAliasChoice=false}:{suggestion:NonNullable<GeneralAuditDetails['catalogueSuggestions']>[number];fsProducts?:GeneralFsProductSource[];onChoose?:(alias:string,productId:string)=>Promise<void>;onAction?:ResearchAction;disabled:boolean;offerAliasChoice?:boolean}){
 const [selected,setSelected]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [saveAlias,setSaveAlias]=useState(false);
 const options=generalFsProductSuggestionOptions(suggestion.options,fsProducts);
 const option=options.find(option=>option.productId===selected);
 const act=async(action:'research'|'reject'|'confirm'|'keep')=>{if(busy||disabled)return;setBusy(true);setError('');try{
  if(onAction)await onAction(suggestion.alias,action,option?.productId,offerAliasChoice?saveAlias:undefined);
  else if(action==='confirm'&&option&&onChoose)await onChoose(suggestion.alias,option.productId);
  setConfirmed(false);setSelected('');
 }catch(e:any){setError(e.message||'The action could not be saved. Your audit remains available.');}finally{setBusy(false);}};
 return <article className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3 text-sm">
  <p className="font-semibold">Customer requested: {suggestion.customerValue||suggestion.alias}</p>
  <p>{options.length>1?'Possible FS matches:':'Possible FS match:'} {option?.name||[...new Set(options.map(o=>o.name))].join('; ')||'No supported candidate yet.'}</p>
  {suggestion.researchStatus==='deferred'&&!suggestion.retainedDiscrepancy&&<p role="status">Pending research. Completed comparisons remain available.</p>}
  {suggestion.retainedDiscrepancy?<p role="status" className="text-red-800">Discrepancy confirmed by you. The audit is not cleared.</p>:<p role="status" className="font-medium text-amber-900">Decision: Confirm match or mark as discrepancy.</p>}
  {suggestion.researchStatus&&['rate_limited','timed_out','unavailable'].includes(suggestion.researchStatus)&&<p>{suggestion.researchStatus==='rate_limited'?'AI rate limit reached.':suggestion.researchStatus==='timed_out'?'AI research timed out.':'AI research is unavailable.'} Use the catalogue options and next steps below.</p>}
  {!options.length?<p>No supported product suggestion is available yet. Search again or mark as discrepancy.</p>:<>
   <label className="block">Choose the matching product<select aria-label={`Suggested product for ${suggestion.alias}`} value={selected} disabled={disabled||busy} onChange={event=>{setSelected(event.target.value);setConfirmed(false);setSaveAlias(false);setError('');}} className="block w-full rounded border border-amber-300 bg-white p-2">
    <option value="">Select a product</option>{options.map(option=><option key={option.productId} value={option.productId}>{option.name}</option>)}
   </select></label>
   <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={disabled||busy||!option} onChange={event=>setConfirmed(event.target.checked)}/>I have verified that this is the same product, including any stated strength and formulation.</label>
  </>}
  {offerAliasChoice&&option&&option.kind!=='source'&&<label className="flex gap-2"><input type="checkbox" checked={saveAlias} disabled={disabled||busy} onChange={event=>setSaveAlias(event.target.checked)}/>Also approve saving this wording as an alias for future audits.</label>}
  <div className="flex flex-wrap gap-2">
   <button type="button" aria-label="Confirm match and resume" disabled={disabled||busy||!option||!confirmed||(!onChoose&&!onAction)} className="rounded bg-green-700 px-3 py-2 text-white disabled:opacity-50" onClick={()=>void act('confirm')}>Confirm Match</button>
   <button type="button" disabled={disabled||busy||!onAction||suggestion.retainedDiscrepancy} className="rounded border border-red-700 px-3 py-2 text-red-800 disabled:opacity-50" onClick={()=>void act('keep')}>Mark discrepancy</button>
   <button type="button" disabled={disabled||busy||!option||!onAction} className="rounded border border-gray-400 px-3 py-2 disabled:opacity-50" onClick={()=>void act('reject')}>Reject this suggestion</button>
   <button type="button" disabled={disabled||busy||!onAction} className="rounded border border-purple-700 px-3 py-2 disabled:opacity-50" onClick={()=>void act('research')}>Search Again</button>
  </div>
  <p className="text-xs text-slate-600">Quantity differences remain checked separately.</p>
  {busy&&<p role="status">Saving action or researching terminology…</p>}
  <details><summary>Suggestion details</summary>
  <p>Suggestions require CCA verification. Confidence describes the evidence category, not a verified probability.</p>
  {option&&<div><p>Confidence: {option.confidenceCategory||'MEDIUM'}</p><p>Evidence: {option.evidenceSource==='catalogue'?'Catalogue wording':option.evidenceSource==='source'?'Customer request and FS wording':'Gemini terminology analysis'} — {option.reason}</p></div>}
  {(suggestion.terminology||[]).map((term,index)=><p key={index}>Possible terminology to investigate: {term.name} — {term.reason}</p>)}
  <ul className="list-disc pl-5">{(suggestion.nextSteps||productResearchNextSteps(!!options.length)).map(step=><li key={step}>{step}</li>)}</ul>
  {!!suggestion.sources?.length&&<div><p>Public research references — verify the candidate separately:</p><ul>{suggestion.sources.filter(source=>/^https:\/\//i.test(source.url)).map(source=><li key={source.url}><a className="underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}</ul></div>}
  {suggestion.searchStatus==='no_sources'&&<p>The search returned no verifiable supporting sources.</p>}
  {suggestion.searchEntryPoint&&<iframe title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={suggestion.searchEntryPoint} className="w-full border-0"/>}
  </details>
  {!!suggestion.history?.length&&<details><summary>Research decision history</summary>{suggestion.history.map((h,index)=><p key={index}>{h.action==='reject'?'Suggestion rejected':h.action==='keep'?'Discrepancy retained':'Research requested'} — {h.actor.name} — {h.at}</p>)}</details>}
  {error&&<p role="alert" className="text-red-800">{error}</p>}
 </article>;
}
export default function GeneralCatalogueSuggestions({suggestions,fsProducts,onChoose,onAction,disabled=false,offerAliasChoice=false}:{suggestions:GeneralAuditDetails['catalogueSuggestions'];fsProducts?:GeneralFsProductSource[];onChoose?:(alias:string,productId:string)=>Promise<void>;onAction?:ResearchAction;disabled?:boolean;offerAliasChoice?:boolean}){
 if(!suggestions?.length)return null;
 return <section aria-label="Product match suggestions" className="space-y-3">{suggestions.map(suggestion=><Suggestion key={JSON.stringify(suggestion)} suggestion={suggestion} offerAliasChoice={offerAliasChoice} fsProducts={fsProducts} onChoose={onChoose} onAction={onAction} disabled={disabled}/>)}</section>;
}
