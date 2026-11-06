import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseHTML} from 'linkedom';
import {servedFacilityRecords} from './generalFacilityRecords';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog,defaultProducts} from './productCatalog';
import {applyIdentityDecision} from './generalIdentityDecision';
import {restoreGeneralIdentityDecisions} from '../src/utils/generalIdentityPersistence';
import {compareGeneralFacilities,generalFacilityDisplayStatus,verifyGeneralFacilityResult} from '../src/utils/generalFacility';
import {generalOrderRelevantText} from '../src/utils/generalTextClassification';
import {runGeneralAuditor,generalFourParameterRecord} from './generalAuditor';
import Details from '../src/components/GeneralAuditDetails';
import {buildGeneralReport} from '../extension/general-report.js';
const customer='Customer:John Bosompem\nDate: 03/11/26\nProduct: Metronidazole 5mg/mL injection, 100ml - 20\nLocation: Akanteng Health Centre';
const fulfillment='Thank you John Bosompem from Akanteng (West Akim) Health Center for ordering with Zipline. We have received your order (ID: Z4N87EXBMW)]. Use this link to track your order: https://orders.zipline.com/t/5/Z4N87EXBMW\nWe will now prepare the following items for delivery:\n- Metronidazole 5mg/mL Injection, 100mL [10/10]\nExpected delivery: between November 03, 2026 08:55 AM and November 03, 2026 10:55 AM. Let us know if any changes are required or contact +0800-719-102 if any questions\nYou will receive your flight notifications via SMS';
const actor={id:'cca',name:'CCA Test'};
function catalog(){const c={revision:1,products:defaultProducts()};applyCatalog(c);return c;}

