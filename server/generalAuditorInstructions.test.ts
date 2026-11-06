import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {GENERAL_AUDITOR_INSTRUCTIONS, generalAuditorAiContext, usesGeneralAuditorInstructions} from './generalAuditorInstructions';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog, defaultProducts} from './productCatalog';
import {applyGeneralOrderLimitDecision} from './generalAuditor';
import {applySourceProductConfirmation} from './generalSourceProductConfirmation';
import {productResearchActions} from './productResearchActions';
import {researchPendingIdentities} from './generalIdentityResearch';
import {generalInputFingerprint} from '../shared/generalAuditFingerprint';
import {GeneralOrderLimitPrompt} from '../src/components/GeneralFulfillmentSummary';
import type {ProductCatalog} from '../shared/productCatalog';

const origin = {auditScope:'general_auditor', checkSource:'order_checker_app'};
const header = 'Orderer: John Mensah\nFacility: Example HC\n';
const seed = defaultProducts();
async function audit(request:string, confirmation:string, catalog:ProductCatalog={revision:1,products:structuredClone(seed)}) {
  applyCatalog(catalog);
  let calls=0;
  const context=generalAuditorAiContext(origin,()=>{calls++;throw Error('AI unnecessary');},'import-rules');
  const whatsappMessage=header+request,fulfillmentConfirmation=header+confirmation;
  const result=await runGeneralProductNameAudit(whatsappMessage,fulfillmentConfirmation,catalog,
    {semanticTimeoutMs:0,semanticCacheScope:context.cacheScope},context.getClient);
  return {record:{...result,id:'instruction-test',createdByUserId:'cca',auditScope:'general_auditor',clientSource:'order_checker_app',whatsappMessage,fulfillmentConfirmation},calls};
}

