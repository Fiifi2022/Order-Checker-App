import { commitVaccineOrder } from './vaccine-api.js';
// Everything the Vaccine tab needs from the backend lives here, so the contract is in one place.
// See API_CONTRACT.md. Change an endpoint or a field name below and the UI follows.

export const VACCINE_API = {
  facilities: '/api/vaccine/facilities',        // GET  -> facilities from the allocation blueprint
  verify: '/api/verify',                        // POST -> audit (same route as the General tab)
  commit: '/api/vaccine/allocations/commit',    // POST -> deduct a clean audit from the allocation
};

// Routes tried, in order, when looking for the facility list. The first one that answers with
// facilities is remembered, so this only probes once per backend.
export const FACILITY_ROUTES = [
  '/api/vaccine/companion/facilities', // authoritative allocation-cycle facility records
  '/api/vaccine/blueprint-districts',           // the route the portal's Vaccine Checker uses
  VACCINE_API.facilities,
  '/api/facilities',
  '/api/allocations/facilities',
  '/api/blueprints/facilities',
  '/api/allocation-blueprint',
  '/api/blueprints',
  '/api/blueprint',
];

export const AUDIT_SCOPE = 'vaccine_checker';

export const AUDIT_MODES = {
  both: 'whatsapp_and_fulfillment',
  fulfillment: 'fulfillment_only',
};

const text = (value) => String(value ?? '').trim();

const FACILITY_NAME_KEYS = ['facilityName', 'facility', 'healthFacility', 'facility_name'];
const LIST_KEYS = ['facilities', 'facilityList', 'sites'];              // children are facilities
const GROUP_KEYS = [...LIST_KEYS, 'entries', 'rows', 'children', 'items', 'results', 'data', 'districts',
  'subDistricts', 'sub_districts', 'blueprints', 'blueprint', 'worksheets', 'tabs', 'allocations'];

const pick = (node, keys) => { for (const key of keys) { const v = text(node[key]); if (v) return v; } return ''; };

// Walks flat lists or facilities grouped under districts / worksheets / sub-districts.
function collect(node, ctx, out, depth) {
  if (node === null || node === undefined || depth > 8) return;
  if (Array.isArray(node)) { for (const child of node) collect(child, ctx, out, depth + 1); return; }
  if (typeof node === 'string') { if (ctx.list && text(node)) out.push({ name: text(node), ...ctx.meta }); return; }
  if (typeof node !== 'object') return;

  const meta = { ...ctx.meta };
  meta.nest = pick(node, ['nest', 'nestName']) || meta.nest || '';
  meta.district = pick(node, ['district', 'districtName']) || meta.district || '';
  meta.subDistrict = pick(node, ['subDistrict', 'sub_district']) || meta.subDistrict || '';
  meta.worksheet = pick(node, ['worksheet', 'worksheetTab', 'sheetTab', 'tab']) || meta.worksheet || '';

  const own = pick(node, FACILITY_NAME_KEYS) || (ctx.list ? pick(node, ['name', 'displayName', 'title']) : '');
  if (own) {
    out.push({ id: text(node.id ?? node.facilityId ?? node.allocationFacilityId), name: own, cycle: text(node.cycle ?? node.allocationCycle), ...meta });
    return;
  }

  // A group (district, worksheet, sub-district). Its own name labels the facilities beneath it.
  const groupName = pick(node, ['name', 'displayName', 'title']);
  if (groupName && !meta.district) meta.district = groupName;
  for (const key of GROUP_KEYS) {
    if (node[key] && typeof node[key] === 'object') {
      collect(node[key], { list: LIST_KEYS.includes(key) || ctx.list, meta }, out, depth + 1);
    }
  }
}

