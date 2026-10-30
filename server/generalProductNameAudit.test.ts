import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralProductNameAudit, generalProductNameKey } from './generalProductNameAudit';
import { completeGeneralAuditRun, createGeneralAuditRun } from '../src/utils/generalAuditRun';
import Inventory from '../src/components/GeneralInventory';
import Summary from '../src/components/GeneralFulfillmentSummary';
import { defaultProducts, saveCatalogProduct } from './productCatalog';
import { runGeneralAuditor } from './generalAuditor';
import { acknowledgeOrderLimit } from '../shared/orderLimitAcknowledgement';
import { buildGeneralReport } from '../extension/general-report.js';
import type { ProductCatalog } from '../shared/productCatalog';
const catalog: ProductCatalog = { revision: 7, products: [
 {id:'pcm',scope:'general',name:'Paracetamol 500mg Tablet',aliases:['PCM'],contextualAliases:[],category:'medicine',note:''},
 {id:'pcm-syrup',scope:'general',name:'Paracetamol 120mg/5ml Syrup',aliases:[],contextualAliases:[],category:'medicine',note:''},
 {id:'cipro',scope:'general',name:'Ciprofloxacin 2mg/ml Infusion',aliases:['Cipro'],contextualAliases:[],category:'medicine',note:''},
 {id:'sp',scope:'general',name:'Sulphadoxine/Pyrimethamine 500mg/25mg Tablet',aliases:['SP'],contextualAliases:[],category:'medicine',note:''},
 {id:'vaccine',scope:'vaccine',name:'BCG',aliases:[],contextualAliases:[],category:'vaccine',note:''},
] };
// Explicit catalogue approval uses the existing editor, never an AI audit write.
function approveAliasesInExistingCatalog(current:ProductCatalog,matches:{alias:string;productId:string}[],actor:string) {
 let saved=current;
 for(const {alias,productId} of matches) {
  const product=saved.products.find(p=>p.id===productId);
  if(!product || product.aliases.includes(alias)) continue;
  try {saved=saveCatalogProduct(saved,{...product,revision:saved.revision,aliases:[...product.aliases,alias]},actor);} catch {}
 }
 return saved;
}
const headers='Orderer: Frimpong Vivian\nFacility: Domakwai CHPS\nProducts:\n';
const noAI=()=>{throw Error('Catalogue names and aliases must win');};
const run=(a:string,b:string)=>runGeneralProductNameAudit(headers+a,headers+b,catalog,{},noAI);

test('catalogue names and aliases compare names and quantities, using catalogue IDs and approved aliases',async()=>{
 const result=await run('PCM - 50 tablets\nSP - 50 blisters','Paracetamol 500mg Tablet [50/50]\nSulphadoxine/Pyrimethamine 500mg/25mg Tablet [5/5]');
 assert.equal(result.allMatch,true);assert.equal(result.items.length,2);
 assert.ok(result.items.every(p=>p.status==='match'));
 assert.deepEqual(result.generalAudit.productVerifications,[]);assert.deepEqual(result.generalAudit.semanticReviews,[]);
 assert.equal(result.semanticAnalysis.status,'skipped');assert.equal(result.comparisonMode,'product_names_quantities');
 assert.equal(result.auditSummary.totalChecks,6); // facility, orderer, two product names and two quantities
 const html=renderToStaticMarkup(createElement('div',null,createElement(Inventory,{items:result.items,details:result.generalAudit,onConfirm:async()=>{},onOrderLimit(){}}),createElement(Summary,{details:result.generalAudit})));
 assert.doesNotMatch(html,/Dosage \/ formulation|ambigu/i);
 assert.match(html,/Product names and quantities/);
});

test('names without quantities are compared, and a different known product cannot be forced to match',async()=>{
 assert.equal((await run('Paracetamol','PCM')).allMatch,false);
 const result=await run('PCM - 5','Cipro [5/5]');
 assert.equal(result.allMatch,false);assert.deepEqual(result.items.map(p=>p.status),['missing item','extra item']);
 assert.equal((await run('PCM','PCM')).generalAudit.orderer.status,'match');
 const wrong=await runGeneralProductNameAudit(headers+'PCM',headers.replace('Domakwai','Gbangu')+'PCM',catalog,{},noAI);
 assert.equal(wrong.generalAudit.facility.status,'mismatch');assert.equal(wrong.allMatch,false);
});

