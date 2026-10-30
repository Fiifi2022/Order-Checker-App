import type {RequestHandler} from 'express';
import {assignedRoles} from '../shared/roles';
import {canManageCatalog} from '../shared/productCatalog';
import {allocationCycleState,assertAllocationEditable,transitionAllocationCycle,type AllocationSheet,type AllocationCycleState} from '../shared/allocationOperations';

export function validateAllocationUpdate(current:AllocationSheet|undefined,incoming:AllocationSheet):AllocationSheet {
 if(!incoming.id || !Array.isArray(incoming.rows) || !Array.isArray(incoming.products))throw Object.assign(Error('A valid allocation sheet and product list are required.'),{status:400});
 if(current) {
   assertAllocationEditable(current);
   if(incoming.expectedUpdatedAt!==undefined && incoming.expectedUpdatedAt!==(current.updatedAt||null))throw Object.assign(Error('This Blueprint changed. Reload it before saving; your edits have not replaced the newer data.'),{status:409});
 } else if(incoming.expectedUpdatedAt)throw Object.assign(Error('This allocation sheet no longer exists. Reload before saving.'),{status:409});
 const {expectedUpdatedAt,cycleState,cycleChangedBy,cycleChangeReason,...data}=incoming;
 return {...current,...data,cycleState:current?allocationCycleState(current):'draft',
  ...(current?.cycleChangedBy?{cycleChangedBy:current.cycleChangedBy}:{}),...(current?.cycleChangeReason?{cycleChangeReason:current.cycleChangeReason}:{}),updatedAt:new Date().toISOString()};
}
export function allocationOperationsHandlers(deps:{
 read:(id:string)=>Promise<AllocationSheet|null>;
 history:(id:string,rowId:string,cursor?:{events:string|null;transactions:string|null})=>Promise<any>;
 transition:(id:string,state:AllocationCycleState,reason:string,expected:unknown,actor:string)=>Promise<AllocationSheet>;
}) {
 const valid=(id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=200&&!/[\/\x00-\x1f]/.test(id);
 const history:RequestHandler=async(req,res)=>{
   res.setHeader('Cache-Control','no-store');
   if(!valid(req.params.id)||req.query.rowId!==undefined&&!valid(req.query.rowId)&&req.query.rowId!==''){res.status(400).json({error:'Select a valid sheet and facility row.'});return;}
   try {const sheet=await deps.read(req.params.id);if(!sheet){res.status(404).json({error:'Allocation sheet not found.'});return;}
     const rowId=typeof req.query.rowId==='string'?req.query.rowId:'';
     if(rowId&&!sheet.rows.some(row=>row.id===rowId)){res.status(404).json({error:'Facility row not found in this allocation sheet.'});return;}
     let cursor:{events:string|null;transactions:string|null}|undefined;
     if(req.query.cursor!==undefined) {
       try {if(typeof req.query.cursor!=='string'||req.query.cursor.length>1000)throw Error();const value=JSON.parse(req.query.cursor);
         if(!value||!['events','transactions'].every(key=>value[key]===null||valid(value[key])))throw Error();cursor=value;
       }catch{res.status(400).json({error:'Invalid history cursor. Refresh this view.'});return;}
     }
     res.json(await deps.history(sheet.id,rowId,cursor));
   }catch(error:any){res.status(error.status||503).json({error:error.status?error.message:'Saved allocation history could not be read. Please retry.'});}
 };
 const lifecycle:RequestHandler=async(req,res)=>{
   res.setHeader('Cache-Control','no-store');
   if(!canManageCatalog(assignedRoles(res.locals.authUser))){res.status(403).json({error:'Allocation management permission is required.'});return;}
   if(!valid(req.params.id)||!['draft','active','closed'].includes(req.body?.state)||typeof(req.body?.reason??'')!=='string'||String(req.body?.reason||'').length>1000){res.status(400).json({error:'Choose a valid cycle state and correction reason.'});return;}
   try {res.json({sheet:await deps.transition(req.params.id,req.body.state,req.body.reason||'',req.body.expectedUpdatedAt,res.locals.authUser.email||res.locals.authUser.id),saved:true});}
   catch(error:any){res.status(error.status||503).json({error:error.status?error.message:'Cycle change could not be saved. Refresh and retry.'});}
 };
 return {history,lifecycle};
}
export function stageAllocationTransition(sheet:AllocationSheet,state:AllocationCycleState,reason:string,expected:unknown,actor:string) {
 if(allocationCycleState(sheet)===state)return sheet;
 if(expected!==(sheet.updatedAt||null))throw Object.assign(Error('The cycle changed. Reload before changing its state.'),{status:409});
 return transitionAllocationCycle(sheet,state,reason,actor);
}
