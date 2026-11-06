import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
import {blueprintClipboardTsv,readBlueprintClipboard} from '../src/utils/blueprintClipboard';
import {parseClipboardTsv} from '../src/utils/blueprintPaste';
const source=readFileSync(new URL('../src/components/VaccineAllocationBlueprint.tsx',import.meta.url),'utf8');
const actions=source.slice(source.indexOf('  contextPasteRef.current ='),source.indexOf('  const handleGridCellKeyDown ='));
function harness(){
 const {document}=parseHTML('<html></html>');const writes:string[]=[],pastes:any[]=[];
 const c:any={activeDistrictId:'sheet',applyGridClipboardText:(...args:any[])=>pastes.push(args),contextPasteRef:{current:null},
 freezeMenu:{clipboard:{sheetId:'sheet',rowIds:['b','a'],columns:[2,4]}},rows:[{id:'a',text:'A\tclinic'},{id:'hidden',text:'Hidden'},{id:'b',text:'B\nclinic'}],
 getCellRangeBounds:()=>({firstRow:0,lastRow:1,firstCol:2,lastCol:4}),filteredAndSortedRows:[{id:'b'},{id:'a'}],columnsInRange:()=>[2,4],districts:[{id:'sheet',cycleState:'active'}],clearGridRange:()=>{c.cleared=true;},preserveCellRangeRef:{current:false},gridInputRefs:{current:new Map()},gridScrollRef:{current:{focus:()=>{c.restored=true;}}},gridCellKey:(id:string,col:number)=>id+':'+col,setClipboardDialog:(value:any)=>{c.dialog=value;c.clipboardDialog=value;},
 readGridCell:(row:any,col:number)=>col===2?row.text:'',setFreezeMenu:()=>{},setSaveStatus:(status:string)=>{c.status=status;},
 blueprintClipboardTsv,readBlueprintClipboard,document,navigator:{clipboard:{writeText:async(text:string)=>{writes.push(text);},readText:async()=>'5\t20\n1\t10'}}};
 vm.createContext(c);vm.runInContext(ts.transpile(actions+'\nglobalThis.copy=handleContextCopy;globalThis.paste=handleContextPaste;globalThis.copyEvent=handleGridCopy;globalThis.applyDialog=applyClipboardDialog;'),c);
 return{c,writes,pastes};
}
test('context Copy preserves selected visible row order, blank cells and embedded characters',async()=>{
 const {c,writes}=harness();await c.copy();assert.deepEqual(parseClipboardTsv(writes[0]),[['B\nclinic',''],['A\tclinic','']]);assert.match(c.status,/copied/);
});
test('context Paste sends the Excel block to the snapshotted selection anchor',async()=>{
 const {c,pastes}=harness();await c.paste();assert.deepEqual(Array.from(pastes[0]),['5\t20\n1\t10','b',2]);
});
test('clipboard permission rejection opens a permission-free paste box without editing cells',async()=>{
 const {c,pastes}=harness();c.navigator.clipboard.readText=async()=>{throw Error('NotAllowedError');};await c.paste();assert.equal(pastes.length,0);assert.equal(c.dialog.mode,'paste');assert.equal(c.restored,true);assert.equal(c.dialog.text,'');
});
test('switching sheets during the permission prompt cannot paste into the new sheet',async()=>{
 const {c,pastes}=harness();let resolve!:(text:string)=>void;
 c.navigator.clipboard.readText=()=>new Promise<string>(done=>{resolve=done;});const pending=c.paste();
 c.contextPasteRef.current={sheetId:'other',paste:()=>{throw Error('Wrong sheet');}};resolve('12');await pending;
 assert.equal(pastes.length,0);assert.match(c.status,/Sheet changed/);
});
test('context Paste reads HTML-only Excel tables and retains empty cells',async()=>{
 const {document}=parseHTML('<html></html>');
 const clipboard={readText:async()=>'',read:async()=>[{types:['text/html'],getType:async()=>new Blob(['<table><tr><td>Clinic</td><td></td><td>12</td></tr></table>'])}]} as unknown as Clipboard;
 assert.equal(await readBlueprintClipboard(clipboard,document),'Clinic\t\t12');
});

