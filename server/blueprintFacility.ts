export const FACILITY_NOT_FOUND = 'Facility not found in the selected Allocation Blueprint.';
export const FACILITY_AMBIGUOUS = 'Multiple matching facilities found. Blueprint selection is required.';

// Older sheets have no lifecycle flag. Explicitly disabled/archived records
// must never accept new fulfilments; selecting a UI tab is not activation.
export function assertBlueprintActive(sheet: any, row?: any) {
  if (sheet?.worksheetRole === 'other' || [sheet, row].some(value => value && (value.active === false || value.isActive === false || value.archived === true || value.deleted === true || ['inactive', 'archived', 'deleted'].includes(String(value.status || '').toLowerCase())))) {
    throw new Error('ALLOCATION ERROR: The selected Allocation Blueprint or facility record is inactive. Select an active allocation cycle and audit again.');
  }
}

// Formatting normalization only: no substring, edit-distance, or word-dropping matches.
export function normalizeFacilityName(value: unknown): string {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/\bc[.\s]*h[.\s]*p[.\s]*s\b/g, 'chps')
    .replace(/\bh[.\s]*c\b\.?/g, 'health centre')
    .replace(/\bd[.\s]*h[.\s]*d\b\.?/g, 'district health directorate')
    .replace(/\bhealth\s+center\b/g, 'health centre')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export interface BlueprintFacilityContext {
  facilityName: string;
  sheetId?: string;
  selectedSheetId?: string;
  district?: string;
  cycle?: string;
  rowId?: string;
}

export function resolveBlueprintFacility<T extends {id: string; district?: string; month?: string; rows?: any[]}>(
  sheets: T[], context: BlueprintFacilityContext
): {sheet: T; row: any; rowIndex: number; candidateCount: number} {
  const normalizedName = normalizeFacilityName(context.facilityName);
  const sheetId = context.sheetId || context.selectedSheetId;
  if (!normalizedName || (context.sheetId && context.selectedSheetId && context.sheetId !== context.selectedSheetId)) {
    throw Object.assign(new Error(FACILITY_NOT_FOUND), {candidateCount:0});
  }
  const scopedSheets = sheets.filter(sheet =>
    (!sheetId || sheet.id === sheetId) &&
    (!context.district || normalizeFacilityName(sheet.district) === normalizeFacilityName(context.district)) &&
    (!context.cycle || normalizeFacilityName(sheet.month) === normalizeFacilityName(context.cycle))
  );
  const candidates = scopedSheets.flatMap(sheet => (sheet.rows || []).map((row, rowIndex) => ({sheet,row,rowIndex})))
    .filter(candidate => (!context.rowId || candidate.row.id === context.rowId) &&
      normalizeFacilityName(candidate.row.facility) === normalizedName);
  // Even an exact spelling cannot silently hide a duplicate normalized row.
  if (candidates.length !== 1) throw Object.assign(new Error(candidates.length ? FACILITY_AMBIGUOUS : FACILITY_NOT_FOUND), {candidateCount:candidates.length});
  return {...candidates[0],candidateCount:1};
}
