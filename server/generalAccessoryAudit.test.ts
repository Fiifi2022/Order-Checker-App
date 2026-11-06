import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultProducts,applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {extractGeneralStructuredPreview,projectGeneralStructuredSource,applyGeneralExtractionSubmission,finishGeneralStructuredAudit} from './generalStructuredExtraction';
import {applySourceProductConfirmation} from './generalSourceProductConfirmation';
const customer='Joseph Gumah from Gbimsi CHPS\nGood morning.\nKindly serve us with the following vaccines in vials:\n1. Measles — 3\n2. Men A — 2\n3. Yellow Fever — 2\n4. Rota — 15\n5. OPV — 2';
const products=['Measles and Rubella Vaccine Diluent [3/3]','Measles & Rubella Vaccine [3/3]','Meningococcal Conjugate A Vaccine Diluent [2/2]','Meningococcal Conjugate A Vaccine [2/2]','Oral Polio Vaccine Dropper [2/2]','Oral Polio Vaccine (1&3) [2/2]','Rotavirus Vaccine Dropper [15/15]','Rotavirus Vaccine [15/15]','Yellow Fever Vaccine [2/2]','Yellow Fever Vaccine Diluent [2/2]'];
const actor={id:'accessory-cca',name:'CCA'},catalog=()=>({revision:99001,products:defaultProducts()});
async function run(lines=products,request=customer,c=catalog()){
 applyCatalog(c);const whatsappMessage=request,fulfillmentConfirmation='Thank you Joseph Gumah from Gbimsi CHPS for ordering with Zipline. We will now prepare the following items for delivery:\n'+lines.map(p=>'- '+p).join('\n');
 const p=extractGeneralStructuredPreview(whatsappMessage,fulfillmentConfirmation,c);let calls=0;
 const ex=applyGeneralExtractionSubmission(p,{version:1,inputFingerprint:p.inputFingerprint,catalogRevision:c.revision,edits:[],confirmedFields:[],reason:'',acknowledged:false},actor);
 const result=finishGeneralStructuredAudit(await runGeneralProductNameAudit(projectGeneralStructuredSource(p.customer,'customer'),projectGeneralStructuredSource(p.fulfillment,'fulfillment'),c,{generalOnlySmartMatching:true,requestLanguage:true,deferProductResearch:true,semanticTimeoutMs:0},()=>{calls++;throw Error('Known accessories must not need AI');}),ex);
 return {record:{...result,id:'accessory-test',createdByUserId:actor.id,whatsappMessage,fulfillmentConfirmation},preview:p,c,calls};
}
test('all ten FS entries are parsed before pairing, and none of the present accessories are missing',async()=>{
 const {record,preview,calls}=await run();assert.equal(preview.customer.products.length,5);assert.equal(preview.fulfillment.products.length,10);assert.deepEqual(preview.customer.unreadProducts,[]);
 assert.equal(record.generalAudit.orderer.status,'match');assert.equal(record.generalAudit.facility.status,'match');assert.equal(calls,0);
 assert.doesNotMatch(JSON.stringify(record.generalAudit.discrepancies),/Required (?:diluent|dropper) missing|Measles and Rubella Vaccine Diluent.*Conflicting/);
 assert.equal(record.items.length,10);assert.equal(record.allMatch,false,'Measles identity must still be confirmed');
 const review=record.generalAudit.catalogueSuggestions.find((g:any)=>g.alias==='Measles');assert.ok(review);assert.deepEqual(review.options.map((o:any)=>o.name),['Measles & Rubella Vaccine']);
 assert.ok(record.items.filter((i:any)=>/Diluent|Dropper/.test(i.name)).every((i:any)=>i.status==='match'));
});
test('CCA confirmation resumes the same audit and accounts for the MR diluent independently',async()=>{
 const {record,c}=await run(),group=record.generalAudit.catalogueSuggestions.find((g:any)=>g.alias==='Measles');assert.ok(group);
 const updated=applySourceProductConfirmation(record,group.alias,group.options[0].sourceName,c,actor);
 assert.equal(updated.id,record.id);assert.equal(updated.allMatch,true);assert.equal(updated.generalAudit.discrepancies.length,0);assert.equal(updated.generalAudit.sourceProductConfirmations.length,1);
});
for(const name of ['Meningococcal Conjugate A Vaccine Diluent','Oral Polio Vaccine Dropper'])test(`genuinely missing ${name} is still detected once`,async()=>{
 const {record}=await run(products.filter(p=>!p.startsWith(name+' [')),customer.replace('Measles —','MR —'));
 assert.equal(record.allMatch,false);assert.equal(record.generalAudit.discrepancies.filter((d:string)=>/Required (?:diluent|dropper) missing/.test(d)).length,1);
});
test('a present accessory with the wrong quantity produces a quantity finding, not a missing finding',async()=>{
 const {record}=await run(products.map(p=>p.startsWith('Rotavirus Vaccine Dropper')?p.replace('[15/15]','[14/14]'):p),customer.replace('Measles —','MR —'));
 assert.equal(record.allMatch,false);assert.ok(record.generalAudit.discrepancies.some((d:string)=>/companion quantity mismatch/.test(d)));assert.doesNotMatch(record.generalAudit.discrepancies.join(' '),/Required dropper missing/);
});
for(const order of [products,[...products].reverse()])test('accessories are accounted for regardless of FS entry order',async()=>{
 const {record,calls}=await run(order,customer.replace('Measles —','MR —'));assert.equal(record.allMatch,true);assert.equal(calls,0);
});

