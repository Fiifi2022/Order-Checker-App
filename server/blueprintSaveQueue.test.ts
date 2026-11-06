import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/components/VaccineAllocationBlueprint.tsx',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  const writeBlueprintToServer = async ('),source.indexOf('  const handleHeaderLabelChange'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const writes:any[]=[],timers:any[]=[];const row=(value:number)=>[{id:'r',facility:'Example',vaccines:{BCG:{allocation:value}}}];
  const context:any={districts:[{id:'s',district:'East',month:'October',rows:row(10),updatedAt:'v0'}],activeDistrictId:'s',rows:row(10),products:['BCG'],district:'East',month:'October',
    cellMerges:[],freezeRows:0,freezeColumns:0,headerLabels:[],hiddenRowIds:[],mergeHeaders:false,deletedColumnKeysRef:{current:[]},blankColumnsRef:{current:[]},sheetSizingRef:{current:{}},headerCellColorsRef:{current:{}},
    savedVersionsRef:{current:{s:'v0'}},savedSheetsRef:{current:{}},pendingEditsRef:{current:[]},draftRevisionRef:{current:0},savedDraftRevisionRef:{current:0},saveQueueRef:{current:Promise.resolve(true)},saveTimerRef:{current:null},autoSaveRef:{current:true},changeReason:'edit',currentUser:{},
    isAllocationWorksheet:()=>true,deleteBlueprintColumnData:(rows:any)=>rows,blueprintColumnKey:()=>'',
    setDistricts:(value:any)=>{context.districts=typeof value==='function'?value(context.districts):value;},
    setHasUnsavedChanges:(value:any)=>{context.dirty=value;},setSaveStatus:(value:any)=>{context.status=typeof value==='function'?value(context.status):value;},
    setTimeout:(run:any,ms:number)=>{const timer={run,ms,canceled:false};timers.push(timer);return timer;},clearTimeout:(timer:any)=>{if(timer)timer.canceled=true;},
    safeFetchJson:async(_url:string,options:any)=>new Promise((resolve,reject)=>{writes.push({body:JSON.parse(options.body),resolve,reject});}),
    structuredClone,Promise,Date,console,
  };
  vm.createContext(context);vm.runInContext(ts.transpile(code+'\nglobalThis.save=persistBlueprintToServer;globalThis.edit=debouncedSaveBlueprint;'),context);
  return {context,writes,timers,row};
}

test('autosave waits for a typing pause and sends only the last entered value',async()=>{
  const {context:c,writes,timers,row}=harness();c.edit(row(1));c.edit(row(12));c.edit(row(123));
  assert.equal(writes.length,0);assert.equal(timers.filter(t=>!t.canceled).length,1);assert.equal(timers.at(-1).ms,1200);
  timers.at(-1).run();await tick();assert.equal(writes.length,1);assert.equal(writes[0].body.district.rows[0].vaccines.BCG.allocation,123);
  writes[0].resolve({districts:[{id:'s',rows:row(123),updatedAt:'v1'}]});await tick();assert.equal(c.dirty,false);
});

test('manual mode keeps edits dirty until an explicit Save and never schedules an automatic write',async()=>{
  const {context:c,writes,timers,row}=harness();c.autoSaveRef.current=false;c.edit(row(15));
  assert.equal(c.dirty,true);assert.equal(timers.length,0);assert.equal(writes.length,0);
  const save=c.save(row(15),['BCG'],'East','October');await tick();assert.equal(writes.length,1);
  writes[0].resolve({districts:[{id:'s',rows:row(15),updatedAt:'v1'}]});assert.equal(await save,true);assert.equal(c.dirty,false);
});

test('edits during an in-flight save survive its response; next save uses the confirmed version',async()=>{
  const {context:c,writes,row}=harness();c.draftRevisionRef.current=1;
  const first=c.save(row(11),['BCG'],'East','October');await tick();
  c.draftRevisionRef.current=2;c.districts=[{id:'s',rows:row(12),updatedAt:'draft2'}];
  const second=c.save(row(12),['BCG'],'East','October');await tick();assert.equal(writes.length,1);
  writes[0].resolve({districts:[{id:'s',rows:row(11),updatedAt:'v1'}]});await first;await tick();
  assert.equal(c.dirty,true);assert.equal(c.districts[0].rows[0].vaccines.BCG.allocation,12);
  assert.equal(writes.length,2);assert.equal(writes[1].body.district.expectedUpdatedAt,'v1');
  writes[1].resolve({districts:[{id:'s',rows:row(12),updatedAt:'v2'}]});await second;assert.equal(c.dirty,false);assert.equal(c.savedVersionsRef.current.s,'v2');
});

test('failed or unconfirmed saves preserve dirty edits and pending edit history',async()=>{
  for(const failure of ['conflict','bad-response']){
    const {context:c,writes,row}=harness();c.draftRevisionRef.current=1;c.pendingEditsRef.current=[{value:11}];
    const save=c.save(row(11),['BCG'],'East','October');await tick();c.pendingEditsRef.current.push({value:12});
    if(failure==='conflict')writes[0].reject(Error('Sheet changed. Reload before saving.'));else writes[0].resolve({});
    assert.equal(await save,false);assert.equal(c.dirty,true);assert.equal(c.savedVersionsRef.current.s,'v0');assert.equal(c.pendingEditsRef.current.length,2);assert.match(c.status,/Save failed:/);
  }
});

