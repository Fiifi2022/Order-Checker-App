import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {extractGeneralOrderDeterministically} from './generalOrderExtraction';
import {parseGeneralProducts} from '../src/utils/generalAuditor';
import {generalStandaloneQuantity} from '../src/utils/generalDocumentStructure';
import {createGeneralAuditRun,completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog} from '../shared/productCatalog';

const names=['Metronidazole 5mg/mL Injection, 100mL', "Ringer's Lactate Infusion, 500mL", 'Water for Injection, 10mL'];
const catalog: ProductCatalog={revision:701,products:names.map((name,index)=>({id:`source-product-${index}`,name,scope:'general',category:'medicine',aliases:[],contextualAliases:[],note:''}))};
const context={records:[{id:'brekumanso',name:'Brekumanso Health Centre',verifiedAliases:['Brekumanso HC','Brekumanso health center'],source:'test'}]};
const customer=`Forwarded\nBrekumanso health center\n\n${names[0]} -20 btls\n${names[1]} –20 btls\n${names[2]}- 20pics`;
const fulfillment=`Thank you Bernard from Brekumanso HC for ordering with Zipline. We have received your order (ID: NJNB9AR9H6). Use this link to track your order: https://orders.zipline.com/t/5/NJNB9AR9H6 We will now prepare the following items for delivery:\n• ${names[2]} [20/20]\n• ${names[0]} [15/15]\n• ${names[1]} [20/20]`;
const noAI=()=>{throw Error('Known product quantities must not require AI');};
async function audit(text=customer,confirmation=fulfillment){applyCatalog(catalog);return runGeneralProductNameAudit(text,confirmation,catalog,{facilityContext:context,semanticTimeoutMs:0},noAI);}

test('screenshot extracts the facility and all three product quantities without invented customer identity',async()=>{
 const result=await audit();
 assert.equal(result.generalAudit.facility.status,'match');
 assert.equal(result.generalAudit.orderer.whatsappValue,'N/A');
 assert.equal(result.generalAudit.orderer.fulfillmentValue,'Bernard');
 assert.equal(result.generalAudit.orderer.status,'missing from customer request');
 assert.match(result.generalAudit.orderer.reason!,/customer request does not state.*Fulfilment identifies Bernard/);
 assert.doesNotMatch(result.generalAudit.orderer.reason!,/abbreviated|misspelled/);
 assert.equal(result.items.length,3);
 assert.ok(result.items.every(item=>!['missing item','extra item'].includes(item.status)));
 assert.ok(result.items.every(item=>item.fulfillment.requested===20));
 const metronidazole=result.items.find(item=>item.name===names[0])!;
 assert.equal(metronidazole.fulfillment.supplied,15);
 assert.equal(metronidazole.fulfillment.orderLimitEligible,true);
 assert.equal(result.allMatch,false);
 for(const item of result.items.filter(item=>item.name!==names[0]))assert.equal(item.status,'match');
 const extracted=extractGeneralOrderDeterministically(customer,'customer_request',context,undefined,names).order;
 assert.equal(extracted.ordererName,null);assert.equal(extracted.products.length,3);
 assert.deepEqual(extracted.products.map(item=>item.quantity),[20,20,20]);
});

test('complete natural-language sender and equal quantities clear without the abbreviated-name warning',async()=>{
 const text=customer.replace('Brekumanso health center','Bernard from Brekumanso health center');
 const result=await audit(text,fulfillment.replace('[15/15]','[20/20]'));
 assert.equal(result.generalAudit.orderer.status,'match');
 assert.equal(result.generalAudit.orderer.whatsappValue,'Bernard');
 assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));
 assert.equal(result.confidence,100);
});

test('shared browser and extension comparison retains all three source quantities and the real shortfall',async()=>{
 const result=await audit();
 const record=completeGeneralAuditRun(createGeneralAuditRun({whatsappMessage:customer,fulfillmentConfirmation:fulfillment},1,{}, {},true),JSON.parse(JSON.stringify({...result,whatsappMessage:customer,fulfillmentConfirmation:fulfillment})));
 assert.equal(record.items.length,3);
 assert.ok(record.items.every(item=>item.fulfillment.requested===20));
 const html=buildGeneralReport(record);
 assert.match(html,/Bernard/);assert.doesNotMatch(html,/Possible abbreviated, incomplete/);
 assert.equal(record.generalAudit.orderer.status,'missing from customer request');
});

test('quantity-unit spellings preserve product specifications, ratios and count units',()=>{
 for(const [suffix,unit] of [['20btls','bottle'],['20 btl','bottle'],['20 bottles','bottle'],['20pics','piece'],['20 pcs','piece']] as const){
   const parsed=parseGeneralProducts(`${names[2]}- ${suffix}`,'customer_request');
   assert.equal(parsed.length,1,suffix);assert.equal(parsed[0].quantity,20);assert.equal(parsed[0].unit,unit);assert.equal(parsed[0].name,names[2]);
   assert.equal(generalStandaloneQuantity.test(suffix),true);
 }
 const ratio=parseGeneralProducts(`${names[0]} [15/20]`,'fulfillment_confirmation')[0];
 assert.equal(ratio.quantity,15);assert.equal(ratio.ratioRequestedQuantity,20);assert.equal(ratio.name,names[0]);
});


test('forwarding labels and known count spellings do not cause unnecessary Gemini extraction',async()=>{
 applyCatalog(catalog);let calls=0;
 await runGeneralProductNameAudit(customer,fulfillment,catalog,{facilityContext:context,semanticTimeoutMs:500},()=>{calls++;throw Error('No missing identity can be inferred');});
 assert.equal(calls,0);
});
