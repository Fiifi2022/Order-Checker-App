interface ClipboardDataLike { getData(type:string):string }
const quoteCell=(value:string)=>/[\t\r\n"]/.test(value)?`"${value.replace(/"/g,'""')}"`:value;

/** Read clipboard data during the paste event; no clipboard permission is needed.
 * HTML is parsed in an inert template and only table text enters the grid. */
export function blueprintClipboardText(data:ClipboardDataLike,document:Document):string {
 const plain=data.getData('text/plain') || data.getData('text') || data.getData('text/tab-separated-values');
 if(plain)return plain;
 const html=data.getData('text/html');if(!html)return '';
 const template=document.createElement('template');template.innerHTML=html;
 const table=template.content.querySelector('table');if(!table)return '';
 const result:string[][]=[],occupied:boolean[][]=[];
 const text=(node:Node):string=>node.nodeType===3?node.textContent || '':node.nodeName==='BR'?'\n':Array.from(node.childNodes).map(text).join('');
 const trs=Array.from(table.querySelectorAll('tr')).filter(row=>row.closest('table')===table);
 trs.forEach((tr,rowIndex)=>{
  result[rowIndex]??=[];occupied[rowIndex]??=[];
  let column=0;
  for(const cell of Array.from(tr.children).filter(node=>['TD','TH'].includes(node.nodeName))) {
   while(occupied[rowIndex][column])column++;
   const span=(attribute:string)=>Math.max(1,Math.min(1000,Number(cell.getAttribute(attribute)) || 1));
   const width=span('colspan'),height=span('rowspan');
   for(let row=rowIndex;row<Math.min(trs.length,rowIndex+height);row++)for(let col=column;col<column+width;col++){
    result[row]??=[];occupied[row]??=[];occupied[row][col]=true;result[row][col]=row===rowIndex && col===column?text(cell).replace(/\u00a0/g,' ').trim():'';
   }
   column+=width;
  }
 });
 return result.map(row=>Array.from({length:row.length},(_,i)=>quoteCell(row[i] || '')).join('\t')).join('\n');
}

/** Screen order is authoritative; filtered-out rows are never paste targets. */
export function blueprintPasteRowTargets(visibleIds:readonly string[],startId:string,count:number):(string|null)[] {
 const start=visibleIds.indexOf(startId);
 if(start<0)throw Error('Select a visible Blueprint cell before pasting.');
 return Array.from({length:count},(_,offset)=>visibleIds[start+offset] ?? null);
}

/** Excel display values (including accounting negatives) are numeric, not formulas. */
export function blueprintPasteQuantity(value:string):number|'' {
 const raw=value.trim();
 if(!raw || raw==='-' || raw==='—')return '';
 const normalized=raw.replace(/[,\s\u00a0\u202f]/g,'').replace(/^\((.+)\)$/,'-$1');
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) || !Number.isFinite(Number(normalized)))throw Error(`“${value}” is not a valid quantity. Nothing was changed.`);
 return Number(normalized);
}

/** Quote cell content so Excel can round-trip embedded tabs, quotes and line breaks. */
export function blueprintClipboardTsv(rows: readonly (readonly string[])[]): string {
 return rows.map(row=>row.map(quoteCell).join('\t')).join('\n');
}

/** Called only from the user's Paste action; permission failures stay visible to the caller. */
export async function readBlueprintClipboard(clipboard: Pick<Clipboard,'read'|'readText'> | undefined, document: Document): Promise<string> {
 if(!clipboard)throw new Error('Clipboard unavailable');
 if(clipboard.readText) {
  const plain=await clipboard.readText();
  if(plain)return plain;
 }
 if(clipboard.read) {
  for(const item of await clipboard.read()) {
   const values:Record<string,string>={};
   for(const type of ['text/plain','text/html'])if(item.types.includes(type))values[type]=await (await item.getType(type)).text();
   const text=blueprintClipboardText({getData:type=>values[type] || ''},document);
   if(text)return text;
  }
 }
 return '';
}
