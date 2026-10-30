import type {RequestHandler} from 'express';
import type {AuditStorageState} from '../shared/auditStorage';
import {assignedRoles} from '../shared/roles';
type RecordWithStorage={id:string;createdByUserId?:string;storage?:AuditStorageState;generalStorageWarning?:string;[key:string]:any};
export function auditStorageFailure(error:any):AuditStorageState {
 const code=String(error?.code ?? '').toLowerCase().replace(/^firestore\//,'');
 const category:AuditStorageState['category']=['16','unauthenticated','auth/id-token-expired','auth/invalid-id-token'].includes(code)?'authentication':
 ['7','permission-denied','permission_denied'].includes(code)?'permission':
 ['8','resource-exhausted','resource_exhausted'].includes(code)?'quota':
 ['3','invalid-argument','invalid_argument','out-of-range'].includes(code)?'schema':
 ['4','deadline-exceeded','deadline_exceeded','etimedout'].includes(code)?'timeout':
 ['14','unavailable','econnreset','enotfound','eai_again','network-request-failed'].includes(code)?'network':
 ['app/no-app','app/invalid-credential','failed-precondition','9'].includes(code)?'initialization':'unknown';
 const reasons={quota:'Firestore quota or capacity was exceeded. Retry later or ask an administrator to check usage.',authentication:'Server authentication failed. Ask an administrator to check Firebase credentials.',permission:'Firestore denied the write. Ask an administrator to check the server account permissions.',schema:'Firestore rejected the audit document. Its fields or size need checking.',network:'Firestore could not be reached. Check connectivity and retry.',initialization:'The Firestore service is not configured or ready. Ask an administrator to check initialization.',timeout:'Firestore did not confirm the write before its deadline. Retry to check and save.',unknown:'Firestore could not confirm the audit write. Retry; contact an administrator if it persists.'};
 return {status:'failed',category,message:reasons[category]+' This audit is retained locally and is not confirmed saved.',retryable:['network','timeout','quota','unknown'].includes(category)};
}
/** A successful database read confirms persistence, even for legacy documents
 * whose stored status predates explicit write acknowledgement. */
export function confirmedAuditRead(record:any){
 if(!record?.generalAudit)return record;
 const {generalStorageWarning:_warning,...data}=record;
 return {...data,storage:{status:'saved',message:'Saved to Firestore.',retryable:false,...(record.storage?.savedAt?{savedAt:record.storage.savedAt}:{})}};
}
const pending=():AuditStorageState=>({status:'pending',category:'timeout',message:'Firestore save confirmation is pending. This audit is retained locally; retry to check its status.',retryable:true});
/** Bounded response time, confirmed writes, same-ID retries and ordered updates. */
export function createAuditStorage(write:(id:string,record:any)=>Promise<unknown>) {
 const inflight=new Map<string,{record:RecordWithStorage;task:Promise<void>}>();
 const setState=(record:RecordWithStorage,state:AuditStorageState)=>{
  record.storage=state;
  if(state.status==='saved')delete record.generalStorageWarning;
  else record.generalStorageWarning=state.message;
 };
 async function persist(record:RecordWithStorage,waitMs=1500) {
  const active=inflight.get(record.id);
  let task=active?.record===record?active.task:undefined;
  if(!task){
   setState(record,pending());
   task=(active?.task || Promise.resolve()).then(async()=>{
    const savedAt=new Date().toISOString();
    const {generalStorageWarning:_warning,storage:_state,...data}=record;
    const saved:AuditStorageState={status:'saved',message:'Saved to Firestore.',retryable:false,savedAt};
    try{await write(record.id,{...data,storage:saved});setState(record,saved);}
    catch(error){setState(record,auditStorageFailure(error));}
   });
   const entry={record,task};inflight.set(record.id,entry);
   void task.finally(()=>{if(inflight.get(record.id)===entry)inflight.delete(record.id);});
  }
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([task,new Promise<void>(resolve=>{timer=setTimeout(resolve,Math.max(1,waitMs));})]);}
  finally{clearTimeout(timer);}
  return record;
 }
 return {persist};
}
export function auditStorageRetryHandler(deps:{read:(id:string)=>Promise<RecordWithStorage|null>;persist:(record:RecordWithStorage)=>Promise<RecordWithStorage>}):RequestHandler {
 return async(req,res)=>{
  const id=String(req.params.id || '');
  if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id)){res.status(400).json({error:'Invalid audit ID.'});return;}
  try{
   const record=await deps.read(id);
   if(!record){res.status(404).json({error:'Audit not found. Re-audit the locally retained inputs using the same audit ID.'});return;}
   const actor=res.locals.authUser;
   if(!actor || record.createdByUserId!==actor.id && !assignedRoles(actor).includes('admin')){res.status(403).json({error:'Only the audit owner or an administrator can retry this save.'});return;}
   if(record.storage?.status!=='saved')await deps.persist(record);
   res.json(record);
  }catch(error){const storage=auditStorageFailure(error);res.status(503).json({error:storage.message,storage});}
 };
}
