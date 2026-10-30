import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {setupVaccine} from './sidepanel-vaccine.js';
import {allocationCycleKey} from './allocation-cycle.js';
import {VACCINE_API} from './sidepanel-vaccine-api.js';
const html=await readFile(new URL('./sidepanel.html',import.meta.url),'utf8');
const records=[{id:'east',facilityName:'Gbangu CHPS',cycle:'September 2026',sourceSheetId:'east',sourceRowId:'one'},
 {id:'nov',facilityName:'Gbangu CHPS',cycle:'November 2026',sourceSheetId:'nov',sourceRowId:'one'},
 {id:'',facilityName:'Other HC',cycle:'November 2026',sourceSheetId:'nov',sourceRowId:'two',allocationAvailable:false}];

test('cycle selector lists every saved cycle, filters all Blueprint facilities and persists the choice per backend',async()=>{
 const {document,window}=parseHTML(html),previous={document:globalThis.document,chrome:globalThis.chrome};
 const settings={},messages=[];globalThis.document=document;
 globalThis.chrome={storage:{local:{async get(key,callback){callback?.({});return {[key]:settings[key]};},async set(data){Object.assign(settings,data);}}},runtime:{async sendMessage(message){messages.push(message);}}};
 try{
  const ui=setupVaccine({getBackendUrl:()=> 'http://localhost:3000',request:async route=>{
   if(route===VACCINE_API.facilities)return records;
   return {sourceSheetId:'east',sourceRowId:'one',cycle:'September 2026',checkedAt:new Date().toISOString(),products:[{name:'BCG',allocated:4,taken:0,available:4}]};
  }});
  ui.activate();await new Promise(resolve=>setImmediate(resolve));
  const select=document.getElementById('vxCycle');
  assert.equal(select.options.length,3);assert.equal(document.querySelectorAll('#vxFacilities button').length,3);
  document.querySelector('#vxFacilities button').dispatchEvent(new window.Event('click',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));
  assert.match(document.getElementById('vxBlueprintProducts').textContent,/BCG/);
  select.querySelector('option[value="November 2026"]').selected=true;
  select.dispatchEvent(new window.Event('change'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(document.getElementById('vxPick').hidden,false);assert.equal(document.getElementById('vxBlueprintProducts').textContent,'');
  assert.equal(document.querySelectorAll('#vxFacilities button').length,2);
  assert.match(document.getElementById('vxFacilities').textContent,/Other HC/);
  assert.doesNotMatch(document.getElementById('vxFacilities').textContent,/September/);
  assert.equal(settings[allocationCycleKey('http://localhost:3000')],'November 2026');assert.equal(messages.at(-1).type,'FS_REFRESH_ALL');
  ui.reset();ui.activate();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(select.value,'November 2026');assert.equal(document.querySelectorAll('#vxFacilities button').length,2);
 }finally{Object.assign(globalThis,previous);}
});
