import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import {applyGeneralOrderLimitDecision,generalFourParameterRecord,summarizeGeneralProducts} from './generalAuditor';
import {retryAuditStorage} from '../shared/auditStorageClient';
import {generalProductDecisionEvidence} from '../src/utils/generalProductEvidence';
import {buildIssues} from '../extension/explain.js';
import type {ProductCatalog} from '../shared/productCatalog';

const catalog:ProductCatalog={revision:2100,products:[{id:'rdt',name:'Malaria Rapid Diagnostic Test Kit',scope:'general',aliases:['RDT'],contextualAliases:[],category:'diagnostic',note:''}]};
const header='Orderer: Grace Akabati\nFacility: Example Health Centre\n';
const sources={whatsappMessage:header+'RDT 5',fulfillmentConfirmation:header+'Malaria Rapid Diagnostic Test Kit [3/5]'};
async function audit(a=sources.whatsappMessage,b=sources.fulfillmentConfirmation){
  applyCatalog(catalog);
  return {...await runGeneralProductNameAudit(a,b,catalog,{semanticTimeoutMs:0,facilityContext:{records:[{id:'example',name:'Example Health Centre',source:'test'}]}},()=>{throw Error('No AI');}),whatsappMessage:a,fulfillmentConfirmation:b,id:'AUD-sweep'};
}

test('local order-limit answers retain audit mode, refresh every verdict and preserve manual dispatch',async()=>{
  const pending=await audit();const result=applyGeneralOrderLimitDecision(pending,'rdt',true);
  assert.equal(result.allMatch,true);
  assert.equal(result.generalAudit.productComparisonMode,'names_and_quantities');
  assert.equal(result.canDispatchAutomatically,false);
  assert.equal(result.generalAudit.dispatchReadiness?.canDispatchAutomatically,false);
  assert.equal(result.auditDecision,'match');
  assert.equal((result as any).finalVerdict,'NO DISCREPANCY');
  assert.equal((result as any).generalCounts.orderLimited,1);
  const denied=applyGeneralOrderLimitDecision(result,'rdt',false);
  assert.equal(denied.auditDecision,'discrepancy');assert.equal((denied as any).finalVerdict,'DISCREPANCY DETECTED');
});

test('saved-result projection never upgrades a catalogue audit to automatic dispatch',async()=>{
  const record=await audit(sources.whatsappMessage,sources.fulfillmentConfirmation.replace('[3/5]','[5/5]'));
  assert.equal(record.canDispatchAutomatically,false);
  const result=generalFourParameterRecord(record);
  assert.equal(result.allMatch,true);assert.equal(result.canDispatchAutomatically,false);
  assert.equal(result.generalAudit.dispatchReadiness?.canDispatchAutomatically,false);
});

test('extension discrepancy labels exclude unresolved identity, missing evidence and optional phone fields',async()=>{
  const unresolved=await audit(header+'Mystery remedy 2',header+'Mystery remedy [2/2]');
  assert.equal(unresolved.issueCount,0);
  assert.deepEqual(buildIssues(unresolved),[]);
  const record=await audit();
  record.generalAudit.phone={whatsappValue:'0240000000',fulfillmentValue:'0200000000',status:'mismatch'};
  record.generalAudit.orderer={whatsappValue:'N/A',fulfillmentValue:'Grace',status:'missing from customer request'};
  record.generalAudit.semanticReviews=[{field:'quantity',source:'customer_request',originalText:'Quantity needed: 2 vials',reason:'Confirm product association',possibleMatches:[]}];
  assert.deepEqual(buildIssues(record),[]);
  record.generalAudit.facility.status='mismatch';
  assert.deepEqual(buildIssues(record).map(row=>row.type),['Facility name mismatch']);
});

test('recalculation clears obsolete review badges after a product is verified',async()=>{
  const record=await audit(sources.whatsappMessage,sources.fulfillmentConfirmation.replace('[3/5]','[5/5]'));
  record.items[0].fulfillment.identityReviewRequired=true;
  const result=summarizeGeneralProducts(record.items,record.generalAudit.facility,record.generalAudit.orderer,record.generalAudit.phone,1,1,[],record.generalAudit);
  assert.equal(result.allMatch,true);
  assert.equal(Boolean(result.items[0].fulfillment.identityReviewRequired),false);
});

test('empty product decision evidence cannot claim catalogue and quantity verification',()=>{
  assert.doesNotMatch(generalProductDecisionEvidence([]).find(row=>row.label==='Decision reason')!.value,/verified/i);
});

test('storage retries reject a second response with stale sources or altered limit decisions',async()=>{
  const record=await audit();let calls=0;
  const stale={...record,whatsappMessage:header+'RDT 999',storage:{status:'saved'}};
  await assert.rejects(retryAuditStorage(async()=>{calls++;return stale;},record),/current|retained|inputs/i);
  assert.equal(calls,2);
  const wrong={...record,generalAudit:{...record.generalAudit,orderLimitDecisions:{rdt:true}},storage:{status:'saved'}};
  await assert.rejects(retryAuditStorage(async()=>wrong,record),/current|retained|decisions/i);
});

test('equivalent order-limit maps with different key order do not trigger another audit',async()=>{
  const record=await audit();record.generalAudit.orderLimitDecisions={a:true,b:false};let calls=0;
  const updated=await retryAuditStorage(async()=>{calls++;return {...record,generalAudit:{...record.generalAudit,orderLimitDecisions:{b:false,a:true}},storage:{status:'saved'}};},record);
  assert.equal(calls,1);assert.equal(updated.id,record.id);
});