// Accepts [{ id, name, district }], [ 'Name' ], or facilities grouped under districts or worksheets.
export function normalizeFacilities(payload) {
  const found = [];
  const topLevelList = Array.isArray(payload);
  collect(payload, { list: topLevelList && payload.every((e) => typeof e === 'string' || e?.name), meta: {} }, found, 0);
  const seen = new Set();
  const facilities = [];
  for (const entry of found) {
    const meta = [entry.nest, entry.district, entry.subDistrict && entry.subDistrict !== 'General' ? entry.subDistrict : ''].filter(Boolean);
    // Never fabricate an identifier from labels: the backend cannot resolve it to an allocation record.
    const id = entry.id;
    const dedupeKey = id || `unresolved:${entry.name}|${entry.worksheet || ''}|${entry.district || ''}|${entry.subDistrict || ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    facilities.push({
      id, name: entry.name, district: meta.join(' \u2022 '),
      worksheet: entry.worksheet || '', subDistrict: entry.subDistrict || '', cycle: entry.cycle || '',
    });
  }
  return facilities.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.district.localeCompare(b.district));
}

// A short description of a response the reader could not use, so the problem can be reported.
export function describeShape(payload) {
  if (Array.isArray(payload)) return `a list of ${payload.length} item${payload.length === 1 ? '' : 's'}${payload[0] && typeof payload[0] === 'object' ? ` with fields ${Object.keys(payload[0]).slice(0, 8).join(', ')}` : ''}`;
  if (payload && typeof payload === 'object') {
    return `fields ${Object.keys(payload).slice(0, 8).map((k) => (Array.isArray(payload[k]) ? `${k} (${payload[k].length})` : k)).join(', ')}`;
  }
  return 'nothing usable';
}

// "Mpanya HC, Nkwanta" per line -> facilities. Used for the list the person types in themselves.
export function parseManualFacilities(raw) {
  return normalizeFacilities(String(raw ?? '').split('\n').map((line) => {
    const [name, ...rest] = line.split(',');
    return name.trim() ? { name: name.trim(), id: `manual:${name.trim().toLowerCase()}`, district: rest.join(',').trim() } : null;
  }).filter(Boolean));
}

const routeMissing = (error) => error?.status === 404 || /non-JSON/i.test(error?.message || '');

// Returns { facilities, route }. Throws an error with status 404 when no route has a list.
export async function loadFacilities(request) {
  const { facilityRoute } = await chrome.storage.local.get('facilityRoute');
  // Prefer the backend's canonical allocation-record endpoint over a stale custom or label-only list.
  const routes = [FACILITY_ROUTES[0], facilityRoute, ...FACILITY_ROUTES.slice(1)].filter((route, i, all) => route && all.indexOf(route) === i);
  let unreadable = null;
  for (const route of routes) {
    try {
      const payload = await request(route);
      const facilities = normalizeFacilities(payload);
      if (!facilities.length || !facilities.some((f) => f.id)) { unreadable ??= { route, shape: describeShape(payload) }; continue; }
      if (route !== facilityRoute) await chrome.storage.local.set({ facilityRoute: route });
      return { facilities, route };
    } catch (error) {
      if (!routeMissing(error)) throw error;
    }
  }
  const error = new Error(unreadable
    ? `${unreadable.route} answered, but no facilities were found in it. It contains ${unreadable.shape}.`
    : 'No facility list found on the backend.');
  error.status = 404;
  error.unreadable = unreadable;
  throw error;
}

export function vaccineAuditBody({ mode, facility, whatsapp, fulfillment, revision }) {
  const withWhatsapp = mode === 'both';
  return {
    whatsappMessage: withWhatsapp ? whatsapp : '',
    fulfillmentConfirmation: fulfillment,
    auditScope: AUDIT_SCOPE,
    auditMode: AUDIT_MODES[mode],
    facilityId: facility.id,
    facilityName: facility.name,
    ...(facility.cycle ? { allocationCycle: facility.cycle } : {}),
    // The audit itself never touches the allocation; the deduction is a separate, explicit step.
    deductAllocation: false,
    productCatalogRevision: revision,
    checkSource: 'companion_extension',
    checkId: `EXT-${crypto.randomUUID()}`,
  };
}

// Deducts a clean audit from the facility's allocation. Safe to retry: the backend should
// treat the same auditId as one deduction.
export async function commitAllocation(request, { audit }) {
  return commitVaccineOrder(request, audit);
}

// Reads the deduction summary whichever way the backend names its fields.
export function normalizeDeductions(payload) {
  const rows = payload?.transaction?.items ?? payload?.deductions ?? payload?.allocation?.deductions ?? payload?.items ?? [];
  const num = (value) => (value === undefined || value === null || value === '' ? null : Number(value));
  return rows.map((row) => ({
    name: text(row.vaccine ?? row.product ?? row.productName ?? row.name),
    before: num(row.remainingBefore ?? row.before ?? row.previous ?? row.allocated),
    deducted: num(row.currentOrder ?? row.deducted ?? row.quantity ?? row.used),
    after: num(row.remainingAfter ?? row.remaining ?? row.after ?? row.balance),
  })).filter((row) => row.name);
}
