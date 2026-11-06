import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERAL_CATALOGUE_AI_INSTRUCTIONS, generalCatalogueAiCandidates } from './generalCatalogueAi';
import { runGeneralProductNameAudit, generalProductNameKey } from './generalProductNameAudit';
import { changeCatalogueAlias } from './catalogAliasLearning';
import type { CatalogProduct, ProductCatalog } from '../shared/productCatalog';
const product=(id:string,name:string,aliases:string[]=[]):CatalogProduct=>({id,name,aliases,scope:'general',category:'medicine',contextualAliases:[],note:''});

test('candidate retrieval includes approved alias wording and prioritizes resolved counterparts',()=>{
 const rows=Array.from({length:30},(_,i)=>product(`earlier-${i}`,`Other medicine ${i}`,['familiar']));
 const target=product('target','Official Product',['Familiar alternative']);
 const selected=generalCatalogueAiCandidates([...rows,target],['familiar'],['target'],generalProductNameKey);
 assert.equal(selected[0].id,'target');assert.equal(selected.length,24);
 assert.deepEqual(generalCatalogueAiCandidates([target],['alternative'],[],generalProductNameKey).map(p=>p.id),['target']);
 assert.equal(generalCatalogueAiCandidates([{...target,scope:'vaccine'}],['alternative'],['target'],generalProductNameKey).length,0);
});

test('Gemini gets both message names and approved aliases; confirmed learning resolves subsequent audits without AI',async()=>{
 let catalog:ProductCatalog={revision:1,products:[product('target','Metronidazole Suspension 200mg/5ml, 100ml',['Metro suspension'])]};
 const header='Facility: Anyinofi HC\nOrderer: Emmanuel Adomako\nProducts:\n';
 const request=header+'Metro new brand Qty 2';
 const confirmation=header+'Metronidazole Suspension 200mg/5ml, 100ml [2/2]';
 let calls=0;
 const first=await runGeneralProductNameAudit(request,confirmation,catalog,{
  semanticCacheScope:'catalogue-ai-learning-test',suggestCatalogueAliases:async suggestions=>{
   for(const suggestion of suggestions) catalog=changeCatalogueAlias(catalog,{action:'propose',text:suggestion.alias,productId:suggestion.productId,...suggestion},'audit',true).catalog;
  },
 },()=>({models:{async generateContent(input:any){
  calls++;assert.equal(input.config.systemInstruction,GENERAL_CATALOGUE_AI_INSTRUCTIONS);
  const data=JSON.parse(input.contents);
  assert.ok(data.customerNames.includes('Metro new brand'));
  assert.ok(data.fulfillmentNames.includes('Metronidazole Suspension 200mg/5ml, 100ml'));
  assert.ok(data.catalog[0].aliases.includes('Metro suspension'));
  return{text:JSON.stringify({matches:[{alias:'Metro new brand',productId:'target',confidence:0.99,clinicalUncertainty:false,reason:'Alternative naming suggestion requiring confirmation.'}]})};
 }}}));
 assert.equal(calls,1);assert.equal(first.allMatch,false);
 const pending=catalog.aliasRecords!.find(record=>record.text==='Metro new brand')!;
 assert.equal(pending.status,'pending');assert.equal(pending.productId,'target');
 catalog=changeCatalogueAlias(catalog,{action:'approve',id:pending.id,revision:catalog.revision,identityConfirmed:true},'catalogue-admin').catalog;
 const next=await runGeneralProductNameAudit(request,confirmation,JSON.parse(JSON.stringify(catalog)),{},()=>{throw Error('Approved alias must not call AI');});
 assert.equal(next.allMatch,true);assert.equal(next.issueCount,0);
 assert.equal(next.productMatchingDiagnostics[0].customer[0].matchSource,'Alias');
});

test('instructions retain clinical safeguards and distinguish pending suggestions from approvals',()=>{
 for(const text of ['approved aliases','BOTH customer and fulfilment','Quantities are validated separately','container sizes','multiple products remain plausible','pending alias suggestions']) assert.ok(GENERAL_CATALOGUE_AI_INSTRUCTIONS.includes(text));
});
