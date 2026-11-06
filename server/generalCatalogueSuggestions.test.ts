import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import {changeCatalogueAlias,catalogueAliasRecords} from './catalogAliasLearning';
import {confirmCatalogueSuggestion} from '../shared/confirmCatalogueSuggestion';
import {catalogAliasKey,type ProductCatalog} from '../shared/productCatalog';
import Suggestions from '../src/components/GeneralCatalogueSuggestions';
import {buildGeneralReport,setupGeneralProductReview} from '../extension/general-report.js';
import {applyCatalogueConfirmation,generalCatalogueConfirmationHandler} from './generalCatalogueConfirmation';
import {applyGeneralOrderLimitDecision} from './generalAuditor';

const seed=():ProductCatalog=>({revision:1,products:[
 {id:'pcm500',name:'Paracetamol 500mg Tablet',scope:'general',category:'medicine',aliases:['PCM'],contextualAliases:[],note:''},
 {id:'pcm250',name:'Paracetamol 250mg Tablet',scope:'general',category:'medicine',aliases:[],contextualAliases:[],note:''},
]});
const customer='Name: Ama Mensah\nFacility: Example HC\nFeverhelper 5';
const fulfillment='Name: Ama Mensah\nFacility: Example HC\nParacetamol 500mg Tablet [5/5]\nParacetamol 250mg Tablet [0/1]';
const noAI=()=>{throw Error('No redundant model call expected');};
async function suggested(){
 const catalog=seed();applyCatalog(catalog);
 return runGeneralProductNameAudit(customer,fulfillment,catalog,{semanticCacheScope:'chooser-test',semanticTimeoutMs:1000},()=>({models:{async generateContent(){return {text:JSON.stringify({matches:[
  {alias:'Feverhelper',productId:'pcm500',confidence:0.9,clinicalUncertainty:true,reason:'Possible brand name; verify the strength.'},
  {alias:'Feverhelper',productId:'pcm250',confidence:0.8,clinicalUncertainty:true,reason:'Alternative strength; verify the original package.'},
  {alias:'Feverhelper',productId:'invented',confidence:1,clinicalUncertainty:false,reason:'Invalid ID'},
 ]})};}}}));
}
function api(canEdit=true){
 let catalog=seed();const writes:any[]=[];
 const request=async(_url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){const body=JSON.parse(String(init.body));writes.push(body);catalog=changeCatalogueAlias(catalog,body,'verified-test-editor').catalog;return {revision:catalog.revision};}
  return {revision:catalog.revision,canEdit,products:catalog.products.map(p=>({id:p.id,name:p.name})),records:catalogueAliasRecords(catalog)};
 };
 return {request,writes,get catalog(){return catalog;},set catalog(value:ProductCatalog){catalog=value;}};
}

test('Gemini offers bounded existing catalogue choices without clearing the audit or saving aliases',async()=>{
 const r=await suggested();const group=r.generalAudit.catalogueSuggestions![0];
 assert.equal(r.allMatch,false);assert.equal(group.alias,'Feverhelper');assert.equal(group.status,'suggested');
 assert.deepEqual(group.options.map(option=>option.productId),['pcm500','pcm250']);assert.equal(r.aliasLearning.saved,0);
 assert.ok(!seed().products.some(p=>p.aliases.includes('Feverhelper')));
 for(const html of [renderToStaticMarkup(createElement(Suggestions,{suggestions:r.generalAudit.catalogueSuggestions})),buildGeneralReport(r)]){
  assert.match(html,/Suggested product for Feverhelper/);assert.match(html,/Paracetamol 500mg Tablet/);assert.match(html,/Paracetamol 250mg Tablet/);
  assert.match(html,/Confirm match/);assert.match(html,/disabled/);assert.doesNotMatch(html,/value="invented"/);
 }
});

