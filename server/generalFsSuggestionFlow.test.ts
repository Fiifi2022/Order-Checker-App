import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseHTML} from 'linkedom';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import {scopeGeneralFsSuggestion} from './generalFsSuggestions';
import {productResearchActions} from './productResearchActions';
import {applySourceProductConfirmation} from './generalSourceProductConfirmation';
import {applyGeneralOrderLimitDecision} from './generalAuditor';
import {createGeneralAuditRun,completeGeneralAuditRun} from '../src/utils/generalAuditRun';
import {generalInputFingerprint} from '../shared/generalAuditFingerprint';
import Inventory from '../src/components/GeneralInventory';
import type {ProductCatalog} from '../shared/productCatalog';

const product=(id:string,name:string,aliases:string[]=[])=>({id,name,aliases,scope:'general' as const,category:'medicine',contextualAliases:[],note:''});
const catalog:ProductCatalog={revision:9600,products:[product('folic','Folic Acid',['Folate']),product('folic5','Folic acid 5mg Tablet'),product('folic1','Folic acid 1mg Tablet'),
  product('d5','Dextrose 5% Infusion, 500mL',['D5%']),product('rl',"Ringer's Lactate Solution, 500mL",['RL']),
  product('zinc','Zinc sulfate'),product('zinc20','Zinc sulfate 20mg Tablet')]};
