import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {generalInputFingerprint} from '../shared/generalAuditFingerprint';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyIdentityDecision,identityDecisionHandler} from './generalIdentityDecision';
import {confirmGeneralProductForAudit} from './generalProductChoice';
import {recoverGeneralOrderer} from './generalOrdererExtraction';
import IdentityCard from '../src/components/GeneralIdentityCard';
import Details from '../src/components/GeneralAuditDetails';
const actor={id:'cca',name:'Test CCA'},catalog={revision:1,products:[]};
async function fixture(quantity=20){
 const whatsappMessage='Orderer: Osman Ishak\nFacility: Chiana HC\nUnlisted Medicine 500mg - 20';
 const fulfillmentConfirmation=`Thank you Osman Ishaak from Chiana HC for ordering with Zipline. We will now prepare the following items for delivery:\n- Unlisted Medicine 500mg [${quantity}/${quantity}]`;
 const value=await runGeneralProductNameAudit(whatsappMessage,fulfillmentConfirmation,catalog,{generalOnlySmartMatching:true,requestLanguage:true,deferProductResearch:true,semanticTimeoutMs:0},()=>{throw Error('No AI needed');});
 return {...value,id:'master-confirm',createdByUserId:actor.id,auditScope:'general_auditor',whatsappMessage,fulfillmentConfirmation};
}
test('phase 4: new General identity confirmation requires acknowledgment; saved retry stays idempotent',async()=>{
 let record:any=await fixture(10),saves=0,learns=0;
 const handler=identityDecisionHandler({read:async()=>record,save:async updated=>{record=updated;saves++;},learn:async()=>{learns++;}});
 const request={field:'orderer',action:'confirm',previousRevision:0,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)};
 async function call(extra:any={}){let status=200;await handler({params:{id:record.id},body:{...request,...extra}} as any,{locals:{authUser:actor},status(code:number){status=code;return this;},json(){}} as any,()=>{});return status;}
 assert.equal(await call(),400);assert.equal(saves,0);
 assert.equal(await call({identityAcknowledged:true}),200);assert.equal(saves,1);assert.equal(record.generalAudit.orderer.status,'match');assert.equal(record.allMatch,false);
 assert.equal(record.items[0].fulfillment.requested,20);assert.equal(record.items[0].fulfillment.supplied,10);
 assert.equal(await call(),200);assert.equal(saves,1);assert.equal(learns,0);
});
test('phase 4: mounted identity acknowledgment resets for a new audit and a changed decision',async()=>{
 const {parseHTML}=await import('linkedom'),{window}=parseHTML('<html><body><main></main></body></html>');
 const previous={window:globalThis.window,document:globalThis.document,act:(globalThis as any).IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const {act}=await import('react'),{createRoot}=await import('react-dom/client');
 const root=createRoot(window.document.querySelector('main')!),record=await fixture();let calls=0;
 const props=(node:any)=>node[Object.keys(node).find(key=>key.startsWith('__reactProps'))!];
 const choose=async(_field:any,action:any,ack?:boolean)=>{assert.equal(action,'confirm');assert.equal(ack,true);calls++;};
 const render=(auditKey:string,value=record.generalAudit.orderer)=>createElement(IdentityCard,{field:'orderer',value,requireAcknowledgement:true,auditKey,onDecision:choose});
 const confirm=()=>[...window.document.querySelectorAll('button')].find(b=>b.textContent==='Confirm Match')!;
 try{
  await act(async()=>root.render(render('audit-1')));assert.equal(confirm().hasAttribute('disabled'),true);
  await act(async()=>props(window.document.querySelector('input')).onChange({target:{checked:true}}));assert.equal(confirm().hasAttribute('disabled'),false);
  await act(async()=>props(confirm()).onClick());assert.equal(calls,1);
  await act(async()=>root.render(render('audit-2')));assert.equal(confirm().hasAttribute('disabled'),true);
  const approved=applyIdentityDecision(record,'orderer','confirm',actor);
  await act(async()=>root.render(render('audit-2',approved.generalAudit.orderer)));assert.equal(window.document.querySelector('input'),null);
  const reset=applyIdentityDecision(approved,'orderer','reset',actor);
  await act(async()=>root.render(render('audit-2',reset.generalAudit.orderer)));assert.equal(confirm().hasAttribute('disabled'),true);
 }finally{await act(async()=>root.unmount());Object.assign(globalThis,{window:previous.window,document:previous.document,IS_REACT_ACT_ENVIRONMENT:previous.act});}
});
test('phase 4: product approval can remain audit-local and cannot waive quantity differences',async()=>{
 const c={revision:1,products:[{id:'folic',name:'Folic Acid',scope:'general' as const,category:'medicine',aliases:[],contextualAliases:[],note:''},{id:'folic5',name:'Folic acid 5mg Tablet',scope:'general' as const,category:'medicine',aliases:[],contextualAliases:[],note:''}]};
 const whatsappMessage='Name: John Mensah\nFacility: Example HC\nFolic acid - 4';
 const fulfillmentConfirmation='Thank you John Mensah from Example HC for ordering with Zipline. We will now prepare the following items for delivery:\n- Folic acid 5mg Tablet [1/1]';
 const result=await runGeneralProductNameAudit(whatsappMessage,fulfillmentConfirmation,c,{generalOnlySmartMatching:true,requestLanguage:true,semanticTimeoutMs:0,deferProductResearch:true},()=>{throw Error('No AI');});
 const record={...result,id:'product-choice',whatsappMessage,fulfillmentConfirmation};
 const group=record.generalAudit.catalogueSuggestions![0],before=JSON.stringify(c);
 const chosen=confirmGeneralProductForAudit(record,group.alias,group.options[0].productId,c,actor);
 assert.equal(JSON.stringify(c),before);assert.equal(chosen.id,record.id);assert.equal(chosen.generalAudit.catalogueSuggestions.length,0);assert.equal(chosen.allMatch,false);
 assert.equal(chosen.items[0].fulfillment.requested,4);assert.equal(chosen.items[0].fulfillment.supplied,1);assert.equal(chosen.generalAudit.sourceProductConfirmations[0].confirmedBy.id,actor.id);
 assert.throws(()=>confirmGeneralProductForAudit(record,group.alias,'unrelated',c,actor),/no longer available/);
});
test('phase 4: extraction failure is distinct from no source evidence and is displayed safely',async()=>{
 const broken={get products():import('../shared/productCatalog').CatalogProduct[]{throw Error('private internal extraction failure');},revision:1};
 const extraction=recoverGeneralOrderer('Osman Ishak','Orderer: Osman Ishak',broken,{});
 assert.equal(extraction.status,'extraction error');assert.doesNotMatch(extraction.reason,/private internal/);
 const record=await fixture();const details={...record.generalAudit,orderer:{...record.generalAudit.orderer,status:'missing from customer request' as const,whatsappValue:'N/A'},ordererExtraction:{...extraction,status:'not detected' as const}};
 assert.match(renderToStaticMarkup(createElement(Details,{details})),/NOT DETECTED/);
 assert.match(renderToStaticMarkup(createElement(Details,{details:{...details,ordererExtraction:extraction}})),/EXTRACTION ERROR/);
 const exact={...record.generalAudit.orderer,status:'match' as const,whatsappValue:'Osman Ishak',fulfillmentValue:'Osman Ishak'};
 assert.doesNotMatch(renderToStaticMarkup(createElement(IdentityCard,{field:'orderer',value:exact,requireAcknowledgement:true})),/checkbox|Confirm Match/);
});
