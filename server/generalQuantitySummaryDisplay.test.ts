import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {runGeneralAuditor} from './generalAuditor';
import Details from '../src/components/GeneralAuditDetails';
import Inventory from '../src/components/GeneralInventory';
import {buildGeneralReport} from '../extension/general-report.js';
const header='Orderer: Mary Mensah\nFacility: Example HC\n';

for (const [name,confirmation,status,passed] of [
 ['quantity mismatch','Oral Rehydration Salts [3/3]','quantity mismatch',false],
 ['valid stockout','Oral Rehydration Salts [0/5]','out of stock',true],
 ['fully supplied','Oral Rehydration Salts [5/5]','match',true],
] as const) test(`summary removal preserves individual product quantities and ${name} validation`,()=>{
 const record=runGeneralAuditor(header+'ORS - 5',header+confirmation);
 record.generalAudit.productComparisonMode='names_and_quantities';
 const before=JSON.stringify(record);
 const detail=renderToStaticMarkup(createElement(Details,{details:record.generalAudit}));
 const inventory=renderToStaticMarkup(createElement(Inventory,{items:record.items,details:record.generalAudit,onOrderLimit(){}}));
 const extension=buildGeneralReport(record);
 for(const html of [detail,extension])assert.doesNotMatch(html,/Quantities \(mandatory\)|<strong>Quantities<\/strong>/);
 for(const html of [inventory,extension]){
   assert.match(html,/Requested: 5/);
   assert.match(html,/Fulfilled:/);
 }
 assert.equal(record.items[0].status,status);assert.equal(record.allMatch,passed);
 assert.equal(JSON.stringify(record),before);
});