const h='Name of Orderer: Test Operator\nName of Health Facility: Example HC\n';
const fsNames=['Dextrose 5% Infusion, 500mL','Folic acid 5mg Tablet',"Ringer's Lactate Solution, 500mL"];
const values=['[15/15]','[1/1]','[10/10]'];
async function flow(customer='Folic acid - 4\nD5% - 15\nRL - 10',format='bullets',names=fsNames,quantities=values){
  applyCatalog(catalog);let calls=0;
  const products=names.map((name,index)=>`${name} ${quantities[index]}`);
  const body=format==='inline'?products.map(p=>'- '+p).join(' '):products.map((p,i)=>(format==='numbered'?`${i+1}. `:format==='unicode'?'• ':'- ')+p).join('\n');
  const whatsappMessage=h+'Products and quantities:\n'+customer;
  const fulfillmentConfirmation='Thank you Test Operator from Example HC for ordering with Zipline. We have received your order (ID: TESTORDER).\nWe will now prepare the following items for delivery: '+body+'\nLet us know if any changes are required or contact 0800719102 if any questions.\nYou will receive your flight notifications via SMS';
  const result=await runGeneralProductNameAudit(whatsappMessage,fulfillmentConfirmation,catalog,{requestLanguage:true,deferProductResearch:true,semanticTimeoutMs:0},()=>{calls++;throw Error('Local flow must not need AI');});
  const record={...result,id:'fs-flow',createdByUserId:'cca',auditScope:'general_auditor',whatsappMessage,fulfillmentConfirmation};
  const response=JSON.parse(JSON.stringify(record));
  const completed=completeGeneralAuditRun(createGeneralAuditRun({whatsappMessage,fulfillmentConfirmation},1,{}, {},true),response);
  return {record:completed,calls};
}
function suggestionText(record:any){
  const html=renderToStaticMarkup(createElement(Inventory,{items:record.items,details:record.generalAudit,onOrderLimit(){},onResearchAction:async()=>{}}));
  return parseHTML(html).document.querySelector('[aria-label="Review Suggestions"]')?.textContent||'';
}
for(const format of ['bullets','numbered','unicode','inline'])test(`actual WhatsApp-plus-FS ${format} flow scopes Folic acid before API completion and rendering`,async()=>{
  const {record,calls}=await flow(undefined,format);assert.equal(calls,0);
  const group=record.generalAudit.catalogueSuggestions.find((g:any)=>g.alias==='Folic acid');assert.ok(group);
  assert.equal(group.customerValue,'Folic acid');assert.equal(group.fulfillmentValue,'Folic acid 5mg Tablet');
  assert.deepEqual(group.options.map((o:any)=>o.name),['Folic acid 5mg Tablet']);
  const supplied=record.items.flatMap((i:any)=>i.provenance.filter((p:any)=>p.source==='fulfillment_confirmation'));
  assert.equal(supplied.length,3);assert.deepEqual(supplied.map((p:any)=>p.name).sort(),[...fsNames].sort());
  const text=suggestionText(record);assert.match(text,/Customer requested: Folic acid/);assert.match(text,/Possible FS match: Folic acid 5mg Tablet/);
  assert.doesNotMatch(text,/Dextrose|Ringer|Thank you|TESTORDER|0800719102|notifications/);
});
test('approved request aliases still produce only the relevant FS presentation',async()=>{
  const {record}=await flow('Folate - 4\nD5% - 15\nRL - 10');
  const group=record.generalAudit.catalogueSuggestions.find((g:any)=>g.alias==='Folate');
  assert.equal(group.fulfillmentValue,'Folic acid 5mg Tablet');assert.equal(group.options.length,1);
});
test('multiple customer products receive independent relevant FS candidates',async()=>{
  const {record}=await flow('Folic acid - 4\nZinc sulfate - 3\nD5% - 15','bullets',[fsNames[0],fsNames[1],'Zinc sulfate 20mg Tablet'],['[15/15]','[4/4]','[3/3]']);
  assert.deepEqual(record.generalAudit.catalogueSuggestions.map((g:any)=>[g.customerValue,g.fulfillmentValue]).sort(),[
    ['Folic acid','Folic acid 5mg Tablet'],['Zinc sulfate','Zinc sulfate 20mg Tablet']]);
});
test('a missing product never borrows an unrelated FS candidate',async()=>{
  const {record}=await flow('Folic acid - 4\nD5% - 15','bullets',[fsNames[0]],['[15/15]']);
  assert.equal(record.allMatch,false);assert.ok(record.items.some((i:any)=>i.status==='missing item'));
  assert.equal(record.generalAudit.catalogueSuggestions.length,0);
});
test('multiple relevant FS presentations stay separate; unrelated candidates are filtered at the source',()=>{
  const group=scopeGeneralFsSuggestion({alias:'Folic acid',status:'suggested',customerValue:'Folic acid; D5%',fulfillmentValue:'Entire script and all products',options:[
    {productId:'folic5',name:'Folic acid 5mg Tablet',reason:'Long irrelevant script',evidenceSource:'gemini'},
    {productId:'folic1',name:'Folic acid 1mg Tablet',reason:'Check presentation',evidenceSource:'gemini'},
    {productId:'d5',name:fsNames[0],reason:'Irrelevant context',evidenceSource:'gemini'}
  ]},[{name:'Folic acid'}],[...fsNames.map(name=>({name})),{name:'Folic acid 1mg Tablet'}],catalog);
  assert.deepEqual(group.options.map(o=>o.name),['Folic acid 5mg Tablet','Folic acid 1mg Tablet']);
  assert.equal(group.customerValue,'Folic acid');assert.doesNotMatch(JSON.stringify(group),/Dextrose|Ringer|Entire script|irrelevant script/);
});
test('an unfamiliar FS alias is associated only with its proposed customer product, not every requested product',()=>{
  const group=scopeGeneralFsSuggestion({alias:'Folic acd',status:'suggested',options:[{productId:'folic5',name:'Folic acid 5mg Tablet',reason:'Possible spelling variation',evidenceSource:'gemini'}]},
    [{name:'Folic acid 5mg Tablet'},{name:fsNames[0]},{name:fsNames[2]}],[{name:'Folic acd'},{name:fsNames[0]},{name:fsNames[2]}],catalog);
  assert.equal(group.customerValue,'Folic acid 5mg Tablet');assert.equal(group.fulfillmentValue,'Folic acd');
  assert.equal(group.options[0].productId,'folic5');assert.equal(group.options[0].name,'Folic acd');
});
test('broad catalogue candidates become distinct choices for each relevant FS presentation',()=>{
  const c:ProductCatalog={revision:9601,products:[product('art','Artesunate',['Artesunate 60mg Injection','Artesunate 120mg Injection'])]};
  const group=scopeGeneralFsSuggestion({alias:'Artesunate',status:'suggested',options:[{productId:'art',name:'Artesunate',reason:'Choose presentation',evidenceSource:'catalogue'}]},
    [{name:'Artesunate'}],[{name:'Artesunate 60mg Injection'},{name:'Artesunate 120mg Injection'},{name:fsNames[0]}],c);
  assert.equal(group.options.length,2);assert.notEqual(group.options[0].productId,group.options[1].productId);
  assert.ok(group.options.every(o=>o.kind==='source'));assert.doesNotMatch(JSON.stringify(group),/Dextrose/);
});
test('CCA confirmation preserves the real quantity mismatch and the same-audit order-limit flow',async()=>{
  const {record}=await flow();const group=record.generalAudit.catalogueSuggestions[0];
  const confirmed=applySourceProductConfirmation(record,group.alias,group.options[0].sourceName,catalog,{id:'cca',name:'CCA'});
  const item=confirmed.items.find((i:any)=>i.name==='Folic acid 5mg Tablet');
  assert.equal(confirmed.id,record.id);assert.equal(confirmed.allMatch,false);assert.equal(item.fulfillment.requested,4);assert.equal(item.fulfillment.supplied,1);
  assert.equal(confirmed.generalAudit.catalogueSuggestions.length,0);
  const approved=applyGeneralOrderLimitDecision(confirmed,item.fulfillment.key,true);
  assert.equal(approved.allMatch,true);
  assert.equal(completeGeneralAuditRun(createGeneralAuditRun(approved,2,{}, {},true),approved).allMatch,true);
});
test('equal quantities can clear after a CCA confirms the scoped product without rewriting catalogue identity',async()=>{
  const before=JSON.stringify(catalog),{record}=await flow('Folic acid - 1\nD5% - 15\nRL - 10');
  const group=record.generalAudit.catalogueSuggestions[0];
  const confirmed=applySourceProductConfirmation(record,group.alias,group.options[0].sourceName,catalog,{id:'cca',name:'CCA'});
  assert.equal(confirmed.allMatch,true);assert.equal(JSON.stringify(catalog),before);
});
test('Search Again uses parsed per-product sources and cannot restore the full FS list',async()=>{
  let {record}=await flow();const items=JSON.stringify(record.items);let saves=0;
  const handler=productResearchActions({read:async()=>record,catalog:async()=>catalog,getClient:()=>{throw Error('Known local candidate must not call AI');},save:async value=>{record=value;saves++;},confirm:async()=>{throw Error('Research cannot confirm');}});
  let status=200;await handler({params:{id:record.id},body:{action:'research',alias:'Folic acid',researchRevision:0,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)}} as any,
    {locals:{authUser:{id:'cca',name:'CCA'}},status(value:number){status=value;return this;},json(){}} as any,()=>{});
  assert.equal(status,200);assert.equal(saves,1);assert.equal(JSON.stringify(record.items),items);
  const group=record.generalAudit.catalogueSuggestions[0];assert.equal(group.fulfillmentValue,'Folic acid 5mg Tablet');
  assert.deepEqual(group.options.map((o:any)=>o.name),['Folic acid 5mg Tablet']);assert.doesNotMatch(suggestionText(record),/Dextrose|Ringer|Thank you/);
});
