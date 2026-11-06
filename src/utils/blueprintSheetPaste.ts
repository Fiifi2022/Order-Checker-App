import {catalogProductNames,type CatalogProduct} from '../../shared/productCatalog';
import {allocationNameKey} from '../../shared/allocationOperations';
import {blueprintProductKey,parseClipboardTsv,type BlueprintPasteRow} from './blueprintPaste';
import {blueprintPasteQuantity} from './blueprintClipboard';
type Field='facility'|'processing'|'completed'|'subDistrict'|'deliverySite'|'comment'|'carryOver'|'allocation'|'distributed'|'balance'|'district'|'month';
export interface SheetPasteColumn {index:number;field:Field;product?:string;heading:string}
export interface SheetPastePreview {rows:BlueprintPasteRow[];products:string[];columns:SheetPasteColumn[];errors:string[];warnings:string[];skippedRows:number;district?:string;month?:string}
const key=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]/g,'');
const metadata:Record<string,Field>={facility:'facility',facilityname:'facility',nameofhealthfacility:'facility',healthfacility:'facility',nameoffacility:'facility',processing:'processing',processingdate:'processing',startdate:'processing',completed:'completed',completeddate:'completed',completiondate:'completed',subdistrict:'subDistrict',deliverysite:'deliverySite',dropsite:'deliverySite',droparea:'deliverySite',deliverydroparea:'deliverySite',comment:'comment',comments:'comment',notes:'comment',note:'comment',district:'district',month:'month',cycle:'month'};
const quantityFields:Record<string,Field>={carryover:'carryOver',allocation:'allocation',allocated:'allocation',distributed:'distributed',balance:'balance'};
const ignored=(text:string)=>['sn','sno','no','number','serialnumber','serialno'].includes(key(text));
const quantityPattern=/(?:carry[- ]?over|allocation|allocated|distributed|balance)/i;
const empty=(errors:string[]=[]):SheetPastePreview=>({rows:[],products:[],columns:[],errors,warnings:[],skippedRows:0});

