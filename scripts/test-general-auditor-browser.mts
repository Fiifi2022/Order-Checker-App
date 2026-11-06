// Complete React/AuthGate/authFetch + Express over loopback. Only Firebase
// identity/storage are synthetic. No production data or Gemini credentials.
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,readdir,symlink,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),output=await mkdtemp(path.join(os.tmpdir(),'general-audit-browser-'));
await mkdir(path.join(output,'dist'));await copyFile(path.join(root,'firebase-applet-config.json'),path.join(output,'firebase-applet-config.json'));
await symlink(path.join(root,'node_modules'),path.join(output,'node_modules'),'dir');
const fixture=(name:string)=>path.join(root,'scripts/validation',name);
await build({absWorkingDir:root,entryPoints:['src/main.tsx'],outfile:path.join(output,'dist/app.js'),bundle:true,platform:'browser',format:'esm',minify:true,define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'isolated-auth',setup(builder){
 builder.onResolve({filter:/^(?:firebase\/auth|(?:\.\.\/|\.\/)+firebase)$/},()=>({path:fixture('firebase-client.fixture.ts')}));
 builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'css'}));
}}]});
const css=(await readdir(path.join(root,'dist/assets'))).find(file=>file.endsWith('.css'));if(css)await copyFile(path.join(root,'dist/assets',css),path.join(output,'dist/app.css'));
await writeFile(path.join(output,'dist/index.html'),'<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
await build({absWorkingDir:root,entryPoints:['server.ts'],outfile:path.join(output,'server.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'isolated-storage',setup(builder){builder.onResolve({filter:/(?:\.\/server\/firebaseAdmin|\.\/firebaseAdmin)$/},()=>({path:fixture('firebase-admin.fixture.ts')}));}}]});
const port=process.env.ORDERCHECK_GENERAL_TEST_PORT||'43179',base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[path.join(output,'server.cjs')],{cwd:output,env:{...process.env,NODE_ENV:'production',PORT:port,GEMINI_API_KEY:''},stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',chunk=>serverLog+=chunk);server.stderr.on('data',chunk=>serverLog+=chunk);
const report:any={scope:'Real React and Express; isolated Firebase fixtures; Gemini unavailable; no deployment',cases:[],browserErrors:[],output};let browser:any,page:any;
const header='Orderer: Test Operator\nFacility: Asaam HC\n';
try{
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error('Isolated server failed to start');await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,'Local server must start');
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',(error:any)=>report.browserErrors.push(error.message));
 await page.addInitScript('globalThis.__name = value => value;');await page.goto(base);await page.getByRole('button',{name:'General Auditor',exact:true}).click();
 const audit=async(name:string,customer:string,fulfillment:string,expected:boolean)=>{
  await page.locator('textarea').nth(0).fill(customer);await page.locator('textarea').nth(1).fill(fulfillment);
  const extraction=page.waitForResponse((res:any)=>new URL(res.url()).pathname==='/api/general/extract');
  const verification=page.waitForResponse((res:any)=>new URL(res.url()).pathname==='/api/verify');await page.locator('#verify-button').click();assert.equal((await extraction).status(),200);
  const response=await verification;const data=await response.json();assert.equal(response.status(),200,JSON.stringify(data));assert.equal(data.allMatch,expected,name);
  await page.locator('#results-panel').waitFor();await page.waitForFunction(()=>!document.querySelector('section[aria-label="Structured extraction preview"]'));await page.waitForFunction(()=>{const panel=document.getElementById('results-panel');return panel&&Number(getComputedStyle(panel).opacity)>=0.99;});
  assert.ok(data.generalAudit.structuredExtraction,'Internal extraction must reach the audit route');assert.equal(data.generalAudit.structuredExtraction.changes.length,0);assert.deepEqual(data.generalAudit.structuredExtraction.confirmedFields,[]);assert.equal(await page.getByRole('button',{name:'Compare and audit',exact:true}).count(),0);assert.equal(await page.getByText('What we understood',{exact:true}).count(),0);assert.equal(await page.getByText('Manual extraction history',{exact:true}).count(),0);report.cases.push({name,allMatch:data.allMatch,items:data.items.map((i:any)=>({name:i.name,status:i.status}))});return data;
 };
 await audit('standalone name and reversed FS name','Osman Ishak\nFacility: Asaam HC\nORS 2','Thank you Ishak Osman from Asaam HC for ordering with Zipline. We will prepare the following items:\n- ORS [2/2]',true);
 await audit('unknown identical product, numbered 20/20',header+'1) New Compound XYZ 500mg - 20/20',header+'New Compound XYZ 500mg [20/20]',true);
 const sanitized=await audit('internal sanitization cannot cancel the automatic audit',header+'Patient: Private Patient Fixture\nAge: 45 years\nPatient contact: 0551234567\nRDT 2',header+'Malaria Rapid Diagnostic Test Kit [2/2]',true);
 assert.doesNotMatch(JSON.stringify(sanitized),/Private Patient Fixture|0551234567|45 years/);
 let invalidVerifyCalls=0;const countInvalid=(request:any)=>{if(new URL(request.url()).pathname==='/api/verify')invalidVerifyCalls++;};page.on('request',countInvalid);
 await page.locator('textarea').nth(0).fill('Patient: Private Patient Fixture\nAge: 45 years\nPatient contact: 0551234567');await page.locator('textarea').nth(1).fill(header+'RDT [2/2]');
 const invalidExtraction=page.waitForResponse((res:any)=>new URL(res.url()).pathname==='/api/general/extract');await page.locator('#verify-button').click();assert.equal((await invalidExtraction).status(),200);
 await page.waitForFunction(()=>!(document.getElementById('verify-button') as HTMLButtonElement)?.disabled,{},{timeout:5000});
 assert.equal(invalidVerifyCalls,0,'No comparison should be sent for an empty sanitized source');page.off('request',countInvalid);report.cases.push({name:'empty sanitized source returns to a usable audit button',allMatch:false});
 await audit('stockout is accounted for',header+'RDT 5',header+'Malaria Rapid Diagnostic Test Kit [0/1]',true);
 const vaccines=await audit('all accessories present, distinct Measles identity needs CCA',header+'Kindly serve us with the following vaccines in vials:\nMeasles 3\nMen A 2\nYF 2\nRota 15\nOPV 2',header+'Measles and Rubella Vaccine Diluent [3/3]\nMeasles & Rubella Vaccine [3/3]\nMeningococcal Conjugate A Vaccine Diluent [2/2]\nMeningococcal Conjugate A Vaccine [2/2]\nYellow Fever Vaccine [2/2]\nYellow Fever Vaccine Diluent [2/2]\nRota Dropper [15/15]\nRotavirus Vaccine [15/15]\nOPV Dropper [2/2]\nOral Polio Vaccine (1&3) [2/2]',false);
 assert.doesNotMatch(vaccines.generalAudit.discrepancies.join(' '),/Required (?:diluent|dropper) missing/);
 assert.equal(await page.getByLabel('Vaccine and accessory verification').locator('tbody tr').count(),5);
 const choice=page.locator('article').filter({has:page.getByLabel('Suggested product for Measles',{exact:true})});
 await choice.getByRole('combobox').selectOption({label:'Measles & Rubella Vaccine'});await choice.getByRole('checkbox').first().check();
 const confirmation=page.waitForResponse((res:any)=>res.url().endsWith('/product-research')&&res.request().postDataJSON()?.action==='confirm');await choice.getByRole('button',{name:'Confirm match and resume',exact:true}).click();
 const confirmResponse=await confirmation,cleared=await confirmResponse.json();assert.equal(confirmResponse.status(),200,JSON.stringify(cleared));assert.equal(cleared.id,vaccines.id,JSON.stringify(cleared));assert.equal(cleared.allMatch,true);await page.waitForFunction(()=>!document.querySelector('[aria-label="Suggested product for Measles"]'));report.cases.push({name:'CCA inline source confirmation resumes same audit',allMatch:cleared.allMatch});
 const folic=await audit('only relevant FS candidate, quantity remains independent',header+'Folic acid - 4\nD5% - 15\nRL - 10',header+'Dextrose 5% Infusion, 500mL [15/15]\nFolic acid 5mg Tablet [1/1]\nRinger\'s Lactate Solution, 500mL [10/10]',false);
 const folicCard=page.locator('article').filter({has:page.getByLabel('Suggested product for Folic acid',{exact:true})});await folicCard.waitFor();assert.doesNotMatch(await folicCard.innerText(),/Dextrose|Ringer|Thank you/);
 await folicCard.getByRole('combobox').selectOption({label:'Folic acid 5mg Tablet'});
 const rejection=page.waitForResponse((res:any)=>res.url().endsWith('/product-research')&&res.request().postDataJSON()?.action==='keep');await folicCard.getByRole('button',{name:'Mark discrepancy',exact:true}).click();const rejected=await (await rejection).json();assert.equal(rejected.allMatch,false);assert.equal(rejected.id,folic.id);report.cases.push({name:'CCA discrepancy decision retained',allMatch:rejected.allMatch});
 const limited=await audit('unapproved quantity reduction stays unresolved',header+'RDT 5',header+'RDT [3/3]',false);
 const limitResponse=page.waitForResponse((res:any)=>res.url().endsWith('/order-limit'));await page.getByRole('button',{name:'Confirm Order Limit',exact:true}).click();
 const approvedResponse=await limitResponse,acknowledgement=await approvedResponse.json();assert.equal(approvedResponse.status(),200,JSON.stringify(acknowledgement));assert.equal(acknowledgement.acknowledged,true);const approved=await (await fetch(base+'/api/audits/'+encodeURIComponent(limited.id),{headers:{Authorization:'Bearer validation-token:0'}})).json();assert.equal(approved.id,limited.id);assert.equal(approved.allMatch,true);await page.getByText('Approved — Order Limit Applied',{exact:true}).waitFor();report.cases.push({name:'explicit CCA order-limit exception preserves the same audit',allMatch:approved.allMatch});
 await audit('strength difference remains blocked',header+'Artesunate 60mg Injection - 2',header+'Artesunate 120mg Injection [2/2]',false);
 assert.deepEqual(report.browserErrors,[]);await page.locator('#results-panel').screenshot({path:path.join(output,'final-results.png')});report.status='passed';
}catch(error:any){report.status='failed';report.failure=error.stack||error.message;process.exitCode=1;if(page){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(path.join(output,'failure.html'),await page.content().catch(()=>''));}}
finally{await browser?.close();server.kill('SIGTERM');await writeFile(path.join(output,'server.log'),serverLog);await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