test('AI suggestions require approval; approved repository aliases prevent the next AI call',async()=>{
 let calls=0,saves=0;let saved=catalog;
 const getClient=()=>({models:{async generateContent(options:any){calls++;const input=JSON.parse(options.contents);assert.deepEqual(input.unknownNames,['Feva relief']);return {text:JSON.stringify({matches:[{alias:'Feva relief',productId:'pcm',confidence:0.99}]})};}}});
 const first=await runGeneralProductNameAudit(headers+'Feva relief - 25',headers+'PCM [25/25]',saved,{},getClient,async aliases=>{saves++;saved=approveAliasesInExistingCatalog(saved,aliases,'test-user');return saved;});
 assert.equal(first.allMatch,false);assert.equal(calls,1);assert.equal(saves,0);assert.equal(first.aliasLearning.status,'review_required');
 assert.equal(first.items.length,1);assert.equal(first.items[0].status,'product identity discrepancy');
 assert.equal(first.aliasLearning.resolved,0);assert.equal(first.aliasLearning.proposed,1);
 saved=approveAliasesInExistingCatalog(saved,[{alias:'Feva relief',productId:'pcm'}],'test-user');
 assert.equal(saved.revision,8);assert.ok(saved.products.find(p=>p.id==='pcm')!.aliases.includes('Feva relief'));
 const next=await runGeneralProductNameAudit(headers+'Feva relief - 25',headers+'PCM [25/25]',saved,{},noAI);
 assert.equal(next.allMatch,true);assert.equal(next.semanticAnalysis.status,'skipped');
 assert.equal(approveAliasesInExistingCatalog(saved,[{alias:'Feva relief',productId:'pcm'}],'test-user').revision,8);
});

test('invalid AI IDs, unsolicited aliases, conflicting suggestions and low confidence are not learned',async()=>{
 let saved=false;
 const result=await runGeneralProductNameAudit(headers+'Mysterymed - 5',headers+'PCM [5/5]',catalog,{},()=>({models:{async generateContent(){return {text:JSON.stringify({matches:[
 {alias:'Mysterymed',productId:'invented',confidence:1},{alias:'not in input',productId:'pcm',confidence:1},
 {alias:'Mysterymed',productId:'pcm',confidence:0.5},{alias:'Mysterymed',productId:'vaccine',confidence:1},
 ]})};}}}),async()=>{saved=true;return catalog;});
 assert.equal(saved,false);assert.equal(result.allMatch,false);assert.equal(result.aliasLearning.resolved,0);
 const conflict=approveAliasesInExistingCatalog(catalog,[{alias:'Cipro',productId:'pcm'}],'test-user');
 assert.equal(conflict,catalog);
});

test('AI failures and unverified suggestions do not fabricate matches or produce ambiguous product warnings',async()=>{
 const result=await run('Unlistedmed - 2','PCM [5/5]');
 assert.equal(result.allMatch,false);assert.equal(result.semanticAnalysis.status,'fallback');assert.deepEqual(result.generalAudit.semanticReviews,[]);
 const getClient=()=>({models:{async generateContent(){return{text:JSON.stringify({matches:[{alias:'Unlistedmed',productId:'pcm',confidence:1}]})};}}});
 const matched=await runGeneralProductNameAudit(headers+'Unlistedmed - 2',headers+'PCM [2/2]',catalog,{semanticCacheScope:'independent-ai-provider'},getClient,async()=>{throw Error('database unavailable');});
 assert.equal(matched.allMatch,false);assert.equal(matched.aliasLearning.status,'review_required');assert.equal(matched.aliasLearning.saved,0);
});

test('name and quantity server results are accepted without reintroducing dose checks',async()=>{
 const inputs={whatsappMessage:headers+'PCM - 50',fulfillmentConfirmation:headers+'Paracetamol 500mg Tablet [50/50]'};
 const result=await runGeneralProductNameAudit(inputs.whatsappMessage,inputs.fulfillmentConfirmation,catalog,{},noAI);
 const accepted=completeGeneralAuditRun(createGeneralAuditRun(inputs,1,{}, {},true),{...result,...inputs});
 assert.equal(accepted.allMatch,true);assert.equal(accepted.items[0].status,'match');assert.equal((accepted as any).comparisonMode,'product_names_quantities');
 assert.notEqual(generalProductNameKey('Artemether/Lumefantrine'),generalProductNameKey('Artesunate/Amodiaquine'));
});

test('read-only audits do not mutate the catalogue; later conflicting aliases are never overwritten',async()=>{
 const before=JSON.stringify(catalog);
 const client=()=>({models:{async generateContent(){return{text:JSON.stringify({matches:[{alias:'Feverhelper',productId:'pcm',confidence:0.99}]})};}}});
 const result=await runGeneralProductNameAudit(headers+'Feverhelper - 5',headers+'PCM [5/5]',catalog,{},client);
 assert.equal(result.allMatch,false);assert.equal(result.aliasLearning.status,'review_required');assert.equal(result.aliasLearning.saved,0);
 assert.equal(JSON.stringify(catalog),before);
 const first=approveAliasesInExistingCatalog(catalog,[{alias:'Feverhelper',productId:'cipro'}],'catalogue-manager');
 const second=approveAliasesInExistingCatalog(first,[{alias:'Feverhelper',productId:'pcm'}],'AI-audit');
 assert.equal(second,first);assert.ok(second.products.find(p=>p.id==='cipro')!.aliases.includes('Feverhelper'));
});


