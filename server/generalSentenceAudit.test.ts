import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyCatalog } from './productCatalog';
import { runGeneralProductNameAudit } from './generalProductNameAudit';
import { extractGeneralOrderDeterministically } from './generalOrderExtraction';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';
import Details from '../src/components/GeneralAuditDetails';
import { buildGeneralReport } from '../extension/general-report.js';
import type { ProductCatalog } from '../shared/productCatalog';

const catalog: ProductCatalog = {revision:510,products:[
  {id:'rdt',scope:'general',name:'Malaria Rapid Diagnostic Test Kit',aliases:['RDT','RDT kits'],contextualAliases:[],category:'diagnostic',note:''},
  {id:'multi',scope:'general',name:'Multivitamin Syrup',aliases:[],contextualAliases:[],category:'medicine',note:''},
  {id:'pcm',scope:'general',name:'Paracetamol 500mg Tablet',aliases:['PCM'],contextualAliases:[],category:'medicine',note:''},
]};
const context = {records:[{id:'abasua',name:'Abasua Health Centre',verifiedAliases:['Abasua HC'],source:'test'},
  {id:'other',name:'Anyinofi Health Centre',verifiedAliases:['Anyinofi HC'],source:'test'},
  {id:'untyped',name:'Official Yagaba',source:'test'}]};
const log = (products='Malaria Rapid Diagnostic Test Kit [2/2]') => `Thank you Grace Akabati from Abasua HC for ordering with Zipline. We have received your order (ID: TEST123). We will now prepare the following items for delivery:\n- ${products}`;
const noAI = () => {throw Error('Recognized sentences must not need Gemini');};
async function audit(customer:string,fulfillment=log(),support={}) {
  applyCatalog(catalog);
  return runGeneralProductNameAudit(customer,fulfillment,catalog,{facilityContext:context,semanticTimeoutMs:0,...support},noAI);
}

for (const intro of ['Hello, this is Grace Akabati from Abasua HC.', 'I am Grace from Abasua HC,', "I'm Grace Akabati calling from Abasua Health Centre and", 'My name is Grace Akabati. We are ordering from Abasua HC.']) {
  test(`sentence request: ${intro}`, async()=>{
    const r=await audit(`${intro} Please send us 2 RDT kits.`);
    assert.equal(r.allMatch,true,JSON.stringify(r.generalAudit));
    assert.equal(r.generalAudit.facility.status,'match');
    assert.equal(r.generalAudit.orderer.status,'match');
    assert.equal(r.items.length,1);
    assert.equal(r.items[0].fulfillment.requested,2);
    assert.equal(r.items[0].fulfillment.supplied,2);
    assert.equal(r.generalAudit.extraction?.customer.facilityName,r.generalAudit.facility.whatsappValue);
  });
}

test('sentence list preserves independent quantities, units and product strengths',async()=>{
  const input='Hello, this is Grace Akabati from Abasua HC. Please send us 5 bottles of Multivitamin Syrup and 2 RDT kits and PCM 500mg 20 tablets.';
  const r=await audit(input,log('Multivitamin Syrup - 5 bottles\n- Malaria Rapid Diagnostic Test Kit [2/2]\n- Paracetamol 500mg Tablet - 20 tablets'));
  assert.equal(r.allMatch,true,JSON.stringify(r.generalAudit));
  assert.equal(r.items.length,3);
  assert.deepEqual(r.items.map(item=>item.fulfillment.requested).sort((a,b)=>a-b),[2,5,20]);
});

test('ordering facility is independent of another delivery facility',async()=>{
  const r=await audit('This is Grace Akabati from Abasua HC. Please send 2 RDT kits. Please deliver to Anyinofi HC.');
  assert.equal(r.generalAudit.facility.whatsappValue,'Abasua HC');
  assert.equal(r.generalAudit.facility.status,'match');
  assert.equal(r.allMatch,true,JSON.stringify(r.generalAudit));
});

test('untyped facility needs an actual directory record',async()=>{
  const r=await audit('This is Grace Akabati from Official Yagaba. We need RDT 2.',log().replace('Abasua HC','Official Yagaba'));
  assert.equal(r.allMatch,true,JSON.stringify(r.generalAudit));
  assert.equal(r.generalAudit.facility.customerFacilityId,'untyped');
});

