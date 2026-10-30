import {catalogMatchLabelKey, catalogProductNames, type CatalogProduct} from './productCatalog';
import {CLINICAL_PAIRINGS,resolveVaccinePairingName} from './vaccinePairing';

export type AllocationCycleState='draft'|'active'|'closed';
export interface AllocationSheet {
 id:string;district:string;month:string;products?:string[];updatedAt?:string;cycleState?:AllocationCycleState;worksheetRole?:string;
 rows:any[];[key:string]:any;
}
export interface AllocationFinding {code:string;severity:'error'|'warning';sheetId:string;rowId?:string;facility?:string;product?:string;message:string}
export const allocationNumber=(value:unknown):number|null=>value===''||value===null||value===undefined?null:
 typeof value==='number'||typeof value==='string'&&value.trim()!=='' ? Number.isFinite(Number(value))?Number(value):null:null;
export const allocationCycleState=(sheet:AllocationSheet):AllocationCycleState=>sheet.cycleState || 'active';
export const allocationNameKey=(value:unknown)=>String(value || '').normalize('NFKC').toLowerCase().replace(/\bc[.\s]*h[.\s]*p[.\s]*s\b/g,'chps').replace(/\bh\.?\s*c\b\.?/g,'health centre').replace(/\bhealth center\b/g,'health centre').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function allocationUnit(name:string):'vials'|'pieces' {
 return /syringe|needle|soloshot|dropper|safety box|devices?/i.test(name)?'pieces':'vials';
}
export function allocationArithmetic(value:any) {
 const carryOver=allocationNumber(value?.carryOver),allocation=allocationNumber(value?.allocation),distributed=allocationNumber(value?.distributed),balance=allocationNumber(value?.balance);
 const complete=[carryOver,allocation,distributed].every(number=>number!==null);
 const expected=complete?carryOver!+allocation!-distributed!:null;
 return {carryOver,allocation,distributed,balance,expected,difference:expected!==null&&balance!==null?balance-expected:null};
}
export function allocationProductResolver(products:CatalogProduct[]) {
 const index=new Map<string,Set<string>>();
 for(const product of products.filter(product=>product.scope==='vaccine')) for(const label of catalogProductNames(product)) {
   const key=catalogMatchLabelKey(label);index.set(key,new Set([...(index.get(key)||[]),product.id]));
 }
 return (name:string)=>{const matches=index.get(catalogMatchLabelKey(name));return matches?.size===1?[...matches][0]:null;};
}
export function allocationDoseFactor(name:string,products:CatalogProduct[],configured:Record<string,number>):number|null {
 if(allocationUnit(name)==='pieces'||/diluent/i.test(name))return null;
 const id=allocationProductResolver(products)(name),product=products.find(product=>product.id===id);
 if(!product)return null;
 const factors=new Set(catalogProductNames(product).flatMap(label=>Object.entries(configured).filter(([key])=>catalogMatchLabelKey(key)===catalogMatchLabelKey(label)).map(([,factor])=>factor)));
 return factors.size===1?[...factors][0]:null;
}
export function inspectAllocationSheet(sheet:AllocationSheet,products?:CatalogProduct[]):AllocationFinding[] {
 const findings:AllocationFinding[]=[],names=new Map<string,string[]>(),ids=new Set<string>();
 const add=(code:string,severity:AllocationFinding['severity'],message:string,row?:any,product?:string)=>findings.push({code,severity,message,sheetId:sheet.id,...(row?{rowId:row.id,facility:row.facility}:{}),...(product?{product}:{})});
 const resolve=products?allocationProductResolver(products):undefined;
 const headers=new Set<string>();
 for(const name of sheet.products || []) {
   const key=resolve?.(name)||catalogMatchLabelKey(name);
   if(headers.has(key))add('duplicate_product','error',`Duplicate product columns: ${name}.`,undefined,name);
   headers.add(key);
   if(resolve&&!resolve(name))add('unknown_product','warning',`Verify the catalogue identity for ${name}.`,undefined,name);
 }
 for(const row of sheet.rows || []) {
   if(row.rowKind==='blank')continue;
   if(row.id&&ids.has(row.id))add('duplicate_row_id','error','Facility rows share an ID. Repair the IDs before confirming orders.',row);
   ids.add(row.id);
   const name=allocationNameKey(row.facility);
   const entries=Object.entries(row.vaccines || {}) as [string,any][];
   const populated=entries.some(([,value])=>['carryOver','allocation','distributed','balance'].some(field=>allocationNumber(value?.[field])!==null));
   if(!name) {if(populated)add('missing_facility','error','Quantities are recorded without a facility.',row);continue;}
   if(!row.id)add('missing_row_id','error','This facility needs a stable row ID before orders or history can be linked.',row);
   if(!populated)add('unallocated_facility','warning','This facility has no recorded product quantities for this cycle.',row);
   names.set(name,[...(names.get(name)||[]),row.id]);
   const rowProducts=new Set<string>();
   for(const [product,value] of entries) {
     const identity=resolve?.(product)||catalogMatchLabelKey(product);
     if(rowProducts.has(identity))add('duplicate_product','error',`${product}: more than one row entry resolves to the same product.`,row,product);
     rowProducts.add(identity);
     if(resolve&&!resolve(product)&&!(sheet.products||[]).includes(product))add('unknown_product','warning',`${product}: verify the catalogue identity.`,row,product);
     const arithmetic=allocationArithmetic(value);
     const raw=['carryOver','allocation','distributed','balance'] as const;
     if(raw.every(field=>value?.[field]===''||value?.[field]===undefined||value?.[field]===null))continue;
     for(const field of raw) if(value?.[field]!==''&&value?.[field]!==undefined&&value?.[field]!==null&&(allocationNumber(value[field])===null||Number(value[field])<0))add('invalid_quantity','error',`${product}: ${field} must be a non-negative number.`,row,product);
     if(arithmetic.expected===null)add('incomplete_quantities','warning',`${product}: opening carry-over, allocation or distributed quantity is blank. Blank is not zero.`,row,product);
     if(arithmetic.expected!==null&&arithmetic.expected<0)add('over_distributed','error',`${product}: distributed quantity exceeds the recorded allocation and carry-over.`,row,product);
     if(arithmetic.difference!==null&&Math.abs(arithmetic.difference)>0.000001)add('balance_mismatch','error',`${product}: balance ${arithmetic.balance} differs from calculated balance ${arithmetic.expected}.`,row,product);
     if(arithmetic.balance===null)add('missing_balance','warning',`${product}: the balance has not been recorded.`,row,product);
   }
   const paired=new Map(entries.map(([name,value])=>[resolveVaccinePairingName(name),value]));
   for(const [primary,rule] of Object.entries(CLINICAL_PAIRINGS)) {
     const vaccine=paired.get(primary),companion=paired.get(rule.accessoryCanonical);
     const available=allocationArithmetic(vaccine).balance,accessories=allocationArithmetic(companion).balance;
     if(available!==null&&available>0&&(accessories===null||accessories<available))add('companion_shortage','warning',`${primary}: verify ${rule.name} availability for ${available} remaining vials.`,row,primary);
   }
 }
 for(const [name,rowIds] of names) if(rowIds.length>1)for(const rowId of rowIds)add('duplicate_facility','error','This facility appears more than once in this district and cycle.',sheet.rows.find(row=>row.id===rowId));
 return findings;
}
export function allocationFacilityAttention(sheet:AllocationSheet,row:any,findings:AllocationFinding[]) {
 const values=Object.values(row.vaccines || {}).map(allocationArithmetic);
 const allocated=values.filter(value=>(value.carryOver??0)+(value.allocation??0)>0);
 const issues=findings.filter(issue=>issue.rowId===row.id);
 return {sheetId:sheet.id,rowId:row.id,name:row.facility,subDistrict:row.subDistrict || 'Unassigned',
   incomplete:issues.some(issue=>['incomplete_quantities','missing_balance'].includes(issue.code))||!allocated.length,
   exhausted:allocated.length>0&&allocated.every(value=>value.balance===0),
   noDistribution:allocated.length>0&&allocated.every(value=>value.distributed===0),
   hasDistribution:values.some(value=>(value.distributed??0)>0),issues:issues.length};
}
export interface AllocationChange {rowId:string;facility:string;product?:string;field:string;before:unknown;after:unknown}
export function allocationSheetChanges(before:AllocationSheet|undefined,after:AllocationSheet):AllocationChange[] {
 const changes:AllocationChange[]=[],oldRows=new Map((before?.rows||[]).map(row=>[row.id,row]));
 for(const row of after.rows||[]) {
   const old=oldRows.get(row.id);
   for(const field of ['facility','subDistrict','deliverySite'])if((old?.[field]??'')!==(row[field]??''))changes.push({rowId:row.id,facility:row.facility,field,before:old?.[field]??null,after:row[field]??null});
   for(const name of new Set([...Object.keys(old?.vaccines||{}),...Object.keys(row.vaccines||{})]))for(const field of ['carryOver','allocation','distributed','balance']) {
     const a=old?.vaccines?.[name]?.[field]??null,b=row.vaccines?.[name]?.[field]??null;
     if(a!==b)changes.push({rowId:row.id,facility:row.facility,product:name,field,before:a,after:b});
   }
 }
 for(const row of before?.rows||[])if(!after.rows.some(next=>next.id===row.id))changes.push({rowId:row.id,facility:row.facility,field:'removed_row',before:row,after:null});
 return changes;
}
export function allocationImportPreview(before:AllocationSheet[],incoming:AllocationSheet[],products?:CatalogProduct[]) {
 return incoming.map(sheet=>{const previous=before.find(item=>item.id===sheet.id);return {sheetId:sheet.id,district:sheet.district,cycle:sheet.month,
   newFacilities:sheet.rows.filter(row=>row.facility&&!previous?.rows.some(old=>allocationNameKey(old.facility)===allocationNameKey(row.facility))).map(row=>row.facility),
   removedFacilities:(previous?.rows||[]).filter(row=>row.facility&&!sheet.rows.some(next=>allocationNameKey(next.facility)===allocationNameKey(row.facility))).map(row=>row.facility),
   changes:allocationSheetChanges(previous,sheet),findings:[...inspectAllocationSheet(sheet,products),...(previous&&allocationCycleState(previous)==='closed'?[{code:'closed_cycle',severity:'error' as const,sheetId:sheet.id,message:'This target cycle is closed. Reopen it with a recorded correction reason before importing.'}]:[])]};});
}
export function transitionAllocationCycle(sheet:AllocationSheet,state:AllocationCycleState,reason:string,actor:string) {
 const from=allocationCycleState(sheet);
 if(!['draft','active','closed'].includes(state))throw Object.assign(Error('Choose a valid cycle state.'),{status:400});
 if(from===state)return sheet;
 if(from==='draft'&&state==='closed'||from==='active'&&state==='draft')throw Object.assign(Error('Use Draft → Active → Closed. Reopen a closed cycle to make a recorded correction.'),{status:409});
 if(from==='closed'&&(state!=='draft'||reason.trim().length<10))throw Object.assign(Error('Reopen a closed cycle as Draft with a correction reason of at least 10 characters.'),{status:400});
 if(state!=='draft'&&inspectAllocationSheet(sheet).some(issue=>issue.severity==='error'))throw Object.assign(Error('Resolve Blueprint errors before activating or closing this cycle.'),{status:409});
 return {...sheet,cycleState:state,updatedAt:new Date().toISOString(),cycleChangedBy:actor,cycleChangeReason:reason.trim()};
}
export function assertAllocationEditable(sheet:AllocationSheet) {
 if(allocationCycleState(sheet)==='closed')throw Object.assign(Error('This cycle is closed. Reopen it with a recorded correction reason before editing.'),{status:409});
}
/** Adjustment totals are part of the current allocation, like existing DHD top-ups. */
export function applyAllocationAdjustment(sheet:AllocationSheet,rowId:string,product:string,amount:number,reason:string) {
 assertAllocationEditable(sheet);
 if(!Number.isFinite(amount)||amount===0||reason.trim().length<10)throw Object.assign(Error('Enter a non-zero quantity and an adjustment reason of at least 10 characters.'),{status:400});
 const row=sheet.rows.find(row=>row.id===rowId),value=row?.vaccines?.[product];
 if(!row||!value)throw Object.assign(Error('Select an existing facility product allocation.'),{status:404});
 const arithmetic=allocationArithmetic(value);
 if(arithmetic.expected===null||arithmetic.difference!==0)throw Object.assign(Error('Reconcile this product’s quantities before adjusting its allocation.'),{status:409});
 const allocation=arithmetic.allocation!+amount,balance=arithmetic.expected+amount;
 if(allocation<0||balance<0)throw Object.assign(Error('The reduction would create a negative allocation or balance.'),{status:409});
 return {...sheet,updatedAt:new Date().toISOString(),rows:sheet.rows.map(row=>row.id!==rowId?row:{...row,vaccines:{...row.vaccines,[product]:{...value,
   allocation,allocationBase:value.allocationBase??arithmetic.allocation!-Number(value.dhdTopUpTotal||0)-Number(value.allocationAdjustmentTotal||0),
   allocationAdjustmentTotal:Number(value.allocationAdjustmentTotal||0)+amount,balance}}})};
}
export function planAllocationCycle(sheets:AllocationSheet[],input:{month:string;scope?:string;districtId?:string;baseSheetId?:string;carryOverBalances?:boolean;copyFacilities?:boolean}) {
 const month=String(input.month||'').trim();
 if(!month||month.length>100)throw Object.assign(Error('Enter a valid allocation month.'),{status:400});
 const base=sheets.find(sheet=>sheet.id===(input.baseSheetId||input.districtId));
 if(!base)throw Object.assign(Error('Select the source allocation sheet.'),{status:404});
 const date=(name:string)=>{const parsed=Date.parse(`1 ${name}`);return Number.isFinite(parsed)?parsed:0;};
 const latest=new Map<string,AllocationSheet>();
 for(const sheet of sheets)if(sheet.worksheetRole!=='other'&&allocationCycleState(sheet)!=='draft'&&(!date(month)||date(sheet.month)<date(month))&&(!latest.has(sheet.district)||date(sheet.month)>date(latest.get(sheet.district)!.month)))latest.set(sheet.district,sheet);
 const sources=input.scope==='all'?[...latest.values()]:[base];
 if(!sources.length)throw Object.assign(Error('No eligible earlier cycles were found. Select and review a source sheet.'),{status:409});
 return sources.map(source=>{
   if(date(month)&&date(source.month)&&date(source.month)>=date(month))throw Object.assign(Error('The new cycle must follow the selected source cycle.'),{status:409});
   if(sheets.some(sheet=>allocationNameKey(sheet.district)===allocationNameKey(source.district)&&allocationNameKey(sheet.month)===allocationNameKey(month)))throw Object.assign(Error(`${source.district} already has a ${month} cycle. Open the existing sheet.`),{status:409});
   const id=`${source.district}_${month}`.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
   const rows=input.copyFacilities===false?[]:source.rows.filter(row=>row.facility).map((row,index)=>{
     const vaccines:Record<string,any>={};
     for(const [name,value] of Object.entries(row.vaccines||{})) {
       const numbers=allocationArithmetic(value);
       // Unknown or inconsistent ending balances cannot become invented opening stock.
       const carry=input.carryOverBalances===false?0:numbers.difference===0?numbers.balance:null;
       vaccines[name]={carryOver:carry??'',allocation:0,distributed:0,balance:carry??''};
     }
     return {id:`bp_${id}_${index+1}`,facility:row.facility,subDistrict:row.subDistrict||'',deliverySite:row.deliverySite||'',processing:'',completed:'',vaccines,
       ...Object.fromEntries(['facilityId','fsFacilityId','region','active','isActive','archived'].filter(field=>row[field]!==undefined).map(field=>[field,row[field]]))};
   });
   return {id,district:source.district,month,worksheetRole:'allocation' as const,products:source.products||[],rows,cycleState:'draft' as const,sourceSheetId:source.id,sourceUpdatedAt:source.updatedAt||null,updatedAt:new Date().toISOString()};
 });
}
