import test from 'node:test';
import assert from 'node:assert/strict';
import {extractGeneralStructuredPreview,applyGeneralExtractionSubmission,projectGeneralStructuredSource,finishGeneralStructuredAudit} from './generalStructuredExtraction';
import {generalExtractionPreviewHandler} from './generalExtractionPreview';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog,defaultProducts} from './productCatalog';
import type {GeneralExtractionSubmission,GeneralStructuredPreview} from '../shared/generalStructuredExtraction';
const catalog={revision:88001,products:defaultProducts()},actor={id:'structured-cca',name:'CCA'};
const customer=`Good evening\nPlease additional ASV needed\nName of patient: Iddrisu Faiza\nAge: 12 years\nPatient's contact: 0597664783\nName of Orderer: Lugutuah Daniel\nFacility: Yezesi Health Center\nQuantity needed: 2 vials`;
const fs='Thank you Lugutuah Daniel from Yezesi HC for ordering with Zipline. We will prepare the following items: Anti-Snake Venom [2/2].';
const context={records:[{id:'yezesi',name:'Yezesi Health Center',verifiedAliases:['Yezesi HC'],source:'approved-directory'}]};
function extract(a=customer,b=fs){applyCatalog(catalog);return extractGeneralStructuredPreview(a,b,catalog,context);}
const submit=(p:GeneralStructuredPreview,extra:any={}):GeneralExtractionSubmission=>({version:1,inputFingerprint:p.inputFingerprint,catalogRevision:p.catalogRevision,edits:[],confirmedFields:[],reason:'',acknowledged:false,...extra});
async function compare(p:GeneralStructuredPreview,extra:any={}){let calls=0;const extraction=applyGeneralExtractionSubmission(p,submit(p,extra),actor);const audited=await runGeneralProductNameAudit(projectGeneralStructuredSource(extraction.preview.customer,'customer'),projectGeneralStructuredSource(extraction.preview.fulfillment,'fulfillment'),catalog,{generalOnlySmartMatching:true,requestLanguage:true,deferProductResearch:true,semanticTimeoutMs:0,facilityContext:context},()=>{calls++;throw Error('No AI for clear fields');});return {result:finishGeneralStructuredAudit(audited,extraction),calls};}
test('separate product/quantity and short FS heading extract before comparison without patient data',async()=>{
 const p=extract();assert.equal(p.customer.orderer.value,'Lugutuah Daniel');assert.equal(p.fulfillment.orderer.value,'Lugutuah Daniel');assert.equal(p.customer.facility.value,'Yezesi Health Center');
 assert.equal(p.customer.products.length,1);assert.equal(p.customer.products[0].quantity,2);assert.match(p.customer.products[0].unit,/vial/);assert.equal(p.fulfillment.products.length,1);assert.equal(p.fulfillment.products[0].quantity,2);
 assert.doesNotMatch(JSON.stringify(p),/Iddrisu Faiza|0597664783|12 years/);
 const {result,calls}=await compare(p);assert.equal(calls,0);assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));assert.equal(result.items.length,1);
});
for(const [label,request] of [
 ['standalone','Lugutuah Daniel\nFacility: Yezesi HC\nASV - 2'],
 ['sentence','This is Lugutuah Daniel from Yezesi HC. Please send 2 ASV.'],
 ['numbered','Orderer: Lugutuah Daniel\nFacility: Yezesi HC\n1) ASV 2/2'],
] as const)test(`structured preview supports ${label} without inventing fields`,async()=>{
 const p=extract(request);assert.equal(p.customer.orderer.value,'Lugutuah Daniel');assert.equal(p.customer.products[0]?.quantity,2);const {result}=await compare(p);assert.equal(result.allMatch,true);
});
test('FS fields never fill absent customer evidence; ambiguous people remain reviewable',async()=>{
 const missing=extract('Facility: Yezesi HC\nASV - 2');assert.equal(missing.customer.orderer.status,'not detected');assert.equal((await compare(missing)).result.allMatch,false);
 const uncertain=extract('Lugutuah Daniel\nJohn Mensah\nFacility: Yezesi HC\nASV - 2');assert.equal(uncertain.customer.orderer.status,'ambiguous');assert.equal((await compare(uncertain)).result.allMatch,false);
 const yes=await compare(uncertain,{confirmedFields:['customer.orderer'],acknowledged:true});assert.equal(yes.result.allMatch,true);
});
test('unknown identical products, units and multiple FS entries stay separate',async()=>{
 const p=extract('Name: Lugutuah Daniel\nFacility: Yezesi HC\n1. New Medicine XYZ 500mg - 20 boxes\n(2) Another Compound 10mg - 2 packs',
 'Thank you Lugutuah Daniel from Yezesi HC for ordering with Zipline. We will prepare the following items:\n- Another Compound 10mg [2/2] packs\n- New Medicine XYZ 500mg [20/20] boxes');
 assert.equal(p.customer.products.length,2);assert.equal(p.fulfillment.products.length,2);const {result,calls}=await compare(p);assert.equal(result.allMatch,true);assert.equal(calls,0);
});
test('quantities, zero stockouts, order limits, missing/extra and strengths retain independent rules',async()=>{
 const a='Name: Lugutuah Daniel\nFacility: Yezesi HC\nArtesunate 60mg Injection - 10';
 const header='Thank you Lugutuah Daniel from Yezesi HC for ordering with Zipline. We will prepare the following items:\n';
 for(const [line,expected] of [['Artesunate 60mg Injection [10/10]',true],['Artesunate 60mg Injection [5/5]',false],['Artesunate 60mg Injection [0/1]',true],['Artesunate 60mg Injection [5/5] (order limit applied)',true],['Artesunate 120mg Injection [10/10]',false],['Artesunate 60mg Injection [10/10]\nORS [2/2]',false]] as const){
  const p=extract(a,header+line);assert.equal((await compare(p)).result.allMatch,expected,line);
 }
});
test('manual correction needs acknowledgment, reason and a current source fingerprint and preserves original values',async()=>{
 const p=extract(),edits=[{source:'customer',field:'orderer',value:'Daniel Lugutuah'}];
 assert.throws(()=>applyGeneralExtractionSubmission(p,submit(p,{edits}),actor),/Acknowledge/);
 assert.throws(()=>applyGeneralExtractionSubmission(p,submit(p,{inputFingerprint:'stale'}),actor),/changed/);
 const {result}=await compare(p,{edits,acknowledged:true,reason:'Corrected the name order from the original message.'});
 assert.equal(result.allMatch,true);const change=result.generalAudit.structuredExtraction.changes[0];assert.equal(change.before,'Lugutuah Daniel');assert.equal(change.after,'Daniel Lugutuah');assert.equal(change.actor.id,actor.id);assert.equal(result.generalAudit.structuredExtraction.preview.customer.sourceText,p.customer.sourceText);
 assert.doesNotMatch(JSON.stringify(result),/Iddrisu Faiza|0597664783|12 years/);
});
test('preview endpoint is authenticated, General-only, non-persistent and contains no verdict',async()=>{
 let reads=0;const handler=generalExtractionPreviewHandler({catalog:async()=>{reads++;return catalog;},context:async()=>context,apply:applyCatalog});
 async function invoke(body:any,user:any=actor){let status=200,data:any;await handler({body} as any,{locals:{authUser:user},setHeader(){},status(code:number){status=code;return this;},json(value:any){data=value;}} as any,()=>{});return {status,data};}
 const body={auditScope:'general_auditor',whatsappMessage:customer,fulfillmentConfirmation:fs};
 assert.equal((await invoke(body,null)).status,401);assert.equal((await invoke({...body,auditMode:'fulfillment_only'})).status,400);assert.equal(reads,0);
 const response=await invoke(body);assert.equal(response.status,200);assert.equal(response.data.allMatch,undefined);assert.equal(response.data.discrepancies,undefined);assert.equal(reads,1);assert.doesNotMatch(JSON.stringify(response.data),/Iddrisu Faiza|0597664783/);
});

