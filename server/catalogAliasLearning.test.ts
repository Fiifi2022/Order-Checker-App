import test from 'node:test';
import assert from 'node:assert/strict';
import { changeCatalogueAlias, catalogueAliasRecords, trackCatalogueAliasEdits, catalogueAliasHandlers } from './catalogAliasLearning';
import { saveCatalogProduct } from './productCatalog';
import { runGeneralProductNameAudit } from './generalProductNameAudit';
import { resolveGeneralCatalogIdentity } from '../src/utils/generalProductLog';
import type { ProductCatalog, CatalogAliasEvent } from '../shared/productCatalog';
const product=(id:string,name:string,aliases:string[]=[])=>({id,name,aliases,scope:'general' as const,category:'medicine',contextualAliases:[],note:''});
const seed=():ProductCatalog=>({revision:1,products:[product('metro','Metronidazole Suspension 200mg/5ml, 100ml',['Metro suspension']),product('pcm','Paracetamol 500mg Tablet',['PCM']),{...product('bcg','BCG'),scope:'vaccine'}]});
const header='Facility: Anyinofi HC\nOrderer: Emmanuel Adomako\nProducts:\n';
const noAI=()=>{throw Error('Known catalogue identity must not call Gemini');};
const propose=(catalog:ProductCatalog,text='Customer metro',productId='metro')=>changeCatalogueAlias(catalog,{action:'propose',text,productId,confidence:0.97,clinicalUncertainty:true},'audit-user',true);

test('existing alias metadata is derived without duplicate products or fabricated legacy dates',()=>{
 const catalog=seed(),before=JSON.stringify(catalog),records=catalogueAliasRecords(catalog);
 assert.equal(records.length,2);assert.ok(records.every(row=>row.source==='catalogue'&&row.status==='approved'&&row.active));
 assert.ok(records.every(row=>row.createdAt===null));assert.equal(JSON.stringify(catalog),before);
});

test('pending AI proposals need explicit authorized confirmation, preserve metadata and learn under an existing product',async()=>{
 const initial=seed(),pending=propose(initial),record=pending.catalog.aliasRecords!.find(row=>row.source==='gemini')!;
 assert.equal(record.status,'pending');assert.equal(record.active,false);assert.equal(record.confidence,0.97);assert.ok(record.createdAt);
 assert.equal(resolveGeneralCatalogIdentity(record.text,pending.catalog.products).product,undefined);
 assert.throws(()=>changeCatalogueAlias(pending.catalog,{action:'approve',id:record.id,revision:pending.catalog.revision},'admin'),/verified/);
 const approved=changeCatalogueAlias(pending.catalog,{action:'approve',id:record.id,revision:pending.catalog.revision,identityConfirmed:true},'admin@example.com');
 assert.equal(approved.catalog.products.length,initial.products.length);assert.equal(approved.events.length,1);
 const saved=approved.catalog.aliasRecords!.find(row=>row.id===record.id)!;
 assert.equal(saved.approvedBy,'admin@example.com');assert.ok(saved.approvedAt);assert.equal(saved.productId,'metro');
 const audit=await runGeneralProductNameAudit(header+record.text+' 20/20',header+'Metronidazole Suspension 200mg/5ml, 100ml [20/20]',approved.catalog,{},noAI);
 assert.equal(audit.allMatch,true);assert.equal(audit.semanticAnalysis.status,'skipped');
 assert.equal(propose(approved.catalog).events.length,0);
});

test('automatic proposal creation cannot approve aliases, create products or write vaccine mappings',()=>{
 const catalog=seed();
 assert.throws(()=>changeCatalogueAlias(catalog,{action:'approve',id:'missing',identityConfirmed:true},'audit',true));
 assert.throws(()=>propose(catalog,'new','invented'),/existing General product/);
 assert.throws(()=>propose(catalog,'new','bcg'),/existing General product/);
 assert.deepEqual(seed(),catalog);
});

