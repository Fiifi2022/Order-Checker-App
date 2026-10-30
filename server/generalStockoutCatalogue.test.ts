import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import Inventory from '../src/components/GeneralInventory';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog} from '../shared/productCatalog';
const catalog:ProductCatalog={revision:1,products:[
 {id:'diagnostic',scope:'general',name:'Malaria Rapid Diagnostic Test Kit',aliases:['RDT','Malaria RDT','Malaria Rapid Diagnostic Test'],contextualAliases:[],category:'diagnostic',note:''},
 {id:'pcm',scope:'general',name:'Paracetamol 500mg Tablet',aliases:['PCM'],contextualAliases:[],category:'medicine',note:''},
]};
async function audit(request='RDT 1',supply='Malaria Rapid Diagnostic Test Kit [0/1] - currently out of stock',support={}){
 applyCatalog(catalog);let calls=0;
 const result=await runGeneralProductNameAudit('Orderer: Grace\nFacility: Abasua Health Centre\n'+request,
 'Orderer: Grace Akabati\nFacility: Abasua HC\n'+supply,catalog,{semanticTimeoutMs:0,...support},()=>{calls++;throw Error('Catalogue match must not use AI');});
 assert.equal(calls,0);return result;
}
test('catalogue alias stockout is matched, not missing, and does not lower confidence',async()=>{
 for(const supply of ['Malaria Rapid Diagnostic Test Kit [0/1] - currently out of stock','Malaria Rapid Diagnostic Test Kit [0/1]\nStatus: Out of stock','Currently out of stock:\n- Malaria RDT','Malaria RDT - out of stock']){
  const r=await audit('RDT 1',supply);assert.equal(r.allMatch,true,supply);assert.equal(r.issueCount,0);assert.equal(r.confidence,100);
  assert.equal(r.generalAudit.productCount.requested,1);assert.equal(r.generalAudit.productCount.found,1);assert.equal(r.generalAudit.productTotals?.matched,1);assert.equal(r.generalAudit.productTotals?.physicallyFulfilled,0);
  assert.equal(r.generalAudit.counts.fullySupplied,0);assert.equal(r.items[0].fulfillment.supplied,0);
  assert.equal(r.items[0].fulfillment.outOfStockQuantity,1);assert.equal(r.items[0].fulfillment.orderLimitEligible,false);
  assert.deepEqual(r.generalAudit.discrepancies,[]);
 }
});
test('available and alternative approved aliases remain clear',async()=>{
 for(const name of ['Malaria Rapid Diagnostic Test Kit','Malaria RDT','Malaria Rapid Diagnostic Test']){
  const r=await audit('RDT 1',name+' [1/1]');assert.equal(r.allMatch,true);assert.equal(r.generalAudit.counts.fullySupplied,1);
 }
});
test('explicit partial stockout accounts for the shortfall without an order-limit prompt',async()=>{
 for(const supply of ['Malaria Rapid Diagnostic Test Kit [3/5] - partially out of stock','Malaria Rapid Diagnostic Test Kit - 3 - partially out of stock','Malaria Rapid Diagnostic Test Kit [3/5]\nStatus: Partially out of stock']){
  const r=await audit('RDT 5',supply);assert.equal(r.allMatch,true);assert.equal(r.issueCount,0);assert.equal(r.confidence,100);
  assert.equal(r.generalAudit.stockStatus,'partially out of stock');assert.equal(r.items[0].fulfillment.supplied,3);
  assert.equal(r.items[0].fulfillment.outOfStockQuantity,2);assert.equal(r.generalAudit.counts.fullySupplied,0);
  assert.equal(r.items[0].fulfillment.orderLimitEligible,false);
 }
});
test('missing products, unrelated stock notes, extra products and conflicting stockout quantities still fail',async()=>{
 for(const [request,supply] of [
 ['RDT 1','No fulfilled products'],['RDT 5','Malaria Rapid Diagnostic Test Kit [0]'],['RDT 1','Paracetamol 500mg Tablet [1/1]'],
 ['RDT 5','Malaria Rapid Diagnostic Test Kit [6/5] - partially out of stock'],
 ['RDT 1','Malaria Rapid Diagnostic Test Kit [1/1]\nParacetamol 500mg Tablet [1/1]'],
 ]){const r=await audit(request,supply);assert.equal(r.allMatch,false,supply);assert.ok(r.issueCount>0,supply);}
 const partial=await audit('RDT 5','Malaria Rapid Diagnostic Test Kit [3/5]');
 assert.equal(partial.allMatch,false);assert.equal(partial.items[0].status,'pending order limit');
 const declined=await audit('RDT 5','Malaria Rapid Diagnostic Test Kit [3/5]',{generalOrderLimitDecisions:{diagnostic:false}});
 assert.ok(declined.issueCount>0);
 const approved=await audit('RDT 5','Malaria Rapid Diagnostic Test Kit [3/5]',{generalOrderLimitDecisions:{diagnostic:true}});
 assert.equal(approved.allMatch,true);
});
test('main app and extension display amber stockout quantities without the total-products panel',async()=>{
 const r=await audit('RDT 5','Malaria Rapid Diagnostic Test Kit [3/5] - partially out of stock');
 const web=renderToStaticMarkup(createElement(Inventory,{items:r.items,details:r.generalAudit,onConfirm:async()=>{},onOrderLimit:()=>{}}));
 const ext=buildGeneralReport(r);
 for(const html of [web,ext]){assert.match(html,/PARTIALLY OUT OF STOCK/i);assert.match(html,/Out of stock: (?:<!-- -->)?2/i);assert.doesNotMatch(html,/Was this quantity reduced/);}
 for(const html of [web,ext])assert.doesNotMatch(html,/Total product comparison|Total products/);
});
test('ambiguous short names and conflicting facility identities are not cleared by a stockout',async()=>{
 applyCatalog(catalog);
 for(const header of ['Orderer: Grace\nOrderer: Grace Mensah\nFacility: Abasua Health Centre\n','Orderer: Grace\nFacility: Another HC\n']){
  const r=await runGeneralProductNameAudit(header+'RDT 1','Orderer: Grace Akabati\nFacility: Abasua HC\nMalaria Rapid Diagnostic Test Kit [0/1]',catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI');});
  assert.equal(r.allMatch,false,header);
 }
});
test('fresh catalogue seeding keeps an approved whole-name alias from becoming a second product identity',async()=>{
 const {defaultProducts}=await import('./productCatalog');
 const {generalMedicalTerminology}=await import('../src/utils/generalMedicalTerminology');
 // Restore the repository seed vocabulary, independent of prior runtime fixtures.
 const {readFileSync}=await import('node:fs');
 const {setGeneralMedicalTerminology}=await import('../src/utils/generalMedicalTerminology');
 const previous=[...generalMedicalTerminology];
 try{
  setGeneralMedicalTerminology(JSON.parse(readFileSync(new URL('../src/utils/generalMedicalTerminologyData.json',import.meta.url),'utf8')));
  const products=defaultProducts();
  const kits=products.filter(p=>p.scope==='general' && p.name==='Malaria Rapid Diagnostic Test Kit');
  assert.equal(kits.length,1);assert.ok(kits[0].aliases.includes('RDT'));assert.ok(kits[0].aliases.includes('Malaria Rapid Diagnostic Test'));
  assert.ok(!products.some(p=>p.scope==='general' && p.name==='Malaria Rapid Diagnostic Test'));
 }finally{setGeneralMedicalTerminology(previous);}
});
test('any positive zero-ratio denominator means stockout without a quantity review, preserving the customer quantity',async()=>{
 for(const denominator of [1,2,5,20,100,0.5]){
  for(const annotation of ['', ' - out of stock']){
   const r=await audit('RDT 5',`Malaria Rapid Diagnostic Test Kit [0/${denominator}]${annotation}`);
   assert.equal(r.allMatch,true);assert.equal(r.issueCount,0);assert.equal(r.confidence,100);
   const p=r.items[0].fulfillment;
   assert.equal(p.stockStatus,'out of stock');assert.equal(p.fulfillmentStatus,'out of stock');assert.equal(p.requested,5);assert.equal(p.confirmationRequested,denominator);assert.equal(p.supplied,0);
   assert.equal(p.quantityReviewRequired,undefined);assert.equal(p.quantityError,undefined);
   assert.equal(r.generalAudit.counts.outOfStock,1);assert.equal(r.generalAudit.productTotals?.quantityReview,0);
   assert.match(r.generalAudit.finalStatus,/NO DISCREPANCY.*OUT OF STOCK/);
  }
 }
 for(const quantity of ['0/0','0/-1']){const invalid=await audit('RDT 5',`Malaria Rapid Diagnostic Test Kit [${quantity}]`);assert.equal(invalid.allMatch,false);}
});
test('the two syrup stockouts preserve matched types, zero physical supply without denominator-based quantity reviews',async()=>{
 const products=['Multivitamin Syrup','Paracetamol 120mg/5mL Syrup, 100mL'].map((name,i)=>({...catalog.products[0],id:`syrup-${i}`,name,aliases:[]}));
 const c={revision:2,products};applyCatalog(c);
 const header='Orderer: Grace Akabati\nFacility: Abasua HC\n';
 const r=await runGeneralProductNameAudit(header+products.map(p=>p.name+' - 5').join('\n'),header+'Out of stock:\n'+products.map(p=>'- '+p.name+' [0/1]').join('\n'),c,{semanticTimeoutMs:0},()=>{throw Error('No AI');});
 assert.equal(r.issueCount,0);assert.equal(r.allMatch,true);assert.equal(r.generalAudit.counts.outOfStock,2);
 assert.deepEqual(r.generalAudit.productTotals,{requested:2,matched:2,physicallyFulfilled:0,outOfStock:2,physicallySuppliedUnits:0,missing:0,quantityReview:0,discrepancies:0});
 for(const item of r.items){assert.equal(item.status,'out of stock');assert.equal(item.fulfillment.stockStatus,'out of stock');assert.equal(item.fulfillment.confirmationRequested,1);}
});
test('history counts zero-ratio stockouts independently of genuine discrepancy rates',async()=>{
 const {generalAuditAnalytics}=await import('./generalAuditMonitoring');
 const r=await audit('RDT 5','Malaria Rapid Diagnostic Test Kit [0/1] - out of stock');
 const metrics=generalAuditAnalytics([{...r,id:'stock-review',auditScope:'general_auditor'}]);
 assert.equal(metrics.discrepancyRate,0);assert.equal(metrics.quantityReviewAudits,0);assert.equal(metrics.fullOutOfStockRate,100);assert.equal(metrics.frequentlyOutOfStockProducts.length,1);
});
