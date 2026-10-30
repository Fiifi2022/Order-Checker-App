import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuditStorage,auditStorageFailure,auditStorageRetryHandler} from './auditStorage';
import {retryAuditStorage} from '../shared/auditStorageClient';
const record=()=>({id:'AUD-stable',createdByUserId:'owner',generalAudit:{orderLimitDecisions:{}},whatsappMessage:'RDT 5',fulfillmentConfirmation:'Malaria RDT [0/1]'});
test('slow Firestore writes remain pending until confirmation, rather than being reported as failed or saved',async()=>{
 let complete!:()=>void;const storage=createAuditStorage(()=>new Promise<void>(resolve=>{complete=resolve;}));
 const audit=record() as any;await storage.persist(audit,2);assert.equal(audit.storage.status,'pending');assert.ok(!audit.storage.savedAt);
 complete();await storage.persist(audit,100);assert.equal(audit.storage.status,'saved');assert.ok(audit.storage.savedAt);assert.equal(audit.generalStorageWarning,undefined);
});
test('failure categories redact raw credentials and retain the original audit and stable ID through retries',async()=>{
 const categories:any={16:'authentication',7:'permission',3:'schema',14:'network',8:'quota',9:'initialization',4:'timeout',secret:'unknown'};
 for(const [code,category] of Object.entries(categories)){
  const state=auditStorageFailure({code,message:'private-key-secret access-token-secret'});assert.equal(state.category,category);assert.equal(state.status,'failed');assert.doesNotMatch(state.message,/private-key-secret|access-token-secret/);
 }
 let failed=true,writes=0;const docs=new Map();
 const storage=createAuditStorage(async(id,data)=>{writes++;if(failed)throw {code:14};docs.set(id,data);});
 const audit=record() as any;await storage.persist(audit);assert.equal(audit.storage.status,'failed');assert.equal(audit.generalAudit.orderLimitDecisions.constructor,Object);assert.equal(docs.size,0);
 failed=false;await Promise.all([storage.persist(audit),storage.persist(audit)]);
 assert.equal(writes,2);assert.equal(docs.size,1);assert.equal(docs.get(audit.id).storage.status,'saved');assert.equal(audit.storage.status,'saved');
});
test('writes to the same document are ordered so an older audit cannot overwrite a newer result',async()=>{
 let finish!:()=>void;const seen:any[]=[];
 const storage=createAuditStorage(async(_id,data)=>{if(!seen.length){seen.push(data.version);await new Promise<void>(resolve=>{finish=resolve;});}else seen.push(data.version);});
 const old={...record(),version:1};await storage.persist(old,2);
 const fresh={...record(),version:2};const next=storage.persist(fresh,100);finish();await next;assert.deepEqual(seen,[1,2]);
});
async function invoke(handler:any,actor:any,id='AUD-stable',body={}){
 let status=200,data:any;
 await handler({params:{id},body},{locals:{authUser:actor},status(code:number){status=code;return this;},json(value:any){data=value;}});
 return {status,data};
}
test('storage retry uses the authorized cached audit, ignores caller results, and skips already confirmed writes',async()=>{
 let writes=0;const audit=record() as any;
 const storage=createAuditStorage(async()=>{writes++;});
 const handler=auditStorageRetryHandler({read:async()=>audit,persist:record=>storage.persist(record)});
 assert.equal((await invoke(handler,{id:'other',role:'cca'})).status,403);assert.equal(writes,0);
 const owner=await invoke(handler,{id:'owner',role:'cca'},audit.id,{id:'evil',allMatch:true});assert.equal(owner.status,200);assert.equal(writes,1);assert.equal(owner.data.id,audit.id);
 await invoke(handler,{id:'owner',role:'cca'});assert.equal(writes,1);
 assert.equal((await invoke(handler,{id:'admin',role:'admin'},'bad/id')).status,400);
});
test('lost session memory re-verifies retained inputs using the same ID instead of uploading client audit results',async()=>{
 const audit=record();const calls:any[]=[];
 const updated=await retryAuditStorage(async(path,options)=>{
  calls.push([path,options]);if(calls.length===1)throw {status:404};return {...audit,storage:{status:'saved'}};
 },audit);
 const body=JSON.parse(calls[1][1].body);assert.equal(body.checkId,audit.id);assert.equal(body.whatsappMessage,audit.whatsappMessage);assert.equal(body.allMatch,undefined);assert.equal(body.auditScope,'general_auditor');assert.equal(updated.id,audit.id);
 await assert.rejects(retryAuditStorage(async()=>{throw {status:403};},audit));
});
test('retry cannot replace locally retained inputs or order-limit decisions with an older saved document',async()=>{
 const local={...record(),generalAudit:{orderLimitDecisions:{rdt:true}}};const calls:string[]=[];
 const updated=await retryAuditStorage(async(path)=>{
  calls.push(path);return calls.length===1?{...record(),storage:{status:'saved'}}:{...local,storage:{status:'saved'}};
 },local);
 assert.deepEqual(calls,['/api/audits/AUD-stable/storage-retry','/api/verify']);assert.equal(updated.generalAudit.orderLimitDecisions.rdt,true);
});
test('a confirmed database read repairs legacy storage warnings without treating session-only records as saved',async()=>{
 const {confirmedAuditRead}=await import('./auditStorage');
 const raw={...record(),storage:{status:'failed',category:'network'},generalStorageWarning:'Earlier write not confirmed'};
 const stored=confirmedAuditRead(raw);assert.equal(stored.storage.status,'saved');assert.equal(stored.generalStorageWarning,undefined);assert.equal(raw.storage.status,'failed');
});
