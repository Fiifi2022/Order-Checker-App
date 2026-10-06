export type BlueprintPasteAlignment = 'auto' | 'from_start' | 'from_facility' | 'alloc_only';

export interface BlueprintPasteRow {
  id: string;
  processing: string;
  completed: string;
  facility: string;
  deliverySite?: string;
  subDistrict: string;
  vaccines: Record<string, { carryOver: number | ''; allocation: number | ''; distributed: number | ''; balance: number | '' }>;
}

export interface BlueprintPasteResult {
  rows: BlueprintPasteRow[];
  detectedAlignment: string;
  detectedRowCount: number;
  detectedColCount: number;
  hasHeaders: boolean;
  skippedHeaderRows: number;
  errors: string[];
}

export interface BlueprintFileImportResult {
  sourceRowIndexes?: number[];
  sourceColumnIndexes?: (number | null)[];
  rows: BlueprintPasteRow[];
  products: string[];
  district?: string;
  month?: string;
  errors: string[];
}

const normalizeLabel = (value: string) => value
  .toLowerCase()
  .replace(/\b(vaccines?|vials?)\b/g, '')
  .replace(/[^a-z0-9]+/g, '')
  .trim();

const productAliases: Record<string, string> = {
  bopv: 'opv', oralpolio: 'opv', oralpoliovaccine: 'opv',
  measlesrubella: 'mr', measlesrubellavaccine: 'mr',
  yellowfever: 'yf', yellowfevervaccine: 'yf',
  rotavirus: 'rota', rotavirusvaccine: 'rota',
  meninga: 'mena', meningococcal: 'mena', meningococcalavaccine: 'mena',
  diphtheriatetanus: 'td', tetanusdiphtheria: 'td',
  soloshot005ml: 'soloshot005ml', soloshot05ml: 'soloshot05ml',
  syringeandneedle2ml: 'syringeandneedle2ml', syringeandneedle5ml: 'syringeandneedle5ml'
};

const productKey = (value: string) => {
  const normalized = normalizeLabel(value);
  return productAliases[normalized] || normalized;
};

const productHeaderKey = (value: string) => productKey(value.replace(/\b(carry[- ]?over|allocation|distributed|balance)\b/i, '').trim());

/** Parse Excel/Sheets TSV while preserving empty cells and blank rows. */
export function parseClipboardTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let atCellStart = true;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
      continue;
    }
    if (char === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (char === '"' && quoted) {
      quoted = false;
      continue;
    }
    if (!quoted && char === '\t') {
      row.push(cell.trim());
      cell = '';
      atCellStart = true;
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      atCellStart = true;
      continue;
    }
    cell += char;
    atCellStart = false;
  }
  if (cell.length > 0 || row.length > 0 || rows.length === 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  // A final newline is the normal TSV terminator, not an extra selected row.
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

const isBlankRow = (row: string[]) => row.every(value => value.trim() === '');
const hasLabel = (row: string[], labels: string[]) => row.some(cell => labels.includes(normalizeLabel(cell)));

function findHeaderRow(rows: string[][]): number {
  const scan = Math.min(rows.length, 12);
  for (let i = 0; i < scan; i++) {
    const row = rows[i];
    const base = row.slice(0, 5).map(normalizeLabel);
    const facilityAt = base.indexOf('facility');
    const hasDeliverySite = base.includes('deliverysite');
    if ((facilityAt === 2 || (facilityAt === 2 && hasDeliverySite)) &&
      (base.includes('processing') || base.includes('startdate') || base.includes('completed'))) return i;
    if (facilityAt === 0 && row.length > 1) return i;
  }
  return -1;
}

function findDataStart(rows: string[][], headerRow: number, facilityColumn: number): number {
  if (headerRow < 0) return 0;
  let cursor = headerRow + 1;
  while (cursor < rows.length) {
    const row = rows[cursor];
    const looksLikeSubheader = hasLabel(row, ['carryover', 'allocation', 'distributed', 'balance']) &&
      ['carryover', 'allocation', 'distributed', 'balance'].filter(label => row.some(cell => normalizeLabel(cell) === label)).length >= 2;
    const containsQuantity = row.some(cell => {
      const normalized = cell.trim().replace(/,/g, '').replace(/^\((.*)\)$/, '-$1');
      return normalized !== '' && Number.isFinite(Number(normalized));
    });
    const productHeader = isBlankRow(row.slice(0, facilityColumn)) &&
      row.slice(facilityColumn + 1).some(cell => cell.trim() !== '') && !containsQuantity;
    if (looksLikeSubheader || productHeader || isBlankRow(row)) {
      cursor++;
      continue;
    }
    return cursor;
  }
  return cursor;
}

export function stripBlueprintHeaderRows(rows: string[][]): string[][] {
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) return rows;
  const base = rows[headerRow].slice(0, 4).map(normalizeLabel);
  const facilityColumn = base.indexOf('facility');
  return rows.slice(findDataStart(rows, headerRow, facilityColumn));
}

