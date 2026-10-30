import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberGeneralAudit,restoreGeneralAudit} from './general-session.js';
test('extension retains the unsaved audit locally through a server read failure and scopes it to account and backend',async()=>{
 const prior=globalThis.chrome;const memory={authSession:{email:'owner@example.test'}};
 globalThis.chrome={storage:{session:{get:async()=>memory,set:async value=>Object.assign(memory,value)}}};
 try{
  const record={id:'AUD-local',whatsappMessage:'RDT 5',fulfillmentConfirmation:'Malaria RDT [0/1]',generalAudit:{},storage:{status:'failed',category:'network'}};
  await rememberGeneralAudit(record,'https://backend.test');
  const restored=await restoreGeneralAudit(async()=>{throw Error('offline');},'https://backend.test',record);
  assert.equal(restored.id,record.id);assert.equal(restored.storage.status,'failed');
  assert.equal(await restoreGeneralAudit(async()=>record,'https://other.test',record),null);
  memory.authSession.email='another@example.test';assert.equal(await restoreGeneralAudit(async()=>record,'https://backend.test',record),null);
 }finally{globalThis.chrome=prior;}
});
