import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {defaultProducts,applyCatalog} from './productCatalog';
import {assertGeneralProductEvidence} from '../src/utils/generalProductEvidence';

const header='Name: Ama Mensah\nFacility: Example HC\n';
const noAI=()=>{throw Error('Known regression examples require no AI');};
async function audit(customer:string,fulfillment:string){
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 return runGeneralProductNameAudit(header+customer,header+fulfillment,catalog,{semanticTimeoutMs:0},noAI);
}

test('one unknown request and one unrelated known fulfilment are never paired by elimination',async()=>{
 const r=await audit('Unlisted Green Remedy (3)','Paracetamol 500mg Tablet [3/3]');
 assert.equal(r.allMatch,false);
 assert.ok(!r.items.some(item=>item.provenance.some(p=>p.source==='customer_request')&&item.provenance.some(p=>p.source==='fulfillment_confirmation')));
 assert.ok(r.items.some(item=>item.fulfillment.identityReviewRequired&&/paracetamol/i.test(item.name)));
 assert.ok(!r.items.some(item=>['missing item','extra item'].includes(item.status)),'An unknown counterpart cannot prove an omission or extra product');
 assert.ok(r.items.some(item=>item.fulfillment.identityReviewRequired));
});

test('approved vaccine alias variations and source ordering cannot generate missing/extra or diluent warnings',async()=>{
 for(const [bcg,yf] of [['BCG','Y/F'],['B.C.G.','YF'],['Bacille Calmette-Guerin Vaccine','Yellow Fever Vaccine']]){
  for(const reverse of [false,true]){
   const request=[`${bcg} (3)`,`${yf} (3)`];if(reverse)request.reverse();
   const supply=['Bacille Calmette-Guerin Vaccine [3/3]','Bacille Calmette-Guerin Vaccine Diluent [3/3]'];if(reverse)supply.reverse();
   const r=await audit(request.join('\n'),supply.join('\n')+'\nYellow Fever Vaccine [0/1]');
   assert.equal(r.allMatch,true,`${bcg}, ${yf}, reverse=${reverse}: ${JSON.stringify(r.items.map(i=>({name:i.name,status:i.status})))}`);
   assert.equal(r.issueCount,0);assert.ok(!r.items.some(item=>item.fulfillment.vaccinePairingError));
   assert.equal(r.items.find(item=>/Yellow Fever Vaccine$/.test(item.name))?.status,'out of stock');
   assert.equal(r.geminiMetrics.calls,0);
  }
 }
});

test('runtime consistency guard refuses a cleared product containing different canonical IDs',async()=>{
 const r=await audit('Paracetamol 500mg Tablet (3)','Paracetamol 500mg Tablet [3/3]');
 assert.equal(r.allMatch,true);assert.doesNotThrow(()=>assertGeneralProductEvidence(r.items));
 const corrupt=structuredClone(r.items);
 const fs=corrupt[0].provenance.find(p=>p.source==='fulfillment_confirmation')!;fs.canonicalId='another-product-id';
 assert.throws(()=>assertGeneralProductEvidence(corrupt),/consistency check failed/);
});

test('genuine differences remain blocked by the safeguards',async()=>{
 for(const [request,fulfillment] of [
  ['Paracetamol 500mg Tablet (5)','Paracetamol 500mg Tablet [3/3]'],
  ['Paracetamol 500mg Tablet (3)','Paracetamol 250mg Tablet [3/3]'],
  ['BCG (3)','Bacille Calmette-Guerin Vaccine [3/3]'],
 ]){
  assert.equal((await audit(request,fulfillment)).allMatch,false);
 }
});

test('different known catalogue products still produce genuine missing and extra findings',async()=>{
 const r=await audit('Paracetamol 500mg Tablet (3)','Artesunate 120mg Injection [3/3]');
 assert.equal(r.allMatch,false);assert.equal(r.items.filter(item=>item.status==='missing item').length,1);
 assert.equal(r.items.filter(item=>item.status==='extra item').length,1);
});
