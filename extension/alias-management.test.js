import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {setupAliasManagement} from './alias-management.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(canEdit=true) {
 const {document,window}=parseHTML('<main></main>'),root=document.querySelector('main'),calls=[];
 let data={revision:1,canEdit,products:[{id:'metro',name:'Metronidazole Suspension'}],records:[{id:'alias',text:'<img src=x onerror=bad()>',productId:'metro',status:'pending',active:false,source:'gemini'}]},updates=0;
 const controller=setupAliasManagement({root,onUpdated(){updates++;},request:async(path,options)=>{
  if(options){const body=JSON.parse(options.body);calls.push(body);data={...data,revision:2,records:data.records.map(record=>({...record,status:'approved',active:true}))};return {revision:2};}
  if(path.includes('history'))return {events:[{id:'event',at:'2026-10-26',action:'approve',actor:'admin',after:data.records[0]}],nextCursor:''};
  return data;
 }});
 for(const select of root.querySelectorAll('select')) Object.defineProperty(select,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value')??this.firstElementChild?.getAttribute('value')??this.firstElementChild?.textContent??'';},set(value){for(const option of this.querySelectorAll('option')){const optionValue=option.getAttribute('value')??option.textContent;if(optionValue===value)option.setAttribute('selected','');else option.removeAttribute('selected');}}});
 const form=root.querySelector('form');form.reset=()=>{form.querySelector('[name=alias]').value='';form.querySelector('[name=confirmed]').checked=false;form.querySelector('[name=product]').value='';};
 return {root,window,calls,controller,get updates(){return updates;},async open(){root.firstElementChild.dispatchEvent(new window.Event('click'));await tick();},async click(label){[...root.querySelectorAll('button')].find(button=>button.textContent===label).dispatchEvent(new window.Event('click'));await tick();}};
}
test('extension alias review requires confirmation, submits current revision and renders history safely',async()=>{
 const ui=fixture();await ui.open();
 const approve=[...ui.root.querySelectorAll('button')].find(button=>button.textContent==='Approve verified alias');
 assert.equal(approve.disabled,true);assert.equal(ui.root.querySelector('img'),null);
 const confirmed=ui.root.querySelector('[name=confirmed]');confirmed.checked=true;confirmed.dispatchEvent(new ui.window.Event('change'));
 assert.equal([...ui.root.querySelectorAll('button')].find(button=>button.textContent==='Approve verified alias').disabled,false);
 await ui.click('Approve verified alias');assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].revision,1);assert.equal(ui.calls[0].identityConfirmed,true);assert.equal(ui.calls[0].action,'approve');assert.equal(ui.updates,1);
 await ui.click('Alias history');assert.match(ui.root.querySelector('[data-events]').textContent,/approve.*admin/);
 ui.controller.reset();assert.equal(ui.root.querySelector('section').hidden,true);assert.equal(ui.root.querySelector('[data-events]').children.length,0);
});
test('regular auditors can browse approved aliases without editing controls',async()=>{
 const ui=fixture(false);await ui.open();assert.equal(ui.root.querySelector('form').hidden,true);
 assert.equal([...ui.root.querySelectorAll('button')].some(button=>button.textContent==='Approve verified alias'),false);assert.equal(ui.calls.length,0);
});
