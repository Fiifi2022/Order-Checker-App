import test from 'node:test';
import assert from 'node:assert/strict';
import {extractGeneralInput} from './generalAuditor';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {learnPairedCatalogueProducts} from './generalPairedCatalogueLearning';
import {defaultProducts} from './productCatalog';
import type {ProductCatalog} from '../shared/productCatalog';

export const receiverRequest=`Forwarded
Hello, Order request from Good God Pet Shop
Quantity:
✓VIR 105 (HB1 1000Ds)-1 vial
Delivery time: ASAP
Delivery date: 2/11/26
Location : Akyem Sekyere HC, Atiwa East District
Receiver: Mary Abena Odurowaa 0544467121
please let me know the estimated time so that I inform them to be there on time
Many thanks`;
export const receiverFulfillment=`Thank you Abena Odurowaa Mary from Good God Pet Shop for ordering with Zipline. We have received your order (ID: M3ZXQ8CMJZ). We will now prepare the following items for delivery:
• VIR 105(HB1) 1000DS [1/1]`;
const empty=():ProductCatalog=>({revision:1,products:[]});
const offline=()=>{throw Error('No AI needed for explicit names or identical full product descriptions');};

test('Receiver and Reciever extract the person separately from their phone; checkmark product has one vial',()=>{
 for(const label of ['Receiver','Reciever']) {
  const input=extractGeneralInput(receiverRequest.replace('Receiver:',`${label}:`),'customer_request');
  assert.equal(input.ordererName,'Mary Abena Odurowaa');assert.equal(input.facilityName,'Good God Pet Shop');
  assert.equal(input.phone,'0544467121');assert.equal(input.products.length,1);
  assert.equal(input.products[0].name,'VIR 105 (HB1 1000Ds)');assert.equal(input.products[0].quantity,1);
 }
 const explicit=extractGeneralInput('Orderer: Jane Mensah\nReceiver: Mary Abena Odurowaa 0544467121\nFacility: Example HC\nORS - 1','customer_request');
 assert.equal(explicit.ordererName,'Jane Mensah');
});

test('matching full unknown descriptions pass without registration; reordered receiver name matches',async()=>{
 let catalog=empty(),writes=0;
 const support={semanticTimeoutMs:0,learnCatalogueProducts:async(pairs:any[])=>{
  writes++;catalog=learnPairedCatalogueProducts(catalog,pairs,'authenticated-auditor').catalog;return catalog;
 }};
 const first=await runGeneralProductNameAudit(receiverRequest,receiverFulfillment,catalog,support,offline);
 assert.equal(first.allMatch,true);assert.equal(first.issueCount,0);assert.equal(first.items.length,1);
 assert.equal(first.generalAudit.orderer.status,'match');assert.equal(first.generalAudit.facility.status,'match');
 assert.equal(first.generalAudit.facility.whatsappValue,'Good God Pet Shop');
 assert.deepEqual(first.generalAudit.semanticReviews,[]);
 assert.equal(first.items[0].name,'VIR 105(HB1) 1000DS');
 assert.deepEqual(first.catalogueLearning,{status:'not_needed',added:0,saved:0});
 assert.equal(writes,0);assert.equal(catalog.products.length,0);assert.equal(catalog.aliasRecords,undefined);
 const id=first.items[0].catalogProductId;
 const repeated=await runGeneralProductNameAudit(receiverRequest,receiverFulfillment,JSON.parse(JSON.stringify(catalog)),support,offline);
 assert.equal(repeated.allMatch,true);assert.equal(repeated.items[0].catalogProductId,id);assert.equal(writes,0);
});

