import test from 'node:test';
import assert from 'node:assert/strict';
import {expandBlueprintRange} from '../src/utils/blueprintRangeExpansion';
import type {FacilityBlueprintRow} from '../src/components/VaccineAllocationBlueprint';
const make=(id:string):FacilityBlueprintRow=>({id,facility:`Clinic ${id}`,processing:'',completed:'',vaccines:{BCG:{carryOver:1,allocation:20,distributed:2,balance:19}}});
function input(){return {rows:[make('a'),make('hidden'),make('b')],visibleRowIds:['b','a'],products:['BCG'],deleted:[],blankColumns:[],startRowId:'a',startCol:7,matrix:[['3','999','Extra A','Extra B'],['4','999','Extra C','Extra D']]};}
test('rows and independent columns grow together in visible order with stable keys and calculated balances',()=>{
 const source=input(),before=structuredClone(source);const result=expandBlueprintRange(source);
 assert.equal(result.addedRows,1);assert.equal(result.addedColumns,2);assert.equal(result.rows.length,4);
 assert.equal(result.rows[0].vaccines.BCG.balance,18);assert.equal(result.rows[1].vaccines.BCG.balance,19);
 const [a,b]=result.blankColumns.map(col=>`blank:${col.id}`);
 assert.equal(result.rows[0].cells[a],'Extra A');assert.equal(result.rows[0].cells[b],'Extra B');assert.equal(result.rows[3].cells[b],'Extra D');assert.deepEqual(source,before);
});
test('invalid numeric data fails atomically, including while new columns would be needed',()=>{
 const source=input(),before=structuredClone(source);source.matrix[1][0]='invalid';
 assert.throws(()=>expandBlueprintRange(source),/valid quantity/);assert.deepEqual(source.rows,before.rows);assert.deepEqual(source.blankColumns,[]);
});
test('an empty sheet creates rows and enough new columns for a normal raw range',()=>{
 const source=input();source.rows=[];source.visibleRowIds=[];source.startRowId=undefined;source.startCol=0;
 source.matrix=[['','','New HC','','','2','10','3','999','One','Two']];
 const result=expandBlueprintRange(source);assert.equal(result.addedColumns,2);assert.equal(result.rows[0].facility,'New HC');assert.equal(result.rows[0].vaccines.BCG.balance,9);
});
test('pre-existing extra columns keep their IDs and values when more columns are appended',()=>{
 const source:any=input();source.blankColumns=[{id:'existing',before:null,headers:['','','','']}];source.startCol=9;source.matrix=[['Update','More 1','More 2']];source.rows[0].cells={'blank:existing':'Old'};
 const result=expandBlueprintRange(source);assert.equal(result.blankColumns[0].id,'existing');assert.equal(result.rows[0].cells['blank:existing'],'Update');assert.equal(result.rows[0].cells[`blank:${result.blankColumns[2].id}`],'More 2');
});
test('free rows keep text in their base cells and new rows inherit the free-row behaviour',()=>{
 const source:any=input();source.rows[0]={...source.rows[0],rowKind:'blank',cells:{}};source.matrix=[['text','balance text','One','Two'],['text2','balance2','Three','Four']];
 const result=expandBlueprintRange(source);assert.equal(result.rows[0].cells['vaccine:BCG:distributed'],'text');assert.equal(result.rows[3].rowKind,'blank');assert.equal(result.rows[3].cells['vaccine:BCG:balance'],'balance2');
});
test('deleted columns stay deleted and do not consume a pasted cell',()=>{
 const source:any=input();source.deleted=['vaccine:BCG:balance'];source.matrix=[['3','Extra A','Extra B']];
 const result=expandBlueprintRange(source);assert.equal(result.addedColumns,2);assert.equal(result.rows[0].cells[`blank:${result.blankColumns[0].id}`],'Extra A');
});