test('approved accessory aliases work without editing catalogue data',async()=>{
 const c=catalog(),before=JSON.stringify(c);
 const lines=products.map(p=>p.replace('Measles and Rubella Vaccine Diluent','MR water').replace('Meningococcal Conjugate A Vaccine Diluent','Men A solvent').replace('Oral Polio Vaccine Dropper','OPV pipette').replace('Rotavirus Vaccine Dropper','RV dropper'));
 const {record,calls}=await run(lines,customer.replace('Measles —','MR —'),c);assert.equal(record.allMatch,true);assert.equal(calls,0);assert.equal(JSON.stringify(c),before);
});
test('duplicate accessory catalogue mappings remain reviewable without missing or extra warnings or automatic deletion',async()=>{
 const c=catalog();for(const id of ['duplicate-mr-a','duplicate-mr-b'])c.products.push({id,name:'MR Diluent',scope:'general',category:'companion',aliases:['Measles and Rubella Vaccine Diluent'],contextualAliases:[],note:''});
 const before=JSON.stringify(c),{record}=await run(products,customer.replace('Measles —','MR —'),c);
 assert.equal(record.allMatch,false);assert.doesNotMatch(record.generalAudit.discrepancies.join(' '),/Required diluent missing|MR Diluent extra|Measles and Rubella Vaccine Diluent extra/);
 const group=record.generalAudit.catalogueSuggestions.find((g:any)=>g.alias==='Measles and Rubella Vaccine Diluent');assert.ok(group);assert.ok(group.options.some((o:any)=>o.productId==='duplicate-mr-a'));assert.ok(group.options.some((o:any)=>o.productId==='duplicate-mr-b'));assert.equal(JSON.stringify(c),before);
});
test('stockouts and approved order-limit reductions preserve accessory requirements for actual supplied vaccine quantities',async()=>{
 const request=customer.replace('Measles —','MR —');
 const zero=products.map(p=>/Yellow Fever/.test(p)?p.replace('[2/2]','[0/1]'):p);assert.equal((await run(zero,request)).record.allMatch,true);
 const limited=products.map(p=>p.startsWith('Rotavirus Vaccine [')?p.replace('[15/15]','[10/10] (order limit applied)'):p.startsWith('Rotavirus Vaccine Dropper')?p.replace('[15/15]','[10/10]'):p);
 assert.equal((await run(limited,request)).record.allMatch,true);
});
test('unknown vaccines do not consume a known vaccine accessory or clear the audit',async()=>{
 const {record,calls}=await run([...products,'Unrecognized vaccine ZYX [1/1]'],customer.replace('Measles —','MR —')+'\n6. Unknown vaccine ABC - 1');assert.equal(record.allMatch,false);assert.equal(calls,0);assert.ok(record.items.some((i:any)=>/ZYX|ABC/.test(i.name)));
});
test('structured preview and result UI show each vaccine, FS accessory and quantity with CCA controls for the identity question',async()=>{
 const {createElement}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{parseHTML}=await import('linkedom'),{default:Inventory}=await import('../src/components/GeneralInventory'),{default:Preview}=await import('../src/components/GeneralExtractionPreview');
 const {record,preview}=await run();assert.equal(preview.accessoryChecks?.length,5);
 const previewHtml=renderToStaticMarkup(createElement(Preview,{preview,onCompare:async()=>{},onCancel(){}}));assert.match(previewHtml,/Vaccine and accessory verification/);assert.match(previewHtml,/Awaiting comparison/);
 const html=renderToStaticMarkup(createElement(Inventory,{record,items:record.items,details:record.generalAudit,onOrderLimit(){},onResearchAction:async()=>{}}));
 const {document}=parseHTML(html);const table=document.querySelector('[aria-label="Vaccine and accessory verification"]');assert.ok(table);assert.equal(table.querySelectorAll('tbody tr').length,5);assert.match(table.textContent,/Measles and Rubella Vaccine Diluent/);assert.match(table.textContent,/15/);assert.match(html,/Confirm Match|Reject this suggestion/);assert.doesNotMatch(table.textContent,/Required accessory missing/);
});
test('fresh calculations and saved-result reconstruction do not restore obsolete missing accessory warnings',async()=>{
 const {generalFourParameterRecord}=await import('./generalAuditor');
 const failed=await run(products.filter(p=>!p.startsWith('Oral Polio Vaccine Dropper')),customer.replace('Measles —','MR —'));assert.equal(failed.record.allMatch,false);
 const fresh=await run(products,customer.replace('Measles —','MR —'));assert.equal(fresh.record.allMatch,true);
 const rebuilt=generalFourParameterRecord(JSON.parse(JSON.stringify(fresh.record)));assert.equal(rebuilt.allMatch,true);assert.deepEqual(rebuilt.generalAudit.discrepancies,[]);
});

