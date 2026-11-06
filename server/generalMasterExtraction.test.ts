import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {recoverGeneralOrderer} from './generalOrdererExtraction';
import {extractGeneralInput} from './generalAuditor';
const catalog={revision:1,products:[]};
const fs=(name='Osman Ishak')=>`Thank you ${name} from Chiana HC for ordering with Zipline. We will now prepare the following items for delivery:\n- New Medicine XYZ 500mg [20/20]`;
const context={records:[{id:'chiana',name:'Chiana Health Centre',verifiedAliases:['Chiana HC'],district:'Test District',source:'test'}]};
const order='\nFacility: Chiana HC\nNew Medicine XYZ 500mg - 20';
async function audit(customer:string,fulfillment=fs(),extra:any={}){let calls=0;const record=await runGeneralProductNameAudit(customer,fulfillment,catalog,{generalOnlySmartMatching:true,facilityContext:context,deferProductResearch:true,semanticTimeoutMs:0,...extra},()=>{calls++;throw Error('No AI for clear source evidence');});return {record,calls};}
test('phase 1: name-only customer message is compared without inventing other required fields',async()=>{
 const {record,calls}=await audit('Osman Ishak');
 assert.equal(record.generalAudit.orderer.whatsappValue,'Osman Ishak');assert.equal(record.generalAudit.orderer.fulfillmentValue,'Osman Ishak');assert.equal(record.generalAudit.orderer.status,'match');assert.equal(calls,0);
 assert.equal(record.generalAudit.ordererExtraction?.method,'FS-assisted source search');
 assert.equal(record.allMatch,false);assert.equal(record.generalAudit.productCount.requested,0);assert.equal(record.generalAudit.facility.whatsappValue,'N/A');
});
for(const name of ['Osman Ishak','Ishak Osman','OSMAN   ISHAK','Mr Osman Ishak'])test(`phase 1: standalone source name ${name}`,async()=>{
 const {record,calls}=await audit(name+order);assert.equal(record.generalAudit.orderer.status,'match');assert.equal(record.allMatch,true);assert.equal(calls,0);
});
for(const label of ['Name of Orderer:','Orderer:','Name:','Requested by:'])test(`phase 1: labelled source name ${label}`,async()=>{
 const {record,calls}=await audit(label+' Osman Ishak'+order);assert.equal(record.generalAudit.orderer.status,'match');assert.equal(calls,0);
});
test('phase 1: existing narrative and standard FS parsing retain their separate fields',async()=>{
 const {record,calls}=await audit('This is Osman Ishak from Chiana HC. Please send 20 New Medicine XYZ 500mg.');
 assert.equal(record.generalAudit.orderer.whatsappValue,'Osman Ishak');assert.equal(record.generalAudit.facility.fulfillmentValue,'Chiana HC');assert.equal(calls,0);
});
test('phase 1: multiple people are ownership uncertainty, not a missing name or automatic match',async()=>{
 const {record}=await audit('Osman Ishak\nAli Karim'+order);
 assert.equal(record.generalAudit.orderer.status,'review required');assert.equal(record.generalAudit.ordererExtraction?.status,'needs confirmation');assert.equal(record.allMatch,false);
 assert.deepEqual(record.generalAudit.ordererExtraction?.candidates,['Osman Ishak','Ali Karim']);assert.match(record.generalAudit.orderer.reason!,/Several possible people/);
});
for(const text of ['Patient: Osman Ishak','Patient:\nOsman Ishak','Contact: Osman Ishak','Name and Contact of referring Physician: Osman Ishak','Please ask Osman Ishak to collect the order'])test(`phase 1: incidental person does not supply orderer: ${text}`,async()=>{
 const {record}=await audit(text+order);assert.equal(record.generalAudit.orderer.whatsappValue,'N/A');assert.equal(record.generalAudit.ordererExtraction?.status,'not detected');assert.equal(record.allMatch,false);
});
test('phase 1: known district, facility and product lines are not orderer names',()=>{
 for(const text of ['Test District','Chiana Health Centre','New Medicine XYZ 500mg']){
  const extracted=recoverGeneralOrderer(text,fs(),catalog,{facilityContext:context});assert.equal(extracted.value,null);
 }
});
test('phase 1: mismatching names remain independent of matching products',async()=>{
 const {record,calls}=await audit('Emmanuel Adomako'+order);assert.equal(record.generalAudit.orderer.status,'mismatch');assert.equal(record.items[0].status,'match');assert.equal(calls,0);assert.equal(record.allMatch,false);
});
test('phase 1: scope guard leaves legacy companion extraction unchanged',async()=>{
 const before=extractGeneralInput('Osman Ishak','customer_request');
 assert.equal(before.ordererName,'N/A');
 const {record}=await audit('Osman Ishak',fs(),{generalOnlySmartMatching:false});
 assert.equal(record.generalAudit.orderer.whatsappValue,'N/A');assert.equal(record.generalAudit.ordererExtraction,undefined);
 assert.deepEqual(extractGeneralInput('Osman Ishak','customer_request'),before);
});
for(const [a,b,status] of [
 ['Osman Ishak','Ishak Osman','match'],
 ['Osman Ishak','Osman Ishaak','review required'],
 ['Osman Ishak Mensah','Mensah Ishak Osman','match'],
 ['Osman Ishak','Emmanuel Adomako','mismatch'],
 ['Osman','Osman Ishak','review required'],
 ['Osman Ishak','Osman Kwame Ishak','review required'],
] as const)test(`phase 2: scoped General name comparison ${a} / ${b}`,async()=>{
 const {record,calls}=await audit('Orderer: '+a+order,fs(b),{generalOnlySmartMatching:true});
 assert.equal(record.generalAudit.orderer.status,status);assert.equal(calls,0);
});
test('phase 2: companion short-name behavior is preserved',async()=>{
 const {record}=await audit('Orderer: Osman'+order,fs(),{generalOnlySmartMatching:false});
 const legacy=await audit('Orderer: Osman'+order,fs(),{generalOnlySmartMatching:undefined});
 assert.deepEqual(record.generalAudit.orderer,legacy.record.generalAudit.orderer);
});