test('policy selection excludes every protected mode and extension, including saved records',()=>{
  assert.equal(usesGeneralAuditorInstructions(origin),true);
  assert.equal(usesGeneralAuditorInstructions({auditScope:'general_auditor',clientSource:'order_checker_app'}),true);
  for(const input of [{},{auditScope:'vaccine_checker'},{auditScope:'general_order_checker'},
    {...origin,checkSource:'companion_extension'},{...origin,clientSource:'companion_extension'},
    {...origin,auditMode:'whatsapp_and_fulfillment'},{...origin,auditMode:'fulfillment_only'},
    {...origin,checkSource:'fs_integration'}]) {
    const client=()=>{};const selected=generalAuditorAiContext(input,client,'original');
    assert.equal(usesGeneralAuditorInstructions(input),false);
    assert.equal(selected.getClient,client);assert.equal(selected.cacheScope,'original');
  }
});
test('dedicated policy appends to the task without mutating the SDK, schema, model or cancellation',async()=>{
  let received:any;
  const client={models:{async generateContent(request:any){assert.equal(this,client.models);received=request;return {text:'{}'};}}};
  const method=client.models.generateContent,signal=new AbortController().signal,schema={type:'OBJECT'};
  const request={model:'existing-model',contents:'source snippets',config:{systemInstruction:'Schema-specific task',responseSchema:schema,abortSignal:signal,httpOptions:{timeout:1000}}};
  const selected=generalAuditorAiContext(origin,()=>client,'cca');
  assert.equal(selected.getClient(),selected.getClient());
  await selected.getClient().models.generateContent(request);
  assert.equal(client.models.generateContent,method);assert.equal(request.config.systemInstruction,'Schema-specific task');
  assert.equal(received.config.systemInstruction,`Schema-specific task\n\n${GENERAL_AUDITOR_INSTRUCTIONS}`);
  assert.equal(received.config.responseSchema,schema);assert.equal(received.config.abortSignal,signal);
  assert.equal(received.model,request.model);assert.equal(received.contents,request.contents);
  assert.notEqual(selected.cacheScope,'cca');
});
test('public grounding retains its existing privacy instructions unchanged',async()=>{
  let received:any;const client={models:{async generateContent(r:any){received=r;}}};
  const request={contents:'public terms only',config:{systemInstruction:'Safe public research',tools:[{googleSearch:{}}]}};
  await generalAuditorAiContext(origin,()=>client).getClient().models.generateContent(request);
  assert.equal(received,request);
});
test('exact facility, orderer, product and quantity pass without Gemini',async()=>{
  const {record,calls}=await audit('Paracetamol 500mg Tablet - 20','Paracetamol 500mg Tablet [20/20]');
  assert.equal(record.allMatch,true);assert.equal(calls,0);
});
test('recognized clinical alias and facility abbreviation pass',async()=>{
  const {record,calls}=await audit('PCM - 20','Paracetamol 500mg Tablet [20/20]');
  assert.equal(record.allMatch,true);assert.equal(calls,0);
});
test('identical unlisted products pass without Gemini or catalogue registration',async()=>{
  const catalog={revision:1,products:[]};
  const {record,calls}=await audit('New Medicine XYZ 500mg - 20','New Medicine XYZ 500mg [20/20]',catalog);
  assert.equal(record.allMatch,true);assert.equal(calls,0);assert.deepEqual(catalog.products,[]);
});
for(const [field,replacement] of [['Facility','Another Hospital'],['Orderer','Peter Brown']] as const) {
  test(`different ${field.toLowerCase()} remains a discrepancy`,async()=>{
    const catalog={revision:1,products:structuredClone(seed)};applyCatalog(catalog);
    const context=generalAuditorAiContext(origin,()=>{throw Error('No AI');});
    const request=header+'PCM - 1',confirmation=header.replace(field==='Facility'?'Example HC':'John Mensah',replacement)+'PCM [1/1]';
    const result=await runGeneralProductNameAudit(request,confirmation,catalog,{semanticTimeoutMs:0},context.getClient);
    assert.equal(result.allMatch,false);assert.equal(result.generalAudit[field==='Facility'?'facility':'orderer'].status,'mismatch');
  });
}
test('missing and additional products remain genuine discrepancies',async()=>{
  const missing=(await audit('PCM - 1\nORS - 2','PCM [1/1]')).record;
  assert.ok(missing.items.some(item=>item.status==='missing item'));assert.equal(missing.allMatch,false);
  const extra=(await audit('PCM - 1','PCM [1/1]\nORS [2/2]')).record;
  assert.ok(extra.items.some(item=>item.status==='extra item'));assert.equal(extra.allMatch,false);
});
test('quantity mismatch requires an individual order-limit decision; declining retains it',async()=>{
  const {record}=await audit('PCM - 20','PCM [10/10]');
  assert.equal(record.allMatch,false);const key=record.items[0].fulfillment.key;
  const confirmed=applyGeneralOrderLimitDecision(record,key,true),declined=applyGeneralOrderLimitDecision(record,key,false);
  assert.equal(confirmed.allMatch,true);assert.equal(declined.allMatch,false);
  assert.equal(confirmed.items[0].fulfillment.requested,20);assert.equal(confirmed.items[0].fulfillment.supplied,10);
  const markup=renderToStaticMarkup(createElement(GeneralOrderLimitPrompt,{product:record.items[0].fulfillment,onDecision(){},confirmationLabels:true}));
  for(const text of ['Order Limit Confirmation Required','Confirm Order Limit','No, Keep Discrepancy'])assert.ok(markup.includes(text));
});
test('stockout remains visible alongside genuine discrepancies and does not block an otherwise valid order',async()=>{
  const stock=(await audit('PCM - 20','PCM [0/10]')).record;
  assert.equal(stock.allMatch,true);assert.equal(stock.items[0].status,'out of stock');assert.equal(stock.confidence,100);
  const mixed=(await audit('PCM - 20\nORS - 2','PCM [0/10]')).record;
  assert.equal(mixed.allMatch,false);assert.ok(mixed.items.some(i=>i.status==='out of stock'));assert.ok(mixed.items.some(i=>i.status==='missing item'));
});
test('approved explicit pack-to-unit conversion passes without changing packaging data',async()=>{
  const {record}=await audit('ORS - 2 boxes','ORS - 50 sachets');
  assert.equal(record.allMatch,true);assert.ok(record.items[0].fulfillment.conversion);
  assert.equal((await audit('ORS - 2 boxes','ORS - 50 boxes')).record.allMatch,false);
});
test('missing required BCG diluent fails; legitimate equal paired additions are accepted',async()=>{
  const missing=(await audit('BCG - 3','Bacille Calmette-Guerin Vaccine [3/3]')).record;
  assert.equal(missing.allMatch,false);assert.ok(missing.generalAudit.discrepancies.some(d=>/diluent/i.test(d)));
  const paired=(await audit('BCG - 3','Bacille Calmette-Guerin Vaccine [3/3]\nBacille Calmette-Guerin Vaccine Diluent [3/3]')).record;
  assert.equal(paired.allMatch,true);assert.ok(!paired.items.some(i=>i.status==='extra item'));
});
test('CCA-confirmed uncertain product resumes the same audit but cannot waive quantity differences',async()=>{
  for(const count of [20,10]) {
    const {record}=await audit('New Medicine XYZ 500mg - 20',`XYZ Tablets 500mg [${count}/${count}]`,{revision:1,products:[]});
    assert.equal(record.allMatch,false);
    const confirmed=applySourceProductConfirmation(record,'New Medicine XYZ 500mg','XYZ Tablets 500mg',{revision:1,products:[]},{id:'cca',name:'CCA'});
    assert.equal(confirmed.id,record.id);assert.equal(confirmed.whatsappMessage,record.whatsappMessage);
    assert.equal(confirmed.allMatch,count===20);
  }
});
test('rejecting an uncertain product keeps its discrepancy and never learns it',async()=>{
  const catalog={revision:1,products:[]};let {record}=await audit('New Medicine XYZ 500mg - 20','XYZ Tablets 500mg [20/20]',catalog);
  const group=record.generalAudit.catalogueSuggestions![0];
  const handler=productResearchActions({read:async()=>record,catalog:async()=>catalog,getClient:()=>{throw Error('Reject must not call AI');},save:async value=>{record=value;},confirm:async()=>{throw Error('Reject must not confirm');}});
  let status=200;
  await handler({params:{id:record.id},body:{action:'reject',alias:group.alias,productId:group.options[0].productId,researchRevision:0,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)}} as any,
    {locals:{authUser:{id:'cca',name:'CCA'}},status(n:number){status=n;return this;},json(){}} as any,()=>{});
  assert.equal(status,200);assert.equal(record.allMatch,false);assert.deepEqual(catalog.products,[]);
  assert.deepEqual(record.generalAudit.catalogueSuggestions![0].rejectedProductIds,[group.options[0].productId]);
});
test('server wiring keeps legacy SYSTEM_INSTRUCTIONS and protected routes separate',()=>{
  const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
  assert.ok(source.includes('const generalAi = generalAuditorAiContext(body, getGeminiClient, res.locals.authUser?.id)'));
  assert.ok(source.includes('}, generalAi.getClient)))'));
  assert.ok(source.includes('systemInstruction: SYSTEM_INSTRUCTIONS'));
  assert.ok(source.includes('researchContext:(record,scope)=>generalAuditorAiContext(record,getGeminiClient,scope)'));
  assert.ok(!source.slice(source.indexOf('const SYSTEM_INSTRUCTIONS = `'),source.indexOf('// Helper function',source.indexOf('const SYSTEM_INSTRUCTIONS = `'))).includes(GENERAL_AUDITOR_INSTRUCTIONS));
});

