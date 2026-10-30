import test from 'node:test';
import assert from 'node:assert/strict';
import type {CatalogProduct,ProductCatalog} from '../shared/productCatalog';
import {resolveGeneralCatalogIdentity} from '../src/utils/generalProductLog';
import {applyGeneralCatalog} from '../src/utils/productCatalog';
import {expandGeneralProductAcronyms} from '../src/utils/medicalProductAcronyms';
import {expandGeneralMedicalTerms} from '../src/utils/generalMedicalTerminology';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
const product=(id:string,name:string,aliases:string[]=[]):CatalogProduct=>({id,name,aliases,scope:'general',category:'medicine',contextualAliases:[],note:''});
const products=[
 product('plain','Folic acid 5mg Tablet',['Folate local']),
 product('pack100','Folic Acid Tablet 5mg [100]',['Folate hundred']),
 product('pack500','Folic Acid Tablet 5mg [500]',['Folate five hundred']),
 product('amox-a','Amoxicillin Capsule, 250 mg'),product('amox-b','Amoxicillin 250mg Capsule'),
 product('metro200','Metronidazole 200mg Tablet',['Metro two hundred']),
 product('metro400','Metronidazole 400mg Tablet',['Metro four hundred']),
];
const headers='Facility: Gbangu CHPS\nOrderer: Emmanuel Adomako\n';

test('exact saved product names and aliases retain their own canonical IDs beside reordered and pack-labelled entries',()=>{
 for(const row of products)for(const name of [row.name,...row.aliases]){
  assert.equal(resolveGeneralCatalogIdentity(name,products).product?.id,row.id,name);
  assert.equal(resolveGeneralCatalogIdentity(name.toUpperCase(),products).product?.id,row.id,name);
 }
 assert.equal(resolveGeneralCatalogIdentity('Folate hundred',products,['pack500']).product?.id,'pack100');
 assert.equal(resolveGeneralCatalogIdentity('Folic acid 5mg tablets [ 100 ]',products).product?.id,'pack100');
 assert.equal(resolveGeneralCatalogIdentity('Folic acid 5mg tablets [500]',products).product?.id,'pack500');
});

test('General Auditor matches saved pack names and aliases without AI or false missing/extra products',async()=>{
 const catalog:ProductCatalog={revision:1,products};applyGeneralCatalog(products);
 for(const row of products){
  let calls=0;const alias=row.aliases[0]||row.name;
  const result=await runGeneralProductNameAudit(headers+alias+' 20/20',headers+row.name+' [20/20]',catalog,{},()=>{calls++;throw Error('AI must not be needed');});
  assert.equal(calls,0);assert.equal(result.allMatch,true,row.name);assert.equal(result.items.length,1);
  assert.ok(!result.items.some(item=>['missing item','extra item'].includes(item.status)));
  const diagnostic=result.productMatchingDiagnostics[0];
  assert.equal(diagnostic.customer[0].catalogProductId,row.id);assert.equal(diagnostic.fulfillment[0].catalogProductId,row.id);
 }
});

test('a shared approved alias needs unique supplied context and never chooses the last catalogue entry',async()=>{
 const rows=[product('a','Fixture Item Alpha',['Shared fixture']),product('b','Fixture Item Beta',['Shared fixture'])];
 assert.equal(resolveGeneralCatalogIdentity('Shared fixture',rows).product,undefined);
 assert.equal(resolveGeneralCatalogIdentity('Shared fixture',rows,['a']).product?.id,'a');
 assert.equal(resolveGeneralCatalogIdentity('Shared fixture',rows,['a','b']).product,undefined);
 applyGeneralCatalog(rows);
 const result=await runGeneralProductNameAudit(headers+'Shared fixture - 2',headers+'Fixture Item Alpha [2/2]',{revision:1,products:rows},{},()=>{throw Error('No AI');});
 assert.equal(result.allMatch,true);assert.equal(result.productMatchingDiagnostics[0].customer[0].catalogProductId,'a');
});

test('General canonical aliases take priority over Vaccine Checker canonical names without merging their IDs',()=>{
 const general=product('general-bcg','Bacille Calmette-Guerin Vaccine',['BCG']);
 const vaccine={...product('vaccine-bcg','BCG'),scope:'vaccine' as const};
 assert.equal(resolveGeneralCatalogIdentity('BCG',[vaccine,general]).product?.id,general.id);
});