function liveHarness(){
  const applied:any[]=[];
  const context:any={acceptLiveSheetRef:{current:null},liveSheetRef:{current:{activeDistrictId:'s',hasUnsavedChanges:false,districts:[]}},
    draftRevisionRef:{current:0},savedDraftRevisionRef:{current:0},saveTimerRef:{current:null},resizingSheetRef:{current:false},pendingLiveSheetRef:{current:null},
    savedVersionsRef:{current:{s:'2026-11-02T08:00:00.000Z'}},savedSheetsRef:{current:{}},historyResetPendingRef:{current:false},DEFAULT_BLUEPRINT_PRODUCTS:['BCG'],DEFAULT_BLUEPRINT_HEADER_LABELS:[],
    normalizeBlueprintRowsProgress:(rows:any)=>rows,emptyBlueprintSizing:()=>({}),structuredClone,Date,JSON,
    setLiveSheetWarning:(value:any)=>{context.warning=value;},setLiveSheetCheckedAt:()=>{},setRows:(value:any)=>applied.push(value),
    setDistricts:()=>{},setProducts:()=>{},updateBlankColumns:()=>{},updateSheetSizing:()=>{},updateHeaderCellColors:()=>{},setCellMerges:()=>{},setHeaderLabels:()=>{},updateDeletedColumns:()=>{},setHiddenRowIds:()=>{},setMergeHeaders:()=>{},setFreezeRows:()=>{},setFreezeColumns:()=>{},
  };
  const start=source.indexOf('  acceptLiveSheetRef.current=data=>{');
  vm.createContext(context);vm.runInContext(ts.transpile(source.slice(start,source.indexOf('  const hasSavedActiveSheet',start))),context);
  return {context,applied};
}
test('confirmed Checker changes update the visible saved sheet but never replace an unsaved draft',()=>{
  const {context:c,applied}=liveHarness();const update={sheet:{id:'s',rows:[{balance:7}],updatedAt:'2026-11-02T08:01:00.000Z'},checkedAt:'now'};
  c.liveSheetRef.current.hasUnsavedChanges=true;c.acceptLiveSheetRef.current(update);
  assert.equal(applied.length,0);assert.equal(c.pendingLiveSheetRef.current,update);assert.match(c.warning,/unsaved edits are preserved/);
  c.liveSheetRef.current.hasUnsavedChanges=false;c.acceptLiveSheetRef.current(c.pendingLiveSheetRef.current);
  assert.equal(applied[0][0].balance,7);assert.equal(c.pendingLiveSheetRef.current,null);
});
test('live events cannot cross cycles, overwrite a later save or race the first unsaved keystroke',()=>{
  const {context:c,applied}=liveHarness();
  c.acceptLiveSheetRef.current({sheet:{id:'other',rows:[{balance:1}]}});
  c.acceptLiveSheetRef.current({sheet:{id:'s',rows:[{balance:2}],updatedAt:'2026-11-02T07:59:00.000Z'}});
  assert.equal(applied.length,0);
  c.draftRevisionRef.current=1;
  c.acceptLiveSheetRef.current({sheet:{id:'s',rows:[{balance:3}],updatedAt:'2026-11-02T08:01:00.000Z'}});
  assert.equal(applied.length,0);assert.ok(c.pendingLiveSheetRef.current);
});

test('a saved sheet list cannot hide a deduction from the still-stale visible grid',()=>{
 const {context:c,applied}=liveHarness();
 const update={sheet:{id:'s',products:['BCG'],rows:[{id:'r',vaccines:{BCG:{allocation:3,distributed:2,balance:1}}}],updatedAt:'2026-11-03T11:12:58.737Z'},checkedAt:'now'};
 c.liveSheetRef.current.districts=[structuredClone(update.sheet)];
 c.liveSheetRef.current.rows=[{id:'r',vaccines:{BCG:{allocation:3,distributed:0,balance:3}}}];
 c.acceptLiveSheetRef.current(update);
 assert.equal(applied.length,1);assert.equal(applied[0][0].vaccines.BCG.distributed,2);assert.equal(applied[0][0].vaccines.BCG.balance,1);
 c.liveSheetRef.current.rows=structuredClone(update.sheet.rows);
 c.acceptLiveSheetRef.current(update);assert.equal(applied.length,1,'An already-current grid does not reset selection/history');
});


test('the saved-status expiry cannot erase a newer paste error',async()=>{
 const {context:c,writes,timers,row}=harness();
 const saving=c.save(row(10),['BCG'],'East','October');await tick();
 writes[0].resolve({districts:[{id:'s',rows:row(10),updatedAt:'v1'}]});await saving;
 c.status='Paste canceled: select the correct district.';
 timers.find(timer=>timer.ms===2500).run();assert.equal(c.status,'Paste canceled: select the correct district.');
 c.status='Saved successfully';timers.find(timer=>timer.ms===2500).run();assert.equal(c.status,null);
});

test('queued autosaves retain the matching header colours without overwriting a later formatting edit',async()=>{
 const {context:c,writes,timers,row}=harness();
 c.headerCellColorsRef.current={'header:2:field:facility':{backgroundColor:'#93c5fd'}};
 c.edit(row(10));timers.find(timer=>!timer.canceled&&timer.ms===1200).run();await tick();
 assert.equal(writes[0].body.district.headerCellColors['header:2:field:facility'].backgroundColor,'#93c5fd');
 c.headerCellColorsRef.current={'header:2:field:facility':{backgroundColor:'#ffffff'}};c.edit(row(10));
 timers.filter(timer=>!timer.canceled&&timer.ms===1200).at(-1).run();
 writes[0].resolve({districts:[{id:'s',rows:row(10),updatedAt:'v1',headerCellColors:writes[0].body.district.headerCellColors}]});await tick();await tick();
 assert.equal(writes[1].body.district.headerCellColors['header:2:field:facility'].backgroundColor,'#ffffff');
 assert.equal(c.dirty,true);writes[1].resolve({districts:[{id:'s',rows:row(10),updatedAt:'v2',headerCellColors:writes[1].body.district.headerCellColors}]});await tick();assert.equal(c.dirty,false);
});
