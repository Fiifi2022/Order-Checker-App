import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralAuditor} from './generalAuditor';
import {applyIdentityDecision} from './generalIdentityDecision';
import {researchPendingIdentities} from './generalIdentityResearch';
import {productResearchActions} from './productResearchActions';
import {mergeResearchResult,researchPendingProducts} from '../shared/productResearchClient';
import {generalInputFingerprint} from '../shared/generalAuditFingerprint';
const actor={id:'reset-cca',name:'CCA'};
function fixture(){
 const whatsappMessage='Orderer: Jemimah Huseini\nFacility: Example HC\nUnlisted Medicine XYZ 500mg - 10';
 const fulfillmentConfirmation='Orderer: Hussein Jemimah\nFacility: Example HC\nUnlisted Medicine XYZ 500mg [10/10]';
 const original={...runGeneralAuditor(whatsappMessage,fulfillmentConfirmation),id:'research-reset',createdByUserId:actor.id,whatsappMessage,fulfillmentConfirmation};
 original.generalAudit.identityResearch={orderer:{status:'deferred'}};
 return applyIdentityDecision(applyIdentityDecision(original,'orderer','confirm',actor),'orderer','reset',actor);
}
test('Change Decision reopens advisory identity research without approving the name',async()=>{
 const record=fixture();let calls=0;
 const client={models:{async generateContent(){calls++;return {text:JSON.stringify({suggestions:[{field:'orderer',reason:'Similar spelling; ask the CCA to verify.',possibleMatch:true}]})};}}};
 const updated=await researchPendingIdentities(record,()=>client,'reset-direct');
 assert.equal(calls,1);assert.equal(updated.generalAudit.identityResearch.orderer.status,'analysed');
 assert.equal(updated.generalAudit.orderer.status,'review required');assert.equal(updated.allMatch,false);
 assert.equal(updated.generalAudit.orderer.identityHistory.length,2);
});
test('Search Again API accepts a reopened identity and preserves completed product checks',async()=>{
 const record=fixture();let requests=0,saves=0,result:any,status=200;
 const handler=productResearchActions({read:async()=>record,catalog:async()=>({revision:1,products:[]}),getClient:()=>{throw Error('No product AI');},save:async()=>{throw Error('No product changes');},confirm:async()=>{throw Error('Research must not confirm');},researchIdentities:async value=>{requests++;return {...value,generalAudit:{...value.generalAudit,identityResearch:{orderer:{status:'analysed',suggestion:{reason:'CCA must decide.',possibleMatch:true,source:'gemini'}}}}};},saveIdentityResearch:async updated=>{saves++;return updated;}});
 await handler({params:{id:record.id},body:{action:'research_pending',alias:'__pending__',retryIdentityField:'orderer',researchRevision:0,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)}} as any,{locals:{authUser:actor},status(code:number){status=code;return this;},json(value:any){result=value;}} as any,()=>{});
 assert.equal(status,200);assert.equal(requests,1);assert.equal(saves,1);assert.equal(result.generalAudit.orderer.status,'review required');assert.deepEqual(result.items,record.items);
});
test('late research cannot cross a decision reset, while fresh reset research may merge',()=>{
 const current=fixture(),old=structuredClone(current);delete old.generalAudit.orderer.identityDecision;
 old.generalAudit.identityResearch.orderer={status:'analysed',revision:10,suggestion:{reason:'Old result',possibleMatch:true,source:'gemini'}};
 const stale=mergeResearchResult(current,old);
 assert.equal(stale.generalAudit.identityResearch.orderer.status,'deferred');
 const fresh=structuredClone(current);fresh.generalAudit.identityResearch.orderer={status:'analysed',revision:1,suggestion:{reason:'Fresh result',possibleMatch:true,source:'gemini'}};
 const merged=mergeResearchResult(current,fresh);assert.equal(merged.generalAudit.identityResearch.orderer.status,'analysed');assert.equal(merged.generalAudit.orderer.identityDecision.action,'reset');
 const confirmed=applyIdentityDecision(current,'orderer','confirm',actor);
 assert.equal(mergeResearchResult(confirmed,fresh).generalAudit.identityResearch.orderer.status,'deferred');
});
test('research for a reopened identity does not reuse an older in-flight request',async()=>{
 const current=fixture(),old=structuredClone(current);delete old.generalAudit.orderer.identityDecision;
 const releases:Array<()=>void>=[];let calls=0;
 const request=async()=>{calls++;await new Promise<void>(resolve=>releases.push(resolve));return {ok:true};};
 const first=researchPendingProducts(request,old,'orderer');await Promise.resolve();
 const second=researchPendingProducts(request,current,'orderer');await Promise.resolve();
 const count=calls;releases.forEach(release=>release());await Promise.all([first,second]);
 assert.equal(count,2);
});

test('an old research failure cannot mark a reopened identity unavailable',async()=>{
 const {markResearchUnavailable}=await import('../shared/productResearchClient');
 const current=fixture(),old=structuredClone(current);delete old.generalAudit.orderer.identityDecision;
 const unchanged=markResearchUnavailable(current,old);
 assert.equal(unchanged.generalAudit.identityResearch.orderer.status,'deferred');
 const failed=markResearchUnavailable(current,current);assert.equal(failed.generalAudit.identityResearch.orderer.status,'unavailable');
});
test('malformed identity AI output is not reported as successfully analysed',async()=>{
 const record=fixture();
 const client={models:{async generateContent(){return {text:JSON.stringify({suggestions:[{field:'orderer',reason:'',possibleMatch:'yes'}]})};}}};
 const result=await researchPendingIdentities(record,()=>client,'malformed-regression');
 assert.equal(result.generalAudit.identityResearch.orderer.status,'unavailable');assert.equal(result.generalAudit.orderer.status,'review required');assert.equal(result.allMatch,false);
});

test('extension starts fresh research after Change Decision and ignores the earlier response',async()=>{
 const {parseHTML}=await import('linkedom'),{setupGeneralProductReview}=await import('../extension/general-report.js');
 const {document}=parseHTML('<main></main>'),root=document.querySelector('main')!;
 let record:any=fixture();delete record.generalAudit.orderer.identityDecision;
 const replies:Array<{record:any;resolve:(value:any)=>void}>=[];
 const controller=setupGeneralProductReview({root,request:async()=>new Promise(resolve=>{replies.push({record:structuredClone(record),resolve});}),getResult:()=>record,getSources:()=>record,contextKey:()=>1,onSaved:(updated:any)=>{record=updated;},rerender:()=>{}});
 controller.render(record);await new Promise(resolve=>setImmediate(resolve));assert.equal(replies.length,1);
 record=fixture();controller.render(record);await new Promise(resolve=>setImmediate(resolve));assert.equal(replies.length,2);
 const respond=(index:number,reason:string)=>{const reply=replies[index],value=reply.record;value.generalAudit.identityResearch.orderer={status:'analysed',revision:1,suggestion:{reason,possibleMatch:true,source:'gemini'}};reply.resolve(value);};
 respond(0,'Old result');await new Promise(resolve=>setImmediate(resolve));assert.equal(record.generalAudit.identityResearch.orderer.status,'deferred');
 respond(1,'Fresh result');await new Promise(resolve=>setImmediate(resolve));assert.equal(record.generalAudit.identityResearch.orderer.suggestion.reason,'Fresh result');assert.equal(record.generalAudit.orderer.status,'review required');
});
