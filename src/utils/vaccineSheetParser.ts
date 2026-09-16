/**
 * Comprehensive Vaccine Spreadsheet & Multi-Tab Scanner
 * Supports:
 * 1. Multi-tab workbooks (scans all sheets, allows selecting specific tab or batch importing all)
 * 2. Multi-level matrix headers (Facility | Antigen -> Carry-over | Allocation | Distributed | Balance) as in GHS EPI sheets
 * 3. Sub-districts detection:
 *    - Tabs representing sub-districts (e.g., "Nsuta Sub-district", "Atebubu Sub")
 *    - Sub-district divider/section rows within sheets (e.g., "NSUTA SUB-DISTRICT", "KWAMANG SUB-DISTRICT")
 *    - Dedicated Sub-district columns
 * 4. Flat row tables (Facility, Vaccine, Allocation, Taken, Balance)
 */

import * as XLSX from 'xlsx';
import { ParsedAllocationRow, ScannedSheetTab } from '../types';

// Canonical Antigens keywords
const KNOWN_ANTIGENS: { key: string; regex: RegExp }[] = [
  { key: 'BCG', regex: /\b(bcg|bacillus)\b/i },
  { key: 'OPV', regex: /\b(opv|bopv|oral polio|polio oral)\b/i },
  { key: 'Penta', regex: /\b(penta|pentavalent|dtp-hep|dtp)\b/i },
  { key: 'PCV', regex: /\b(pcv|pcv13|pneumo)\b/i },
  { key: 'Rota', regex: /\b(rota|rotasiil|rotarix|rotavirus)\b/i },
  { key: 'MR', regex: /\b(mr|measles|rubella)\b/i },
  { key: 'Yellow Fever', regex: /\b(yf|yellow fever|stamaril)\b/i },
  { key: 'Men A', regex: /\b(men\s*a|mena|men-a|menafrivac|mening)\b/i },
  { key: 'HPV', regex: /\b(hpv|gardasil|human papilloma)\b/i },
  { key: 'IPV', regex: /\b(ipv|inactivated polio)\b/i },
  { key: 'Td', regex: /\b(td|tetanus|tt)\b/i },
  { key: 'COVID-19', regex: /\b(covid|covid-19|pfizer|moderna)\b/i }
];

export function identifyAntigen(text: string): string | null {
  if (!text) return null;
  const clean = text.trim();
  for (const ant of KNOWN_ANTIGENS) {
    if (ant.regex.test(clean)) {
      return ant.key;
    }
  }
  return null;
}

export function isSubDistrictText(text: string): boolean {
  if (!text) return false;
  return /sub[-\s]?district/i.test(text);
}

export function cleanSubDistrictName(text: string): string {
  if (!text) return '';
  return text
    .replace(/^(\d+[\.\)]\s*)/, '') // remove numbers like "1. " or "2) "
    .replace(/sub[-\s]?district/gi, '')
    .replace(/[:–—\-]/g, '')
    .trim();
}

export function isSummaryOrIgnoreRow(text: string): boolean {
  if (!text) return true;
  const lower = text.toLowerCase().trim();
  if (lower === '' || lower === '-' || lower === '–') return true;
  if (/^(total|sub[-\s]?total|grand total|district total|regional total|average|mean|target|prepared by|compiled by|approved by|supervisor|signature|date)\b/i.test(lower)) {
    return true;
  }
  return false;
}

export interface MatrixColumnMapping {
  colIndex: number;
  vaccine: string;
  field: 'carryOver' | 'allocation' | 'distributed' | 'balance';
}

/**
 * Scan a single worksheet from 2D raw rows
 */
