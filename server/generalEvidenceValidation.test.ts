import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {extractGeneralOrderDeterministically} from './generalOrderExtraction';
import {classifyGeneralAuditLine} from '../src/utils/generalTextClassification';
import {parseGeneralProducts, applyGeneralOrderLimitDecision, type GeneralAuditSupport} from './generalAuditor';
import {createGeneralAuditRun, completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import {generalProductDecisionEvidence} from '../src/utils/generalProductEvidence';
import {generalFourParameterStatuses} from '../src/utils/generalAuditReviews';
import Inventory from '../src/components/GeneralInventory';
import Details from '../src/components/GeneralAuditDetails';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog} from '../shared/productCatalog';

const catalog: ProductCatalog = {revision: 1400, products: [
  {id:'asv',scope:'general',name:'Snake Venom Antiserum',aliases:['ASV'],contextualAliases:[],category:'medicine',note:''},
  {id:'rdt',scope:'general',name:'Malaria Rapid Diagnostic Test Kit',aliases:['RDT'],contextualAliases:[],category:'diagnostic',note:''},
  {id:'pcm',scope:'general',name:'Paracetamol 500mg Tablet',aliases:['PCM'],contextualAliases:[],category:'medicine',note:''},
  {id:'pcm-syrup',scope:'general',name:'Paracetamol 120mg/5mL Syrup, 100mL',aliases:[],contextualAliases:[],category:'medicine',note:''},
]};
const directory = {records:[{id:'kp',name:'Kpasenkpe Polyclinic',verifiedAliases:['Kpasenkpe PC'],source:'test/directory'}]};
const header = 'Orderer: Aguriba Denis\nFacility: Kpasenkpe Polyclinic\n';
const exact = "Patient's contact: 0248040159\nNhis-non-insured\nAge: 17years\n\nFacility: kpasenkpe polyclinic\n\nQuantity needed: 2 vial";
const fs = 'Thank you Aguriba Denis from Kpasenkpe PC for ordering with Zipline.\nWe will now prepare the following items for delivery:\nSnake Venom Antiserum [2/2]';
async function audit(customer = header+'ASV 2', fulfillment = fs, options: Partial<GeneralAuditSupport> = {}, getClient: () => any = () => {throw Error('No Gemini expected');}) {
  applyCatalog(catalog);
  return runGeneralProductNameAudit(customer,fulfillment,catalog,{facilityContext:directory,semanticTimeoutMs:0,...options},getClient);
}

test('exact Kpasenkpe request requires product/orderer/quantity review with one real FS card and no discrepancy', async () => {
  const result = await audit(exact);
  assert.equal(result.generalAudit.facility.status,'match');
  assert.equal(result.generalAudit.orderer.whatsappValue,'N/A');
  assert.equal(result.generalAudit.productCount.requested,0);
  assert.equal(result.generalAudit.productCount.found,1);
  assert.equal(result.generalAudit.extraction?.customer.products.length,0);
  assert.equal(result.generalAudit.extraction?.customer.ordererName,null);
  assert.ok(result.generalAudit.semanticReviews?.some(review=>review.field==='quantity' && review.originalText==='Quantity needed: 2 vial'));
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].name,'Snake Venom Antiserum');
  assert.equal(result.items[0].provenance.some(row=>row.source==='customer_request'),false);
  assert.equal(result.issueCount,0);
  assert.deepEqual(result.generalAudit.discrepancies,[]);
  assert.equal(result.generalAudit.finalStatus,'REVIEW REQUIRED');
  assert.equal(result.allMatch,false);
  assert.ok(result.confidence<100);
  assert.deepEqual(generalFourParameterStatuses(result.generalAudit),{facility:'match',orderer:'review required',products:'review required',quantities:'review required'});
  const completed = completeGeneralAuditRun(createGeneralAuditRun({whatsappMessage:exact,fulfillmentConfirmation:fs},1,{}, {},true),JSON.parse(JSON.stringify({...result,whatsappMessage:exact,fulfillmentConfirmation:fs})));
  assert.equal(completed.generalAudit.finalStatus,'REVIEW REQUIRED');
  for (const html of [renderToStaticMarkup(createElement(Inventory,{items:completed.items,details:completed.generalAudit,onOrderLimit(){}})),buildGeneralReport(completed)]) {
    assert.doesNotMatch(html,/Patient.s contact|0248040159|Nhis-non-insured|Quantity needed<\/h4>|Missing Product|Extra Product/);
    assert.match(html,/Snake Venom Antiserum/);
    assert.match(html,/Customer(?: Request)?: Not provided/);
  }
});

