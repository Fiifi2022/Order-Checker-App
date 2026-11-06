// The real Blueprint and live transport, with isolated local saved-sheet/SSE
// fixtures. No production account, allocation, or transaction is accessed.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ordercheck-live-'));
const bundle=path.join(temporary,'app.js'),assets=path.join(root,'dist/assets');
const css=fs.readdirSync(assets).find(name=>name.endsWith('.css'));
let version=0,saves=0,currentReads=0;
let sheet={id:'west-test',district:'West Mamprusi',month:'October 2026',cycleState:'active',products:['BCG','OPV'],updatedAt:'2026-11-03T11:00:00.000Z',rows:[{id:'gbeo',facility:'Fixture Gbeo CHPS',processing:'',completed:'',subDistrict:'',deliverySite:'',vaccines:{BCG:{carryOver:0,allocation:3,distributed:0,balance:3},OPV:{carryOver:3,allocation:3,distributed:0,balance:6}}}]};
const streams=new Set();
const snapshot=()=>({sheet,checkedAt:new Date().toISOString()});
const broadcast=data=>{for(const response of streams)response.write(`data: ${JSON.stringify(data)}\n\n`);};
const recordFixtureDeduction=(vaccine,quantity,emit=true)=>{
 const row=structuredClone(sheet.rows[0]),value=row.vaccines[vaccine];
 value.distributed+=quantity;value.balance-=quantity;
 sheet={...sheet,rows:[row],updatedAt:`2026-11-03T11:${String(++version).padStart(2,'0')}:00.000Z`};
 if(emit)broadcast(snapshot());
};
await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import Blueprint from'./src/components/VaccineAllocationBlueprint.tsx';createRoot(document.getElementById('root')).render(<Blueprint/>);`,resolveDir:root,loader:'tsx'},bundle:true,outfile:bundle,format:'esm',jsx:'automatic',plugins:[{name:'local-auth-fixture',setup(builder){
 builder.onResolve({filter:/utils\/authFetch$/},()=>({path:'auth',namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const authFetch=(...args)=>fetch(...args);'}));
}}]});
const server=http.createServer(async(request,response)=>{
 if(request.url==='/app.js'){response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(bundle));return;}
 if(request.url==='/style.css'){response.setHeader('Content-Type','text/css');response.end(fs.readFileSync(path.join(assets,css)));return;}
 if(request.url.endsWith('/events')){
  response.setHeader('Content-Type','text/event-stream');response.setHeader('Cache-Control','no-store');response.flushHeaders();
  streams.add(response);response.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  response.on('close',()=>streams.delete(response));return;
 }
 if(request.url.startsWith('/api/')){
  response.setHeader('Content-Type','application/json');
  if(request.method==='POST'){saves++;response.statusCode=409;response.end(JSON.stringify({error:'Unexpected fixture write'}));return;}
  if(request.url.endsWith('/current')){currentReads++;response.end(JSON.stringify(snapshot()));return;}
  response.end(JSON.stringify(request.url==='/api/products'?{products:[]}:request.url.includes('dhd-inventory')?{inventory:{stocks:{},history:[]}}:{districts:[sheet],activeDistrictId:sheet.id}));return;
 }
 response.setHeader('Content-Type','text/html');response.end('<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const systemChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:fs.existsSync(systemChrome)?{executablePath:systemChrome}:{})});
 const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin);
 const cell=col=>page.locator(`[data-grid-cell-row="gbeo"][data-grid-cell-col="${col}"]`);
 const waitValue=(col,value)=>page.waitForFunction(({col,value})=>document.querySelector(`[data-grid-cell-row="gbeo"][data-grid-cell-col="${col}"] input`)?.value===value,{col,value});
 await waitValue(6,'3');await page.getByRole('status').filter({hasText:'Saved allocation received'}).waitFor();
 recordFixtureDeduction('BCG',2);
 await waitValue(7,'2');await page.waitForFunction(()=>document.querySelector('[data-grid-cell-row="gbeo"][data-grid-cell-col="8"]')?.textContent.trim()==='1');
 assert.equal(await cell(6).locator('input').inputValue(),'3');assert.equal(saves,0);
 console.log('PASS: confirmed BCG quantities arrive over SSE and update distributed/balance without another write.');
 recordFixtureDeduction('OPV',3,false);
 const before=currentReads;
 await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));});
 await waitValue(11,'3');
 assert.equal(await cell(12).innerText(),'3');assert.equal(await cell(10).locator('input').inputValue(),'3');
 assert.equal(currentReads,before+1);assert.equal(saves,0);
 console.log('PASS: returning from FS recovers a missed OPV event using one selected-sheet read, with no duplicate deduction.');
 broadcast({sheet:{...sheet,id:'different-cycle',rows:[]},checkedAt:'wrong'});
 broadcast({sheet:{...sheet,updatedAt:'2026-11-03T10:00:00.000Z',rows:[]},checkedAt:'old'});
 await page.waitForTimeout(150);assert.equal(await cell(7).locator('input').inputValue(),'2');
 console.log('PASS: events for another cycle and older saved versions cannot replace the visible sheet.');
 await page.getByRole('checkbox',{name:'Autosave after typing'}).uncheck();
 await cell(4).locator('input').fill('Unsaved delivery edit');
 recordFixtureDeduction('OPV',1);
 await page.getByRole('alert').filter({hasText:'unsaved edits are preserved'}).waitFor();
 assert.equal(await cell(4).locator('input').inputValue(),'Unsaved delivery edit');assert.equal(await cell(11).locator('input').inputValue(),'3');assert.equal(saves,0);
 console.log('PASS: incoming deductions preserve unsaved edits and clearly identify the waiting saved update.');
 assert.deepEqual(errors,[]);
}finally{
 if(browser)await browser.close();
 for(const response of streams)response.end();
 await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});
}
