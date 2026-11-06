import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import type {ProductCatalog} from '../shared/productCatalog';
const catalog:ProductCatalog={revision:8001,products:[{id:'ors',name:'Oral Rehydration Salts',scope:'general',category:'medicine',aliases:['ORS'],contextualAliases:[],note:''}]};
const header='Facility: Example HC\nOrderer: Grace Akabati\n';
const confirmation=header+'Oral Rehydration Salts [2/2]';
const fields=(extra:any={})=>({facilityName:null,ordererName:null,products:[],deliveryArea:null,district:null,unresolvedFields:[],extractionConfidence:.99,...extra});

async function run(request:string,customer:any,scope:string){
 applyCatalog(catalog);let calls=0;let payload:any;
 const result=await runGeneralProductNameAudit(request,confirmation,catalog,{semanticCacheScope:scope},()=>({models:{async generateContent(input:any){
  calls++;assert.ok(input.config.httpOptions.timeout>=10000);payload=JSON.parse(input.contents);return{text:JSON.stringify({customer})};
 }}}));
 return{result,calls,payload};
}

test('the production catalogue auditor calls extraction AI for an unresolved signed name without a narrative trigger',async()=>{
 const {result,calls,payload}=await run('Facility: Example HC\nSigned: Grace Akabati\nORS - 2',fields({ordererName:'Grace Akabati'}),'signed-extraction-gate');
 assert.equal(calls,1);assert.deepEqual(payload.customer.unresolvedFields,['ordererName']);
 assert.equal(result.generalAudit.orderer.whatsappValue,'Grace Akabati');assert.equal(result.allMatch,true);
 assert.equal(result.items[0].fulfillment.requested,2);assert.equal(result.items[0].fulfillment.supplied,2);
});

test('AI can extract a source-stated catalogue product and quantity from ordinary request wording',async()=>{
 const {result,calls}=await run(header+'Kindly arrange ORS, with a quantity equal to 2 packs.',fields({products:[{name:'ORS',quantity:2,unit:'pack'}]}),'source-wording-product');
 assert.equal(calls,1);assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));
 assert.equal(result.items[0].fulfillment.requested,2);assert.equal(result.items[0].catalogProductId,'ors');
});

test('AI supports an explicit count without inventing a unit and preserves source name casing',async()=>{
 const {result,calls}=await run(header+'Please arrange ors, quantity is 2.',fields({products:[{name:'ORS',quantity:2,unit:null}]}),'unitless-source-count');
 assert.equal(calls,1);assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));
 assert.equal(result.items[0].fulfillment.requested,2);assert.equal(result.items[0].fulfillment.requestedUnit,'');
 assert.equal(result.items[0].provenance.find(p=>p.source==='customer_request')!.name,'ors');
});

test('source guards reject AI counts borrowed from fulfilment, unsupported units and changed known fields',async()=>{
 for(const [request,proposed,scope] of [
  [header+'Please arrange ORS.',fields({products:[{name:'ORS',quantity:2,unit:null}]}),'no-source-count'],
  [header+'Please arrange ORS, quantity is 20.',fields({products:[{name:'ORS',quantity:2,unit:null}]}),'number-boundary'],
  [header+'Please arrange ORS, quantity is 2 packs.',fields({products:[{name:'ORS',quantity:2,unit:'vial'}]}),'wrong-source-unit'],
  ['Facility: Example HC\nSigned: Grace Akabati\nORS - 2',fields({ordererName:'Invented Person'}),'invented-name'],
 ] as const){
  const {result}=await run(request,proposed,scope);assert.equal(result.allMatch,false,scope);
 }
 const {result}=await run(header+'Please arrange ORS, quantity is 2.',fields({facilityName:'Invented Hospital',ordererName:'Invented Person',products:[{name:'ORS',quantity:2,unit:null}]}),'known-identity-protected');
 assert.equal(result.allMatch,true);assert.equal(result.generalAudit.orderer.whatsappValue,'Grace Akabati');assert.equal(result.generalAudit.facility.whatsappValue,'Example HC');
});

test('clear messages remain deterministic and AI outages cannot invent an absent name or quantity',async()=>{
 applyCatalog(catalog);let calls=0;
 const getClient=()=>{calls++;throw Error('offline');};
 const matched=await runGeneralProductNameAudit(header+'ORS - 2',confirmation,catalog,{},getClient);
 assert.equal(matched.allMatch,true);assert.equal(calls,0);
 const unclear=await runGeneralProductNameAudit('Facility: Example HC\nSigned: Grace Akabati\nORS - 2',confirmation,catalog,{semanticCacheScope:'signed-offline'},getClient);
 assert.equal(unclear.allMatch,false);assert.equal(unclear.generalAudit.orderer.whatsappValue,'N/A');
 assert.equal(unclear.items[0].fulfillment.requested,2);
});
