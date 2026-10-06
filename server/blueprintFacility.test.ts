import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { resolveBlueprintFacility, normalizeFacilityName, FACILITY_NOT_FOUND, FACILITY_AMBIGUOUS } from './blueprintFacility';

const sheets = [
  {id:'east',district:'East Mamprusi',month:'September 2026',rows:[{id:'east-row',facility:'Wundua CHPS'}]},
  {id:'west',district:'West Mamprusi',month:'September 2026',rows:[{id:'west-row',facility:'Wundua CHPS'}]}
];

test('exact facility resolves within its district and selected sheet', () => {
  const result = resolveBlueprintFacility(sheets,{facilityName:'Wundua CHPS',sheetId:'west',district:'West Mamprusi'});
  assert.equal(result.sheet.id,'west');assert.equal(result.row.id,'west-row');assert.equal(result.candidateCount,1);
});

test('district context selects the right duplicate name; absent context does not guess', () => {
  assert.equal(resolveBlueprintFacility(sheets,{facilityName:'Wundua CHPS',district:'East Mamprusi'}).sheet.id,'east');
  assert.throws(() => resolveBlueprintFacility(sheets,{facilityName:'Wundua CHPS'}),new RegExp(FACILITY_AMBIGUOUS));
});

test('normalization ignores formatting while retaining distinct facility names', () => {
  for (const name of ['WUNDUA CHPS','Wundua  CHPS','Wundua C.H.P.S.','Wundua C H P S']) {
    assert.equal(normalizeFacilityName(name),'wundua chps');
    assert.equal(resolveBlueprintFacility(sheets,{facilityName:name,sheetId:'west'}).row.id,'west-row');
  }
  assert.equal(normalizeFacilityName('Wundua Health Center'),normalizeFacilityName('Wundua Health Centre'));
  assert.notEqual(normalizeFacilityName('Wundua CHPS'),normalizeFacilityName('Wundua Clinic'));
  assert.notEqual(normalizeFacilityName('Wundua North CHPS'),normalizeFacilityName('Wundua CHPS'));
});

test('missing facility or conflicting identifiers cannot fall back to another sheet', () => {
  for (const context of [
    {facilityName:'Unknown CHPS',sheetId:'west'},
    {facilityName:'Wundua CHPS',sheetId:'deleted'},
    {facilityName:'Wundua CHPS',sheetId:'west',district:'East Mamprusi'},
    {facilityName:'Wundua CHPS',sheetId:'east',selectedSheetId:'west'},
    {facilityName:'Wundua CHPS',sheetId:'east',cycle:'October 2026'}
  ]) assert.throws(() => resolveBlueprintFacility(sheets,context),new RegExp(FACILITY_NOT_FOUND));
});

test('duplicate normalized rows require row identity even when one spelling matches exactly', () => {
  const duplicate = [{...sheets[0],rows:[...sheets[0].rows,{id:'another-row',facility:'WUNDUA  CHPS'}]}];
  assert.throws(() => resolveBlueprintFacility(duplicate,{facilityName:'Wundua CHPS',sheetId:'east'}),new RegExp(FACILITY_AMBIGUOUS));
  assert.equal(resolveBlueprintFacility(duplicate,{facilityName:'Wundua CHPS',sheetId:'east',rowId:'another-row'}).rowIndex,1);
});

test('loaded sheet identity uses the Firestore document ID over an embedded stale ID', async () => {
  const source = readFileSync(new URL('../server.ts',import.meta.url),'utf8');
  const start = source.indexOf('async function loadDistrictsFromFirestore()');
  const code = source.slice(start,source.indexOf('const ensureBlueprintLoaded =',start));
  const context = vm.createContext({
    blueprintDistricts:{},activeDistrictId:'stale-id',getFirestoreDb(){return {};},collection(){return {};},
    async getDocs(){return {empty:false,size:1,forEach(callback:any){callback({id:'actual-document-id',data(){return {id:'stale-id',district:'West Mamprusi',rows:[]};}});}};},
    syncAllBlueprintDistrictsToService(){},console:{log(){},warn(){}}
  });
  vm.runInContext(ts.transpile(code+'\nglobalThis.load = loadDistrictsFromFirestore;'),context);
  await context.load();
  assert.equal(context.blueprintDistricts['actual-document-id'].id,'actual-document-id');
  assert.equal(context.blueprintDistricts['stale-id'],undefined);
  assert.equal(context.activeDistrictId,'actual-document-id');
});
