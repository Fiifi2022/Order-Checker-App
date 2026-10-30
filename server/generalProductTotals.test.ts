import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { runGeneralProductNameAudit } from './generalProductNameAudit';
import Inventory from '../src/components/GeneralInventory';
import type { ProductCatalog } from '../shared/productCatalog';

const names=['Paracetamol','Metronidazole','Artesunate','Diclofenac','Amoxicillin','ORS'];
const catalog:ProductCatalog={revision:1,products:names.map((name,index)=>({id:String(index),name,scope:'general',aliases:[],contextualAliases:[],category:'medicine',note:''}))};
const header='Orderer: John Mensah\nFacility: Alpha HC\nProducts:\n';
const audit=(requested:string[],fulfilled:string[])=>runGeneralProductNameAudit(header+requested.map(name=>`${name} - 30`).join('\n'),header+fulfilled.map(name=>`${name} [30/30]`).join('\n'),catalog,{},()=>{throw Error('Catalogue products must not need AI');});
function totals(result:Awaited<ReturnType<typeof audit>>) {
 const html=renderToStaticMarkup(createElement(Inventory,{items:result.items,details:result.generalAudit,onOrderLimit(){}}));
 return parseHTML(`<main>${html}</main>`).document.querySelector('[aria-label="Total product comparison"]')!;
}

test('website hides the total-products panel while retaining product comparisons',async()=>{
 const result=await audit(names,[...names].reverse());
 assert.equal(result.allMatch,true);
 assert.deepEqual(result.generalAudit.productCount,{requested:6,found:6,status:'match'});
 assert.equal(totals(result),null);
});

for(const [left,right,direction] of [[names,names.slice(0,5),'fewer'],[names.slice(0,5),names,'more']] as const) {
 test(`unequal product totals preserve the discrepancy verdict without displaying a summary panel`,async()=>{
  const result=await audit([...left],[...right]);
  assert.equal(result.allMatch,false);assert.equal(result.generalAudit.productCount.status,'mismatch');
  assert.equal(result.issueCount,1,'missing/extra product is counted once');
  assert.equal(totals(result),null);
 });
}

test('equal totals cannot clear a wrong product and repeated entries keep existing distinct-product counting',async()=>{
 const wrong=await audit(names.slice(0,5),[...names.slice(0,4),'ORS']);
 assert.equal(wrong.generalAudit.productCount.status,'match');assert.equal(wrong.allMatch,false);
 assert.equal(wrong.items.filter(item=>['missing item','extra item'].includes(item.status)).length,2);
 const repeated=await audit(['Paracetamol','Paracetamol'],['Paracetamol']);
 assert.deepEqual(repeated.generalAudit.productCount,{requested:1,found:1,status:'match'});
});
