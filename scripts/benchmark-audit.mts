import { performance } from 'node:perf_hooks';
import { runGeneralSemanticAudit } from '../server/generalSemanticAudit.ts';
import { servedFacilityRecords } from '../server/generalFacilityRecords.ts';
const headers = 'Facility: Asaam HC\nOrderer: Test Operator\n';
const cases = [
 [headers+'PCM - 5',headers+'Paracetamol [5/5]'],
 [headers+'PCM - 5',headers.replace('Asaam HC','Another HC')+'PCM [5/5]'],
 [headers+'PCM - 5',headers.replace('Test Operator','Other Operator')+'PCM [5/5]'],
 [headers+'PCM - 5\nAmoxicillin - 2',headers+'PCM [3/5]\nAmoxicillin [0/2]'],
 [headers+'PCM - 5',headers+'PCM - 3 (order limit applied)'],
 [headers+'BCG - 2',headers+'BCG [2/2]\nBCG Diluent [2/2]']
];
const rows: any[] = [];
async function sample(kind: string, customer: string, fulfilment: string, delay = 0) {
 let calls=0; let sdkSignal: AbortSignal | undefined; const start=performance.now();
 let result: any, error=false;
 try { result=await runGeneralSemanticAudit(customer,fulfilment,{}, {facilityContext:{records:[...servedFacilityRecords]}},()=>({models:{async generateContent(options: any){
   sdkSignal = options.config.abortSignal; calls++; await new Promise(resolve=>setTimeout(resolve,delay));
   const absent=()=>({customerRequest:null,fulfilmentConfirmation:null,equivalent:false,confidence:0});
   const product=(sourceText: string, name: string)=>({sourceText,name,normalizedName:'Paracetamol 500mg tablets',quantityText:'5',quantity:5,confidence:0.99});
   return {text:JSON.stringify({facility:absent(),orderer:absent(),customerProducts:[product('Please send 5 PCM 500mg tablets today.', 'PCM 500mg tablets')],fulfilmentProducts:[product('We have packed 5 Paracetamol 500mg tablets today.', 'Paracetamol 500mg tablets')],possibleMissingProducts:[],possibleExtraProducts:[],semanticWarnings:[]})};
 }}})); } catch {error=true;}
 rows.push({kind,ms:performance.now()-start,calls,error,passed:result?.allMatch===true,review:!!result?.generalAudit?.semanticReviews?.length,timeout:sdkSignal?.aborted===true});
}
// Warm-up is excluded from the report. Inputs are synthetic; no live API calls.
await sample('warmup',...cases[0] as [string,string]);rows.length=0;
for(let i=0;i<24;i++) await sample('deterministic',...cases[i%cases.length] as [string,string]);
for(let i=0;i<6;i++) {
 const h=headers.replace('Test Operator',`Synthetic Operator ${i}`);
 await sample('mock_ai_900ms',h+'Please send 5 PCM 500mg tablets today.',h+'We have packed 5 Paracetamol 500mg tablets today.',900);
}
function stats(kind: string) {
 const r=rows.filter(row=>row.kind===kind), times=r.map(row=>row.ms).sort((a,b)=>a-b), n=r.length;
 return {samples:n,averageMs:times.reduce((a,b)=>a+b,0)/n,medianMs:(times[Math.floor((n-1)/2)]+times[Math.floor(n/2)])/2,p95Ms:times[Math.ceil(n*.95)-1],geminiRequestsPerAudit:r.reduce((s,row)=>s+row.calls,0)/n,timeoutRate:r.filter(row=>row.timeout).length/n,verifiedMatchRate:r.filter(row=>row.passed).length/n,manualReviewRate:r.filter(row=>row.review).length/n,errorRate:r.filter(row=>row.error).length/n};
}
console.log(JSON.stringify({node:process.version,environment:'Local in-process engine, 1509 static facility records; mocked 900ms Gemini; excludes network, auth, Firestore, rendering',deterministic:stats('deterministic'),aiAssisted:stats('mock_ai_900ms')},null,2));
