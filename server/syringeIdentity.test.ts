import {cleanOrderRequest} from '../shared/orderText';
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultProducts,applyCatalog} from './productCatalog';
import {registerConfirmedSyringes} from './syringeCatalogue';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {parseVaccineLinesDetailed,matchVaccineName,canSupplyWithoutAllocation} from './vaccineService';
import {resolveGeneralCatalogIdentity,generalCatalogAttributeConflict} from '../src/utils/generalProductLog';
import {changeCatalogueAlias} from './catalogAliasLearning';
import {resolveSyringeCatalogue,normalizeSyringeText} from '../shared/syringeIdentity';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog,CatalogProduct} from '../shared/productCatalog';
const seed=():ProductCatalog=>registerConfirmedSyringes({revision:10000,products:defaultProducts()},'Test editor').catalog;
const header='Orderer: Mary Mensah\nFacility: Example HC\n';
const noAI=()=>{throw Error('Recognized catalogue syringes must not call Gemini');};
const log=(size:number,qty:number)=>`Disp Syringe & Needle, ${size}mL [${qty}/${qty}]`;
for(const [size,names] of [[.05,['0.05 solo shots','0.05ml syringe','0.05cc syringe','50 microlitres syringe','0.05ml solo-shot']], [.5,['0.5 solo shots','half ml syringe','½ml syringe','0.5cc syringe','0.5ml solo shot']], [2,['2ml syringe','2cc syringe','2 mls syringe','disposable syringe 2ml','2ml syringe and needle']], [5,['5ml syringe','5cc syringes','5 mls syringe','disposable syringe 5ml','5ml syringe + needle']]] as [number,string[]][])for(const name of names)test(`catalogue identity and quantity: ${name}`,async()=>{
 const c=seed();applyCatalog(c);const r=await runGeneralProductNameAudit(header+`${name}=30`,header+log(size,30),c,{semanticTimeoutMs:1000},noAI);
 assert.equal(r.allMatch,true,JSON.stringify(r.generalAudit));assert.equal(r.items.length,1);assert.equal(r.items[0].fulfillment.requested,30);assert.equal(r.items[0].fulfillment.supplied,30);assert.match(r.items[0].name,new RegExp(`${size}mL`));
 assert.match(buildGeneralReport(r),/ORDER CONFIRMED/);
});
for(const [text,size,qty] of [['5ml syringe = 20',5,20],['20 pieces of 5ml syringes',5,20],['5cc syringe x20',5,20],['0.5 solo shots 300',.5,300],['Need 60 of the 0.05 solo shots',.05,60],['Syringes 2ml - 4',2,4],['1. 5ml syringe 8',5,8],['(2) 0.5ml solo shots 300',.5,300],['5ml syringe 20/20',5,20]] as [string,number,number][])test(`capacity never becomes quantity: ${text}`,async()=>{
 const c=seed();applyCatalog(c);const r=await runGeneralProductNameAudit(header+text,header+log(size,qty),c,{semanticTimeoutMs:0},noAI);
 assert.equal(r.allMatch,true,JSON.stringify(r.generalAudit));assert.equal(r.items[0].fulfillment.requested,qty);
 const vaccines=parseVaccineLinesDetailed(text);assert.equal(vaccines.items.length,1,JSON.stringify(vaccines));assert.equal(vaccines.items[0].quantity,qty);assert.equal(vaccines.items[0].confidence,'high');
});
const four='0.05 solo shots =60\n0.5 solo shots =300\n2ml syringe=4\n5ml syringe =8';
test('four sizes retain four existing IDs and independent quantities in every shared parser',async()=>{
 const original:ProductCatalog={revision:1,products:defaultProducts()};const c=registerConfirmedSyringes(original,'Test').catalog;applyCatalog(c);
 assert.equal(c.products.length,original.products.length,'Reuse existing records');assert.equal(new Set(c.products.map(p=>p.id)).size,c.products.length);
 const fs=[log(.05,60),log(.5,300),log(2,4),log(5,8)].join('\n');
 const r=await runGeneralProductNameAudit(header+four,header+fs,c,{semanticTimeoutMs:0},noAI);assert.equal(r.allMatch,true);assert.equal(new Set(r.items.map(i=>i.catalogProductId)).size,4);
 for(const text of [four,fs]){const parsed=parseVaccineLinesDetailed(text,{allowZero:true});assert.deepEqual(parsed.errors,[]);assert.deepEqual(parsed.items.map(i=>i.quantity),[60,300,4,8]);assert.equal(new Set(parsed.items.map(i=>i.canonical)).size,4);for(const i of parsed.items)assert.equal(canSupplyWithoutAllocation(i.canonical),true);}
 const again=registerConfirmedSyringes(c,'Test');assert.equal(again.events.length,0);assert.equal(again.catalog.revision,c.revision);
});
test('wrong capacities, incompatible specifications and quantity errors remain discrepancies',async()=>{
 const c=seed();applyCatalog(c);
 for(const [request,fs] of [['0.05 solo shots=60',log(.5,60)],['2ml syringe=4',log(2,8)]]){
  const r=await runGeneralProductNameAudit(header+request,header+fs,c,{semanticTimeoutMs:0},noAI);assert.equal(r.allMatch,false);assert.ok(r.issueCount>0);
  if(request.startsWith('0.05'))assert.ok(r.generalAudit.discrepancies.some(s=>/Size Mismatch/.test(s)),JSON.stringify(r.generalAudit));
 }
 assert.ok(generalCatalogAttributeConflict('syringe without needle 5ml','syringe and needle 5ml'));
 assert.ok(generalCatalogAttributeConflict('oral syringe 5ml','insulin syringe 5ml'));
 assert.ok(generalCatalogAttributeConflict('syringe 5ml 23G 25mm','syringe 5ml 25G 25mm'));
 assert.ok(generalCatalogAttributeConflict('safety syringe 5ml','auto-disable syringe 5ml'));
 assert.equal(generalCatalogAttributeConflict('syringe 5cc','syringe 5ml'),undefined);
});
test('arbitrary future capacities and types are catalogue-driven, not default products',()=>{
 const c=seed();const extra=(id:string,name:string):CatalogProduct=>({id,name,scope:'general',category:'device',aliases:[],contextualAliases:[],note:''});
 for(const n of [1,3,10,20,50]){const p=extra(`extra-${n}`,`Disposable syringe and needle, ${n}mL`);assert.equal(resolveSyringeCatalogue(`${n}cc syringe`,[...c.products.filter(product=>!new RegExp(`\\b${n}ml\\b`,'i').test(normalizeSyringeText(product.name))),p])?.product?.id,p.id);}
 const oral=extra('oral','Oral syringe without needle 10ml');const insulin=extra('insulin','Insulin syringe with needle 1ml 25G 16mm');
 assert.equal(resolveSyringeCatalogue('oral syringe 10cc',[oral,insulin])?.product?.id,'oral');
 assert.equal(resolveSyringeCatalogue('insulin syringe 1ml 25g 16mm',[oral,insulin])?.product?.id,'insulin');
 assert.equal(resolveSyringeCatalogue('oral syringe 1ml',[oral,insulin])?.product,undefined);
 assert.equal(resolveSyringeCatalogue('10ml syringe',[oral,{...oral,id:'other',name:'Safety syringe 10ml'}])?.product,undefined);
 assert.equal(resolveSyringeCatalogue('solo shot',c.products)?.product,undefined);
});
test('bad generic aliases and embedded order counts are deactivated with history instead of merging capacities',()=>{
 const original:ProductCatalog={revision:1,products:defaultProducts()};const generic=original.products.find(p=>p.name==='Syringe and Needle')!;
 generic.aliases.push('Disp Syringe & Needle, 0.05mL','Disp Syringe & Needle, 0.5mL','solo shots =60','2ml');
 const repaired=registerConfirmedSyringes(original,'Test');applyCatalog(repaired.catalog);
 assert.equal(repaired.events.filter(e=>e.action==='deactivate').length,4);
 assert.notEqual(resolveGeneralCatalogIdentity('Disp Syringe & Needle, 0.05mL',repaired.catalog.products).product?.id,generic.id);
 const target=repaired.catalog.products.find(p=>p.name==='Soloshot 0.5ml')!;
 const proposed=changeCatalogueAlias(repaired.catalog,{revision:repaired.catalog.revision,action:'propose',text:'0.05 solo shot',productId:target.id},'Test');
 const alias=proposed.catalog.aliasRecords!.find(r=>r.productId===target.id&&r.text==='0.05 solo shot')!;
 assert.throws(()=>changeCatalogueAlias(proposed.catalog,{revision:proposed.catalog.revision,action:'approve',id:alias.id,identityConfirmed:true},'Test'),/capacity|configuration|another product/i);
});
test('unknown syringe wording gets choices, requires confirmation, and then reuses an approved alias',async()=>{
 let c=seed();applyCatalog(c);const product=c.products.find(p=>p.name==='Syringe and needle 5ml')!;let calls=0;
 const request=header+'Bluebird 5ml syringe 20',fs=header+log(5,20);
 const r=await runGeneralProductNameAudit(request,fs,c,{semanticTimeoutMs:1000,semanticCacheScope:'unknown-syringe'},()=>({models:{async generateContent(){calls++;return{text:JSON.stringify({matches:[{alias:'Bluebird 5ml syringe',productId:product.id,confidence:.95,clinicalUncertainty:true,reason:'Verify that this brand is the registered 5mL combination.'}]})};}}}));
 assert.equal(calls,1);assert.equal(r.allMatch,false);assert.ok(r.generalAudit.catalogueSuggestions?.some(g=>g.options.some(o=>o.productId===product.id)));
 c=changeCatalogueAlias(c,{revision:c.revision,action:'propose',text:'Bluebird 5ml syringe',productId:product.id},'Test').catalog;
 const a=c.aliasRecords!.find(r=>r.text==='Bluebird 5ml syringe')!;c=changeCatalogueAlias(c,{revision:c.revision,action:'approve',id:a.id,identityConfirmed:true},'Test').catalog;applyCatalog(c);
 const confirmed=await runGeneralProductNameAudit(request,fs,c,{semanticTimeoutMs:1000},noAI);assert.equal(confirmed.allMatch,true,JSON.stringify(confirmed.generalAudit));
});

test('syringe count phrasing does not invent count units for unrelated medicines',()=>{
 assert.equal(cleanOrderRequest('Need 4 of ASV'),'4 of ASV');
 assert.equal(cleanOrderRequest('Need 60 of the 0.05 solo shots'),'60 pieces of 0.05ml solo shots');
});
