import { createHash, randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { assignedRoles } from '../shared/roles';
import { canManageCatalog } from '../shared/productCatalog';
import type { GeneralFacilityDirectoryState, ManagedGeneralFacility } from '../shared/generalFacilityDirectory';
import { normalizeGeneralFacilityName } from '../src/utils/generalFacility';
import { servedFacilityRecords } from './generalFacilityRecords';

export const baseGeneralFacilities: ManagedGeneralFacility[] = servedFacilityRecords.map(record => ({ ...record,
  key: `imported-${createHash('sha256').update(JSON.stringify([record.country, record.name, record.district, record.region, record.facilityType]
    .map(value => (value || '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')))).digest('hex').slice(0, 24)}` }));
export const emptyGeneralFacilityDirectory = (): GeneralFacilityDirectoryState => ({ revision: 1, added: [], removedKeys: [] });
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const identity = (record: { name: string; district?: string; region?: string }) =>
  [record.name, record.district || '', record.region || ''].map(normalizeGeneralFacilityName).join('|');
export function allGeneralFacilities(state: GeneralFacilityDirectoryState) { return [...baseGeneralFacilities, ...state.added]; }
export function activeGeneralFacilities(state: GeneralFacilityDirectoryState) {
  const removed = new Set(state.removedKeys);
  return allGeneralFacilities(state).filter(record => !removed.has(record.key));
}
export function excludedGeneralFacilities(state: GeneralFacilityDirectoryState) {
  const removed = new Set(state.removedKeys);
  return allGeneralFacilities(state).filter(record => removed.has(record.key));
}

/** Called inside the storage transaction; concurrent edits must reload before retrying. */
export function changeGeneralFacilityDirectory(state: GeneralFacilityDirectoryState, action: 'add' | 'remove' | 'restore', input: any, actor: string): GeneralFacilityDirectoryState {
  if (!input || input.revision !== state.revision) fail(409, 'The facility list changed. Reload it before saving.');
  let added = [...state.added], removedKeys = [...state.removedKeys];
  const all = allGeneralFacilities(state), active = activeGeneralFacilities(state);
  if (action === 'add') {
    const text = (field: string, required = false) => {
      const value = input[field] === undefined ? '' : input[field];
      if (typeof value !== 'string' || value.length > 160 || /[\r\n\x00-\x1f]/.test(value) || required && !value.trim()) {
        fail(400, `Enter a valid ${field === 'name' ? 'facility name' : field} (up to 160 characters).`);
      }
      return value.trim().replace(/\s+/g, ' ');
    };
    const name = text('name', true), district = text('district'), region = text('region'), facilityType = text('facilityType');
    const values = { name, district, region, facilityType };
    if (active.some(record => identity(record) === identity(values))) fail(409, 'This facility already exists in that district and region.');
    const previous = all.find(record => identity(record) === identity(values));
    if (previous) removedKeys = removedKeys.filter(key => key !== previous.key);
    else {
      if (state.added.length >= 2000) fail(400, 'The facility list is full. Contact an administrator to expand it.');
      const key = `added-${randomUUID()}`;
      added.push({ key, ...values, source: `general_facility_directory/${key}` });
    }
  } else {
    if (typeof input.key !== 'string' || !all.some(record => record.key === input.key)) fail(404, 'Facility not found. Reload the list.');
    if (action === 'remove') {
      if (removedKeys.includes(input.key)) fail(409, 'This facility has already been removed. Reload the list.');
      removedKeys.push(input.key);
    } else {
      const record = all.find(record => record.key === input.key)!;
      if (!removedKeys.includes(input.key)) fail(409, 'This facility is already on the list.');
      if (active.some(other => identity(other) === identity(record))) fail(409, 'An equivalent facility already exists. Reload the list.');
      removedKeys = removedKeys.filter(key => key !== input.key);
    }
  }
  const updated = { revision: state.revision + 1, added, removedKeys, updatedBy: actor, updatedAt: new Date().toISOString() };
  if (Buffer.byteLength(JSON.stringify(updated), 'utf8') > 750000) fail(400, 'The facility list is full. Contact an administrator to expand it.');
  return updated;
}

export function generalFacilityDirectoryHandlers({ read, change }: {
  read: () => Promise<GeneralFacilityDirectoryState>;
  change: (action: 'add' | 'remove' | 'restore', input: any, actor: string) => Promise<GeneralFacilityDirectoryState>;
}) {
  const canEdit = (res: any) => canManageCatalog(assignedRoles(res.locals.authUser));
  const response = (state: GeneralFacilityDirectoryState, res: any) => ({ revision: state.revision, facilities: activeGeneralFacilities(state), canEdit: canEdit(res) });
  const errorResponse = (res: any, error: any) => res.status([400, 404, 409].includes(error.status) ? error.status : 503)
    .json({ error: error.status ? error.message : 'Could not save or load the facility list. Please retry.' });
  const list: RequestHandler = async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(response(await read(), res)); } catch (error) { errorResponse(res, error); }
  };
  const write = (remove: boolean): RequestHandler => async (req, res) => {
    if (!canEdit(res)) return void res.status(403).json({ error: 'Administrator, Warehouse or Compliance access is required to edit facilities.' });
    try {
      if (!remove && req.body?.action !== undefined && !['add', 'restore'].includes(req.body.action)) fail(400, 'Invalid facility action.');
      const action = remove ? 'remove' : req.body?.action === 'restore' ? 'restore' : 'add';
      res.json(response(await change(action, req.body, res.locals.authUser.id), res));
    } catch (error) { errorResponse(res, error); }
  };
  return { list, save: write(false), remove: write(true) };
}
