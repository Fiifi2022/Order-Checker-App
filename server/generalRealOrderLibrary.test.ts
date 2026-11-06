import test from 'node:test';
import assert from 'node:assert/strict';
import library from './fixtures/general-audit-real-orders.json';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog,defaultProducts} from './productCatalog';
import {buildGeneralReport} from '../extension/general-report.js';

for(const example of library.cases)test(`real order library: ${example.id} (${example.category})`,async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 const noAI=()=>{throw Error('Known source evidence needs no AI');};
 let result=await runGeneralProductNameAudit(example.customer,example.fulfillment,catalog,{semanticTimeoutMs:0},noAI);
 if('approvedOrderLimits' in example){
  const names=example.approvedOrderLimits as string[];
  const decisions=Object.fromEntries(names.map(name=>{
   const item=result.items.find(item=>item.name===name);
   assert.ok(item?.fulfillment.orderLimitEligible,`Expected an order-limit prompt for ${name}`);
   return [item.fulfillment.key,true];
  }));
  result=await runGeneralProductNameAudit(example.customer,example.fulfillment,catalog,{semanticTimeoutMs:0,generalOrderLimitDecisions:decisions},noAI);
 }
 assert.equal(result.allMatch,example.expectedMatch,JSON.stringify({items:result.items.map(item=>({name:item.name,status:item.status})),details:result.generalAudit.discrepancies}));
 const numeric=(values:number[])=>[...values].sort((a,b)=>a-b);
 assert.deepEqual(numeric(result.items.map(item=>item.fulfillment.requested)),numeric(example.requestedQuantities));
 assert.deepEqual(numeric(result.items.map(item=>item.fulfillment.supplied)),numeric(example.suppliedQuantities));
 assert.doesNotMatch(buildGeneralReport(result),/Missing Product|Extra Product/);
 if(example.expectedMatch){assert.equal(result.issueCount,0);assert.match(buildGeneralReport(result),/ORDER CONFIRMED/);}
 if(example.expectedOrderer)assert.equal(result.generalAudit.orderer.status,example.expectedOrderer);
 if(example.expectedFacility)assert.equal(result.generalAudit.facility.status,example.expectedFacility);
});
