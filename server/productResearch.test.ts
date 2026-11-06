import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {researchProduct,researchConfig,groundingEvidence,publicResearchQuery,actionableResearchGroup} from './productResearch';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import {productResearchActions} from './productResearchActions';
import {changeCatalogueAlias,catalogueAliasRecords} from './catalogAliasLearning';
import {applyCatalogueConfirmation} from './generalCatalogueConfirmation';
import {applySourceProductConfirmation} from './generalSourceProductConfirmation';
import {generalInputFingerprint} from '../shared/generalAuditFingerprint';
import {generalCatalogueAiCandidates} from './generalCatalogueAi';
import type {ProductCatalog} from '../shared/productCatalog';
import Suggestions from '../src/components/GeneralCatalogueSuggestions';
import {buildGeneralReport} from '../extension/general-report.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {canAccessAuditRecord,assertUnchangedAuditOwner} from './auditRecordAccess';
import {generalCatalogAttributeConflict} from '../src/utils/generalProductLog';
import {catalogAliasKey} from '../shared/productCatalog';
const seed=():ProductCatalog=>({revision:1,products:[{id:'pcm500',name:'Paracetamol 500mg Tablet',scope:'general',aliases:['PCM'],contextualAliases:[],category:'medicine',note:''}]});
const config={model:'test-research',searchModel:'test-grounding',search:false,timeoutMs:1500};
const header='Name: Mary Mensah\nFacility: Example HC\n';
const mock=(data:any)=>({models:{async generateContent(){return {text:JSON.stringify(data)};}}});