test('duplicate suggestions are idempotent and rejected aliases are not automatically reused or requeued',async()=>{
 const pending=propose(seed()),record=pending.catalog.aliasRecords!.find(row=>row.source==='gemini')!;
 assert.equal(propose(pending.catalog).catalog,pending.catalog);
 const rejected=changeCatalogueAlias(pending.catalog,{action:'reject',id:record.id,revision:pending.catalog.revision},'admin');
 assert.equal(rejected.events[0].after.status,'rejected');assert.equal(propose(rejected.catalog).events.length,0);
 let calls=0;
 const audit=await runGeneralProductNameAudit(header+'Customer metro 20/20',header+'Metronidazole Suspension 200mg/5ml, 100ml [20/20]',rejected.catalog,{},()=>{calls++;return noAI();});
 assert.equal(audit.allMatch,false);assert.equal(calls,0);assert.equal(audit.items[0].status,'product identity discrepancy');
});

test('normalized alias conflicts are rejected; competing pending mappings remain reviewable',()=>{
 const pending=propose(seed(),'Review Brand'),other=propose(pending.catalog,'Review Brand','pcm');
 const rows=other.catalog.aliasRecords!.filter(row=>row.text==='Review Brand');assert.equal(rows.length,2);
 const first=changeCatalogueAlias(other.catalog,{action:'approve',id:rows[0].id,revision:other.catalog.revision,identityConfirmed:true},'admin');
 assert.throws(()=>changeCatalogueAlias(first.catalog,{action:'approve',id:rows[1].id,revision:first.catalog.revision,identityConfirmed:true},'admin'),/belongs|mapping/);
});

test('correction atomically moves an approved alias, and deactivation invalidates future matching without touching vaccines',()=>{
 const initial=seed(),vaccines=JSON.stringify(initial.products.filter(p=>p.scope==='vaccine'));
 const pending=propose(initial),record=pending.catalog.aliasRecords!.find(row=>row.source==='gemini')!;
 const approved=changeCatalogueAlias(pending.catalog,{action:'approve',id:record.id,revision:pending.catalog.revision,identityConfirmed:true},'admin').catalog;
 const corrected=changeCatalogueAlias(approved,{action:'correct',id:record.id,revision:approved.revision,productId:'pcm',identityConfirmed:true},'admin');
 assert.equal(resolveGeneralCatalogIdentity('Customer metro',corrected.catalog.products).product?.id,'pcm');
 assert.ok(!corrected.catalog.products.find(p=>p.id==='metro')!.aliases.includes('Customer metro'));
 assert.equal(corrected.events[0].before?.productId,'metro');assert.equal(corrected.events[0].after.productId,'pcm');
 const inactive=changeCatalogueAlias(corrected.catalog,{action:'deactivate',id:record.id,revision:corrected.catalog.revision},'admin');
 assert.equal(resolveGeneralCatalogIdentity('Customer metro',inactive.catalog.products).product,undefined);
 assert.equal(JSON.stringify(inactive.catalog.products.filter(p=>p.scope==='vaccine')),vaccines);
 assert.throws(()=>changeCatalogueAlias(inactive.catalog,{action:'correct',id:record.id,revision:1,identityConfirmed:true},'admin'),/changed/);
});

test('ordinary product-form alias edits retain metadata and record additions/removals',()=>{
 const initial=seed(),draft=initial.products[0];
 const saved=saveCatalogProduct(initial,{...draft,revision:1,aliases:['Human verified name']},'admin');
 const tracked=trackCatalogueAliasEdits(initial,saved,'admin');assert.equal(tracked.events.length,2);
 assert.equal(tracked.catalog.revision,2);assert.ok(tracked.catalog.aliasRecords!.some(row=>row.text==='Human verified name'&&row.active));
 assert.ok(tracked.catalog.aliasRecords!.some(row=>row.text==='Metro suspension'&&!row.active));
});