function parseQuantity(value: string, excelRow: number, excelCol: number, errors: string[]): number | '' {
  const normalized = value.trim().replace(/,/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!normalized || normalized === '-' || normalized === '—') return '';
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    errors.push(`Row ${excelRow}, column ${excelCol}: “${value}” is not a number. No rows were applied.`);
    return '';
  }
  return parsed;
}

function toDateText(value: string): string {
  const serial = Number(value);
  if (!value.trim() || !Number.isFinite(serial) || serial < 20000 || serial > 80000) return value.trim();
  const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  return date.toISOString().slice(0, 10);
}

/** Parse a saved Blueprint workbook/CSV; requires labelled columns to prevent shifted data. */
export function parseBlueprintFile(inputRows: unknown[][]): BlueprintFileImportResult {
  const rows = inputRows.map(row => (row || []).map(value => value == null ? '' : String(value).trim()));
  const error = (message: string): BlueprintFileImportResult => ({ rows: [], products: [], errors: [message] });
  if (!rows.length || rows.every(isBlankRow)) return error('The selected file has no data.');

  let headerRow = -1;
  let prefix = 0;
  let facilityIndexFound = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const labels = rows[i].map(normalizeLabel);
    const facilityIndex = labels.indexOf('facility');
    const hasDateOrCompletion = labels.some(label => ['processing', 'processingdate', 'startdate', 'completed', 'completiondate'].includes(label));
    if ((facilityIndex === 2 && hasDateOrCompletion) || facilityIndex === 0) {
      headerRow = i;
      facilityIndexFound = facilityIndex;
      prefix = facilityIndex === 2 ? (labels.includes('deliverysite') ? (labels.includes('subdistrict') ? 5 : 4) : 3) : (labels.includes('deliverysite') ? (labels.includes('subdistrict') ? 3 : 2) : 1);
      break;
    }
  }
  if (headerRow < 0) return error('Could not find the Blueprint headings. Include Processing, Completed, Facility, and the product columns.');

  let subheaderRow = -1;
  for (let i = headerRow + 1; i < Math.min(rows.length, headerRow + 6); i++) {
    const labels = rows[i].map(normalizeLabel);
    if (['carryover', 'allocation', 'distributed', 'balance'].filter(label => labels.includes(label)).length >= 2) { subheaderRow = i; break; }
  }
  if (subheaderRow < 0) {
    // Also accept a flat export where each heading is labelled, e.g. “BCG Allocation”.
    const header = rows[headerRow];
    const width = Math.max(...rows.map(row => row.length));
    const groups: Array<{ name: string; labels: string[] }> = [];
    for (let col = prefix; col < width; col += 4) {
      const cells = header.slice(col, col + 4);
      const names = cells.map(value => value.replace(/\b(carry[- ]?over|allocation|distributed|balance)\b/i, '').trim());
      const labels = cells.map(value => {
        const match = value.match(/(carry[- ]?over|allocation|distributed|balance)\s*$/i);
        return match ? normalizeLabel(match[1]) : '';
      });
      if (!names[0] || names.some(name => productKey(name) !== productKey(names[0])) || labels.some((label, index) => label !== ['carryover', 'allocation', 'distributed', 'balance'][index])) {
        return error('Could not safely map this flat table. Each product needs labelled Carry-over, Allocation, Distributed, and Balance columns in that order.');
      }
      groups.push({ name: names[0], labels });
    }
    if (!groups.length) return error('Could not identify product columns in this file.');
    const productRow = Array(prefix).fill('');
    const subheader = Array(prefix).fill('');
    groups.forEach(group => {
      productRow.push(group.name, '', '', '');
      subheader.push('Carry-over', 'Allocation', 'Distributed', 'Balance');
    });
    const normalized = [
      ...rows.slice(0, headerRow + 1),
      productRow,
      subheader,
      ...rows.slice(headerRow + 1)
    ];
    const parsed = parseBlueprintFile(normalized);
    return { ...parsed, sourceRowIndexes: parsed.sourceRowIndexes?.map(index => index - 2) };
  }

  const width = Math.max(...rows.map(row => row.length));
  const productWidth = width - prefix;
  if (productWidth <= 0 || productWidth % 4 !== 0) return error(`The product columns do not line up with the ${prefix}-column facility section. No data was imported.`);
  const expectedSubcolumns = ['carryover', 'allocation', 'distributed', 'balance'];
  for (let col = prefix; col < width; col += 4) {
    const found = rows[subheaderRow].slice(col, col + 4).map(normalizeLabel);
    if (expectedSubcolumns.some((label, offset) => found[offset] !== label)) {
      return error(`Product subcolumns at column ${col + 1} must be Carry-over, Allocation, Distributed, Balance in that order. No data was imported.`);
    }
  }
  const products: string[] = [];
  for (let col = prefix; col < width; col += 4) {
    const name = rows.slice(headerRow + 1, subheaderRow).map(row => row[col]).find(value => value && !['carryover', 'allocation', 'distributed', 'balance'].includes(normalizeLabel(value))) || '';
    if (!name) return error(`A product name is missing above column ${col + 1}. No data was imported.`);
    if (products.some(product => productKey(product) === productKey(name))) return error(`The product “${name}” appears more than once. No data was imported.`);
    products.push(name);
  }

  const title = rows.slice(0, headerRow).flat().find(value => value && /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(value));
  let district: string | undefined;
  let month: string | undefined;
  const titleMatch = title?.match(/^(.*?)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s*$/i);
  if (titleMatch) { district = titleMatch[1].trim(); month = `${titleMatch[2]} ${titleMatch[3]}`; }

  const errors: string[] = [];
  const sourceRowIndexes: number[] = [];
  const result = rows.slice(subheaderRow + 1).flatMap((raw, rowIndex) => {
    if (isBlankRow(raw)) return [];
    const facility = raw[facilityIndexFound] || '';
    const fileRow = subheaderRow + rowIndex + 2;
    sourceRowIndexes.push(fileRow - 1);
    if (!facility) errors.push(`Row ${fileRow} has data but no facility name.`);
    const vaccines: BlueprintPasteRow['vaccines'] = {};
    products.forEach((product, productIndex) => {
      const base = prefix + productIndex * 4;
      const values = [0, 1, 2].map(offset => {
        const source = raw[base + offset] || '';
        const value = source.replace(/,/g, '').replace(/^\((.*)\)$/, '-$1');
        if (!value || value === '-' || value === '—') return '' as const;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          errors.push(`Row ${fileRow}, column ${base + offset + 1}: “${source}” is not a number.`);
          return '' as const;
        }
        return parsed;
      });
      const [carryOver, allocation, distributed] = values;
      vaccines[product] = { carryOver, allocation, distributed,
        balance: carryOver === '' && allocation === '' && distributed === '' ? '' : (Number(carryOver) || 0) + (Number(allocation) || 0) - (Number(distributed) || 0) };
    });
    return [{ id: `bp_import_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`,
      processing: facilityIndexFound === 2 ? toDateText(raw[0] || '') : '', completed: facilityIndexFound === 2 ? toDateText(raw[1] || '') : '', facility,
      ...(facilityIndexFound === 2 && prefix >= 4 ? { deliverySite: raw[prefix - 1] || '' } : facilityIndexFound === 0 && prefix >= 2 ? { deliverySite: raw[prefix - 1] || '' } : {}),
      subDistrict: facilityIndexFound === 2 && prefix >= 5 ? raw[3] || '' : facilityIndexFound === 0 && prefix >= 3 ? raw[1] || '' : '', vaccines }];
  });
  if (!result.length && !errors.length) errors.push('No facility rows were found below the Blueprint headings.');
  return { rows: errors.length ? [] : result, products: errors.length ? [] : products, district, month, errors, sourceRowIndexes,
    sourceColumnIndexes: [facilityIndexFound === 2 ? 0 : null, facilityIndexFound === 2 ? 1 : null, facilityIndexFound,
      prefix - facilityIndexFound >= 3 ? facilityIndexFound + 1 : null,
      prefix - facilityIndexFound >= 2 ? prefix - 1 : null,
      ...Array.from({ length: products.length * 4 }, (_, index) => prefix + index)] };
}

