import test from 'node:test';
import assert from 'node:assert/strict';
import {startGeneralAuditReferenceReads} from './generalAuditReferenceReads';
import {sharedOptionalAuditBudget,waitForOptionalAuditWrite} from './auditBudget';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import {createAuditStorage} from './auditStorage';
import {AUDIT_BACKGROUND_WAIT_MS} from '../shared/auditPerformance';
import type {ProductCatalog} from '../shared/productCatalog';

const deferred = <T>() => {let resolve!: (value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('fresh facility and optional identity reads start together and are not cached across audits',async()=>{
  const directory=deferred<{revision:number}>(),sheets=deferred<string[]>();
  const started:string[]=[];
  const reads=startGeneralAuditReferenceReads(()=>{started.push('directory');return directory.promise;},()=>{started.push('sheets');return sheets.promise;},1000);
  await tick();assert.deepEqual(started,['directory','sheets']);
  directory.resolve({revision:1});sheets.resolve(['current']);
  assert.deepEqual(await reads.directory,{value:{revision:1}});
  assert.deepEqual(await reads.identity,{sheets:['current']});
  const next=startGeneralAuditReferenceReads(async()=>({revision:2}),async()=>['changed'],1000);
  assert.deepEqual(await next.directory,{value:{revision:2}});
  assert.deepEqual(await next.identity,{sheets:['changed']});
});

test('a required directory failure cannot be converted to usable reference data',async()=>{
  const reads=startGeneralAuditReferenceReads(async()=>{throw Error('permission');},async()=>[],1000);
  assert.ok('error' in await reads.directory);
  assert.deepEqual(await reads.identity,{sheets:[]});
});

test('optional Blueprint identity enrichment is bounded while the fresh directory survives',async()=>{
  const reads=startGeneralAuditReferenceReads(async()=>({revision:3}),()=>new Promise<never>(()=>{}),10);
  assert.deepEqual(await reads.directory,{value:{revision:3}});
  assert.deepEqual(await reads.identity,{sheets:null});
});

test('sequential optional stages consume one allowance instead of renewing it',async()=>{
  const remaining=sharedOptionalAuditBudget(100);
  const first=remaining();await sleep(25);const second=remaining();
  assert.ok(second<first-10);
  assert.equal(sharedOptionalAuditBudget(0)(),0);
});

const catalog:ProductCatalog={revision:1600,products:[{id:'asv',name:'Snake Venom Antiserum',scope:'general',aliases:['ASV'],contextualAliases:[],category:'medicine',note:''}]};
const header='Orderer: Test Operator\nFacility: Example HC\n';
test('the real extraction and catalogue AI stages share a deadline and keep unresolved evidence',async()=>{
  applyCatalog(catalog);
  const timeouts:number[]=[],signals:AbortSignal[]=[];
  const empty=()=>({facilityName:null,ordererName:null,products:[],deliveryArea:null,district:null,unresolvedFields:['products'],extractionConfidence:0});
  const result=await runGeneralProductNameAudit(header+'Please send enigmatic venom compound 2',header+'Snake Venom Antiserum [2/2]',catalog,
    {semanticTimeoutMs:240,semanticCacheScope:'speed-shared-ai'},()=>({models:{generateContent:async(options:any)=>{
      timeouts.push(options.config.httpOptions.timeout);signals.push(options.config.abortSignal);
      const input=JSON.parse(options.contents);
      if(input.customer || input.fulfillment) {await sleep(100);return {text:JSON.stringify({customer:empty(),fulfillment:empty()})};}
      return new Promise<never>(()=>{});
    }}}));
  assert.equal(timeouts.length,2);
  assert.ok(timeouts[1]<timeouts[0]-60,JSON.stringify(timeouts));
  await sleep(10); // The shared SDK owner has the same deadline as this caller.
  assert.equal(signals[1].aborted,true);
  assert.equal(result.allMatch,false);
  assert.equal(result.generalAudit.finalStatus,'REVIEW REQUIRED');
  assert.equal(result.aliasLearning.saved,0);
});

test('catalogue matches still require no AI and preserve quantity discrepancies',async()=>{
  applyCatalog(catalog);let calls=0;
  for(const [ratio,matches] of [['[2/2]',true],['[3/3]',false],['[0/2]',true]] as const) {
    const result=await runGeneralProductNameAudit(header+'ASV 2',header+'Snake Venom Antiserum '+ratio,catalog,{semanticTimeoutMs:240},()=>{calls++;throw Error('Unexpected Gemini');});
    assert.equal(result.allMatch,matches);
  }
  assert.equal(calls,0);
});

test('optional writes return pending within their allowance without falsely claiming completion',async()=>{
  const write=deferred<number>();
  assert.deepEqual(await waitForOptionalAuditWrite(write.promise,5),{completed:false});
  write.resolve(1);await tick();
  assert.deepEqual(await waitForOptionalAuditWrite(Promise.resolve(1),5),{completed:true,value:1});
  await assert.rejects(waitForOptionalAuditWrite(Promise.reject(Error('permission')),5),/permission/);
});

test('faster audit-save responses preserve confirmed-write status and stable-ID retry semantics',async()=>{
  assert.equal(AUDIT_BACKGROUND_WAIT_MS,200);
  const write=deferred<void>();let writes=0;
  const storage=createAuditStorage(async()=>{writes++;await write.promise;});
  const record:any={id:'speed-audit'};
  await storage.persist(record,5);
  assert.equal(record.storage.status,'pending');
  write.resolve();await tick();
  assert.equal(record.storage.status,'saved');
  assert.equal(writes,1);
});

test('a slow alias suggestion write returns pending without accepting the proposed clinical equivalence',async()=>{
  applyCatalog(catalog);const queued=deferred<void>();let submissions=0;
  try {
    const result=await runGeneralProductNameAudit(header+'Enigmatic venom compound 2',header+'Snake Venom Antiserum [2/2]',catalog,
      {semanticTimeoutMs:1000,semanticCacheScope:'speed-suggestion-save',suggestCatalogueAliases:async()=>{submissions++;await queued.promise;}},
      ()=>({models:{generateContent:async()=>({text:JSON.stringify({matches:[{alias:'Enigmatic venom compound',productId:'asv',confidence:0.99,clinicalUncertainty:true}]})})}}));
    assert.equal(submissions,1);
    assert.equal(result.aliasLearning.status,'queue_pending');
    assert.equal(result.aliasLearning.saved,0);
    assert.equal(result.allMatch,false);
    assert.equal(result.generalAudit.finalStatus,'REVIEW REQUIRED');
  } finally {queued.resolve();}
});
