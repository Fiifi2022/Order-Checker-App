import {arrangeBlueprintSheetPaste,hasBlueprintSheetHeadings} from '../src/utils/blueprintSheetPaste';
import {expandBlueprintRange} from '../src/utils/blueprintRangeExpansion';
import {layoutColumns,layoutColumnKey} from '../src/utils/blueprintLayout';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
import {blueprintClipboardText,blueprintPasteRowTargets,blueprintPasteQuantity} from '../src/utils/blueprintClipboard';
import {parseClipboardTsv,parseBlueprintPaste,stripBlueprintHeaderRows} from '../src/utils/blueprintPaste';
import {blueprintColumnKey} from '../src/utils/blueprintColumns';
const source=readFileSync(new URL('../src/components/VaccineAllocationBlueprint.tsx',import.meta.url),'utf8');
const pasteCode=source.slice(source.indexOf('  // Helper: Parse Tab-Separated Values'),source.indexOf('  // Record completion'));
const balanceCode=source.slice(source.indexOf('  const computeBalance ='),source.indexOf('  const requestDhdTopUp'));
const progressCode=source.slice(source.indexOf('function normalizeFacilityProgress('),source.indexOf('function normalizeBlueprintRowsProgress('));
function harness(){
 const products=['BCG','OPV'];const blank=(id:string)=>({id,processing:'',completed:'',facility:`Clinic ${id}`,subDistrict:'',deliverySite:'',vaccines:{BCG:{carryOver:0,allocation:0,distributed:0,balance:0},OPV:{carryOver:0,allocation:0,distributed:0,balance:0}}});
 const saves:any[]=[];const c:any={products,rows:[blank('a'),blank('hidden'),blank('b')],districts:[{id:'sheet',cycleState:'active'}],activeDistrictId:'sheet',district:'Example',month:'November',visibleColumns:Array.from({length:13},(_,i)=>i),blankColumns:[],deletedColumnKeys:[],customColumn:()=>undefined,
  arrangeBlueprintSheetPaste,hasBlueprintSheetHeadings,expandBlueprintRange,layoutColumnKey,blueprintClipboardText,blueprintPasteRowTargets,blueprintPasteQuantity,parseClipboardTsv,parseBlueprintPaste,stripBlueprintHeaderRows,blueprintColumnKey,
  normalizeBlueprintRowsProgress:(rows:any)=>rows,importCatalog:[],cellMerges:[],hiddenRowIds:[],headerLabels:[],historyCellGroupRef:{current:null},setCellMerges:()=>{},setHiddenRowIds:()=>{},setSearchQuery:()=>{},setStatusFilter:()=>{},setSortField:()=>{},setSelectedCellRange:()=>{},setFocusedCell:()=>{},setProducts:(products:any)=>{c.products=products;},updateDeletedColumns:(keys:any)=>{c.deletedColumnKeys=keys;},updateBlankColumns:(columns:any)=>{c.blankColumns=columns;},makeBlankBlueprintRow:blank,pendingEditsRef:{current:[]},setSaveStatus:(value:any)=>{c.status=value;},setTimeout:()=>1,
  setRows:(updater:any)=>{c.rows=typeof updater==='function'?updater(c.rows):updater;},saveBlueprintToServer:(rows:any)=>{saves.push(structuredClone(rows));},getCellRangeBounds:()=>c.bounds || null,focusedCell:{rowId:'b',colIdx:5},updateGridCell:(...args:any[])=>{c.single=args;},Date,Error,
 };
 Object.defineProperty(c,'visibleColumns',{get:()=>layoutColumns(c.products,c.deletedColumnKeys,c.blankColumns)});
 c.customColumn=(index:number)=>c.blankColumns[index-5-c.products.length*4];
 Object.defineProperty(c,'filteredAndSortedRows',{get:()=>['b','a'].map(id=>c.rows.find((row:any)=>row.id===id))});
 vm.createContext(c);vm.runInContext(ts.transpile(progressCode+balanceCode+pasteCode+'\nglobalThis.paste=handleDirectCellPasteRaw;globalThis.capture=handleGridPaste;globalThis.legacy=handleDirectCellPaste;'),c);
 return{c,saves};
}
function event(c:any,text:string,html='',input=false){
 const {document}=parseHTML(`<html><body><div id="grid"><table><tbody><tr><td data-grid-cell-row="b" data-grid-cell-col="5"><input></td></tr></tbody></table></div></body></html>`);
 return{target:input?document.querySelector('input'):document.getElementById('grid'),currentTarget:document.getElementById('grid'),clipboardData:{getData:(type:string)=>type==='text/plain'?text:type==='text/html'?html:''},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
}

test('selected grid range receives the real Excel paste handler even without a focused input',()=>{
 const {c,saves}=harness();c.bounds={firstRow:0,lastRow:1,firstCol:5,lastCol:7};
 const e=event(c,'5\t20\t3\r\n1\t10\t2\r\n');c.capture(e);
 assert.equal(e.defaultPrevented,true);assert.equal(saves.length,1);
 assert.equal(c.rows.find((r:any)=>r.id==='b').vaccines.BCG.balance,22);
 assert.equal(c.rows.find((r:any)=>r.id==='a').vaccines.BCG.balance,9);
 assert.equal(c.rows.find((r:any)=>r.id==='hidden').vaccines.BCG.balance,0);
});

test('input range paste is handled once, retaining blank cells and decimal or accounting quantities',()=>{
 const {c,saves}=harness();const e=event(c,'1,000\t(12)\t-\n\t2.5\t1', '',true);
 c.capture(e);c.legacy(e,'b',5);
 assert.equal(saves.length,1);assert.equal(c.rows.find((r:any)=>r.id==='b').vaccines.BCG.balance,988);
 assert.equal(c.rows.find((r:any)=>r.id==='a').vaccines.BCG.carryOver,'');
 assert.equal(c.rows.find((r:any)=>r.id==='a').vaccines.BCG.balance,1.5);
});

test('HTML-only multi-column Excel clipboard content follows the selected starting cell',()=>{
 const {c,saves}=harness();c.focusedCell={rowId:'b',colIdx:2};
 c.capture(event(c,'','<table><tr><td>North HC</td><td>North</td></tr><tr><td>South CHPS</td><td>South</td></tr></table>'));
 assert.equal(saves.length,1);assert.equal(c.rows.find((r:any)=>r.facility==='North HC').facility,'North HC');
 assert.equal(c.rows.find((r:any)=>r.id==='a').subDistrict,'South');
});

test('invalid block values reject the whole paste without partial edits or a save',()=>{
 for(const [text,col] of [['5\t20\t3\n1\tnot a number\t2',5]] as const){
  const {c,saves}=harness(),before=JSON.stringify(c.rows);c.paste(text,'b',col);
  assert.equal(JSON.stringify(c.rows),before);assert.equal(saves.length,0);assert.match(c.status,/Paste canceled/);
 }
});

test('extending a filtered view appends rows and does not overwrite hidden facilities',()=>{
 const {c,saves}=harness();c.paste('5\t20\t3\n1\t10\t2\n2\t8\t1','a',5);
 assert.equal(saves.length,1);assert.equal(c.rows.length,5);
 assert.equal(c.rows.find((r:any)=>r.id==='hidden').vaccines.BCG.balance,0);
 assert.deepEqual(Array.from(c.rows.slice(-2),(r:any)=>r.vaccines.BCG.balance),[9,9]);
});

test('closed cycles, invisible anchors and calculated balance cells cannot be changed by paste',()=>{
 const {c,saves}=harness();c.districts[0].cycleState='closed';c.paste('5\t20\t3','b',5);assert.match(c.status,/closed/);
 c.districts[0].cycleState='active';c.paste('5\t20\t3','hidden',5);assert.match(c.status,/visible Blueprint cell/);
 c.focusedCell={rowId:'b',colIdx:8};c.capture(event(c,'20'));assert.match(c.status,/Balance is calculated/);
 assert.equal(saves.length,0);
});


test('named tables arrange by facility identity and reject invalid quantities atomically',()=>{
 const {c,saves}=harness();
 c.paste('Facility\tSub-district\tBCG Allocation\tOPV Allocation\nNorth HC\tNorth\t30\t40\nSouth CHPS\tSouth\t50\t60','b',2);
 assert.equal(saves.length,1);assert.equal(c.rows.find((r:any)=>r.facility==='North HC').facility,'North HC');
 assert.equal(c.rows.find((r:any)=>r.facility==='South CHPS').vaccines.OPV.allocation,60);
 assert.equal(c.rows.find((r:any)=>r.id==='hidden').facility,'Clinic hidden');
 const bad=harness(),before=JSON.stringify(bad.c.rows);
 bad.c.paste('Facility\tBCG Allocation\nNorth HC\t30\nSouth CHPS\twrong','b',2);
 assert.equal(JSON.stringify(bad.c.rows),before);assert.equal(bad.saves.length,0);assert.match(bad.c.status,/Paste canceled/);
});

test('compact facility/allocation ranges validate the detected layout rather than unrelated screen columns',()=>{
 const {c,saves}=harness();c.paste('North HC\t10\t20\nSouth HC\t30\t40','b',2);
 assert.equal(saves.length,1);assert.equal(c.rows.find((r:any)=>r.id==='b').vaccines.OPV.allocation,20);
 const text=harness();text.c.paste('North HC\tNorth district\tFront gate\nSouth HC\tSouth district\tRear gate','b',2);
 assert.equal(text.c.rows.find((r:any)=>r.id==='b').subDistrict,'North district');
 assert.equal(text.c.rows.find((r:any)=>r.id==='b').deliverySite,'Front gate');
 assert.equal(text.c.rows.find((r:any)=>r.id==='a').deliverySite,'Rear gate');

});


test('a newly selected single cell anchors a multi-cell paste instead of stale keyboard focus',()=>{
 const {c,saves}=harness();c.focusedCell={rowId:'b',colIdx:5};c.bounds={firstRow:1,lastRow:1,firstCol:5,lastCol:5};
 c.capture(event(c,'5\t20\t3\n1\t10\t2'));
 assert.equal(saves.length,1);assert.equal(c.rows.find((r:any)=>r.id==='a').vaccines.BCG.balance,22);
 assert.equal(c.rows.find((r:any)=>r.id==='b').vaccines.BCG.balance,0);assert.equal(c.rows.length,4);
});

test('pasting past the right edge expands rows and columns automatically without dropping cell data',()=>{
 const {c,saves}=harness();c.paste('1\t2\tExtra A\tExtra B\n3\t4\tExtra C\tExtra D','a',11);
 assert.equal(c.blankColumns.length,2);assert.equal(c.rows.length,4);assert.equal(saves.length,1);
 assert.equal(c.rows.find((row:any)=>row.id==='a').cells[`blank:${c.blankColumns[0].id}`],'Extra A');
 assert.equal(c.rows.at(-1).cells[`blank:${c.blankColumns[1].id}`],'Extra D');
 assert.match(c.status,/added 1 rows and 2 columns/);
});
test('invalid quantities prevent expanded columns and rows from being created',()=>{
 const {c,saves}=harness(),before=JSON.stringify(c.rows);c.paste('bad quantity\t999\textra','a',11);
 assert.equal(c.blankColumns.length,0);assert.equal(JSON.stringify(c.rows),before);assert.equal(saves.length,0);assert.match(c.status,/Paste canceled/);
});
