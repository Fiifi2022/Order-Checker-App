import type { CSSProperties } from 'react';
import type { BlueprintProgressRow, BlueprintProgressVaccine, BlueprintProgressStatus } from './blueprintProgress';

export type AllocationStatus = 'not_applicable' | 'not_started' | 'in_progress' | 'completed' | 'over_distributed';
export interface AllocationWorksheet { worksheetRole?: 'allocation' | 'other'; sheetName?: string }

/** Explicit roles survive tab renames. Legacy district/cycle sheets are allocations. */
export function isAllocationWorksheet(sheet: AllocationWorksheet | undefined): boolean {
  if (sheet?.worksheetRole) return sheet.worksheetRole === 'allocation';
  return !sheet?.sheetName || /^allocation(?:\s+sheet)?$/i.test(sheet.sheetName.trim());
}

const quantity = (value: BlueprintProgressVaccine[keyof BlueprintProgressVaccine]) => {
  const parsed = Number(typeof value === 'string' ? value.replace(/,/g, '').trim() : value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function getAllocationStatus(vaccine?: BlueprintProgressVaccine): AllocationStatus {
  const totalAvailable = quantity(vaccine?.carryOver) + quantity(vaccine?.allocation);
  const distributed = quantity(vaccine?.distributed);
  const balance = totalAvailable - distributed;
  if (totalAvailable <= 0 && distributed <= 0) return 'not_applicable';
  if (distributed <= 0 && balance > 0) return 'not_started';
  if (distributed > 0 && balance > 0) return 'in_progress';
  if (totalAvailable > 0 && balance === 0) return 'completed';
  // Invalid excess quantities retain the existing discrepancy treatment.
  return 'over_distributed';
}

export function getAllocationFacilityStatus(row: BlueprintProgressRow | null | undefined, products: string[]): BlueprintProgressStatus {
  if (!row?.facility?.trim()) return 'pending';
  const statuses = products.map(product => getAllocationStatus(row.vaccines?.[product])).filter(status => status !== 'not_applicable');
  if (statuses.length && statuses.every(status => status === 'completed')) return 'completed';
  return statuses.some(status => ['in_progress', 'completed', 'over_distributed'].includes(status)) ? 'in_progress' : 'pending';
}

/** Status is a rendering overlay; never write its fill into baseFormatting. */
export function getAllocationCellStyle(baseFormatting: CSSProperties | undefined, status: AllocationStatus | undefined, selected: boolean): CSSProperties {
  return {
    ...baseFormatting,
    ...(status === 'in_progress' ? { backgroundColor: '#FEF08A' } : status === 'completed' ? { backgroundColor: '#DCFCE7' } : {}),
    ...(selected ? { boxShadow: 'inset 0 0 0 2px #38bdf8' } : {})
  };
}

/** SheetJS resolves theme/indexed Excel fill colours to RGB when cellStyles is enabled. */
export function getExcelBaseFormatting(style: any): CSSProperties {
  const fill = style?.fill || style;
  const rgb = fill?.patternType === 'solid' ? fill.fgColor?.rgb : undefined;
  return typeof rgb === 'string' && /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(rgb)
    ? { backgroundColor: `#${rgb.slice(-6)}` } : {};
}
