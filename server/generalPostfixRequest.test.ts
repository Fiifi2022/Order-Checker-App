import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyIdentityDecision} from './generalIdentityDecision';
import {generalAuditorAiContext} from './generalAuditorInstructions';
import {extractGeneralOrderDeterministically} from './generalOrderExtraction';
import Inventory from '../src/components/GeneralInventory';
import type {ProductCatalog} from '../shared/productCatalog';

const catalog:ProductCatalog={revision:20261104,products:[
 {id:'asv',scope:'general',name:'Anti Snake Serum Injection',category:'medicine',aliases:['ASV','Snake Venom Antiserum'],contextualAliases:[],note:''},
 {id:'pcm',scope:'general',name:'Paracetamol 500mg Tablet',category:'medicine',aliases:['PCM'],contextualAliases:[],note:''}
]};
const records=[{name:'Yizeisi HC',district:'Mamprugu Moagduri',region:'North East',source:'verified-directory',key:'yizeisi'}];
const header='Name of Orderer: Mawanbu Jesse Kwame\nFacility: Yezesi Health Center\n';
const patient='Name of patient: Test Patient\nAge: 45years\nPatient\'s contact: 0500000000\n';
const confirmation='Thank you Mawanbu Jesse Kwame from Yizeisi HC for ordering with Zipline. We have received your Emergency order (ID: LOCAL-TEST).\nWe will now prepare the following items for delivery:\n- Snake Venom Antiserum [2/2]';
async function run(customer:string,requestLanguage=true,fs=confirmation){
 applyCatalog(catalog);let calls=0;
 const result=await runGeneralProductNameAudit(customer,fs,catalog,{requestLanguage,facilityContext:{records},deferProductResearch:true,semanticTimeoutMs:0},()=>{calls++;throw Error('No live AI');});
 return {record:{...result,id:'postfix-request',whatsappMessage:customer,fulfillmentConfirmation:fs},calls};
}
test('reported ASV request attaches the sole explicit quantity across clinical metadata without AI',async()=>{
 const {record,calls}=await run('Good evening\nPlease ASV needed\n'+patient+header+'Quantity needed: 2 vials');
 assert.equal(calls,0);assert.equal(record.extractionAssistance.requested,false);
 assert.equal(record.generalAudit.orderer.status,'match');
 assert.equal(record.items.length,1);assert.equal(record.items[0].status,'match');
 assert.equal(record.items[0].catalogProductId,'asv');assert.equal(record.items[0].fulfillment.requested,2);assert.equal(record.items[0].fulfillment.supplied,2);
 assert.deepEqual(record.generalAudit.semanticReviews,[]);assert.deepEqual(record.generalAudit.catalogueSuggestions,[]);
 assert.equal(record.generalAudit.facility.status,'review required');assert.equal(record.generalAudit.decision,'review');
 assert.equal(record.generalAudit.identityResearch?.facility.status,'deferred');
 const confirmed=applyIdentityDecision(record,'facility','confirm',{id:'cca',name:'CCA'});
 assert.equal(confirmed.id,record.id);assert.equal(confirmed.allMatch,true);assert.equal(confirmed.items[0].status,'match');
});
for(const phrase of ['Please ASV needed','ASV urgently needed','Kindly ASV required','ASV is requested','Please ASV 2 vials needed']) {
 test(`postfix request language recognizes ${phrase} using the existing catalogue`,async()=>{
  const quantity=phrase.includes('2 vials')?'':'\nQuantity needed: 2 vials';
  const {record}=await run(header+phrase+quantity);
  assert.equal(record.items.length,1);assert.equal(record.items[0].status,'match');
  assert.equal(record.items[0].fulfillment.requested,2);
 });
}
test('the same grammar works for another approved acronym rather than hardcoding ASV',async()=>{
 const {record}=await run(header+'Please PCM needed\nQuantity: 2 tablets',true,confirmation.replace('Snake Venom Antiserum','Paracetamol 500mg Tablet'));
 assert.equal(record.items[0].catalogProductId,'pcm');assert.equal(record.items[0].status,'match');
});
test('a missing count is never borrowed from FS, patient age or contact details',async()=>{
 const {record}=await run(header+patient+'Please ASV needed');
 assert.equal(record.allMatch,false);assert.ok(record.items.every(i=>i.status!=='match'));
 assert.ok(record.generalAudit.semanticReviews?.some(r=>r.field==='quantity'||r.field==='products'));
});
test('negations, unknown products and ambiguous multi-product quantities are not silently accepted',async()=>{
 for(const phrase of ['Please ASV not needed','Please no ASV needed','Please Mysterybrand needed','Please ASV and PCM needed']) {
  const {record}=await run(header+phrase+'\nQuantity: 2 vials');
  assert.equal(record.allMatch,false,phrase);
  assert.ok(record.items.every(i=>i.status!=='match'),phrase);
 }
 const {record}=await run(header+'Please ASV needed\nPlease PCM needed\nQuantity: 2 vials');
 assert.equal(record.allMatch,false);assert.ok(record.generalAudit.semanticReviews?.length);
});
test('conflicting quantities remain unresolved and facility approval cannot waive a real quantity mismatch',async()=>{
 const unresolved=await run(header+'Please ASV needed\nQuantity: 2 vials\nQuantity: 4 vials');
 assert.equal(unresolved.record.allMatch,false);assert.ok(unresolved.record.generalAudit.semanticReviews?.length);
 const {record}=await run(header+'Please ASV needed\nQuantity: 4 vials');
 const confirmed=applyIdentityDecision(record,'facility','confirm',{id:'cca',name:'CCA'});
 assert.equal(confirmed.allMatch,false);assert.equal(confirmed.items[0].fulfillment.requested,4);assert.equal(confirmed.items[0].fulfillment.supplied,2);
});
test('facility candidate and inline buttons are visible without automatically approving the spelling',async()=>{
 const {record}=await run(header+'Please ASV needed\nQuantity: 2 vials');
 const html=renderToStaticMarkup(createElement(Inventory,{items:record.items,details:record.generalAudit,onOrderLimit(){},onIdentityDecision:async()=>{}}));
 assert.match(html,/Facility Database candidate:/);assert.match(html,/Yizeisi HC/);assert.match(html,/Mamprugu Moagduri/);assert.match(html,/Confirm Match/);assert.match(html,/Reject Match/);
 assert.equal(record.allMatch,false);
});
test('extension and other extraction callers retain the previous behavior unless website profile is selected',()=>{
 applyCatalog(catalog);
 const source=header+'Please ASV needed\nQuantity: 2 vials';
 const before=extractGeneralOrderDeterministically(source,'customer_request',{records});
 const context=generalAuditorAiContext({auditScope:'general_auditor',checkSource:'companion_extension'},()=>{});
 const after=extractGeneralOrderDeterministically(source,'customer_request',{records},undefined,[],{requestLanguage:context.requestLanguage});
 assert.deepEqual(after,before);
 assert.equal(generalAuditorAiContext({auditScope:'general_auditor',checkSource:'order_checker_app'},()=>{}).requestLanguage,true);
});
