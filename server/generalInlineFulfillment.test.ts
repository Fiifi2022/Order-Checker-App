import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog,defaultProducts} from './productCatalog';
import {parseGeneralProducts} from './generalAuditor';
import {buildGeneralReport} from '../extension/general-report.js';
import {servedFacilityRecords} from './generalFacilityRecords';
const customer=`Date: 02/11/2026
Name of orderer: owusu Constance
Facility: pepease health center
Delivery point: compound
District: Kwahu East
Product: injection hydrocortisone 100mg
Quantity: 10 pieces`;
const confirmation=`Thank you Constance Owusu from Pepease HC for ordering with Zipline. We have received your order (ID: P214E9HWWD)]. Use this link to track your order: https://orders.zipline.com/t/5/P214E9HWWD We will now prepare the following items for delivery: - Hydrocortisone 100mg Injection [10/10] Expected delivery: between November 02, 2026 04:05 PM and November 02, 2026 06:05 PM. Let us know if any changes are required or contact +0800-719-102 if any questions`;
let calls=0;
const noAI=()=>{calls++;throw Error('This complete source should not need AI');};
test('exact Pepease order matches an inline FS product and its independently labelled customer quantity',async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 calls=0;
 const result=await runGeneralProductNameAudit(customer,confirmation,catalog,{semanticTimeoutMs:1000,facilityContext:{records:[...servedFacilityRecords]}},noAI);

 assert.equal(calls,0);
 assert.equal(result.allMatch,true);assert.equal(result.issueCount,0);assert.equal(result.items.length,1);
 assert.equal(result.items[0].fulfillment.requested,10);assert.equal(result.items[0].fulfillment.supplied,10);
 assert.doesNotMatch(buildGeneralReport(result),/Missing Product|Extra Product/);
});


test('inline fulfilment supports multiple products and preserves separate quantities and original evidence',async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 const result=await runGeneralProductNameAudit(customer+'\nORS - 2',confirmation.replace('[10/10] Expected','[10/10] - Oral Rehydration Salts [2/2] Expected'),catalog,{semanticTimeoutMs:0},noAI);
 assert.equal(result.allMatch,true);assert.equal(result.items.length,2);
 assert.deepEqual(result.items.map(item=>item.fulfillment.requested).sort((a,b)=>a-b),[2,10]);
 const evidence=result.items.flatMap(item=>item.provenance).filter(p=>p.source==='fulfillment_confirmation');
 assert.ok(evidence.every(p=>p.sourceOriginalText?.includes(p.name)));
 assert.equal(evidence.some(p=>p.quantity===2026),false);
});

test('inline stockout sections account for products with zero supply without a missing-product error',async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 const fs=confirmation.replace('We will now prepare the following items for delivery:','We are currently out of stock for the following items:').replace('[10/10]','[0/1]');
 const result=await runGeneralProductNameAudit(customer,fs,catalog,{semanticTimeoutMs:0},noAI);
 assert.equal(result.allMatch,true);assert.equal(result.items.length,1);assert.equal(result.items[0].status,'out of stock');
 assert.equal(result.items[0].fulfillment.requested,10);assert.equal(result.items[0].fulfillment.supplied,0);
});

test('inline extraction preserves genuine quantity, strength, missing and extra product findings',async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 for(const [request,fs] of [
  [customer,confirmation.replace('[10/10]','[9/9]')],
  [customer,confirmation.replace('100mg Injection','250mg Injection')],
  [customer+'\nORS - 2',confirmation],
  [customer,confirmation.replace('[10/10] Expected','[10/10] - Oral Rehydration Salts [2/2] Expected')],
 ]) {
  const result=await runGeneralProductNameAudit(request,fs,catalog,{semanticTimeoutMs:0},noAI);
  assert.equal(result.allMatch,false);
 }
});

test('unreadable product-changing tails remain blocked rather than being discarded',async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 await assert.rejects(runGeneralProductNameAudit(customer,confirmation.replace('[10/10] Expected','[10/10] instead send a different strength. Expected'),catalog,{semanticTimeoutMs:0},noAI),/Unable to read the product quantity/);
});

test('template projection is idempotent and preserves clinical punctuation and count text',async()=>{
 const {projectGeneralFulfillmentSections}=await import('../src/utils/generalFulfillmentText');
 const fs='We are currently out of stock for the following items: - Diclofenac 25mg/mL Injection, 3mL [0/5] - Hydrocortisone 100mg Injection [0/2] Expected delivery: tomorrow.';
 const projected=projectGeneralFulfillmentSections(fs);
 assert.equal(projectGeneralFulfillmentSections(projected),projected);
 assert.match(projected,/25mg\/mL Injection, 3mL \[0\/5\]/);
 const products=parseGeneralProducts(fs,'fulfillment_confirmation');
 assert.equal(products.length,2);assert.deepEqual(products.map(product=>product.ratioRequestedQuantity),[5,2]);
 assert.ok(products.every(product=>product.quantity===0));
});

test('existing newline lists and trailing partial-stockout annotations remain unchanged',async()=>{
 const {projectGeneralFulfillmentSections}=await import('../src/utils/generalFulfillmentText');
 const fs='Currently out of stock for the following items:\n- Hydrocortisone 100mg Injection [3/10] - partially out of stock\n- Oral Rehydration Salts [0/2]\nExpected delivery: tomorrow.';
 assert.equal(projectGeneralFulfillmentSections(fs),fs);
 const parsed=parseGeneralProducts(fs,'fulfillment_confirmation');
 assert.equal(parsed.length,2);assert.equal(parsed[0].line,2);
 assert.equal(parsed[0].stockIndicator,'partially out of stock');
 assert.equal(parsed[0].quantity,3);assert.equal(parsed[0].ratioRequestedQuantity,10);
});