test('exact catalogue and approved alias comparisons require no research call',async()=>{
 const catalog=seed();applyCatalog(catalog);
 for(const name of ['Paracetamol 500mg Tablet','PCM']){
  const direct=await researchProduct(name,catalog,()=>{throw Error('Exact catalogue research called AI');},{config});assert.equal(direct.researchStatus,'catalogue');
  let calls=0;const r=await runGeneralProductNameAudit(header+name+' 5',header+'Paracetamol 500mg Tablet [5/5]',catalog,{semanticTimeoutMs:1000},()=>{calls++;throw Error('No AI');});
  assert.equal(r.allMatch,true);assert.equal(calls,0);
 }
});
test('misspelled names retrieve a supported catalogue candidate without asserting equivalence',()=>{
 const catalog=seed(),rows=generalCatalogueAiCandidates(catalog.products,['Paracetmol'],[],s=>s.toLowerCase().replace(/[^a-z]+/g,' '));
 assert.equal(rows[0]?.id,'pcm500');const group=actionableResearchGroup('Paracetmol',catalog,[]);
 assert.equal(group.options[0].productId,'pcm500');assert.equal(group.options[0].evidenceSource,'catalogue');assert.equal(group.confidenceCategory,'MEDIUM');
});
test('unfamiliar terminology can be researched even without any overlapping catalogue words',async()=>{
 let calls=0;
 const result=await researchProduct('Zedbrand',seed(),()=>({models:{async generateContent(input:any){calls++;assert.equal(JSON.parse(input.contents).catalog.length,0);return {text:JSON.stringify({matches:[],research:[{alias:'Zedbrand',genericNames:['Paracetamol 500mg Tablet'],reason:'Possible generic ingredient; confirm the package.'}]})};}}}),{config,scope:'unfamiliar'});
 assert.equal(calls,1);assert.equal(result.options[0].productId,'pcm500');assert.equal(result.confidenceCategory,'MEDIUM');assert.equal(result.terminology?.[0].name,'Paracetamol 500mg Tablet');
});
test('batch audits retain unverified generic research leads alongside known fulfilment products',async()=>{
 const catalog=seed();applyCatalog(catalog);
 const result=await runGeneralProductNameAudit(header+'Novelname 5',header+'Paracetamol 500mg Tablet [5/5]',catalog,{semanticTimeoutMs:1000,semanticCacheScope:'generic-batch'},()=>mock({matches:[],research:[{alias:'Novelname',genericNames:['Paracetamol 500mg Tablet'],reason:'Possible ingredient; check packaging.'}]}));
 const group=result.generalAudit.catalogueSuggestions?.find(group=>group.alias==='Novelname');
 assert.equal(group?.options[0]?.productId,'pcm500');assert.equal(group?.terminology?.[0]?.name,'Paracetamol 500mg Tablet');assert.equal(result.allMatch,false);
});
test('a HIGH suggestion is still unapproved; an accepted alias is subsequently reused without Gemini',async()=>{
 let catalog=seed();applyCatalog(catalog);
 const request=header+'Feverhelper 5',fs=header+'Paracetamol 500mg Tablet [5/5]';
 const result=await runGeneralProductNameAudit(request,fs,catalog,{semanticTimeoutMs:1000,semanticCacheScope:'high-pending'},()=>mock({matches:[{alias:'Feverhelper',productId:'pcm500',confidence:.99,clinicalUncertainty:false,reason:'Possible brand terminology; verify label.'}]}));
 assert.equal(result.allMatch,false);assert.ok(result.generalAudit.catalogueSuggestions?.[0].options.length);
 const proposed=changeCatalogueAlias(catalog,{revision:catalog.revision,action:'propose',text:'Feverhelper',productId:'pcm500'},'cca');catalog=proposed.catalog;
 const id=catalog.aliasRecords!.find(r=>r.text==='Feverhelper')!.id;
 catalog=changeCatalogueAlias(catalog,{revision:catalog.revision,action:'approve',id,identityConfirmed:true},'cca').catalog;applyCatalog(catalog);
 const next=await runGeneralProductNameAudit(request,fs,catalog,{semanticTimeoutMs:1000},()=>{throw Error('Approved alias called AI');});assert.equal(next.allMatch,true);assert.equal(next.geminiMetrics.calls,0);
});
test('different strengths and syringe sizes cannot enter the suggested equivalent candidates',async()=>{
 const r=await researchProduct('Paracetamol 250mg Tablet',seed(),()=>mock({matches:[{alias:'Paracetamol 250mg Tablet',productId:'pcm500',confidence:1,clinicalUncertainty:false,reason:'Wrong strength'}],research:[{alias:'Paracetamol 250mg Tablet',genericNames:['Paracetamol 500mg Tablet'],reason:'Wrong'}]}),{config,scope:'strength'});
 assert.deepEqual(r.options,[]);
 const catalog:ProductCatalog={revision:1,products:[{...seed().products[0],id:'syringe',name:'Disp Syringe & Needle, 0.5mL',category:'supply'}]};
 const syringe=await researchProduct('0.05mL solo shots',catalog,()=>mock({matches:[]}),{config,scope:'capacity'});assert.deepEqual(syringe.options,[]);
});
test('429 responses share cooldown across different products and keep useful fallback steps',async()=>{
 let calls=0;const client={models:{async generateContent(){calls++;throw Object.assign(Error('quota'),{status:429});}}};
 for(const alias of ['Unknownbrand-one','Unknownbrand-two']){const r=await researchProduct(alias,seed(),()=>client,{config,scope:'rate-limit',force:true});assert.equal(r.researchStatus,'rate_limited');assert.ok(r.nextSteps!.length);assert.equal(r.confidenceCategory,'LOW');}
 assert.equal(calls,1);
});
test('timeout retains unresolved identity and actionable next steps',async()=>{
 const r=await researchProduct('Timeoutbrand',seed(),()=>({models:{generateContent:()=>new Promise(()=>{})}}),{config:{...config,timeoutMs:15},scope:'timeout'});
 assert.ok(['timed_out','unavailable'].includes(r.researchStatus!));assert.equal(r.status,'unavailable');assert.ok(r.nextSteps!.some(s=>/strength/.test(s)));
});
test('successful research is cached and invalidated by catalogue content or revision changes',async()=>{
 let calls=0;const client={models:{async generateContent(){calls++;return{text:JSON.stringify({matches:[]})};}}};
 const c=seed();await researchProduct('Cachedbrand',c,()=>client,{config,scope:'cache'});await researchProduct('Cachedbrand',c,()=>client,{config,scope:'cache'});assert.equal(calls,1);
 await researchProduct('Cachedbrand',{...c,revision:2},()=>client,{config,scope:'cache'});assert.equal(calls,2);
});
test('only actual supported grounding metadata produces citations; invented sources are discarded',()=>{
 assert.deepEqual(groundingEvidence({text:JSON.stringify({sources:[{url:'https://invented.example'}]})}),{sources:[]});
 const data={candidates:[{groundingMetadata:{webSearchQueries:['medical'],groundingChunks:[{web:{uri:'https://www.nhs.uk/medicines/paracetamol-for-adults/',title:'NHS'}},{web:{uri:'javascript:alert(1)',title:'Unsafe'}},{web:{uri:'https://unreferenced.example',title:'No support'}}],groundingSupports:[{groundingChunkIndices:[0,1]}],searchEntryPoint:{renderedContent:'<p>Google Search</p>'}}}]};
 const r=groundingEvidence(data);assert.equal(r.sources.length,1);assert.equal(r.sources[0].title,'NHS');assert.ok(r.entry);
});
test('public research receives only bundled medical terms, never contact or order data',async()=>{
 assert.equal(publicResearchQuery([{productId:'x',name:'John 0551234567 order ABC',reason:'private'}]),null);
 const calls:any[]=[];const client={models:{async generateContent(input:any){calls.push(input);return calls.length===1?{text:JSON.stringify({matches:[{alias:'Privatebrand',productId:'pcm500',confidence:.8,clinicalUncertainty:true,reason:'Verify the label.'}]})}:{text:'No source evidence',candidates:[{groundingMetadata:{webSearchQueries:['Paracetamol']}}]};}}};
 const r=await researchProduct('Privatebrand',seed(),()=>client,{config:{...config,search:true},scope:'privacy',counterpartIds:['pcm500'],counterpartNames:['internal customer John 0551234567 order ABC']});
 assert.equal(calls.length,2);assert.ok(calls[1].config.tools[0].googleSearch);assert.doesNotMatch(calls[1].contents,/Privatebrand|John|0551234567|internal|ABC/);assert.equal(r.searchStatus,'no_sources');assert.deepEqual(r.sources,[]);
});
async function savedRecord(){const c=seed();applyCatalog(c);return {...await runGeneralProductNameAudit(header+'Feverhelper 5',header+'Paracetamol 500mg Tablet [5/5]',c,{semanticTimeoutMs:1000,semanticCacheScope:'actions'},()=>mock({matches:[{alias:'Feverhelper',productId:'pcm500',confidence:.9,clinicalUncertainty:true,reason:'Verify strength'}]})),id:'research-audit',createdByUserId:'cca',whatsappMessage:header+'Feverhelper 5',fulfillmentConfirmation:header+'Paracetamol 500mg Tablet [5/5]'};}
async function invoke(handler:any,record:any,action:string,extra:any={}){let status=200,result:any;await handler({params:{id:record.id},body:{alias:'Feverhelper',action,productId:'pcm500',researchRevision:record.generalAudit.catalogueSuggestions[0]?.researchRevision||0,identityConfirmed:true,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record),...extra}},{locals:{authUser:{id:'cca',name:'CCA Mary'}},status(n:number){status=n;return this;},json(value:any){result=value;}},()=>{});return{status,result};}
test('reject is saved on the same audit, never learns an alias and preserves all product/quantity findings',async()=>{
 let record:any=await savedRecord(),confirmCalls=0;const before=JSON.stringify(record.items);
 const handler=productResearchActions({read:async()=>record,catalog:async()=>seed(),getClient:()=>{throw Error('Reject called AI');},save:async value=>{record=value;},confirm:async()=>{confirmCalls++;}});
 const result=await invoke(handler,record,'reject');assert.equal(result.status,200);assert.equal(confirmCalls,0);assert.equal(record.allMatch,false);assert.equal(JSON.stringify(record.items),before);assert.equal(record.generalAudit.catalogueSuggestions[0].history[0].actor.id,'cca');assert.deepEqual(record.generalAudit.catalogueSuggestions[0].rejectedProductIds,['pcm500']);
});
test('the product chooser distinguishes confirming a match, rejecting a candidate and declaring a discrepancy',async()=>{
 const record=await savedRecord();
 const html=renderToStaticMarkup(createElement(Suggestions,{suggestions:record.generalAudit.catalogueSuggestions,onAction:async()=>{}}));
 assert.match(html,/Decision: Confirm match or mark as discrepancy/);
 assert.match(html,/Confirm Match/);
 assert.match(html,/Mark discrepancy/);
 assert.match(html,/Reject this suggestion/);
 assert.match(html,/Quantity differences remain checked separately/);
 assert.ok(html.indexOf('Suggested product for')<html.indexOf('Mark discrepancy'));
});
test('CCA can mark an unmatched product as a discrepancy even without a suggested candidate',async()=>{
 for(const empty of [false,true]){
  let record:any=await savedRecord();
  if(empty)record.generalAudit.catalogueSuggestions[0].options=[];
  const originalId=record.id,items=JSON.stringify(record.items),facility=JSON.stringify(record.generalAudit.facility);
  let confirmations=0,saves=0;
  const handler=productResearchActions({read:async()=>record,catalog:async()=>seed(),getClient:()=>{throw Error('A CCA decision must not invoke AI');},save:async value=>{record=value;saves++;},confirm:async()=>{confirmations++;throw Error('A discrepancy must not approve an alias');}});
  const response=await invoke(handler,record,'keep',{productId:undefined});
  assert.equal(response.status,200);assert.equal(saves,1);assert.equal(confirmations,0);
  assert.equal(record.id,originalId);assert.equal(record.allMatch,false);assert.equal(record.generalAudit.decision,'discrepancy');
  assert.equal(JSON.stringify(record.items),items);assert.equal(JSON.stringify(record.generalAudit.facility),facility);
  const group=record.generalAudit.catalogueSuggestions[0];
  assert.equal(group.retainedDiscrepancy,true);assert.equal(group.history.at(-1).actor.id,'cca');assert.equal(group.history.at(-1).action,'keep');
  const html=renderToStaticMarkup(createElement(Suggestions,{suggestions:[group],onAction:async()=>{}}));
  assert.match(html,/Discrepancy confirmed by you/);assert.doesNotMatch(html,/Decision: Confirm match or mark as discrepancy/);
  if(empty)assert.match(html,/No supported product suggestion is available yet/);
 }
});
test('stale and changed-source decisions fail; a failed save never reports successful approval',async()=>{
 const record:any=await savedRecord();const handler=productResearchActions({read:async()=>record,catalog:async()=>seed(),getClient:()=>mock({matches:[]}),save:async()=>{throw Error('offline');},confirm:async()=>{throw Error('offline');}});
 assert.equal((await invoke(handler,record,'reject',{researchRevision:4})).status,409);assert.equal((await invoke(handler,record,'reject',{whatsappMessage:'changed'})).status,409);assert.equal((await invoke(handler,record,'confirm')).status,503);assert.equal(record.allMatch,false);
});
test('both interfaces show confidence, next steps and Confirm, Reject, Search Again even without candidates',async()=>{
 for(const group of [actionableResearchGroup('Unknownbrand',seed(),[]),actionableResearchGroup('Paracetmol',seed(),[])]){
  const saved:any=await savedRecord();const base={...saved,generalAudit:{...saved.generalAudit,catalogueSuggestions:[group]}};
  for(const html of [renderToStaticMarkup(createElement(Suggestions,{suggestions:base.generalAudit.catalogueSuggestions,onAction:async()=>{}})),buildGeneralReport(base)]){
   assert.match(html,/Search Again/);assert.match(html,/Reject|reject/);assert.match(html,/Confirm match|Confirm Match/);assert.match(html,/verified probability/);assert.match(html,/strength/);
  }
 }
 assert.equal(researchConfig({}).search,false);assert.equal(researchConfig({PRODUCT_RESEARCH_TIMEOUT_MS:'999999'}).timeoutMs,10000);
});

