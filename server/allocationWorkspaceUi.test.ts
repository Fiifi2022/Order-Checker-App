import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {AllocationWorkspaceProvider,useAllocationWorkspace} from '../src/components/AllocationWorkspace';
import Operations from '../src/components/AllocationOperations';

test('facility selection survives tab unmounts and the operations views remain navigable',async()=>{
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
 const properties=['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(properties.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{window:{value:window,configurable:true},document:{value:window.document,configurable:true},HTMLElement:{value:window.HTMLElement,configurable:true},IS_REACT_ACT_ENVIRONMENT:{value:true,configurable:true,writable:true}});
 const root=createRoot(window.document.getElementById('root')!);
 const sheets=[{id:'north',district:'North',month:'October 2026',cycleState:'closed' as const,products:['BCG'],rows:[{id:'row',facility:'Example HC',subDistrict:'North Sub',vaccines:{BCG:{carryOver:0,allocation:5,distributed:5,balance:0}}}]}];
 function Tabs() {
   const [other,setOther]=useState(false),{selection}=useAllocationWorkspace();
   return createElement('div',null,createElement('button',{onClick:()=>setOther(value=>!value)},other?'Back to allocations':'Other app tab'),
     createElement('output',{'aria-label':'Shared facility'},selection.facilityName),other?createElement('p',null,'Another app section'):createElement(Operations,{sheets,canManage:true}));
 }
 const click=async(label:string)=>{
   const button=[...window.document.querySelectorAll('button')].find(button=>button.textContent?.includes(label));
   assert.ok(button,`Missing action: ${label}`);
   await act(async()=>{button.dispatchEvent(new window.Event('click',{bubbles:true}));});
 };
 try {
   await act(async()=>{root.render(createElement(AllocationWorkspaceProvider,null,createElement(Tabs)));});
   await click('Health, facilities, cycles and history');
   await click('Example HC');
   assert.equal(window.document.querySelector('output')?.textContent,'Example HC');
   assert.match(window.document.body.textContent,/Opening carry-over/);
   assert.match(window.document.body.textContent,/Balance doses/);
   await click('Cycle controls');
   const reopen=[...window.document.querySelectorAll('button')].find(button=>button.textContent?.includes('Reopen as draft'));
   assert.ok(reopen);assert.equal(reopen.hasAttribute('disabled'),true);
   await click('Other app tab');await click('Back to allocations');
   assert.equal(window.document.querySelector('output')?.textContent,'Example HC');
   assert.match(window.document.body.textContent,/Facility: Example HC/);
   await click('Health, facilities, cycles and history');await click('Sub-district coverage');
   assert.match(window.document.body.textContent,/North Sub/);
 } finally {
   await act(async()=>root.unmount());
   for(const key of properties){const descriptor=saved.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}
 }
});
