import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {generalProductFindingText} from '../shared/generalProductFinding';
import {defaultProducts,applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import Inventory from '../src/components/GeneralInventory';
import {buildGeneralReport} from '../extension/general-report.js';

test('legacy technical product messages become plain findings without changing genuine discrepancy reasons',()=>{
 assert.equal(generalProductFindingText('Product identity unresolved — confirm the repository mapping.'),'Product could not be matched. Check the product name.');
 for(const reason of ['Requested 5; supplied 3','Required diluent missing','Product strength mismatch','Facility name mismatch'])assert.equal(generalProductFindingText(reason),reason);
});

test('app and extension replace old saved wording while keeping an unmatched product uncleared',async()=>{
 const catalog={revision:1,products:defaultProducts()};applyCatalog(catalog);
 const r=await runGeneralProductNameAudit('Name: Grace\nFacility: Example HC\nUnknown remedy 2','Thank you Grace from Example HC for ordering with Zipline.\nUnrecognized counterpart [2/2]',catalog,{semanticTimeoutMs:0},()=>{throw Error('No AI fixture');});
 assert.equal(r.allMatch,false);
 const old=structuredClone(r);
 for(const item of old.items)if(item.fulfillment.identityReviewRequired){
  item.fulfillment.identityError='Product identity unresolved — confirm the repository mapping.';
  item.fulfillment.quantityError='Not verified — resolve product identity.';
  item.action=item.fulfillment.identityError;
 }
 const original=JSON.stringify(old);
 const html=renderToStaticMarkup(createElement(Inventory,{items:old.items,details:old.generalAudit,onOrderLimit(){}}));
 const extension=buildGeneralReport(old);
 for(const output of [html,extension]){
  assert.doesNotMatch(output,/Product identity unresolved|confirm the repository mapping|Not verified — resolve product identity/);
  assert.match(output,/Product could not be matched/);
 }
 assert.equal(JSON.stringify(old),original,'Presentation does not rewrite saved evidence or clear the audit');
 assert.equal(old.allMatch,false);assert.ok(old.items.some(item=>item.fulfillment.identityReviewRequired));
});
