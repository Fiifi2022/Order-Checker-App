// Browser regression for the real Blueprint component. All APIs are local fixtures;
// this test cannot read or write production allocations. Run npm run build first.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ordercheck-clipboard-'));
const bundle=path.join(temporary,'app.js');
const assets=path.join(root,'dist/assets');
const css=fs.readdirSync(assets).find(name=>name.endsWith('.css'));
const products=['BCG','OPV'];
let sheet={id:'test',district:'Test District',month:'November 2026',products,cycleState:'active',updatedAt:'fixture-version',rows:['a','b','c',...Array.from({length:17},(_,index)=>`fixture-${index}`)].map(id=>({id,facility:`Test Clinic ${id}`,processing:'',completed:'',subDistrict:'',deliverySite:'',vaccines:Object.fromEntries(products.map(product=>[product,{carryOver:0,allocation:0,distributed:0,balance:0}]))}))};
let saves=0;
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Blueprint from './src/components/VaccineAllocationBlueprint.tsx';createRoot(document.getElementById('root')).render(<Blueprint/>);`,resolveDir:root,loader:'tsx'},bundle:true,outfile:bundle,format:'esm',jsx:'automatic',plugins:[{name:'fixture-api',setup(builder){
 builder.onResolve({filter:/utils\/authFetch$/},()=>({path:'auth',namespace:'fixture'}));
 builder.onResolve({filter:/utils\/blueprintLive$/},()=>({path:'live',namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='auth'?'export const authFetch=(...args)=>fetch(...args);':'export const connectBlueprintLive=()=>()=>{};'}));
}}]});
const server=http.createServer(async(request,response)=>{
 if(request.url==='/app.js'){response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(bundle));return;}
 if(request.url==='/style.css'){response.setHeader('Content-Type','text/css');response.end(fs.readFileSync(path.join(assets,css)));return;}
 if(request.url.startsWith('/api/')){
  let body='';for await(const chunk of request)body+=chunk;
  if(request.method==='POST' && body){const data=JSON.parse(body);if(data.district){sheet={...data.district,updatedAt:new Date().toISOString()};saves++;}}
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify(request.url==='/api/products'?{products:[]}:request.url.includes('dhd-inventory')?{inventory:{stocks:{},history:[]}}:{districts:[sheet],activeDistrictId:'test'}));return;
 }
 response.setHeader('Content-Type','text/html');response.end('<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const systemChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:fs.existsSync(systemChrome)?{executablePath:systemChrome}:{})});
 const context=await browser.newContext({viewport:{width:1800,height:1000},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin);
 const cell=(row,col)=>page.locator(`[data-grid-cell-row="${row}"][data-grid-cell-col="${col}"]`);
 const value=(row,col)=>cell(row,col).locator('input').inputValue();
 const command=process.platform==='darwin'?'Meta':'Control';
 await cell('a',5).locator('input').waitFor();
 if(process.env.BLUEPRINT_SCREENSHOT)await page.screenshot({path:process.env.BLUEPRINT_SCREENSHOT,fullPage:true});
 const screen=await page.locator('#allocation-blueprint-print-root').boundingBox();
 assert.ok(Math.abs(screen.x)<1 && Math.abs(screen.width-1800)<1);
 assert.equal(await page.locator('[data-blueprint-column-letter="A"]').innerText(),'A');
 assert.equal(await page.locator('[data-blueprint-row-number="5"]').innerText(),'5');
 await page.getByRole('button',{name:'Select column F',exact:true}).click();await page.keyboard.press(`${command}+C`);
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),Array(20).fill('0').join('\n'));
 await page.getByRole('button',{name:'Select row 5',exact:true}).click();await page.keyboard.press(`${command}+C`);
 assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).split('\t')[2],'Test Clinic a');
 const grid=page.getByRole('region',{name:'Allocation Blueprint spreadsheet',exact:true});
 await page.setViewportSize({width:1200,height:1000});
 await grid.evaluate(element=>{element.scrollLeft=200;element.scrollTop=70;});
 assert.ok(await grid.evaluate(element=>element.scrollLeft>0 && element.scrollTop>0));
 await page.waitForTimeout(80);
 const gutter=await page.locator('[data-blueprint-row-number="5"]').boundingBox(),gridRect=await grid.boundingBox();
 assert.ok(Math.abs(gutter.x-gridRect.x)<3,'Row numbers stay pinned while scrolling horizontally');
 const letters=await page.locator('[data-blueprint-column-ruler]').boundingBox();
 assert.ok(Math.abs(letters.y-gridRect.y)<3,'Column letters stay pinned while scrolling vertically');
 await grid.evaluate(element=>{element.scrollLeft=0;element.scrollTop=0;});
 await page.setViewportSize({width:1800,height:1000});
 console.log('PASS: full-width workspace, column letters and row numbers preserve selection and scrolling.');
 await page.emulateMedia({media:'print'});
 assert.ok(await grid.evaluate(element=>element.clientHeight+1>=element.querySelector('table').getBoundingClientRect().height),'Printing includes every row instead of clipping to the viewport');
 await page.emulateMedia({media:'screen'});
 console.log('PASS: printing expands the sheet instead of clipping rows to the screen height.');
 const fill=page.getByLabel('Fill colour',{exact:true});
 const textColour=page.getByLabel('Text colour',{exact:true});
 const background=(row,col)=>cell(row,col).evaluate(element=>getComputedStyle(element).backgroundColor);
 const waitBackground=(row,col,color)=>page.waitForFunction(({row,col,color})=>{const element=document.querySelector(`[data-grid-cell-row="${row}"][data-grid-cell-col="${col}"]`);return element && getComputedStyle(element).backgroundColor===color;},{row,col,color});
 const waitText=(row,col,color,child='input')=>page.waitForFunction(({row,col,color,child})=>{const element=document.querySelector(`[data-grid-cell-row="${row}"][data-grid-cell-col="${col}"] ${child}`);return element && getComputedStyle(element).color===color;},{row,col,color,child});
 const waitHeader=(row,col,color)=>page.waitForFunction(({row,col,color})=>{const element=document.querySelector(`[data-blueprint-header-row="${row}"][data-blueprint-header-col="${col}"]`);return element && getComputedStyle(element).backgroundColor===color;},{row,col,color});

 await cell('a',5).locator('input').click();await fill.fill('#fde047');
 await waitBackground('a',5,'rgb(253, 224, 71)');
 await textColour.fill('#123456');await waitText('a',5,'rgb(18, 52, 86)');
 await page.getByRole('button',{name:'Clear fill',exact:true}).click();await waitBackground('a',5,'rgb(255, 255, 255)');
 await page.getByRole('button',{name:'Clear text colour',exact:true}).click();await waitText('a',5,'rgb(30, 41, 59)');
 await cell('a',5).locator('input').click();await page.keyboard.down('Shift');await cell('b',6).locator('input').click();await page.keyboard.up('Shift');await fill.fill('#bef264');
 for(const row of ['a','b'])for(const col of [5,6])await waitBackground(row,col,'rgb(190, 242, 100)');
 assert.notEqual(await background('c',5),'rgb(190, 242, 100)');
 await page.getByRole('button',{name:'Clear fill',exact:true}).click();
 for(const row of ['a','b'])for(const col of [5,6])await waitBackground(row,col,'rgb(255, 255, 255)');
 await cell('a',8).click();await page.getByRole('button',{name:'Clear fill',exact:true}).click();await waitBackground('a',8,'rgb(255, 255, 255)');
 await waitText('a',8,'rgb(30, 41, 59)','div');
 assert.equal(await cell('a',8).innerText(),'0');
 console.log('PASS: fills and text colours apply to cells/ranges; No fill overrides status colours and keeps balances readable.');
 await page.getByLabel('Header cell C2',{exact:true}).click();await fill.fill('#93c5fd');
 const header=page.locator('[data-blueprint-header-row="2"][data-blueprint-header-col="2"]');
 await waitHeader(2,2,'rgb(147, 197, 253)');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-blueprint-header-row="2"][data-blueprint-header-col="2"]')).backgroundColor!=='rgb(147, 197, 253)');
 await page.getByRole('button',{name:'Redo',exact:true}).click();await waitHeader(2,2,'rgb(147, 197, 253)');
 await page.locator('[data-blueprint-header-row="3"][data-blueprint-header-col="5"]').click({button:'right'});
 await page.getByLabel('Cell fill colour',{exact:true}).fill('#c4b5fd');
 await waitHeader(3,5,'rgb(196, 181, 253)');
 await page.getByRole('menuitem',{name:'No fill',exact:true}).click();
 await waitHeader(3,5,'rgb(255, 255, 255)');
 console.log('PASS: header/merged-header colours support right-click controls, No fill, undo and redo.');



 await page.evaluate(()=>navigator.clipboard.writeText('5\t20\t3\n1\t10\t2'));
 await cell('a',5).locator('input').click();await page.keyboard.press(`${command}+V`);
 await page.waitForFunction(()=>document.querySelector('[data-grid-cell-row="b"][data-grid-cell-col="7"] input').value==='2');
 assert.equal(await value('a',5),'5');assert.equal(await value('a',6),'20');
 console.log('PASS: keyboard Excel range paste updates the real component.');
 // Shift-click creates an exact range without timing-dependent pointer movement.
 await cell('a',5).locator('input').click();await page.keyboard.down('Shift');await cell('b',7).locator('input').click();await page.keyboard.up('Shift');
 await page.keyboard.press(`${command}+C`);
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'5\t20\t3\n1\t10\t2');
 console.log('PASS: native keyboard copy exports the entire selected range.');
 await cell('c',5).click({button:'right'});await page.getByRole('menuitem',{name:'Paste',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-grid-cell-row="c"][data-grid-cell-col="5"] input').value==='5');
 console.log('PASS: right-click paste retains its destination.');
 await page.evaluate(()=>{window.originalClipboard=navigator.clipboard;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{throw new DOMException('Blocked','NotAllowedError');},writeText:async()=>{throw new DOMException('Blocked','NotAllowedError');}}});});
 // Block the async API while keeping real browser clipboard events available.
 await cell('a',5).locator('input').click();await page.keyboard.press(`${command}+C`);
 assert.equal(await page.evaluate(()=>window.originalClipboard.readText()),'5');
 await cell('b',5).click({button:'right'});await page.getByRole('menuitem',{name:'Paste',exact:true}).click();
 const pasteBox=page.getByRole('textbox',{name:'Excel data to paste'});await pasteBox.waitFor();assert.equal(await pasteBox.evaluate(element=>document.activeElement===element),true);
 await page.evaluate(()=>window.originalClipboard.writeText('9\t40\t4\n3\t12\t2'));await page.keyboard.press(`${command}+V`);
 assert.equal(await pasteBox.inputValue(),'9\t40\t4\n3\t12\t2');await page.getByRole('button',{name:'Apply paste',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-grid-cell-row="c"][data-grid-cell-col="5"] input').value==='3');assert.equal(await value('b',6),'40');
 console.log('PASS: denied async clipboard access still allows permission-free copy and paste.');
 await cell('b',5).click({button:'right'});await page.getByRole('menuitem',{name:'Copy',exact:true}).click();
 const copyBox=page.getByRole('textbox',{name:'Selected cells to copy'});await copyBox.waitFor();assert.equal(await copyBox.evaluate(element=>element.selectionEnd-element.selectionStart),1);
 await page.keyboard.press(`${command}+C`);assert.equal(await page.evaluate(()=>window.originalClipboard.readText()),'9');await page.getByRole('button',{name:'Done',exact:true}).click();
 console.log('PASS: blocked menu Copy opens selected text for native copy.');
 await cell('a',5).locator('input').click();await page.getByRole('button',{name:'Paste data',exact:true}).click();await pasteBox.fill('1\tnot a number\t2');
 await page.getByRole('button',{name:'Apply paste',exact:true}).click();assert.equal(await value('a',5),'5');assert.equal(await value('a',6),'20');assert.match(await page.getByRole('status').innerText(),/Paste canceled/);
 console.log('PASS: invalid paste remains atomic and shows a visible error.');
 assert.equal(await page.getByRole('button',{name:'Paste sheet',exact:true}).count(),0);
 await cell('a',5).locator('input').click();
 await page.evaluate(()=>window.originalClipboard.writeText('OPV Allocation\tFacility Name\tBCG Allocation\tSub-district\tMR\n77\tTest Clinic b\t55\tNorth\t10\n22\tAdded HC\t33\tSouth\t4'));
 await page.keyboard.press(`${command}+V`);
 await page.waitForFunction(()=>document.querySelector('[data-grid-cell-row="b"][data-grid-cell-col="6"] input').value==='55');
 assert.equal(await value('b',10),'77');assert.equal(await value('a',6),'20');
 assert.ok(await page.locator('input').evaluateAll(inputs=>inputs.some(input=>input.value==='Added HC')));
 console.log('PASS: full-sheet paste arranges reordered headings, adds product columns and keeps other facilities.');
 await page.waitForTimeout(1500);assert.ok(saves>0);assert.equal(sheet.rows.find(row=>row.id==='b').vaccines.BCG.allocation,55);assert.deepEqual(pageErrors,[]);
 console.log('PASS: edits reach the local save API; no browser errors or production requests.');
 await cell('b',5).locator('input').click();
 await page.evaluate(()=>window.originalClipboard.writeText('Other District October 2026\nFacility\tBCG\nNorth HC\t12'));
 await page.keyboard.press(`${command}+V`);
 assert.match(await page.getByRole('status').innerText(),/Other District/);assert.equal(await value('b',6),'55');
 console.log('PASS: conflicting district/cycle titles reject ordinary paste without changing data.');
 // Two new free columns and additional rows are created by an ordinary overflow paste.
 await cell('b',15).locator('input').click();
 await page.evaluate(()=>window.originalClipboard.writeText('1\t999\tExtra A\tExtra B\n2\t999\tExtra C\tExtra D\n3\t999\tExtra E\tExtra F\n4\t999\tExtra G\tExtra H\n5\t999\tExtra I\tExtra J\n6\t999\tExtra K\tExtra L'+Array.from({length:21},(_,index)=>`\n${index+7}\t999\tAdded ${index} A\tAdded ${index} B`).join('')));
 await page.keyboard.press(`${command}+V`);
 await page.waitForFunction(()=>document.querySelector('[data-grid-cell-row="b"][data-grid-cell-col="17"] input')?.value==='Extra A');
 assert.equal(await value('b',18),'Extra B');
 assert.ok(await page.locator('input').evaluateAll(inputs=>inputs.some(input=>input.value==='Extra L')));
 // Edit one new column and ensure its neighbour stays independent; then persist/reload.
 await cell('b',17).locator('input').fill('Edited A');assert.equal(await value('b',18),'Extra B');
 await page.waitForTimeout(1500);await page.reload();
 assert.equal(await value('b',17),'Edited A');assert.equal(await value('b',18),'Extra B');
 await waitHeader(2,2,'rgb(147, 197, 253)');
 await waitBackground('a',5,'rgb(255, 255, 255)');
 console.log('PASS: body and header colour changes survive saving and reloading.');
 console.log('PASS: ordinary paste grows both edges, preserves independent columns and persists them.');
 sheet={...sheet,rows:[],updatedAt:'empty-fixture'};await page.reload();await page.getByText('No rows found',{exact:true}).waitFor();
 await page.getByRole('region',{name:'Allocation Blueprint spreadsheet',exact:true}).focus();
 await page.evaluate(()=>navigator.clipboard.writeText('Facility\tBCG\tOPV\nFirst CHPS\t12\t20'));
 await page.keyboard.press(`${command}+V`);
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('input')).some(input=>input.value==='First CHPS'));
 console.log('PASS: ordinary full-table paste works in an empty Blueprint without a selected cell.');
 await page.getByRole('button',{name:'Full screen',exact:true}).click();
 const full=await page.locator('#allocation-blueprint-sheet').boundingBox();assert.ok(Math.abs(full.x)<1 && Math.abs(full.y)<1 && Math.abs(full.width-1800)<1 && Math.abs(full.height-1000)<1);
 await page.getByRole('button',{name:'Exit full screen',exact:true}).click();
 console.log('PASS: full-screen mode fills the entire display and restores the normal workspace on exit.');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
 const mobile=await page.locator('#allocation-blueprint-print-root').boundingBox();assert.ok(mobile.width<=391);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile scrolling stays inside the sheet');
 console.log('PASS: the mobile workspace fits the viewport and keeps spreadsheet scrolling internal.');
 await page.waitForTimeout(1500);sheet={...sheet,cycleState:'closed'};await page.reload();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('input')).some(input=>input.value==='First CHPS'));
 const closedId=sheet.rows[0].id;await cell(closedId,8).click();
 const priorColour=await background(closedId,8),priorWrites=saves;await fill.fill('#ff0000');
 await page.getByText('This cycle is closed. Reopen it before changing cell formatting.',{exact:true}).first().waitFor();
 assert.equal(await background(closedId,8),priorColour);assert.equal(saves,priorWrites);
 console.log('PASS: closed cycles reject colour changes without editing or saving allocation records.');


 assert.deepEqual(pageErrors,[]);

}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});}