test('shortfalls, excess quantities and actual fulfilment numerators affect the verdict',async()=>{
 for (const [log,quantity,difference] of [['PCM [3/5]',3,2],['PCM [7/5]',7,2]] as const) {
  const result=await run('PCM - 5',log);
  assert.equal(result.allMatch,false); assert.equal(result.items[0].status,quantity < 5 ? 'pending order limit' : 'quantity mismatch');
  assert.equal(result.items[0].fulfillment.supplied,quantity); assert.equal(result.items[0].difference,difference);
  const inputs={whatsappMessage:headers+'PCM - 5',fulfillmentConfirmation:headers+log};
  assert.equal(completeGeneralAuditRun(createGeneralAuditRun(inputs,1,{}, {},true),{...result,...inputs}).allMatch,false);
 }
});

test('duplicate quantities aggregate and confirmed pack conversions compare physical quantities',async()=>{
 const duplicate=await run('PCM - 2\nPCM - 3','Paracetamol [5/5]');
 assert.equal(duplicate.allMatch,true); assert.equal(duplicate.items[0].fulfillment.requested,5);
 const packs=await run('Sulphadoxine/Pyrimethamine 500mg/25mg Tablet - 50 blisters','Sulphadoxine/Pyrimethamine 500mg/25mg Tablet [5/5]');
 assert.equal(packs.allMatch,true); assert.equal(packs.items[0].fulfillment.conversion?.supplied,50);
 const short=await run('Sulphadoxine/Pyrimethamine 500mg/25mg Tablet - 50 blisters','Sulphadoxine/Pyrimethamine 500mg/25mg Tablet [4/5]');
 assert.equal(short.allMatch,false); assert.equal(short.items[0].difference,10);
});

test('missing quantities and unconfirmed unit conversions cannot pass or default to one',async()=>{
 const missing=await run('PCM','Paracetamol [5/5]');
 assert.equal(missing.allMatch,false); assert.equal(missing.items[0].fulfillment.requestedQuantityMissing,true);
 assert.equal(missing.items[0].requested,'Not provided');
 const units=await run('Cipro - 50 blisters','Ciprofloxacin - 5 packs');
 assert.equal(units.allMatch,false); assert.match(units.items[0].fulfillment.quantityError||'',/units differ/);
 assert.deepEqual(units.generalAudit.semanticReviews,[]);
});


test('screenshot abbreviations match catalogue names without dose or bottle-size discrepancies',async()=>{
 const pairs=[['susp metronidazole 100ml','Metronidazole Suspension 200mg/5ml, 100ml'],
  ['Metronidazole 100ml bottle oral suspension','Suspension Metronidazole 200mg/5ml, 100ml'],
  ['inj. Diclofenac 75mg/ 3mls','Diclofenac 25mg/mL Injection, 3mL'],
  ['syrup paracetamol 100ml','Paracetamol 120mg/5mL Syrup, 100mL']];
 for(const [request,log] of pairs){
  const result=await runGeneralProductNameAudit(headers+request+' - 20',headers+log+' [20/20]',{revision:1,products:defaultProducts()},{},noAI);
  assert.equal(result.allMatch,true,JSON.stringify(result.items));assert.equal(result.semanticAnalysis.status,'skipped');
  assert.equal(result.items.length,1);assert.ok(result.productMatchingDiagnostics.every(d=>d.customer.every(p=>!p.geminiCalled))); 
  const short=await runGeneralProductNameAudit(headers+request+' - 20',headers+log+' [19/20]',{revision:1,products:defaultProducts()},{},noAI);
  assert.equal(short.items.length,1);assert.equal(short.items[0].status,'pending order limit');
 }
});

test('shortened iron-polymaltose name uses AI only after catalogue lookup then reuses the saved alias',async()=>{
 const name='Iron (III) Hydroxide Polymaltose Complex 50mg/5ml Suspension, 200mL';
 const original={revision:1,products:[{...catalog.products[0],id:'iron',name,aliases:[]}]};
 const request=headers+'Iron iii polymaltose - 20',log=headers+name+' [20/20]';let saved=original;
 const client=()=>({models:{async generateContent(options:any){const input=JSON.parse(options.contents);
  assert.deepEqual(input.unknownNames,['Iron iii polymaltose']);
  return{text:JSON.stringify({matches:[{alias:'Iron iii polymaltose',productId:'iron',confidence:0.99}]})};}}});
 const first=await runGeneralProductNameAudit(request,log,original,{},client,async aliases=>saved=approveAliasesInExistingCatalog(saved,aliases,'auditor'));
 assert.equal(first.allMatch,false);assert.equal(first.aliasLearning.status,'review_required');
 saved=approveAliasesInExistingCatalog(saved,[{alias:'Iron iii polymaltose',productId:'iron'}],'auditor');
 const again=await runGeneralProductNameAudit(request,log,saved,{},noAI);
 assert.equal(again.allMatch,true);assert.equal(again.semanticAnalysis.status,'skipped');
});