test('alias endpoints enforce current editing roles, report persistence errors and expose retained history',async()=>{
 let catalog=seed(),writes=0;const events:CatalogAliasEvent[]=[];
 const handlers=catalogueAliasHandlers({read:async()=>catalog,change:async(input,actor)=>{writes++;const change=changeCatalogueAlias(catalog,input,actor);catalog=change.catalog;events.push(...change.events);return catalog;},history:async()=>({events,nextCursor:''})});
 let status=200,body:any;
 const response:any={locals:{authUser:{id:'cca',role:'cca',roles:['cca']}},setHeader(){},status(value:number){status=value;return this;},json(value:any){body=value;}};
 await handlers.change({body:{action:'propose'}} as any,response,()=>{});assert.equal(status,403);assert.equal(writes,0);
 await handlers.list({} as any,response,()=>{});assert.equal(body.canEdit,false);
 response.locals.authUser={id:'admin',email:'admin@example.com',role:'admin',roles:['admin']};status=200;
 await handlers.change({body:{action:'propose',revision:1,text:'Admin approved later',productId:'metro'}} as any,response,()=>{});
 assert.equal(status,200);assert.equal(writes,1);
 await handlers.history({query:{}} as any,response,()=>{});assert.equal(body.events.length,1);assert.equal(body.events[0].actor,'admin@example.com');
 const failed=catalogueAliasHandlers({read:async()=>{throw Error('offline');},change:async()=>{throw Error('offline');},history:async()=>{throw Error('offline');}});
 await failed.list({} as any,response,()=>{});assert.equal(status,503);
});

test('audit-to-review-to-approved learning persists once and repeats without Gemini',async()=>{
 let catalog=seed(),calls=0;const history:CatalogAliasEvent[]=[];
 const client=()=>({models:{async generateContent(){calls++;return{text:JSON.stringify({matches:[{alias:'New verified metro brand',productId:'metro',confidence:0.88,clinicalUncertainty:true}]})};}}});
 const customer=header+'New verified metro brand Qty 20',confirmation=header+'Metronidazole Suspension 200mg/5ml, 100ml [20/20]';
 const initial=await runGeneralProductNameAudit(customer,confirmation,catalog,{suggestCatalogueAliases:async suggestions=>{
  for(const suggestion of suggestions){const result=changeCatalogueAlias(catalog,{action:'propose',text:suggestion.alias,productId:suggestion.productId,confidence:suggestion.confidence,clinicalUncertainty:suggestion.clinicalUncertainty},'auditor',true);catalog=result.catalog;history.push(...result.events);}
 }},client);
 assert.equal(initial.allMatch,false);assert.equal(calls,1);assert.equal(history.length,1);
 const waiting=await runGeneralProductNameAudit(customer,confirmation,catalog,{},noAI);
 assert.equal(waiting.allMatch,false);assert.equal(waiting.aliasLearning.status,'review_required');assert.equal(waiting.geminiMetrics.requestStarted,false);
 const pending=catalog.aliasRecords!.find(record=>record.text==='New verified metro brand')!;
 const approved=changeCatalogueAlias(catalog,{action:'approve',id:pending.id,revision:catalog.revision,identityConfirmed:true},'authorized-admin');catalog=approved.catalog;history.push(...approved.events);
 const next=await runGeneralProductNameAudit(customer,confirmation,catalog,{},noAI);
 assert.equal(next.allMatch,true);assert.equal(next.semanticAnalysis.status,'skipped');assert.equal(history.length,2);assert.equal(catalog.products.length,3);
});

test('explicit rejection overrides implicit normalization for that alias mapping',async()=>{
 const initial=seed(),text='susp metronidazole 100ml';
 const request=header+text+' 20/20',confirmation=header+'Metronidazole Suspension 200mg/5ml, 100ml [20/20]';
 assert.equal((await runGeneralProductNameAudit(request,confirmation,initial,{},noAI)).allMatch,true);
 const pending=propose(initial,text),record=pending.catalog.aliasRecords!.find(record=>record.text===text)!;
 const rejected=changeCatalogueAlias(pending.catalog,{action:'reject',id:record.id,revision:pending.catalog.revision},'admin').catalog;
 const result=await runGeneralProductNameAudit(request,confirmation,rejected,{},noAI);
 assert.equal(result.allMatch,false);assert.equal(result.items[0].status,'product identity discrepancy');assert.equal(result.geminiMetrics.requestStarted,false);
});