test('empty catalogues and ambiguous acronyms cannot inject undefined or an arbitrary product into names',()=>{
 applyGeneralCatalog([]);
 for(const name of ['Unknown + Product','Unknown / Product','']){
  assert.equal(expandGeneralProductAcronyms(name),name.toLowerCase());assert.equal(expandGeneralMedicalTerms(name),name.toLowerCase());
 }
 const rows=['Alpha','Beta'].map(id=>({...product(id,'Fixture '+id,['FixtureCode']),acronym:{category:'medicine' as const,aliases:['FixtureCode']}}));
 applyGeneralCatalog(rows);
 assert.equal(expandGeneralProductAcronyms('FixtureCode'),'fixturecode');
 assert.equal(resolveGeneralCatalogIdentity('FixtureCode',rows).product,undefined);
});

test('alias edits and deletion invalidate cached identities even for an in-place catalogue change',()=>{
 const rows=[product('a','Fixture Alpha',['OldFixture'])];
 assert.equal(resolveGeneralCatalogIdentity('OldFixture',rows).product?.id,'a');
 rows[0].aliases=['NewFixture'];assert.equal(resolveGeneralCatalogIdentity('OldFixture',rows).product,undefined);
 assert.equal(resolveGeneralCatalogIdentity('NewFixture',rows).product?.id,'a');
 rows.splice(0);assert.equal(resolveGeneralCatalogIdentity('NewFixture',rows).product,undefined);
});

test('browser bundle used by website and extension preserves the same catalogue IDs and empty-catalogue behavior',()=>{
 const result=buildSync({stdin:{contents:`export {resolveGeneralCatalogIdentity as resolve} from './src/utils/generalProductLog';export {applyGeneralCatalog as apply} from './src/utils/productCatalog';export {expandGeneralProductAcronyms as expand} from './src/utils/medicalProductAcronyms';`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'Matching',write:false});
 const context:any={};vm.runInNewContext(result.outputFiles[0].text,context);
 for(const row of products)for(const name of [row.name,...row.aliases])assert.equal(context.Matching.resolve(name,products).product?.id,row.id);
 context.Matching.apply([]);assert.equal(context.Matching.expand('Unknown + Product'),'unknown + product');
});

test('saved serum aliases are product requests while bare snake-bite clinical notes remain excluded',async()=>{
 const rows=[product('serum','Anti Snake Serum Injection',['Snake Bite Serum'])];applyGeneralCatalog(rows);
 const result=await runGeneralProductNameAudit(headers+'Snake Bite Serum - 2',headers+'Anti Snake Serum Injection [2/2]',{revision:1,products:rows},{semanticTimeoutMs:0},()=>{throw Error('No AI');});
 assert.equal(result.allMatch,true);assert.equal(result.items.length,1);assert.equal(result.items[0].fulfillment.requested,2);
 const {isGeneralNonOrderInformation}=await import('../src/utils/generalTextClassification');
 assert.equal(isGeneralNonOrderInformation('Snake bite with swelling'),true);
 assert.equal(isGeneralNonOrderInformation('Snake Bite Serum - 2'),false);
});

test('Markdown cleanup preserves multiplication marks inside saved pack labels and still unwraps bold text',async()=>{
 const name='Artemether + Lumefantrine Tablet, 20 mg + 120 mg (Dispersible) [12*10] 3-8yrs*';
 const rows=[product('pack',name)];applyGeneralCatalog(rows);
 const result=await runGeneralProductNameAudit(headers+name+' - 2',headers+name+' [2/2]',{revision:1,products:rows},{semanticTimeoutMs:0},()=>{throw Error('No AI');});
 assert.equal(result.allMatch,true);assert.equal(result.productMatchingDiagnostics[0].customer[0].catalogProductId,'pack');
 assert.match(result.productMatchingDiagnostics[0].customer[0].originalName,/12\*10/);
 const {generalOrderRelevantText}=await import('../src/utils/generalTextClassification');
 assert.match(generalOrderRelevantText('**Folic acid - 2**'),/Folic acid - 2/);
 assert.ok(!generalOrderRelevantText('**Folic acid - 2**').includes('**'));
});
