import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultProducts,applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyGeneralReviewConfirmation} from './generalReviewConfirmation';
import {generalReviewKey,reviewProductDrafts} from '../shared/generalReviewConfirmation';
import {createGeneralAuditRun,completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import {generalAccessoryChecks} from '../shared/generalAccessoryCatalog';
const seed=defaultProducts(),actor={id:'pipeline-cca',name:'CCA'};
const h='Name: Joseph Gumah\nFacility: Gbimsi CHPS\n';
async function run(a:string,b:string){const catalog={revision:77881,products:structuredClone(seed)};applyCatalog(catalog);const inputs={whatsappMessage:h+a,fulfillmentConfirmation:h+b};let calls=0;const result=await runGeneralProductNameAudit(inputs.whatsappMessage,inputs.fulfillmentConfirmation,catalog,{generalOnlySmartMatching:true,requestLanguage:true,deferProductResearch:true,semanticTimeoutMs:0},()=>{calls++;throw Error('No AI expected');});return {catalog,inputs,calls,record:{...result,...inputs,id:'pipeline-audit',createdByUserId:actor.id}};}
test('quantity confirmation uses the same accessory identities as initial website comparison',async()=>{
 const {record,catalog,calls}=await run('MR 3\nMen A 2\nRota 15\nOPV 2\nProduct: New Medicine XYZ 500mg\nQuantity: uncertain','Measles and Rubella Vaccine Diluent [3/3]\nMeasles & Rubella Vaccine [3/3]\nMen A Diluent [2/2]\nMen A [2/2]\nOPV Dropper [2/2]\nOPV [2/2]\nRota Dropper [15/15]\nRota [15/15]\nNew Medicine XYZ 500mg [1/1]');
 const review=record.generalAudit.semanticReviews.find(r=>r.source==='customer_request')!;assert.ok(review);assert.equal(calls,0);
 const decision={reviewKey:generalReviewKey(review),verified:true as const,products:reviewProductDrafts(record.items,review,record.generalAudit.extraction).map(p=>({...p,quantity:'1'}))};
 const updated=applyGeneralReviewConfirmation(record,decision,catalog,actor);
 assert.equal(updated.id,record.id);assert.equal(updated.allMatch,true,JSON.stringify(updated.items.map(i=>({name:i.name,status:i.status}))));
 assert.deepEqual(updated.generalAudit.discrepancies,[]);assert.ok(generalAccessoryChecks(updated.items,updated.generalAudit.generalAccessoryContext!).every(row=>row.status==='verified'));
 assert.equal(applyGeneralReviewConfirmation(updated,decision,catalog,actor),updated,'same-ID retries are idempotent');
});
test('current-engine publication recalculates a stale green headline from the actual quantity checks',async()=>{
 const {record,inputs}=await run('RDT 2','RDT [1/1]');assert.equal(record.allMatch,false);
 const stale={...record,allMatch:true,issueCount:0,status:'resolved',resolvedAt:'2026-11-04T00:00:00Z',resolutionNotes:'Order cleared',verdict:'NO DISCREPANCY'};
 const rendered=completeGeneralAuditRun(createGeneralAuditRun(inputs,1,{}, {},true),stale);
 assert.equal(rendered.allMatch,false);assert.equal(rendered.generalAudit.decision,'review');
 assert.equal(rendered.status,'pending');assert.equal(rendered.resolvedAt,null);assert.equal(rendered.resolutionNotes,'');
});
test('current-engine publication clears an obsolete red headline after all four comparisons pass',async()=>{
 const {record,inputs}=await run('RDT 2','RDT [2/2]');assert.equal(record.allMatch,true);
 const stale={...record,allMatch:false,issueCount:1,verdict:'DISCREPANCY DETECTED'};
 const rendered=completeGeneralAuditRun(createGeneralAuditRun(inputs,1,{}, {},true),stale);
 assert.equal(rendered.allMatch,true);assert.equal(rendered.issueCount,0);
});

test('structured projection preserves the original product text through final output',async()=>{
 const {extractGeneralStructuredPreview,applyGeneralExtractionSubmission,projectGeneralStructuredSource,finishGeneralStructuredAudit}=await import('./generalStructuredExtraction');
 const catalog={revision:77882,products:structuredClone(seed)};applyCatalog(catalog);
 const whatsappMessage=h+'1) PCM = 2',fulfillmentConfirmation=h+'- Paracetamol 500mg Tablet [2/2]';
 const preview=extractGeneralStructuredPreview(whatsappMessage,fulfillmentConfirmation,catalog);
 const extraction=applyGeneralExtractionSubmission(preview,{version:1,inputFingerprint:preview.inputFingerprint,catalogRevision:catalog.revision,edits:[],confirmedFields:[],reason:'',acknowledged:false},actor);
 const audited=await runGeneralProductNameAudit(projectGeneralStructuredSource(preview.customer,'customer'),projectGeneralStructuredSource(preview.fulfillment,'fulfillment'),catalog,{generalOnlySmartMatching:true,requestLanguage:true,deferProductResearch:true,semanticTimeoutMs:0},()=>{throw Error('No AI');});
 const result=finishGeneralStructuredAudit(audited,extraction);
 const source=result.items.flatMap(i=>i.provenance).find(p=>p.source==='customer_request')!;
 assert.equal(source.sourceOriginalText,preview.customer.products[0].originalText);
 assert.match(source.sourceOriginalText,/PCM = 2/);
});
