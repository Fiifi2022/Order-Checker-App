import type { RequestHandler } from 'express';
import { assertBlueprintActive, resolveBlueprintFacility } from './blueprintFacility';

/** Read quantities from one saved row, without requiring a product catalogue,
 * projecting allocation records, or authorizing a deduction. Blank is unknown. */
export function blueprintFacilityQuantities(sheet: any, selection: any) {
  const { row } = resolveBlueprintFacility([sheet], {
    facilityName: selection.name, sheetId: sheet.id, rowId: selection.rowId, cycle: selection.cycle,
  });
  assertBlueprintActive(sheet, row);
  const number = (value: any) => (typeof value === 'number' || typeof value === 'string') && String(value).trim() && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const products = Object.entries(row.vaccines || {}).map(([name, raw]) => {
    const data: any = raw || {};
    const allocated = number(data.allocation), carryOver = number(data.carryOver), taken = number(data.distributed);
    const malformed = ['allocation', 'carryOver', 'distributed', 'balance'].some(key => data[key] != null && String(data[key]).trim() !== '' && number(data[key]) === null);
    const explicit = number(data.balance);
    const available = malformed ? null : explicit !== null ? explicit : [allocated, carryOver, taken].some(value => value !== null)
      ? Math.max(0, (allocated ?? 0) + (carryOver ?? 0) - (taken ?? 0)) : null;
    return { name, allocated, carryOver, taken, available, status: available === null ? 'unavailable' : 'ok' };
  });
  return { sourceSheetId: sheet.id, sourceRowId: row.id || '', facilityName: row.facility, cycle: sheet.month || '', products };
}

export function facilityQuantitiesHandler(read: (id: string) => Promise<any | null>): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const id = req.params.id;
    const { name, rowId, cycle } = req.query;
    if (typeof id !== 'string' || !id || id.length > 200 || /[\/\x00-\x1f]/.test(id) ||
        typeof name !== 'string' || !name.trim() || name.length > 160 ||
        (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > 200)) ||
        (cycle !== undefined && (typeof cycle !== 'string' || cycle.length > 160))) {
      res.status(400).json({ error: 'Choose a valid Blueprint facility and allocation cycle.' }); return;
    }
    try {
      const sheet = await read(id);
      if (!sheet) { res.status(404).json({ error: 'This allocation sheet no longer exists. Reload the facility list.' }); return; }
      const result = blueprintFacilityQuantities({ ...sheet, id }, { name, rowId, cycle });
      res.json({ ...result, checkedAt: new Date().toISOString() });
    } catch (error: any) {
      const selectionError = error.candidateCount !== undefined || /inactive/.test(error.message);
      res.status(selectionError ? 409 : 503).json({ error: selectionError ? error.message : 'Blueprint quantities could not be refreshed. Please retry.' });
    }
  };
}

/** A fresh document read for the visible sheet. Never serves an in-memory balance. */
export function currentBlueprintHandler(read: (id: string) => Promise<any | null>): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const id = req.params.id;
    if (typeof id !== 'string' || !id || id.length > 200 || /[\/\x00-\x1f]/.test(id)) {
      res.status(400).json({ error: 'Invalid allocation sheet.' }); return;
    }
    try {
      const sheet = await read(id);
      if (!sheet) { res.status(404).json({ error: 'This allocation sheet no longer exists. Reload the sheet list.' }); return; }
      res.json({ sheet: { ...sheet, id }, checkedAt: new Date().toISOString() });
    } catch { res.status(503).json({ error: 'Live allocation update unavailable. Displayed balances have not been refreshed.' }); }
  };
}
