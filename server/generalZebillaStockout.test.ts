import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCatalog,defaultProducts} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {changeCatalogueAlias} from './catalogAliasLearning';
import {applyCatalogueConfirmation} from './generalCatalogueConfirmation';
import {classifyGeneralText} from '../src/utils/generalTextClassification';
import {compareGeneralFacilities} from '../src/utils/generalFacility';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog} from '../shared/productCatalog';

const customer='Mr Timothy  Ndebugre from zebilla Hospital  i need full course of ARV venom -4';
const footer='Please reach out to the nearest stock for these items. Once re-stocked, we will notify you and be able to deliver them. Let us know if any changes are required or if you have questions.';
const confirmation=`Thank you Ndebugre Timothy from Zebilla District HSP for ordering with Zipline. We have received your order (ID: TEST-ZEBILLA). We are currently out of stock for the following items:\n- Anti Rabies Vaccine Injection [0/1]\n${footer}\nUse this link to track your order: https://orders.zipline.com/t/8/TEST-ZEBILLA`;
const context={records:[{id:'test-zebilla',name:'Zebilla District HSP',source:'test/zebilla'}]};
const seed=():ProductCatalog=>({revision:9600,products:defaultProducts()});
const noAI=()=>{throw Error('Approved catalogue identity needs no Gemini call');};
const compare=(left:string,right:string,records=context.records)=>compareGeneralFacilities(left,right,`Facility: ${left}`,`Facility: ${right}`,{records});

for(const text of [footer,'Let us know if any changes are required or if you have questions.','Let us know if any changes are required or if you have any questions.'])test(`stockout notification is not an unread product: ${text}`,()=>{
 assert.equal(classifyGeneralText(text).category,'administrative');
 for(const tail of [' Please send ASV 4.',' Replace the product with ASV 4.',' ASV 4'])assert.notEqual(classifyGeneralText(text+tail).category,'administrative');
});

test('hospital level omission resolves through one directory identity, without a blanket type equivalence',()=>{
 for(const [a,b] of [['Zebilla Hospital','Zebilla District HSP'],['Zebilla District HSP','Zebilla Hospital']]){
  const result=compare(a,b);assert.equal(result.status,'match');assert.equal(result.customerFacilityId,'test-zebilla');assert.equal(result.fulfillmentFacilityId,'test-zebilla');
 }
 assert.notEqual(compare('Zebilla Hospital','Zebilla District HSP',[]).status,'match');
 for(const a of ['Zebilla HC','Other Hospital','Zebilla SHS Hospital'])assert.notEqual(compare(a,'Zebilla District HSP').status,'match');
 const distinct=[...context.records,{id:'other-zebilla',name:'Zebilla Hospital',source:'test/other-zebilla'}];
 assert.equal(compare('Zebilla Hospital','Zebilla District HSP',distinct).status,'mismatch');
 const duplicate=[...context.records,{...context.records[0],id:'other-zebilla',source:'test/duplicate-zebilla'}];
 assert.notEqual(compare('Zebilla Hospital','Zebilla District HSP',duplicate).status,'match');
});

test('exact natural-language stockout offers an unapproved product choice, then confirms the same audit',async()=>{
 let catalog=seed();applyCatalog(catalog);
 const product=catalog.products.find(p=>p.name==='Anti Rabies Vaccine Injection')!;
 const pending=await runGeneralProductNameAudit(customer,confirmation,catalog,{facilityContext:context,semanticTimeoutMs:1000,semanticCacheScope:'zebilla-stockout'},()=>({models:{async generateContent(){return{text:JSON.stringify({matches:[{alias:'ARV venom',productId:product.id,confidence:.9,clinicalUncertainty:true,reason:'Verify whether ARV means the rabies vaccine; venom wording is ambiguous.'}]})};}}}));
 assert.equal(pending.generalAudit.orderer.status,'match');assert.equal(pending.generalAudit.facility.status,'match');
 assert.equal(pending.allMatch,false);assert.equal(pending.issueCount,0);assert.equal(pending.generalAudit.extraction?.customer.products[0].quantity,4);
 assert.ok(!pending.generalAudit.semanticReviews?.some(review=>review.source==='fulfillment_confirmation'));
 assert.equal(pending.generalAudit.catalogueSuggestions![0].options[0].productId,product.id);
 catalog=changeCatalogueAlias(catalog,{revision:catalog.revision,action:'propose',text:'ARV venom',productId:product.id},'Test user').catalog;
 const alias=catalog.aliasRecords!.find(row=>row.text==='ARV venom')!;
 catalog=changeCatalogueAlias(catalog,{revision:catalog.revision,action:'approve',id:alias.id,identityConfirmed:true},'Test user').catalog;applyCatalog(catalog);
 const confirmed=applyCatalogueConfirmation({...pending,id:'same-stockout-audit',whatsappMessage:customer,fulfillmentConfirmation:confirmation},'ARV venom',product.id,catalog,{id:'test-editor',name:'Test editor'});
 assert.equal(confirmed.id,'same-stockout-audit');assert.equal(confirmed.allMatch,true,JSON.stringify(confirmed.generalAudit));
 assert.equal(confirmed.issueCount,0);assert.equal(confirmed.generalAudit.stockStatus,'out of stock');assert.equal(confirmed.items.length,1);
 assert.equal(confirmed.items[0].fulfillment.requested,4);assert.equal(confirmed.items[0].fulfillment.supplied,0);
 assert.match(buildGeneralReport(confirmed),/ORDER CONFIRMED.*OUT OF STOCK/s);
 const repeated=await runGeneralProductNameAudit(customer,confirmation,catalog,{facilityContext:context,semanticTimeoutMs:1000},noAI);
 assert.equal(repeated.allMatch,true,JSON.stringify(repeated.generalAudit));assert.equal(repeated.generalAudit.semanticReviews?.length||0,0);
 const wrong=await runGeneralProductNameAudit(customer,confirmation.replace('Anti Rabies Vaccine Injection','Anti Snake Serum Injection'),catalog,{facilityContext:context,semanticTimeoutMs:0},noAI);
 assert.equal(wrong.allMatch,false);
});