test('exact Anyinofi order preserves six product quantities and separates the two Paracetamol entries',async()=>{
 const customer=`Name of Orderer:Emmanuel
Name of Health Facility:Anyinofi Health Centre
Delivery/ Drop area:NEAR THE HEALTH CENTER
District:SAP
Products and Quantities:6/6
1 susp metronidazole 100ml 20/20
2 inj. Diclofenac 75mg/ 3mls 30/30
3 Artesunate injection 120mg 10/10
4 Paracetamol 500mg 20/20
5 syrup paracetamol 125ml 30/30
6 syrup Iron iii polymaltose 20/20`;
 const fulfillment=`Thank you Emmanuel Adomako from Anyinofi HC for ordering with Zipline. We have received your order (ID: G83PDPV6PP). Use this link to track your order: https://orders.zipline.com/t/7/G83PDPV6PP We will now prepare the following items for delivery:
- Artesunate 120mg injection [10/10]
- Diclofenac 25mg/mL Injection, 3mL [10/10]
- Iron (III) Hydroxide Polymaltose Complex 50mg/5ml Suspension, 200mL [10/10]
- Metronidazole Suspension 200mg/5ml, 100ml [10/10]
- Paracetamol 120mg/5mL Syrup, 100mL [10/10]
- Paracetamol 500mg Tablet [5/5]
Expected delivery: between October 26, 2026 12:30 PM and October 26, 2026 05:00 PM. Let us know if any changes are required or contact 0800719102 if any questions.
You will receive your flight notifications via SMS`;
 const products=[...defaultProducts(),{...catalog.products[0],id:'approved-iron-suspension',name:'Iron (III) Hydroxide Polymaltose Complex 50mg/5ml Suspension, 200mL',aliases:['syrup Iron iii polymaltose']}];
 const result=await runGeneralProductNameAudit(customer,fulfillment,{revision:1,products},{},noAI);
 assert.equal(result.allMatch,false);assert.equal(result.items.length,6);
 assert.equal(result.items.filter(item=>item.status==='pending order limit').length,4);
 assert.equal(result.items.filter(item=>item.status==='match').length,1);
 const identity=result.items.filter(item=>item.status==='product identity discrepancy');
 assert.equal(identity.length,1);assert.equal(identity[0].fulfillment.requested,30);assert.equal(identity[0].fulfillment.supplied,10);
 assert.ok(result.items.every(item=>!['missing item','extra item'].includes(item.status)));
 assert.equal(result.generalAudit.facility.status,'match');
 assert.equal(result.generalAudit.orderer.status,'match');
 assert.match(result.generalAudit.discrepancies.join(' '),/Product identity conflict/);
 const markup=renderToStaticMarkup(createElement(Inventory,{items:result.items,details:result.generalAudit,onConfirm:async()=>{},onOrderLimit(){}}));
 assert.match(markup,/Paracetamol 500mg Tablet/);assert.match(markup,/Paracetamol/);
});


test('equal ingredient totals cannot hide swapped syrup and tablet quantities',async()=>{
 const result=await run('Paracetamol 500mg - 20\nParacetamol syrup - 30','Paracetamol 500mg Tablet [30/30]\nParacetamol 120mg/5ml Syrup [20/20]');
 assert.equal(result.allMatch,false);assert.equal(result.items.length,2);
 assert.deepEqual(result.items.map(item=>item.status),['quantity mismatch','pending order limit']);
 assert.ok(result.items.every(item=>item.difference===10));
 const counted=await run('6 PCM','Paracetamol [6/6]');
 assert.equal(counted.allMatch,true);assert.equal(counted.items[0].fulfillment.requested,6);
});

test('saved canonical IDs and approved brand aliases win over AI and preserve diagnostic evidence',async()=>{
 const products=[{...catalog.products[0],aliases:['PCM','Panadol']}];
 let calls=0;
 const result=await runGeneralProductNameAudit(headers+'Panadol - 30',headers+'Paracetamol 500mg Tablet [10/10]',{revision:19,products},{},()=>{calls++;throw Error('not needed')});
 assert.equal(calls,0);assert.equal(result.items.length,1);assert.equal(result.items[0].difference,20);
 assert.equal(result.items[0].fulfillment.orderLimitEligible,true);
 const diagnostic=result.productMatchingDiagnostics[0];
 assert.equal(diagnostic.catalogRevision,19);assert.equal(diagnostic.customer[0].catalogProductId,'pcm');
 assert.equal(diagnostic.fulfillment[0].catalogProductId,'pcm');assert.equal(diagnostic.customer[0].alias,'Panadol');
 assert.equal(diagnostic.customer[0].matchSource,'Alias');assert.equal(diagnostic.customer[0].originalName,'Panadol');
 assert.ok(diagnostic.customer[0].normalizedName);assert.equal(diagnostic.customer[0].geminiCalled,false);
});

test('conflicting bottle sizes cannot pass or reach AI; approved whole-source aliases can define a mapping',async()=>{
 const products=[catalog.products[1]];
 const a=headers+'Paracetamol Syrup 125ml - 30',b=headers+'Paracetamol 120mg/5ml Syrup 100ml [30/30]';
 const result=await runGeneralProductNameAudit(a,b,{revision:1,products},{},noAI);
 assert.equal(result.allMatch,false);assert.ok(result.productMatchingDiagnostics.every(d=>[...d.customer,...d.fulfillment].every(p=>!p.geminiCalled)));
 assert.match(result.generalAudit.discrepancies.join(' '),/Product identity conflict/);
 const approved={...products[0],aliases:['Paracetamol Syrup 125ml']};
 assert.equal((await runGeneralProductNameAudit(a,b,{revision:2,products:[approved]},{},noAI)).allMatch,true);
});

