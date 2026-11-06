import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {compareGeneralFacilities,findGeneralFacilityNames} from '../src/utils/generalFacility';
import {suggestGeneralFacility} from './generalFacilitySuggestion';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {createGeneralAuditRun,completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import Details from '../src/components/GeneralAuditDetails';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog} from '../shared/productCatalog';
const compare=(left:string,right:string,records:any[]=[])=>compareGeneralFacilities(left,right,`Facility: ${left}`,`Facility: ${right}`,{records});
const catalog:ProductCatalog={revision:801,products:[{id:'ors',name:'Oral Rehydration Salts',scope:'general',category:'medicine',aliases:['ORS'],contextualAliases:[],note:''}]};

test('approved Apaah names match word order and HC wording while preserving affiliation and locality',()=>{
 for(const pair of [['Apaah SDA HC','SDA Clinic Apaah'],['SDA Clinic Apaah','Apaah SDA HC'],['S.D.A. Clinic Apaah','SDA Apaah Health Centre'],['Apaah SDA Health Center','Apaah SDA Clinic']]){
  assert.equal(compare(...pair as [string,string]).status,'match',pair.join(' / '));
 }
 assert.deepEqual(findGeneralFacilityNames('Thank you Mary Mensah from SDA Clinic Apaah for ordering with Zipline.'),['SDA Clinic Apaah']);
 assert.deepEqual(findGeneralFacilityNames('SDA Clinic Apaah'),['SDA Clinic Apaah']);
 for(const name of ['Apaah Methodist HC','Other SDA HC','Apaah SDA Hospital'])assert.notEqual(compare(name,'SDA Clinic Apaah').status,'match');
 assert.equal(compare('Other HC','Other Clinic').status,'mismatch');
 assert.equal(compare('Alpha SDA HC','SDA Alpha Health Centre').status,'match');
});

test('approved name mappings respect official record conflicts and do not invent IDs',()=>{
 const a={id:'official-a',name:'Apaah SDA HC',source:'test/a'},b={id:'official-b',name:'SDA Clinic Apaah',source:'test/b'};
 assert.equal(compare(a.name,b.name,[a,b]).status,'mismatch');
 const single=compare(a.name,b.name,[b]);assert.equal(single.status,'match');assert.equal(single.fulfillmentFacilityId,'official-b');
 const namesOnly=compare(a.name,b.name);assert.equal(namesOnly.fulfillmentFacilityId,undefined);
 const explicit=compareGeneralFacilities(a.name,b.name,'Facility: Apaah SDA HC\nFacility ID: one','Facility: SDA Clinic Apaah\nFacility ID: two');
 assert.equal(explicit.status,'mismatch');
});

test('main auditor and extension use approved facility alias without a Gemini call',async()=>{
 applyCatalog(catalog);let calls=0;
 const inputs={whatsappMessage:'Orderer: Mary Mensah\nApaah SDA HC\nORS - 5',fulfillmentConfirmation:'Thank you Mary Mensah from SDA Clinic Apaah for ordering with Zipline.\n- Oral Rehydration Salts [5/5]'};
 const result=await runGeneralProductNameAudit(inputs.whatsappMessage,inputs.fulfillmentConfirmation,catalog,{semanticTimeoutMs:500},()=>{calls++;throw Error('Known alias requires no AI');});
 assert.equal(calls,0);assert.equal(result.generalAudit.facility.status,'match');assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));
 const record=completeGeneralAuditRun(createGeneralAuditRun(inputs,1,{}, {},true),JSON.parse(JSON.stringify({...result,...inputs})));
 assert.equal(record.allMatch,true);
 assert.doesNotMatch(buildGeneralReport(record),/Facility Name Mismatch/);
});

test('Gemini suggestion is shown in both interfaces without changing a discrepancy or approving an alias',async()=>{
 const original=compare('Example SDA HC','SDA Clinic Example');let calls=0;
 const client={models:{async generateContent(){calls++;return {text:JSON.stringify({possibleMatch:true,confidence:.99,reason:'Locality and organisation agree; the wording differs.'})};}}};
 const suggested=await suggestGeneralFacility(original,{semanticTimeoutMs:500},()=>client);
 assert.equal(calls,1);assert.equal(suggested.status,original.status);assert.equal(original.aiSuggestion,undefined);
 assert.equal(suggested.aiSuggestion?.fulfillment,'SDA Clinic Example');
 applyCatalog(catalog);const result=await runGeneralProductNameAudit('Orderer: Mary Mensah\nFacility: Apaah SDA HC\nORS - 5','Orderer: Mary Mensah\nFacility: SDA Clinic Apaah\nOral Rehydration Salts [5/5]',catalog,{semanticTimeoutMs:0},()=>client);
 result.generalAudit.facility=suggested;
 for(const html of [renderToStaticMarkup(createElement(Details,{details:result.generalAudit})),buildGeneralReport(result)])assert.match(html,/Possible Facility Match Detected/);
});

test('missing data, clear conflicts, provider failures and low-confidence guesses never clear facility checks',async()=>{
 let calls=0;const original=compare('Example SDA HC','SDA Clinic Example');
 const unavailable={models:{async generateContent(){calls++;throw Object.assign(Error('Unavailable'),{status:503});}}};
 assert.equal(await suggestGeneralFacility(original,{semanticTimeoutMs:500},()=>unavailable),original);
 const low={models:{async generateContent(){return{text:JSON.stringify({possibleMatch:true,confidence:.6,reason:'Uncertain'})};}}};
 assert.equal(await suggestGeneralFacility(original,{semanticTimeoutMs:500},()=>low),original);
 const before=calls;
 for(const facility of [compare('Apaah SDA HC','SDA Clinic Apaah'),compare('Other HC','Another Clinic'),{...original,customerFacilityId:'one',fulfillmentFacilityId:'two'}]){
  assert.equal(await suggestGeneralFacility(facility,{semanticTimeoutMs:500},()=>{calls++;return unavailable;}),facility);
 }
 assert.equal(calls,before);
});


test('catalogue-first audit attaches an uncertain facility suggestion without suppressing quantity discrepancies',async()=>{
 applyCatalog(catalog);let calls=0;
 const client={models:{async generateContent(){calls++;return{text:JSON.stringify({possibleMatch:true,confidence:.99,reason:'The locality and organisation match; directory confirmation is needed.'})};}}};
 const result=await runGeneralProductNameAudit('Orderer: Mary Mensah\nFacility: Example SDA HC\nORS - 5','Orderer: Mary Mensah\nFacility: SDA Clinic Example\nOral Rehydration Salts [6/6]',catalog,{semanticTimeoutMs:500},()=>client);
 assert.equal(calls,1);assert.equal(result.generalAudit.facility.aiSuggestion?.customer,'Example SDA HC');
 assert.equal(result.allMatch,false);assert.ok(result.items.some(item=>item.status==='quantity mismatch'));
 assert.equal(result.geminiMetrics.calls,1);assert.equal(result.geminiMetrics.necessary,true);
});