/**
 * Parse a pasted allocation range conservatively. Only known Blueprint layouts are
 * accepted, blank rows stay in place, and malformed quantities block the import.
 */
export function parseBlueprintPaste(
  text: string,
  products: string[],
  forcedAlignment: BlueprintPasteAlignment = 'auto',
  skipHeaderRow = false
): BlueprintPasteResult {
  const rawRows = parseClipboardTsv(text);
  const emptyResult = (colCount = 0): BlueprintPasteResult => ({
    rows: [], detectedAlignment: 'Unrecognized layout', detectedRowCount: 0,
    detectedColCount: colCount, hasHeaders: false, skippedHeaderRows: 0, errors: []
  });
  if (!rawRows.length || rawRows.every(isBlankRow)) return emptyResult();

  const headerRow = findHeaderRow(rawRows);
  const hasHeaders = headerRow >= 0 || skipHeaderRow;
  const headerBase = headerRow >= 0 ? rawRows[headerRow].slice(0, 5).map(normalizeLabel) : [];
  const headerFacilityColumn = headerBase.indexOf('facility');
  const headerPrefix = headerFacilityColumn === 2
    ? (headerBase.includes('deliverysite') ? (headerBase.includes('subdistrict') ? 5 : 4) : 3)
    : headerFacilityColumn === 0
      ? (headerBase.includes('deliverysite') ? (headerBase.includes('subdistrict') ? 3 : 2) : 1)
      : null;
  let dataStart = headerRow >= 0
    ? findDataStart(rawRows, headerRow, headerFacilityColumn)
    : skipHeaderRow ? 1 : 0;
  if (skipHeaderRow && headerRow >= 0) dataStart = Math.max(dataStart, headerRow + 1);

  const sourceRows = rawRows.slice(dataStart);
  const dataWidths = sourceRows.filter(row => !isBlankRow(row)).map(row => row.length);
  const detectedColCount = Math.max(0, ...rawRows.map(row => row.length));
  const width = Math.max(0, ...dataWidths, detectedColCount && headerRow >= 0 ? detectedColCount : 0);
  const expectedFormats = [
    { mode: 'from_start' as const, prefix: 3, subcolumns: 4 },
    { mode: 'from_start' as const, prefix: 3, subcolumns: 3 },
    { mode: 'from_start' as const, prefix: 4, subcolumns: 4 },
    { mode: 'from_start' as const, prefix: 5, subcolumns: 4 },
    { mode: 'from_start' as const, prefix: 4, subcolumns: 3 },
    { mode: 'from_start' as const, prefix: 5, subcolumns: 3 },
    { mode: 'from_facility' as const, prefix: 1, subcolumns: 4 },
    { mode: 'from_facility' as const, prefix: 1, subcolumns: 3 },
    { mode: 'from_facility' as const, prefix: 2, subcolumns: 4 },
    { mode: 'from_facility' as const, prefix: 3, subcolumns: 4 },
    { mode: 'from_facility' as const, prefix: 2, subcolumns: 3 },
    { mode: 'from_facility' as const, prefix: 3, subcolumns: 3 },
    { mode: 'alloc_only' as const, prefix: 1, subcolumns: 1 },
    { mode: 'alloc_only' as const, prefix: 2, subcolumns: 1 }
  ];
  let candidates = expectedFormats.filter(format => width === format.prefix + products.length * format.subcolumns);
  if (forcedAlignment !== 'auto') candidates = candidates.filter(format => format.mode === forcedAlignment);
  if (forcedAlignment === 'auto' && headerPrefix) {
    candidates = candidates.filter(format => format.prefix === headerPrefix);
    const preferredMode = headerFacilityColumn === 2 ? 'from_start' : candidates.some(format => format.mode === 'from_facility') ? 'from_facility' : 'alloc_only';
    candidates = candidates.filter(format => format.mode === preferredMode);
  } else if (forcedAlignment === 'auto' && candidates.length > 1) {
    // A three-field full row and a facility-starting row with Sub-district + Delivery Site can have the same width.
    // In the absence of headings, retain the established full-row interpretation; callers can force from_facility.
    const established = candidates.filter(format => format.mode === 'from_start');
    const legacyFullRow = established.find(format => format.prefix === 3 && format.subcolumns === 4);
    if (legacyFullRow) candidates = [legacyFullRow];
    else if (established.length === 1) candidates = established;
  }

  if (candidates.length !== 1) {
    const required = forcedAlignment === 'from_start'
      ? `${3 + products.length * 4} columns (legacy full row), ${4 + products.length * 4} columns (with Delivery Site), or the matching 3-field product layout`
      : forcedAlignment === 'from_facility'
        ? `${1 + products.length * 4} columns (legacy facility plus products), ${2 + products.length * 4} columns (with Delivery Site), or the matching 3-field product layout`
        : forcedAlignment === 'alloc_only'
          ? `${1 + products.length} columns (facility plus allocations), optionally with a Delivery Site column`
          : `a recognized width for ${products.length} products`;
    return {
      ...emptyResult(detectedColCount), hasHeaders, skippedHeaderRows: dataStart,
      errors: [`Could not safely identify this range (${width} columns). Expected ${required}. Choose the matching alignment or copy the full table range.`]
    };
  }

  const format = candidates[0];
  const facilityColumn = format.mode === 'from_start' ? 2 : 0;
  const deliverySiteColumn = format.mode === 'from_start' ? (format.prefix >= 4 ? format.prefix - 1 : -1) : (format.prefix >= 2 ? format.prefix - 1 : -1);
  const subDistrictColumn = format.mode === 'from_start' && format.prefix >= 5 ? 3 : format.mode === 'from_facility' && format.prefix >= 3 ? 1 : -1;
  const headerRows = headerRow >= 0 ? rawRows.slice(headerRow + 1, dataStart) : [];
  const productHeaderCandidates = headerRow >= 0 ? [rawRows[headerRow], ...headerRows] : headerRows;
  const productHeaderRow = productHeaderCandidates.find(row => row.slice(format.prefix).some(cell => {
    const key = productHeaderKey(cell);
    return products.some(product => productKey(product) === key);
  }));
  const sourceProductOrder: string[] = [];
  if (productHeaderRow && format.subcolumns > 1) {
    let hasNamedProduct = false;
    for (let productIndex = 0; productIndex < products.length; productIndex++) {
      const groupStart = format.prefix + productIndex * format.subcolumns;
      const labels = productHeaderRow.slice(groupStart, groupStart + format.subcolumns).filter(Boolean);
      const label = labels.find(cell => products.some(product => productKey(product) === productHeaderKey(cell)));
      const normalizedLabel = label ? label.replace(/\b(carry[- ]?over|allocation|distributed|balance)\b/i, '').trim() : '';
      if (label) {
        sourceProductOrder.push(normalizedLabel);
        hasNamedProduct = true;
      } else if (labels.length > 0) {
        return {
          ...emptyResult(detectedColCount), hasHeaders, skippedHeaderRows: dataStart,
          errors: [`Could not match product heading “${labels[0]}” to a Blueprint column. No rows were applied.`]
        };
      } else {
        sourceProductOrder.push(products[productIndex]);
      }
    }
    const matched = sourceProductOrder.map(label => products.findIndex(product => productKey(product) === productKey(label)));
    if ((hasNamedProduct && matched.some(index => index < 0)) || new Set(matched).size !== products.length) {
      return {
        ...emptyResult(detectedColCount), hasHeaders, skippedHeaderRows: dataStart,
        errors: ['Product headings do not match the Blueprint columns. Check the product names before importing.']
      };
    }
  } else {
    sourceProductOrder.push(...products);
  }

  const errors: string[] = [];
  const makeId = () => `bp_pasted_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  const parsedRows = sourceRows.map((rawCols, rowIndex) => {
    const facility = (rawCols[facilityColumn] || '').trim();
    const hasRowData = !isBlankRow(rawCols);
    if (hasRowData && !facility) errors.push(`Row ${dataStart + rowIndex + 1} has allocation data but no facility name.`);
    const vaccines: BlueprintPasteRow['vaccines'] = {};
    products.forEach(product => {
      vaccines[product] = { carryOver: '', allocation: '', distributed: '', balance: '' };
    });

    for (let sourceIndex = 0; sourceIndex < products.length; sourceIndex++) {
      const targetProduct = sourceProductOrder[sourceIndex];
      const target = vaccines[targetProduct];
      if (format.subcolumns === 1) {
        target.allocation = parseQuantity(rawCols[format.prefix + sourceIndex] || '', dataStart + rowIndex + 1, format.prefix + sourceIndex + 1, errors);
      } else {
        const base = format.prefix + sourceIndex * format.subcolumns;
        target.carryOver = parseQuantity(rawCols[base] || '', dataStart + rowIndex + 1, base + 1, errors);
        target.allocation = parseQuantity(rawCols[base + 1] || '', dataStart + rowIndex + 1, base + 2, errors);
        target.distributed = parseQuantity(rawCols[base + 2] || '', dataStart + rowIndex + 1, base + 3, errors);
      }
      const c = Number(target.carryOver) || 0;
      const a = Number(target.allocation) || 0;
      const d = Number(target.distributed) || 0;
      target.balance = target.carryOver === '' && target.allocation === '' && target.distributed === '' ? '' : c + a - d;
    }

    return {
      id: makeId(),
      processing: format.mode === 'from_start' ? toDateText(rawCols[0] || '') : '',
      completed: format.mode === 'from_start' ? toDateText(rawCols[1] || '') : '',
      facility,
      ...(deliverySiteColumn >= 0 ? { deliverySite: (rawCols[deliverySiteColumn] || '').trim() } : {}),
      subDistrict: subDistrictColumn >= 0 ? (rawCols[subDistrictColumn] || '').trim() : '',
      vaccines
    };
  });

  const label = format.mode === 'from_start'
    ? `Full row (${format.subcolumns} columns per product)`
    : format.mode === 'from_facility'
      ? `Facility plus products (${format.subcolumns} columns per product)`
      : 'Facility plus allocations';
  return {
    rows: errors.length ? [] : parsedRows,
    detectedAlignment: label,
    detectedRowCount: parsedRows.length,
    detectedColCount,
    hasHeaders,
    skippedHeaderRows: dataStart,
    errors
  };
}
