import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {inspectCatalogHealth} from '../shared/catalogHealth';
import {catalogAliasKey,type CatalogProduct,type ProductCatalog,type CatalogAliasRecord} from '../shared/productCatalog';
import {saveCatalogProduct,productCatalogHandlers} from './productCatalog';
import {changeCatalogueAlias,trackCatalogueAliasEdits} from './catalogAliasLearning';
import Panel from '../src/components/CatalogHealthPanel';
import {canAccess} from './auth';

const product=(id:string,name:string,patch:Partial<CatalogProduct>={}):CatalogProduct=>({id,name,scope:'general',category:'medicine',aliases:[],contextualAliases:[],note:'',...patch});
const catalog=(...products:CatalogProduct[]):ProductCatalog=>({revision:4,products});
const alias=(productId:string,text:string,patch:Partial<CatalogAliasRecord>={}):CatalogAliasRecord=>({id:`${productId}:${text}`,productId,text,normalizedText:catalogAliasKey(text),status:'approved',active:true,source:'manual',createdAt:null,updatedAt:null,approvedAt:null,approvedBy:'editor',...patch});

test('health detects duplicate products and aliases without merging clinical identities',()=>{
  const input=catalog(product('a','Paracetamol 500mg Tablet',{aliases:['PCM']}),product('b','Paracetamol 120mg/5ml Syrup',{aliases:['PCM']}),product('c','PARACETAMOL 500mg Tablet'));
  const before=JSON.stringify(input), report=inspectCatalogHealth(input);
  assert.ok(report.issues.some(issue=>issue.code==='duplicate_product' && issue.productIds.includes('a') && issue.productIds.includes('c')));
  assert.ok(report.issues.some(issue=>issue.code==='alias_conflict' && issue.labels.includes('PCM')));
  assert.equal(JSON.stringify(input),before);assert.equal(inspectCatalogHealth(input).issues.length,report.issues.length);
});

test('full product labels, FS names, dotted acronyms and reordered labels participate in conflict checks',()=>{
  const current=catalog(product('a','Vaccine A',{fulfillmentSystemName:'Fulfilment Vaccine',aliases:['B.C.G.','Oral Sample Vaccine']}),product('b','Vaccine B'));
  for(const name of ['Fulfilment Vaccine','BCG','Sample Vaccine Oral']) {
    assert.throws(()=>saveCatalogProduct(current,{...current.products[1],aliases:[name],revision:4},'editor'),/already belongs/);
  }
  const collision=inspectCatalogHealth(catalog(current.products[0],{...current.products[1],displayName:'BCG'}));
  assert.ok(collision.issues.some(issue=>issue.code==='alias_conflict'));
});

test('clinical specifications and checker scopes remain distinct; contextual overlaps are review items',()=>{
  const clean=inspectCatalogHealth(catalog(product('a','Paracetamol 500mg Tablet'),product('b','Paracetamol 250mg Tablet'),product('c','Paracetamol 120mg/5ml Syrup'),product('d','Paracetamol 120mg/5ml Syrup',{scope:'vaccine'})));
  assert.equal(clean.errorCount,0);assert.equal(clean.warningCount,0);
  const shared=inspectCatalogHealth(catalog(product('x','Context A',{aliases:['CA'],contextualAliases:['CA']}),product('y','Context B',{aliases:['CA'],contextualAliases:['CA']})));
  assert.equal(shared.errorCount,0);assert.equal(shared.issues[0].code,'contextual_overlap');
  const reordered=inspectCatalogHealth(catalog(product('dt','Diphtheria-Tetanus Vaccine'),product('td','Tetanus-Diphtheria Vaccine')));
  assert.equal(reordered.errorCount,0);assert.equal(reordered.issues[0].code,'name_overlap');
  assert.ok(!reordered.issues.some(issue=>issue.code==='duplicate_product'));
});

test('missing, self, same-checker, conflicting and one-way links are reported; valid pairs are accepted',()=>{
  for(const linkedProductId of ['missing','a','b']) {
    const report=inspectCatalogHealth(catalog(product('a','A',{linkedProductId}),product('b','B')));
    assert.ok(report.issues.some(issue=>issue.code==='broken_link'));
  }
  const a=product('a','A',{linkedProductId:'v'}),v=product('v','V',{scope:'vaccine',linkedProductId:'a'});
  assert.equal(inspectCatalogHealth(catalog(a,v)).issues.length,0);
  assert.ok(inspectCatalogHealth(catalog(a,{...v,linkedProductId:''})).issues.some(issue=>issue.code==='one_way_link'));
  assert.ok(inspectCatalogHealth(catalog(a,{...v,linkedProductId:'b'},product('b','B'))).issues.some(issue=>issue.code==='conflicting_link'));
});

test('duplicate IDs cannot be edited or deleted as if they identify a unique product',()=>{
  const current=catalog(product('same','A'),product('same','B'));
  assert.ok(inspectCatalogHealth(current).issues.some(issue=>issue.code==='duplicate_id'));
  assert.throws(()=>saveCatalogProduct(current,{...current.products[0],revision:4},'editor'),{status:409});
  assert.throws(()=>saveCatalogProduct(current,{action:'delete',id:'same',revision:4},'editor'),{status:409});
});

