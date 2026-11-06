import test from 'node:test';
import assert from 'node:assert/strict';
import {previewBlueprintSheetPaste,mergeBlueprintSheetPaste,arrangeBlueprintSheetPaste} from '../src/utils/blueprintSheetPaste';
import type {CatalogProduct} from '../shared/productCatalog';
const products=['BCG','OPV'];
const parse=(text:string)=>previewBlueprintSheetPaste(text,products);
const existing=()=>[{id:'stable-a',facility:'North Health Centre',facilityId:'official-id',processing:'2026-11-01',completed:'',subDistrict:'Original',deliverySite:'Old site',comment:'Keep note',vaccines:{BCG:{carryOver:2,allocation:10,distributed:3,balance:9},OPV:{carryOver:1,allocation:8,distributed:2,balance:7}}},{id:'stable-hidden',facility:'Other CHPS',processing:'',completed:'',subDistrict:'',vaccines:{BCG:{carryOver:0,allocation:7,distributed:0,balance:7},OPV:{carryOver:0,allocation:4,distributed:0,balance:4}}}];
test('whole sheet automatically maps reordered flat headings and recognized vaccine aliases',()=>{
 const preview=parse('bOPV\tDelivery Site\tFacility Name\tBCG Allocation\tSub-district\n12\tFront gate\tNorth HC\t30\tNorth\n20\tMain road\tSouth CHPS\t40\tSouth');
 assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.products,['OPV','BCG']);assert.equal(preview.rows[0].vaccines.OPV.allocation,12);assert.equal(preview.rows[1].deliverySite,'Main road');
 const merged=mergeBlueprintSheetPaste(existing(),products,preview);
 assert.equal(merged.updated,1);assert.equal(merged.added,1);assert.equal(merged.rows.length,3);
 assert.equal(merged.rows[0].id,'stable-a');assert.equal((merged.rows[0] as any).facilityId,'official-id');assert.equal(merged.rows[0].vaccines.BCG.balance,29);assert.equal(merged.rows[0].processing,'2026-11-01');assert.equal((merged.rows[0] as any).comment,'Keep note');assert.ok(merged.rows.some(row=>row.facility==='Other CHPS'));
});
test('merged multi-row Blueprint headers map groups and recalculate copied balances',()=>{
 const preview=parse('Test District November 2026\nProcessing\tCompleted\tFacility\tSub-district\tDelivery Site\tVACCINES\n\t\t\t\t\tOPV\t\t\t\tBCG\t\t\t\n\t\t\t\t\tCarry-over\tAllocation\tDistributed\tBalance\tCarry-over\tAllocation\tDistributed\tBalance\n02/11/2026\t\tNorth HC\tNorth\tGate\t1\t20\t3\t999\t2\t30\t4\t999');
 assert.deepEqual(preview.errors,[]);assert.equal(preview.rows[0].vaccines.OPV.balance,18);assert.equal(preview.rows[0].vaccines.BCG.balance,28);assert.equal(preview.rows[0].processing,'02/11/2026');
});
test('grouped subcolumns may be in a different order when their headings identify them',()=>{
 const preview=parse('Facility\tBCG\t\t\t\n\tDistributed\tAllocation\tBalance\tCarry-over\nNorth HC\t3\t20\t999\t2');
 assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.rows[0].vaccines.BCG,{carryOver:2,allocation:20,distributed:3,balance:19});
});
test('flat product fields may be reordered and missing columns retain existing values',()=>{
 const preview=parse('BCG Distributed\tFacility\tAllocation OPV\n4\tNorth HC\t12');
 assert.deepEqual(preview.errors,[]);const merged=mergeBlueprintSheetPaste(existing(),products,preview);
 assert.equal(merged.rows[0].vaccines.BCG.allocation,10);assert.equal(merged.rows[0].vaccines.BCG.distributed,4);assert.equal(merged.rows[0].vaccines.BCG.balance,8);assert.equal(merged.rows[0].vaccines.OPV.allocation,12);
});
test('explicit empty quantities clear that field but do not erase other columns',()=>{
 const preview=parse('Facility\tBCG\nNorth HC\t');const merged=mergeBlueprintSheetPaste(existing(),products,preview);
 assert.equal(merged.rows[0].vaccines.BCG.allocation,'');assert.equal(merged.rows[0].vaccines.BCG.balance,-1);assert.equal(merged.rows[0].vaccines.OPV.allocation,8);
});
test('named new product columns can be created in the Blueprint without changing the catalogue',()=>{
 const preview=parse('Facility\tNew Vaccine\nNorth HC\t12');assert.deepEqual(preview.errors,[]);
 const merged=mergeBlueprintSheetPaste(existing(),products,preview);assert.deepEqual(merged.products,['BCG','OPV','New Vaccine']);assert.equal(merged.rows[0].vaccines['New Vaccine'].balance,12);
});
test('approved catalogue names identify an existing Blueprint acronym without adding duplicate columns',()=>{
 const catalogue=[{id:'opv',scope:'vaccine',name:'Oral Polio Vaccine',aliases:['OPV','bOPV'],contextualAliases:[]} as CatalogProduct];
 const preview=previewBlueprintSheetPaste('Facility\tOral Polio Vaccine\nNorth HC\t12',products,catalogue);
 assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.products,['OPV']);
});
test('invalid quantities, duplicate facility aliases and duplicate product fields reject the complete sheet',()=>{
 for(const text of ['Facility\tBCG\nNorth HC\t12\nSouth CHPS\tinvalid','Facility\tBCG\nNorth HC\t1\nNorth Health Centre\t2','Facility\tOPV\tbOPV\nNorth HC\t1\t2']){
  const preview=parse(text);assert.ok(preview.errors.length);const source=existing(),before=structuredClone(source);assert.throws(()=>mergeBlueprintSheetPaste(source,products,preview));assert.deepEqual(source,before);
 }
});
test('duplicate destination facilities stop the merge without mutating data',()=>{
 const rows=[...existing(),{...existing()[0],id:'duplicate'}],before=structuredClone(rows);
 assert.throws(()=>mergeBlueprintSheetPaste(rows,products,parse('Facility\tBCG\nNorth HC\t12')),/Multiple existing/);assert.deepEqual(rows,before);
});
test('blank Excel rows, serial-number columns and total rows do not create phantom facilities',()=>{
 const preview=parse('S/N\tFacility\tBCG\n1\tNorth HC\t1,000\n\t\t\n2\tSouth CHPS\t(12)\n\tGrand Total\t988');
 assert.deepEqual(preview.errors,[]);assert.equal(preview.rows.length,2);assert.equal(preview.skippedRows,1);assert.equal(preview.rows[1].vaccines.BCG.allocation,-12);
});
test('headerless data and missing facility names never cause guessed column arrangements',()=>{
 assert.match(parse('North HC\t12\t20').errors[0],/heading/);
 assert.match(parse('Facility\tBCG\n\t12').errors[0],/no facility/);
 assert.match(parse('Facility\t\nNorth HC\t12').errors[0],/no product name/);
});

