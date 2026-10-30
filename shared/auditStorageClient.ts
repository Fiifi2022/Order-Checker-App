import {sameGeneralAuditSources} from './generalAuditFingerprint';
/** Retry only server-authoritative data. If session memory was lost, re-audit
 * the locally retained source inputs under the SAME stable audit document ID. */
export async function retryAuditStorage(request:(path:string,options?:any)=>Promise<any>,record:any) {
 if(!record?.id || !record.generalAudit)throw Error('No General audit is available to retry.');
 let updated:any;
 const reverify=()=>request('/api/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkId:record.id,auditScope:'general_auditor',whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,generalOrderLimitDecisions:record.generalAudit.orderLimitDecisions || {}})});
 try{updated=await request(`/api/audits/${encodeURIComponent(record.id)}/storage-retry`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}
 catch(error:any){
  if(error.status!==404)throw error;
  updated=await reverify();
 }
 if(updated?.id===record.id && (!sameGeneralAuditSources(updated,record) || JSON.stringify(updated.generalAudit?.orderLimitDecisions || {})!==JSON.stringify(record.generalAudit.orderLimitDecisions || {})))updated=await reverify();
 if(updated?.id!==record.id || !updated.generalAudit || !updated.storage)throw Error('The server did not confirm the audit storage status. Retry using the retained audit.');
 return updated;
}
