import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {setupVaccine} from './sidepanel-vaccine.js';
import {loadBlueprintQuantities,VACCINE_API} from './sidepanel-vaccine-api.js';
const html=await readFile(new URL('./sidepanel.html',import.meta.url),'utf8');
const record={id:'fac-east-one',facilityName:'Buzulungu CHPS',sourceSheetId:'east',sourceRowId:'one',cycle:'October 2026'};
const next={...record,id:'fac-nov-one',sourceSheetId:'nov',cycle:'November 2026'};
const data=(entry=record,available=4)=>({sourceSheetId:entry.sourceSheetId,sourceRowId:entry.sourceRowId,facilityName:entry.facilityName,cycle:entry.cycle,checkedAt:'2026-10-27T10:00:00Z',products:[{name:'BCG',allocated:4,taken:0,available},{name:'R21',allocated:null,taken:null,available:null}]});
async function withUi(request,run){
 const {document,window}=parseHTML(html),previous={document:globalThis.document,chrome:globalThis.chrome};
 globalThis.document=document;globalThis.chrome={storage:{local:{get:async(_,callback)=>{callback?.({});return{};},set:async()=>{}}}};
 try{await run(setupVaccine({request}),document,window);}finally{Object.assign(globalThis,previous);}
}
const candidate=entry=>({name:entry.facilityName,sourceSheetId:entry.sourceSheetId,sourceRowId:entry.sourceRowId,allocationStatus:'matched'});

test('exact FS Blueprint row wins over same-name cycles and automatically displays saved quantities',async()=>{
 const calls=[];
 await withUi(async(route,options)=>{calls.push([route,options]);return route===VACCINE_API.facilities?[record,next]:data();},async(ui,document,window)=>{
  await ui.setFsFacility(candidate(record));
  assert.match(document.getElementById('vxFacilityMeta').textContent,/October 2026/);
  assert.equal(document.getElementById('vxBlueprint').hidden,false);
  const cells=[...document.querySelectorAll('#vxBlueprintProducts tbody tr:first-child td')].map(el=>el.textContent);
  assert.deepEqual(cells,['4','0','4']);assert.match(document.getElementById('vxBlueprintProducts').textContent,/Not entered/);
  assert.equal(calls.length,2);assert.ok(calls[1][0].includes('/east/facility-quantities?'));assert.ok(calls.every(([,options])=>!options?.method));
  document.getElementById('vxBlueprintRefresh').dispatchEvent(new window.Event('click'));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,3);
  document.getElementById('vxChange').dispatchEvent(new window.Event('click'));
  assert.equal(document.getElementById('vxBlueprint').hidden,true);
  const button=document.querySelector('#vxFacilities button');
  button.dispatchEvent(new window.Event('click',{bubbles:true}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(document.getElementById('vxBlueprintProducts').textContent,/BCG/);
 });
});

test('changing facility or signing out discards late Blueprint quantity responses',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 await withUi(async route=>route===VACCINE_API.facilities?[record,next]:route.includes('/east/')?pending:data(next,0),async(ui,document)=>{
  const first=ui.setFsFacility(candidate(record));await new Promise(resolve=>setImmediate(resolve));
  await ui.setFsFacility(candidate(next));
  assert.match(document.getElementById('vxBlueprintStatus').textContent,/November 2026/);
  release(data(record,99));await first;
  assert.doesNotMatch(document.getElementById('vxBlueprintProducts').textContent,/99/);
  assert.match(document.getElementById('vxBlueprintStatus').textContent,/November 2026/);
  ui.reset();assert.equal(document.getElementById('vxBlueprint').hidden,true);assert.equal(document.getElementById('vxBlueprintProducts').textContent,'');
 });
});

test('failed refresh removes old quantities and displays a retryable error instead of fabricated zeros',async()=>{
 let fail=false;
 await withUi(async route=>{if(route===VACCINE_API.facilities)return[record];if(fail)throw Object.assign(Error('Blueprint unavailable'),{status:503});return data();},async(ui,document,window)=>{
  await ui.setFsFacility(candidate(record));fail=true;
  document.getElementById('vxBlueprintRefresh').dispatchEvent(new window.Event('click'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(document.getElementById('vxBlueprintProducts').textContent,'');
  assert.match(document.getElementById('vxBlueprintStatus').textContent,/Blueprint unavailable/);
  assert.equal(document.getElementById('vxBlueprintRefresh').disabled,false);
 });
});

test('quantity reader rejects a different source cycle and never fabricates a sheet for manual facilities',async()=>{
 const facility={...record,name:record.facilityName};
 await assert.rejects(loadBlueprintQuantities(async()=>data(next),facility),/could not be verified/);
 await assert.rejects(loadBlueprintQuantities(async()=>{assert.fail('manual facility must not cause a lookup');},{name:'Manual HC'}),/Reload facilities/);
});
