import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {extractGeneralOrderDeterministically} from './generalOrderExtraction';
import {generalOrderRelevantText} from '../src/utils/generalTextClassification';
import {GENERAL_SENTENCE_BREAK} from '../src/utils/generalSentenceBoundaries';
import {createGeneralAuditRun,completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import Details from '../src/components/GeneralAuditDetails';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog} from '../shared/productCatalog';

// These approved fixture aliases mirror products already matched in the user's
// screenshot. This test never creates or saves clinical aliases in the live catalogue.
const catalog:ProductCatalog={revision:1900,products:[
  {id:'rl',scope:'general',name:"Ringer's Lactate Infusion, 500mL",aliases:['IVF R/L 500mls','IVFR/L500mls'],contextualAliases:[],category:'medicine',note:''},
  {id:'d5',scope:'general',name:'Dextrose 5% Infusion, 500mL',aliases:['IVF DN 500mls','IVFDN500mls'],contextualAliases:[],category:'medicine',note:''},
  {id:'d10',scope:'general',name:'Dextrose 10% Infusion, 500mL',aliases:['IVF D10 500mls','IVFD10%500mls'],contextualAliases:[],category:'medicine',note:''},
]};
const facility='St. Joseph the Worker Clinic';
const customer=`Name:Enoch\nFacility:${facility}\n- IVF R/L 500mls=10\n- IVF DN 500mls=10\n- IVF D10 500mls=10`;
const fulfillment=`Thank you Enoch from ${facility} for ordering with Zipline. We have received your order (ID: TEST123). We are currently out of stock for the following items:\n- Dextrose 5% Infusion, 500mL [0/1]\n- Ringer's Lactate Infusion, 500mL [0/1]\nWe can prepare the following items we have in stock for delivery:\n- Dextrose 10% Infusion, 500mL [10/10]\nPlease reach out to the nearest stock for the rest of the order.`;
async function audit(a=customer,b=fulfillment) {
  applyCatalog(catalog);let calls=0;
  const result=await runGeneralProductNameAudit(a,b,catalog,{semanticTimeoutMs:1000},()=>{calls++;throw Error('This example needs no Gemini');});
  assert.equal(calls,0);
  return result;
}

test('reported St. Joseph stockout order matches its full facility, explicit single name and approved products',async()=>{
  const result=await audit();
  assert.equal(result.generalAudit.facility.fulfillmentValue,facility);
  assert.equal(result.generalAudit.facility.status,'match');
  assert.equal(result.generalAudit.orderer.fulfillmentValue,'Enoch');
  assert.equal(result.generalAudit.orderer.status,'match');
  assert.equal(result.meta.ordererName.status,'match');
  assert.equal(result.meta.customerName.status,'match');
  assert.equal(result.items.length,3);
  assert.equal(result.generalAudit.productCount.requested,3);assert.equal(result.generalAudit.productCount.found,3);
  assert.equal(result.generalAudit.counts.outOfStock,2);assert.equal(result.generalAudit.productTotals?.physicallySuppliedUnits,10);
  assert.equal(result.issueCount,0);assert.equal(result.allMatch,true);assert.equal(result.confidence,100);
  const inputs={whatsappMessage:customer,fulfillmentConfirmation:fulfillment};
  const completed=completeGeneralAuditRun(createGeneralAuditRun(inputs,1,{}, {},true),JSON.parse(JSON.stringify({...result,...inputs})));
  assert.equal(completed.generalAudit.finalStatus,'NO DISCREPANCY');
  for(const html of [renderToStaticMarkup(createElement(Details,{details:completed.generalAudit})),buildGeneralReport(completed)]) {
    assert.match(html,/St\. Joseph the Worker Clinic/);assert.match(html,/Enoch/);
    assert.doesNotMatch(html,/Facility Name Mismatch|ORDERER NAME MISMATCH|Not found|REVIEW REQUIRED/);
  }
});