/** Whole-sheet mapping uses named headings, never a guessed numeric column order. */
export function previewBlueprintSheetPaste(text:string,currentProducts:readonly string[],catalogue:readonly CatalogProduct[]=[]):SheetPastePreview {
 const table=parseClipboardTsv(text);
 if(!text.trim())return empty();
 if(table.length>10000 || table.some(row=>row.length>500))return empty(['Paste up to 10,000 rows and 500 columns at a time.']);
 const headerIndex=table.slice(0,25).findIndex(row=>row.some(cell=>metadata[key(cell)]==='facility'));
 if(headerIndex<0)return empty(['Include a Facility or Facility name heading and named vaccine columns so the sheet can be arranged safely.']);
 const header=table[headerIndex];
 const facilityColumn=header.findIndex(cell=>metadata[key(cell)]==='facility');
 let subheader=-1;
 for(let index=headerIndex+1;index<Math.min(table.length,headerIndex+6);index++){
  const row=table[index];
  if(row[facilityColumn] && metadata[key(row[facilityColumn])]!=='facility')break;
  if(row.filter(cell=>quantityFields[key(cell)]).length>=2){subheader=index;break;}
 }
 const dataStart=subheader<0?headerIndex+1:subheader+1;
 const data=table.slice(dataStart);
 const width=Math.max(header.length,...table.slice(headerIndex,dataStart).map(row=>row.length),...data.filter(row=>row.some(Boolean)).map(row=>row.length));
 const result=empty();
 const title=table.slice(0,headerIndex).flat().find(value=>/^(.*?)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s*$/i.test(value.trim()));
 const titleMatch=title?.trim().match(/^(.*?)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s*$/i);
 if(titleMatch){result.district=titleMatch[1].trim();result.month=`${titleMatch[2]} ${titleMatch[3]}`;}

 const names=new Map<string,Set<string>>();
 const add=(alias:string,name:string)=>{const k=blueprintProductKey(alias);if(!k)return;names.set(k,new Set([...(names.get(k)||[]),name]));};
 currentProducts.forEach(name=>add(name,name));
 catalogue.filter(product=>product.scope==='vaccine').forEach(product=>{
  const aliases=catalogProductNames(product);
  const existing=currentProducts.filter(name=>aliases.some(alias=>blueprintProductKey(alias)===blueprintProductKey(name)));
  const canonical=existing.length===1?existing[0]:product.name;
  aliases.forEach(alias=>add(alias,canonical));
 });
 const seen=new Set<string>();
 let group='';
 for(let col=0;col<width;col++){
  const flat=(header[col]||'').trim();const field=metadata[key(flat)];
  if(field){result.columns.push({index:col,field,heading:flat});continue;}
  if(ignored(flat))continue;
  let label=flat,quantity:Field='allocation';
  if(subheader>=0){
   quantity=quantityFields[key(table[subheader][col]||'')];
   if(!quantity){if(data.some(row=>row[col]?.trim()))result.errors.push(`Column ${col+1} has data but no recognized heading.`);continue;}
   const groupLabel=table.slice(headerIndex,subheader).map(row=>row[col]?.trim()).reverse().find(value=>value && !metadata[key(value)] && !['vaccines','vaccine','products','product'].includes(key(value)));
   if(groupLabel)group=groupLabel;
   label=group;
  }else{
   const suffix=flat.match(new RegExp(`\\s*(${quantityPattern.source})\\s*$`,'i'));
   const prefix=flat.match(new RegExp(`^(${quantityPattern.source})\\s+`,'i'));
   const match=suffix||prefix;
   if(match){quantity=quantityFields[key(match[1])];label=(suffix?flat.slice(0,suffix.index):flat.slice(match[0].length)).trim();}
  }
  if(!label){if(data.some(row=>row[col]?.trim()))result.errors.push(`Column ${col+1} has data but no product name.`);continue;}
  const candidates=names.get(blueprintProductKey(label));
  if(candidates && candidates.size>1){result.errors.push(`Product heading “${label}” matches multiple catalogue products. Use the canonical name.`);continue;}
  const product=candidates?.size===1?[...candidates][0]:label;
  if(!result.products.includes(product))result.products.push(product);
  const signature=`product:${product}:${quantity}`;
  if(seen.has(signature))result.errors.push(`“${product} ${quantity}” appears in more than one column.`);
  seen.add(signature);result.columns.push({index:col,field:quantity,product,heading:flat||`${product} ${quantity}`});
 }
 for(const field of ['facility','processing','completed','subDistrict','deliverySite','comment','district','month'])if(result.columns.filter(column=>column.field===field && !column.product).length>1)result.errors.push(`The sheet contains more than one ${field} column.`);
 if(!result.columns.some(column=>column.product && column.field!=='balance'))result.errors.push('No editable vaccine quantity columns were found. Include vaccine names in the headings.');
 const facilities=new Set<string>();
 data.forEach((cells,offset)=>{
  if(!cells.some(value=>value.trim()))return;
  const facility=cells[facilityColumn]?.trim()||'';
  if(/^(?:grand\s+)?totals?\s*:?$/i.test(facility)){result.skippedRows++;return;}
  const rowNumber=dataStart+offset+1;
  if(!facility){result.errors.push(`Row ${rowNumber} has data but no facility name.`);return;}
  const facilityKey=allocationNameKey(facility);
  if(facilities.has(facilityKey)){result.errors.push(`Facility “${facility}” is repeated. Combine or distinguish its rows before applying.`);return;}
  facilities.add(facilityKey);
  const row:BlueprintPasteRow={id:`bp_sheet_${globalThis.crypto?.randomUUID?.()||`${Date.now()}_${offset}`}`,facility,processing:'',completed:'',subDistrict:'',vaccines:{}};
  result.products.forEach(product=>{row.vaccines[product]={carryOver:'',allocation:'',distributed:'',balance:''};});
  for(const column of result.columns){
   const value=cells[column.index]?.trim()||'';
   if(column.product){
    try{const numeric=blueprintPasteQuantity(value);if(column.field!=='balance')(row.vaccines[column.product] as any)[column.field]=numeric;}
    catch{result.errors.push(`Row ${rowNumber}, ${column.product}: “${value}” is not a valid quantity.`);}
   }else{(row as any)[column.field]=value;}
  }
  for(const vaccine of Object.values(row.vaccines))vaccine.balance=[vaccine.carryOver,vaccine.allocation,vaccine.distributed].every(value=>value==='')?'':Number(vaccine.carryOver||0)+Number(vaccine.allocation||0)-Number(vaccine.distributed||0);
  result.rows.push(row);
 });
 if(!result.rows.length && !result.errors.length)result.errors.push('No facility rows were found below the headings.');
 if(result.skippedRows)result.warnings.push(`${result.skippedRows} total row(s) will be skipped; balances are calculated automatically.`);
 return result;
}