test('Search Again preserves rejected choices and does not rerun product/quantity comparison',async()=>{
 let record:any=await savedRecord();const rejected=record.generalAudit.catalogueSuggestions[0];rejected.options=[];rejected.rejectedProductIds=['pcm500'];
 const before=JSON.stringify(record.items);let calls=0;
 const handler=productResearchActions({read:async()=>record,catalog:async()=>seed(),getClient:()=>({models:{async generateContent(){calls++;return{text:JSON.stringify({matches:[{alias:'Feverhelper',productId:'pcm500',confidence:.99,clinicalUncertainty:false,reason:'Previously rejected option'}]})};}}}),save:async value=>{record=value;},confirm:async()=>{throw Error('Research cannot approve');}});
 const result=await invoke(handler,record,'research');assert.equal(result.status,200);assert.ok(calls<=1);assert.deepEqual(record.generalAudit.catalogueSuggestions[0].options,[]);assert.equal(record.allMatch,false);assert.equal(JSON.stringify(record.items),before);
});

test('production confirmation commits alias, provenance and audit together; failed commits publish nothing and can retry',async()=>{
 const record:any=await savedRecord(),catalog=seed();
 const records=new Map<string,any>([['audits/'+record.id,structuredClone(record)],['catalog',catalog]]);
 let deps:any,failCommit=true,published=0;
 const ref=(path:string):any=>({path,collection:(name:string)=>({doc:(id:string)=>ref(path+'/'+name+'/'+id)})});
 const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const start=source.indexOf("app.post('/api/audits/:id/product-research',"),end=source.indexOf("app.post('/api/audits/:id/catalogue-confirmation'",start);
 assert.ok(start>=0&&end>start);
 const context={app:{post:()=>{}},productResearchActions:(value:any)=>{deps=value;},
  getDoc:()=>{},doc:()=>{},getFirestoreDb:()=>{},confirmedAuditRead:(value:any)=>structuredClone(value),audits:[],
  readProductCatalog:Object.assign(async()=>catalog,{invalidate:()=>{}}),getGeminiClient:()=>{throw Error('Confirmation called AI');},
  adminDb:{doc:ref},catalogReference:ref('catalog'),catalogSeed:catalog,
  generalInputFingerprint,canAccessAuditRecord,assertUnchangedAuditOwner,generalCatalogAttributeConflict,catalogueAliasRecords,catalogAliasKey,changeCatalogueAlias,applyCatalogueConfirmation,applySourceProductConfirmation,
  cleanFirestorePayload:(value:any)=>JSON.parse(JSON.stringify(value)),applyCatalog:(value:any)=>{published++;applyCatalog(value);},
  runAdminTransaction:async(callback:any)=>{
   const staged=new Map<string,any>();
   const result=await callback({get:async(reference:any)=>({exists:records.has(reference.path),data:()=>structuredClone(records.get(reference.path))}),set:(reference:any,value:any)=>staged.set(reference.path,structuredClone(value))});
   if(failCommit)throw Error('Simulated Firestore commit failure');
   for(const [path,value] of staged)records.set(path,value);
   return result;
  }};
 vm.runInNewContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 const actor={id:'cca',name:'CCA Mary'};
 await assert.rejects(()=>deps.confirm(record,'Feverhelper','pcm500',actor),/commit failure/);
 assert.equal(published,0);assert.equal(records.get('audits/'+record.id).allMatch,false);assert.equal(records.get('catalog').aliasRecords,undefined);
 failCommit=false;
 const result=await deps.confirm(record,'Feverhelper','pcm500',actor);
 assert.equal(result.allMatch,true);assert.equal(result.storage.status,'saved');assert.equal(result.generalAudit.catalogueSuggestions.length,0);assert.equal(published,1);
 assert.equal(records.get('catalog').aliasRecords[0].status,'approved');
 const events=[...records.entries()].filter(([path])=>path.startsWith('catalog/alias_history/')).map(([,value])=>value);
 assert.equal(events.length,2);assert.ok(events.every(event=>event.auditId===record.id&&event.originalProductText==='Feverhelper'));
 assert.equal(result.generalAudit.catalogueConfirmations[0].confirmedBy.id,'cca');
 assert.equal(result.whatsappMessage,record.whatsappMessage);
 const sourceRequest=header+'New Medicine XYZ 500mg - 20',sourceLog=header+'XYZ Tablets 500mg [20/20]';
 const sourceRecord={...await runGeneralProductNameAudit(sourceRequest,sourceLog,seed(),{semanticTimeoutMs:0},()=>{throw Error('No AI');}),id:'source-confirmation',createdByUserId:'cca',whatsappMessage:sourceRequest,fulfillmentConfirmation:sourceLog};
 records.set('audits/'+sourceRecord.id,structuredClone(sourceRecord));
 const beforeCatalog=JSON.stringify(records.get('catalog')),option=sourceRecord.generalAudit.catalogueSuggestions![0].options[0];
 assert.equal(option.kind,'source');
 const confirmed=await deps.confirm(sourceRecord,'New Medicine XYZ 500mg',option.productId,actor);
 assert.equal(confirmed.allMatch,true);assert.equal(confirmed.storage.status,'saved');assert.equal(confirmed.id,sourceRecord.id);
 assert.equal(JSON.stringify(records.get('catalog')),beforeCatalog,'Source confirmation never registers a product or a permanent alias');
 assert.equal(published,1,'An audit-specific confirmation does not publish a catalogue revision');
});
