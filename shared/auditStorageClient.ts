import {sameGeneralAuditSources} from './generalAuditFingerprint';
/** Retry only server-authoritative data. If session memory was lost, re-audit
 * the locally retained source inputs under the SAME stable audit document ID. */
export async function retryAuditStorage(request:(path:string,options?:any)=>Promise<any>,record:any) {
 if(!record?.id || !record.generalAudit)throw Error('No General audit is available to retry.');
 let updated:any;
 const sameDecisions=(left:any,right:any)=>{
  const entries=(value:any)=>Object.entries(value || {}).sort(([a],[b])=>a.localeCompare(b));
  return JSON.stringify(entries(left))===JSON.stringify(entries(right));
 };
 const current=(value:any)=>typeof value?.whatsappMessage==='string' && typeof value?.fulfillmentConfirmation==='string' && value?.generalAudit &&
  sameGeneralAuditSources(value,record) && sameDecisions(value.generalAudit.orderLimitDecisions,record.generalAudit.orderLimitDecisions);
 const reverify=()=>request('/api/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkId:record.id,auditScope:'general_auditor',whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,generalOrderLimitDecisions:record.generalAudit.orderLimitDecisions || {}})});
 try{updated=await request(`/api/audits/${encodeURIComponent(record.id)}/storage-retry`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}
 catch(error:any){
  if(error.status!==404)throw error;
  updated=await reverify();
 }
 if(updated?.id===record.id && !current(updated))updated=await reverify();
 if(updated?.id!==record.id || !updated.generalAudit || !updated.storage)throw Error('The server did not confirm the audit storage status. Retry using the retained audit.');
 if(!current(updated))throw Error('The server returned different inputs or order-limit decisions. The current audit is retained; retry without replacing it.');
 return updated;
}