for (const [line,kind] of [
  ["Patient's contact: 0248040159",'optional_metadata'],['NHIS-non-insured','optional_metadata'],['Age: 17years','optional_metadata'],
  ['Quantity needed: 2 vial','product_quantity'],['2 vials','product_quantity'],['Facility: Kpasenkpe PC','facility_identity'],
  ['Orderer: Aguriba Denis','orderer_identity'],['ASV - 2','product_request'],['Please increase ASV to 4 vials','product_amendment'],
] as const) test(`pre-audit classification: ${line}`,()=>{
  assert.equal(classifyGeneralAuditLine(line),kind);
  if (['optional_metadata','product_quantity'].includes(kind)) assert.deepEqual(parseGeneralProducts(line,'customer_request'),[]);
});

test('metadata never changes counts, verdict or confidence, and embedded requests survive', async()=>{
  const baseline=await audit();
  for (const metadata of ["Patient's contact: 0248040159",'NHIS-non-insured','Age: 17years','District: North','Dropsite: Gate','Date: 30/10/2026']) {
    const result=await audit(header+'ASV 2\n'+metadata);
    assert.equal(result.allMatch,true,metadata);
    assert.equal(result.items.length,1);
    assert.equal(result.confidence,baseline.confidence);
  }
  for (const mixed of ["Patient's contact: 0248040159; ASV 2",'NHIS-non-insured, please send ASV 2']) {
    const result=await audit(header+mixed);
    assert.equal(result.allMatch,true,mixed);
  }
});

test('a standalone quantity is associated only with evidence from the same customer message', async()=>{
  for (const text of ['ASV\nQuantity needed: 2 vials','Quantity needed: 2 vials\nASV','ASV\nPatient age: 17\nQuantity needed: 2 vials']) {
    const result=await audit(header+text);
    assert.equal(result.allMatch,true,text);
    assert.equal(result.items[0].fulfillment.requested,2);
    assert.equal(result.items[0].provenance.find(row=>row.source==='customer_request')?.sourceOriginalText,'ASV');
  }
  const result=await audit(header+'ASV\nQty: 2 vials\nQty: 4 vials');
  assert.equal(result.allMatch,false);
  assert.ok(result.generalAudit.semanticReviews?.some(review=>review.field==='quantity'));
  applyCatalog(catalog);
  const competing=extractGeneralOrderDeterministically(header+'ASV\nPCM 3\nFacility: Kpasenkpe PC\nQty: 2 vials','customer_request',directory);
  assert.ok(competing.quantityReviews?.length,'Do not borrow a remote quantity when another quantified product is present');
});

test('approved ASV alias pairs once without Gemini and retains catalogue decision evidence',async()=>{
  let calls=0;
  const result=await audit(undefined,undefined,{semanticTimeoutMs:1000},()=>{calls++;throw Error('Unexpected AI');});
  assert.equal(calls,0);
  assert.equal(result.geminiMetrics.calls,0);
  assert.equal(result.allMatch,true);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].catalogProductId,'asv');
  const evidence=generalProductDecisionEvidence(result.items);
  assert.equal(evidence.find(row=>row.label==='Canonical product ID')?.value,'asv');
  assert.match(evidence.find(row=>row.label==='Matching method')!.value,/Alias/);
  assert.match(evidence.find(row=>row.label==='Original customer product text')!.value,/ASV 2/);
  assert.match(evidence.find(row=>row.label==='Original FS product text')!.value,/Snake Venom Antiserum \[2\/2\]/);
  assert.match(buildGeneralReport(result),/Product decision evidence/);
});

