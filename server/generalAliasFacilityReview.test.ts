import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {generalFourParameterRecord,reconcileGeneralProductReviews} from './generalAuditor';
import {compareGeneralFacilities,generalFacilityNameWordsSimilar} from '../src/utils/generalFacility';
import {suggestGeneralFacility} from './generalFacilitySuggestion';
import type {ProductCatalog} from '../shared/productCatalog';
import type {GeneralSemanticReview} from '../src/utils/generalAuditTypes';

const catalog:ProductCatalog={revision:9700,products:[{id:'pcm',name:'Paracetamol 500mg Tablet',scope:'general',category:'medicine',aliases:['Feverhelper'],contextualAliases:[],note:''}]};
const header='Name: Mary Mensah\nFacility: Example HC\n';
const noAI=()=>{throw Error('Approved identity needs no Gemini request');};
async function approved(){applyCatalog(catalog);return runGeneralProductNameAudit(header+'Feverhelper 5',header+'Paracetamol 500mg Tablet [5/5]',catalog,{semanticTimeoutMs:0},noAI);}
for(const kind of ['product','unparsed_text'] as const)test(`approved aliases remove stale ${kind} ambiguity in website and built extension`,async()=>{
 const record=await approved();
 const stale:GeneralSemanticReview={kind,field:'products',source:'customer_request',originalText:'Feverhelper 5',requiresConfirmation:true,possibleMatches:[],reason:'Confirm the product identity.'};
 const input={...record,generalAudit:{...record.generalAudit,semanticReviews:[stale]}};
 const {generalFourParameterRecord:extensionRebuild}=await import('../extension/general-auditor.js');
 for(const rebuild of [generalFourParameterRecord,extensionRebuild]){
  const rebuilt=rebuild(input);assert.equal(rebuilt.allMatch,true);assert.equal(rebuilt.generalAudit.semanticReviews?.length,0);
  assert.equal(rebuilt.generalAudit.auditSummary?.reviewRequiredCount||0,0);
 }
});

test('alias identity clearance retains quantity, formulation, unrelated text and unapproved suggestions',async()=>{
 const record=await approved();
 const review:GeneralSemanticReview={kind:'unparsed_text',field:'products',source:'customer_request',originalText:'Feverhelper 5',requiresConfirmation:true,possibleMatches:[],reason:'Confirm product'};
 for(const protectedReview of [{...review,field:'quantity' as const},{...review,dosageFormKey:'formulation-confirmation'},{...review,originalText:'Otherproduct 5'},{...review,originalText:'Feverhelper 5\nOtherproduct 3'},{...review,originalText:'Feverhelper 5 and change quantity to 6'}]){
  assert.equal(reconcileGeneralProductReviews(record.items,[protectedReview]).length,1);
 }
 const unapproved=structuredClone(record.items);for(const item of unapproved)for(const p of item.provenance)delete p.catalogMatchMethod;
 assert.equal(reconcileGeneralProductReviews(unapproved,[review]).length,1);
 const conflicting=structuredClone(record.items);conflicting[0].fulfillment.identityError='Stated strength conflicts';
 assert.equal(reconcileGeneralProductReviews(conflicting,[review]).length,1);
});

test('the same facility words with a single minor typo match without Gemini, independent of arrangement',async()=>{
 assert.equal(generalFacilityNameWordsSimilar('North Ridge Health Centre','Ridg North HC'),false,'Very short words do not receive a fuzzy identity');
 for(const [a,b] of [['North Ridge Health Centre','Ridge North HC'],['Golden Valley Health Centre','Valley Goldne HC']]){
  assert.equal(generalFacilityNameWordsSimilar(a,b),true);
  const compared=compareGeneralFacilities(a,b,`Facility: ${a}`,`Facility: ${b}`);
  assert.equal(compared.status,'match');
  assert.equal(await suggestGeneralFacility(compared,{semanticTimeoutMs:1000},noAI),compared);
 }
 for(const [a,b] of [['Example East HC','Example West HC'],['Example 1 HC','Example 2 HC'],['Example North HC','Example North North HC']])assert.equal(generalFacilityNameWordsSimilar(a,b),false);
});

test('similar words permit a Gemini suggestion when wording remains uncertain, without clearing the facility',async()=>{
 const customer='Goldne HC',fulfillment='Golden Clinic';
 const facility=compareGeneralFacilities(customer,fulfillment,`Facility: ${customer}`,`Facility: ${fulfillment}`);
 assert.equal(facility.status,'mismatch');let calls=0;
 const result=await suggestGeneralFacility(facility,{semanticTimeoutMs:1000},()=>({models:{async generateContent(input:any){calls++;
  const contents=JSON.parse(input.contents);assert.equal(contents.nameComparison.allNameWordsSameOrSimilar,true);
  return {text:JSON.stringify({possibleMatch:true,confidence:.99,reason:'Locality words agree after a minor spelling difference; confirm the facility record.'})};
 }}}));
 assert.equal(calls,1);assert.equal(result.status,facility.status);assert.equal(result.aiSuggestion?.customer,customer);
 for(const conflict of [{...facility,customerFacilityId:'one',fulfillmentFacilityId:'two'},compareGeneralFacilities('Example 1 HC','Example 2 Clinic','Facility: Example 1 HC','Facility: Example 2 Clinic')]){
  const before=calls;await suggestGeneralFacility(conflict,{semanticTimeoutMs:1000},()=>{calls++;return {};});assert.equal(calls,before);
 }
});
