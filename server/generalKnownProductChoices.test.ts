import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applySourceProductConfirmation} from './generalSourceProductConfirmation';
import {applyGeneralOrderLimitDecision} from './generalAuditor';
import {localSourceComparisonSuggestions} from './generalComparisonSuggestions';
import {applyCatalog} from './productCatalog';
import {catalogAliasKey,type ProductCatalog} from '../shared/productCatalog';

const product=(id:string,name:string,aliases:string[]=[])=>({id,name,scope:'general' as const,category:'medicine',aliases,contextualAliases:[],note:''});
const catalog:ProductCatalog={revision:9401,products:[
  product('folic-generic','Folic Acid',['Folate']),product('folic5','Folic acid 5mg Tablet'),
  product('folic1','Folic acid 1mg Tablet'),product('iron-folic','Iron + Folic Acid'),
  product('d5','Dextrose 5% Infusion, 500mL',['D5%']),
  product('rl',"Ringer's Lactate Solution, 500 ml",['Ringers lactate'])
]};
const customer=`Date*: 04/11/26
Name of Orderer: Francis Quarshie
Name of Health Facility: Akokoaso health center
Delivery/ Drop area:
District: Sekyere East *Products and Quantities
1. Folic acid=4 boxes
2. D5%=15
3. Ringers lactate=10`;
const fulfillment=`Thank you Francis Quarshie from Akokoaso HC (Sekyere East) for ordering with Zipline. We have received your order (ID: TZIQ93RTT6).
We are currently out of stock for the following items:
- Dextrose 5% Infusion, 500mL [0/1]
We can prepare the following items we have in stock for delivery:
- Folic acid 5mg Tablet [1/1]
- Ringer's Lactate Solution, 500 ml [10/10]
Please reach out to the nearest stock for the rest of the order. Once re-stocked, we will notify you and be able to deliver the rest, if still needed. Let us know if any changes are required or contact 0800719102 if any questions.
You will receive your flight notifications via SMS
Use this link to track your order: https://orders.zipline.com/t/7/TZIQ93RTT6`;
async function audit(){
  applyCatalog(catalog);let calls=0;
  const result=await runGeneralProductNameAudit(customer,fulfillment,catalog,{requestLanguage:true,deferProductResearch:true,semanticTimeoutMs:0},()=>{calls++;throw Error('Local choices must not require AI');});
  return {record:{...result,id:'known-product-choice',whatsappMessage:customer,fulfillmentConfirmation:fulfillment},calls};
}
test('known generic and FS presentation IDs offer the actual FS product rather than an empty chooser',async()=>{
  const {record,calls}=await audit();assert.equal(calls,0);assert.equal(record.allMatch,false);
  const group=record.generalAudit.catalogueSuggestions!.find(g=>g.alias.toLowerCase()==='folic acid')!;
  assert.ok(group);assert.equal(group.researchStatus,'catalogue');assert.equal(group.options.length,1);
  assert.equal(group.options[0].sourceName,'Folic acid 5mg Tablet');assert.equal(group.options[0].kind,'source');
  assert.equal(record.items.find(i=>i.name.includes('Dextrose'))!.status,'out of stock');
  assert.equal(record.items.find(i=>i.name.includes('Lactate'))!.status,'match');
});
test('confirmed known-product choice restores quantity checks and the approved order-limit workflow in the same audit',async()=>{
  const {record}=await audit(),before=JSON.stringify(catalog);
  const alias=record.generalAudit.catalogueSuggestions![0].alias;
  const confirmed=applySourceProductConfirmation(record,alias,'Folic acid 5mg Tablet',catalog,{id:'cca',name:'CCA'});
  assert.equal(confirmed.id,record.id);assert.equal(confirmed.allMatch,false);
  assert.equal(confirmed.generalAudit.catalogueSuggestions.length,0);
  const folic=confirmed.items.find(i=>i.name==='Folic acid 5mg Tablet')!;
  assert.equal(folic.fulfillment.requested,4);assert.equal(folic.fulfillment.supplied,1);
  assert.equal(folic.fulfillment.identityError,undefined);assert.equal(folic.fulfillment.orderLimitEligible,true);
  const approved=applyGeneralOrderLimitDecision(confirmed,folic.fulfillment.key,true);
  assert.equal(approved.allMatch,true);assert.equal(JSON.stringify(catalog),before,'The generic catalogue ID must not be reassigned');
  assert.equal(approved.items.find(i=>i.name.includes('Dextrose'))!.status,'out of stock');
});
test('rejecting the order-limit explanation keeps the real quantity discrepancy',async()=>{
  const {record}=await audit();const confirmed=applySourceProductConfirmation(record,record.generalAudit.catalogueSuggestions![0].alias,'Folic acid 5mg Tablet',catalog,{id:'cca',name:'CCA'});
  const folic=confirmed.items.find(i=>i.name==='Folic acid 5mg Tablet')!;
  assert.equal(applyGeneralOrderLimitDecision(confirmed,folic.fulfillment.key,false).allMatch,false);
});
test('known-product choices cannot equate different ingredients, strengths or rejected mappings',()=>{
  assert.equal(localSourceComparisonSuggestions(['Folic Acid'],['Iron + Folic Acid'],catalog).size,0);
  assert.equal(localSourceComparisonSuggestions(['Folic acid 1mg Tablet'],['Folic acid 5mg Tablet'],catalog).size,0);
  const rejected={...catalog,aliasRecords:[{id:'reject',productId:'folic5',text:'Folic Acid',normalizedText:catalogAliasKey('Folic Acid'),source:'manual' as const,status:'rejected' as const,active:false,createdAt:null,approvedAt:null,approvedBy:null,updatedAt:null}]};
  assert.equal(localSourceComparisonSuggestions(['Folic Acid'],['Folic acid 5mg Tablet'],rejected).size,0);
});
test('already matched catalogue entries do not acquire spurious alternative-product questions',()=>{
  assert.equal(localSourceComparisonSuggestions(['Folate'],['Folic Acid','Folic acid 5mg Tablet'],catalog).size,0);
  assert.equal(localSourceComparisonSuggestions(['Folic Acid','Folic acid 5mg Tablet'],['Folic acid 5mg Tablet'],catalog).size,0,'Do not offer an FS entry already accounted for by another requested product');
});