test('actual Akanteng order resolves Location and verified district qualification without AI; quantity reduction remains separate',async()=>{
 const result=await runGeneralProductNameAudit(customer,fulfillment,catalog(),{facilityContext:{records:[...servedFacilityRecords]},semanticTimeoutMs:0},()=>{throw Error('Directory establishes the facility identity');});
 assert.equal(result.generalAudit.facility.status,'match',JSON.stringify(result.generalAudit.facility));
 assert.equal(result.generalAudit.facility.whatsappValue,'Akanteng Health Centre');
 assert.equal(result.generalAudit.facility.fulfillmentValue,'Akanteng (West Akim) Health Center');
 assert.equal(result.generalAudit.facility.verification,'records');assert.equal(result.generalAudit.orderer.status,'match');assert.equal(result.geminiMetrics.calls,0);
 assert.equal(result.items[0].fulfillment.requested,20);assert.equal(result.items[0].fulfillment.supplied,10);
 assert.equal(result.items[0].fulfillment.orderLimitEligible,true);assert.equal(result.allMatch,false);
 for(const html of [renderToStaticMarkup(createElement(Details,{details:result.generalAudit})),buildGeneralReport(result)])assert.doesNotMatch(html,/Facility Name Mismatch|Possible Facility Match Detected|facility name mismatch/i);
});
test('qualifier omission is supported by record geography, never by removing arbitrary parentheses',()=>{
 const records=[{id:'west',name:'Sample (West District) Health Centre',district:'West District',region:'Eastern',source:'test'}];
 const compare=(a:string,b:string,data=records)=>compareGeneralFacilities(a,b,`Facility: ${a}`,`Facility: ${b}`,{records:data});
 assert.equal(verifyGeneralFacilityResult(compare('Sample HC','Sample (West District) Health Centre')).status,'match');
 assert.notEqual(verifyGeneralFacilityResult(compare('Sample HC','Sample (East District) Health Centre')).status,'match');
 assert.notEqual(verifyGeneralFacilityResult(compare('Sample HC','Sample (Mission) Health Centre', [{...records[0],name:'Sample (Mission) Health Centre'}])).status,'match');
 const two=[...records,{id:'east',name:'Sample (East District) Health Centre',district:'East District',region:'Eastern',source:'test/east'}];
 assert.equal(compare('Sample (West District) Health Centre','Sample (East District) Health Centre',two).status,'mismatch');
 assert.equal(compare('Sample HC','Sample (West District) Health Centre',two).fulfillmentFacilityId,'west');
 const hospital=compareGeneralFacilities('Example Hospital','Example District Hospital','Facility: Example Hospital','Facility: Example District Hospital',{records:[{id:'hospital',name:'Example District Hospital',source:'directory'}]});
 assert.equal(verifyGeneralFacilityResult(hospital).status,'match');
});
test('a facility Location can be extracted, but cannot replace an explicit organisation or turn an address into a facility',()=>{
 assert.match(generalOrderRelevantText(customer),/Facility: Akanteng Health Centre/);
 const organisation='Hello, Order request from Good God Pet Shop\nLocation: Akyem Sekyere HC\nORS - 5';
 assert.doesNotMatch(generalOrderRelevantText(organisation),/Facility: Akyem/);
 for(const location of ['Near the health centre','Behind Akanteng Health Centre','House 4, West District','Delivery area: Akanteng HC'])assert.doesNotMatch(generalOrderRelevantText('Location: '+location),/Facility:/);
 assert.equal(runGeneralAuditor('Facility: Different HC\nLocation: Akanteng HC\nORS 5','Facility: Different HC\nORS [5/5]').generalAudit.facility.whatsappValue,'Different HC');
});
test('a directory spelling candidate must not masquerade as an approved alias or hide the confirmation buttons',()=>{
 const candidate=compareGeneralFacilities('Goldne HC','Golden HC','Facility: Goldne HC','Facility: Golden HC',{records:[{id:'gold',name:'Golden HC',source:'test'}]});
 const canonical=verifyGeneralFacilityResult(candidate);assert.equal(canonical.status,'review required');assert.equal(generalFacilityDisplayStatus(canonical),'review required');
 const base=runGeneralAuditor('Orderer: Mary Mensah\nFacility: Golden HC\nORS 5','Orderer: Mary Mensah\nFacility: Golden HC\nORS [5/5]');
 const record={...base,generalAudit:{...base.generalAudit,facility:candidate}};
 for(const html of [renderToStaticMarkup(createElement(Details,{details:record.generalAudit,onIdentityDecision:async()=>{}})),buildGeneralReport(record)]){
  const {document}=parseHTML(html);const card=[...document.querySelectorAll('article')].find(card=>card.textContent.includes('Possible Facility Match Detected'));
  assert.ok(card,'The pending facility must have inline controls in both interfaces');assert.match(card.textContent,/Awaiting CCA Confirmation/);assert.match(card.textContent,/Confirm Match/);
 }
});
function fresh(){catalog();const whatsappMessage='Orderer: Mary Mensah\nFacility: Goldne HC\nORS 5',fulfillmentConfirmation='Orderer: Mary Mensah\nFacility: Golden HC\nORS [5/5]';return {...runGeneralAuditor(whatsappMessage,fulfillmentConfirmation),id:'same-audit',whatsappMessage,fulfillmentConfirmation};}
for(const action of ['confirm','reject','reset'] as const)test(`same-audit refresh and re-audit preserve ${action} and decision history without new confirmation`,()=>{
 const original=fresh(),yes=applyIdentityDecision(original,'facility','confirm',actor);
 const saved=action==='confirm'?yes:applyIdentityDecision(yes,'facility',action,actor);
 const restored=restoreGeneralIdentityDecisions(fresh(),saved);
 assert.equal(restored.generalAudit.facility.identityDecision?.action,action);assert.deepEqual(restored.generalAudit.facility.identityHistory,saved.generalAudit.facility.identityHistory);
 assert.equal(restored.generalAudit.facility.status,action==='confirm'?'match':action==='reject'?'mismatch':'review required');
 assert.equal(generalFourParameterRecord(restored).allMatch,action==='confirm');assert.equal(JSON.stringify(restored.items),JSON.stringify(original.items));
});
test('saved approval never transfers to a new audit, changed inputs or changed identity values',()=>{
 const original=fresh(),saved=applyIdentityDecision(original,'facility','confirm',actor);
 for(const current of [{...fresh(),id:'new-order'},{...fresh(),whatsappMessage:original.whatsappMessage+'\nchange order'}, {...fresh(),generalAudit:{...fresh().generalAudit,facility:{...fresh().generalAudit.facility,whatsappValue:'Other HC'}}}]){
  assert.equal(restoreGeneralIdentityDecisions(current,saved).generalAudit.facility.identityDecision,undefined);
 }
 const newer=applyIdentityDecision(saved,'facility','reset',actor);
 assert.equal(restoreGeneralIdentityDecisions(newer,saved).generalAudit.facility.identityDecision?.action,'reset');
});
