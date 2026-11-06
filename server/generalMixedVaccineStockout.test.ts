import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultProducts,applyCatalog,ensureApprovedVaccineCatalogueLabels} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog} from '../shared/productCatalog';
import {catalogAliasKey} from '../shared/productCatalog';

const request=`Name: Iddrisu Nasara
Facility: Auntie Riek HC
District: Sekyere Afram Plains
Order
1. BCG (3)
2. Y/F (3)
3. Penta (3)
4. Tablet paracetamol 500mg (500)
5. Intravenous infusion sodium chloride (5)`;
const confirmation=`Thank you Nasara Iddrisu from Auntie Riek HC for ordering with Zipline. We have received your order (ID: 6XHPW74QH8).
We will now prepare the following items for delivery:
- Bacille Calmette-Guerin Vaccine Diluent [3/3]
- Bacille Calmette-Guerin Vaccine [3/3]
- Paracetamol 500mg Tablet [3/3]
- Pentavalent (5-in-1) Vaccine [3/3]
We are currently out of stock for the following.
- Sodium Chloride 0.9% Infusion, 500mL [0/1]
- Yellow Fever Vaccine [0/1]`;
const noAI=()=>{throw Error('Approved catalogue aliases require no model call');};
async function run(customer=request,catalog:ProductCatalog={revision:1,products:defaultProducts()}){
 applyCatalog(catalog);return runGeneralProductNameAudit(customer,confirmation,catalog,{semanticTimeoutMs:0},noAI);
}

test('Y/F stockout stays matched to Yellow Fever and never consumes the supplied BCG diluent',async()=>{
 const result=await run();
 assert.equal(result.generalAudit.orderer.status,'match');assert.equal(result.generalAudit.facility.status,'match');
 const yellow=result.items.find(item=>item.name==='Yellow Fever Vaccine')!;
 assert.equal(yellow.status,'out of stock');assert.equal(yellow.fulfillment.requested,3);assert.equal(yellow.fulfillment.supplied,0);
 const bcg=result.items.find(item=>item.name==='Bacille Calmette-Guerin Vaccine')!;
 assert.equal(bcg.status,'match');assert.equal(bcg.fulfillment.vaccinePairingError,undefined);
 assert.equal(result.items.find(item=>/sodium chloride/i.test(item.name))?.status,'out of stock');
 const paracetamol=result.items.find(item=>/paracetamol/i.test(item.name))!;
 assert.equal(paracetamol.fulfillment.requested,500);assert.equal(paracetamol.fulfillment.supplied,3);assert.equal(paracetamol.status,'pending order limit');
 assert.equal(result.allMatch,false);assert.equal(result.issueCount,0,'Stockouts are not red discrepancies; the unresolved order limit still prevents clearance');
 assert.doesNotMatch(buildGeneralReport(result),/Missing Product|Extra Product|Required diluent missing|identity unresolved/i);
 assert.equal(result.geminiMetrics.calls,0);
});

test('the same mixed order clears when its actual supplied paracetamol quantity matches',async()=>{
 const result=await run(request.replace('500mg (500)','500mg (3)'));
 assert.equal(result.allMatch,true);assert.equal(result.issueCount,0);
 assert.equal(result.items.filter(item=>item.status==='out of stock').length,2);
});

test('the confirmed paracetamol order limit clears this order while preserving its two stockouts',async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 const first=await runGeneralProductNameAudit(request,confirmation,catalog,{semanticTimeoutMs:0},noAI);
 const key=first.items.find(item=>/paracetamol/i.test(item.name))!.fulfillment.key;
 const approved=await runGeneralProductNameAudit(request,confirmation,catalog,{semanticTimeoutMs:0,generalOrderLimitDecisions:{[key]:true}},noAI);
 assert.equal(approved.allMatch,true);assert.equal(approved.issueCount,0);
 assert.equal(approved.items.filter(item=>item.status==='out of stock').length,2);
 const item=approved.items.find(item=>/paracetamol/i.test(item.name))!;
 assert.equal(item.fulfillment.requested,500);assert.equal(item.fulfillment.supplied,3);assert.equal(item.fulfillment.orderLimitDecision,true);
});

test('an unrecognised vaccine cannot be grouped with an unrelated known BCG diluent',async()=>{
 const catalog={revision:1,products:defaultProducts().map(product=>({...product,aliases:product.aliases.filter(alias=>alias!=='Y/F')}))};
 const result=await run(request,catalog);
 assert.equal(result.allMatch,false);
 assert.equal(result.items.find(item=>item.name==='Bacille Calmette-Guerin Vaccine')?.status,'match');
 assert.ok(!result.items.some(item=>item.fulfillment.vaccinePairingError));
 assert.ok(!result.items.some(item=>item.status==='product identity discrepancy'&&/diluent/i.test(item.name)));
});

test('existing Yellow Fever catalogue identities receive the approved slash acronym once, without overriding rejected aliases',()=>{
 const legacy:ProductCatalog={revision:5,products:defaultProducts().filter(product=>/^(Yellow Fever|Yellow Fever Vaccine)$/.test(product.name)).map(product=>({...product,aliases:product.aliases.filter(alias=>alias!=='Y/F')}))};
 const upgraded=ensureApprovedVaccineCatalogueLabels(legacy);
 assert.equal(upgraded.revision,6);assert.deepEqual(upgraded.products.map(p=>p.id),legacy.products.map(p=>p.id));
 assert.ok(upgraded.products.every(p=>p.aliases.includes('Y/F')));assert.equal(ensureApprovedVaccineCatalogueLabels(upgraded),upgraded);
 const rejected:ProductCatalog={...legacy,aliasRecords:[{id:'rejected-yf',productId:legacy.products[0].id,text:'Y/F',normalizedText:catalogAliasKey('Y/F'),source:'manual',status:'rejected',active:false,createdAt:null,approvedAt:null,approvedBy:null,updatedAt:null}]};
 assert.equal(ensureApprovedVaccineCatalogueLabels(rejected),rejected);
});
