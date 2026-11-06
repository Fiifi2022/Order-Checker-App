import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {projectFourFieldFulfillment} from './generalFourFieldInput';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog,defaultProducts} from './productCatalog';
import {dispatchAuditScenarios} from '../src/data/dispatchAuditScenarios';
import Details from '../src/components/GeneralAuditDetails';
const catalog={revision:10001,products:defaultProducts()};
const scenario=(id:string)=>dispatchAuditScenarios.find(s=>s.id===id)!;
async function run(customer=scenario('nominal-order').customerRequest,fulfillment=scenario('nominal-order').fulfillmentConfirmation,profile=true){
 applyCatalog(catalog);let calls=0;
 const result=await runGeneralProductNameAudit(customer,fulfillment,catalog,{requestLanguage:profile,semanticTimeoutMs:0,deferProductResearch:true},()=>{calls++;throw Error('No live AI');});
 return {result,calls};
}
test('the exact screenshot demo passes without boilerplate product-review warnings or AI',async()=>{
 const {result,calls}=await run();
 assert.equal(result.allMatch,true);assert.equal(calls,0);assert.equal(result.issueCount,0);
 assert.equal(result.generalAudit.facility.status,'match');assert.equal(result.generalAudit.orderer.status,'match');
 assert.deepEqual(result.items.map(i=>[i.fulfillment.requested,i.fulfillment.supplied]),[[5,5],[5,5]]);
 assert.deepEqual(result.generalAudit.semanticReviews,[]);
 const html=renderToStaticMarkup(createElement(Details,{details:result.generalAudit}));
 assert.doesNotMatch(html,/PRODUCT IDENTIFICATION REVIEW|text requiring review|received your order|0800719102|Could not read all products/i);
});
test('wrapped stockout templates preserve zero supply and do not introduce non-order reviews',async()=>{
 const s=scenario('out-of-stock'),{result,calls}=await run(s.customerRequest,s.fulfillmentConfirmation);
 assert.equal(result.allMatch,true);assert.equal(calls,0);assert.deepEqual(result.generalAudit.semanticReviews,[]);
 assert.equal(result.items.length,2);assert.ok(result.items.every(i=>i.status==='out of stock'&&i.fulfillment.supplied===0));
});
test('receipt, preparation and support footer templates remain ignored at arbitrary whitespace wraps',async()=>{
 const s=scenario('nominal-order');
 for(const fragment of ['We have\nreceived your order (ID: BY537XPG5D).','We will now prepare the following items for\ndelivery:','Let\nus know if any changes are required or contact 0800719102 if any questions.','You will receive your flight notifications via SMS']){
  const wrapped=s.fulfillmentConfirmation.replace(fragment,fragment.replace(/\s+/g,'\n'));
  const {result}=await run(s.customerRequest,wrapped);
  assert.equal(result.allMatch,true,fragment);assert.deepEqual(result.generalAudit.semanticReviews,[],fragment);
 }
});
test('a fully wrapped expected delivery window and tracking link cannot become product evidence',async()=>{
 const s=scenario('nominal-order'),wrapped=s.fulfillmentConfirmation.replace('Expected delivery: between June 26, 2026 10:38 AM and June 26, 2026 12:38 PM.',
  'Expected delivery:\nbetween June 26, 2026\n10:38 AM and June 26, 2026\n12:38 PM.\nUse this link to track your order:\nhttps://orders.zipline.com/t/5/TEST');
 const {result}=await run(s.customerRequest,wrapped);assert.equal(result.allMatch,true);assert.deepEqual(result.generalAudit.semanticReviews,[]);
});
test('wrapped greeting retains the actual customer and facility names',async()=>{
 const s=scenario('nominal-order'),{result}=await run(s.customerRequest,s.fulfillmentConfirmation.replace('Thank you Isaac Awuyem from Gbimsi CHPS for ordering with Zipline.',
  'Thank you Isaac\nAwuyem from Gbimsi\nCHPS for ordering with Zipline.'));
 assert.equal(result.allMatch,true);assert.equal(result.generalAudit.orderer.fulfillmentValue,'Isaac Awuyem');assert.equal(result.generalAudit.facility.fulfillmentValue,'Gbimsi CHPS');
});
test('different products remain discrepancies after template filtering',async()=>{
 const s=scenario('order-mismatch'),{result}=await run(s.customerRequest,s.fulfillmentConfirmation);
 assert.equal(result.allMatch,false);assert.ok(result.items.some(i=>i.status==='missing item'));assert.ok(result.items.some(i=>i.status==='extra item'));
 assert.deepEqual(result.generalAudit.semanticReviews,[]);
});
test('different facilities remain discrepancies after template filtering',async()=>{
 const s=scenario('facility-mismatch'),{result}=await run(s.customerRequest,s.fulfillmentConfirmation);
 assert.equal(result.allMatch,false);assert.equal(result.generalAudit.facility.status,'mismatch');assert.deepEqual(result.generalAudit.semanticReviews,[]);
});
test('different orderers and quantities are independently preserved',async()=>{
 const s=scenario('nominal-order');
 const person=(await run(s.customerRequest,s.fulfillmentConfirmation.replace('Isaac Awuyem','Peter Brown'))).result;
 assert.equal(person.allMatch,false);assert.equal(person.generalAudit.orderer.status,'mismatch');
 const quantity=(await run(s.customerRequest,s.fulfillmentConfirmation.replace('Multivitamin Syrup [5/5]','Multivitamin Syrup [3/5]'))).result;
 assert.equal(quantity.allMatch,false);assert.equal(quantity.items[0].fulfillment.requested,5);assert.equal(quantity.items[0].fulfillment.supplied,3);
});
test('real product amendments beside a standard footer stay visible and cannot clear the audit',async()=>{
 const s=scenario('nominal-order'),change='Please replace the product with Ringers Lactate - 5.';
 const fs=s.fulfillmentConfirmation+'\n'+change;
 assert.ok(projectFourFieldFulfillment(fs).includes(change));
 const {result}=await run(s.customerRequest,fs);assert.equal(result.allMatch,false);
 assert.ok(result.generalAudit.semanticReviews?.some(r=>/replace the product/i.test(r.originalText)));
});
test('the projection never strips actual product/quantity entries or guesses an unknown product',()=>{
 const actual='\n- Mysterybrand 500mg [5/5]\n- Oral Rehydration Salts [0/10]\nPlease add PCM - 3\n';
 assert.equal(projectFourFieldFulfillment(actual),actual);
 assert.ok(projectFourFieldFulfillment('We are currently out\nof stock for the following\nitems:\n- Mysterybrand [0/5]').includes('out of stock'));
});
