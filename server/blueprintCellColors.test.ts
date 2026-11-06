import test from 'node:test';
import assert from 'node:assert/strict';
import {updateBlueprintCellColor,blueprintCellForeground,headerColorKey} from '../src/utils/blueprintCellColors';
import {validateAllocationUpdate} from './allocationOperations';
test('No fill explicitly removes imported or automatic backgrounds while retaining an independent text colour',()=>{
 const original={backgroundColor:'#15803d',color:'#123456'};
 assert.deepEqual(updateBlueprintCellColor(original,'backgroundColor'),{backgroundColor:'#ffffff',color:'#123456'});
 assert.deepEqual(original,{backgroundColor:'#15803d',color:'#123456'});
});
test('text reset uses readable automatic contrast without erasing the cell fill',()=>{
 const dark=updateBlueprintCellColor({backgroundColor:'#000000',color:'#123456'},'color');
 assert.equal(dark.backgroundColor,'#000000');assert.equal(blueprintCellForeground(dark),'#ffffff');
 const cleared=updateBlueprintCellColor(undefined,'backgroundColor');assert.equal(blueprintCellForeground(cleared),'#1e293b');
 assert.equal(blueprintCellForeground({backgroundColor:'#fde047'}),'#1e293b');
});
test('arbitrary hex colours work and invalid CSS values are rejected',()=>{
 assert.equal(updateBlueprintCellColor(undefined,'backgroundColor','#c4B5fd').backgroundColor,'#c4B5fd');
 for(const value of ['red','url(example)','transparent','#xyzxyz'])assert.throws(()=>updateBlueprintCellColor(undefined,'color',value),/valid cell colour/);
});
test('header and extra-column colours have stable independent identities',()=>{
 assert.notEqual(headerColorKey(2,'field:facility'),headerColorKey(3,'field:facility'));
 assert.notEqual(headerColorKey(4,'blank:a'),headerColorKey(4,'blank:b'));
});
test('server validation persists body/header formatting without changing vaccine quantities or facility identity',()=>{
 const row={id:'facility-a',facility:'Example HC',vaccines:{BCG:{carryOver:1,allocation:10,distributed:2,balance:9}}};
 const before={id:'sheet',district:'North',month:'November 2026',products:['BCG'],rows:[row],cycleState:'active' as const,updatedAt:'v1'};
 const after=validateAllocationUpdate(before,{...before,rows:[{...row,cellColors:{'vaccine:BCG:allocation':{backgroundColor:'#ffffff'}}}],headerCellColors:{[headerColorKey(2,'field:facility')]:{backgroundColor:'#93c5fd'}},expectedUpdatedAt:'v1'});
 assert.deepEqual(after.rows[0].vaccines,row.vaccines);assert.equal(after.rows[0].id,row.id);
 assert.deepEqual(after.headerCellColors,{[headerColorKey(2,'field:facility')]:{backgroundColor:'#93c5fd'}});
 assert.equal(after.rows[0].cellColors['vaccine:BCG:allocation'].backgroundColor,'#ffffff');
});