test('fresh catalogue revisions remove stale aliases and unknown AI cannot invent IDs',async()=>{
 const first={revision:1,products:[{...catalog.products[0],aliases:['Savedbrand']}]};
 const a=headers+'Savedbrand - 5',b=headers+'Paracetamol 500mg Tablet [5/5]';
 assert.equal((await runGeneralProductNameAudit(a,b,first,{},noAI)).allMatch,true);
 const fresh={revision:2,products:[{...catalog.products[0],aliases:[]}]};
 const result=await runGeneralProductNameAudit(a,b,fresh,{semanticTimeoutMs:0},noAI);
 assert.equal(result.allMatch,false);assert.equal(result.productMatchingDiagnostics[0].customer[0].catalogProductId,null);
 assert.equal(result.productMatchingDiagnostics[0].customer[0].geminiCalled,false);
 assert.match(result.productMatchingDiagnostics[0].customer[0].failureReason||'',/No approved/);
 await assert.rejects(()=>runGeneralProductNameAudit(a,b,undefined as any,{},noAI));
});

test('different catalogue IDs are never merged merely by removing clinical attributes',async()=>{
 const result=await run('Paracetamol 500mg Tablet - 5','Paracetamol 120mg/5ml Syrup [5/5]');
 assert.equal(result.allMatch,false);assert.equal(result.items.length,1);
 assert.equal(result.items[0].status,'product identity discrepancy');
 assert.notEqual(result.productMatchingDiagnostics[0].customer[0].catalogProductId,result.productMatchingDiagnostics[0].fulfillment[0].catalogProductId);
});

test('existing stockout and approved order-limit rules survive catalogue identity resolution',async()=>{
 const a=headers+'PCM - 30',b=headers+'Paracetamol 500mg Tablet [10/10]';
 const first=await runGeneralProductNameAudit(a,b,catalog,{},noAI);
 const key=first.items[0].fulfillment.key;
 const limited=await runGeneralProductNameAudit(a,b,catalog,{generalOrderLimitDecisions:{[key]:true}},noAI);
 assert.equal(limited.items[0].status,'order limit applied');assert.equal(limited.allMatch,true);
 const declined=await runGeneralProductNameAudit(a,b,catalog,{generalOrderLimitDecisions:{[key]:false}},noAI);
 assert.equal(declined.items[0].status,'quantity mismatch');assert.equal(declined.allMatch,false);
 const empty=await run('PCM - 30','Paracetamol 500mg Tablet [0/30]');
 assert.equal(empty.items[0].status,'out of stock');assert.equal(empty.items[0].fulfillment.supplied,0);
});

test('quantity shortfalls await an order-limit answer, use the fulfilment headline and clear only on approval',async()=>{
 const result=await run('PCM 30/30','Paracetamol 500mg Tablet [10/10]');
 const item=result.items[0],key=item.fulfillment.key;
 assert.equal(item.name,'Paracetamol 500mg Tablet');assert.equal(item.fulfillment.name,item.name);
 assert.equal(item.fulfillment.requested,30);assert.equal(item.fulfillment.supplied,10);
 assert.equal(item.status,'pending order limit');assert.equal(result.issueCount,0);
 assert.equal(result.allMatch,false);assert.equal(result.generalAudit.pendingOrderLimitCount,1);
 assert.deepEqual(result.generalAudit.discrepancies,[]);
 const main=renderToStaticMarkup(createElement(Inventory,{items:result.items,details:result.generalAudit,onConfirm:async()=>{},onOrderLimit(){}}));
 const extension=buildGeneralReport(result);
 for(const html of [main,extension]) {
  assert.match(html,/Was this quantity reduced because of an order limit/);assert.match(html,/Paracetamol 500mg Tablet/);
 }
 assert.match(extension,/<h4>Paracetamol 500mg Tablet<\/h4>/);
 const approved=acknowledgeOrderLimit(result,key,true);
 assert.equal(approved.allMatch,true);assert.equal(approved.issueCount,0);
 assert.equal(approved.items[0].status,'order limit applied');assert.deepEqual(approved.generalAudit.discrepancies,[]);
 assert.equal(approved.generalAudit.counts.orderLimited,1);assert.equal(approved.generalAudit.pendingOrderLimitCount,0);
 assert.equal(approved.items[0].fulfillment.difference,20); // approval preserves the actual shortfall
 const declined=acknowledgeOrderLimit(result,key,false);
 assert.equal(declined.allMatch,false);assert.equal(declined.issueCount,1);
 assert.equal(declined.items[0].status,'quantity mismatch');
 assert.equal(declined.generalAudit.discrepancies.length,1);
 const excess=await run('PCM 10/10','Paracetamol 500mg Tablet [30/30]');
 assert.equal(excess.items[0].fulfillment.orderLimitEligible,false);
 assert.equal(acknowledgeOrderLimit(excess,excess.items[0].fulfillment.key,true),excess);
 const wrongFacility=await runGeneralProductNameAudit(headers+'PCM 30/30',headers.replace('Domakwai','Gbangu')+'Paracetamol 500mg Tablet [10/10]',catalog,{},noAI);
 const stillBlocked=acknowledgeOrderLimit(wrongFacility,wrongFacility.items[0].fulfillment.key,true);
 assert.equal(stillBlocked.allMatch,false);assert.equal(stillBlocked.generalAudit.facility.status,'mismatch');
 assert.ok(stillBlocked.issueCount>0);
});

