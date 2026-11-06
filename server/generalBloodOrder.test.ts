import test from 'node:test';
import assert from 'node:assert/strict';
import {extractGeneralInput} from './generalAuditor';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {defaultProducts,applyCatalog} from './productCatalog';
import {resolveGeneralCatalogIdentity} from '../src/utils/generalProductLog';

const request=`Whatsapp
Date: 02/11/2026
Name of Orderer: Evelyn Ofori Adofo
Name of Health Facility: AGONA SWEDRU MUNICIPAL HOSPITAL
Delivery/ Drop Area: BEHIND THE LAB
District: AGONA WEST
Blood Component : WB
Group: O positive
NB: 4 units
Name and Contact of referring Physician: Dr.Abuku (0243884492)`;
const confirmation=`Thank you Evelyn owusu- adofo from Agona West Municipal HSP (CR) for ordering with Zipline. We have received your Emergency order (ID: QYJF91KUMT)]. We are currently out of stock for the following items:
- WB O+ adult [0/1]
Please reach out to the nearest stock for these items. Once re-stocked, we will notify you and be able to deliver them.`;
const noAI=()=>{throw Error('AI unavailable for deterministic regression');};
const catalogue=()=>{const c={revision:1,products:defaultProducts()};applyCatalog(c);return c;};

test('split blood component, ABO/Rh and NB units assemble from source fields',()=>{
 catalogue();const input=extractGeneralInput(request,'customer_request');
 assert.equal(input.products.length,1);assert.equal(input.products[0].name,'WB O positive');
 assert.equal(input.products[0].quantity,4);assert.equal(input.products[0].unit,'unit');
 assert.match(input.products[0].sourceOriginalText!,/NB: 4 units/);
 assert.doesNotMatch(input.products[0].sourceOriginalText!,/0243884492/);
});

test('whole blood stockout resolves to catalogue component while genuine name differences remain',async()=>{
 const catalog=catalogue();
 assert.ok(resolveGeneralCatalogIdentity('WB O+ adult',catalog.products).product);
 const result=await runGeneralProductNameAudit(request,confirmation,catalog,{semanticTimeoutMs:0},noAI);
 assert.equal(result.items.length,1);assert.equal(result.items[0].status,'out of stock');
 assert.equal(result.items[0].fulfillment.requested,4);assert.equal(result.items[0].fulfillment.supplied,0);
 assert.equal(result.generalAudit.orderer.status,'mismatch');
 assert.equal(result.allMatch,false);
 assert.match(result.items[0].provenance.find(p=>p.source==='customer_request')!.sourceOriginalText!,/Group: O positive/);
});

test('matching names and facility with documented blood stockout do not create a product discrepancy',async()=>{
 const catalog=catalogue();
 const clean=confirmation.replace('Evelyn owusu- adofo','Evelyn Ofori Adofo').replace('Agona West Municipal HSP (CR)','AGONA SWEDRU MUNICIPAL HOSPITAL');
 const result=await runGeneralProductNameAudit(request,clean,catalog,{semanticTimeoutMs:0},noAI);
 assert.equal(result.allMatch,true);assert.equal(result.issueCount,0);
});

test('blood group, component and explicitly conflicting qualifiers remain protected',async()=>{
 for(const product of ['WB O- adult','WB A+ adult','PRBC O+ adult','WB O+ paediatric','WB O+ irradiated']) {
  const catalog=catalogue();
  const source=product.includes('paediatric')?request.replace('Component : WB','Component : WB adult'):request;
  const result=await runGeneralProductNameAudit(source,confirmation.replace('WB O+ adult',product),catalog,{semanticTimeoutMs:0},noAI);
  assert.ok(result.items.some(item=>!['match','out of stock'].includes(item.status)),product);
 }
});

test('blood fields do not borrow physician numbers, infer missing Rh, or merge repeated groups',()=>{
 catalogue();
 for(const text of [request.replace('NB: 4 units',''),request.replace('Group: O positive','Group: O'),request.replace('Group: O positive','Group: O positive\nGroup: A positive'),request.replace('NB: 4 units','NB: 4 units\nQuantity: 8 units')]) {
  assert.equal(extractGeneralInput(text,'customer_request').products.some(p=>p.name==='WB O positive' && p.quantity===4),false);
 }
});


test('different ABO/Rh rows keep separate quantities even under one repository component',async()=>{
 const catalog=catalogue();
 const a='Orderer: Jane Mensah\nFacility: Example HC\nWB O positive - 2 units\nWB A negative - 3 units';
 const b='Thank you Jane Mensah from Example HC for ordering with Zipline.\n- WB O+ adult [2/2]\n- WB A- adult [3/3]';
 const result=await runGeneralProductNameAudit(a,b,catalog,{semanticTimeoutMs:0},noAI);
 assert.equal(result.items.length,2);assert.equal(result.allMatch,true);
 assert.deepEqual(result.items.map(item=>item.fulfillment.requested).sort(),[2,3]);
});

test('qualified blood descriptions are not learned as a generic component alias',async()=>{
 const {canAutomaticallyLearnGeneralAlias}=await import('../src/utils/generalProductLog');
 const catalog=catalogue(),wb=resolveGeneralCatalogIdentity('WB',catalog.products).product!;
 assert.equal(canAutomaticallyLearnGeneralAlias('WB O+ adult',wb),false);
});


test('repositories with group-specific blood entries resolve wording without needing a generic WB record',async()=>{
 const product={id:'wb-o-positive-adult',name:'WB O+ adult',scope:'general' as const,category:'blood' as const,aliases:[],contextualAliases:[],note:''};
 const catalog={revision:1,products:[product]};applyCatalog(catalog);
 assert.equal(resolveGeneralCatalogIdentity('WB O positive',catalog.products).product?.id,product.id);
 assert.equal(resolveGeneralCatalogIdentity('WB O negative',catalog.products).product,undefined);
 assert.equal(resolveGeneralCatalogIdentity('WB O positive paediatric',catalog.products).product,undefined);
 const result=await runGeneralProductNameAudit(request,confirmation,catalog,{semanticTimeoutMs:0},noAI);
 assert.equal(result.items.length,1);assert.equal(result.items[0].status,'out of stock');
});
