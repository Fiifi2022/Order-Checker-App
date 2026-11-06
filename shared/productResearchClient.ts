import {canApplyIdentityResearch,identityResearchGeneration} from './generalIdentityResearch';
import {generalInputFingerprint} from './generalAuditFingerprint';
export async function actOnProductResearch(request:(url:string,init?:RequestInit)=>Promise<any>,record:any,alias:string,action:'research'|'reject'|'confirm'|'keep',productId?:string,saveAlias?:boolean){
 const group=record.generalAudit.catalogueSuggestions?.find((s:any)=>s.alias===alias);
 if(!group)throw Error('This product suggestion is no longer part of the current audit.');
 return request(`/api/audits/${encodeURIComponent(record.id)}/product-research`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alias,action,productId,...(saveAlias===undefined?{}:{saveAlias}),identityConfirmed:action==='confirm',researchRevision:group.researchRevision||0,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)})});
}
const pendingResearchCalls=new Map<string,Promise<any>>();
export async function researchPendingProducts(request:(url:string,init?:RequestInit)=>Promise<any>,record:any,retryIdentityField?:'facility'|'orderer'){
 const inputFingerprint=generalInputFingerprint(record),key=JSON.stringify([record.id,record.createdByUserId,inputFingerprint,retryIdentityField,identityResearchGeneration(record.generalAudit)]);
 let pending=pendingResearchCalls.get(key);
 if(!pending){
  pending=Promise.resolve().then(()=>request(`/api/audits/${encodeURIComponent(record.id)}/product-research`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alias:'__pending__',action:'research_pending',researchRevision:0,retryIdentityField,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint})}));
  pendingResearchCalls.set(key,pending);
  const current=pending;void pending.finally(()=>{if(pendingResearchCalls.get(key)===current)pendingResearchCalls.delete(key);}).catch(()=>{});
 }
 return structuredClone(await pending);
}
/** Merge only research groups, so late AI cannot restore stale identity or quantity findings. */
export function mergeResearchResult(current:any,response:any){
 if(!current||current.id!==response?.id||generalInputFingerprint(current)!==generalInputFingerprint(response))return current;
 const groups=response.generalAudit?.catalogueSuggestions||[];
 const identityResearch={...current.generalAudit.identityResearch};
 for(const field of ['facility','orderer']){
  const value=current.generalAudit[field],before=response.generalAudit?.[field];
  const incoming=response.generalAudit.identityResearch?.[field];
  if(canApplyIdentityResearch(value,before)&&incoming&&(identityResearch[field]?.status==='deferred'||(incoming.revision||0)>(identityResearch[field]?.revision||0)))identityResearch[field]=incoming;
 }
 return {...current,generalAudit:{...current.generalAudit,identityResearch,catalogueSuggestions:(current.generalAudit.catalogueSuggestions||[]).map((group:any)=>{
  const incoming=groups.find((g:any)=>g.alias===group.alias);
  return incoming&&(incoming.researchRevision||0)>(group.researchRevision||0)?incoming:group;
 })}};
}
export function markResearchUnavailable(current:any,record:any){
 if(!current||current.id!==record.id||generalInputFingerprint(current)!==generalInputFingerprint(record))return current;
 const details=current.generalAudit;
 return {...current,generalAudit:{...details,catalogueSuggestions:details.catalogueSuggestions?.map((group:any)=>{
  const original=record.generalAudit?.catalogueSuggestions?.find((g:any)=>g.alias===group.alias);
  return group.researchStatus==='deferred'&&original?.researchStatus==='deferred'&&(group.researchRevision||0)===(original.researchRevision||0)?{...group,researchStatus:'unavailable'}:group;
 }),identityResearch:Object.fromEntries(Object.entries(details.identityResearch||{}).map(([field,value]:[string,any])=>{
  const original=record.generalAudit?.identityResearch?.[field];
  return [field,value.status==='deferred'&&original?.status==='deferred'&&(value.revision||0)===(original.revision||0)&&canApplyIdentityResearch(details[field],record.generalAudit?.[field])?{...value,status:'unavailable'}:value];
 }))}};
}
