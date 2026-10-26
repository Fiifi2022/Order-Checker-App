import { blueprintAllocationNumbers } from './blueprintConfirmation';
import { assertBlueprintActive, normalizeFacilityName } from './blueprintFacility';
import { matchExactVaccineName, normalizeProductName, CLINICAL_PAIRINGS } from './vaccineService';
import { servedFacilityRecords } from './generalFacilityRecords';

const directoryByName = new Map<string, typeof servedFacilityRecords[number][]>();
for (const record of servedFacilityRecords) {
  const key = normalizeFacilityName(record.name);
  directoryByName.set(key, [...(directoryByName.get(key) || []), record]);
}
const reportingWords = new Set('jan january feb february mar march apr april may jun june jul july aug august sep sept september oct october nov november dec december allocation allocations vaccine vaccines blueprint sheet cycle'.split(' '));
function facilityGeography(sheet: any, row: any) {
  const references = directoryByName.get(normalizeFacilityName(row.facility)) || [];
  const reference = references.length === 1 ? references[0] : undefined;
  const sheetDistrict = normalizeFacilityName(sheet.district), officialDistrict = normalizeFacilityName(reference?.district);
  const suffix = officialDistrict && sheetDistrict.startsWith(officialDistrict + ' ') ? sheetDistrict.slice(officialDistrict.length + 1).split(' ') : [];
  const reportingLabel = suffix.length > 0 && suffix.every(word => reportingWords.has(word) || /^(?:20\d{2}|\d{1,2})$/.test(word));
  const regionAgrees = !row.region && !sheet.region || !reference?.region || normalizeFacilityName(row.region || sheet.region) === normalizeFacilityName(reference.region);
  // Only repair a missing district or a bounded reporting title corroborated
  // by one existing directory record. Explicit row geography stays authoritative.
  const verifiedDistrict = !row.district && reference?.district && regionAgrees && (!sheetDistrict || reportingLabel) ? reference.district : '';
  const district = row.district || verifiedDistrict || sheet.district || '';
  const region = row.region || sheet.region || (reference && normalizeFacilityName(district) === officialDistrict ? reference.region : '') || '';
  return { district, region };
}

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
    if (!row.facility) return [];
    // Legacy sheets are also valid Blueprint sources. This is a read-only
    // selection reference, never a persisted row ID or deduction authorization.
    // Duplicate normalized names deliberately share a reference so a manual
    // selection cannot silently bypass the unique-match requirement.
    const reference = row.id || `legacy-name:${encodeURIComponent(normalizeFacilityName(row.facility))}`;
    return [{ id: `${sheet.id}:${reference}`, facilityName: row.facility, ...facilityGeography(sheet, row),
      cycle: sheet.month || '', fsFacilityId: row.fsFacilityId || row.facilityId || '', sheet, row }];
  }));
}
const publicFacility = ({ sheet, row, ...facility }: any) => ({ ...facility, sourceSheetId: sheet.id, sourceRowId: row.id || '' });
export function lookupFsAllocation(sheets: any[], input: any) {
  const all = activeFsFacilities(sheets);
  const fs = input.facility || {};
  const name = text(fs.name), id = text(fs.id), manual = text(input.manualFacilityId);
  const identifiedProducts = (Array.isArray(input.products) ? input.products : []).slice(0, 101).map((product: any) => {
    const match = matchExactVaccineName(text(product.name));
    return { name: text(product.name), canonical: match.canonical, balance: null, isVaccine: match.confidence === 'high' && !Object.values(CLINICAL_PAIRINGS).some(pair => pair.accessoryCanonical === match.canonical) };
  });
  if (!name && !id) return { status: 'no_facility', message: 'Select a facility in FS.', products: identifiedProducts };
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
  if (!candidates.length) return { status: 'not_found', message: 'Facility not found in the current Allocation Blueprint.', products: identifiedProducts };
  if (candidates.length !== 1) return { status: 'ambiguous', message: 'Multiple matching facilities. Select the facility and allocation cycle manually.', candidates: candidates.map(publicFacility), products: identifiedProducts };
  const facility = candidates[0];
  const lookup = (product: any) => {
    const name = text(product.name), match = matchExactVaccineName(name);
    const keys = Object.keys(facility.row.vaccines || {});
    const exact = keys.filter(key => normalizeFsProduct(key) === normalizeFsProduct(name) || normalizeProductName(key) === normalizeProductName(name));
    // TD is the Blueprint's existing antigen column and an explicit catalog
    // alias of DT. It is not a strength/presentation qualifier.
    const qualified = /\b(?:\d+\s*(?:ml|mcg|mg|dose|doses|valent)|pcv\s*\d+|rotarix|rotasiil)\b/i;
    const matching = exact.length ? exact : match.confidence === 'high' && !qualified.test(name) ? keys.filter(key => !qualified.test(key) && matchExactVaccineName(key).canonical === match.canonical) : [];
    const base = { name, id: text(product.id), canonical: match.canonical, quantity: text(product.quantity) };
    if (!matching.length) return { ...base, allocationKey: '', balance: null, status: 'untracked', isVaccine: match.confidence === 'high' && !Object.values(CLINICAL_PAIRINGS).some(pair => pair.accessoryCanonical === match.canonical), message: match.confidence === 'high' ? 'No allocation found for this vaccine or presentation.' : 'Vaccine not found in the product repository.' };
    if (matching.length > 1) throw Object.assign(new Error('Multiple allocation records match this product presentation. Manual review required.'), { status: 409 });
    const data = facility.row.vaccines[matching[0]] || {};
    const number = (v: any) => (typeof v === 'number' || typeof v === 'string') && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
    const allocation = number(data.allocation), carry = number(data.carryOver), distributed = number(data.distributed);
    const explicit = number(data.balance);
    const hasKnownValues = [explicit, allocation, carry, distributed].some(value => value !== null);
    const malformed = ['balance', 'allocation', 'carryOver', 'distributed'].some(key => data[key] !== null && data[key] !== undefined && String(data[key]).trim() !== '' && number(data[key]) === null);
    const balance = explicit !== null ? explicit : hasKnownValues && !malformed ? blueprintAllocationNumbers({ allocation: allocation ?? 0, carryOver: carry ?? 0, distributed: distributed ?? 0 }).remaining : null;
    if (balance === null || balance < 0) throw Object.assign(new Error(`Allocation balance unavailable for ${matching[0]}. Correct the Blueprint record before retrying.`), { status: 503 });
    return { ...base, canonical: match.confidence === 'high' ? match.canonical : matching[0], allocationKey: matching[0], balance,
      allocated: allocation, carryOver: carry, distributed, updatedAt: data.updatedAt || facility.row.updatedAt || facility.sheet.updatedAt || null,
      isVaccine: match.confidence === 'high' && !Object.values(CLINICAL_PAIRINGS).some(pair => pair.accessoryCanonical === match.canonical), status: 'ok', message: '' };
  };
  const products = (Array.isArray(input.products) ? input.products : []).slice(0, 101).map(lookup);
  const companions = [...new Set(products.map(p => CLINICAL_PAIRINGS[p.canonical]?.accessoryCanonical).filter(Boolean))]
    .filter(name => !products.some(p => p.canonical === name)).map(name => ({ ...lookup({ name }), accompanying: true }));
  return { status: 'matched', message: '', facility: publicFacility(facility), products, companions, refreshedAt: new Date().toISOString() };
}
