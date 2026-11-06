import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {runGeneralAuditor} from './generalAuditor';
import {buildGeneralReport} from '../extension/general-report.js';
import {createGeneralAuditRun,completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import type {ProductCatalog} from '../shared/productCatalog';
const catalog:ProductCatalog={revision:950,products:[{id:'ors',name:'Oral Rehydration Salts',scope:'general',category:'medicine',aliases:['ORS'],contextualAliases:[],note:''}]};
const context={records:[{id:'saint-mary',name:'Saint Mary Health Centre',verifiedAliases:['SM Outreach'],source:'test/saint-mary'},{id:'other',name:'Other Health Centre',source:'test/other'}]};
const log='Thank you Mary Mensah from Saint Mary HC for ordering with Zipline.\nOral Rehydration Salts [5/5]';
for(const label of ['Name of Facility:','Name of the Facility:','Name of the Health Facility:','Health Facility name:','Facility’s name:','Name of the Facility','Name of the Facility:\n'])test(`facility label variant: ${JSON.stringify(label)}`,async()=>{
 applyCatalog(catalog);let calls=0;
 const text=`Name of Customer: Mary Mensah\n${label} Saint Mary Health Centre\nORS - 5`;
 const result=await runGeneralProductNameAudit(text,log,catalog,{facilityContext:context,semanticTimeoutMs:500},()=>{calls++;throw Error('Known facility needs no AI');});
 assert.equal(calls,0);assert.equal(result.generalAudit.facility.status,'match',JSON.stringify(result.generalAudit));assert.equal(result.allMatch,true);
 assert.equal(result.generalAudit.facility.customerFacilityId,'saint-mary');
});
for(const text of [
 'Mary Mensah\nSaint Mary Health Centre\nORS - 5',
 'Mary Mensah\nORS - 5\nSaint Mary HC',
 'Mary Mensah from Saint Mary Health Center\nORS - 5',
 'Name: Mary Mensah\nORS - 5\nSaint Mary H.C.',
 'Name: Mary Mensah\nMary Saint H.C.\nORS - 5',
 'Name: Mary Mensah\nSM Outreach\nORS - 5',
])test(`unlabelled facility: ${text.replaceAll('\n',' / ')}`,async()=>{
 applyCatalog(catalog);let calls=0;
 const result=await runGeneralProductNameAudit(text,log,catalog,{facilityContext:context,semanticTimeoutMs:500},()=>{calls++;throw Error('Known source facility needs no AI');});
 assert.equal(calls,0);assert.equal(result.generalAudit.facility.status,'match',JSON.stringify(result.generalAudit));assert.equal(result.allMatch,true);
 const record=completeGeneralAuditRun(createGeneralAuditRun({whatsappMessage:text,fulfillmentConfirmation:log},1,{}, {},true),JSON.parse(JSON.stringify({...result,whatsappMessage:text,fulfillmentConfirmation:log})));
 assert.equal(record.allMatch,true);assert.match(buildGeneralReport(record),/ORDER CONFIRMED/);
});

test('facility detection never borrows an absent facility or changes a genuine mismatch into clearance',async()=>{
 applyCatalog(catalog);
 for(const facility of ['', 'Other HC','Saint Mary Hospital','Saint Mary HC\nOther HC']){
  const result=await runGeneralProductNameAudit(`Name: Mary Mensah\n${facility}\nORS - 5`,log,catalog,{facilityContext:context,semanticTimeoutMs:0},()=>{throw Error('No AI');});
  assert.equal(result.allMatch,false,facility);assert.notEqual(result.generalAudit.facility.status,'match',facility);
 }
 // An ID and an optional delivery address cannot be used as the facility's name.
 const result=runGeneralAuditor('Name: Mary Mensah\nFacility ID: saint-mary\nORS - 5',log);
 assert.notEqual(result.generalAudit.facility.status,'match');
 const quantity=await runGeneralProductNameAudit('Mary Mensah\nSaint Mary HC\nORS - 9',log,catalog,{facilityContext:context,semanticTimeoutMs:0},()=>{throw Error('No AI');});
 assert.equal(quantity.generalAudit.facility.status,'match');assert.equal(quantity.allMatch,false);
});


test('explicit facility names outrank a delivery site but conflicting facility labels stay blocked',async()=>{
 applyCatalog(catalog);
 const source='Name: Mary Mensah\nName of the Health Facility: Saint Mary HC\nDrop area: Other Health Centre\nORS - 5';
 const valid=await runGeneralProductNameAudit(source,log,catalog,{facilityContext:context,semanticTimeoutMs:0},()=>{throw Error('No AI');});
 assert.equal(valid.allMatch,true);
 for(const other of ['Other HC','Saint Mary Health Centre']){
  const text=`Name: Mary Mensah\nName of the Health Facility: Saint Mary HC\nFacility’s name: ${other}\nORS - 5`;
  const result=await runGeneralProductNameAudit(text,log,catalog,{facilityContext:context,semanticTimeoutMs:0},()=>{throw Error('No AI');});
  assert.equal(result.allMatch,other==='Saint Mary Health Centre');
  const shared=runGeneralAuditor(text,log,{}, {facilityContext:context});assert.equal(shared.generalAudit.facility.status==='match',other==='Saint Mary Health Centre');
 }
});
