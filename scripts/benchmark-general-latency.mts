// Synthetic local catalogue-engine benchmark; never calls Firebase or Gemini.
import {runGeneralProductNameAudit} from '../server/generalProductNameAudit';
import {applyCatalog,defaultProducts} from '../server/productCatalog';
import {servedFacilityRecords} from '../server/generalFacilityRecords';
import assert from 'node:assert/strict';
const catalog={revision:1500,products:defaultProducts()};
const header='Orderer: Test Operator\nFacility: Asaam HC\n';
const cases=[
 ['alias match',header+'ASV 2',header+'Snake Venom Antiserum [2/2]'],
 ['six products',header+'ASV 2\nRDT 5\nORS 3\nParacetamol 500mg Tablet 4\nArtesunate 120mg injection 2\nAmoxicillin 500mg Capsule 3',header+'Snake Venom Antiserum [2/2]\nMalaria Rapid Diagnostic Test Kit [5/5]\nORS [3/3]\nParacetamol 500mg Tablet [4/4]\nArtesunate 120mg injection [2/2]\nAmoxicillin 500mg Capsule [3/3]'],
 ['stockout',header+'RDT 5',header+'Malaria Rapid Diagnostic Test Kit [0/5]'],
 ['quantity discrepancy',header+'RDT 5',header+'Malaria Rapid Diagnostic Test Kit [6/6]'],
 ['missing evidence','Facility: Asaam HC\nQuantity needed: 2 vials',header+'Snake Venom Antiserum [2/2]'],
 ['natural language','This is Test Operator from Asaam HC. Please send ASV 2.',header+'Snake Venom Antiserum [2/2]'],
];
const samples=[];
for(let round=0;round<3;round++) for(const [name,customer,fulfillment] of cases) {
 applyCatalog(catalog);let calls=0;const start=performance.now();
 const result=await runGeneralProductNameAudit(customer,fulfillment,catalog,{facilityContext:{records:[...servedFacilityRecords]},semanticTimeoutMs:0},()=>{calls++;throw Error('Unexpected Gemini');});
 const ms=performance.now()-start;assert.equal(calls,0);samples.push({name,ms:Math.round(ms*100)/100,decision:result.generalAudit.decision});
}
const times=samples.map(row=>row.ms).sort((a,b)=>a-b);
console.log(JSON.stringify({scope:'Local in-process current catalogue engine; synthetic inputs; no network, authentication, Firestore or browser rendering',facilityRecords:servedFacilityRecords.length,products:catalog.products.length,samples:samples.length,meanMs:Math.round(times.reduce((a,b)=>a+b,0)/times.length*100)/100,p95Ms:times[Math.ceil(times.length*.95)-1],maxMs:times.at(-1),geminiCalls:0,runs:samples},null,2));
