import {generalInputFingerprint} from './generalAuditFingerprint';
import {catalogAliasKey} from './productCatalog';

/** Use existing catalogue authorization, conflict checks and durable alias history.
 * Selecting an option alone never clears the audit. */
export async function confirmCatalogueSuggestion(request:(url:string,init?:RequestInit)=>Promise<any>,alias:string,productId:string){
 const read=()=>request('/api/products/aliases');
 const write=(body:any)=>request('/api/products/aliases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let state=await read();
 if(!state.canEdit)throw Error('A catalogue editor must approve this product suggestion. The audit remains uncleared.');
 if(!state.products?.some((product:any)=>product.id===productId))throw Error('This catalogue product changed. Run the audit again.');
 const same=(record:any)=>record.normalizedText===catalogAliasKey(alias);
 let records=state.records.filter(same);
 const approved=records.find((record:any)=>record.status==='approved'&&record.active);
 if(approved){if(approved.productId!==productId)throw Error('This name is already approved for a different product. Correct its catalogue alias first.');return;}
 if(records.some((record:any)=>record.status==='rejected'||record.status==='approved'&&!record.active))throw Error('This alias was rejected or deactivated. A catalogue editor must review that earlier decision.');
 let pending=records.find((record:any)=>record.productId===productId&&record.status==='pending');
 if(!pending){
  await write({revision:state.revision,action:'propose',text:alias,productId});
  state=await read();pending=state.records.find((record:any)=>same(record)&&record.productId===productId&&record.status==='pending');
  if(!pending)throw Error('The suggestion was not saved. Refresh the audit before retrying.');
 }
 await write({revision:state.revision,action:'approve',id:pending.id,identityConfirmed:true});
 const saved=await read();
 if(!saved.records.some((record:any)=>same(record)&&record.productId===productId&&record.status==='approved'&&record.active))throw Error('Alias approval could not be confirmed. Check the catalogue before retrying.');
}

/** Receive the saved update for this audit ID; never call the verification pipeline. */
export async function markCatalogueSuggestion(request:(url:string,init?:RequestInit)=>Promise<any>,record:any,alias:string,productId:string){
 await confirmCatalogueSuggestion(request,alias,productId);
 return request(`/api/audits/${encodeURIComponent(record.id)}/catalogue-confirmation`,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({alias,productId,identityConfirmed:true,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)})});
}