test('a verified selection uses existing alias approval and marks the saved identity',async()=>{
 const original=await suggested();const fixture=api();await confirmCatalogueSuggestion(fixture.request,'Feverhelper','pcm500');
 assert.deepEqual(fixture.writes.map(body=>body.action),['propose','approve']);assert.equal(fixture.writes[1].identityConfirmed,true);
 applyCatalog(fixture.catalog);
 const result=applyCatalogueConfirmation({...original,id:'approved',whatsappMessage:customer,fulfillmentConfirmation:fulfillment},'Feverhelper','pcm500',fixture.catalog,{id:'editor',name:'Editor'});
 assert.equal(result.allMatch,true);assert.equal(result.generalAudit.catalogueSuggestions?.length,0);
 assert.equal(result.items.find(item=>item.name==='Paracetamol 500mg Tablet')!.fulfillment.requested,5);
 await confirmCatalogueSuggestion(fixture.request,'Feverhelper','pcm500');assert.equal(fixture.writes.length,2,'Retry does not duplicate approval');
});

test('read-only users, rejected mappings and conflicting prior approvals cannot be bypassed',async()=>{
 const readonly=api(false);await assert.rejects(()=>confirmCatalogueSuggestion(readonly.request,'Feverhelper','pcm500'),/catalogue editor/);assert.equal(readonly.writes.length,0);
 const rejected=api();rejected.catalog={...rejected.catalog,aliasRecords:[{id:'no',productId:'pcm500',text:'Feverhelper',normalizedText:catalogAliasKey('Feverhelper'),source:'manual',status:'rejected',active:false,createdAt:null,approvedAt:null,approvedBy:null,updatedAt:null}]};
 await assert.rejects(()=>confirmCatalogueSuggestion(rejected.request,'Feverhelper','pcm500'),/rejected/);assert.equal(rejected.writes.length,0);
 const conflict=api();await confirmCatalogueSuggestion(conflict.request,'Feverhelper','pcm250');await assert.rejects(()=>confirmCatalogueSuggestion(conflict.request,'Feverhelper','pcm500'),/different product/);
});

test('saved pending suggestions remain selectable without another Gemini request',async()=>{
 const fixture=api();fixture.catalog=changeCatalogueAlias(fixture.catalog,{revision:1,action:'propose',productId:'pcm500',text:'Feverhelper'},'editor').catalog;
 applyCatalog(fixture.catalog);
 const r=await runGeneralProductNameAudit(customer,fulfillment,fixture.catalog,{semanticTimeoutMs:1000},noAI);
 assert.equal(r.allMatch,false);assert.equal(r.generalAudit.catalogueSuggestions![0].options[0].productId,'pcm500');
});

test('provider failure offers a clear fallback without invented choices or a cleared order',async()=>{
 const catalog=seed();applyCatalog(catalog);
 const r=await runGeneralProductNameAudit(customer,fulfillment,catalog,{semanticCacheScope:'chooser-failure',semanticTimeoutMs:100},()=>{throw Error('Gemini unavailable');});
 assert.equal(r.allMatch,false);assert.equal(r.generalAudit.catalogueSuggestions![0].status,'unavailable');assert.deepEqual(r.generalAudit.catalogueSuggestions![0].options,[]);
});

test('order-limit acknowledgements preserve available product choices',async()=>{
 const catalog=seed();applyCatalog(catalog);
 const r=await runGeneralProductNameAudit(customer.replace('Feverhelper 5','PCM 5'),fulfillment.replace('[5/5]','[3/3]'),catalog,{semanticTimeoutMs:0},noAI);
 const group={alias:'Feverhelper',options:[{productId:'pcm500',name:'Paracetamol 500mg Tablet',reason:'Verify the product',clinicalUncertainty:true}],status:'suggested' as const};
 r.generalAudit.catalogueSuggestions=[group];
 const key=r.items.find(item=>item.fulfillment.orderLimitEligible)!.fulfillment.key;
 const updated=applyGeneralOrderLimitDecision(r,key,true);
 assert.deepEqual(updated.generalAudit.catalogueSuggestions,[group]);
});

