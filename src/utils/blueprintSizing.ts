export interface BlueprintSizing {
  columnWidths: Record<string, number>;
  rowHeights: Record<string, number>;
}
export const emptyBlueprintSizing = (): BlueprintSizing => ({ columnWidths: {}, rowHeights: {} });
/** Pointer coordinates are screen pixels; sheet dimensions are unzoomed pixels. */
export function resizedBlueprintDimension(kind: 'column' | 'row', start: number, delta: number, zoom = 100) {
  const value = start + delta / (Math.max(10, zoom) / 100);
  const min = kind === 'column' ? 36 : 24, max = kind === 'column' ? 1200 : 600;
  return Math.round(Math.max(min, Math.min(max, Number.isFinite(value) ? value : start)));
}