test('deferred research uses website-only instructions and cannot reuse extension research cache',async()=>{
  const catalog:ProductCatalog={revision:1,products:structuredClone(seed)};
  const original=(await audit('Feverhelper - 5','Paracetamol 500mg Tablet [5/5]',catalog)).record;
  const requests:any[]=[];
  const client={models:{async generateContent(request:any){requests.push(request);return {text:'{"matches":[]}'};}}};
  for(const clientSource of ['order_checker_app','companion_extension']) {
    let record:any=structuredClone({...original,clientSource});
    for(const group of record.generalAudit.catalogueSuggestions)group.researchStatus='deferred';
    const handler=productResearchActions({read:async()=>record,catalog:async()=>catalog,getClient:()=>client,
      researchContext:(saved,scope)=>generalAuditorAiContext(saved,()=>client,scope),
      save:async value=>{record=value;},confirm:async()=>{throw Error('Research cannot confirm');}});
    let status=200;
    await handler({params:{id:record.id},body:{action:'research_pending',alias:'Feverhelper',researchRevision:0,
      whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)}} as any,
      {locals:{authUser:{id:'cca',name:'CCA'}},status(n:number){status=n;return this;},json(){}} as any,()=>{});
    assert.equal(status,200);assert.equal(record.allMatch,false);assert.equal(record.id,original.id);
  }
  assert.equal(requests.length,2);
  assert.ok(requests[0].config.systemInstruction.includes(GENERAL_AUDITOR_INSTRUCTIONS));
  assert.ok(!requests[1].config.systemInstruction.includes(GENERAL_AUDITOR_INSTRUCTIONS));
});
test('identity research policy and cache stay isolated from extension identity suggestions',async()=>{
  const requests:any[]=[];
  const client={models:{async generateContent(request:any){requests.push(request);return {text:'{"suggestions":[{"field":"facility","reason":"Confirm the spelling","possibleMatch":true}]}'};}}};
  const base={auditScope:'general_auditor',createdByUserId:'identity-isolation',generalAudit:{facility:{status:'review required',whatsappValue:'Example HC',fulfillmentValue:'Exampel HC'},orderer:{status:'match'},identityResearch:{facility:{status:'deferred'}}}};
  for(const clientSource of ['order_checker_app','companion_extension']) {
    const record={...base,clientSource},context=generalAuditorAiContext(record,()=>client,record.createdByUserId);
    const researched=await researchPendingIdentities(record,context.getClient,context.cacheScope);
    assert.equal(researched.generalAudit.facility.status,'review required');
    assert.equal(researched.generalAudit.identityResearch.facility.status,'analysed');
  }
  assert.equal(requests.length,2);
  assert.ok(requests[0].config.systemInstruction.includes(GENERAL_AUDITOR_INSTRUCTIONS));
  assert.ok(!requests[1].config.systemInstruction.includes(GENERAL_AUDITOR_INSTRUCTIONS));
});

