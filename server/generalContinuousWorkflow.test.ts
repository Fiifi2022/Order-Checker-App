import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {researchProducts} from './productResearch';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import {changeCatalogueAlias} from './catalogAliasLearning';
import {applyCatalogueConfirmation} from './generalCatalogueConfirmation';
import {productResearchActions} from './productResearchActions';
import {generalInputFingerprint} from '../shared/generalAuditFingerprint';
import {generalResolutionQueue} from '../shared/generalResolutionQueue';
import {mergeResearchResult,researchPendingProducts} from '../shared/productResearchClient';
import {generalAuditMutations} from './generalAuditMutation';
import {GeminiUsageTracker} from './geminiUsage';
import {researchPendingIdentities} from './generalIdentityResearch';
import {applyIdentityDecision} from './generalIdentityDecision';
import type {ProductCatalog} from '../shared/productCatalog';
import Inventory from '../src/components/GeneralInventory';
import {buildGeneralReport,setupGeneralProductReview} from '../extension/general-report.js';
const names=['Paracetamol 500mg Tablet','Aspirin 75mg Tablet','Amoxicillin 250mg Capsule','Metronidazole 200mg Tablet','Diclofenac 50mg Tablet','Ibuprofen 200mg Tablet','Cetirizine 10mg Tablet','Omeprazole 20mg Capsule','Folic Acid 5mg Tablet','Amlodipine 5mg Tablet'];
const seed=():ProductCatalog=>({revision:1,products:names.map((name,i)=>({id:'product'+i,name,scope:'general',aliases:i===0?['PCM']:[],contextualAliases:[],category:'medicine',note:''}))});
const header='Name: Mary Mensah\nFacility: Example HC\n';
const config={model:'workflow-mock',searchModel:'grounding-mock',timeoutMs:1000,search:false};
const mock=(aliases:string[])=>({models:{async generateContent(){return{text:JSON.stringify({matches:aliases.map(alias=>({alias,productId:'product0',confidence:.9,clinicalUncertainty:true,reason:'Possible brand; verify original packaging.'}))})};}}});
async function audit(unknown=true){
 const catalog=seed();applyCatalog(catalog);
 const whatsappMessage=header+names.map(name=>`- ${name} - 5`).join('\n')+(unknown?'\n- Novelhelper - 5':''),fulfillmentConfirmation=header+names.map(name=>`- ${name} [5/5]`).join('\n');
 const result=await runGeneralProductNameAudit(whatsappMessage,fulfillmentConfirmation,catalog,{deferProductResearch:true,semanticTimeoutMs:0},()=>{throw Error('Deterministic pass called AI');});
 return {...result,id:'continuous-test',createdByUserId:'cca',whatsappMessage,fulfillmentConfirmation};
}
async function invoke(handler:any,record:any,action:string,alias='Novelhelper',extra:any={}){
 let status=200,value:any;await handler({params:{id:record.id},body:{action,alias,productId:'product0',identityConfirmed:true,researchRevision:record.generalAudit.catalogueSuggestions?.find((g:any)=>g.alias===alias)?.researchRevision||0,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record),...extra}},{locals:{authUser:{id:'cca',name:'CCA Mary'}},status(n:number){status=n;return this;},json(result:any){value=result;}},()=>{});return {status,value};
}
test('all locally recognized products complete without queued research or Gemini',async()=>{
 const record=await audit(false),queue=generalResolutionQueue(record);
 assert.equal(record.allMatch,true);assert.equal(record.geminiMetrics.calls,0);assert.equal(queue.pending,0);assert.equal(queue.unresolved,0);assert.ok(queue.completed>=22);
});
test('one unfamiliar product preserves ten independently completed product comparisons',async()=>{
 const record=await audit(),queue=generalResolutionQueue(record);
 assert.equal(record.allMatch,false);assert.equal(record.geminiMetrics.calls,0);assert.equal(record.generalAudit.catalogueSuggestions?.[0].researchStatus,'deferred');
 assert.equal(record.items.filter(item=>item.status==='match').length,10);assert.ok(queue.checks.some(c=>c.label==='Novelhelper'&&c.state==='pending research'));
 assert.equal(queue.sessionId,record.id);assert.ok(queue.completed>=22);
});
test('multiple unfamiliar terms share one provider request, coalesce in-flight work and reuse cache',async()=>{
 let calls=0;const client={models:{async generateContent(input:any){calls++;const body=JSON.parse(input.contents);assert.equal(body.unknownNames.length,2);assert.ok(body.catalog.some((p:any)=>p.id==='product0'));await new Promise(resolve=>setImmediate(resolve));return{text:JSON.stringify({matches:body.unknownNames.map((alias:string)=>({alias,productId:'product0',confidence:.9,clinicalUncertainty:true,reason:'Verify package'}))})};}}};
 const options={config,scope:'batch-dedup',counterpartNames:[names[0]]};
 const [a,b]=await Promise.all([researchProducts(['Brand-one','Brand-two','Brand-one','PCM'],seed(),()=>client,options),researchProducts(['Brand-one','Brand-two','PCM'],seed(),()=>client,options)]);
 assert.equal(calls,1);assert.deepEqual(a,b);assert.ok(a.every(g=>g.options[0]?.productId==='product0'));
 await researchProducts(['Brand-one','Brand-two'],seed(),()=>client,options);assert.equal(calls,1);
});
test('research cannot hold the audit mutation lock or overwrite a CCA-retained discrepancy',async()=>{
 let record:any=await audit(),release!:(value:any)=>void,started!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 const client={models:{generateContent:()=>{started();return new Promise(resolve=>{release=resolve;});}}};
 const handler=productResearchActions({read:async()=>record,catalog:async()=>seed(),getClient:()=>client,save:async value=>{record=value;},confirm:async()=>{throw Error('No approval');}});
 const work=invoke(handler,record,'research_pending','__pending__');await ready;
 assert.equal(generalAuditMutations.has(record.id),false);
 const items=JSON.stringify(record.items),kept=await invoke(handler,record,'keep');assert.equal(kept.status,200);
 release({text:JSON.stringify({matches:[{alias:'Novelhelper',productId:'product0',confidence:.99,clinicalUncertainty:false,reason:'Late answer'}]})});await work;
 assert.equal(record.generalAudit.catalogueSuggestions[0].retainedDiscrepancy,true);assert.equal(JSON.stringify(record.items),items);assert.equal(record.allMatch,false);
 assert.equal(record.generalAudit.decision,'discrepancy');assert.match(record.generalAudit.discrepancies.join(' '),/Product discrepancy retained/);
 assert.equal(generalResolutionQueue(record).checks.find(c=>c.id==='product:Novelhelper')?.state,'unresolved discrepancy');
});
test('confirm resumes the same session and preserves previous valid checks without running another audit',async()=>{
 let record:any=await audit(),catalog=seed(),aiCalls=0;
 // Use a separate unknown product rather than a duplicate request for the first product.
 record.whatsappMessage=header+'Novelhelper - 5\n'+names[1]+' - 5';record.fulfillmentConfirmation=header+names[0]+' [5/5]\n'+names[1]+' [5/5]';
 record={...record,...await runGeneralProductNameAudit(record.whatsappMessage,record.fulfillmentConfirmation,catalog,{deferProductResearch:true,semanticTimeoutMs:0},()=>{throw Error('No AI');})};
 const original={id:record.id,request:record.whatsappMessage,log:record.fulfillmentConfirmation},completed=JSON.stringify(record.items.find((i:any)=>i.name===names[1]));
 const handler=productResearchActions({read:async()=>record,catalog:async()=>catalog,getClient:()=>({models:{async generateContent(){aiCalls++;return mock(['Novelhelper']).models.generateContent();}}}),save:async value=>{record=value;},confirm:async(current,alias,productId,actor)=>{
  const proposed=changeCatalogueAlias(catalog,{revision:catalog.revision,action:'propose',text:alias,productId},actor.id);catalog=proposed.catalog;
  catalog=changeCatalogueAlias(catalog,{revision:catalog.revision,action:'approve',id:catalog.aliasRecords![0].id,identityConfirmed:true},actor.id).catalog;
  record=applyCatalogueConfirmation(current,alias,productId,catalog,actor);return record;
 }});
 assert.equal((await invoke(handler,record,'research_pending','__pending__')).status,200);assert.equal(aiCalls,1);
 const result=await invoke(handler,record,'confirm');assert.equal(result.status,200);assert.equal(record.allMatch,true);assert.equal(aiCalls,1);
 assert.deepEqual({id:record.id,request:record.whatsappMessage,log:record.fulfillmentConfirmation},original);assert.equal(JSON.stringify(record.items.find((i:any)=>i.name===names[1])),completed);
 applyCatalog(catalog);const future=await runGeneralProductNameAudit(record.whatsappMessage,record.fulfillmentConfirmation,catalog,{semanticTimeoutMs:0},()=>{throw Error('Approved alias called AI');});assert.equal(future.allMatch,true);
});
test('late browser research updates only its queue, preserving newer identity decisions and quantities',async()=>{
 const record:any=await audit(),current=structuredClone(record),response=structuredClone(record);
 current.generalAudit.orderer.identityDecision={action:'confirm',revision:1};current.items[0].requested=99;
 response.generalAudit.catalogueSuggestions[0].researchRevision=1;response.generalAudit.catalogueSuggestions[0].researchStatus='analysed';
 const merged=mergeResearchResult(current,response);
 assert.deepEqual(merged.generalAudit.orderer,current.generalAudit.orderer);assert.deepEqual(merged.items,current.items);assert.equal(merged.generalAudit.catalogueSuggestions[0].researchRevision,1);
 assert.equal(mergeResearchResult(current,{...response,id:'another-audit'}),current);
});
test('429 and unavailable grounding retain deterministic findings and actionable next steps',async()=>{
 let calls=0;const client={models:{async generateContent(){calls++;throw Object.assign(Error('rate limit'),{status:429});}}};
 const groups=await researchProducts(['Unseen-one','Unseen-two'],seed(),()=>client,{config,scope:'queue-429',counterpartNames:[names[0]]});
 assert.equal(calls,1);assert.ok(groups.every(g=>g.researchStatus==='rate_limited'&&g.nextSteps?.length));
 let searches=0;const grounded={models:{async generateContent(input:any){if(input.config.tools){searches++;throw Error('Search unavailable');}return mock(['Searchbrand']).models.generateContent();}}};
 const result=await researchProducts(['Searchbrand'],seed(),()=>grounded,{config:{...config,search:true},scope:'grounding-unavailable',counterpartNames:[names[0]]});
 assert.equal(searches,1);assert.equal(result[0].searchStatus,'unavailable');assert.equal(result[0].options[0].productId,'product0');
});
test('both interfaces omit the removed progress section while retaining actionable results',async()=>{
 for(const unknown of [false,true]){
  const record:any=await audit(unknown),html=[renderToStaticMarkup(createElement(Inventory,{record,items:record.items,details:record.generalAudit,onOrderLimit(){}})),buildGeneralReport(record)];
  for(const markup of html){assert.doesNotMatch(markup,/Audit progress|Completed checks:|Resolution queue|<progress\b/);assert.equal(markup.includes('Review Suggestions'),unknown);}
 }
});
test('usage counters distinguish provider requests, token metadata and actual grounded responses',async()=>{
 const tracker=new GeminiUsageTracker();
 await tracker.run(async()=>({usageMetadata:{promptTokenCount:12,candidatesTokenCount:4,totalTokenCount:16},candidates:[{groundingMetadata:{webSearchQueries:['medical term']}}]}));
 await assert.rejects(()=>tracker.run(async()=>{throw Error('offline');}));
 assert.deepEqual(tracker.getUsage(),{requests:2,failedRequests:1,promptTokens:12,outputTokens:4,totalTokens:16,groundedResponses:1,searchQueries:1,responsesWithoutTokenUsage:0});
});
test('unresolved name and facility research is batched, cached and never approves identities',async()=>{
 const record:any=await audit(false);record.allMatch=false;
 for(const field of ['orderer','facility'])record.generalAudit[field]={...record.generalAudit[field],status:'review required',whatsappValue:field==='orderer'?'Jemimah Huseini':'Example Heath Centre',fulfillmentValue:field==='orderer'?'Hussein Jemimah':'Example Health Centre'};
 record.generalAudit.identityResearch={orderer:{status:'deferred'},facility:{status:'deferred'}};
 let calls=0;const client={models:{async generateContent(input:any){calls++;assert.equal(input.config.tools,undefined);assert.equal(JSON.parse(input.contents).comparisons.length,2);return {text:JSON.stringify({suggestions:['orderer','facility'].map(field=>({field,possibleMatch:true,reason:'Possible spelling variation; confirm with the CCA.'}))})};}}};
 const [first,second]=await Promise.all([researchPendingIdentities(record,()=>client),researchPendingIdentities(record,()=>client)]);
 assert.equal(calls,1);assert.deepEqual(first,second);assert.equal(first.generalAudit.orderer.status,'review required');assert.equal(first.allMatch,false);assert.deepEqual(first.items,record.items);assert.equal(first.generalAudit.identityResearch.facility.suggestion.source,'gemini');
 const cleared=await audit(false);await researchPendingIdentities(cleared,()=>{throw Error('Recognized identity called AI');});
 const current=structuredClone(record);current.generalAudit.orderer.identityDecision={action:'confirm',revision:1};
 const merged=mergeResearchResult(current,first);assert.equal(merged.generalAudit.orderer.identityDecision.action,'confirm');assert.equal(merged.generalAudit.identityResearch.orderer.status,'deferred');assert.equal(merged.generalAudit.identityResearch.facility.status,'analysed');
});
test('extension background research leaves controls usable and merges into the current audit',async()=>{
 const {parseHTML}=await import('linkedom'),{document}=parseHTML('<html><body><main></main></body></html>'),root=document.querySelector('main')!;
 let record:any=await audit(),requests=0,busyCalls=0,release!:(result:any)=>void;
 const original=structuredClone(record);
 const controller=setupGeneralProductReview({root,request:async()=>{requests++;return new Promise(resolve=>{release=resolve;});},getResult:()=>record,getSources:()=>record,contextKey:()=>1,onBusy:()=>{busyCalls++;},onSaved:(value:any)=>{record=value;root.innerHTML=controller.render(record);},rerender:()=>{root.innerHTML=controller.render(record);}});
 root.innerHTML=controller.render(record);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests,1);assert.equal(controller.isBusy(),false);assert.equal(busyCalls,0);assert.ok(root.querySelectorAll('[data-product-key]').length>=10);
 record={...record,generalAudit:{...record.generalAudit,orderer:{...record.generalAudit.orderer,reason:'Newer identity evidence'}}};
 original.generalAudit.catalogueSuggestions[0].researchRevision=1;original.generalAudit.catalogueSuggestions[0].researchStatus='analysed';
 release(original);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(record.generalAudit.orderer.reason,'Newer identity evidence');assert.equal(record.generalAudit.catalogueSuggestions[0].researchStatus,'analysed');assert.equal(requests,1);assert.equal(busyCalls,0);
});
test('a background failure cannot discard an extension identity confirmation in progress',async()=>{
 const {parseHTML}=await import('linkedom'),{document,window}=parseHTML('<html><body><main></main></body></html>'),root=document.querySelector('main')!;
 let record:any=await audit(),rejectResearch!:(error:any)=>void,resolveIdentity!:(value:any)=>void;
 record.generalAudit.orderer={...record.generalAudit.orderer,status:'review required'};
 const controller=setupGeneralProductReview({root,request:(url:string)=>url.endsWith('identity-decision')?new Promise(resolve=>{resolveIdentity=resolve;}):new Promise((_resolve,reject)=>{rejectResearch=reject;}),getResult:()=>record,getSources:()=>record,contextKey:()=>1,onSaved:(value:any)=>{record=value;root.innerHTML=controller.render(record);},rerender:()=>{root.innerHTML=controller.render(record);}});
 root.innerHTML=controller.render(record);await new Promise(resolve=>setImmediate(resolve));
 const button=root.querySelector('[data-identity-field="orderer"] [data-identity-action="confirm"]')!;assert.ok(button);
 button.dispatchEvent(new window.Event('click',{bubbles:true}));assert.equal(controller.isBusy(),true);
 rejectResearch(Error('Offline'));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(record.generalAudit.orderer.identityDecision,undefined);
 resolveIdentity(applyIdentityDecision(record,'orderer','confirm',{id:'cca',name:'CCA Mary'}));
 await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(record.generalAudit.orderer.identityDecision.action,'confirm');assert.equal(record.generalAudit.orderer.status,'match');assert.equal(record.generalAudit.catalogueSuggestions[0].researchStatus,'unavailable');assert.equal(controller.isBusy(),false);
});
test('UI updates while a background call is active cannot submit duplicate research',async()=>{
 const record=await audit();let calls=0,release!:(value:any)=>void;
 const request=async()=>{calls++;return new Promise(resolve=>{release=resolve;});};
 const first=researchPendingProducts(request,record),second=researchPendingProducts(request,structuredClone(record));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);release(record);
 const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);assert.notEqual(a,b);
});