test('sheet district/cycle titles and explicit metadata remain available to prevent pasting into the wrong tab',()=>{
 const preview=parse('North District October 2026\nFacility\tDistrict\tMonth\tBCG\nNorth HC\tNorth District\tOctober 2026\t12');
 assert.equal(preview.district,'North District');assert.equal(preview.month,'October 2026');assert.equal((preview.rows[0] as any).district,'North District');
});

test('new facilities fill unused default rows so pasted data is visible at the top of an empty sheet',()=>{
 const initial=[{id:'empty-1',facility:'',processing:'',completed:'',subDistrict:'',vaccines:{}},{id:'empty-2',facility:'',processing:'',completed:'',subDistrict:'',vaccines:{}}];
 const merged=mergeBlueprintSheetPaste(initial,products,parse('Facility\tBCG\nNorth HC\t12\nSouth CHPS\t20'));
 assert.equal(merged.rows.length,2);assert.equal(merged.rows[0].id,'empty-1');assert.equal(merged.rows[0].facility,'North HC');assert.equal(merged.added,2);assert.equal(merged.updated,0);
});

test('an empty-named row with an official facility binding is never reused for a different facility',()=>{
 const initial=[{id:'old-bound-row',facility:'',facilityId:'official-other-id',processing:'',completed:'',subDistrict:'',vaccines:{}}];
 const merged=mergeBlueprintSheetPaste(initial,products,parse('Facility\tBCG\nNew CHPS\t12'));
 assert.notEqual(merged.rows[0].id,'old-bound-row');assert.equal((merged.rows[0] as any).facilityId,undefined);assert.equal(merged.rows[1].id,'old-bound-row');assert.equal(merged.rows[1].facilityId,'official-other-id');
});


test('ordinary paste detects named tables, adds rows/products, and blocks conflicting cycle metadata',()=>{
 const context={district:'North District',month:'November 2026'};
 const arranged=arrangeBlueprintSheetPaste('Facility\tBCG Allocation\tNew Vaccine Allocation\nNorth HC\t12\t4',existing(),products,context);
 assert.equal(arranged.updated,1);assert.equal(arranged.rows[0].id,'stable-a');assert.ok(arranged.products.includes('New Vaccine'));
 assert.equal(arrangeBlueprintSheetPaste('1\t2\t3',existing(),products,context),null);
 assert.throws(()=>arrangeBlueprintSheetPaste('Other District October 2026\nFacility\tBCG\nNorth HC\t12',existing(),products,context),/Other District/);
});
