import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseHTML} from 'linkedom';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyIdentityDecision,identityDecisionHandler} from './generalIdentityDecision';
import {identityVariationId} from './generalIdentityLearning';
import {smartIdentityField,type IdentityField} from '../src/utils/generalIdentityDecision';
import {compareGeneralOrdererNames} from '../src/utils/generalOrdererName';
import {compareGeneralFacilities} from '../src/utils/generalFacility';
import {runGeneralAuditor,generalFourParameterRecord,enforceGeneralIdentityMatches} from './generalAuditor';
import {generalInputFingerprint} from '../shared/generalAuditFingerprint';
import {defaultProducts,applyCatalog} from './productCatalog';
import IdentityCard from '../src/components/GeneralIdentityCard';
import {buildGeneralReport,setupGeneralProductReview} from '../extension/general-report.js';
const actor={id:'cca-1',name:'CCA Mary'};
function record(quantity=10){
 applyCatalog({revision:1,products:defaultProducts()});
 const whatsappMessage='Orderer: Jemimah Huseini\nFacility: Example HC\nParacetamol 500mg Tablet 10';
 const fulfillmentConfirmation=`Orderer: Hussein Jemimah\nFacility: Example HC\nParacetamol 500mg Tablet [${quantity}/${quantity}]`;
 return {...runGeneralAuditor(whatsappMessage,fulfillmentConfirmation),whatsappMessage,fulfillmentConfirmation,id:'identity-test',createdByUserId:actor.id};
}

