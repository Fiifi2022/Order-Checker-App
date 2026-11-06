import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {extractGeneralOrderDeterministically} from './generalOrderExtraction';
import {parseVaccineLinesDetailed,replaceAliases} from './vaccineService';
import {changeCatalogueAlias} from './catalogAliasLearning';
import {completeGeneralAuditRun,createGeneralAuditRun} from '../src/utils/generalAuditRun';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog} from '../shared/productCatalog';
const catalog=():ProductCatalog=>({revision:9100,products:[
 {id:'asv',scope:'general',name:'Anti Snake Serum Injection',aliases:['ASV','Anti Snake Venom','antivenom'],contextualAliases:[],category:'medicine',note:''},
 {id:'rdt',scope:'general',name:'Malaria Rapid Diagnostic Test Kit',aliases:['RDT'],contextualAliases:[],category:'diagnostic',note:''},
 {id:'rabies',scope:'general',name:'Anti Rabies Vaccine Injection',aliases:['ARV'],contextualAliases:['ARV'],category:'vaccine',note:''},
]});
const context={records:[{id:'zeb',name:'Zebilla Hospital',source:'test/zeb'}]};
const header='Name: Timothy Ndebugre\nFacility: Zebilla Hospital\n';
const log='Thank you Timothy Ndebugre from Zebilla HSP for ordering with Zipline.\nAnti Snake Serum Injection [4/4]';
const noAI=()=>{throw Error('Recognised catalogue identity must not initialize Gemini');};
for(const text of [
 header+'I need 4 vials of ASV',header+'Please send anti snake venom 4',
 'Mr Timothy Ndebugre from Zebilla Hospital needs 4 ASV',
 'Zebilla Hospital Timothy Ndebugre ASV x4',
 header+'Need full course of anti snake venom - 4',
 'Timothy Ndebugre, Zebilla HSP, antivenom four vials',
 ...['4','x4','4x','four','four vials','qty 4','-4','[4/4]'].map(q=>header+`ASV ${q}`),
])test(`universal catalogue-first request: ${text.replaceAll('\n',' / ')}`,async()=>{
 const products=catalog();applyCatalog(products);let calls=0;
 const result=await runGeneralProductNameAudit(text,log,products,{facilityContext:context,semanticTimeoutMs:500},()=>{calls++;return noAI();});
 assert.equal(calls,0);assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));
 assert.equal(result.items[0].catalogProductId,'asv');assert.equal(result.items[0].fulfillment.requested,4);
 const record=completeGeneralAuditRun(createGeneralAuditRun({whatsappMessage:text,fulfillmentConfirmation:log},1,{}, {},true),JSON.parse(JSON.stringify({...result,whatsappMessage:text,fulfillmentConfirmation:log})));
 assert.equal(record.allMatch,true);assert.match(buildGeneralReport(record),/ORDER CONFIRMED/);
});
for(const title of ['Mr','Mrs','Miss','Dr','Nurse','Midwife','PA','Physician Assistant'])test(`role title is not part of the core name: ${title}`,async()=>{
 const products=catalog();applyCatalog(products);
 const result=await runGeneralProductNameAudit(`${title} Timothy Ndebugre from Zebilla Hospital I need ASV 4`,log,products,{facilityContext:context,semanticTimeoutMs:0},noAI);
 assert.equal(result.generalAudit.orderer.status,'match');assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));
});

test('ARV venom requires a verified mapping; an explicit count does not become a course conversion',async()=>{
 let products=catalog();applyCatalog(products);
 const text='Mr Timothy Ndebugre from Zebilla Hospital I need full course of ARV venom -4';
 const initial=await runGeneralProductNameAudit(text,log,products,{facilityContext:context,semanticTimeoutMs:0},noAI);
 assert.equal(initial.allMatch,false);assert.equal(initial.generalAudit.extraction?.customer.products[0].quantity,4);
 assert.ok(!initial.generalAudit.semanticReviews?.some(review=>review.field==='quantity'));
 products=changeCatalogueAlias(products,{revision:products.revision,action:'propose',text:'ARV venom',productId:'asv'},'Test editor').catalog;
 const id=products.aliasRecords!.find(row=>row.text==='ARV venom')!.id;
 products=changeCatalogueAlias(products,{revision:products.revision,action:'approve',id,identityConfirmed:true},'Test editor').catalog;
 applyCatalog(products);
 const approved=await runGeneralProductNameAudit(text,log,products,{facilityContext:context,semanticTimeoutMs:500},noAI);
 assert.equal(approved.allMatch,true,JSON.stringify(approved.generalAudit));
 const ambiguous=await runGeneralProductNameAudit(header+'I need ARV 4',log,products,{facilityContext:context,semanticTimeoutMs:0},noAI);
 assert.equal(ambiguous.allMatch,false);
});

