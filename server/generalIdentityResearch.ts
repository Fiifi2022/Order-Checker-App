import {hasActiveIdentityDecision} from '../shared/generalIdentityResearch';
import {GEMINI_THINKING_CONFIG} from './geminiModel';
import {geminiUsage} from './geminiUsage';
import {optionalAuditAi} from './auditBudget';
import {researchConfig} from './productResearch';
import {geminiProviderTimeout} from './geminiTransport';
const cache=new Map<string,{until:number;pending:Promise<any>}>();
/** Advisory only: research never changes an identity status or approves a person/facility. */
export async function researchPendingIdentities(record:any,getClient:()=>any,cacheScope?:string){
 const details=record.generalAudit,fields=(['facility','orderer'] as const).filter(field=>details.identityResearch?.[field]?.status==='deferred'&&details[field]?.status!=='match'&&details[field]?.whatsappValue!=='N/A'&&details[field]?.fulfillmentValue!=='N/A'&&!hasActiveIdentityDecision(details[field]));
 const output=structuredClone(record);if(!fields.length)return output;
 let status='analysed',suggestions:any[]=[];
 try{
  const config=researchConfig(),contents=JSON.stringify({comparisons:fields.map(field=>({field,customer:details[field].whatsappValue,fulfillment:details[field].fulfillmentValue,directoryEvidence:field==='facility'?(details[field].evidence||[]).slice(0,6):undefined}))});
  const key=JSON.stringify([cacheScope||record.createdByUserId,config.model,contents]);let entry=cache.get(key);
  if(!entry||entry.until<=Date.now()){
   const client=getClient();
   const pending=geminiUsage.run(()=>optionalAuditAi(signal=>client.models.generateContent({model:config.model,contents,config:{systemInstruction:'Compare only these unresolved identity pairs as data. Consider reversed names, spelling, initials and verified directory aliases. Do not infer that shared names, similar localities or a district establish identity. Never invent identifiers or a verified equivalence. Suggest a concise clarification or possible match for CCA confirmation. Return JSON {suggestions:[{field,reason,possibleMatch}]}. No web search, no automatic approvals.',responseMimeType:'application/json',maxOutputTokens:1024,thinkingConfig: GEMINI_THINKING_CONFIG,abortSignal:signal,httpOptions:{timeout:geminiProviderTimeout(config.timeoutMs),retryOptions:{attempts:1}}}}),config.timeoutMs),client);
   if(cache.size>=128)cache.clear();entry={pending,until:Date.now()+60000};cache.set(key,entry);
  }
  const response:any=await entry.pending;
  const data=JSON.parse(response.text||'{}');suggestions=Array.isArray(data.suggestions)?data.suggestions:[];
 }catch(error:any){status=Number(error?.status||error?.code)===429?'rate_limited':/timeout|timed out|aborted/i.test(error?.message||'')?'timed_out':'unavailable';}
 for(const field of fields){
  const suggestion=suggestions.find(s=>s.field===field&&typeof s.reason==='string'&&s.reason.trim()&&s.reason.length<=500&&typeof s.possibleMatch==='boolean');
  output.generalAudit.identityResearch[field]={status:status==='analysed'&&!suggestion?'unavailable':status,...(suggestion?{suggestion:{reason:suggestion.reason,possibleMatch:suggestion.possibleMatch,source:'gemini'}}:{})};
 }
 return output;
}