test('requested medicine pairs match approved repository IDs without missing/extra findings or Gemini',async()=>{
 const iron={...catalog.products[0],id:'approved-iron',name:'Iron (III) Hydroxide Polymaltose Complex Suspension',aliases:['syrup Iron iii polymaltose']};
 const repository={revision:21,products:[...defaultProducts(),iron]};
 for(const [a,b] of [
  ['susp metronidazole 100ml','Metronidazole Suspension 200mg/5ml, 100ml'],
  ['inj. Diclofenac 75mg/3mls','Diclofenac 25mg/mL Injection, 3mL'],
  ['syrup Iron iii polymaltose','Iron (III) Hydroxide Polymaltose Complex Suspension'],
 ]) {
  const result=await runGeneralProductNameAudit(headers+a+' 20/20',headers+b+' [20/20]',repository,{},noAI);
  assert.equal(result.allMatch,true,JSON.stringify(result.items));assert.equal(result.items.length,1);
  assert.equal(result.items[0].status,'match');assert.deepEqual(result.generalAudit.discrepancies,[]);
  const proof=result.productMatchingDiagnostics[0];
  assert.equal(proof.customer[0].catalogProductId,proof.fulfillment[0].catalogProductId);
  assert.equal(proof.customer[0].geminiCalled,false);assert.equal(proof.fulfillment[0].geminiCalled,false);
 }
 const conflict=await runGeneralProductNameAudit(headers+'syrup paracetamol 125ml 20/20',headers+'Paracetamol 120mg/5mL Syrup, 100mL [20/20]',repository,{},noAI);
 assert.equal(conflict.allMatch,false);assert.equal(conflict.items.length,1);
 assert.equal(conflict.items[0].status,'product identity discrepancy');assert.equal(conflict.issueCount,1);
 assert.doesNotMatch(conflict.generalAudit.discrepancies.join(' '),/missing|extra/i);
});

test('unresolved iron syrup is one identity discrepancy in both clients and cannot become a capsule alias',async()=>{
 const {buildGeneralReport}=await import('../extension/general-report.js');
 const result=await runGeneralProductNameAudit(headers+'syrup Iron iii polymaltose 20/20',headers+'Iron (III) Hydroxide Polymaltose Complex Suspension [10/10]',{revision:1,products:defaultProducts()},{},noAI);
 assert.equal(result.allMatch,false);assert.equal(result.items.length,1);assert.equal(result.issueCount,1);
 assert.equal(result.items[0].status,'product identity discrepancy');assert.equal(result.items[0].fulfillment.orderLimitEligible,false);
 assert.equal(result.items[0].fulfillment.requested,20);assert.equal(result.items[0].fulfillment.supplied,10);
 const main=renderToStaticMarkup(createElement(Summary,{details:result.generalAudit}));
 const extension=buildGeneralReport(result);
 for(const html of [main,extension]) {
  assert.match(html,/Product Identity Discrepanc/i);assert.doesNotMatch(html,/Missing Products|Extra Products|missing from System Entry|extra in System Entry/);
  assert.doesNotMatch(html,/Dosage \/ formulation|clinical specifications conflict/i);
 }
});

test('validated alias cache reuses repository resolutions and invalidates on in-place alias edits',async()=>{
 const {resolveGeneralCatalogIdentity}=await import('../src/utils/generalProductLog');
 const products=[{...catalog.products[0],aliases:['Approvedbrand']}];
 const first=resolveGeneralCatalogIdentity('Approvedbrand',products);
 const next=resolveGeneralCatalogIdentity('Approvedbrand',JSON.parse(JSON.stringify(products)));
 assert.equal(first,next);assert.equal(next.product?.id,'pcm');
 products[0].aliases=[];
 const changed=resolveGeneralCatalogIdentity('Approvedbrand',products);
 assert.equal(changed.product,undefined);assert.equal(changed.recognized,false);
});

test('quantity and compulsory identity checks survive product cleanup while optional fields stay informational',async()=>{
 const customer=headers+'District: Alpha\nPCM 30/30';
 const log=headers.replace('Domakwai CHPS','Gbangu CHPS').replace('Frimpong Vivian','Mary Mensah')+'District: Beta\nParacetamol 500mg Tablet [10/10]';
 const result=await runGeneralProductNameAudit(customer,log,catalog,{},noAI);
 assert.equal(result.allMatch,false);assert.equal(result.items[0].status,'pending order limit');assert.equal(result.items[0].difference,20);
 const baseline=runGeneralAuditor(customer.replace(/^District:.*$/gm,''),log.replace(/^District:.*$/gm,''));
 assert.equal(result.generalAudit.district?.status,'informational');
 for(const field of ['facility','orderer'] as const) {
  assert.deepEqual(result.generalAudit[field],baseline.generalAudit[field]);assert.notEqual(result.generalAudit[field]?.status,'match');
 }
});