test('incomplete legacy product records become actionable findings instead of breaking the check',()=>{
  for(const broken of [{name:''},{category:''},{aliases:undefined},{contextualAliases:undefined}]) {
    const report=inspectCatalogHealth(catalog({...product('broken','Incomplete'),...broken} as CatalogProduct));
    assert.ok(report.issues.some(issue=>issue.code==='invalid_product'));
  }
});

test('alias record drift and live orphans are flagged while retired history and pending suggestions remain separate',()=>{
  const current={...catalog(product('a','A',{aliases:['Retired']})),aliasRecords:[alias('gone','Historical',{active:false}),alias('gone','Live'),alias('a','Unpublished'),alias('a','Retired',{active:false}),alias('a','Suggestion',{active:false,status:'pending'})]};
  const report=inspectCatalogHealth(current);
  assert.equal(report.pendingAliasCount,1);
  assert.equal(report.issues.filter(issue=>issue.code==='orphan_alias').length,1);
  assert.equal(report.issues.filter(issue=>issue.code==='alias_record_drift').length,2);
  assert.ok(!JSON.stringify(report.issues).includes('Historical'));
});

test('verified alias approvals cannot bypass normalized display-name and dotted-acronym conflicts',()=>{
  const current=catalog(product('a','A',{displayName:'B.C.G.'}),product('b','B'));
  const proposed=changeCatalogueAlias(current,{revision:4,action:'propose',text:'BCG',productId:'b'},'editor');
  assert.throws(()=>changeCatalogueAlias(proposed.catalog,{revision:5,action:'approve',id:proposed.events[0].after.id,identityConfirmed:true},'editor'),{status:409});
});

test('existing conflicts can be removed without blocking unrelated catalogue edits or erasing history',()=>{
  const current=catalog(product('a','A',{aliases:['Shared']}),product('b','B',{aliases:['Shared']}));
  const unchanged=saveCatalogProduct(current,{...current.products[1],note:'Review in progress',revision:4},'editor');
  assert.equal(unchanged.products[1].note,'Review in progress');
  const fixed=trackCatalogueAliasEdits(current,saveCatalogProduct(current,{...current.products[1],aliases:[],revision:4},'editor'),'editor');
  assert.equal(inspectCatalogHealth(fixed.catalog).errorCount,0);
  assert.ok(fixed.events.some(event=>event.action==='deactivate' && event.after.productId==='b'));
  assert.deepEqual(fixed.catalog.products[0].aliases,['Shared']);
});

test('dry-run preview reports resolved findings without calling save or changing catalogue revision',async()=>{
  const current=catalog(product('a','A',{aliases:['Shared']}),product('b','B',{aliases:['Shared']}));
  const before=JSON.stringify(current);let saves=0,body:any,status=200;
  const handlers=productCatalogHandlers({read:async()=>current,save:async()=>{saves++;return current;}});
  const res:any={locals:{authUser:{role:'warehouse',email:'editor'}},setHeader(){},status(code:number){status=code;return this;},json(value:any){body=value;}};
  await handlers.preview({body:{...current.products[1],revision:4,aliases:[]}} as any,res,()=>{});
  assert.equal(status,200);assert.equal(body.saved,false);assert.equal(body.revision,4);assert.equal(body.resolved.length,1);assert.equal(body.introduced.length,0);assert.equal(saves,0);assert.equal(JSON.stringify(current),before);
  res.locals.authUser.role='cca';status=200;
  await handlers.preview({body:{}} as any,res,()=>{});assert.equal(status,403);
  assert.equal(canAccess('cca','GET','/products/health'),true);assert.equal(canAccess('cca','POST','/products/preview'),false);
  res.locals.authUser.role='warehouse';status=200;
  await handlers.preview({body:{...current.products[1],revision:3}} as any,res,()=>{});assert.equal(status,409);
});

test('health API and interface expose actionable findings without edit controls for read-only users',async()=>{
  const current=catalog(product('a','A',{aliases:['Shared']}),product('b','B',{aliases:['Shared']}));
  let body:any;const headers:Record<string,string>={};
  const handlers=productCatalogHandlers({read:async()=>current,save:async()=>{throw Error('Must not write');}});
  const res:any={locals:{authUser:{role:'cca'}},setHeader(name:string,value:string){headers[name]=value;},json(value:any){body=value;}};
  await handlers.health({} as any,res,()=>{});
  assert.equal(headers['Cache-Control'],'no-store');assert.equal(body.errorCount,1);
  const html=renderToStaticMarkup(createElement(Panel,{report:body,products:current.products,canEdit:false,onEdit(){},onAliases(){}}));
  assert.match(html,/Catalogue health check/);assert.match(html,/Alias identifies different products/);assert.match(html,/View product/);assert.doesNotMatch(html,/Review product/);
});
