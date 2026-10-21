import { normalizeGeneralFacilityName, type GeneralFacilityContext, type GeneralFacilityRecord } from '../src/utils/generalFacility';
import servedFacilities from './data/served-facilities.json';

// Bundled with the backend so this reference also works without Firestore or the original upload path.
export const servedFacilityRecords: readonly GeneralFacilityRecord[] = servedFacilities.records;

/** Read identity evidence only; allocation rows, balances and lifecycle are untouched. */
export function generalFacilityRecords(sheets: any[]): GeneralFacilityRecord[] {
  return sheets.flatMap(sheet => (Array.isArray(sheet.rows) ? sheet.rows : []).flatMap((row: any) => {
    if (!row || typeof row.facility !== 'string' || !row.facility.trim() || !row.id || !sheet.id) return [];
    const officialId = row.fsFacilityId || row.facilityId;
    const aliases = [
      ...(Array.isArray(row.verifiedAliases) ? row.verifiedAliases.filter((a: unknown) => typeof a === 'string') : []),
      ...(Array.isArray(row.aliases) ? row.aliases.filter((a: any) => a?.verified === true && typeof a.name === 'string').map((a: any) => a.name) : [])
    ];
    return [{ name: row.facility.trim(), ...(typeof officialId === 'string' && officialId.trim() ? { id: officialId.trim() } : {}),
      verifiedAliases: aliases, district: row.district || sheet.district || '', region: row.region || sheet.region || '',
      facilityType: row.facilityType || '', source: `vaccine_districts/${sheet.id}/rows/${row.id}` }];
  }));
}

/** Link directory records only through a shared full name/verified alias AND a known district.
 * A source row is provenance, never an invented official facility ID.
 */
export function mergeGeneralFacilityRecords(directory: readonly GeneralFacilityRecord[], saved: GeneralFacilityRecord[]): GeneralFacilityRecord[] {
  const normalize = normalizeGeneralFacilityName;
  const names = (record: GeneralFacilityRecord) => [record.name, ...(record.verifiedAliases || [])].map(normalize);
  const groups = new Map<number, GeneralFacilityRecord[]>();
  const separate: GeneralFacilityRecord[] = [];
  const directoryByName = new Map<string, number[]>();
  directory.forEach((entry, index) => {
    for (const name of names(entry)) directoryByName.set(name, [...(directoryByName.get(name) || []), index]);
  });
  for (const record of saved) {
    const possible = new Set(names(record).flatMap(name => directoryByName.get(name) || []));
    const candidates = [...possible].filter(index => {
      const entry = directory[index];
      return entry.district && record.district && normalize(entry.district) === normalize(record.district) &&
        (!entry.region || !record.region || normalize(entry.region) === normalize(record.region));
    });
    if (candidates.length !== 1) { separate.push(record); continue; }
    const index = candidates[0];
    groups.set(index, [...(groups.get(index) || []), record]);
  }
  const merged = directory.map((entry, index) => {
    const linked = groups.get(index);
    if (!linked?.length) return entry;
    const ids = new Set([entry.id, ...linked.map(record => record.id)].filter(Boolean));
    // Conflicting official identifiers stay separate and force review/mismatch.
    if (ids.size > 1) { separate.push(...linked); return entry; }
    const aliases = new Map([...(entry.verifiedAliases || []), ...linked.flatMap(record => [record.name, ...(record.verifiedAliases || [])])]
      .filter(alias => normalize(alias) !== normalize(entry.name)).map(alias => [normalize(alias), alias]));
    const id = [...ids][0];
    return { ...entry, ...(id ? { id } : {}), verifiedAliases: [...aliases.values()],
      sources: [...new Set([entry.source, ...(entry.sources || []), ...linked.flatMap(record => [record.source, ...(record.sources || [])])])] };
  });
  return [...merged, ...separate];
}

export async function readGeneralFacilityContext(read: () => Promise<any[]>, timeoutMs = 2500,
  directory: readonly GeneralFacilityRecord[] = servedFacilityRecords, excluded: readonly GeneralFacilityRecord[] = []): Promise<GeneralFacilityContext> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sheets = await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Facility records unavailable')), timeoutMs);
    })]);
    return { records: mergeGeneralFacilityRecords(directory, generalFacilityRecords(sheets).filter(record => !excluded.some(removed => {
      if (record.id && removed.id && record.id === removed.id) return true;
      const geographyAgrees = ['district', 'region'].every(field => !record[field] || !removed[field] || normalizeGeneralFacilityName(record[field]) === normalizeGeneralFacilityName(removed[field]));
      const removedNames = new Set([removed.name, ...(removed.verifiedAliases || [])].map(normalizeGeneralFacilityName));
      return geographyAgrees && [record.name, ...(record.verifiedAliases || [])].some(name => removedNames.has(normalizeGeneralFacilityName(name)));
    }))) };
  } catch {
    return { records: [...directory], lookupUnavailable: true };
  } finally { clearTimeout(timer); }
}