test('genuine unknown requests remain visible review candidates instead of being dropped',async()=>{
  const result=await audit(header+'Mysterious remedy 2',header+'Mysterious remedy [2/2]');
  assert.equal(result.allMatch,false);
  assert.equal(result.generalAudit.finalStatus,'REVIEW REQUIRED');
  assert.equal(result.items.length,1);
  assert.match(result.items[0].provenance.map(row=>row.originalText).join('\n'),/Mysterious remedy/);
});

for(const [name,customer,fulfillment] of [
  ['missing',header+'ASV 2\nRDT 3',fs],['extra',header+'ASV 2',fs+'\nRDT [3/3]'],
  ['quantity',header+'ASV 2',fs.replace('[2/2]','[3/3]')],
  ['strength',header+'Paracetamol 500mg Tablet 2',header+'Paracetamol 250mg Tablet [2/2]'],
  ['formulation',header+'Paracetamol 500mg Tablet 2',header+'Paracetamol 120mg/5mL Syrup, 100mL [2/2]'],
] as const) test(`genuine ${name} discrepancy remains detectable`,async()=>{
  const result=await audit(customer,fulfillment);
  assert.equal(result.allMatch,false);
  assert.ok(result.issueCount>0,JSON.stringify(result.generalAudit));
  assert.equal(result.generalAudit.finalStatus,'DISCREPANCY DETECTED');
});

test('missing required evidence does not hide a simultaneous confirmed discrepancy',async()=>{
  const result=await audit('Facility: Kpasenkpe PC\nASV 2',fs.replace('[2/2]','[3/3]'));
  assert.equal(result.generalAudit.finalStatus,'DISCREPANCY DETECTED');
  assert.ok(result.generalAudit.auditSummary.reviewRequiredCount!>0);
  assert.ok(result.issueCount>0);
  assert.match(renderToStaticMarkup(createElement(Details,{details:result.generalAudit})),/REVIEW REQUIRED/);
});

for(const [name,ratio,suffix] of [['full stockout','[0/2]',''],['zero/N stockout','[0/1]',''],['partial stockout','[1/2]',' — partially out of stock']] as const)
  test(`${name} retains its operational exception`,async()=>{
    const result=await audit(header+'ASV 2',fs.replace('[2/2]',ratio+suffix));
    assert.equal(result.allMatch,true);
    assert.equal(result.issueCount,0);
    assert.equal(result.generalAudit.counts.outOfStock,1);
  });

test('approved limits remain valid without changing product evidence',async()=>{
  const pending=await audit(header+'ASV 4',fs);
  const approved=applyGeneralOrderLimitDecision(pending,'asv',true);
  assert.equal(approved.allMatch,true);
  assert.equal(approved.issueCount,0);
  assert.match(generalProductDecisionEvidence(approved.items).find(row=>row.label==='Operational exception')!.value,/Approved order limit/);
});

for(const failure of ['unavailable','quota exceeded']) test(`Gemini ${failure} cannot invent required customer evidence`,async()=>{
  let calls=0;
  const result=await audit(header+'Please send enigmatic venom compound 2',fs,{semanticTimeoutMs:1000,semanticCacheScope:`evidence-${failure}`},()=>({models:{generateContent:async()=>{calls++;throw Object.assign(Error(failure),{status:429});}}}));
  assert.ok(calls>0);
  assert.equal(result.allMatch,false);
  assert.equal(result.generalAudit.finalStatus,'REVIEW REQUIRED');
  assert.equal(result.aliasLearning.saved,0);
});

test('client final validation rejects metadata and duplicate product evidence without accepting a false verdict',async()=>{
  const result=await audit();
  const inputs={whatsappMessage:header+'ASV 2',fulfillmentConfirmation:fs};
  const run=createGeneralAuditRun(inputs,1,{}, {},true);
  const record={...result,...inputs};
  const invalid=structuredClone(record);
  invalid.items[0].provenance[0].originalText='Quantity needed: 2 vial';
  assert.throws(()=>completeGeneralAuditRun(run,invalid),/non-product line/);
  const duplicate=structuredClone(record);duplicate.items.push(structuredClone(duplicate.items[0]));
  assert.throws(()=>completeGeneralAuditRun(run,duplicate),/assigned more than once/);
  assert.equal(completeGeneralAuditRun(run,record).allMatch,true);
});
