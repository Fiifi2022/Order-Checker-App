import { blueprintColumnKey, visibleBlueprintColumns } from './blueprintColumns';
export interface BlankBlueprintColumn {
  id: string;
  /** Stable field identity, not a positional index: vaccine formulas stay bound. */
  before: string | null;
  headers: string[];
}
export const blankColumnKey = (id: string) => `blank:${id}`;
export function layoutColumns(products: string[], deleted: string[], blank: BlankBlueprintColumn[]) {
  const baseCount = 5 + products.length * 4;
  const visible = new Set(visibleBlueprintColumns(products, deleted));
  const result: number[] = [];
  const emitted = new Set<string>();
  for (let i = 0; i < baseCount; i++) {
    const key = blueprintColumnKey(i, products);
    blank.forEach((col, j) => { if (col.before === key) { result.push(baseCount + j); emitted.add(col.id); } });
    if (visible.has(i)) result.push(i);
  }
  blank.forEach((col, j) => { if (!emitted.has(col.id)) result.push(baseCount + j); });
  return result;
}
export function layoutColumnKey(index: number, products: string[], blank: BlankBlueprintColumn[]) {
  const col = blank[index - 5 - products.length * 4];
  return col ? blankColumnKey(col.id) : blueprintColumnKey(index, products);
}
export function insertBlankColumns(columns: BlankBlueprintColumn[], products: string[], deleted: string[], target: number | undefined, side: 'left' | 'right', count: number, ids: string[]) {
  const visible = layoutColumns(products, deleted, columns);
  const position = target === undefined ? visible.length : Math.max(0, visible.indexOf(target)) + (side === 'right' ? 1 : 0);
  const following = visible.slice(position);
  const baseCount = 5 + products.length * 4;
  const nextBase = following.find(col => col < baseCount);
  const before = nextBase === undefined ? null : blueprintColumnKey(nextBase, products);
  const nextBlank = following.find(col => col >= baseCount);
  const index = nextBlank !== undefined && columns[nextBlank - baseCount].before === before ? nextBlank - baseCount : columns.map(col => col.before).lastIndexOf(before) + 1;
  const added = ids.slice(0, Math.max(1, Math.min(100, count))).map(id => ({ id, before, headers: ['', '', '', ''] }));
  const next = [...columns]; next.splice(index < 0 ? next.length : index, 0, ...added);
  return next;
}
/** Rebase A1 references by stable row/column identity, including absolute refs.
 * Quoted strings and references into other sheets are left untouched. */
export function rebaseBlueprintFormula(formula: string, oldColumns: string[], newColumns: string[], oldRows: string[], newRows: string[]) {
  if (!formula.startsWith('=')) return formula;
  return formula.split(/("(?:[^"]|"")*")/g).map((part, i) => i % 2 ? part : part.replace(/(?<![\w!$'])((\$?)([A-Z]+)(\$?)([1-9]\d*))(?![\w(])/g, (match, _ref, ca, letters, ra, number) => {
    let col = 0; for (const c of letters) col = col * 26 + c.charCodeAt(0) - 64;
    const oldKey = oldColumns[col - 1], rowNumber = Number(number);
    if (!oldKey) return match;
    const nextCol = newColumns.indexOf(oldKey);
    const oldRow = oldRows[rowNumber - 5];
    const nextRow = rowNumber < 5 || !oldRow ? rowNumber : newRows.indexOf(oldRow) + 5;
    if (nextCol < 0 || nextRow < 5 && rowNumber >= 5) return '#REF!';
    let n = nextCol + 1, label = ''; while (n) { label = String.fromCharCode(65 + (n - 1) % 26) + label; n = Math.floor((n - 1) / 26); }
    return ca + label + ra + nextRow;
  })).join('');
}
