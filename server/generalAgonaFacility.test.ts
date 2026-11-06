import test from 'node:test';
import assert from 'node:assert/strict';
import {compareGeneralFacilities,findGeneralFacilityNames} from '../src/utils/generalFacility';
import {servedFacilityRecords} from './generalFacilityRecords';
import {suggestGeneralFacility} from './generalFacilitySuggestion';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import {buildGeneralReport} from '../extension/general-report.js';
const customer='Agona Swedru Municipal Hospital', fs='Agona West Municipal HSP (CR)';
const compare=(a=customer,b=fs,records:any[]=[])=>(compareGeneralFacilities(a,b,`Facility: ${a}`,`Facility: ${b}`,{records}));

test('confirmed Agona aliases match HSP and word-order formatting with the real served directory',()=>{
 for(const records of [[],[...servedFacilityRecords]])for(const a of [customer,'AGONA SWEDRU MUNICIPAL HOSPITAL','Municipal Hospital Agona Swedru'])for(const b of [fs,'Agona West Municipal Hospital (CR)','Agona West Municipal Hospital']) {
  const result=compare(a,b,records);assert.equal(result.status,'match',`${a} / ${b}`);
  if(records.length)assert.equal(result.verification,'records');
 }
 assert.deepEqual(findGeneralFacilityNames(`Thank you Mary Mensah from ${fs} for ordering with Zipline.`),[fs]);
});

test('a confirmed alternate town/municipal name never overrides different official IDs or unrelated facilities',()=>{
 for(const b of ['Agona East Municipal HSP (CR)','Agona Swedru RCH-CR','Agona West Health Centre','Another Municipal Hospital'])assert.notEqual(compare(customer,b).status,'match');
 const records=[{id:'a',name:customer,source:'a'},{id:'b',name:fs,source:'b'}];
 assert.equal(compare(customer,fs,records).status,'mismatch');
 assert.equal(compareGeneralFacilities(customer,fs,`Facility: ${customer}\nFacility ID: a`,`Facility: ${fs}\nFacility ID: b`).status,'mismatch');
});

test('both audit interfaces clear the approved facility name and keep genuine customer differences',async()=>{
 const catalog={revision:1,products:[{id:'ors',name:'Oral Rehydration Salts',scope:'general' as const,category:'medicine' as const,aliases:['ORS'],contextualAliases:[],note:''}]};applyCatalog(catalog);
 const request=`Orderer: Evelyn Ofori Adofo\nFacility: ${customer}\nORS - 4`;
 const fulfillment=`Thank you Evelyn Ofori Adofo from ${fs} for ordering with Zipline.\nCurrently out of stock:\n- Oral Rehydration Salts [0/1]`;
 const noAI=()=>{throw Error('Verified facilities need no AI call');};
 const result=await runGeneralProductNameAudit(request,fulfillment,catalog,{facilityContext:{records:[...servedFacilityRecords]},semanticTimeoutMs:0},noAI);
 assert.equal(result.generalAudit.facility.status,'match');assert.equal(result.allMatch,true);
 assert.doesNotMatch(buildGeneralReport(result),/Facility name mismatch/i);
 const differing=await runGeneralProductNameAudit(request,fulfillment.replace('Evelyn Ofori','Evelyn Owusu'),catalog,{semanticTimeoutMs:0},noAI);
 assert.equal(differing.generalAudit.facility.status,'match');assert.equal(differing.generalAudit.orderer.status,'mismatch');assert.equal(differing.allMatch,false);
});

test('Gemini can suggest alternate hospital names with directory evidence but cannot approve an unverified equivalence',async()=>{
 const original={...compare('Example Central Hospital','Example West Municipal Hospital'),status:'mismatch' as const};
 let calls=0;
 const client={models:{async generateContent(request:any){calls++;assert.match(request.config.systemInstruction,/directory evidence/);assert.ok(Array.isArray(JSON.parse(request.contents).directoryEvidence));return {text:JSON.stringify({possibleMatch:true,confidence:.99,reason:'Possible alternate hospital name; authoritative verification is needed.'})};}}};
 const result=await suggestGeneralFacility(original,{semanticTimeoutMs:1000},()=>client);
 assert.equal(calls,1);assert.equal(result.status,'mismatch');assert.equal(result.aiSuggestion?.confidence,.99);
});
