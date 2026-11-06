import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyGeneralReviewConfirmation,generalReviewConfirmationHandler} from './generalReviewConfirmation';
import {generalReviewKey,reviewProductDrafts,confirmGeneralReview} from '../shared/generalReviewConfirmation';
import {generalInputFingerprint} from '../shared/generalAuditFingerprint';
import {completeGeneralAuditRun,createGeneralAuditRun} from '../src/utils/generalAuditRun';
import GeneralAuditDetails from '../src/components/GeneralAuditDetails';
import {applyGeneralOrderLimitDecision} from './generalAuditor';
import type {ProductCatalog} from '../shared/productCatalog';
import {generalReviewEvidence} from '../src/utils/generalAuditReviews';
const catalog:ProductCatalog={revision:1,products:[]};
const actor={id:'cca-review',name:'CCA Example'};
async function fixture(extraCustomer='',extraFs=''){
 const whatsappMessage='Name: Ama Mensah\nFacility: Alpha HC\nProduct: New Medicine XYZ 500mg\nQuantity: uncertain'+extraCustomer;
 const fulfillmentConfirmation='Thank you Ama Mensah from Alpha HC for ordering. We will now prepare the following items for delivery:\n- New Medicine XYZ 500mg [5/5]'+extraFs;
 const result=await runGeneralProductNameAudit(whatsappMessage,fulfillmentConfirmation,catalog,{deferProductResearch:true,semanticTimeoutMs:0},()=>{throw Error('No AI calls expected');});
 return {...result,id:'review-audit',createdByUserId:actor.id,whatsappMessage,fulfillmentConfirmation};
}
function decision(record:any,quantity='5'){
 const review=record.generalAudit.semanticReviews.find((r:any)=>r.source==='customer_request');
 const products=reviewProductDrafts(record.items,review).map(p=>({...p,quantity}));
 return {reviewKey:generalReviewKey(review),products,verified:true as const};
}
test('actual source extraction review has inline fields and a confirmation button',async()=>{
 const record=await fixture();
 const html=renderToStaticMarkup(createElement(GeneralAuditDetails,{details:record.generalAudit,items:record.items,onConfirmReview:async()=>{}}));
 assert.match(html,/Confirm Products &amp; Quantities/);
 assert.match(html,/Review product 1 quantity/);
 assert.match(html,/I have verified these products and quantities against the source message/);
 assert.match(html,/<button[^>]*disabled=""[^>]*>Confirm Products/);
 assert.doesNotMatch(html,/<input[^>]*aria-label="Review product 1 name"/);
 assert.match(html,/Customer requested.*New Medicine XYZ 500mg/);
});
test('wrapped review wording picks the existing customer product and leaves its unclear count blank',async()=>{
 const record=await fixture(),review={...record.generalAudit.semanticReviews[0],originalText:'Please verify the requested New Medicine XYZ 500mg before dispatch.'};
 const rows=reviewProductDrafts(record.items,review,record.generalAudit.extraction);
 assert.equal(rows.length,1);assert.equal(rows[0].name,'New Medicine XYZ 500mg');assert.equal(rows[0].quantity,'');
 assert.notEqual(rows[0].line,null);
});
test('unlinked source review reuses the customer view and confirms without typing a name',async()=>{
 const record=await fixture();
 record.items=record.items.map(item=>({...item,provenance:item.provenance.filter(p=>p.source!=='customer_request')}));
 record.generalAudit.extraction!.customer.products=[{name:'New Medicine XYZ 500mg',quantity:null,unit:null}];
 const review=record.generalAudit.semanticReviews[0],rows=reviewProductDrafts(record.items,review,record.generalAudit.extraction);
 assert.equal(rows[0].name,'New Medicine XYZ 500mg');assert.equal(rows[0].quantity,'');assert.equal(rows[0].line,null);
 const html=renderToStaticMarkup(createElement(GeneralAuditDetails,{details:record.generalAudit,items:record.items,onConfirmReview:async()=>{}}));
 assert.match(html,/Customer requested.*New Medicine XYZ 500mg/);
 assert.doesNotMatch(html,/<input[^>]*aria-label="Review product 1 name"|Add another product from this text/);
 const updated=applyGeneralReviewConfirmation(record,{reviewKey:generalReviewKey(review),products:rows.map(row=>({...row,quantity:'5'})),verified:true},catalog,actor);
 assert.equal(updated.allMatch,true);
});
test('labelled customer product without a parsed entry supplies its name, never the FS quantity',()=>{
 const review={field:'products' as const,source:'customer_request' as const,originalText:'Product: Folic acid',possibleMatches:[],reason:'Confirm product and quantity.'};
 const rows=reviewProductDrafts([],review);
 assert.equal(rows[0]?.name,'Folic acid');assert.equal(rows[0].quantity,'');
});
test('automatic name selection keeps distinct strengths as separate source rows',async()=>{
 const record=await fixture();
 const first=record.items[0].provenance.find(p=>p.source==='customer_request')!;
 const second={...first,name:'New Medicine XYZ 120mg',originalText:'New Medicine XYZ 120mg',line:6};
 const rows=reviewProductDrafts([{provenance:[first,second]}],{...record.generalAudit.semanticReviews[0],originalText:'Check New Medicine XYZ 500mg and New Medicine XYZ 120mg.'});
 assert.deepEqual(rows.map(row=>row.name),['New Medicine XYZ 500mg','New Medicine XYZ 120mg']);
});
test('unread source never copies the other side or invents a product name',()=>{
 const review={field:'products' as const,source:'customer_request' as const,originalText:'Please confirm products from the attached note',possibleMatches:[],reason:'Confirm products.'};
 const extraction={customer:{facilityName:null,ordererName:null,products:[],unresolvedFields:['products']},fulfillment:{facilityName:null,ordererName:null,products:[{name:'FS-only product 500mg',quantity:10,unit:null}],unresolvedFields:[]}};
 assert.deepEqual(reviewProductDrafts([],review,extraction),[]);
});
test('server rejects a typed substitute for an automatically picked source name',async()=>{
 const record=await fixture();
 record.items=record.items.map(item=>({...item,provenance:item.provenance.filter(p=>p.source!=='customer_request')}));
 record.generalAudit.extraction!.customer.products=[{name:'New Medicine XYZ 500mg',quantity:null,unit:null}];
 const review=record.generalAudit.semanticReviews[0];
 assert.throws(()=>applyGeneralReviewConfirmation(record,{reviewKey:generalReviewKey(review),products:[{line:null,name:'Another product 120mg',quantity:'5',unit:'',confirmationRequested:''}],verified:true},catalog,actor),/picked from the source/);
});
test('extension also displays the customer-view name without a product-name input',async()=>{
 const {buildGeneralReport}=await import('../extension/general-report.js');
 const record=await fixture();
 record.items=record.items.map(item=>({...item,provenance:item.provenance.filter(p=>p.source!=='customer_request')}));
 record.generalAudit.extraction!.customer.products=[{name:'New Medicine XYZ 500mg',quantity:null,unit:null}];
 const html=buildGeneralReport(record);
 assert.match(html,/Customer requested:<\/strong> New Medicine XYZ 500mg/);
 assert.doesNotMatch(html,/data-review-value="name"|data-review-add/);
 assert.match(html,/Confirm Products &amp; Quantities/);
});
test('source confirmation completes same audit, retains inputs and records actor without catalogue registration or AI',async()=>{
 const record=await fixture(),choice=decision(record);
 assert.equal(record.allMatch,false);
 const updated=applyGeneralReviewConfirmation(record,choice,catalog,actor);
 assert.equal(updated.allMatch,true);
 assert.equal(updated.id,record.id);
 assert.equal(updated.whatsappMessage,record.whatsappMessage);
 assert.equal(updated.fulfillmentConfirmation,record.fulfillmentConfirmation);
 assert.equal(updated.generalAudit.semanticReviews.length,0);
 assert.equal(updated.generalAudit.extraction.customer.products[0].quantity,5);
 assert.deepEqual(updated.generalAudit.extraction.customer.unresolvedFields,[]);
 assert.deepEqual(updated.generalAudit.reviewConfirmations[0].confirmedBy,actor);
 assert.equal(updated.generalAudit.reviewConfirmations[0].inputFingerprint,generalInputFingerprint(record));
 assert.equal(catalog.products.length,0);
 assert.equal(completeGeneralAuditRun(createGeneralAuditRun(record,1),JSON.parse(JSON.stringify(updated))).id,record.id);
 assert.equal(applyGeneralReviewConfirmation(updated,choice,catalog,actor),updated);
});
test('confirmation never turns a real quantity mismatch into clearance',async()=>{
 const record=await fixture();
 const updated=applyGeneralReviewConfirmation(record,decision(record,'9'),catalog,actor);
 assert.equal(updated.allMatch,false);
 assert.equal(updated.items[0].fulfillment.requested,9);
 assert.equal(updated.items[0].fulfillment.supplied,5);
 assert.ok(updated.issueCount>0||updated.generalAudit.pendingOrderLimitCount>0);
});
test('unrelated missing and extra product findings survive specific review confirmation',async()=>{
 const record=await fixture('\n- Calcium Carbonate 250mg - 3','\n- Fluconazole 125mg [2/2]');
 const updated=applyGeneralReviewConfirmation(record,decision(record),catalog,actor);
 assert.equal(updated.allMatch,false);
 for(const name of ['Calcium Carbonate 250mg','Fluconazole 125mg']){
  assert.equal(updated.items.find((i:any)=>i.name===name)?.status,record.items.find((i:any)=>i.name===name)?.status);
  assert.ok(updated.items.find((i:any)=>i.name===name)?.status!=='match');
 }
});
test('confirmation preserves genuine identity and explicit strength differences',async()=>{
 const record=await fixture();
 record.generalAudit.orderer={...record.generalAudit.orderer,fulfillmentValue:'Different Person',status:'mismatch'};
 const updated=applyGeneralReviewConfirmation(record,decision(record),catalog,actor);
 assert.equal(updated.generalAudit.orderer.status,'mismatch');
 assert.equal(updated.allMatch,false);
});
test('no blank, negative, invented, duplicated or silently changed confirmation values',async()=>{
 const record=await fixture(),choice=decision(record);
 for(const quantity of ['','-1','NaN','Infinity'])assert.throws(()=>applyGeneralReviewConfirmation(record,{...choice,products:choice.products.map(p=>({...p,quantity}))},catalog,actor));
 assert.throws(()=>applyGeneralReviewConfirmation(record,{...choice,verified:false} as any,catalog,actor),/Verify/);
 assert.throws(()=>applyGeneralReviewConfirmation(record,{...choice,products:[...choice.products,...choice.products]},catalog,actor),/every product/);
 assert.throws(()=>applyGeneralReviewConfirmation(record,{...choice,products:choice.products.map(p=>({...p,name:'Unrelated product'}))},catalog,actor),/suggestion controls/);
});
test('already parsed quantity cannot be changed by confirming a generic review',async()=>{
 const record=await fixture();
 const p=record.items[0].provenance.find(p=>p.source==='customer_request')!;p.quantity=4;delete p.quantityReview;
 assert.throws(()=>applyGeneralReviewConfirmation(record,decision(record,'5'),catalog,actor),/already read/);
});
test('stockouts remain stockouts and do not become physical fulfilment',async()=>{
 const record=await fixture();
 const fs=record.items[0].provenance.find(p=>p.source==='fulfillment_confirmation')!;fs.quantity=0;fs.ratioRequestedQuantity=1;
 const updated=applyGeneralReviewConfirmation(record,decision(record,'5'),catalog,actor);
 assert.equal(updated.allMatch,true);
 assert.equal(updated.generalAudit.productTotals.outOfStock,1);
 assert.equal(updated.generalAudit.productTotals.physicallySuppliedUnits,0);
});
test('a separate quantity warning binds only to the single unread product in that source',async()=>{
 const record=await fixture();
 record.generalAudit.semanticReviews=[{kind:'unparsed_text',field:'quantity',source:'customer_request',originalText:'Quantity: uncertain',possibleMatches:[],reason:'Confirm quantity.'}];
 const choice=decision(record);
 assert.equal(choice.products[0].name,'New Medicine XYZ 500mg');
 assert.equal(applyGeneralReviewConfirmation(record,choice,catalog,actor).allMatch,true);
});
test('ambiguous customer ratios do not become a hidden FS-only confirmation field',async()=>{
 const record=await fixture();
 const requested=record.items[0].provenance.find(p=>p.source==='customer_request')!;
 requested.ratioRequestedQuantity=10;
 const choice=decision(record);
 assert.equal(choice.products[0].confirmationRequested,'');
 assert.equal(applyGeneralReviewConfirmation(record,choice,catalog,actor).allMatch,true);
});
test('displayed review text and saved review text share a stable key after notification filtering',async()=>{
 const record=await fixture();
 record.generalAudit.semanticReviews[0].originalText+='\nYou will receive your flight notifications via SMS';
 const displayed=generalReviewEvidence(record.generalAudit.semanticReviews,'products')[0];
 assert.doesNotMatch(displayed.originalText,/notifications/);
 const products=reviewProductDrafts(record.items,displayed).map(p=>({...p,quantity:'5'}));
 const updated=applyGeneralReviewConfirmation(record,{reviewKey:generalReviewKey(displayed),products,verified:true},catalog,actor);
 assert.equal(updated.allMatch,true);assert.equal(updated.generalAudit.semanticReviews.length,0);
});
test('confirmation preserves approved order limits on other products',async()=>{
 const record=await fixture('\n- Paracetamol 500mg Tablet - 20','\n- Paracetamol 500mg Tablet [3/3]');
 const limit=record.items.find(i=>i.provenance.some(p=>p.name==='Paracetamol 500mg Tablet'))!;
 const limited=applyGeneralOrderLimitDecision(record,limit.fulfillment.key,true);
 const updated=applyGeneralReviewConfirmation(limited,decision(limited),catalog,actor);
 assert.equal(updated.items.find((i:any)=>i.provenance.some((p:any)=>p.name==='Paracetamol 500mg Tablet')).fulfillment.fulfillmentStatus,'order limit applied');
 assert.equal(updated.allMatch,true);
});
test('confirming unclear quantity does not equate different medicine strengths',async()=>{
 const record=await fixture();
 const fs=record.items[0].provenance.find(p=>p.source==='fulfillment_confirmation')!;
 fs.name='New Medicine XYZ 120mg';
 const updated=applyGeneralReviewConfirmation(record,decision(record),catalog,actor);
 assert.equal(updated.allMatch,false);
 assert.ok(updated.items.some((i:any)=>i.fulfillment.identityError||i.status!=='match'));
});
async function call(record:any,body:any,options:{actor?:any;failSave?:boolean}={}){
 let status=200,response:any,saves=0;
 const handler=generalReviewConfirmationHandler({read:async()=>record,catalog:async()=>catalog,save:async()=>{saves++;if(options.failSave)throw Error('offline');}});
 await handler({params:{id:record.id},body} as any,{locals:{authUser:options.actor===undefined?actor:options.actor},status(n:number){status=n;return this;},json(data:any){response=data;}} as any,()=>{});
 return {status,response,saves};
}
test('authenticated endpoint saves and client resumes without running audit again',async()=>{
 const record=await fixture();let count=0;
 const updated=await confirmGeneralReview(async(url,options)=>{count++;assert.match(url,/review-confirmation$/);const result=await call(record,JSON.parse(options.body));assert.equal(result.status,200);assert.equal(result.saves,1);return result.response;},record,decision(record));
 assert.equal(updated.allMatch,true);assert.equal(count,1);
});
test('endpoint rejects stale sources, foreign owners and missing explicit verification',async()=>{
 const record=await fixture(),body={...decision(record),whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)};
 assert.equal((await call(record,{...body,whatsappMessage:'changed'})).status,409);
 assert.equal((await call(record,body,{actor:{id:'other'}})).status,403);
 assert.equal((await call(record,body,{actor:null})).status,401);
 assert.equal((await call(record,{...body,verified:false})).status,400);
 assert.equal((await call(record,body,{failSave:true})).status,503);
 assert.equal(record.allMatch,false);
});
test('idempotent retry does not duplicate history or storage writes',async()=>{
 const record=await fixture(),choice=decision(record),updated=applyGeneralReviewConfirmation(record,choice,catalog,actor);
 const result=await call(updated,{...choice,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)});
 assert.equal(result.status,200);assert.equal(result.saves,0);assert.equal(result.response.generalAudit.reviewConfirmations.length,1);
});
test('website inline action accepts a verified quantity and resumes the mounted audit',async()=>{
 const {parseHTML}=await import('linkedom'),{window}=parseHTML('<html><body><main></main></body></html>');
 const previous={window:globalThis.window,document:globalThis.document,act:(globalThis as any).IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const {act,useState}=await import('react'),{createRoot}=await import('react-dom/client');
 const original=await fixture();let current:any=original,calls=0;
 const root=createRoot(window.document.querySelector('main')!);
 const props=(element:any)=>element[Object.keys(element).find(key=>key.startsWith('__reactProps'))!];
 function Harness(){const [record,setRecord]=useState<any>(original);return createElement(GeneralAuditDetails,{key:record.id,details:record.generalAudit,items:record.items,onConfirmReview:async choice=>{calls++;current=applyGeneralReviewConfirmation(record,choice,catalog,actor);setRecord(current);}});}
 try{
  await act(async()=>root.render(createElement(Harness)));
  const quantity=window.document.querySelector('[aria-label="Review product 1 quantity"]');
  await act(async()=>props(quantity).onChange({target:{value:'5'}}));
  const checkbox=window.document.querySelector('input[type="checkbox"]');
  await act(async()=>props(checkbox).onChange({target:{checked:true}}));
  const button=[...window.document.querySelectorAll('button')].find(b=>b.textContent==='Confirm Products & Quantities')!;
  assert.equal(button.hasAttribute('disabled'),false);
  await act(async()=>props(button).onClick());
  assert.equal(calls,1);assert.equal(current.allMatch,true);assert.equal(current.id,original.id);
  assert.equal(window.document.querySelector('[aria-label="Confirm source products and quantities"]'),null);
 }finally{await act(async()=>root.unmount());Object.assign(globalThis,{window:previous.window,document:previous.document,IS_REACT_ACT_ENVIRONMENT:previous.act});}
});
test('extension confirmation saves on same audit and reports failed saves inline for retry',async()=>{
 const {parseHTML}=await import('linkedom'),{setupGeneralProductReview}=await import('../extension/general-report.js');
 let record:any=await fixture(),fail=true,calls=0;
 const {document,window}=parseHTML('<main></main>'),root=document.querySelector('main')!;let controller:any;
 const render=()=>{root.innerHTML=controller.render(record);};
 controller=setupGeneralProductReview({root,getResult:()=>record,getSources:()=>record,contextKey:()=>1,onSaved:(value:any)=>{record=value;},rerender:render,request:async(url:string,options:any)=>{
  calls++;assert.match(url,/review-confirmation$/);if(fail)throw Error('Temporary saving failure');
  return applyGeneralReviewConfirmation(record,JSON.parse(options.body),catalog,actor);
 }});render();
 const input:any=root.querySelector('[data-review-value="quantity"]');input.value='5';input.dispatchEvent(new window.Event('change',{bubbles:true}));
 const checkbox:any=root.querySelector('[data-review-verified]');checkbox.checked=true;checkbox.dispatchEvent(new window.Event('change',{bubbles:true}));
 assert.equal(root.querySelector('[data-confirm-source-review]')!.hasAttribute('disabled'),false);
 root.querySelector('[data-confirm-source-review]')!.dispatchEvent(new window.Event('click',{bubbles:true}));
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(record.allMatch,false);assert.match(root.textContent!,/Temporary saving failure/);assert.equal(controller.isBusy(),false);
 fail=false;root.querySelector('[data-confirm-source-review]')!.dispatchEvent(new window.Event('click',{bubbles:true}));
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(calls,2);assert.equal(record.allMatch,true);assert.equal(record.generalAudit.reviewConfirmations.length,1);
 assert.equal(root.querySelector('[data-confirm-source-review]'),null);
});
