import React from 'react';
/** Insert independent cells between existing cells without changing allocation
 * field identities. Split spanning headers at insertions rather than expanding
 * a vaccine group to include unrelated columns. */
export default function BlueprintLayoutRow({ children, baseColumns, columns, renderCell, plainRow, decorateCell, ...props }: React.HTMLAttributes<HTMLTableRowElement> & {
  baseColumns: number[]; columns: number[]; renderCell: (index: number) => React.ReactNode; plainRow?: boolean; decorateCell?: (cell: React.ReactElement<any>, columns: number[], first: boolean) => React.ReactNode;
}) {
  let visibleCells = 0;
  const decorate = (cell: React.ReactNode, covered: number[], first: boolean) => decorateCell && React.isValidElement(cell) ? decorateCell(cell, covered, visibleCells++ === 0) : cell;
  if (plainRow) return <tr {...props}>{columns.map((col, index) => decorate(renderCell(col), [col], index === 0))}</tr>;
  if (!decorateCell && columns.length === baseColumns.length && columns.every((col, index) => col === baseColumns[index])) return <tr {...props}>{children}</tr>;
  const cells: React.ReactElement<any>[] = [];
  const flatten = (nodes: React.ReactNode) => React.Children.forEach(nodes, node => {
    if (!React.isValidElement(node)) return;
    if (node.type === React.Fragment) flatten((node.props as any).children); else cells.push(node);
  });
  flatten(children);
  let offset = 0;
  const emitted = new Set<number>();
  const result: React.ReactNode[] = [];
  const emitBefore = (base: number) => {
    const end = columns.indexOf(base);
    for (const index of columns.slice(0, end < 0 ? 0 : end)) {
      if (!baseColumns.includes(index) && !emitted.has(index)) { result.push(decorate(renderCell(index), [index], result.length === 0)); emitted.add(index); }
    }
  };
  for (const [i, cell] of cells.entries()) {
    if (cell.props.style?.display === 'none') { result.push(React.cloneElement(cell, { key: `hidden-${i}` })); continue; }
    const explicit = cell.props['data-grid-cell-col'];
    if (explicit !== undefined) offset = baseColumns.indexOf(Number(explicit));
    const span = Number(cell.props.colSpan || 1);
    const covered = baseColumns.slice(offset, offset + span);
    if (!covered.length) { result.push(React.cloneElement(cell, { key: `extra-${i}` })); continue; }
    let segment: number[] = [];
    let first = true;
    const flush = () => {
      if (!segment.length) return;
      result.push(decorate(React.cloneElement(cell, { key: `base-${i}-${segment[0]}`, colSpan: segment.length, children: first ? cell.props.children : null,
        ...(span > 1 && segment.length !== span ? { style: { ...cell.props.style, width: undefined, minWidth: undefined } } : {}) }), segment, result.length === 0));
      first = false; segment = [];
    };
    for (const index of covered) {
      const previous = segment.at(-1);
      if (previous !== undefined && columns.indexOf(index) > columns.indexOf(previous) + 1) flush();
      if (!segment.length) emitBefore(index);
      segment.push(index);
    }
    flush(); offset += span;
  }
  columns.forEach(index => { if (!baseColumns.includes(index) && !emitted.has(index)) { result.push(decorate(renderCell(index), [index], result.length === 0)); emitted.add(index); } });
  return <tr {...props}>{result}</tr>;
}