test('right-clicking inside a highlighted range preserves it; clicking outside targets that cell',()=>{
 const {document}=parseHTML('<html><body><td data-grid-cell-row="b" data-grid-cell-col="4"></td></body></html>');
 const c:any={rows:[{id:'a'},{id:'b'}],filteredAndSortedRows:[{id:'b'},{id:'a'}],activeDistrictId:'sheet',freezeColumns:0,selectedRowIds:new Set(),
 setActiveHeaderCell:()=>{},setFreezeColumnInput:()=>{},getColumnDeletionTargets:(col:number)=>[col],getCellRangeBounds:()=>({firstRow:0,lastRow:1,firstCol:2,lastCol:4}),columnsInRange:()=>[2,3,4],
 setFreezeMenu:(menu:any)=>{c.menu=menu;},setFocusedCell:()=>{},setSelectedCellRange:(selection:any)=>{c.selection=selection;}};
 const code=source.slice(source.indexOf('  const openFreezeMenu ='),source.indexOf('  const getCurrentSheetRow ='));
 vm.createContext(c);vm.runInContext(ts.transpile(code+'\nglobalThis.open=openFreezeMenu;'),c);
 const cell=document.querySelector('td')!;const event={target:cell,preventDefault(){},stopPropagation(){},clientX:12,clientY:15};
 c.open(event,'row');assert.deepEqual(Array.from(c.menu.clipboard.rowIds),['b','a']);assert.deepEqual(Array.from(c.menu.clipboard.columns),[2,3,4]);assert.equal(c.selection,undefined);
 cell.setAttribute('data-grid-cell-col','6');c.open(event,'row');assert.deepEqual(Array.from(c.menu.clipboard.rowIds),['b']);assert.deepEqual(Array.from(c.menu.clipboard.columns),[6]);assert.equal(c.selection.anchorColIdx,6);
});


test('native copy uses clipboard event data without calling permission-restricted clipboard methods',()=>{
 const {c}=harness();c.navigator.clipboard=undefined;
 const {document}=parseHTML('<html><body><div id="grid"></div></body></html>');
 let copied='',prevented=false;
 c.copyEvent({target:document.getElementById('grid'),clipboardData:{setData:(type:string,text:string)=>{assert.equal(type,'text/plain');copied=text;}},preventDefault:()=>{prevented=true;},stopPropagation(){}});
 assert.equal(prevented,true);assert.deepEqual(parseClipboardTsv(copied),[['B\nclinic',''],['A\tclinic','']]);
});
test('native cut only clears cells after clipboard data is successfully set',()=>{
 const {c}=harness();const {document}=parseHTML('<html><body><div></div></body></html>');
 const event:any={target:document.querySelector('div'),clipboardData:{setData:()=>{throw Error('blocked');}},preventDefault(){},stopPropagation(){}};
 c.copyEvent(event,true);assert.equal(c.cleared,undefined);
 event.clipboardData.setData=()=>{};c.copyEvent(event,true);assert.equal(c.cleared,true);
 c.cleared=false;c.districts[0].cycleState='closed';c.copyEvent(event,true);assert.equal(c.cleared,false);
});
test('failed Copy opens a selectable copy box and manual Paste retains the original destination',async()=>{
 const {c,pastes}=harness();c.navigator.clipboard=undefined;await c.copy();
 assert.equal(c.dialog.mode,'copy');assert.equal(c.dialog.text,'"B\nclinic"\t\n"A\tclinic"\t');
 await c.paste();c.clipboardDialog.text='5\t20\n1\t10';c.applyDialog();
 assert.deepEqual(Array.from(pastes[0]),['5\t20\n1\t10','b',2]);assert.equal(c.dialog,null);
});
test('manual paste cannot write after switching to a different sheet',async()=>{
 const {c,pastes}=harness();c.navigator.clipboard=undefined;await c.paste();c.clipboardDialog.text='12';
 c.contextPasteRef.current={sheetId:'new-sheet',paste:()=>{throw Error('wrong sheet');}};c.applyDialog();
 assert.equal(pastes.length,0);assert.equal(c.dialog,null);assert.match(c.status,/Sheet changed/);
});

test('Shift-click extends the sheet range without native input selection collapsing it',()=>{
 const code=source.slice(source.indexOf('  const handleGridCellMouseDown ='),source.indexOf('  const handleGridCellMouseEnter ='));
 const {document}=parseHTML('<html><body><input></body></html>');
 const c:any={pendingCellMove:null,selectedCellRange:{anchorRowId:'a',anchorColIdx:5,focusRowId:'a',focusColIdx:5},isDraggingGridRangeRef:{current:false},preserveCellRangeRef:{current:false},gridCellKey:(row:string,col:number)=>`${row}:${col}`,gridInputRefs:{current:new Map([['b:7',{focus:()=>{c.focused=true;}}]])},setSelectedCellRange:(updater:any)=>{c.selectedCellRange=updater(c.selectedCellRange);}};
 vm.createContext(c);vm.runInContext(ts.transpile(code+'\nglobalThis.down=handleGridCellMouseDown;'),c);
 c.down({button:0,shiftKey:true,target:document.querySelector('input'),preventDefault:()=>{c.prevented=true;}},'b',7);
 assert.equal(c.prevented,true);assert.equal(c.focused,true);assert.equal(c.isDraggingGridRangeRef.current,false);
 assert.equal(c.selectedCellRange.anchorRowId,'a');assert.equal(c.selectedCellRange.focusRowId,'b');assert.equal(c.selectedCellRange.focusColIdx,7);
});
