import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {classifyGeneralText,generalOrderRelevantText} from '../src/utils/generalTextClassification';
import {recognizeGeneralDocument,isGeneralFormIntroduction} from '../src/utils/generalDocumentStructure';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {generalFourParameterRecord} from './generalAuditor';
import GeneralAuditDetails from '../src/components/GeneralAuditDetails';
import {buildGeneralReport} from '../extension/general-report.js';
const intro='Kindly specify the following information so we can process your request';
const customer='Name of Orderer: Ama Mensah\nFacility: Example HC\nProducts and Quantities:\nExample Medicine 500mg - 5';
const fulfillment='Thank you Ama Mensah from Example HC for ordering with Zipline. We will now prepare the following items for delivery:\n- Example Medicine 500mg [5/5]';
const catalog={revision:1,products:[]};
async function audit(text=customer,fs=fulfillment){
 let calls=0;
 const result=await runGeneralProductNameAudit(text,fs,catalog,{deferProductResearch:true,semanticTimeoutMs:0},()=>{calls++;throw Error('No AI needed for a form instruction');});
 return {record:{...result,id:'form-intro-regression',whatsappMessage:text,fulfillmentConfirmation:fs},calls};
}
for(const text of [intro,intro+':','Please provide the following details to process your order.',
 'Kindly complete the form below so that we can process your request',
 'To accurately process your request, kindly complete the below form:',
 'Please fill out the following form:', 'In order to properly process your order, please provide the following information']){
 test(`form introduction is administrative, never a product: ${text}`,()=>{
  assert.equal(isGeneralFormIntroduction(text),true);
  assert.equal(classifyGeneralText(text).category,'administrative');
  assert.equal(generalOrderRelevantText(text).trim(),'');
  assert.equal(recognizeGeneralDocument(text).lines[0].kind,'ADMINISTRATIVE_TEXT');
 });
}
test('screenshot introduction does not add a product review or prevent a directly matching audit',async()=>{
 const {record,calls}=await audit(intro+'\n'+customer);
 assert.equal(calls,0);assert.equal(record.allMatch,true);assert.equal(record.issueCount,0);
 assert.equal(record.generalAudit.productCount.requested,1);assert.equal(record.generalAudit.productCount.found,1);
 assert.deepEqual(record.generalAudit.semanticReviews,[]);
 for(const html of [renderToStaticMarkup(createElement(GeneralAuditDetails,{details:record.generalAudit,items:record.items,onConfirmReview:async()=>{}})),buildGeneralReport(record)]){
  assert.doesNotMatch(html,/PRODUCT IDENTIFICATION REVIEW|No product name could be read|data-confirm-source-review|Confirm Products &amp; Quantities/);
 }
});
test('stale template warnings are removed even when an older model required explicit confirmation',async()=>{
 const {record}=await audit();
 for(const requiresConfirmation of [false,true]){
  const stale={...record,allMatch:false,generalAudit:{...record.generalAudit,decision:'review' as const,semanticReviews:[{field:'products' as const,kind:'unparsed_text' as const,source:'customer_request' as const,originalText:intro,possibleMatches:[],reason:'Confirm the products and their quantities in this sentence.',requiresConfirmation}]}};
  const updated=generalFourParameterRecord(stale);
  assert.equal(updated.allMatch,true);assert.deepEqual(updated.generalAudit.semanticReviews,[]);
  assert.doesNotMatch(buildGeneralReport(stale),/No product name could be read|Confirm Products &amp; Quantities/);
 }
});
test('removing introductory text does not clear genuine quantity and product differences',async()=>{
 for(const fs of [fulfillment.replace('[5/5]','[7/7]'),fulfillment.replace('500mg','120mg'),fulfillment.replace('Example Medicine','Different Product')]){
  const {record}=await audit(intro+'\n'+customer,fs);
  assert.equal(record.allMatch,false);assert.ok(record.issueCount>0||record.generalAudit.decision==='review');
 }
});
test('a genuine unread product still retains an actionable source-specific confirmation',async()=>{
 const {record}=await audit(intro+'\nName of Orderer: Ama Mensah\nFacility: Example HC\nProduct: Example Medicine 500mg\nQuantity: unclear');
 assert.equal(record.allMatch,false);
 assert.ok(record.generalAudit.semanticReviews.some(review=>/Example Medicine/.test(review.originalText)));
 const html=renderToStaticMarkup(createElement(GeneralAuditDetails,{details:record.generalAudit,items:record.items,onConfirmReview:async()=>{}}));
 assert.match(html,/Customer requested.*Example Medicine 500mg/);
 assert.match(html,/Confirm Products &amp; Quantities/);
 assert.doesNotMatch(html,/Kindly specify the following information/);
});
test('form wording never suppresses appended product or identity amendments',()=>{
 for(const text of [intro+': add Example Medicine 500mg - 3',intro+'; change the quantity to 7',
  intro+'. Change the facility to Different HC.', 'Please provide the following medicines: ASV 2 vials',
  'Kindly specify the following information so we can process your request for Artesunate 120mg - 3']){
  assert.equal(isGeneralFormIntroduction(text),false);
  assert.notEqual(classifyGeneralText(text).category,'administrative');
  assert.ok(generalOrderRelevantText(text).trim());
 }
});
test('a real product instruction after the form sentence remains independently extractable',async()=>{
 const {record}=await audit(intro+'.\n'+customer);
 assert.equal(record.allMatch,true);
 assert.equal(record.items[0].fulfillment.requested,5);
 assert.equal(record.items[0].fulfillment.supplied,5);
});