test('preview is not an audit and reliable extraction needs no extra acknowledgment',async()=>{
 const {createElement}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{default:Preview}=await import('../src/components/GeneralExtractionPreview');
 const html=renderToStaticMarkup(createElement(Preview,{preview:extract(),onCompare:async()=>{},onCancel(){}}));
 assert.match(html,/Compare and audit/);assert.doesNotMatch(html,/DISCREPANCY|type="checkbox"|disabled=""/);assert.match(html,/Lugutuah Daniel/);assert.match(html,/ASV/);
});
test('mounted preview records corrections and resumes comparison without waiving quantity checks',async()=>{
 const {parseHTML}=await import('linkedom'),{window}=parseHTML('<html><body><main></main></body></html>');
 const previous={window:globalThis.window,document:globalThis.document,act:(globalThis as any).IS_REACT_ACT_ENVIRONMENT};Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const {createElement,act}=await import('react'),{createRoot}=await import('react-dom/client'),{default:Preview}=await import('../src/components/GeneralExtractionPreview');
 const p=extract(customer,fs.replace('[2/2]','[1/1]')),root=createRoot(window.document.querySelector('main')!);let submitted:any,result:any;
 const props=(node:any)=>node[Object.keys(node).find(key=>key.startsWith('__reactProps'))!];
 const button=(text:string)=>[...window.document.querySelectorAll('button')].find(b=>b.textContent===text)!;
 try{
  await act(async()=>root.render(createElement(Preview,{preview:p,onCompare:async s=>{submitted=s;result=(await compare(p,s)).result;},onCancel(){}})));
  await act(async()=>props(button('Edit orderer')).onClick());
  await act(async()=>props(window.document.querySelector('[aria-label="customer orderer"]')).onChange({target:{value:'Daniel Lugutuah'}}));
  assert.equal(button('Compare and audit').hasAttribute('disabled'),true);
  await act(async()=>props(window.document.querySelector('[aria-label="Extraction correction reason"]')).onChange({target:{value:'Verified the name order against the source.'}}));
  await act(async()=>props(window.document.querySelector('input[type="checkbox"]')).onChange({target:{checked:true}}));
  assert.equal(button('Compare and audit').hasAttribute('disabled'),false);
  await act(async()=>props(button('Compare and audit')).onClick());
  assert.equal(submitted.acknowledged,true);assert.equal(result.allMatch,false);assert.equal(result.generalAudit.orderer.status,'match');assert.equal(result.items[0].fulfillment.requested,2);assert.equal(result.items[0].fulfillment.supplied,1);assert.equal(result.generalAudit.structuredExtraction.changes.length,1);
 }finally{await act(async()=>root.unmount());Object.assign(globalThis,{window:previous.window,document:previous.document,IS_REACT_ACT_ENVIRONMENT:previous.act});}
});
test('partial stockout, quantities in tablets and separate strengths stay independent',async()=>{
 const p=extract('Name: Lugutuah Daniel\nFacility: Yezesi HC\n1- Paracetamol 500mg Tablet 20/20 tablets\n2. Artesunate 60mg Injection - 10\n3) Artesunate 120mg Injection - 15',
 'Thank you Lugutuah Daniel from Yezesi HC for ordering with Zipline. We will prepare the following items:\n- Artesunate 120mg Injection [15/15]\n- Artesunate 60mg Injection [10/10]\nWe are partially out of stock for the following items:\n- Paracetamol 500mg Tablet [10/20] tablets');
 assert.equal(p.customer.products.length,3);assert.equal(p.fulfillment.products.length,3);const {result}=await compare(p);assert.equal(result.allMatch,true);assert.ok(result.items.some((item:any)=>item.fulfillment.stockStatus==='partially out of stock'));
});
test('unclear source text survives extraction when AI is unavailable; no false clearance',async()=>{
 const p=extract('Name: Lugutuah Daniel\nFacility: Yezesi HC\nPlease send the new serum, quantity unclear',fs);
 assert.ok(p.customer.unreadProducts.length||!p.customer.products.length);assert.equal((await compare(p)).result.allMatch,false);
});