test('optional delivery areas and districts never create discrepancies',async()=>{
 for(const [a,b] of [['Delivery/Drop area: Back gate\nDistrict: Alpha\n','Delivery/Drop area: Front gate\nDistrict: Beta\n'],['District: Alpha\n',''],['','District: Beta\n']]) {
  const result=await runGeneralProductNameAudit(headers+a+'PCM Qty 20',headers+b+'Paracetamol 500mg Tablet [20/20]',catalog,{},noAI);
  assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));assert.equal(result.issueCount,0);
  assert.equal(result.items[0].fulfillment.requested,20);assert.match(result.generalAudit.finalStatus,/Audit Passed/);
 }
});

test('single-item list numbering, Qty and units preserve strengths and quantities',async()=>{
 for(const line of ['1 Paracetamol 500mg 20/20','Paracetamol 500mg Qty 20','Paracetamol 500mg quantity: 20','Paracetamol 500mg 20 units']) {
  const result=await runGeneralProductNameAudit(headers+line,headers+'Paracetamol 500mg Tablet [20/20]',catalog,{},noAI);
  assert.equal(result.allMatch,true,JSON.stringify(result.items));assert.equal(result.items[0].fulfillment.requested,20);assert.match(result.items[0].provenance[0].name,/500mg/);
 }
});

test('audit AI proposals are queued pending, retain confidence, and concurrent requests share one Gemini call',async()=>{
 let calls=0;const queued:any[]=[];
 const client=()=>({models:{async generateContent(){calls++;await new Promise(resolve=>setTimeout(resolve,20));return{text:JSON.stringify({matches:[{alias:'New unfamiliar brand',productId:'pcm',confidence:0.81,clinicalUncertainty:true,reason:'Needs catalogue editor verification.'}]})};}}});
 const a=headers+'New unfamiliar brand Qty 20',b=headers+'Paracetamol 500mg Tablet [20/20]';
 const support={suggestCatalogueAliases:async(rows:any[])=>{queued.push(...rows);}};
 const results=await Promise.all([runGeneralProductNameAudit(a,b,catalog,support,client),runGeneralProductNameAudit(a,b,catalog,support,client)]);
 assert.equal(calls,1);assert.ok(results.every(result=>!result.allMatch&&result.aliasLearning.status==='review_required'));
 assert.ok(queued.every(row=>row.productId==='pcm'&&row.confidence===0.81&&row.clinicalUncertainty));
 assert.ok(results.some(result=>result.geminiMetrics.coalesced));assert.ok(results.every(result=>result.geminiMetrics.necessary));
});

test('approved antimalarial abbreviations use uniquely verified FS context without guessing',async()=>{
 const product={...catalog.products[0],id:'al',name:'Artemether/Lumefantrine 20mg/120mg Tablet',aliases:['AL','ACT'],contextualAliases:['AL','ACT']};
 const repository={revision:1,products:[product,catalog.products[2]]};
 for(const alias of ['AL','ACT']) {
  const result=await runGeneralProductNameAudit(headers+alias+' 20/20',headers+product.name+' [20/20]',repository,{},noAI);
  assert.equal(result.allMatch,true,JSON.stringify(result.items));assert.equal(result.productMatchingDiagnostics[0].customer[0].catalogProductId,'al');assert.equal(result.geminiMetrics.requestStarted,false);
 }
 const uncertain=await runGeneralProductNameAudit(headers+'ACT 20/20',headers+'Cipro [20/20]',repository,{},noAI);
 assert.equal(uncertain.allMatch,false);assert.equal(uncertain.geminiMetrics.requestStarted,false);
});

test('optional districts cannot indirectly fail a directory-verified compulsory facility match',async()=>{
 const support={facilityContext:{records:[{id:'unique-domakwai',name:'Domakwai CHPS',district:'Alpha',source:'test/unique'}]}};
 const result=await runGeneralProductNameAudit(headers+'District: Alpha\nPCM 20/20',headers+'District: Beta\nParacetamol 500mg Tablet [20/20]',catalog,support,noAI);
 assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));assert.equal(result.generalAudit.facility.status,'match');
 assert.equal(result.meta.facilityName.status,'match');assert.equal(result.meta.district.status,'informational');
});

test('Gemini quota failures are briefly cached while recognized products continue deterministic quantity auditing',async()=>{
 let calls=0;
 const provider=()=>({models:{async generateContent(){calls++;throw Object.assign(Error('quota exhausted'),{status:429});}}});
 const customer=headers+'UnfamiliarQuotaBrand - 5\nPCM - 30',fulfillment=headers+'Paracetamol 500mg Tablet [10/10]';
 const support={semanticCacheScope:'quota-regression'};
 for(let i=0;i<2;i++) {
  const result=await runGeneralProductNameAudit(customer,fulfillment,catalog,support,provider);
  assert.equal(result.allMatch,false);assert.equal(result.semanticAnalysis.status,'fallback');
  assert.ok(result.items.some(item=>item.status==='product identity discrepancy'));
  assert.ok(result.items.some(item=>item.status==='pending order limit'&&item.fulfillment.requested===30&&item.fulfillment.supplied===10));
 }
 assert.equal(calls,1);
});

