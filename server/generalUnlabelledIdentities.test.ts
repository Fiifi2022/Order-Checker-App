import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {generalUnlabelledOrdererCandidates} from '../src/utils/generalAuditor';
import {createGeneralAuditRun,completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import {buildGeneralReport} from '../extension/general-report.js';
import Details from '../src/components/GeneralAuditDetails';
import type {ProductCatalog} from '../shared/productCatalog';
const catalog:ProductCatalog={revision:901,products:[{id:'ors',name:'Oral Rehydration Salts',scope:'general',aliases:['ORS'],contextualAliases:[],category:'medicine',note:''}]};
const log=(name:string)=>`Thank you ${name} from SDA Clinic Apaah for ordering with Zipline.\n- Oral Rehydration Salts [5/5]`;

for(const header of ['Mary Mensah\nApaah SDA HC','Apaah SDA HC\nMary Mensah','mary mensah\nApaah SDA HC','Mary Mensah from Apaah SDA HC'])test(`unlabelled sender and facility: ${header.replaceAll('\n',' / ')}`,async()=>{
 applyCatalog(catalog);let calls=0;const text=header+'\nORS - 5';
 const result=await runGeneralProductNameAudit(text,log('Mary Mensah'),catalog,{semanticTimeoutMs:500},()=>{calls++;throw Error('Clear source header needs no AI');});
 assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));assert.equal(calls,0);
 assert.equal(result.generalAudit.orderer.whatsappValue.toLowerCase(),'mary mensah');
 const record=completeGeneralAuditRun(createGeneralAuditRun({whatsappMessage:text,fulfillmentConfirmation:log('Mary Mensah')},1,{}, {},true),JSON.parse(JSON.stringify({...result,whatsappMessage:text,fulfillmentConfirmation:log('Mary Mensah')})));
 assert.equal(record.allMatch,true);
});

test('Gemini can classify a source-supported single-name header without requiring metadata labels',async()=>{
 applyCatalog(catalog);let calls=0, request:any;
 const client={models:{async generateContent(input:any){calls++;request=JSON.parse(input.contents);return{text:JSON.stringify({customer:{facilityName:null,ordererName:'Bernard',products:[],deliveryArea:null,district:null,unresolvedFields:[],extractionConfidence:.99}})};}}};
 const text='Bernard\nApaah SDA HC\nORS - 5';
 const result=await runGeneralProductNameAudit(text,log('Bernard Mensah'),catalog,{semanticTimeoutMs:1000},()=>client);
 assert.equal(calls,1);assert.deepEqual(request.customer.unlabelledOrdererCandidates,['Bernard']);
 assert.equal(result.generalAudit.orderer.whatsappValue,'Bernard');assert.equal(result.allMatch,false,JSON.stringify(result.generalAudit));
});

test('ambiguous headers, patient names, missing names and unavailable AI cannot fabricate an orderer',async()=>{
 applyCatalog(catalog);
 for(const header of ['Mary Mensah\nJane Mensah\nApaah SDA HC','Mary Mensah and Jane Mensah\nApaah SDA HC','Patient: Mary Mensah\nApaah SDA HC','Apaah SDA HC'])assert.deepEqual(generalUnlabelledOrdererCandidates(header+'\nORS - 5'),[]);
 const result=await runGeneralProductNameAudit('Bernard\nApaah SDA HC\nORS - 5',log('Bernard Mensah'),catalog,{semanticTimeoutMs:500,semanticCacheScope:'offline-header-test'},()=>{throw Error('Unavailable');});
 assert.equal(result.allMatch,false);
 const html=buildGeneralReport(result);
 assert.doesNotMatch(html,/REVIEW REQUIRED|Review Required|review required/);
 assert.match(html,/missing from customer request|could not be verified/);
 const absent=await runGeneralProductNameAudit('Apaah SDA HC\nORS - 5',log('Bernard'),catalog,{semanticTimeoutMs:0},()=>{throw Error('Unavailable');});
 assert.equal(absent.generalAudit.orderer.whatsappValue,'N/A');
});

