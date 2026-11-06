import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applySourceProductConfirmation} from './generalSourceProductConfirmation';
import {applyIdentityDecision} from './generalIdentityDecision';
import {localSourceComparisonSuggestions} from './generalComparisonSuggestions';
import Inventory from '../src/components/GeneralInventory';
import type {ProductCatalog} from '../shared/productCatalog';
import {catalogAliasKey} from '../shared/productCatalog';
const h='Name: John Mensah\nFacility: Example HC\n';
const catalogue=():ProductCatalog=>({revision:9101,products:[100,200].map(strength=>({id:`variant-${strength}`,name:`Test Medicine ${strength}mg Tablet`,scope:'general',category:'medicine',aliases:['Shared remedy','Shared tablets'],contextualAliases:[],note:''}))});
async function run(a:string,b:string,c=catalogue(),support:any={}){
 applyCatalog(c);let calls=0,writes=0;const before=JSON.stringify(c);
 const whatsappMessage=h+a,fulfillmentConfirmation=h+b;
 const result=await runGeneralProductNameAudit(whatsappMessage,fulfillmentConfirmation,c,{requestLanguage:true,deferProductResearch:true,semanticTimeoutMs:0,...support,learnCatalogueProducts:async()=>{writes++;throw Error('No registration required');}},()=>{calls++;throw Error('No AI expected');});
 assert.equal(JSON.stringify(c),before);
 return {record:{...result,id:'comparison-first',whatsappMessage,fulfillmentConfirmation},calls,writes};
}
test('identical uncatalogued products pass the source comparison without lookup registration or AI',async()=>{
 const {record,calls,writes}=await run('Unlisted Compound XYZ 500mg - 20','Unlisted Compound XYZ 500mg [20/20]',{revision:1,products:[]});
 assert.equal(record.allMatch,true);assert.equal(calls,0);assert.equal(writes,0);assert.deepEqual(record.generalAudit.catalogueSuggestions,[]);
});
test('a source quantity difference remains a discrepancy even when the product is uncatalogued',async()=>{
 const {record}=await run('Unlisted Compound XYZ 500mg - 20','Unlisted Compound XYZ 500mg [10/10]',{revision:1,products:[]});
 assert.equal(record.allMatch,false);assert.equal(record.generalAudit.decision,'discrepancy');
 assert.equal(record.items[0].fulfillment.requested,20);assert.equal(record.items[0].fulfillment.supplied,10);
});
test('identical names can match directly even when the catalogue contains ambiguous aliases',async()=>{
 const {record,calls}=await run('Shared remedy - 5','Shared remedy [5/5]');
 assert.equal(record.allMatch,true);assert.equal(calls,0);assert.deepEqual(record.generalAudit.catalogueSuggestions,[]);
});
test('recognized but unresolved source descriptions get a selectable local suggestion without AI',async()=>{
 const {record,calls}=await run('Shared remedy - 5','Shared tablets [5/5]');
 assert.equal(record.allMatch,false);assert.equal(record.generalAudit.decision,'review');assert.equal(calls,0);
 assert.equal(record.generalAudit.catalogueSuggestions?.length,1);
 const group=record.generalAudit.catalogueSuggestions![0];
 assert.equal(group.customerValue,'Shared remedy');assert.equal(group.fulfillmentValue,'Shared tablets');
 assert.equal(group.researchStatus,'catalogue');assert.equal(group.options[0].kind,'source');assert.equal(group.options[0].sourceName,'Shared tablets');
 const html=renderToStaticMarkup(createElement(Inventory,{items:record.items,details:record.generalAudit,onOrderLimit(){},onResearchAction:async()=>{}}));
 assert.match(html,/Choose the matching product/);assert.match(html,/Confirm Match/);assert.match(html,/Shared remedy/);assert.match(html,/Shared tablets/);
 assert.doesNotMatch(html,/<progress\b/);
});
test('confirming the suggested source equivalence completes the same audit without a catalogue entry or global alias',async()=>{
 const c=catalogue(),{record}=await run('Shared remedy - 5','Shared tablets [5/5]',c),before=JSON.stringify(c);
 const result=applySourceProductConfirmation(record,'Shared remedy','Shared tablets',c,{id:'cca',name:'CCA'});
 assert.equal(result.allMatch,true);assert.equal(result.id,record.id);assert.equal(result.whatsappMessage,record.whatsappMessage);
 assert.equal(JSON.stringify(c),before);assert.equal(result.generalAudit.sourceProductConfirmations.length,1);
});
test('confirming product identity never clears a quantity difference',async()=>{
 const c=catalogue(),{record}=await run('Shared remedy - 20','Shared tablets [10/10]',c);
 const result=applySourceProductConfirmation(record,'Shared remedy','Shared tablets',c,{id:'cca',name:'CCA'});
 assert.equal(result.allMatch,false);assert.equal(result.generalAudit.decision,'discrepancy');
 assert.equal(result.items[0].fulfillment.requested,20);assert.equal(result.items[0].fulfillment.supplied,10);
});
test('confirming product identity preserves a rejected facility match',async()=>{
 const c=catalogue(),{record}=await run('Shared remedy - 5','Shared tablets [5/5]',c);
 const rejected=applyIdentityDecision(record,'facility','reject',{id:'cca',name:'CCA'});
 const result=applySourceProductConfirmation(rejected,'Shared remedy','Shared tablets',c,{id:'cca',name:'CCA'});
 assert.equal(result.allMatch,false);assert.equal(result.generalAudit.facility.status,'mismatch');assert.equal(result.items[0].status,'match');
});
test('rejected source suggestions remain unresolved and cannot be used to complete an audit',async()=>{
 const c=catalogue(),{record}=await run('Shared remedy - 5','Shared tablets [5/5]',c);
 const group=record.generalAudit.catalogueSuggestions![0];group.rejectedProductIds=[group.options[0].productId];
 assert.throws(()=>applySourceProductConfirmation(record,'Shared remedy','Shared tablets',c,{id:'cca',name:'CCA'}));assert.equal(record.allMatch,false);
});
test('explicit clinical conflicts and rejected catalogue alias mappings cannot create a local equivalence',()=>{
 const c=catalogue();
 assert.equal(localSourceComparisonSuggestions(['Shared remedy 100mg'],['Shared tablets 200mg'],c).size,0);
 const rejected:ProductCatalog={...c,aliasRecords:c.products.map((p,i)=>({id:`reject-${i}`,productId:p.id,text:'Shared remedy',normalizedText:catalogAliasKey('Shared remedy'),source:'manual',status:'rejected',active:false,createdAt:null,approvedAt:null,approvedBy:null,updatedAt:null}))};
 assert.equal(localSourceComparisonSuggestions(['Shared remedy'],['Shared tablets'],rejected).size,0);
});
test('other audit callers keep their existing behavior unless the website comparison profile is selected',async()=>{
 const {record}=await run('Shared remedy - 5','Shared tablets [5/5]',catalogue(),{requestLanguage:false});
 assert.equal(record.allMatch,false);assert.deepEqual(record.generalAudit.catalogueSuggestions,[]);
});
