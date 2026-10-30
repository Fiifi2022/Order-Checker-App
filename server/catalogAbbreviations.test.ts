import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {applyCatalog} from './productCatalog';
import {resolveGeneralCatalogIdentity} from '../src/utils/generalProductLog';
import type {ProductCatalog} from '../shared/productCatalog';
const catalog:ProductCatalog={revision:1,products:[
 {id:'pcm',scope:'general',name:'Paracetamol 500mg Tablet',aliases:['PCM'],contextualAliases:[],category:'medicine',note:''},
 {id:'cipro',scope:'general',name:'Ciprofloxacin 500mg Tablet',aliases:['CIP'],contextualAliases:[],category:'medicine',note:''},
]};
const headers='Facility: Gbangu CHPS\nOrderer: Emmanuel Adomako\n';
async function audit(request:string,fulfillment='Paracetamol 500mg Tablet [5/5]'){
 applyCatalog(catalog);let calls=0;
 const result=await runGeneralProductNameAudit(headers+request,headers+fulfillment,catalog,{semanticTimeoutMs:0},()=>{calls++;throw Error('Approved abbreviation must not need AI');});
 assert.equal(calls,0);return result;
}

test('approved plain and dotted abbreviations and repeated full-name labels match as one product without discrepancies',async()=>{
 for(const name of ['PCM','P.C.M.','P.C.M','Paracetamol (PCM) 500mg Tablet','PCM / Paracetamol 500mg Tablet','Paracetamol 500mg Tablet (P.C.M.)']){
  const result=await audit(name+' 5/5');assert.equal(result.allMatch,true,name);assert.equal(result.items.length,1,name);
  assert.deepEqual(result.generalAudit.discrepancies,[]);assert.equal(result.generalAudit.productCount.requested,1);assert.equal(result.generalAudit.productCount.found,1);
  assert.equal(result.productMatchingDiagnostics[0].customer[0].catalogProductId,'pcm');
 }
});

test('separate lines using an abbreviation and its full name aggregate real quantities without duplicate-product warnings',async()=>{
 const result=await audit('PCM - 2\nParacetamol 500mg Tablet - 3');
 assert.equal(result.allMatch,true);assert.equal(result.items.length,1);assert.equal(result.items[0].fulfillment.requested,5);
 assert.equal(result.generalAudit.productCount.requested,1);assert.deepEqual(result.generalAudit.discrepancies,[]);
 const excess=await audit('PCM - 2\nParacetamol 500mg Tablet - 3','Paracetamol 500mg Tablet [6/6]');
 assert.equal(excess.allMatch,false);assert.equal(excess.items[0].difference,1);
});

test('unknown abbreviations, different products and conflicting stated strengths remain identity discrepancies',async()=>{
 for(const description of ['Paracetamol 250mg Tablet (PCM)','Ciprofloxacin 500mg Tablet (PCM)','PCM / Ciprofloxacin 500mg Tablet','Paracetamol 500mg Tablet (ZZQ)']){
  const result=await audit(description+' - 5');assert.equal(result.allMatch,false,description);
  assert.ok(result.items.some(item=>item.status!=='match'),description);
 }
 assert.equal(resolveGeneralCatalogIdentity('P.C.M.',catalog.products).product?.id,'pcm');
 const many='Ciprofloxacin 500mg Tablet '+Array(10).fill('(PCM)').join(' ');
 assert.equal(resolveGeneralCatalogIdentity(many,catalog.products).product,undefined);
});