test('corrected aliases keep unique identities when an earlier spelling is proposed again',()=>{
 const first=propose(seed(),'Earlier spelling'),record=first.catalog.aliasRecords![0];
 const corrected=changeCatalogueAlias(first.catalog,{action:'correct',id:record.id,revision:first.catalog.revision,text:'Corrected spelling',identityConfirmed:true},'admin');
 const reproposed=propose(corrected.catalog,'Earlier spelling');
 assert.equal(reproposed.catalog.aliasRecords!.length,2);assert.equal(new Set(reproposed.catalog.aliasRecords!.map(row=>row.id)).size,2);
 assert.ok(reproposed.catalog.products[0].aliases.includes('Corrected spelling'));
 assert.equal(reproposed.catalog.aliasRecords!.find(row=>row.text==='Earlier spelling')!.status,'pending');
});

test('new deterministic shorthand requires confirmation before permanent alias approval',async()=>{
 let stored=seed(),aiCalls=0,events:CatalogAliasEvent[]=[];
 const {learnVerifiedCatalogueAliases}=await import('./catalogAliasLearning');
 const request=header+'Paracet 500 tabs 20/20',log=header+'Paracetamol 500mg Tablet [20/20]';
 const support={learnCatalogueAliases:async(aliases:{alias:string;productId:string}[])=>{
  const learned=learnVerifiedCatalogueAliases(stored,aliases,'catalogue-verifier:test-user');
  stored=learned.catalog;events.push(...learned.events);return learned.events.filter(event=>event.action==='approve').length;
 }};
 const provider=()=>{aiCalls++;throw Error('Routine catalogue matching must not call Gemini');};
 const first=await runGeneralProductNameAudit(request,log,stored,support,provider);
 assert.equal(first.allMatch,true);assert.equal(aiCalls,0);assert.equal(first.aliasLearning.saved,0);assert.equal(first.aliasLearning.status,'review_required');
 assert.equal(stored.products.length,3);assert.ok(!stored.products.find(p=>p.id==='pcm')!.aliases.includes('Paracet 500 tabs'));
 const record=stored.aliasRecords!.find(record=>record.text==='Paracet 500 tabs')!;
 assert.equal(record.source,'deterministic');assert.equal(record.status,'pending');assert.equal(record.active,false);
 assert.equal(record.clinicalUncertainty,false);assert.equal(record.approvedAt,null);assert.equal(record.approvedBy,null);
 assert.deepEqual(events.map(event=>event.action),['propose']);
 stored=changeCatalogueAlias(stored,{action:'approve',id:record.id,revision:stored.revision,identityConfirmed:true},'verified-user').catalog;
 const revision=stored.revision;
 const second=await runGeneralProductNameAudit(request,log,JSON.parse(JSON.stringify(stored)),support,provider);
 assert.equal(second.allMatch,true);assert.equal(aiCalls,0);assert.equal(stored.revision,revision);
 assert.equal(second.productMatchingDiagnostics[0].customer[0].matchSource,'Alias');
});

test('automatic alias learning rejects competing identities, medical conflicts and unverified Gemini guesses',async()=>{
 const {learnVerifiedCatalogueAliases}=await import('./catalogAliasLearning');
 const initial=seed();
 for(const alias of ['Fever-cure brand','Paracet tabs','Paracet 250 tabs','Paracet 500 capsules','Metronidazole Suspension 200mg/5ml 200ml']) {
  const learned=learnVerifiedCatalogueAliases(initial,[{alias,productId:'pcm'}],'process');
  assert.equal(learned.catalog,initial);assert.deepEqual(learned.events,[]);
 }
 const competing={...initial,products:[...initial.products,product('pcm-other','Paracetamol 500mg Tablet Modified Release')]};
 assert.equal(learnVerifiedCatalogueAliases(competing,[{alias:'Paracet 500 tabs',productId:'pcm'}],'process').catalog,competing);
 const pending=changeCatalogueAlias(initial,{action:'propose',text:'Paracet 500 tabs',productId:'pcm'},'user',true);
 const rejected=changeCatalogueAlias(pending.catalog,{action:'reject',id:pending.events[0].after.id,revision:pending.catalog.revision},'admin').catalog;
 assert.equal(learnVerifiedCatalogueAliases(rejected,[{alias:'Paracet 500 tabs',productId:'pcm'}],'process').catalog,rejected);
});