test('same meaningful words in any arrangement verify; spelling, initials and omitted names require confirmation',()=>{
 for(const [a,b] of [['Mary Abena Odurowaa','Odurowaa Mary Abena'],['Mr Timothy Ndebugre','Ndebugre Timothy']])assert.equal(smartIdentityField('orderer',compareGeneralOrdererNames(a,b)).status,'match');
 for(const [a,b] of [['Jemimah Huseini','Hussein Jemimah'],['John Mensah','John Kwame Mensah'],['John K Mensah','John Kwame Mensah'],['Samuel Mensah','Sam Mensah']])assert.equal(smartIdentityField('orderer',compareGeneralOrdererNames(a,b)).status,'review required');
 assert.equal(smartIdentityField('orderer',compareGeneralOrdererNames('Mary Abena','Peter Owusu')).status,'mismatch');
});
test('verified facility aliases remain green; bounded spelling correction requires confirmation',()=>{
 const same=compareGeneralFacilities('Alpha HC','Alpha Health Centre','Facility: Alpha HC','Facility: Alpha Health Centre');
 assert.equal(smartIdentityField('facility',same).status,'match');
 const fuzzy=compareGeneralFacilities('Example HC','Exampel HC','Facility: Example HC','Facility: Exampel HC');
 assert.equal(smartIdentityField('facility',fuzzy).status,'review required');
 const trusted={...fuzzy,status:'match' as const,verification:'records' as const,evidence:[{id:'example',name:'Example HC',verifiedAliases:['Exampel HC'],source:'verified-directory'}]};
 assert.equal(smartIdentityField('facility',trusted).status,'match');
});
test('confirm, reject and change decisions update only the selected field and retain a complete history',()=>{
 const original={...record(),isValid:false,auditStatus:'failed',discrepancies:['Orderer Name Mismatch']},products=JSON.stringify(record().items);
 assert.equal(original.generalAudit.orderer.status,'review required');
 const yes=applyIdentityDecision(original,'orderer','confirm',actor,'2026-11-03T16:00:00Z');
 assert.equal(yes.isValid,true);assert.equal(yes.auditStatus,'passed');assert.deepEqual(yes.discrepancies,[]);
 assert.equal(yes.allMatch,true);assert.equal(yes.generalAudit.orderer.reason,'Manually Verified');assert.equal(yes.issueCount,0);
 const no=applyIdentityDecision(yes,'orderer','reject',actor,'2026-11-03T16:01:00Z');
 assert.equal(no.allMatch,false);assert.equal(no.status,'pending');assert.equal(no.issueCount,1);assert.equal(no.generalAudit.orderer.reason,'Discrepancy Confirmed');
 const reset=applyIdentityDecision(no,'orderer','reset',actor,'2026-11-03T16:02:00Z');
 assert.equal(reset.generalAudit.orderer.status,'review required');assert.equal(reset.generalAudit.orderer.identityHistory.length,3);
 assert.equal(JSON.stringify(reset.items),products);assert.equal(reset.generalAudit.facility.status,original.generalAudit.facility.status);
 assert.equal(generalFourParameterRecord(no).allMatch,false);
 assert.deepEqual(reset.generalAudit.orderer.identityHistory.map((d:any)=>[d.actor,d.customer,d.fulfillment]),Array(3).fill([actor,'Jemimah Huseini','Hussein Jemimah']));
});
test('identity approval preserves genuine product, quantity and other identity discrepancies',()=>{
 const original=record(12);const updated=applyIdentityDecision(original,'orderer','confirm',actor);
 assert.equal(updated.allMatch,false);assert.ok(updated.issueCount>0);assert.ok(updated.generalAudit.discrepancies.some((d:string)=>/quantity/i.test(d)));
 assert.equal(JSON.stringify(original.items),JSON.stringify(updated.items));
 const bad={...record(),generalAudit:{...record().generalAudit,facility:{...record().generalAudit.facility,status:'mismatch',reason:'Different location'}}};
 const confirmed=applyIdentityDecision(bad,'orderer','confirm',actor);assert.equal(confirmed.generalAudit.facility.status,'mismatch');assert.equal(confirmed.allMatch,false);
 assert.throws(()=>applyIdentityDecision({...record(),generalAudit:{...record().generalAudit,orderer:{whatsappValue:'N/A',fulfillmentValue:'Mary',status:'missing from customer request'}}},'orderer','confirm',actor),/Both original/);
});
async function invoke(handler:any,body:any,user:any=actor){let status=200,result:any;await handler({params:{id:'identity-test'},body},{locals:{authUser:user},status(n:number){status=n;return this;},json(value:any){result=value;}},()=>{});return {status,result};}
const body=(r:any,action='confirm',previousRevision=0)=>({field:'orderer',action,previousRevision,whatsappMessage:r.whatsappMessage,fulfillmentConfirmation:r.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(r)});
test('saved decisions require ownership, current sources and revision; retries are idempotent',async()=>{
 let saved:any=record(),writes=0,learns=0;
 const handler=identityDecisionHandler({read:async()=>saved,save:async r=>{writes++;saved=r;},learn:async()=>{learns++;}});
 assert.equal((await invoke(handler,body(saved),{id:'other',name:'Other'})).status,403);
 assert.equal((await invoke(handler,body(saved),null)).status,401);
 assert.equal((await invoke(handler,{...body(saved),whatsappMessage:'different'})).status,409);
 const before=body(saved);assert.equal((await invoke(handler,before)).status,200);
 const timestamp=saved.generalAudit.orderer.identityDecision.at;
 assert.equal((await invoke(handler,before)).status,200);assert.equal(writes,1);assert.equal(learns,1);assert.equal(saved.generalAudit.orderer.identityDecision.at,timestamp);
 assert.equal((await invoke(handler,body(saved,'reject',0))).status,409);
 assert.equal((await invoke(handler,body(saved,'reset',1))).status,200);
 assert.equal(saved.generalAudit.orderer.identityHistory.length,2);
});
test('a failed save does not return a successful decision or learn an alias',async()=>{
 let learns=0;const r=record();const handler=identityDecisionHandler({read:async()=>r,save:async()=>{throw Error('offline');},learn:async()=>{learns++;}});
 const response=await invoke(handler,body(r));assert.equal(response.status,503);assert.equal(learns,0);assert.equal(r.generalAudit.orderer.identityDecision,undefined);
});
test('learned customer variations are scoped to facility and do not approve new audits',()=>{
 const a=record(),b=record();assert.equal(identityVariationId('orderer',a.generalAudit.orderer,a.generalAudit.facility),identityVariationId('orderer',b.generalAudit.orderer,b.generalAudit.facility));
 assert.notEqual(identityVariationId('orderer',a.generalAudit.orderer,a.generalAudit.facility),identityVariationId('orderer',a.generalAudit.orderer,{whatsappValue:'Other HC',fulfillmentValue:'Other HC'}));
 const value={...a.generalAudit.orderer,previousIdentitySuggestion:{actor:actor.name,at:'2026-11-03',decision:'confirm' as const}};
 assert.equal(smartIdentityField('orderer',value).status,'review required');
});
test('website and extension buttons sit directly below the suggested action inside the identity card',()=>{
 const r=record();const html=renderToStaticMarkup(createElement(IdentityCard,{field:'orderer',value:r.generalAudit.orderer,onDecision:async()=>{}}));
 for(const markup of [html,buildGeneralReport(r)]){
  const {document}=parseHTML(markup);const card=[...document.querySelectorAll('article')].find(n=>n.textContent.includes('Possible Name Match Detected'))!;
  assert.ok(card);assert.match(card.textContent,/Awaiting CCA Confirmation/);
  const suggested=[...card.querySelectorAll('p')].find(n=>n.textContent.includes('Suggested Action:'))!;
  assert.equal(suggested.nextElementSibling?.querySelectorAll('button').length,2);
  assert.match(suggested.nextElementSibling?.textContent||'',/Confirm Match.*Reject Match/);
  assert.equal(document.querySelector('[role="dialog"]'),null);
 }
});
test('extension inline decisions save on the same audit, without running audit again',async()=>{
 let r:any=record(),calls=0;const {document,window}=parseHTML('<main></main>'),root=document.querySelector('main')!;
 let controller:any;
 const render=()=>{root.innerHTML=controller.render(r);};
 controller=setupGeneralProductReview({root,getResult:()=>r,getSources:()=>r,contextKey:()=>1,onSaved:(value:any)=>{r=value;},rerender:render,request:async(url:string,options:any)=>{
  assert.match(url,/identity-decision$/);calls++;const data=JSON.parse(options.body);return applyIdentityDecision(r,data.field,data.action,actor);
 }});render();
 root.querySelector('[data-identity-field="orderer"] [data-identity-action="confirm"]')!.dispatchEvent(new window.Event('click',{bubbles:true}));
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(calls,1);assert.equal(r.generalAudit.orderer.status,'match');assert.match(root.textContent,/Manually Verified/);assert.ok(root.querySelector('[data-identity-action="reset"]'));
});

