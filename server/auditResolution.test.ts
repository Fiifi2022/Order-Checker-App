import test from 'node:test';
import assert from 'node:assert/strict';
import {auditResolutionHandler} from './auditResolution';
import {createAuditStorage} from './auditStorage';
const seed=()=>({id:'AUD-resolution',createdByUserId:'owner',status:'pending',allMatch:false,issueCount:2,
  generalAudit:{finalStatus:'DISCREPANCY DETECTED'},whatsappMessage:'RDT 5',fulfillmentConfirmation:'RDT [6/6]'});
async function invoke(handler:any,body:any,actor:any={id:'owner',role:'cca'}){
  let status=200,value:any;
  await handler({params:{id:'AUD-resolution'},body},{locals:{authUser:actor},status(code:number){status=code;return this;},json(data:any){value=data;return this;}});
  return {status,value};
}

test('failed resolution saves remain locally retained without changing the genuine audit verdict',async()=>{
  let current:any=seed();
  const storage=createAuditStorage(async()=>{throw {code:14};});
  const handler=auditResolutionHandler({read:async()=>current,save:async record=>{current=record;await storage.persist(record,10);}});
  const result=await invoke(handler,{status:'resolved',resolutionNotes:'Corrected the entry; re-audit required.'});
  assert.equal(result.status,200);assert.equal(result.value.storage.status,'failed');assert.equal(result.value.storage.category,'network');
  assert.equal(current.resolutionNotes,'Corrected the entry; re-audit required.');
  assert.equal(current.allMatch,false);assert.equal(current.generalAudit.finalStatus,'DISCREPANCY DETECTED');assert.equal(current.resolvedIssueCount,2);
});

test('slow resolution saves stay pending until the actual database write completes',async()=>{
  let current:any=seed(),finish!:()=>void;
  const storage=createAuditStorage(()=>new Promise<void>(resolve=>finish=resolve));
  const handler=auditResolutionHandler({read:async()=>current,save:async record=>{current=record;await storage.persist(record,2);}});
  const response=await invoke(handler,{status:'resolved',resolutionNotes:'Corrected'});
  assert.equal(response.value.storage.status,'pending');assert.equal(response.value.storage.savedAt,undefined);
  finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(current.storage.status,'saved');
});

test('resolution ownership, status and note validation prevent writes from invalid requests',async()=>{
  let writes=0;
  const handler=auditResolutionHandler({read:async()=>seed(),save:async()=>{writes++;}});
  assert.equal((await invoke(handler,{status:'resolved',resolutionNotes:'Changed'},{id:'other',role:'cca'})).status,403);
  for(const body of [{status:'anything',resolutionNotes:'X'},{status:'resolved',resolutionNotes:{text:'X'}},{status:'resolved',resolutionNotes:'   '}]) {
    assert.equal((await invoke(handler,body)).status,400);
  }
  assert.equal(writes,0);
});

test('concurrent resolution edits are serialized and keep the first confirmed resolution timestamp',async()=>{
  let current:any=seed(),release!:()=>void;
  const held=new Promise<void>(resolve=>release=resolve);let saves=0;
  const handler=auditResolutionHandler({read:async()=>current,save:async record=>{
    if(++saves===1)await held;current={...record,storage:{status:'saved'}};Object.assign(record,current);
  }});
  const first=invoke(handler,{status:'resolved',resolutionNotes:'First correction'});
  await new Promise(resolve=>setImmediate(resolve));
  const second=invoke(handler,{resolutionNotes:'Additional correction'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(saves,1);
  release();const [a,b]=await Promise.all([first,second]);
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(saves,2);
  assert.equal(current.resolutionNotes,'Additional correction');assert.equal(a.value.resolvedAt,b.value.resolvedAt);
});

test('legacy non-General resolution never tells the client to clear inputs before saving is confirmed',async()=>{
  const record={...seed(),generalAudit:undefined};
  const handler=auditResolutionHandler({read:async()=>record,save:async updated=>{updated.storage={status:'failed'};}});
  const response=await invoke(handler,{status:'resolved',resolutionNotes:'Changed'});
  assert.equal(response.status,503);assert.match(response.value.error,/retained locally/);
});
