import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccessAuditRecord,assertUnchangedAuditOwner} from './auditRecordAccess';
import {orderLimitAcknowledgementHandler} from './orderLimitAcknowledgement';
import {generalProductConfirmationHandler} from './generalProductConfirmation';
import {runGeneralAuditor} from './generalAuditor';
import {applyCatalog,defaultProducts} from './productCatalog';

test('owned audits allow their owner and assigned administrators, while retaining ownerless legacy policy',()=>{
  const record={createdByUserId:'owner'};
  assert.equal(canAccessAuditRecord(record,{id:'owner',role:'cca'}),true);
  assert.equal(canAccessAuditRecord(record,{id:'other',role:'cca'}),false);
  assert.equal(canAccessAuditRecord(record,undefined),false);
  assert.equal(canAccessAuditRecord(record,{id:'admin',roles:['cca','admin']}),true);
  assert.equal(canAccessAuditRecord(record,{id:'other',role:'admin',roles:['cca']}),false);
  assert.equal(canAccessAuditRecord({}, {id:'legacy',role:'cca'}),true);
});

test('storage transactions cannot transfer or remove an established owner',()=>{
  assert.throws(()=>assertUnchangedAuditOwner({createdByUserId:'owner'},{createdByUserId:'other'}),(error:any)=>error.status===403 && error.code===7);
  assert.throws(()=>assertUnchangedAuditOwner({createdByUserId:'owner'},{}));
  assert.doesNotThrow(()=>assertUnchangedAuditOwner({createdByUserId:'owner'},{createdByUserId:'owner'}));
  assert.doesNotThrow(()=>assertUnchangedAuditOwner(undefined,{createdByUserId:'new-owner'}));
});

async function invoke(handler:any,actor:any,body:any){
  let status=200,value:any;
  await handler({params:{id:'AUD-owned'},body},{locals:{authUser:actor},status(code:number){status=code;return this;},json(data:any){value=data;return this;}});
  return {status,value};
}

test('order-limit mutations reject another account before changing or saving the audit',async()=>{
  applyCatalog({revision:1,products:defaultProducts()});
  const header='Orderer: Grace Akabati\nFacility: Example HC\n';
  const record={...runGeneralAuditor(header+'ORS 5',header+'ORS [3/5]'),createdByUserId:'owner',id:'AUD-owned'};
  let writes=0;
  const handler=orderLimitAcknowledgementHandler({read:async()=>record,save:async()=>{writes++;}});
  const body={key:record.items[0].fulfillment.key,answer:true};
  assert.equal((await invoke(handler,{id:'other',role:'cca'},body)).status,403);
  assert.equal((await invoke(handler,undefined,body)).status,403);assert.equal(writes,0);
  assert.equal(record.items[0].fulfillment.orderLimitDecision,undefined);
  assert.equal((await invoke(handler,{id:'owner',role:'cca'},body)).status,200);
  assert.equal((await invoke(handler,{id:'admin',role:'admin'},body)).status,200);assert.equal(writes,2);
});

test('product confirmation enforces ownership before idempotent retries or customer evidence checks',async()=>{
  let saves=0;
  const record={createdByUserId:'owner',generalAudit:{},whatsappMessage:'RDT 5',fulfillmentConfirmation:'RDT [5/5]'};
  const handler=generalProductConfirmationHandler({read:async()=>record,save:async()=>{saves++;}});
  const body={key:'rdt',productKey:'rdt',customerContactConfirmed:true,whatsappMessage:'RDT 5',fulfillmentConfirmation:'RDT [5/5]'};
  assert.equal((await invoke(handler,{id:'other',role:'cca'},body)).status,403);
  assert.equal(saves,0);
  assert.equal((await invoke(handler,{id:'owner',role:'cca'},body)).status,400,'Owner reaches the existing product validation');
});