test('saved variations are consulted before Gemini and remain suggestions for a new uncertain order',async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 for(const decision of ['confirm','reject'] as const){
  let reads=0,calls=0;
  const result=await runGeneralProductNameAudit('Orderer: John Kwame Mensah\nFacility: Example HC\nParacetamol 500mg Tablet 10','Orderer: John Kwami Mensha\nFacility: Example HC\nParacetamol 500mg Tablet [10/10]',catalog,{semanticTimeoutMs:1000,readIdentityVariation:async field=>{assert.equal(field,'orderer');reads++;return {actor:'CCA Mary',at:'2026-11-03',decision};}},()=>{calls++;throw Error('Saved variation must be checked before Gemini');});
  assert.equal(reads,1);assert.equal(calls,0);assert.equal(result.allMatch,false);assert.equal(result.generalAudit.orderer.status,'review required');
  assert.equal(result.generalAudit.orderer.previousIdentitySuggestion?.decision,decision);
 }
});
test('competing identity decisions cannot overwrite one another with stale revisions',async()=>{
 let current:any=record();const handler=identityDecisionHandler({read:async()=>current,save:async r=>{current=r;}});
 const responses=await Promise.all([invoke(handler,body(current,'confirm')),invoke(handler,body(current,'reject'))]);
 assert.deepEqual(responses.map(r=>r.status),[200,409]);assert.equal(current.generalAudit.orderer.identityHistory.length,1);
});

test('current-source revalidation retains a saved CCA decision but never reuses it for another identity',()=>{
 const r=record(),yes=applyIdentityDecision(r,'orderer','confirm',actor);
 const checked=enforceGeneralIdentityMatches(yes,r.whatsappMessage,r.fulfillmentConfirmation);
 assert.equal(checked.generalAudit.orderer.status,'match');assert.equal(checked.allMatch,true);
 const changed=enforceGeneralIdentityMatches(yes,r.whatsappMessage,r.fulfillmentConfirmation.replace('Hussein Jemimah','Peter Owusu'));
 assert.equal(changed.generalAudit.orderer.status,'mismatch');assert.equal(changed.allMatch,false);
});
