import {useEffect,useState} from 'react';
import {smartIdentityField,canDecideIdentity,type IdentityField,type IdentityDecision} from '../utils/generalIdentityDecision';
import type {GeneralFieldResult} from '../utils/generalAuditTypes';

export default function GeneralIdentityCard({field,value:rawValue,onDecision,disabled=false,showDirectoryCandidates=false,requireAcknowledgement=false,auditKey=''}:{field:IdentityField;value:GeneralFieldResult;onDecision?:(field:IdentityField,action:IdentityDecision['action'],acknowledged?:boolean,saveAlias?:boolean)=>Promise<void>;disabled?:boolean;showDirectoryCandidates?:boolean;requireAcknowledgement?:boolean;auditKey?:string}){
 const value=smartIdentityField(field,rawValue);
 const [error,setError]=useState(''),[saving,setSaving]=useState(false);
 const [acknowledged,setAcknowledged]=useState(false),[saveAlias,setSaveAlias]=useState(false);
 useEffect(()=>{setAcknowledged(false);setSaveAlias(false);setError('');},[auditKey,field,value.whatsappValue,value.fulfillmentValue,value.identityDecision?.revision]);
 const decision=value.identityDecision,decided=decision&&decision.action!=='reset';
 const pending=value.status==='review required',matched=value.status==='match';
 const canAct=canDecideIdentity(value)&&(!matched||decided);
 const status=decided?decision.action==='confirm'?'Manually Verified':'Discrepancy Confirmed':matched?'Verified':pending?'Awaiting CCA Confirmation':'Discrepancy';
 const choose=async(action:IdentityDecision['action'])=>{if(!onDecision||saving||disabled||action==='confirm'&&requireAcknowledgement&&!acknowledged)return;setSaving(true);setError('');try{await onDecision(field,action,acknowledged,saveAlias);}catch(e){setError(e instanceof Error?e.message:'Decision could not be saved.');}finally{setSaving(false);}};
 return <article className={`rounded-xl border p-3 space-y-2 text-xs ${matched?'border-green-200 bg-green-50':pending?'border-amber-200 bg-amber-50':'border-red-200 bg-red-50'}`} aria-label={`${field==='orderer'?'Customer name':'Facility'} identity result`}>
  <div className="flex justify-between gap-2 font-semibold"><span>{field==='orderer'?'Name of Orderer':'Facility Name'}</span><span role="status" className={matched?'text-green-800':pending?'text-amber-800':'text-red-800'}>{status}</span></div>
  {pending&&!decided&&<h5 className="font-bold">Possible {field==='orderer'?'Name':'Facility'} Match Detected</h5>}
  <p>Customer WhatsApp: {value.whatsappValue==='N/A'?'Not provided':value.whatsappValue}</p>
  <p>Fulfilment System: {value.fulfillmentValue==='N/A'?'Not provided':value.fulfillmentValue}</p>
  {value.reason&&<p><strong>Reason:</strong> {value.reason}</p>}
  {showDirectoryCandidates&&field==='facility'&&pending&&!decided&&(value as import('../utils/generalFacility').GeneralFacilityResult).evidence?.slice(0,3).map((candidate,index)=><p key={index}><strong>Facility Database candidate:</strong> {candidate.name}{[candidate.district,candidate.region].filter(Boolean).length?` — ${[candidate.district,candidate.region].filter(Boolean).join(', ')}`:''}. Confirm the spelling before accepting this facility.</p>)}
  {value.previousIdentitySuggestion&&<p>Previously {value.previousIdentitySuggestion.decision==='confirm'?'confirmed':'rejected'} by {value.previousIdentitySuggestion.actor} on {value.previousIdentitySuggestion.at}. Confirm this order independently.</p>}
  {canAct&&!decided&&<div>
   <p><strong>Suggested Action:</strong> Confirm whether both names refer to the same {field==='orderer'?'customer':'facility'}.</p>
   {requireAcknowledgement&&<label className="flex gap-2 mt-2"><input type="checkbox" checked={acknowledged} disabled={disabled||saving} onChange={event=>setAcknowledged(event.target.checked)}/>I have checked both original names and confirm they identify the same {field==='orderer'?'customer':'facility'}.</label>}
   {requireAcknowledgement&&field==='facility'&&<label className="flex gap-2"><input type="checkbox" checked={saveAlias} disabled={disabled||saving} onChange={event=>setSaveAlias(event.target.checked)}/>Also approve saving this alternate name against the verified facility record.</label>}
   <div className="flex flex-wrap gap-2 mt-2">
    <button type="button" className="rounded bg-green-700 text-white px-3 py-2" disabled={!onDecision||disabled||saving||requireAcknowledgement&&!acknowledged} onClick={()=>void choose('confirm')}>Confirm Match</button>
    <button type="button" className="rounded border border-red-700 text-red-800 px-3 py-2" disabled={!onDecision||disabled||saving} onClick={()=>void choose('reject')}>Reject Match</button>
   </div>
  </div>}
  {decided&&<div><p>Decision by {decision.actor.name} — <time>{decision.at}</time></p><button type="button" className="underline mt-1" disabled={!onDecision||disabled||saving} onClick={()=>void choose('reset')}>Change Decision</button></div>}
  {saving&&<p role="status">Saving decision…</p>}{error&&<p role="alert" className="text-red-800">{error}</p>}
  {value.identityHistory?.length&&<details><summary>Decision history</summary>{value.identityHistory.map(entry=><p key={entry.revision}>{entry.action==='reset'?'Decision reopened':entry.action==='confirm'?'Match confirmed':'Match rejected'} — {entry.actor.name} — {entry.at}<br/>{entry.customer} ↔ {entry.fulfillment}</p>)}</details>}
 </article>;
}