test('Gemini receives bounded relevant product candidates without customer or facility identities',async()=>{
 const products=[...catalog.products,...Array.from({length:100},(_,i)=>({...catalog.products[0],id:`unrelated-${i}`,name:`Unrelated medicine ${i}`,aliases:[]}))];
 let sent:any;
 const result=await runGeneralProductNameAudit(headers+'UnknownRequestedBrand - 5',headers+'Paracetamol 500mg Tablet [5/5]',{revision:51,products},{semanticCacheScope:'candidate-privacy'},()=>({models:{async generateContent(input:any){sent=JSON.parse(input.contents);return{text:JSON.stringify({matches:[{alias:'UnknownRequestedBrand',productId:'pcm',confidence:1,clinicalUncertainty:false}]})};}}}));
 assert.ok(sent);assert.ok(sent.catalog.length<=24);assert.ok(sent.catalog.length<products.length);
 assert.doesNotMatch(JSON.stringify(sent),/Frimpong|Domakwai/);
 assert.equal(result.allMatch,false);assert.equal(result.aliasLearning.status,'review_required');
});

test('zero stock ratios are informational, positive partial quantities need a limit decision, and an absent product is missing',async()=>{
 for(const ratio of ['0/20','[0/20]']) {
  const result=await run('PCM 20/20',`Paracetamol 500mg Tablet ${ratio}`);
  assert.equal(result.items[0].status,'out of stock');assert.equal(result.issueCount,0);
  assert.equal(result.allMatch,true);assert.equal(result.generalAudit.counts.outOfStock,1);
 }
 const explicit=await run('PCM 20/20','Paracetamol 500mg Tablet - Out of Stock');
 assert.equal(explicit.items[0].status,'out of stock');assert.equal(explicit.issueCount,0);
 const partial=await run('PCM 20/20','Paracetamol 500mg Tablet [10/20]');
 assert.equal(partial.items[0].status,'pending order limit');assert.equal(partial.generalAudit.counts.outOfStock,0);
 const absent=await run('PCM 20/20','');
 assert.equal(absent.allMatch,false);assert.equal(absent.items[0].status,'missing item');
});

test('equivalent injection concentration cannot hide a conflicting declared ampoule volume',async()=>{
 const products=[{...catalog.products[0],id:'diclo-small',name:'Diclofenac 25mg/mL Injection, 1mL',aliases:[]}];
 const result=await runGeneralProductNameAudit(headers+'inj Diclofenac 75mg/3ml - 5',headers+'Diclofenac 25mg/mL Injection, 1mL [5/5]',{revision:61,products},{},noAI);
 assert.equal(result.allMatch,false);assert.equal(result.items[0].status,'product identity discrepancy');
 assert.equal(result.items[0].fulfillment.orderLimitEligible,false);
});

test('compiled extension acknowledgements preserve unresolved identity checks exactly like the website',async()=>{
 const {readFile}=await import('node:fs/promises');
 const code=await readFile(new URL('../extension/order-limits.js',import.meta.url),'utf8');
 const browser=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const result=await run('PCM - 30\nUnknownClinicalBrand - 5','Paracetamol 500mg Tablet [10/10]\nCiprofloxacin 2mg/ml Infusion [5/5]');
 const key=result.items.find(item=>item.fulfillment.orderLimitEligible)!.fulfillment.key;
 const website=acknowledgeOrderLimit(result,key,true),extension=browser.acknowledgeOrderLimit(result,key,true);
 assert.equal(website.allMatch,false);assert.equal(extension.allMatch,false);
 assert.deepEqual(extension.items,website.items);assert.equal(extension.issueCount,website.issueCount);
 assert.ok(extension.items.some((item:any)=>item.status==='product identity discrepancy'));
 assert.equal(typeof browser.applyAuditProductLog,'function');
});

test('General Auditor preserves configured vaccine accessories without treating a correct dropper as extra',async()=>{
 const repository={revision:71,products:defaultProducts()};
 const audit=(log:string)=>runGeneralProductNameAudit(headers+'OPV - 3',headers+log,repository,{},noAI);
 const paired=await audit('OPV [3/3]\nOPV Dropper [3/3]');
 assert.equal(paired.allMatch,true,JSON.stringify(paired.items));
 assert.ok(!paired.items.some(item=>item.status==='extra item'));
 const missing=await audit('OPV [3/3]');
 assert.equal(missing.allMatch,false);assert.ok(missing.items.some(item=>item.status==='vaccine pairing mismatch'));
 const wrong=await audit('OPV [3/3]\nOPV Dropper [2/2]');
 assert.equal(wrong.allMatch,false);assert.ok(wrong.issueCount>0);
});
