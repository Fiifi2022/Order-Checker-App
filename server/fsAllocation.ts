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
// Existing Blueprint district abbreviation, corroborated by the facility
// directory and the MMD allocation import. Do not infer arbitrary initials.
const districtAliases = new Map([['mmd', 'Mamprugu Moagduri']]);
function normalizeFsDistrict(value: unknown) {
  const normalized = normalizeFacilityName(value);
  return normalizeFacilityName(districtAliases.get(normalized) || value);
}
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
  const savedDistrict = row.district || verifiedDistrict || sheet.district || '';
  const district = districtAliases.get(normalizeFacilityName(savedDistrict)) || savedDistrict;
  const region = row.region || sheet.region || (reference && normalizeFsDistrict(district) === officialDistrict ? reference.region : '') || '';
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
/** Show the actual active Blueprint rows, including facilities with no entered
 * vaccine quantities. Only an existing allocation record authorizes an audit. */
export function blueprintFacilityChoices(sheets:any[],allocations:any[]) {
  const rows=activeFsFacilities(sheets);
  const key=(sheetId:string,rowId:any,name:string)=>JSON.stringify([sheetId,rowId ? ['row',rowId] : ['name',normalizeFacilityName(name)]]);
  const counts=new Map<string,number>(),records=new Map<string,any[]>();
  for(const {sheet,row} of rows) {const id=key(sheet.id,row.id,row.facility);counts.set(id,(counts.get(id)||0)+1);}
  for(const record of allocations) {const id=key(record.sourceSheetId,record.sourceRowId,record.facilityName);records.set(id,[...(records.get(id)||[]),record]);}
  return rows.map(({sheet,row,...facility})=>{
    const id=key(sheet.id,row.id,row.facility),sameRows=counts.get(id)||0,matches=records.get(id)||[];
    const record=sameRows===1 && matches.length===1 ? matches[0] : undefined;
    return {...facility,id:record?.id || '',sourceSheetId:sheet.id,sourceRowId:row.id || '',
      allocationAvailable:!!record,allocationNotice:record ? '' : sameRows>1 || matches.length>1 ? 'Multiple Blueprint records need verification.' : 'No vaccine allocation record is set for this facility.'};
  });
}
const cycleMonths = ['january','february','march','april','may','june','july','august','september','october','november','december'];
function cycleNumber(value: string): number | null {
  const text = String(value || '').trim().toLowerCase();
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  if (iso) return Number(iso[1]) * 12 + Number(iso[2]) - 1;
  const named = /^([a-z]+)\s+(20\d{2})$/.exec(text);
  if (!named) return null;
  const month = cycleMonths.findIndex(name => name === named[1] || name.slice(0,3) === named[1] || name === 'september' && named[1] === 'sept');
  return month < 0 ? null : Number(named[2]) * 12 + month;
}

/** Resolve repeated monthly records only for the same facility and geography.
 * Future carry-over sheets must not compete with a cycle already in use.
 * Unknown cycle labels and same-cycle duplicates remain conflicts. */
function currentCycleCandidates(candidates: ReturnType<typeof activeFsFacilities>, now: Date) {
  if (!candidates.length) return candidates;
  const identities = new Set(candidates.map(row => JSON.stringify([row.facilityName,row.district,row.region].map(normalizeFacilityName))));
  if (identities.size !== 1) return candidates;
  const months = candidates.map(row => cycleNumber(row.cycle));
  if (months.some(month => month === null)) return candidates;
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const started = months.filter((month): month is number => month !== null && month <= current);
  if (!started.length) return [];
  const latest = Math.max(...started);
  return candidates.filter((_,index) => months[index] === latest);
}

export function lookupFsAllocation(sheets: any[], input: any, options: { automaticCycle?: boolean; now?: Date } = {}) {
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
  candidates = candidates.filter(f => (!text(fs.district) || !f.district || normalizeFsDistrict(f.district) === normalizeFsDistrict(fs.district)) &&
    (!text(fs.region) || !f.region || normalizeFacilityName(f.region) === normalizeFacilityName(fs.region)));
  for (const field of ['district', 'region'] as const) {
    const norm = field === 'district' ? normalizeFsDistrict : normalizeFacilityName;
    const exact = candidates.filter(f => text(fs[field]) && norm(f[field]) === norm(fs[field]));
    if (exact.length) candidates = exact;
  }
  const selectedCycle = text(input.allocationCycle);
  if (selectedCycle) {
    const period = cycleNumber(selectedCycle);
    candidates = candidates.filter(candidate => normalizeFacilityName(candidate.cycle) === normalizeFacilityName(selectedCycle) ||
      period !== null && cycleNumber(candidate.cycle) === period);
  } else if (options.automaticCycle && candidates.length) {
    candidates = currentCycleCandidates(candidates, options.now || new Date());
    if (!candidates.length) return { status: 'cycle_not_started', message: 'This facility has only future allocation cycles. No allocation is available yet.', products: identifiedProducts };
  } else if (manual) candidates = candidates.filter(f => f.id === manual);
  if (!candidates.length) return { status: 'not_found', message: selectedCycle ? `Facility not found in the ${selectedCycle} Allocation Blueprint.` : 'Facility not found in the current Allocation Blueprint.', products: identifiedProducts };
  if (candidates.length !== 1) return { status: 'ambiguous', message: options.automaticCycle
    ? 'Conflicting facility records remain in the allocation data. Check duplicate rows, facility geography, or cycle labels.'
    : 'Multiple matching facilities. Select the facility and allocation cycle manually.', candidates: candidates.map(publicFacility), products: identifiedProducts };
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
