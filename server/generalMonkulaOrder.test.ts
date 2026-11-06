import test from 'node:test';
import assert from 'node:assert/strict';
import {extractGeneralInput,generalUnlabelledOrdererCandidates,parseGeneralProducts} from './generalAuditor';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {defaultProducts,applyCatalog,ensureApprovedVaccineCatalogueLabels} from './productCatalog';
import {buildGeneralReport} from '../extension/general-report.js';
import type {ProductCatalog} from '../shared/productCatalog';

const request=`whatsapp
Date:02/11/26
Yorta Naazie Madina
Name of facility: Monkula CHPS
Drop area:karaga hospital
District:karaga
Product and quantity
R21=10Vails`;
const confirmation=`Thank you Yorta Naazie Madina from Monkula CHPS for ordering with Zipline. We have received your order (ID: J3F9C8MXCB). Use this link to track your order: https://orders.zipline.com/t/8/J3F9C8MXCB We will now prepare the following items for delivery:
- Malaria Vaccine (R21) [10/10]
Expected delivery: between November 02, 2026 01:05 PM and November 02, 2026 03:05 PM. Let us know if any changes are required or contact +0800719102 if any questions.
You will receive your flight notifications via SMS`;
const noAI=()=>{throw Error('This complete source evidence needs no model call');};

test('exact Monkula request identifies the unlabelled person and ten vials without borrowing the drop location',async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 const input=extractGeneralInput(request,'customer_request');
 assert.equal(input.ordererName,'Yorta Naazie Madina');assert.equal(input.facilityName,'Monkula CHPS');
 assert.deepEqual(generalUnlabelledOrdererCandidates(request),['Yorta Naazie Madina']);
 assert.equal(input.products.length,1);assert.equal(input.products[0].name,'R21');
 assert.equal(input.products[0].quantity,10);assert.equal(input.products[0].unit,'vial');
 const result=await runGeneralProductNameAudit(request,confirmation,catalog,{semanticTimeoutMs:0},noAI);
 assert.equal(result.allMatch,true);assert.equal(result.issueCount,0);assert.equal(result.geminiMetrics.calls,0);
 assert.equal(result.generalAudit.orderer.status,'match');assert.equal(result.generalAudit.facility.status,'match');
 assert.equal(result.items.length,1);assert.equal(result.items[0].fulfillment.requested,10);assert.equal(result.items[0].fulfillment.supplied,10);
 assert.equal(result.productMatchingDiagnostics[0].customer[0].catalogProductId,result.productMatchingDiagnostics[0].fulfillment[0].catalogProductId);
 assert.doesNotMatch(buildGeneralReport(result),/name missing|quantity not provided|possible abbreviated|Missing Product|Extra Product/i);
});

test('attached and spaced closed vial spellings are counts, never strengths or digits inside a product name',()=>{
 for(const unit of ['Vails','vail','vials','Vialls','vilas'])for(const gap of ['',' ']) {
  const products=parseGeneralProducts(`R21=10${gap}${unit}`,'customer_request');
  assert.equal(products.length,1);assert.equal(products[0].name,'R21');assert.equal(products[0].quantity,10);assert.equal(products[0].unit,'vial');
 }
 assert.equal(parseGeneralProducts('R21','customer_request').length,0);
});

test('metadata-heavy headers generalise without accepting multiple people or clinical names',()=>{
 const variant=request.replace('Yorta Naazie Madina','Afia Jane Mensah').replace('Monkula CHPS','Example HC');
 assert.equal(extractGeneralInput(variant,'customer_request').ordererName,'Afia Jane Mensah');
 assert.equal(extractGeneralInput(variant.replace('Afia Jane Mensah','Nurse Afia Jane Mensah'),'customer_request').ordererName,'Nurse Afia Jane Mensah');
 for(const text of [request.replace('Yorta Naazie Madina','Patient: Yorta Naazie Madina'),request.replace('Yorta Naazie Madina','Yorta Naazie Madina\nJane Mensah'),request.replace('Yorta Naazie Madina','')]) {
  assert.deepEqual(generalUnlabelledOrdererCandidates(text),[]);assert.equal(extractGeneralInput(text,'customer_request').ordererName,'N/A');
 }
});

test('saved R21 catalogues receive approved full labels once; competing and rejected mappings stay protected',()=>{
 const legacy:ProductCatalog={revision:8,products:[{id:'saved-r21',name:'R21',scope:'vaccine',category:'vaccine',aliases:['R21'],contextualAliases:[],note:''}]};
 const updated=ensureApprovedVaccineCatalogueLabels(legacy);
 assert.equal(updated.revision,9);assert.equal(updated.products[0].id,'saved-r21');assert.ok(updated.products[0].aliases.includes('Malaria Vaccine (R21)'));
 assert.equal(legacy.products[0].aliases.length,1);assert.equal(ensureApprovedVaccineCatalogueLabels(updated),updated);
 const ambiguous={...legacy,products:[...legacy.products,{...legacy.products[0],id:'other-r21'}]};
 assert.equal(ensureApprovedVaccineCatalogueLabels(ambiguous),ambiguous);
 const rejected:ProductCatalog={...legacy,aliasRecords:[{id:'rejected',productId:'saved-r21',text:'Malaria Vaccine (R21)',normalizedText:'malaria r21 vaccine',source:'manual',status:'rejected',active:false,createdAt:null,approvedAt:null,approvedBy:null,updatedAt:null}]};
 assert.ok(!ensureApprovedVaccineCatalogueLabels(rejected).products[0].aliases.includes('Malaria Vaccine (R21)'));
});

test('a genuine quantity difference or different named orderer still prevents a cleared audit',async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 for(const text of [confirmation.replace('[10/10]','[11/11]'),confirmation.replace('Yorta Naazie Madina','Jane Mensah')]) {
  const result=await runGeneralProductNameAudit(request,text,catalog,{semanticTimeoutMs:0},noAI);
  assert.equal(result.allMatch,false);assert.ok(result.issueCount>0);
 }
});