test('unlabelled directory facility punctuation works in both messages without Gemini',async()=>{
  const r=await audit('This is Grace Akabati from Official-Yagaba. Please send RDT 2.',log().replace('Abasua HC','OFFICIAL YAGABA'));
  assert.equal(r.allMatch,true,JSON.stringify(r.generalAudit));
  assert.equal(r.generalAudit.facility.customerFacilityId,'untyped');
  assert.equal(r.generalAudit.facility.fulfillmentFacilityId,'untyped');
  assert.equal(r.generalAudit.facility.whatsappValue,'Official-Yagaba');
});

test('directory cannot supply a facility absent from the customer message',async()=>{
  const r=await audit('My name is Grace Akabati. Please send RDT 2.');
  assert.equal(r.allMatch,false);
  assert.equal(r.generalAudit.facility.whatsappValue,'N/A');
  assert.equal(r.generalAudit.facility.status,'missing from customer request');
});

test('patient names, ages and contact numbers do not supply orderer or product quantities',async()=>{
  const r=await audit('Facility: Abasua HC\nPatient name: Grace Akabati\nAge: 19\nContact: 0241234567\nPlease send RDT 2.');
  assert.equal(r.generalAudit.orderer.whatsappValue,'N/A');
  assert.equal(r.allMatch,false);
  assert.equal(r.items[0].fulfillment.requested,2);
  const missing=await audit('This is Grace Akabati from Abasua HC. Please send RDT.\nAge: 19');
  assert.equal(missing.allMatch,false);
  assert.ok(missing.items.every(item=>item.fulfillment.requested!==19));
});

test('competing introductions require clarification instead of selecting the convenient identity',async()=>{
  const r=await audit('I am Grace Akabati from Abasua HC. This is Emmanuel Adomako from Anyinofi HC. Please send RDT 2.');
  assert.equal(r.allMatch,false);
  assert.equal(r.generalAudit.orderer.status,'review required');
  assert.equal(r.generalAudit.facility.status,'review required');
  assert.ok(r.generalAudit.semanticReviews?.some(review=>review.field==='facilityName'));
});

test('sentence reading retains stockouts, missing products, extras, wrong facilities and quantities',async()=>{
  const request='This is Grace Akabati from Abasua HC. We need RDT 2.';
  const stockout=await audit(request,log('Malaria Rapid Diagnostic Test Kit [0/1]'));
  assert.equal(stockout.allMatch,true);assert.equal(stockout.generalAudit.counts.outOfStock,1);
  for(const fulfillment of [log('Paracetamol 500mg Tablet [2/2]'),log().replace('Abasua HC','Anyinofi HC'),log('Malaria Rapid Diagnostic Test Kit [3/3]'),log('Malaria Rapid Diagnostic Test Kit [2/2]\n- Paracetamol 500mg Tablet [1/1]')]) {
    assert.equal((await audit(request,fulfillment)).allMatch,false,fulfillment);
  }
  const shortfall=await audit(request,log('Malaria Rapid Diagnostic Test Kit [1/2]'));
  assert.equal(shortfall.allMatch,false);assert.equal(shortfall.generalAudit.pendingOrderLimitCount,1);
  const approved=await audit(request,log('Malaria Rapid Diagnostic Test Kit [1/2]'),{generalOrderLimitDecisions:{rdt:true}});
  assert.equal(approved.allMatch,true);
});

test('main app and extension receive the same extraction preview and authoritative audit',async()=>{
  const inputs={whatsappMessage:'This is Grace Akabati from Abasua HC. We need RDT 2.',fulfillmentConfirmation:log()};
  const backend=await audit(inputs.whatsappMessage,inputs.fulfillmentConfirmation);
  const accepted=completeGeneralAuditRun(createGeneralAuditRun(inputs,1,{}, {},true),{...backend,...inputs});
  assert.equal(accepted.allMatch,true);
  const web=renderToStaticMarkup(createElement(Details,{details:accepted.generalAudit}));
  const extension=buildGeneralReport(accepted);
  for(const html of [web,extension]) {assert.match(html,/What we understood/);assert.match(html,/Grace Akabati/);assert.match(html,/edit the original message/);}
});