export function scanWorksheet(
  sheetName: string,
  rawJson: any[][],
  defaultNest: string = 'Northern Nest',
  defaultCycle: string = 'September 2026'
): ScannedSheetTab {
  // Step 1: Detect district & sub-district from Tab Name
  let isSubDistrictTab = isSubDistrictText(sheetName);
  let detectedSubDistrict = isSubDistrictTab ? cleanSubDistrictName(sheetName) : '';
  
  let detectedDistrict = '';
  if (/karaga/i.test(sheetName)) {
    detectedDistrict = 'Karaga';
  } else if (/west\s*mamprusi/i.test(sheetName)) {
    detectedDistrict = 'West Mamprusi';
  } else if (/mmd|mamprugu\s*moagduri/i.test(sheetName)) {
    detectedDistrict = 'MMD';
  } else if (/east\s*mamprusi/i.test(sheetName)) {
    detectedDistrict = 'East Mamprusi';
  } else if (/bunkpurugu/i.test(sheetName)) {
    detectedDistrict = 'Bunkpurugu';
  } else if (!isSubDistrictTab) {
    detectedDistrict = sheetName.replace(/district|municipal|metro|september|sept?|allocation/gi, '').trim();
  }

  if (!detectedDistrict) {
    detectedDistrict = 'Northern Operational Zone';
  }

  const subDistrictsFoundSet = new Set<string>();
  if (detectedSubDistrict) {
    subDistrictsFoundSet.add(detectedSubDistrict);
  }

  // Step 2: Analyze top 12 rows to detect matrix or flat structure
  let headerRowIndex = -1;
  let subHeaderRowIndex = -1;
  let isMatrixLayout = false;
  const matrixCols: MatrixColumnMapping[] = [];
  const antigensFoundSet = new Set<string>();

  const maxHeaderSearchRows = Math.min(rawJson.length, 12);

  for (let r = 0; r < maxHeaderSearchRows - 1; r++) {
    const row = rawJson[r] || [];
    const nextRow = rawJson[r + 1] || [];

    // Check if current row contains antigen names
    const rowAntigens: { col: number; vaccine: string }[] = [];
    row.forEach((cell, cIdx) => {
      const cellStr = String(cell || '').trim();
      const antigen = identifyAntigen(cellStr);
      if (antigen) {
        rowAntigens.push({ col: cIdx, vaccine: antigen });
        antigensFoundSet.add(antigen);
      }
    });

    // Check if next row contains sub-headers like Carry-over, Allocation, Distributed, Balance
    if (rowAntigens.length > 0) {
      let subHeadersMatchCount = 0;
      nextRow.forEach((subCell) => {
        const subStr = String(subCell || '').toLowerCase().trim();
        if (/carry|allocation|distributed|taken|balance|issued|received|remaining/i.test(subStr)) {
          subHeadersMatchCount++;
        }
      });

      if (subHeadersMatchCount >= 2) {
        // We found a matrix layout!
        headerRowIndex = r;
        subHeaderRowIndex = r + 1;
        isMatrixLayout = true;
        break;
      }
    }
  }

  // Step 3: If matrix layout detected, build the column mapping
  let facilityColIndex = 0;
  let subDistrictColIndex = -1;

  if (isMatrixLayout && headerRowIndex >= 0 && subHeaderRowIndex >= 0) {
    const topRow = rawJson[headerRowIndex] || [];
    const subRow = rawJson[subHeaderRowIndex] || [];

    // Find Facility column index in topRow or subRow
    topRow.forEach((c, idx) => {
      const s = String(c || '').toLowerCase().trim();
      if (/facility|hospital|clinic|health center|site/i.test(s)) facilityColIndex = idx;
      if (/sub[-\s]?district/i.test(s)) subDistrictColIndex = idx;
    });
    subRow.forEach((c, idx) => {
      const s = String(c || '').toLowerCase().trim();
      if (/facility|hospital|clinic|health center|site/i.test(s)) facilityColIndex = idx;
      if (/sub[-\s]?district/i.test(s)) subDistrictColIndex = idx;
    });

    // Spread top headers across merged cells
    let currentVaccine: string | null = null;
    const maxCols = Math.max(topRow.length, subRow.length);

    for (let c = 0; c < maxCols; c++) {
      const topCell = String(topRow[c] || '').trim();
      const detectedVac = identifyAntigen(topCell);
      if (detectedVac) {
        currentVaccine = detectedVac;
        antigensFoundSet.add(detectedVac);
      }

      const subCell = String(subRow[c] || '').toLowerCase().trim();
      if (currentVaccine) {
        let field: 'carryOver' | 'allocation' | 'distributed' | 'balance' | null = null;
        if (/carry|c\/o|previous/i.test(subCell)) {
          field = 'carryOver';
        } else if (/allocation|allocated|quota|planned/i.test(subCell)) {
          field = 'allocation';
        } else if (/distribut|taken|issued|dispens/i.test(subCell)) {
          field = 'distributed';
        } else if (/balance|remain|available|ending/i.test(subCell)) {
          field = 'balance';
        }

        if (field) {
          matrixCols.push({
            colIndex: c,
            vaccine: currentVaccine,
            field
          });
        }
      }
    }
  }

  // Step 4: Parse Facility Rows
  const parsedRows: ParsedAllocationRow[] = [];
  const facilityMap = new Map<string, {
    facilityName: string;
    subDistrict: string;
    district: string;
    vaccines: Record<string, { carryOver: number; allocation: number; taken: number; remaining: number }>;
  }>();

  let activeSectionSubDistrict = detectedSubDistrict;
  const startRow = isMatrixLayout ? subHeaderRowIndex + 1 : 1;

  for (let r = startRow; r < rawJson.length; r++) {
    const row = rawJson[r] || [];
    const firstCell = String(row[facilityColIndex] || '').trim();

    if (!firstCell || isSummaryOrIgnoreRow(firstCell)) {
      continue;
    }

    // Check if this row is a Sub-district section header row (e.g., "NSUTA SUB-DISTRICT")
    if (isSubDistrictText(firstCell)) {
      // Check if this row is just a title banner (numeric cells are empty or all NaN)
      const numericCount = row.filter((val, cIdx) => cIdx !== facilityColIndex && !isNaN(parseFloat(val))).length;
      if (numericCount <= 1) {
        activeSectionSubDistrict = cleanSubDistrictName(firstCell);
        if (activeSectionSubDistrict) {
          subDistrictsFoundSet.add(activeSectionSubDistrict);
        }
        continue; // Don't treat section header as a facility
      }
    }

    // Determine sub-district for this specific facility row
    let rowSubDistrict = activeSectionSubDistrict || detectedSubDistrict;
    if (subDistrictColIndex >= 0 && row[subDistrictColIndex]) {
      const explicitSub = cleanSubDistrictName(String(row[subDistrictColIndex]).trim());
      if (explicitSub) {
        rowSubDistrict = explicitSub;
        subDistrictsFoundSet.add(explicitSub);
      }
    }

    // Clean facility name (strip leading numbers like "1. ", "2. ")
    const cleanFacilityName = firstCell.replace(/^(\d+[\.\)]\s*)/, '').trim();
    if (cleanFacilityName.length < 2) continue;

    if (isMatrixLayout && matrixCols.length > 0) {
      // Group values by vaccine for this facility
      const facilityVacData: Record<string, { carryOver: number; allocation: number; taken: number; remaining: number }> = {};

      for (const col of matrixCols) {
        const valStr = row[col.colIndex];
        const valNum = !isNaN(parseFloat(valStr)) ? parseFloat(valStr) : 0;

        if (!facilityVacData[col.vaccine]) {
          facilityVacData[col.vaccine] = { carryOver: 0, allocation: 0, taken: 0, remaining: 0 };
        }

        if (col.field === 'carryOver') facilityVacData[col.vaccine].carryOver = valNum;
        if (col.field === 'allocation') facilityVacData[col.vaccine].allocation = valNum;
        if (col.field === 'distributed') facilityVacData[col.vaccine].taken = valNum;
        if (col.field === 'balance') facilityVacData[col.vaccine].remaining = valNum;
      }

      // Convert to ParsedAllocationRows
      for (const [vacName, data] of Object.entries(facilityVacData)) {
        // If remaining is 0 and no balance was provided, calculate: (carryOver + allocation) - taken
        let finalRem = data.remaining;
        if (finalRem === 0 && (data.carryOver > 0 || data.allocation > 0)) {
          finalRem = Math.max(0, data.carryOver + data.allocation - data.taken);
        }
        // Total authorized allocation baseline includes carry-over + fresh allocation
        const totalAlloc = data.allocation > 0 || data.carryOver > 0 ? data.allocation + data.carryOver : 0;

        // Only add if there is at least some number or it's a known antigen
        parsedRows.push({
          facility: cleanFacilityName,
          vaccine: vacName,
          allocation: totalAlloc,
          carryOver: data.carryOver,
          taken: data.taken,
          remaining: finalRem,
          tabName: sheetName,
          district: detectedDistrict,
          subDistrict: rowSubDistrict || undefined,
          nest: defaultNest,
          cycle: defaultCycle
        });
      }
    } else {
      // Flat table fallback mode
      // Column A: Facility, Column B: Vaccine, Column C: Allocation, Column D: Taken
      const vacCell = String(row[1] || '').trim();
      const matchedVac = identifyAntigen(vacCell) || vacCell;
      const allocNum = parseFloat(row[2]) || 0;
      const takenNum = parseFloat(row[3]) || 0;
      const remNum = parseFloat(row[4]) || Math.max(0, allocNum - takenNum);

      if (matchedVac && (allocNum > 0 || takenNum > 0 || remNum > 0)) {
        antigensFoundSet.add(matchedVac);
        parsedRows.push({
          facility: cleanFacilityName,
          vaccine: matchedVac,
          allocation: allocNum,
          taken: takenNum,
          remaining: remNum,
          tabName: sheetName,
          district: detectedDistrict,
          subDistrict: rowSubDistrict || undefined,
          nest: defaultNest,
          cycle: defaultCycle
        });
      }
    }
  }

  // Count unique facilities found
  const uniqueFacilities = new Set(parsedRows.map(r => r.facility.toLowerCase().trim()));

  return {
    sheetName,
    isSubDistrictTab,
    detectedDistrict: detectedDistrict,
    detectedSubDistrict: detectedSubDistrict || (subDistrictsFoundSet.size > 0 ? Array.from(subDistrictsFoundSet)[0] : ''),
    subDistrictsFound: Array.from(subDistrictsFoundSet),
    isMatrixLayout,
    antigensFound: Array.from(antigensFoundSet),
    facilityCount: uniqueFacilities.size,
    rows: parsedRows,
    selectedForImport: true,
    rawPreviewRows: rawJson.slice(0, 8)
  };
}

/**
 * Scan all tabs inside an uploaded XLSX Workbook
 */
export function scanFullWorkbook(
  workbook: XLSX.WorkBook,
  defaultNest: string = 'Northern Nest',
  defaultCycle: string = 'September 2026'
): ScannedSheetTab[] {
  const tabs: ScannedSheetTab[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const rawJson: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: '' });
    if (rawJson.length < 2) continue;

    const scannedTab = scanWorksheet(sheetName, rawJson, defaultNest, defaultCycle);
    tabs.push(scannedTab);
  }

  return tabs;
}