test('structured workflow keeps local checks when AI is rate-limited and excludes clinical data from prompts',async()=>{
 const p=extract('Name: Lugutuah Daniel\nFacility: Yezesi HC\nPatient: Confidential Person\nAge: 44 years\nPatient contact: 0551234567\nLocal Mystery Remedy - 2\nParacetamol 500mg Tablet - 10',
 'Thank you Lugutuah Daniel from Yezesi HC for ordering with Zipline. We will prepare the following items:\n- Oral Rehydration Salts [2/2]\n- Paracetamol 500mg Tablet [10/10]');
 let calls=0;const client={models:{async generateContent(request:any){calls++;assert.doesNotMatch(JSON.stringify(request),/Confidential Person|0551234567|44 years/);throw Object.assign(Error('Quota exhausted'),{status:429});}}};
 const result=await runGeneralProductNameAudit(projectGeneralStructuredSource(p.customer,'customer'),projectGeneralStructuredSource(p.fulfillment,'fulfillment'),catalog,{requestLanguage:true,generalOnlySmartMatching:true,semanticTimeoutMs:200,facilityContext:context},()=>client);
 assert.equal(calls,1);assert.equal(result.allMatch,false);assert.equal(result.generalAudit.orderer.status,'match');assert.equal(result.generalAudit.facility.status,'match');assert.ok(result.items.some((item:any)=>item.name.includes('Paracetamol')&&item.status==='match'));
});

test('unresolved product extraction cannot be hidden by otherwise matching product entries',async()=>{
 const p=extract();p.customer.unreadProducts=['Unparsed medicine line still needs extraction'];
 const {result}=await compare(p);assert.equal(result.allMatch,false);assert.equal(result.generalAudit.decision,'review');
});

test('corrections preserve stock context for duplicate FS product lines after a row is removed',()=>{
 const p=extract('Name: Lugutuah Daniel\nFacility: Yezesi HC\nParacetamol 500mg Tablet - 20',
 'Thank you Lugutuah Daniel from Yezesi HC for ordering with Zipline. We will prepare the following items:\n- Paracetamol 500mg Tablet [5/10]\nWe are partially out of stock for the following items:\n- Paracetamol 500mg Tablet [5/10]');
 assert.equal(p.fulfillment.products.length,2);assert.equal(p.fulfillment.products[0].stockout,false);assert.equal(p.fulfillment.products[1].stockout,true);
 const keep=p.fulfillment.products[1];const updated=applyGeneralExtractionSubmission(p,submit(p,{edits:[{source:'fulfillment',field:'products',value:[keep]}],acknowledged:true,reason:'Removed a duplicated source row.'}),actor);
 assert.equal(updated.preview.fulfillment.products[0].stockout,true);assert.equal(updated.preview.fulfillment.products[0].entryId,keep.entryId);
});
