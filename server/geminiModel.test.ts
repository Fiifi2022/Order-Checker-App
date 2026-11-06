import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {GEMINI_MODEL,GEMINI_THINKING_CONFIG,geminiModelConfig} from './geminiModel';
import {researchConfig,researchProduct} from './productResearch';
import {geminiProviderTimeout} from './geminiTransport';
import {optionalAuditAi} from './auditBudget';
import {GeminiUsageTracker} from './geminiUsage';

test('Gemini audit, product research and optional grounding default to 3.8 Flash',()=>{
  assert.equal(GEMINI_MODEL,'gemini-3.8-flash');
  assert.equal(researchConfig({}).model,GEMINI_MODEL);assert.equal(researchConfig({}).searchModel,GEMINI_MODEL);
  assert.equal(researchConfig({}).search,false,'Migration must not enable separately billed grounding');
  assert.deepEqual(GEMINI_THINKING_CONFIG,{thinkingLevel:'LOW'});
});
test('3.8 config preserves validation and cancellation while removing unsupported legacy settings',()=>{
  const controller=new AbortController(),schema={type:'OBJECT'},httpOptions={timeout:10000,retryOptions:{attempts:1}};
  const original={temperature:0,topP:.9,topK:20,candidateCount:1,thinkingConfig:{thinkingBudget:0},responseSchema:schema,responseMimeType:'application/json',abortSignal:controller.signal,maxOutputTokens:4096,httpOptions};
  const config=geminiModelConfig(original);
  assert.equal(config.responseSchema,schema);assert.equal(config.abortSignal,controller.signal);assert.equal(config.httpOptions,httpOptions);
  assert.equal(config.maxOutputTokens,4096);assert.deepEqual(config.thinkingConfig,{thinkingLevel:'LOW'});
  for(const key of ['temperature','topP','topK','candidateCount'])assert.equal(key in config,false);
  assert.deepEqual(original.thinkingConfig,{thinkingBudget:0},'Never mutate the caller’s config');
});
test('real legacy wrapper and image/extraction callers cannot route back to an older Gemini model',async()=>{
  const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
  const start=source.indexOf('async function generateAuditContent('),end=source.indexOf('// Health-check endpoint',start);
  const tracker=new GeminiUsageTracker(),context=vm.createContext({GEMINI_MODEL,geminiModelConfig,geminiUsage:tracker,optionalAuditAi,geminiProviderTimeout});
  vm.runInContext(ts.transpile(source.slice(start,end)),context);
  let calls=0;
  const client={models:{async generateContent(options:any){calls++;assert.equal(options.model,GEMINI_MODEL);assert.equal(options.config.temperature,undefined);assert.equal(options.config.thinkingConfig.thinkingLevel,'LOW');assert.equal(options.generalAuditorFast,undefined);return {text:'{"ok":true}'};}}};
  await context.generateAuditContent(client,{model:'gemini-2.5-flash-lite',generalAuditorFast:true,contents:'synthetic input',config:{temperature:0,thinkingConfig:{thinkingBudget:0},responseMimeType:'application/json'}});
  await context.generateAuditContent(client,{model:'gemini-3.5-flash',contents:[{inlineData:{mimeType:'image/png',data:'fixture'}}]});
  assert.equal(calls,2);
});
test('actual research requests use supported 3.8 settings and a 503 never causes a model fallback',async()=>{
  let calls=0;
  const group=await researchProduct('Unfamiliar synthetic remedy',{revision:9800,products:[]},()=>({models:{async generateContent(request:any){calls++;assert.equal(request.model,GEMINI_MODEL);assert.equal(request.config.temperature,undefined);assert.deepEqual(request.config.thinkingConfig,{thinkingLevel:'LOW'});assert.equal(request.config.httpOptions.retryOptions.attempts,1);throw Object.assign(Error('high demand'),{status:503});}}}),{scope:'gemini38-config',force:true,config:{...researchConfig({}),timeoutMs:1000}});
  assert.equal(calls,1);assert.equal(group.researchStatus,'unavailable');assert.equal(group.options.length,0);
});
test('all direct Gemini feature modules use the central model and compatible thinking settings',()=>{
  for(const file of ['generalFacilitySuggestion.ts','generalOrdererFallback.ts','generalOrderInterpretation.ts','auditSemantics.ts','catalogAliasAssistant.ts','productResearch.ts','generalIdentityResearch.ts','generalHybridExtraction.ts']){
    const source=readFileSync(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/gemini-2\.5|thinkingBudget|temperature\s*:/,file);
    assert.match(source,/GEMINI_THINKING_CONFIG/,file);
  }
});