test('extension states the actual field or product issue instead of internal review statuses',async()=>{
 applyCatalog(catalog);
 const result=await runGeneralProductNameAudit('Apaah SDA HC\nORS - 5',log('Bernard'),catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI');});
 const before=JSON.stringify(result);const html=buildGeneralReport(result);
 assert.match(html,/Orderer name missing from customer request|Orderer missing from customer request/i);
 assert.doesNotMatch(html,/>review required<|REVIEW REQUIRED|Review Required/);
 assert.equal(JSON.stringify(result),before);
 const website=renderToStaticMarkup(createElement(Details,{details:result.generalAudit}));
 assert.match(website,/missing from customer request/);
});

for(const name of ['Mary Abena Odurowaa','Odurowaa Mary Abena','Abena Odurowaa Mary','Odurowaa,Mary Abena'])for(const placement of ['header','footer'] as const)test(`unlabelled ${placement} name clears independently of word order: ${name}`,async()=>{
 applyCatalog(catalog);let calls=0;
 const text=placement==='header'?`WhatsApp\nDate: 03/11/2026\n${name}\nFacility: Apaah SDA HC\nDistrict: Example\nORS - 5`:`Apaah SDA HC\nORS - 5\n${name}`;
 const fulfillment=log('Abena Odurowaa Mary');
 const result=await runGeneralProductNameAudit(text,fulfillment,catalog,{semanticTimeoutMs:500},()=>{calls++;throw Error('Exact names require no model');});
 assert.equal(calls,0);assert.equal(result.generalAudit.orderer.status,'match',JSON.stringify(result.generalAudit));assert.equal(result.allMatch,true);
 assert.equal(result.generalAudit.orderer.whatsappValue,name);
 const record=completeGeneralAuditRun(createGeneralAuditRun({whatsappMessage:text,fulfillmentConfirmation:fulfillment},1,{}, {},true),JSON.parse(JSON.stringify({...result,whatsappMessage:text,fulfillmentConfirmation:fulfillment})));
 assert.equal(record.allMatch,true);assert.match(buildGeneralReport(record),/ORDER CONFIRMED/);
});

test('a matching unlabelled name cannot conceal another person, a patient, or a quantity difference',async()=>{
 applyCatalog(catalog);
 for(const text of [
  'Patient: Mary Abena Odurowaa\nApaah SDA HC\nORS - 5',
  'Mary Abena Odurowaa\nJane Mensah\nApaah SDA HC\nORS - 5',
  'Name: Jane Mensah\nApaah SDA HC\nORS - 5\nMary Abena Odurowaa',
  'Referring physician: Mary Abena Odurowaa\nApaah SDA HC\nORS - 5',
 ]){
  const result=await runGeneralProductNameAudit(text,log('Abena Odurowaa Mary'),catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI');});
  assert.notEqual(result.generalAudit.orderer.status,'match',text);assert.equal(result.allMatch,false);
 }
 const quantity=await runGeneralProductNameAudit('Mary Abena Odurowaa\nApaah SDA HC\nORS - 9',log('Abena Odurowaa Mary'),catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI');});
 assert.equal(quantity.generalAudit.orderer.status,'match');assert.equal(quantity.allMatch,false);assert.notEqual(quantity.items[0].status,'match');
});

for(const label of ['Name of Customer:','Name of the Customer:','Customer name:','Customer’s name:','Customer:','Name of Customer','Name of Customer:\n'])test(`customer role label is optional and recognized: ${JSON.stringify(label)}`,async()=>{
 applyCatalog(catalog);
 const text=`${label} Mary Abena Odurowaa\nApaah SDA HC\nORS - 5`;
 const result=await runGeneralProductNameAudit(text,log('Odurowaa Mary Abena'),catalog,{semanticTimeoutMs:0},()=>{throw Error('Clear customer names require no AI');});
 assert.equal(result.generalAudit.orderer.whatsappValue,'Mary Abena Odurowaa');assert.equal(result.generalAudit.orderer.status,'match');assert.equal(result.allMatch,true);
});

test('an exact sole given name needs no label or Gemini; absent, conflicting and abbreviated names stay blocked',async()=>{
 applyCatalog(catalog);
 for(const text of ['Bernard\nApaah SDA HC\nORS - 5','Apaah SDA HC\nORS - 5\nBernard']){
  let calls=0;
  const result=await runGeneralProductNameAudit(text,log('Bernard'),catalog,{semanticTimeoutMs:500},()=>{calls++;throw Error('Unnecessary Gemini');});
  assert.equal(calls,0);assert.equal(result.generalAudit.orderer.whatsappValue,'Bernard');assert.equal(result.allMatch,true);
 }
 for(const name of ['B','Bernad','Bernard\nMary','Patient: Bernard','Referring physician: Bernard','']){
  const result=await runGeneralProductNameAudit(`${name}\nApaah SDA HC\nORS - 5`,log('Bernard'),catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI');});
  assert.notEqual(result.generalAudit.orderer.status,'match',name);assert.equal(result.allMatch,false);
 }
});

test('customer label variants do not bypass conflicting named people or flag a repeated reordered name',async()=>{
 applyCatalog(catalog);
 for(const other of ['Mary Abena Odurowaa','Jane Mensah']){
  const result=await runGeneralProductNameAudit(`Name of Customer: Mary Abena Odurowaa\nCustomer name: ${other}\nApaah SDA HC\nORS - 5`,log('Odurowaa Mary Abena'),catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI');});
  assert.equal(result.allMatch,other==='Mary Abena Odurowaa');
 }
 const conflict=await runGeneralProductNameAudit('Name: Jane Mensah\nName of Customer: Mary Abena Odurowaa\nApaah SDA HC\nORS - 5',log('Odurowaa Mary Abena'),catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI');});
 assert.equal(conflict.allMatch,false);
 const result=await runGeneralProductNameAudit('Name of Customer: Mary Abena Odurowaa\nCustomer name: Odurowaa Mary Abena\nApaah SDA HC\nORS - 5',log('Abena Odurowaa Mary'),catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI');});
 assert.equal(result.allMatch,true);
});
