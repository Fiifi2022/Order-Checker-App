import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import {applyGeneralOrderLimitDecision,generalFourParameterRecord} from './generalAuditor';
import {assertGeneralProductEvidence} from '../src/utils/generalProductEvidence';
import {generalCatalogAttributeConflict} from '../src/utils/generalProductLog';
import type {ProductCatalog} from '../shared/productCatalog';

const product=(id:string,name:string,aliases:string[]=[])=>({id,name,aliases,scope:'general' as const,category:'medicine',contextualAliases:[],note:''});
const broad:ProductCatalog={revision:9500,products:[product('art','Artesunate',['Artesunate 60mg Injection','Artesunate 120mg Injection','Injection Artesunate 60mg','Injection Artesunate 120mg'])]};
const specific:ProductCatalog={revision:9501,products:[product('art60','Artesunate 60mg Injection'),product('art120','Artesunate 120mg Injection')]};
const header='Name: Ama Mensah\nFacility: Example HC\n';
const request='Artesunate 60mg Injection - 10\nArtesunate 120mg Injection - 20';
const supplied='Artesunate 120mg Injection [20/20]\nArtesunate 60mg Injection [10/10]';
async function run(a=request,b=supplied,c=broad){
  applyCatalog(c);let calls=0;
  const result=await runGeneralProductNameAudit(header+a,header+b,c,{requestLanguage:true,deferProductResearch:true,semanticTimeoutMs:0},()=>{calls++;throw Error('No AI needed for source variants');});
  return {...result,id:'variant-audit',calls,whatsappMessage:header+a,fulfillmentConfirmation:header+b};
}
for(const [label,catalog] of [['broad catalogue ID',broad],['specific catalogue IDs',specific],['unknown catalogue products',{revision:9502,products:[]}]] as const){
  test(`matching strengths remain separate with a ${label}, including reordered FS entries`,async()=>{
    const result=await run(request,supplied,catalog as ProductCatalog);
    assert.equal(result.allMatch,true);assert.equal(result.calls,0);assert.equal(result.items.length,2);
    assert.equal(result.generalAudit.productCount.requested,2);assert.equal(result.generalAudit.productCount.found,2);
    assert.deepEqual(result.items.map(item=>[item.name,item.fulfillment.requested,item.fulfillment.supplied]),[
      ['Artesunate 60mg Injection',10,10],['Artesunate 120mg Injection',20,20]
    ]);
    assert.notEqual(result.items[0].fulfillment.key,result.items[1].fulfillment.key);
    assert.equal(generalFourParameterRecord(result).allMatch,true);
  });
}
test('equal combined quantities cannot hide quantities swapped between strengths',async()=>{
  const result=await run(request,'Artesunate 60mg Injection [20/20]\nArtesunate 120mg Injection [10/10]');
  assert.equal(result.allMatch,false);assert.equal(result.items.length,2);
  assert.deepEqual(result.items.map(i=>[i.fulfillment.requested,i.fulfillment.supplied]),[[10,20],[20,10]]);
});
test('a missing strength cannot borrow the quantity of another strength',async()=>{
  const result=await run(request,'Artesunate 120mg Injection [30/30]');
  assert.equal(result.allMatch,false);
  assert.equal(result.items.find(i=>i.name.includes('60mg'))!.status,'missing item');
  assert.equal(result.items.find(i=>i.name.includes('120mg'))!.fulfillment.requested,20);
});
test('a single different stated strength cannot pass through a broad approved alias',async()=>{
  const result=await run('Artesunate 60mg Injection - 10','Artesunate 120mg Injection [10/10]');
  assert.equal(result.allMatch,false);assert.ok(result.items.some(i=>!!i.fulfillment.identityError));
});
test('stockouts belong to their own strength and cannot absorb another strength’s delivery',async()=>{
  const result=await run(request,'Artesunate 60mg Injection [0/1]\nArtesunate 120mg Injection [20/20]');
  assert.equal(result.allMatch,true);assert.equal(result.items.length,2);
  assert.equal(result.items.find(i=>i.name.includes('60mg'))!.status,'out of stock');
  assert.equal(result.items.find(i=>i.name.includes('120mg'))!.status,'match');
  assert.equal(result.items.find(i=>i.name.includes('60mg'))!.fulfillment.supplied,0);
});
test('duplicates aggregate only within the same strength',async()=>{
  const result=await run('Artesunate 60mg Injection - 4\nArtesunate 120mg Injection - 20\nArtesunate 60mg Injection - 6');
  assert.equal(result.allMatch,true);assert.equal(result.items.length,2);
  assert.equal(result.items.find(i=>i.name.includes('60mg'))!.fulfillment.requested,10);
  assert.equal(result.items.find(i=>i.name.includes('120mg'))!.fulfillment.requested,20);
});
test('word order and omitted formulation do not create false mismatches for the same strength',async()=>{
  const result=await run('Artesunate 60mg - 10\nArtesunate 120mg - 20','Injection Artesunate 120mg [20/20]\nInjection Artesunate 60mg [10/10]');
  assert.equal(result.allMatch,true);assert.equal(result.items.length,2);
});
test('an order-limit decision for one strength cannot clear the other strength',async()=>{
  const result=await run(request,'Artesunate 60mg Injection [5/5]\nArtesunate 120mg Injection [10/10]');
  const first=result.items.find(i=>i.name.includes('60mg'))!,second=result.items.find(i=>i.name.includes('120mg'))!;
  const approved=applyGeneralOrderLimitDecision(result,first.fulfillment.key,true);
  assert.equal(approved.allMatch,false);
  assert.equal(approved.items.find(i=>i.fulfillment.key===second.fulfillment.key)!.fulfillment.orderLimitDecision,undefined);
  assert.equal(applyGeneralOrderLimitDecision(approved,second.fulfillment.key,true).allMatch,true);
});
test('runtime evidence checks reject a cleared aggregate containing different strengths under one ID',async()=>{
  const result=await run();const invalid=structuredClone(result.items[0]);
  invalid.provenance.push(...result.items[1].provenance);
  assert.throws(()=>assertGeneralProductEvidence([invalid]),/consistency check failed/);
  assert.doesNotThrow(()=>assertGeneralProductEvidence(result.items));
});
for(const [label,a,b] of [
  ['formulations','Test Medicine 60mg Tablet','Test Medicine 60mg Injection'],
  ['container sizes','Test Medicine Solution 100mL','Test Medicine Solution 200mL'],
  ['concentrations','Test Medicine Injection 2mg/mL','Test Medicine Injection 4mg/mL'],
  ['percentage strengths','Test Medicine 5% Infusion, 500mL','Test Medicine 10% Infusion, 500mL']
] as const)test(`distinct ${label} under one broad catalogue ID each retain their own quantities`,async()=>{
  const c:ProductCatalog={revision:9510,products:[product('test-medicine','Test Medicine',[a,b])]};
  const result=await run(`${a} - 10\n${b} - 20`,`${b} [20/20]\n${a} [10/10]`,c);
  assert.equal(result.allMatch,true);assert.equal(result.items.length,2);
  assert.deepEqual(result.items.map(i=>[i.fulfillment.requested,i.fulfillment.supplied]),[[10,10],[20,20]]);
  if(label==='percentage strengths'){
    assert.ok(generalCatalogAttributeConflict('D5%','D10%'));
    assert.equal(generalCatalogAttributeConflict('D5%','Dextrose 5% Infusion'),undefined);
  }
});
test('equivalent concentration wording stays paired within its own presentation',async()=>{
  const a='Diclofenac 75mg/3mL Injection',b='Diclofenac 25mg/mL Injection, 3mL';
  const c:ProductCatalog={revision:9511,products:[product('diclo','Diclofenac',[a,b,'Diclofenac 50mg/mL Injection, 3mL'])]};
  const result=await run(`${a} - 10\nDiclofenac 50mg/mL Injection, 3mL - 20`,`${b} [10/10]\nDiclofenac 50mg/mL Injection, 3mL [20/20]`,c);
  assert.equal(result.allMatch,true);assert.equal(result.items.length,2);
});
