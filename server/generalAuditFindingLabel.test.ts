import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeneralAuditor} from '../src/utils/generalAuditor';
import {generalAuditFindingLabel, generalFieldFindingLabel} from '../src/utils/generalAuditFindingLabel';

test('missing and unverified fields display their actual issue without inventing a mismatch', () => {
  assert.equal(generalFieldFindingLabel('Facility name', {status:'missing from customer request'}), 'Facility name missing from customer request');
  assert.equal(generalFieldFindingLabel('Orderer name', {status:'not available in system entry'}), 'Orderer name missing from fulfilment');
  assert.equal(generalFieldFindingLabel('Orderer name', {status:'review required', reason:'Initials alone do not establish identity.'}), 'Initials alone do not establish identity.');
});

test('audit label uses genuine discrepancies ahead of unresolved fields and leaves the decision intact', () => {
  const result = runGeneralAuditor('Orderer: Isaac Awuyem\nFacility: Gbimsi CHPS\nParacetamol 500mg - 5', 'Orderer: Isaac Awuyem\nFacility: Karaga CHPS\nParacetamol 500mg [5/5]');
  const before = JSON.stringify(result.generalAudit);
  assert.match(generalAuditFindingLabel(result.generalAudit), /Facility name mismatch/i);
  assert.equal(JSON.stringify(result.generalAudit), before);
});

test('quantity and product review labels describe the affected product', () => {
  const details = runGeneralAuditor('Orderer: Isaac Awuyem\nFacility: Gbimsi CHPS\nParacetamol 500mg - 5', 'Orderer: Isaac Awuyem\nFacility: Gbimsi CHPS\nParacetamol 500mg [5/5]').generalAudit;
  details.productVerifications = [{productName:'Unknown product', status:'review required', reason:'No catalogue product matches this name.'} as any];
  assert.equal(generalAuditFindingLabel(details), 'Unknown product: No catalogue product matches this name.');
});

test('cleared stockout headlines agree in the website helper and extension report without hiding discrepancies',async()=>{
  const {generalAuditConfirmedLabel}=await import('../src/utils/generalAuditFindingLabel');
  const {runGeneralProductNameAudit}=await import('./generalProductNameAudit');
  const {defaultProducts,applyCatalog}=await import('./productCatalog');
  const {buildGeneralReport}=await import('../extension/general-report.js');
  const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
  const customer='Orderer: Jane Mensah\nFacility: Example HC\nParacetamol 500mg Tablet - 5';
  for(const stockout of [false,true]) {
    const fulfillment=`Orderer: Jane Mensah\nFacility: Example HC\n${stockout?'Currently out of stock:\n':''}Paracetamol 500mg Tablet [${stockout?'0':'5'}/5]`;
    const result=await runGeneralProductNameAudit(customer,fulfillment,catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI needed');});
    assert.equal(result.allMatch,true);
    const expected=stockout?'ORDER CONFIRMED, BUT OUT OF STOCK':'ORDER CONFIRMED, CLEAR TO LAUNCH';
    assert.equal(generalAuditConfirmedLabel(result.generalAudit),expected);
    assert.ok(buildGeneralReport(result).includes(expected));
    const mismatch=await runGeneralProductNameAudit(customer,fulfillment.replace('Jane Mensah','Grace Akabati'),catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI needed');});
    assert.equal(mismatch.allMatch,false);
    assert.doesNotMatch(buildGeneralReport(mismatch),/ORDER CONFIRMED/);
  }
  assert.equal(generalAuditConfirmedLabel({stockStatus:'partially out of stock'}),'ORDER CONFIRMED, BUT OUT OF STOCK');
});