test('General-only model configuration preserves other modes, the base client and grounding',async()=>{
 const previous=process.env.GENERAL_AUDITOR_MODEL;const calls:any[]=[];
 const client={models:{async generateContent(request:any){calls.push(request);return {text:'{}'};}}};
 try{
  process.env.GENERAL_AUDITOR_MODEL='gemini-configured-test';
  const context=generalAuditorAiContext(origin,()=>client,'model-config');
  await context.getClient().models.generateContent({model:'default',contents:'product only'});
  assert.equal(calls[0].model,'gemini-configured-test');assert.match(context.cacheScope!,/gemini-configured-test/);
  const protectedContext=generalAuditorAiContext({auditScope:'vaccine_checker'},()=>client);
  await protectedContext.getClient().models.generateContent({model:'vaccine-original'});
  assert.equal(calls[1].model,'vaccine-original');
  const grounded={model:'public-search-model',config:{tools:[{googleSearch:{}}]}};
  await context.getClient().models.generateContent(grounded);assert.equal(calls[2],grounded);
  process.env.GENERAL_AUDITOR_MODEL='different-model';
  assert.notEqual(context.getClient(),generalAuditorAiContext(origin,()=>client).getClient());
  assert.equal(client.models.generateContent.name,'generateContent');
 }finally{if(previous===undefined)delete process.env.GENERAL_AUDITOR_MODEL;else process.env.GENERAL_AUDITOR_MODEL=previous;}
});