for(const name of ['St. Joseph the Worker Clinic','St. Mary Hospital','Dr. Mensah Memorial Clinic','Mt. Zion Health Centre'])
  test(`periods within the facility name survive extraction: ${name}`,async()=>{
    const result=await audit(customer.replace(facility,name),fulfillment.replace(facility,name));
    assert.equal(result.generalAudit.facility.fulfillmentValue,name);assert.equal(result.generalAudit.facility.status,'match');
    assert.equal(result.allMatch,true);
  });

test('sentence boundaries preserve names, initials, decimal measurements and real following sentences',()=>{
  const text='Thank you Dr. Kofi A. Mensah from St. Joseph Clinic for ordering. We received your order. ORS 2.';
  assert.deepEqual(text.split(GENERAL_SENTENCE_BREAK),['Thank you Dr. Kofi A. Mensah from St. Joseph Clinic for ordering.','We received your order.','ORS 2.']);
  assert.ok(generalOrderRelevantText('Facility: St. Joseph Clinic').includes('St. Joseph Clinic'));
  assert.deepEqual('Injection 0.5mg - 2. ASV 3.'.split(GENERAL_SENTENCE_BREAK),['Injection 0.5mg - 2.','ASV 3.']);
});

test('natural introductions at St. facilities retain source-backed names and products',()=>{
  applyCatalog(catalog);
  const records=[{name:facility,source:'test/directory'}];
  for(const text of [
    `This is Enoch from ${facility}. Please send IVF R/L 500mls 10.`,
    `Enoch, ${facility}, please send IVF R/L 500mls 10.`,
  ]) {
    const result=extractGeneralOrderDeterministically(text,'customer_request',{records});
    assert.equal(result.order.facilityName,facility);assert.equal(result.order.ordererName,'Enoch');
    assert.equal(result.order.products[0]?.quantity,10);
  }
});

test('a different St. facility remains a genuine discrepancy',async()=>{
  const result=await audit(customer,fulfillment.replace(facility,'St. Mary Clinic'));
  assert.equal(result.generalAudit.facility.status,'mismatch');assert.equal(result.allMatch,false);assert.ok(result.issueCount>0);
});

test('a missing customer name is never filled from the single-name FS greeting',async()=>{
  const result=await audit(customer.replace('Name:Enoch\n',''));
  assert.equal(result.generalAudit.orderer.whatsappValue,'N/A');assert.equal(result.generalAudit.orderer.fulfillmentValue,'Enoch');
  assert.equal(result.allMatch,false);assert.equal(result.generalAudit.finalStatus,'REVIEW REQUIRED');
});

test('conflicting explicit customer names cannot be cleared by the matching single-name greeting',async()=>{
  const result=await audit('Name:Mary\n'+customer);
  assert.notEqual(result.generalAudit.orderer.status,'match');assert.equal(result.allMatch,false);
});

test('a different named orderer and quantity mismatch remain detectable',async()=>{
  const orderer=await audit(customer,fulfillment.replace('Thank you Enoch','Thank you Mary'));
  assert.notEqual(orderer.generalAudit.orderer.status,'match');assert.equal(orderer.allMatch,false);
  const quantity=await audit(customer,fulfillment.replace('[10/10]','[12/12]'));
  assert.equal(quantity.allMatch,false);assert.ok(quantity.issueCount>0);
});

test('initials and misspelled single names never acquire exact-name clearance',async()=>{
  for(const [left,right] of [['E','E'],['Enoch','Enoc']]) {
    const result=await audit(customer.replace('Name:Enoch',`Name:${left}`),fulfillment.replace('Thank you Enoch',`Thank you ${right}`));
    assert.notEqual(result.generalAudit.orderer.status,'match');assert.equal(result.allMatch,false);
  }
});

test('competing FS orderer greetings require review instead of choosing the matching one',async()=>{
  const result=await audit(customer,fulfillment+`\nThank you Mary from ${facility} for ordering with Zipline.`);
  assert.notEqual(result.generalAudit.orderer.status,'match');assert.equal(result.allMatch,false);
});
