import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import {buildGeneralReport} from '../extension/general-report.js';
import {generalAuditFindingLabel} from '../src/utils/generalAuditFindingLabel';
const catalog={revision:9100,products:[
 {id:'ors',name:'Oral Rehydration Salts',scope:'general' as const,category:'medicine' as const,aliases:['ORS'],contextualAliases:[],note:''},
 {id:'pcm',name:'Paracetamol 500mg Tablet',scope:'general' as const,category:'medicine' as const,aliases:['PCM 500mg Tablet'],contextualAliases:[],note:''},
]};
const header='Orderer: Grace Akabati\nFacility: Example HC\n';
const request=header+'ORS - 2\nParacetamol 500mg Tablet - 10';
const unread=header+'Oral Rehydration Salts [2/2]\n- Please confirm tablets listed in the attached note';
const offline=()=>{throw Error('AI unavailable');};
const fields=(extra:any={})=>({facilityName:null,ordererName:null,products:[],deliveryArea:null,district:null,unresolvedFields:[],extractionConfidence:.99,...extra});

test('unread fulfilment content is extraction uncertainty, never evidence of a missing product',async()=>{
 applyCatalog(catalog);
 const result=await runGeneralProductNameAudit(request,unread,catalog,{semanticCacheScope:'unread-confirmation',semanticTimeoutMs:0},offline);
 assert.equal(result.allMatch,false);assert.equal(result.issueCount,0);assert.equal(result.generalAudit.decision,'review');
 assert.equal(result.generalAudit.extractionReadability?.fulfillment_confirmation?.status,'unreadable');
 assert.equal(result.generalAudit.productTotals?.missing,0);
 assert.ok(result.items.some(item=>item.fulfillment.identityReviewRequired));
 assert.doesNotMatch(buildGeneralReport(result),/Missing Product|Extra Product|ORDER CONFIRMED/);
 assert.match(generalAuditFindingLabel(result.generalAudit),/Could not read all products/i);
 assert.match(buildGeneralReport(result),/Could not read all products/i);
 const {createGeneralAuditRun,completeGeneralAuditRun}=await import('../src/utils/generalAuditRun');
 const inputs={whatsappMessage:request,fulfillmentConfirmation:unread};
 const restored=completeGeneralAuditRun(createGeneralAuditRun(inputs,1,{}, {},true),JSON.parse(JSON.stringify({...result,...inputs})));
 assert.equal(restored.issueCount,0);assert.equal(restored.allMatch,false);
 assert.equal(restored.generalAudit.extractionReadability?.fulfillment_confirmation?.status,'unreadable');
 assert.match(buildGeneralReport(restored),/Could not read all products/i);
});

test('known paired quantity and customer differences remain genuine alongside unread content',async()=>{
 applyCatalog(catalog);
 for(const fs of [unread.replace('[2/2]','[3/3]'),unread.replace('Grace Akabati','Jane Mensah')]){
  const result=await runGeneralProductNameAudit(request,fs,catalog,{semanticTimeoutMs:0},offline);
  assert.equal(result.allMatch,false);assert.ok(result.issueCount>0);
 }
});

test('a fully read confirmation still proves a genuinely missing product',async()=>{
 applyCatalog(catalog);
 const result=await runGeneralProductNameAudit(request,header+'Oral Rehydration Salts [2/2]',catalog,{semanticTimeoutMs:0},offline);
 assert.ok(result.items.some(item=>item.status==='missing item'));assert.ok(result.issueCount>0);
});

test('Gemini resolves source-supported fulfilment text before the missing/extra decision',async()=>{
 applyCatalog(catalog);let calls=0;
 const result=await runGeneralProductNameAudit(header+'ORS - 2',header+'Kindly arrange ORS, with a quantity equal to 2 packs.',catalog,{semanticCacheScope:'fulfillment-reading-success'},()=>({models:{async generateContent(input:any){
  calls++;assert.equal(input.model,'gemini-3.8-flash');assert.ok(JSON.parse(input.contents).fulfillment);
  return{text:JSON.stringify({fulfillment:fields({products:[{name:'ORS',quantity:2,unit:'pack'}]})})};
 }}}));
 assert.equal(calls,1);assert.equal(result.extractionAssistance.requested,true);assert.equal(result.allMatch,true);
 assert.equal(result.generalAudit.extractionReadability?.fulfillment_confirmation?.status,'complete');
 assert.doesNotMatch(buildGeneralReport(result),/Missing Product|Extra Product/);
});

test('unavailable Gemini cannot turn unread contents into a confirmed omission or a cleared audit',async()=>{
 applyCatalog(catalog);
 const result=await runGeneralProductNameAudit(request,unread,catalog,{semanticCacheScope:'unread-provider-outage',semanticTimeoutMs:100},offline);
 assert.equal(result.allMatch,false);assert.equal(result.issueCount,0);assert.equal(result.generalAudit.decision,'review');
 assert.equal(result.extractionAssistance.requested,true);
 assert.equal(result.extractionAssistance.status,'fallback');
});

test('empty confirmations stay unreadable while parsed unrelated products retain genuine missing/extra findings',async()=>{
 applyCatalog(catalog);
 const empty=await runGeneralProductNameAudit(header+'ORS - 2',header,catalog,{semanticTimeoutMs:0},offline);
 assert.equal(empty.allMatch,false);assert.equal(empty.issueCount,0);assert.equal(empty.generalAudit.decision,'review');
 const different=await runGeneralProductNameAudit(header+'ORS - 2',header+'Paracetamol 500mg Tablet [2/2]',catalog,{semanticTimeoutMs:0},offline);
 assert.ok(different.issueCount>0);assert.equal(different.allMatch,false);
});

test('Gemini timeouts and unsupported quantities leave source uncertainty visible without invented matches',async()=>{
 applyCatalog(catalog);let calls=0;
 const stalled=await runGeneralProductNameAudit(request,unread,catalog,{semanticCacheScope:'reading-timeout',semanticTimeoutMs:100},()=>({models:{generateContent(){calls++;return new Promise(()=>{});}}}));
 assert.equal(calls,1);assert.equal(stalled.allMatch,false);assert.equal(stalled.issueCount,0);
 assert.equal(stalled.extractionAssistance.status,'fallback');
 const invented=await runGeneralProductNameAudit(header+'ORS - 2',header+'Please arrange ORS, quantity is 20.',catalog,{semanticCacheScope:'reading-borrowed-count'},()=>({models:{async generateContent(){return{text:JSON.stringify({fulfillment:fields({products:[{name:'ORS',quantity:2,unit:null}]})})};}}}));
 assert.equal(invented.allMatch,false);assert.notEqual(invented.items[0].fulfillment.supplied,2);
});

test('a readable product without a count does not hide a genuinely extra product',async()=>{
 applyCatalog(catalog);
 const result=await runGeneralProductNameAudit(header+'Paracetamol 500mg Tablet',header+'Paracetamol 500mg Tablet [10/10]\nOral Rehydration Salts [2/2]',catalog,{semanticTimeoutMs:0},offline);
 assert.equal(result.generalAudit.extractionReadability?.customer_request?.status,'complete');
 assert.ok(result.items.some(item=>item.status==='extra item' && item.catalogProductId==='ors'));
 assert.equal(result.allMatch,false);assert.ok(result.issueCount>0);
 const absent=await runGeneralProductNameAudit(header+'ORS - 2',header+'No fulfilled products',catalog,{semanticTimeoutMs:0},offline);
 assert.ok(absent.items.some(item=>item.status==='missing item'));assert.ok(absent.issueCount>0);
});
