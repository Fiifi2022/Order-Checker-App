import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog,defaultProducts} from './productCatalog';
import {applySourceProductConfirmation} from './generalSourceProductConfirmation';
import {applyIdentityDecision} from './generalIdentityDecision';
import {applyGeneralOrderLimitDecision,generalFourParameterRecord} from './generalAuditor';
import {createGeneralAuditRun,completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import {directProductMatch} from '../shared/generalDirectProduct';
import {generalResolutionQueue} from '../shared/generalResolutionQueue';
import Inventory from '../src/components/GeneralInventory';
import {buildGeneralReport} from '../extension/general-report.js';
import {researchProducts} from './productResearch';
import type {ProductCatalog} from '../shared/productCatalog';
const h='Name: John Mensah\nFacility: Example HC\n';
const empty=():ProductCatalog=>({revision:1,products:[]});
const catalogue=():ProductCatalog=>({revision:1,products:defaultProducts()});
async function audit(a:string,b:string,c=catalogue(),support:any={}){
 applyCatalog(c);let calls=0,writes=0;
 const whatsappMessage=h+a,fulfillmentConfirmation=h+b;
 const result=await runGeneralProductNameAudit(whatsappMessage,fulfillmentConfirmation,c,{semanticTimeoutMs:0,...support,learnCatalogueProducts:async()=>{writes++;throw Error('Registration is never required');}},()=>{calls++;throw Error('No AI expected');});
 return {record:{...result,id:'master-rules',createdByUserId:'cca',whatsappMessage,fulfillmentConfirmation},calls,writes};
}
test('exact four-field match passes and district/drop location do not affect the result',async()=>{
 const {record}=await audit('District: East\nDrop area: Behind lab\nPCM - 20','District: West\nDrop area: Airport\nParacetamol 500mg Tablet [20/20]');assert.equal(record.allMatch,true);
});
test('different product list ordering does not create discrepancies',async()=>{
 const {record}=await audit('PCM - 20\nORS - 10','ORS [10/10]\nParacetamol 500mg Tablet [20/20]');assert.equal(record.allMatch,true);
});
test('identical uncatalogued names and quantities pass without Gemini or registration',async()=>{
 const {record,calls,writes}=await audit('New Medicine XYZ 500mg - 20','New Medicine XYZ 500mg [20/20]',empty(),{semanticTimeoutMs:1000});
 assert.equal(record.allMatch,true);assert.equal(calls,0);assert.equal(writes,0);assert.equal(record.items[0].catalogProductId,undefined);assert.deepEqual(record.generalAudit.catalogueSuggestions,[]);
});
test('different uncatalogued names receive a source suggestion requiring CCA confirmation',async()=>{
 const {record}=await audit('New Medicine XYZ 500mg - 20','XYZ Tablets 500mg [20/20]',empty());
 assert.equal(record.allMatch,false);assert.equal(record.generalAudit.decision,'review');assert.equal(record.generalAudit.catalogueSuggestions?.[0].options[0].kind,'source');
});
test('uncatalogued direct matches still report unexplained quantity differences',async()=>{
 const {record}=await audit('New Medicine XYZ 500mg - 20','New Medicine XYZ 500mg [10/10]',empty());assert.equal(record.generalAudit.decision,'discrepancy');assert.equal(record.items[0].fulfillment.requested,20);assert.equal(record.items[0].fulfillment.supplied,10);
});
test('known catalogue products continue to match',async()=>{assert.equal((await audit('Paracetamol 500mg Tablet - 20','Paracetamol 500mg Tablet [20/20]')).record.allMatch,true);});
test('a requested catalogue product absent from FS is missing',async()=>{const {record}=await audit('PCM - 20\nORS - 10','PCM [20/20]');assert.equal(record.allMatch,false);assert.ok(record.items.some(i=>i.status==='missing item'));});
test('an unexplained extra FS product blocks clearance',async()=>{const {record}=await audit('PCM - 20','PCM [20/20]\nORS [10/10]');assert.equal(record.allMatch,false);assert.ok(record.items.some(i=>i.status==='extra item'));});
for(const [label,a,b] of [['strength','New Medicine XYZ 500mg','New Medicine XYZ 250mg'],['size','New Solution XYZ 100mL','New Solution XYZ 200mL'],['formulation','New Medicine XYZ 500mg Tablet','New Medicine XYZ 500mg Injection'],['route','New Medicine XYZ oral','New Medicine XYZ intravenous']] as const)test(`different unknown ${label} cannot pass or be confirmed as equivalent`,async()=>{
 const {record}=await audit(a+' - 20',b+' [20/20]',empty());assert.equal(record.allMatch,false);assert.equal(directProductMatch(a,b),false);assert.throws(()=>applySourceProductConfirmation(record,a,b,empty(),{id:'cca',name:'CCA'}));
});
test('verified facility abbreviations remain automatic',async()=>{const {record}=await audit('PCM - 1','PCM [1/1]');assert.equal(record.generalAudit.facility.status,'match');});
test('similar facility names require confirmation while other matches remain complete',async()=>{
 let {record}=await audit('PCM - 1','PCM [1/1]');record={...record,...await runGeneralProductNameAudit(h.replace('Example HC','Akanteng Health Centre')+'PCM - 1',h.replace('Example HC','Akantang Health Centre')+'PCM [1/1]',catalogue(),{semanticTimeoutMs:0},()=>{})};
 assert.equal(record.allMatch,false);assert.equal(record.generalAudit.orderer.status,'match');assert.equal(record.items[0].status,'match');
});
test('genuinely different facilities block clearance',async()=>{
 const result=await runGeneralProductNameAudit(h+'PCM - 1',h.replace('Example HC','Different Hospital')+'PCM [1/1]',catalogue(),{semanticTimeoutMs:0},()=>{});assert.equal(result.generalAudit.facility.status,'mismatch');assert.equal(result.allMatch,false);
});
test('partial customer names require CCA confirmation',async()=>{
 const result=await runGeneralProductNameAudit(h.replace('John Mensah','Emmanuel')+'PCM - 1',h.replace('John Mensah','Emmanuel Adomako')+'PCM [1/1]',catalogue(),{semanticTimeoutMs:0},()=>{});assert.equal(result.generalAudit.orderer.status,'review required');assert.equal(result.allMatch,false);
});
test('reordered full customer names remain verified',async()=>{
 const result=await runGeneralProductNameAudit(h+'PCM - 1',h.replace('John Mensah','Mensah John')+'PCM [1/1]',catalogue(),{semanticTimeoutMs:0},()=>{});assert.equal(result.allMatch,true);
});
test('similar spellings remain uncertain rather than automatically approved',async()=>{
 const result=await runGeneralProductNameAudit(h.replace('John Mensah','Jemimah Huseini')+'PCM - 1',h.replace('John Mensah','Hussein Jemimah')+'PCM [1/1]',catalogue(),{semanticTimeoutMs:0},()=>{});assert.equal(result.generalAudit.orderer.status,'review required');assert.equal(result.allMatch,false);
});
test('approved product aliases require no AI',async()=>{const {record,calls}=await audit('PCM - 5','Paracetamol 500mg Tablet [5/5]',catalogue(),{semanticTimeoutMs:1000});assert.equal(record.allMatch,true);assert.equal(calls,0);});
test('20/20 is an actual quantity, independent of catalogue membership',async()=>{const {record}=await audit('New Medicine XYZ 500mg 20/20','New Medicine XYZ 500mg [20/20]',empty());assert.equal(record.allMatch,true);assert.equal(record.items[0].fulfillment.requested,20);});
for(const prefix of ['1.','1)','(1)','1-'])test(`list marker ${prefix} is not a quantity`,async()=>{const {record}=await audit(`${prefix} New Medicine XYZ 500mg - 20`,'New Medicine XYZ 500mg [20/20]',empty());assert.equal(record.allMatch,true);assert.equal(record.items[0].fulfillment.requested,20);});
test('stockout exceptions also apply to source-matched uncatalogued products',async()=>{const {record}=await audit('New Medicine XYZ 500mg - 20','New Medicine XYZ 500mg [0/1]',empty());assert.equal(record.allMatch,true);assert.equal(record.generalAudit.stockStatus,'out of stock');});
test('approved order limits apply without making catalogue membership mandatory',async()=>{
 const {record}=await audit('New Medicine XYZ 500mg - 20','New Medicine XYZ 500mg [10/10]',empty());const result=applyGeneralOrderLimitDecision(record,record.items[0].fulfillment.key,true);assert.equal(result.allMatch,true);
});
test('multiple uncertain fields appear in one review section in both clients',async()=>{
 const c=empty(),a=h.replace('John Mensah','Emmanuel').replace('Example HC','Akanteng HC')+'New Medicine XYZ 500mg - 20',b=h.replace('John Mensah','Emmanuel Adomako').replace('Example HC','Akantang HC')+'XYZ Tablets 500mg [20/20]';
 const result=await runGeneralProductNameAudit(a,b,c,{semanticTimeoutMs:0},()=>{});
 const markup=renderToStaticMarkup(createElement(Inventory,{items:result.items,details:result.generalAudit,onOrderLimit(){},onIdentityDecision:async()=>{}}));
 for(const html of [markup,buildGeneralReport(result)]){assert.equal((html.match(/aria-label="Review Suggestions"/g)||[]).length,1);assert.match(html,/Name of Orderer/);assert.match(html,/Facility Name/);assert.match(html,/XYZ Tablets/);}
});
test('source confirmation resumes the same audit without a catalogue entry',async()=>{
 const {record}=await audit('New Medicine XYZ 500mg - 20','XYZ Tablets 500mg [20/20]',empty());const result=applySourceProductConfirmation({...record,isValid:false,auditStatus:'requires_review',discrepancies:['Stale identity warning']},'New Medicine XYZ 500mg','XYZ Tablets 500mg',empty(),{id:'cca',name:'CCA'});
 assert.equal(result.id,record.id);assert.equal(result.allMatch,true);assert.equal(result.whatsappMessage,record.whatsappMessage);assert.equal(result.fulfillmentConfirmation,record.fulfillmentConfirmation);assert.equal(result.generalAudit.sourceProductConfirmations[0].confirmedBy.id,'cca');assert.equal(result.items[0].catalogProductId,undefined);
 assert.equal(result.isValid,true);assert.equal(result.auditStatus,'passed');assert.deepEqual(result.discrepancies,[]);assert.ok(result.productMatchingDiagnostics.every((p:any)=>p.status==='match'));
});
test('source equivalence cannot waive quantity or facility discrepancies',async()=>{
 const {record}=await audit('New Medicine XYZ 500mg - 20','XYZ Tablets 500mg [10/10]',empty());const result=applySourceProductConfirmation(record,'New Medicine XYZ 500mg','XYZ Tablets 500mg',empty(),{id:'cca',name:'CCA'});assert.equal(result.allMatch,false);assert.equal(result.generalAudit.decision,'discrepancy');assert.equal(result.items[0].fulfillment.requested,20);assert.equal(result.items[0].fulfillment.supplied,10);
 const rejected=applyIdentityDecision({...result,generalAudit:{...result.generalAudit,facility:{...result.generalAudit.facility,status:'review required'}}},'facility','reject',{id:'cca',name:'CCA'});assert.equal(rejected.allMatch,false);assert.equal(rejected.generalAudit.facility.status,'mismatch');
});
test('rejected source suggestions cannot be confirmed and do not become aliases',async()=>{
 const {record}=await audit('New Medicine XYZ 500mg - 20','XYZ Tablets 500mg [20/20]',empty());const group=record.generalAudit.catalogueSuggestions![0];group.rejectedProductIds=group.options.map(o=>o.productId);assert.throws(()=>applySourceProductConfirmation(record,group.alias,'XYZ Tablets 500mg',empty(),{id:'cca',name:'CCA'}));assert.equal(record.allMatch,false);
});
test('duplicate direct lines are aggregated numerically and never silently dropped',async()=>{
 const {record}=await audit('New Medicine XYZ 500mg - 10\nNew Medicine XYZ 500mg - 10','New Medicine XYZ 500mg [20/20]',empty());assert.equal(record.allMatch,true);assert.equal(record.items.length,1);assert.equal(record.items[0].fulfillment.requested,20);
});
test('final shared summary cannot clear missing quantities or unresolved identities',async()=>{
 for(const [a,b] of [['New Medicine XYZ 500mg','New Medicine XYZ 500mg [20/20]'],['New Medicine XYZ 500mg - 20','XYZ Tablets 500mg [20/20]']]){const {record}=await audit(a,b,empty());const rebuilt=generalFourParameterRecord({...record,allMatch:true});assert.equal(rebuilt.allMatch,false);}
});
test('main app and extension consume the same valid direct-source result',async()=>{
 const {record}=await audit('New Medicine XYZ 500mg - 20','New Medicine XYZ 500mg [20/20]',empty());const main=completeGeneralAuditRun(createGeneralAuditRun(record,1,{}, {},true),record),extension=generalFourParameterRecord(record);assert.equal(main.allMatch,true);assert.equal(extension.allMatch,true);assert.deepEqual(main.items,extension.items);assert.equal(generalResolutionQueue(extension).pending,0);
});
test('Gemini 429 retains safe direct checks and does not turn a suggestion into approval',async()=>{
 let calls=0;const client={models:{async generateContent(){calls++;throw Object.assign(Error('quota'),{status:429});}}};const results=await researchProducts(['Unknown ABC'],empty(),()=>client,{scope:'master-rate',counterpartNames:['ABC Tablets']});assert.equal(calls,1);assert.equal(results[0].researchStatus,'rate_limited');assert.ok(results[0].nextSteps?.length);assert.equal(results[0].options[0].kind,'source');
});