test('extension selection saves and marks the current audit without requesting a new audit',async()=>{
 const {parseHTML}=await import('linkedom');const {document,window}=parseHTML('<html><body><div id="results"></div></body></html>');
 const root=document.getElementById('results')!;
 const base=await suggested();let record={...base,id:'suggestion-audit',whatsappMessage:customer,fulfillmentConfirmation:fulfillment};
 const fixture=api();let saves=0,controller:any;
 const request=async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/product-research')){const body=JSON.parse(String(init?.body));assert.equal(body.action,'confirm');assert.equal(body.identityConfirmed,true);await confirmCatalogueSuggestion(fixture.request,body.alias,body.productId);applyCatalog(fixture.catalog);return applyCatalogueConfirmation(record,body.alias,body.productId,fixture.catalog,{id:'editor',name:'Editor'});}
  assert.ok(!url.includes('/verify'));return fixture.request(url,init);
 };
 const render=()=>{root.innerHTML=controller.render(record);};
 controller=setupGeneralProductReview({root,request,getResult:()=>record,getSources:()=>({whatsappMessage:customer,fulfillmentConfirmation:fulfillment}),contextKey:()=>1,onSaved:updated=>{record=updated;saves++;},rerender:render});
 render();
 const select=root.querySelector('[data-catalogue-option]') as HTMLSelectElement;
 select.querySelector('option[value="pcm500"]')!.setAttribute('selected','selected');
 select.dispatchEvent(new window.Event('change',{bubbles:true}));
 assert.equal((root.querySelector('[data-confirm-catalogue]') as HTMLButtonElement).disabled,true);assert.equal(fixture.writes.length,0);
 const verified=root.querySelector('[data-catalogue-verified]') as HTMLInputElement;verified.checked=true;verified.dispatchEvent(new window.Event('change',{bubbles:true}));
 assert.equal((root.querySelector('[data-confirm-catalogue]') as HTMLButtonElement).disabled,false);
 root.querySelector('[data-confirm-catalogue]')!.dispatchEvent(new window.Event('click',{bubbles:true}));
 for(let i=0;i<10&&saves===0;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(saves,1);assert.equal(record.id,'suggestion-audit');assert.deepEqual(fixture.writes.map(body=>body.action),['propose','approve']);assert.equal(record.allMatch,true);
 const changed={...base,id:'another-audit'};controller.render(changed);
 assert.equal(controller.drafts.get('catalogue:Feverhelper').contacted,false,'Verification cannot carry into a new audit');
});


test('confirmed identity updates the same audit and preserves genuine quantity and header findings',async()=>{
 const base=await suggested();const fixture=api();await confirmCatalogueSuggestion(fixture.request,'Feverhelper','pcm500');applyCatalog(fixture.catalog);
 const original={...base,id:'same-id',whatsappMessage:customer,fulfillmentConfirmation:fulfillment};
 const updated=applyCatalogueConfirmation(original,'Feverhelper','pcm500',fixture.catalog,{id:'editor',name:'Editor'});
 assert.equal(updated.id,original.id);assert.equal(updated.allMatch,true);assert.equal(updated.generalAudit.catalogueSuggestions.length,0);
 assert.equal(updated.generalAudit.catalogueConfirmations.length,1);assert.deepEqual(updated.generalAudit.facility,original.generalAudit.facility);
 assert.equal(applyCatalogueConfirmation(updated,'Feverhelper','pcm500',fixture.catalog,{id:'other',name:'Other'}),updated);
 const shortfall=structuredClone(original);
 for(const item of shortfall.items)for(const p of item.provenance)if(p.source==='customer_request')p.quantity=9;
 shortfall.generalAudit.facility={...shortfall.generalAudit.facility,status:'mismatch'};
 const reviewed=applyCatalogueConfirmation(shortfall,'Feverhelper','pcm500',fixture.catalog,{id:'editor',name:'Editor'});
 assert.equal(reviewed.allMatch,false);assert.equal(reviewed.items.find(item=>item.name.includes('500mg'))!.fulfillment.requested,9);
 assert.notEqual(reviewed.items.find(item=>item.name.includes('500mg'))!.status,'match');
 assert.equal(reviewed.generalAudit.facility.status,'mismatch');
 assert.throws(()=>applyCatalogueConfirmation(original,'invented','pcm500',fixture.catalog,{id:'e',name:'E'}),/approved/);
});