test('explicit vaccine-list count units survive header cleanup and explicit line units win',async()=>{
 const c=catalog(),fs='Name: Joseph Gumah\nFacility: Gbimsi CHPS\nMeasles & Rubella Vaccine [3/3]\nMR Diluent [3/3]\nRotavirus Vaccine [15/15]\nRota Dropper [15/15]';
 const preview=extractGeneralStructuredPreview('Joseph Gumah from Gbimsi CHPS\nPlease supply the following vaccines in doses:\n1. MR - 30\n2. Rota - 15 vials',fs,c);
 assert.deepEqual(preview.customer.products.map(p=>[p.name,p.quantity,p.unit]),[['MR',30,'dose'],['Rota',15,'vial']]);
 assert.deepEqual(preview.customer.unreadProducts,[]);
 const {record}=await run(['Measles & Rubella Vaccine [30/30] doses','MR Diluent [3/3]'],'Joseph Gumah from Gbimsi CHPS\nPlease supply the following vaccines in doses:\n1. MR - 30',c);
 assert.equal(record.allMatch,true);
});
test('Search Again keeps the local vaccine-only choice, and rejection does not clear the audit',async()=>{
 const {productResearchActions}=await import('./productResearchActions'),{generalInputFingerprint}=await import('../shared/generalAuditFingerprint');
 let {record,c}=await run();const originalItems=JSON.stringify(record.items);let calls=0;
 const handler=productResearchActions({read:async()=>record,catalog:async()=>c,getClient:()=>{calls++;throw Object.assign(Error('Rate limited'),{status:429});},save:async value=>{record=value;},confirm:async()=>{throw Error('Research must never confirm');}});
 const invoke=async(body:any)=>{let status=200;await handler({params:{id:record.id},body:{alias:'Measles',researchRevision:0,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record),...body}} as any,{locals:{authUser:actor},status(code:number){status=code;return this;},json(){}} as any,()=>{});assert.equal(status,200);};
 await invoke({action:'research'});assert.equal(calls,0);assert.equal(JSON.stringify(record.items),originalItems);
 const group=record.generalAudit.catalogueSuggestions.find((g:any)=>g.alias==='Measles');assert.deepEqual(group.options.map((o:any)=>o.name),['Measles & Rubella Vaccine']);
 await invoke({action:'reject',researchRevision:group.researchRevision,productId:group.options[0].productId});assert.equal(record.allMatch,false);assert.doesNotMatch(record.generalAudit.discrepancies.join(' '),/Required (?:diluent|dropper) missing/);
 assert.equal(record.generalAudit.catalogueSuggestions.find((g:any)=>g.alias==='Measles').options.length,0);
});
