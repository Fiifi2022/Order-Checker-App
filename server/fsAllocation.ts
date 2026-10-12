import { blueprintAllocationNumbers } from './blueprintConfirmation';
import { assertBlueprintActive, normalizeFacilityName } from './blueprintFacility';
import { matchExactVaccineName, normalizeProductName, CLINICAL_PAIRINGS } from './vaccineService';

const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 160) : '';
// Formatting tolerance only; strengths, presentations and pack sizes remain distinct.
export function normalizeFsProduct(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[µμ]g/g, 'mcg')
    .replace(/\bmillilit(?:er|re)s?\b/g, 'ml').replace(/\bmicrograms?\b/g, 'mcg').replace(/\bmilligrams?\b/g, 'mg')
    .replace(/(\d)\s*(ml|mcg|mg|g|iu|units?|doses?)\b/g, '$1 $2')
    .replace(/\d+(?:\.\d+)?/g, value => String(Number(value)))
    .replace(/[^\p{L}\p{N}.]+/gu, ' ').replace(/\.(?!\d)|(?<!\d)\./g, ' ')
    .trim().replace(/\s+/g, ' ');
}
export function activeFsFacilities(sheets: any[]) {
  return sheets.flatMap(sheet => (sheet.rows || []).flatMap((row: any) => {
    try { assertBlueprintActive(sheet, row); } catch { return []; }
    if (!row.facility || !row.id) return [];
    return [{ id: `${sheet.id}:${row.id}`, facilityName: row.facility, district: row.district || sheet.district || '',
      region: row.region || sheet.region || '', cycle: sheet.month || '', fsFacilityId: row.fsFacilityId || row.facilityId || '', sheet, row }];
  }));
}
const publicFacility = ({ sheet, row, ...facility }: any) => facility;
export function lookupFsAllocation(sheets: any[], input: any) {
  const all = activeFsFacilities(sheets);
  const fs = input.facility || {};
  const name = text(fs.name), id = text(fs.id), manual = text(input.manualFacilityId);
  if (!name && !id) return { status: 'no_facility', message: 'Select a facility in FS.', products: [] };
  let candidates = id ? all.filter(f => f.fsFacilityId === id) : [];
  // Unknown FS IDs are distinct from Blueprint IDs; name matching remains exact.
  if (!candidates.length) candidates = all.filter(f => name && [f.facilityName, f.row.subDistrict ? `${f.facilityName}, ${f.row.subDistrict}` : ''].some(alias => alias && normalizeFacilityName(alias) === normalizeFacilityName(name)));
  candidates = candidates.filter(f => (!text(fs.district) || !f.district || normalizeFacilityName(f.district) === normalizeFacilityName(fs.district)) &&
    (!text(fs.region) || !f.region || normalizeFacilityName(f.region) === normalizeFacilityName(fs.region)));
  for (const field of ['district', 'region'] as const) {
    const exact = candidates.filter(f => text(fs[field]) && normalizeFacilityName(f[field]) === normalizeFacilityName(fs[field]));
    if (exact.length) candidates = exact;
  }
  if (manual) candidates = candidates.filter(f => f.id === manual);
  if (!candidates.length) return { status: 'not_found', message: 'Facility not found in the current Allocation Blueprint.', products: [] };
  if (candidates.length !== 1) return { status: 'ambiguous', message: 'Multiple matching facilities. Select the facility and allocation cycle manually.', candidates: candidates.map(publicFacility), products: [] };
  const facility = candidates[0];
  const lookup = (product: any) => {
    const name = text(product.name), match = matchExactVaccineName(name);
    const keys = Object.keys(facility.row.vaccines || {});
    const exact = keys.filter(key => normalizeFsProduct(key) === normalizeFsProduct(name) || normalizeProductName(key) === normalizeProductName(name));
    const qualified = /\b(?:\d+\s*(?:ml|mcg|mg|dose|doses|valent)|pcv\s*\d+|rotarix|rotasiil|td|tt)\b/i;
    const matching = exact.length ? exact : match.confidence === 'high' && !qualified.test(name) ? keys.filter(key => !qualified.test(key) && matchExactVaccineName(key).canonical === match.canonical) : [];
    const base = { name, id: text(product.id), canonical: match.canonical, quantity: text(product.quantity) };
    if (!matching.length) return { ...base, allocationKey: '', balance: null, status: 'untracked', message: 'No allocation record for this product or presentation.' };
    if (matching.length > 1) throw Object.assign(new Error('Multiple allocation records match this product presentation. Manual review required.'), { status: 409 });
    const data = facility.row.vaccines[matching[0]] || {};
    const number = (v: any) => (typeof v === 'number' || typeof v === 'string') && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
    const allocation = number(data.allocation), carry = number(data.carryOver), distributed = number(data.distributed);
    const explicit = number(data.balance);
    const hasKnownValues = [explicit, allocation, carry, distributed].some(value => value !== null);
    const malformed = ['balance', 'allocation', 'carryOver', 'distributed'].some(key => data[key] !== null && data[key] !== undefined && String(data[key]).trim() !== '' && number(data[key]) === null);
    const balance = explicit !== null ? explicit : hasKnownValues && !malformed ? blueprintAllocationNumbers({ allocation: allocation ?? 0, carryOver: carry ?? 0, distributed: distributed ?? 0 }).remaining : null;
    if (balance === null || balance < 0) throw Object.assign(new Error(`Allocation balance unavailable for ${matching[0]}. Correct the Blueprint record before retrying.`), { status: 503 });
    return { ...base, canonical: match.confidence === 'high' ? match.canonical : matching[0], allocationKey: matching[0], balance, status: 'ok', message: '' };
  };
  const products = (Array.isArray(input.products) ? input.products : []).slice(0, 101).map(lookup);
  const companions = [...new Set(products.map(p => CLINICAL_PAIRINGS[p.canonical]?.accessoryCanonical).filter(Boolean))]
    .filter(name => !products.some(p => p.canonical === name)).map(name => ({ ...lookup({ name }), accompanying: true }));
  return { status: 'matched', message: '', facility: publicFacility(facility), products, companions, refreshedAt: new Date().toISOString() };
}