test('saved audit confirmation rejects stale messages, unauthorized edits and failed writes',async()=>{
 const base=await suggested();const fixture=api();await confirmCatalogueSuggestion(fixture.request,'Feverhelper','pcm500');applyCatalog(fixture.catalog);
 const record={...base,id:'handler-id',createdByUserId:'owner',whatsappMessage:customer,fulfillmentConfirmation:fulfillment};
 const {generalInputFingerprint}=await import('../shared/generalAuditFingerprint');
 const body={alias:'Feverhelper',productId:'pcm500',identityConfirmed:true,whatsappMessage:customer,fulfillmentConfirmation:fulfillment,inputFingerprint:generalInputFingerprint(record)};
 let saves=0,stored:any=record;
 const handler=generalCatalogueConfirmationHandler({read:async()=>stored,catalog:async()=>fixture.catalog,save:async updated=>{saves++;stored=updated;}});
 const invoke=async(payload:any,role='admin',target=handler)=>{
  let status=200,result:any;
  const res:any={locals:{authUser:{id:'editor',name:'Editor',role}},status(code:number){status=code;return this;},json(value:any){result=value;return this;}};
  await target({params:{id:record.id},body:payload} as any,res,()=>{});return {status,result};
 };
 assert.equal((await invoke({...body,whatsappMessage:'changed'})).status,409);assert.equal(saves,0);
 const denied=await invoke(body,'cca');assert.equal(denied.status,403);assert.equal(saves,0);
 const failing=generalCatalogueConfirmationHandler({read:async()=>record,catalog:async()=>fixture.catalog,save:async()=>{throw Error('offline');}});
 assert.equal((await invoke(body,'admin',failing)).status,503);assert.equal(stored,record);
 const saved=await invoke(body);assert.equal(saved.status,200);assert.equal(saved.result.id,record.id);assert.equal(saved.result.allMatch,true);assert.equal(saves,1);
 assert.equal((await invoke(body)).status,200);assert.equal(saves,1,'Retry is idempotent');
});


test('marking an approved identity retains stockout classification and approved order limits',async()=>{
 const catalog=seed();applyCatalog(catalog);
 const partial=await runGeneralProductNameAudit(customer,fulfillment.replace('[5/5]','[3/5] - partially out of stock'),catalog,{semanticTimeoutMs:0},noAI);
 const stock=await runGeneralProductNameAudit(customer,fulfillment.replace('[5/5]','[0/1]'),catalog,{semanticTimeoutMs:0},noAI);
 const fixture=api();await confirmCatalogueSuggestion(fixture.request,'Feverhelper','pcm500');applyCatalog(fixture.catalog);
 for(const [base,expected] of [[partial,3],[stock,0]] as const){
  base.generalAudit.catalogueSuggestions=[{alias:'Feverhelper',status:'suggested',options:[{productId:'pcm500',name:'Paracetamol 500mg Tablet',reason:'Verified',clinicalUncertainty:false}]}];
  const updated=applyCatalogueConfirmation({...base,id:'retained',whatsappMessage:customer,fulfillmentConfirmation:fulfillment},'Feverhelper','pcm500',fixture.catalog,{id:'e',name:'E'});
  const item=updated.items.find(item=>item.catalogProductId==='pcm500')!;
  assert.equal(item.fulfillment.supplied,expected);assert.ok(item.fulfillment.stockStatus.includes('out of stock'));
 }
 const limited=structuredClone(partial);limited.generalAudit.orderLimitDecisions={pcm500:true};
 const approved=applyCatalogueConfirmation({...limited,id:'limit',whatsappMessage:customer,fulfillmentConfirmation:fulfillment},'Feverhelper','pcm500',fixture.catalog,{id:'e',name:'E'});
 assert.deepEqual(approved.generalAudit.orderLimitDecisions,{pcm500:true});assert.equal(approved.items.find(item=>item.catalogProductId==='pcm500')!.status,'order limit applied');
});