/** Upsert by confirmed facility name, preserving IDs, absent fields and other rows. */
export function mergeBlueprintSheetPaste<T extends Omit<BlueprintPasteRow,'subDistrict'|'vaccines'> & {subDistrict?:string;vaccines:Record<string,{carryOver?:number|string;allocation?:number|string;distributed?:number|string;balance?:number|string}>}>(existing:readonly T[],products:readonly string[],preview:SheetPastePreview):{rows:T[];products:string[];added:number;updated:number} {
 if(preview.errors.length)throw Error(preview.errors[0]);
 const result=existing.map(row=>({...row,vaccines:{...row.vaccines}}));
 const nextProducts=[...new Set([...products,...preview.products])];
 let added=0,updated=0;
 const pastedIds:string[]=[];
 for(const imported of preview.rows){
  const matches=result.flatMap((row,index)=>allocationNameKey(row.facility)===allocationNameKey(imported.facility)?[index]:[]);
  if(matches.length>1)throw Error(`Multiple existing rows match “${imported.facility}”. Resolve them before applying the sheet.`);
  const reusable=result.findIndex(row=>!row.facility.trim() && !(row as any).facilityId && !(row as any).fsFacilityId &&
    ['processing','completed','subDistrict','deliverySite','comment'].every(field=>!String((row as any)[field]||'').trim()) &&
    !Object.values((row as any).cells||{}).some(value=>String(value||'').trim()) &&
    Object.values(row.vaccines).every(value=>[value.carryOver,value.allocation,value.distributed,value.balance].every(number=>number===''||number==null)));
  const index=matches[0]??(reusable>=0?reusable:result.length);
  const previous=result[index];
  const row={...(previous||imported),vaccines:{...(previous?.vaccines||{})}} as T;
  if(!matches.length)delete (row as any).rowKind;
  for(const column of preview.columns){
   if(column.product){
    if(column.field==='balance')continue;
    row.vaccines[column.product]={...(row.vaccines[column.product]||{carryOver:'',allocation:'',distributed:'',balance:''}),[column.field]:(imported.vaccines[column.product] as any)[column.field]};
   }else if(!['district','month'].includes(column.field)){(row as any)[column.field]=(imported as any)[column.field];}
  }
  for(const product of nextProducts){
   const value=row.vaccines[product]||{carryOver:'',allocation:'',distributed:'',balance:''};
   row.vaccines[product]={...value,balance:[value.carryOver,value.allocation,value.distributed].every(number=>number==='' || number==null)?'':Number(value.carryOver||0)+Number(value.allocation||0)-Number(value.distributed||0)};
  }
  result[index]=row;pastedIds.push(row.id);if(matches.length)updated++;else added++;
 }
 return {rows:[...pastedIds.map(id=>result.find(row=>row.id===id)!),...result.filter(row=>!pastedIds.includes(row.id))],products:nextProducts,added,updated};
}

export function hasBlueprintSheetHeadings(text:string):boolean {
 return parseClipboardTsv(text).slice(0,25).some(row=>row.length>1 && row.some(cell=>metadata[key(cell)]==='facility'));
}
export function arrangeBlueprintSheetPaste<T extends Parameters<typeof mergeBlueprintSheetPaste>[0][number]>(text:string,rows:readonly T[],products:string[],context:{district:string;month:string;catalogue?:readonly CatalogProduct[]}) {
 if(!hasBlueprintSheetHeadings(text))return null;
 const preview=previewBlueprintSheetPaste(text,products,context.catalogue||[]);
 if(preview.errors.length)throw Error(preview.errors[0]);
 const check=(district?:string,month?:string)=>{
  if(district && allocationNameKey(district)!==allocationNameKey(context.district))throw Error(`This table is for ${district}. Select that district before pasting.`);
  if(month && allocationNameKey(month)!==allocationNameKey(context.month))throw Error(`This table is for ${month}. Select that cycle before pasting.`);
 };
 check(preview.district,preview.month);
 for(const row of preview.rows)check((row as any).district,(row as any).month);
 return {...mergeBlueprintSheetPaste(rows,products,preview),preview};
}