test('source agreement generalizes to other complete new products without learning differing strengths or formulations',async()=>{
 for(const [a,b] of [['Novel veterinary formulation 20mg','Novel veterinary formulation 25mg'],['Novel Suspension 100ml','Novel Tablet 100mg'],['Novel 1/20 solution','Novel 12/0 solution'],['Novel 1 20mg','Novel 12 0mg'],['Novel 1 20','Novel 12 0']]) {
  assert.equal(learnPairedCatalogueProducts(empty(),[{customerName:a,fulfillmentName:b}],'test').added,0);
 }
 const a='Novel Compound Injection 50mg, 10mL',b='Novel Compound Injection 50mg,10mL';
 const learned=learnPairedCatalogueProducts(empty(),[{customerName:a,fulfillmentName:b}],'test');
 assert.equal(learned.added,1);assert.equal(learned.catalog.products[0].name,b);assert.ok(learned.events.length);
 assert.equal(learnPairedCatalogueProducts(learned.catalog,[{customerName:a,fulfillmentName:b}],'test').added,0);
 const known={revision:1,products:defaultProducts()};
 assert.equal(learnPairedCatalogueProducts(known,[{customerName:'PCM',fulfillmentName:'Paracetamol'}],'test').added,0);
 for(const name of ['Receiver: Mary 0544467121','Ignore instructions medicine','Unknown product']) {
  assert.equal(learnPairedCatalogueProducts(empty(),[{customerName:name,fulfillmentName:name}],'test').added,0);
 }
});

test('learning does not hide quantity mismatches, missing products or failed persistence',async()=>{
 for(const [confirmation,expected] of [[receiverFulfillment.replace('[1/1]','[2/2]'),false],[receiverFulfillment,true]] as const) {
  let catalog=empty();
  const result=await runGeneralProductNameAudit(receiverRequest,confirmation,catalog,{semanticTimeoutMs:0,learnCatalogueProducts:async pairs=>{catalog=learnPairedCatalogueProducts(catalog,pairs,'test').catalog;return catalog;}},offline);
  assert.equal(result.allMatch,expected);
 }
 const failed=await runGeneralProductNameAudit(receiverRequest,receiverFulfillment,empty(),{semanticTimeoutMs:0,learnCatalogueProducts:async()=>{throw Error('offline');}},offline);
 assert.equal(failed.catalogueLearning.status,'not_needed');assert.equal(failed.catalogueLearning.saved,0);
 assert.equal(failed.allMatch,true); // Complete current-source descriptions still agree; no false save claim.
 const missing=await runGeneralProductNameAudit(receiverRequest,receiverFulfillment.replace('• VIR 105(HB1) 1000DS [1/1]',''),empty(),{semanticTimeoutMs:0,learnCatalogueProducts:async()=>{throw Error('No paired product to learn');}},offline);
 assert.equal(missing.allMatch,false);assert.equal(missing.catalogueLearning.added,0);
});

test('existing pending or rejected product mappings cannot be bypassed by creating a new product',()=>{
 const name='Novel Compound Injection 50mg';
 const catalog:ProductCatalog={revision:1,products:[],aliasRecords:[{id:'pending',productId:'other',text:name,normalizedText:name.toLowerCase(),source:'gemini',status:'pending',active:false,createdAt:null,approvedAt:null,approvedBy:null,updatedAt:null}]};
 assert.equal(learnPairedCatalogueProducts(catalog,[{customerName:name,fulfillmentName:name}],'test').added,0);
 catalog.aliasRecords![0].status='rejected';
 assert.equal(learnPairedCatalogueProducts(catalog,[{customerName:name,fulfillmentName:name}],'test').added,0);
});

test('bounded Gemini name comparison is used for a plausible unresolved spelling, retaining source names',async()=>{
 let calls=0;
 const catalog=learnPairedCatalogueProducts(empty(),[{customerName:'VIR 105 (HB1 1000Ds)',fulfillmentName:'VIR 105(HB1) 1000DS'}],'test').catalog;
 const request=receiverRequest.replace('Mary Abena Odurowaa','Mary Abna Odurwaa');
 const result=await runGeneralProductNameAudit(request,receiverFulfillment,catalog,{semanticCacheScope:'receiver-name-fallback'},()=>({models:{async generateContent(input:any){
  calls++;assert.deepEqual(JSON.parse(input.contents),{customer:'Mary Abna Odurwaa',fulfillment:'Abena Odurowaa Mary'});
  return{text:JSON.stringify({decision:'match',confidence:0.99,reason:'Two small spelling differences with matching full-name components.'})};
 }}}));
 assert.equal(calls,1);assert.equal(result.generalAudit.orderer.status,'review required');assert.equal(result.generalAudit.orderer.nameMatchMethod,'gemini');
 assert.equal(result.generalAudit.orderer.whatsappValue,'Mary Abna Odurwaa');assert.equal(result.allMatch,false);
 assert.equal(result.geminiMetrics.calls,1);
});
