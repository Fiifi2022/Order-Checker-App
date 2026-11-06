import type {FacilityBlueprintRow} from '../components/VaccineAllocationBlueprint';
import {layoutColumns,layoutColumnKey,type BlankBlueprintColumn} from './blueprintLayout';
import {blueprintPasteQuantity,blueprintPasteRowTargets} from './blueprintClipboard';

/** Plan and validate the entire expansion before publishing any rows or columns. */
export function expandBlueprintRange(input:{rows:readonly FacilityBlueprintRow[];visibleRowIds:readonly string[];products:string[];deleted:string[];blankColumns:readonly BlankBlueprintColumn[];startRowId?:string;startCol:number;matrix:string[][]}) {
 const {rows,products,deleted,matrix}=input;
 if(!matrix.length || matrix.length>10000 || matrix.some(row=>row.length>500))throw Error('Paste up to 10,000 rows and 500 columns at a time.');
 const before=layoutColumns(products,deleted,[...input.blankColumns]);
 const start=before.indexOf(input.startCol);
 if(start<0 && before.length)throw Error('Select a visible Blueprint column before pasting.');
 const startIndex=Math.max(0,start),width=Math.max(...matrix.map(row=>row.length));
 const addedColumns=Math.max(0,startIndex+width-before.length);
 const blankColumns=[...input.blankColumns,...Array.from({length:addedColumns},()=>({id:globalThis.crypto.randomUUID(),before:null,headers:['','','','']}))];
 const columns=layoutColumns(products,deleted,blankColumns).slice(startIndex,startIndex+width);
 const targetIds=input.visibleRowIds.length?blueprintPasteRowTargets(input.visibleRowIds,input.startRowId||input.visibleRowIds[0],matrix.length):matrix.map(()=>null);
 const result=[...rows];let addedRows=0;
 const baseCount=5+products.length*4;
 matrix.forEach((values,offset)=>{
  const index=targetIds[offset]?result.findIndex(row=>row.id===targetIds[offset]):result.length;
  if(index<0)throw Error('The destination row changed. Select the cell and paste again.');
  const existing=result[index];
  const row:FacilityBlueprintRow=existing?{...existing,vaccines:{...existing.vaccines},cells:{...existing.cells}}:{id:`bp_paste_${globalThis.crypto.randomUUID()}`,processing:'',completed:'',facility:'',subDistrict:'',deliverySite:'',vaccines:{},...(rows.find(row=>row.id===input.startRowId)?.rowKind==='blank'?{rowKind:'blank' as const,cells:{}}:{})};
  const changedProducts=new Set<string>();
  values.forEach((value,position)=>{
   const col=columns[position];
   if(row.rowKind==='blank' || col>=baseCount){row.cells={...row.cells,[layoutColumnKey(col,products,blankColumns)]:value};return;}
   if(col<5){row[(['processing','completed','facility','subDistrict','deliverySite'] as const)[col]]=value;return;}
   const product=products[Math.floor((col-5)/4)],sub=(col-5)%4;
   if(sub===3)return; // Balance remains calculated, even in an expanded paste.
   const field=(['carryOver','allocation','distributed'] as const)[sub];
   row.vaccines[product]={...row.vaccines[product],[field]:blueprintPasteQuantity(value)};changedProducts.add(product);
  });
  for(const product of changedProducts){
   const value=row.vaccines[product];
   const quantities=[value.carryOver,value.allocation,value.distributed].map(number=>blueprintPasteQuantity(String(number??'')));
   value.balance=quantities.every(number=>number==='')?'':Number(quantities[0]||0)+Number(quantities[1]||0)-Number(quantities[2]||0);
  }
  result[index]=row;if(!existing)addedRows++;
 });
 return {rows:result,blankColumns,addedRows,addedColumns};
}
