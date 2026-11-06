export interface BlueprintCellColor {backgroundColor?:string;color?:string}
export type BlueprintHeaderColors=Record<string,BlueprintCellColor>;
export function headerColorKey(row:number,columnKey:string){return `header:${row}:${columnKey}`;}
export function updateBlueprintCellColor(previous:BlueprintCellColor|undefined,property:'backgroundColor'|'color',value?:string):BlueprintCellColor {
 const next={...previous};
 if(value && !/^#[0-9a-f]{6}$/i.test(value))throw Error('Choose a valid cell colour.');
 if(value)next[property]=value;
 else if(property==='backgroundColor')next.backgroundColor='#ffffff'; // No fill overrides imported/status backgrounds.
 else delete next.color;
 return next;
}
export function blueprintCellForeground(colors:BlueprintCellColor|undefined):string|undefined {
 if(colors?.color)return colors.color;
 const hex=colors?.backgroundColor?.replace('#','');
 if(!hex || !/^[0-9a-f]{6}$/i.test(hex))return undefined;
 const [r,g,b]=[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16));
 return (r*299+g*587+b*114)/1000>=150?'#1e293b':'#ffffff';
}