test('unparsed additional product requests cannot disappear behind a valid match',async()=>{
  const r=await audit('This is Grace Akabati from Abasua HC. Please send RDT 2. We also need something for fever.');
  assert.equal(r.allMatch,false);
  const extra=await audit('This is Grace Akabati from Abasua HC. Please send RDT 2. Please deliver to Anyinofi HC with PCM 5.');
  assert.equal(extra.allMatch,false,'Delivery prose must not hide an extra product instruction');
});

test('would-like requests and number words retain explicit quantities',()=>{
  applyCatalog(catalog);
  const r=extractGeneralOrderDeterministically('My name is Grace Akabati. Our facility is Abasua HC. I would like to order five bottles of Multivitamin Syrup.','customer_request',context);
  assert.equal(r.order.ordererName,'Grace Akabati');
  assert.equal(r.order.facilityName,'Abasua HC');
  assert.equal(r.order.products[0]?.quantity,5);
});

test('bounded Gemini extraction can fill only a source-supported unresolved orderer',async()=>{
  let calls=0;
  const request='Facility: Abasua HC\nDuty nurse is Grace Akabati\nPlease send RDT 2.';
  applyCatalog(catalog);
  const r=await runGeneralProductNameAudit(request,log(),catalog,{facilityContext:context,semanticCacheScope:'sentence-role',semanticTimeoutMs:1000},()=>({models:{async generateContent(options:any){
    calls++;
    const input=JSON.parse(options.contents);
    assert.deepEqual(input.customer.unresolvedFields,['ordererName']);
    assert.doesNotMatch(options.contents,/Abasua|RDT/);
    return {text:JSON.stringify({customer:{facilityName:'Invented Hospital',ordererName:'Grace Akabati',products:[],deliveryArea:null,district:null,unresolvedFields:[],extractionConfidence:0.99}})};
  }}}));
  assert.equal(calls,1);assert.equal(r.allMatch,true);assert.equal(r.semanticAnalysis.status,'used');
  assert.equal(r.generalAudit.facility.whatsappValue,'Abasua HC');
});

test('Gemini cannot invent identities, select a recipient, or override competing signatories',async()=>{
  for(const [line,proposed] of [['The recipient is Grace Akabati','Grace Akabati'],['Duty nurse is SOMEONE ELSE','Grace Akabati'],['Signed Grace Akabati and Emmanuel Adomako','Grace Akabati'],['Signed Grace Akabati\nSigned Emmanuel Adomako','Grace Akabati']]) {
    applyCatalog(catalog);
    const request=`Facility: Abasua HC\n${line}\nPlease send RDT 2.`;
    const r=await runGeneralProductNameAudit(request,log(),catalog,{facilityContext:context,semanticCacheScope:line,semanticTimeoutMs:1000},()=>({models:{async generateContent(){
      return {text:JSON.stringify({customer:{facilityName:null,ordererName:proposed,products:[],deliveryArea:null,district:null,unresolvedFields:[],extractionConfidence:1}})};
    }}}));
    assert.equal(r.allMatch,false,line);assert.equal(r.generalAudit.orderer.whatsappValue,'N/A',line);
  }
});

test('sentence quantities retain customer ratios and explicit amendments still require review',async()=>{
  const request='This is Grace Akabati from Abasua HC. We need RDT 20/20.';
  const r=await audit(request,log('Malaria Rapid Diagnostic Test Kit [20/20]'));
  assert.equal(r.allMatch,true);assert.equal(r.items[0].fulfillment.requested,20);
  for(const change of ['Please change the quantity of RDT from 20 to 30.']) {
    const changed=await audit(request+'\n'+change,log('Malaria Rapid Diagnostic Test Kit [20/20]'));
    assert.equal(changed.allMatch,false,change);
    assert.ok(changed.generalAudit.semanticReviews?.some(review=>review.originalText===change),JSON.stringify(changed.generalAudit));
  }
});

test('an extraction outage preserves recognized products and requests clarification for the missing identity',async()=>{
  const r=await audit('Facility: Abasua HC\nDuty nurse is Grace Akabati\nPlease send RDT 2.',log(),{semanticTimeoutMs:10,semanticCacheScope:'sentence-outage'});
  assert.equal(r.allMatch,false);assert.equal(r.items[0].status,'match');
  assert.equal(r.items[0].fulfillment.requested,2);
  assert.equal(r.generalAudit.orderer.whatsappValue,'N/A');
});
