import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCatalog} from './productCatalog';
import {extractGeneralOrderDeterministically} from './generalOrderExtraction';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {createGeneralAuditRun,completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import type {ProductCatalog} from '../shared/productCatalog';

const facility='St. Joseph the Worker Clinic';
const context={records:[{id:'st-joseph',name:facility,source:'test/directory'}]};
const catalog:ProductCatalog={revision:2600,products:[
  {id:'rl',scope:'general',name:"Ringer's Lactate Infusion, 500mL",aliases:['IVF R/L 500mls'],contextualAliases:[],category:'medicine',note:''},
  {id:'d5',scope:'general',name:'Dextrose 5% Infusion, 500mL',aliases:['IVF D5%500mls'],contextualAliases:[],category:'medicine',note:''},
  {id:'d10',scope:'general',name:'Dextrose 10% Infusion, 500mL',aliases:['IVF D10%500mls'],contextualAliases:[],category:'medicine',note:''},
]};
const products='- IVF R/L 500mls=10\n- IVF D5%500mls=10\n- IVF D10%500mls=10';
const fulfillment=`Thank you Enoch from ${facility} for ordering with Zipline.\n- Ringer's Lactate Infusion, 500mL [10/10]\n- Dextrose 5% Infusion, 500mL [10/10]\n- Dextrose 10% Infusion, 500mL [10/10]`;

test('screenshot bare sender introduction extracts four fields without AI or loss of compact quantities',async()=>{
  applyCatalog(catalog);
  const customer=`Enoch from ${facility}\n${products}`;
  const parsed=extractGeneralOrderDeterministically(customer,'customer_request',context);
  assert.equal(parsed.order.ordererName,'Enoch');assert.equal(parsed.order.facilityName,facility);
  assert.deepEqual(parsed.order.products.map(p=>p.quantity),[10,10,10]);
  let calls=0;
  const result=await runGeneralProductNameAudit(customer,fulfillment,catalog,{facilityContext:context},()=>{calls++;throw Error('Unnecessary AI');});
  assert.equal(calls,0);assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));
  assert.equal(result.generalAudit.orderer.whatsappValue,'Enoch');assert.equal(result.items.length,3);
  assert.equal(result.generalAudit.extraction?.customer.ordererName,'Enoch');
  const inputs={whatsappMessage:customer,fulfillmentConfirmation:fulfillment};
  assert.equal(completeGeneralAuditRun(createGeneralAuditRun(inputs,1,{}, {},true),JSON.parse(JSON.stringify({...result,...inputs}))).allMatch,true);
});

test('patient references, generic roles, competing senders and absent names cannot receive sender clearance',async()=>{
  applyCatalog(catalog);
  for(const intro of [`Patient: Enoch from ${facility}`,`Nurse from ${facility}`,`Enoch and Mary from ${facility}`,`Enoch from ${facility}\nMary from ${facility}`,`Facility: ${facility}`]){
    const result=await runGeneralProductNameAudit(`${intro}\n${products}`,fulfillment,catalog,{facilityContext:context,semanticTimeoutMs:0},()=>{throw Error('AI disabled');});
    assert.notEqual(result.generalAudit.orderer.status,'match',intro);assert.equal(result.allMatch,false,intro);
  }
});

test('unresolved order-placement wording invokes AI and accepts only a source-backed identity',async()=>{
  applyCatalog(catalog);
  const customer=`Order placed by Enoch Mensah at ${facility}\n${products}`;
  let calls=0;
  const result=await runGeneralProductNameAudit(customer,fulfillment.replace('Thank you Enoch','Thank you Enoch Mensah'),catalog,
    {facilityContext:context,semanticTimeoutMs:1000,semanticCacheScope:'sender-placement'},()=>({models:{generateContent:async()=>{
      calls++;return {text:JSON.stringify({customer:{ordererName:'Enoch Mensah',facilityName:null,products:[],deliveryArea:null,district:null,unresolvedFields:[],extractionConfidence:1}})};
    }}}));
  assert.equal(calls,1);assert.equal(result.generalAudit.orderer.whatsappValue,'Enoch Mensah');assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));
});

for(const mode of ['invented','unavailable'] as const)test(`AI ${mode} keeps unverified sender unresolved and never copies it from fulfillment`,async()=>{
  applyCatalog(catalog);let calls=0;
  const result=await runGeneralProductNameAudit(`Order placed by Enoch Mensah at ${facility}\n${products}`,fulfillment.replace('Thank you Enoch','Thank you Enoch Mensah'),catalog,
    {facilityContext:context,semanticTimeoutMs:1000,semanticCacheScope:`sender-${mode}`},()=>({models:{generateContent:async()=>{
      calls++;if(mode==='unavailable')throw Error('Offline');
      return {text:JSON.stringify({customer:{ordererName:'Mary Akua',facilityName:'Another Clinic',products:[{name:'ORS',quantity:99,unit:'packs'}],deliveryArea:null,district:null,unresolvedFields:[],extractionConfidence:1}})};
    }}}));
  assert.equal(calls,1);assert.notEqual(result.generalAudit.orderer.status,'match');assert.equal(result.allMatch,false);
  assert.equal(result.items.length,3);assert.ok(result.items.every(item=>item.fulfillment.requested===10));
});
