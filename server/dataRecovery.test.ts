import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRetryableLoader} from './retryableLoader';

test('a failed startup read retries instead of remaining permanently empty', async () => {
  let attempts=0;
  const load=createRetryableLoader(async () => {if (++attempts===1) throw new Error('Temporary read failure');});
  await assert.rejects(load());await load();await load();assert.equal(attempts,2);
});

test('concurrent readers share a cloud load and failed reads preserve existing data', async () => {
  let attempts=0,release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  const load=createRetryableLoader(async () => {attempts++;await pending;});
  const first=load(),second=load();assert.equal(first,second);release();await Promise.all([first,second]);assert.equal(attempts,1);
  const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
  const start=source.indexOf('async function loadDistrictsFromFirestore()');
  const code=source.slice(start,source.indexOf('const ensureBlueprintLoaded =',start));
  const existing={saved:{id:'saved',rows:[{facility:'Preserved Clinic'}]}};
  const context=vm.createContext({blueprintDistricts:existing,getFirestoreDb(){return {};},collection(){return {};},async getDocs(){throw new Error('Network failure');},console:{warn(){}}});
  vm.runInContext(ts.transpile(code+'\nglobalThis.load = loadDistrictsFromFirestore;'),context);
  await assert.rejects(context.load(),/Could not load saved Allocation Blueprint/);
  assert.equal(context.blueprintDistricts,existing);
});

function sheetSaveHarness(fail=false) {
  const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
  const start=source.indexOf("app.post('/api/vaccine/blueprint-districts',");
  const code=source.slice(start,source.indexOf('// DELETE a district',start));
  const current={id:'existing',district:'West',month:'September',rows:[{facility:'Original Clinic'}]};
  const records=new Map([['existing',structuredClone(current)]]);
  let handler:any,syncs=0;
  const context=vm.createContext({
    app:{post(_path:string,callback:any){handler=callback;}},blueprintDistricts:{existing:current},activeDistrictId:'existing',async ensureBlueprintLoaded(){},
    getFirestoreDb(){return {};},doc(_db:any,_collection:string,id:string){return id;},cleanFirestorePayload(value:any){return JSON.parse(JSON.stringify(value));},
    preserveDhdTopUpsOnStaleSheet(value:any){return value;},syncAllBlueprintDistrictsToService(){syncs++;},vaccineService:{getAllFacilities(){return [];}},
    writeBatch(){const pending=new Map<string,any>();return {set(id:string,data:any){pending.set(id,data);},async commit(){if(fail)throw new Error('Save rejected');for(const [id,data] of pending)records.set(id,data);}};}
  });
  vm.runInContext(ts.transpile(code,{target:ts.ScriptTarget.ES2022}),context);
  return {context,records,get syncs(){return syncs;},async save(){let status=200,body:any;await handler({body:{districts:[{...current,rows:[{facility:'Edited Clinic'}]},{id:'new',district:'East',month:'September',rows:[{facility:'New Clinic'}]}],activeId:'new'}},{status(code:number){status=code;return this;},json(value:any){body=value;return this;}});return {status,body};}};
}

test('rejected Blueprint import/save keeps the previous sheets and returns no false success', async () => {
  const app=sheetSaveHarness(true);const response=await app.save();
  assert.equal(response.status,503);assert.equal(response.body.success,undefined);
  assert.equal(app.context.blueprintDistricts.existing.rows[0].facility,'Original Clinic');
  assert.equal(app.context.blueprintDistricts.new,undefined);assert.equal(app.records.size,1);assert.equal(app.syncs,0);
});

test('successful Blueprint save persists all imported sheets before publishing them', async () => {
  const app=sheetSaveHarness();const response=await app.save();
  assert.equal(response.status,200);assert.equal(response.body.success,true);
  assert.equal(app.records.get('existing')!.rows[0].facility,'Edited Clinic');assert.ok(app.records.has('new'));
  assert.equal(app.context.blueprintDistricts.new.rows[0].facility,'New Clinic');assert.equal(app.syncs,1);
});

test('frontend load failure retains the last loaded Blueprint instead of creating defaults', async () => {
  const source=readFileSync(new URL('../src/components/VaccineAllocationBlueprint.tsx',import.meta.url),'utf8');
  const start=source.indexOf('const loadBlueprintFromServer =');
  const code=source.slice(start,source.indexOf('const handleSwitchDistrict',start));
  let error='',defaults=0;
  const context=vm.createContext({setLoading(){},setBlueprintLoadError(message:string){error=message;},setSaveStatus(){},async safeFetchJson(){throw new Error('Temporary backend error');},initializeDefaultRows(){defaults++;}});
  vm.runInContext(ts.transpile(code+'\nglobalThis.load = loadBlueprintFromServer;'),context);
  await context.load();assert.equal(defaults,0);assert.match(error,/data has not been cleared/);
});