test('multiple products, literal requested ratios and list numbers retain each count',async()=>{
 const products=catalog();applyCatalog(products);
 const result=await runGeneralProductNameAudit(header+'Please send 4 vials of ASV and 2 RDT.\n2. ASV 20/20',log+'\nAnti Snake Serum Injection [20/20]\nMalaria Rapid Diagnostic Test Kit [2/2]',products,{facilityContext:context,semanticTimeoutMs:0},noAI);
 assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));assert.equal(result.items.find(item=>item.catalogProductId==='asv')!.fulfillment.requested,24);
});

test('strengths, negative inventory, absent counts and missing identities cannot manufacture a pass',async()=>{
 const products=catalog();applyCatalog(products);
 for(const request of ['Need full course of ASV','Balance BCG -4','ASV --4','ASV - 5','Artesunate injection 120mg']){
  const result=await runGeneralProductNameAudit(header+request,log,products,{facilityContext:context,semanticTimeoutMs:0},noAI);
  assert.equal(result.allMatch,false,request);
 }
 const extracted=extractGeneralOrderDeterministically(header+'Need full course of ASV','customer_request',context);
 assert.ok(extracted.quantityReviews?.length);assert.ok(extracted.order.unresolvedFields.includes('quantity'));
});
for(const text of [
 'Mr Timothy Ndebugre from Zebilla Hospital needs 4 vials of BCG',
 'Name: Timothy Ndebugre\nFacility: Zebilla Hospital\nPlease send BCG four vials and OPV 2 vials',
 'Name: Timothy Ndebugre\nFacility: Zebilla Hospital\nBCG 4x\nOPV x2',
])test(`shared natural-language vaccine quantities: ${text.replaceAll('\n',' / ')}`,()=>{
 replaceAliases({BCG:['BCG'],OPV:['OPV']});
 const result=parseVaccineLinesDetailed(text,{facilityContext:context});
 assert.deepEqual(result.errors,[]);assert.equal(result.items.find(item=>item.canonical==='BCG')?.quantity,4);
 if(text.includes('OPV'))assert.equal(result.items.find(item=>item.canonical==='OPV')?.quantity,2);
});

test('natural-language audits retain genuine four-field discrepancies and documented stock exceptions',async()=>{
 const products=catalog();applyCatalog(products);const request='Mr Timothy Ndebugre from Zebilla Hospital I need full course of ASV -4';
 for(const confirmation of [log.replace('Timothy Ndebugre','Mary Mensah'),log.replace('Zebilla HSP','Another Hospital'),log.replace('[4/4]','[5/5]'),log.replace('Anti Snake Serum Injection','Malaria Rapid Diagnostic Test Kit')]){
  const result=await runGeneralProductNameAudit(request,confirmation,products,{facilityContext:context,semanticTimeoutMs:0},noAI);
  assert.equal(result.allMatch,false);assert.equal(result.generalAudit.outcome,'Discrepancy Detected');
 }
 for(const confirmation of [log.replace('[4/4]','[0/1]'),log.replace('[4/4]','[3/4] - partially out of stock')]){
  const result=await runGeneralProductNameAudit(request,confirmation,products,{facilityContext:context,semanticTimeoutMs:0},noAI);
  assert.equal(result.allMatch,true);assert.equal(result.generalAudit.outcome,'No Discrepancy Detected');assert.ok(result.generalAudit.stockStatus.includes('out of stock'));
 }
 const limited=await runGeneralProductNameAudit(request,log.replace('[4/4]','[3/3]'),products,{facilityContext:context,semanticTimeoutMs:0,generalOrderLimitDecisions:{asv:true}},noAI);
 assert.equal(limited.allMatch,true);assert.equal(limited.items[0].status,'order limit applied');
});

test('unrecognized products receive Gemini choices without permanent guesses or false clearance',async()=>{
 const products=catalog();applyCatalog(products);let calls=0;
 const result=await runGeneralProductNameAudit(header+'VenomCare 4',log,products,{facilityContext:context,semanticCacheScope:'universal-provider',semanticTimeoutMs:1000},()=>({models:{async generateContent(){calls++;return{text:JSON.stringify({matches:[{alias:'VenomCare',productId:'asv',confidence:.99,clinicalUncertainty:false,reason:'Possible local brand; verify its identity.'}]})};}}}));
 assert.equal(calls,1);assert.equal(result.allMatch,false);assert.equal(result.generalAudit.outcome,'Needs Review');
 assert.equal(result.generalAudit.catalogueSuggestions![0].options[0].productId,'asv');assert.ok(!products.products[0].aliases.includes('VenomCare'));
 assert.match(buildGeneralReport(result),/Needs Review/);assert.match(buildGeneralReport(result),/Confirm match/);
});

test('word numbers inside catalogue names never supply a missing order quantity',async()=>{
 const products=catalog();products.products.push({id:'four',scope:'general',name:'Dressing Type Four',aliases:[],contextualAliases:[],category:'consumable',note:''});applyCatalog(products);
 const result=await runGeneralProductNameAudit(header+'Dressing Type Four',header+'Dressing Type Four [4/4]',products,{facilityContext:context,semanticTimeoutMs:0},noAI);
 assert.equal(result.allMatch,false);assert.equal(result.generalAudit.outcome,'Needs Review');
});
