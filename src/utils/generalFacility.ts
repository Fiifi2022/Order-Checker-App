import type { GeneralFieldResult } from './generalAuditTypes';

/** Trusted server-side records only. IDs belong to the source system, never to an inferred name. */
export interface GeneralFacilityRecord {
  id?: string;
  name: string;
  verifiedAliases?: string[];
  district?: string;
  region?: string;
  facilityType?: string;
  source: string;
  country?: string;
  sources?: string[];
}
export interface GeneralFacilityContext {
  records?: GeneralFacilityRecord[];
  lookupUnavailable?: boolean;
  /** Explicit aliases supplied by a trusted district reference, never inferred by AI. */
  districtAliases?: readonly { name: string; verifiedAliases: readonly string[] }[];
  aiSuggestion?: { customer: string; fulfillment: string; confidence: number };
}
export interface GeneralFacilityResult extends GeneralFieldResult {
  reason?: string;
  verification?: 'records' | 'normalized';
  customerFacilityId?: string;
  fulfillmentFacilityId?: string;
  evidence?: GeneralFacilityRecord[];
  aiSuggestion?: GeneralFacilityContext['aiSuggestion'];
  /** Name comparison is separate from choosing an authoritative dispatch identity. */
  identityStatus?: 'resolved' | 'unresolved';
  requiresDispatchConfirmation?: boolean;
}

const clean = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
export function normalizeGeneralDistrictName(value: string, context: GeneralFacilityContext = {}): string {
  const normalize = (name: string) => clean(name).replace(/\s+(?:municipal(?:ity)?|metropolitan(?: assembly)?|district(?: assembly)?)$/, '');
  const key = normalize(value);
  const aliases = (context.districtAliases || []).filter(record => [record.name, ...record.verifiedAliases].some(name => normalize(name) === key));
  return aliases.length === 1 ? normalize(aliases[0].name) : key;
}
export function normalizeGeneralFacilityName(value: string): string {
  return clean(value).replace(/\bc h p s\b/g, 'chps').replace(/\br h c\b/g, 'rhc')
    .replace(/\bd h d\b/g, 'dhd').replace(/\bh c\b/g, 'hc').replace(/\bh s p\b/g, 'hsp')
    .replace(/\bd h\b/g, 'dh').replace(/\bp c\b/g, 'pc')
    .replace(/\bcommunity based health planning (?:and )?services\b/g, 'chps')
    .replace(/\bchps compound\b/g, 'chps').replace(/\brch\b/g, 'rhc').replace(/\brhc\b/g, 'rural health centre')
    .replace(/\bhc\b/g, 'health centre').replace(/\b(?:hsp|hosp)\b/g, 'hospital')
    .replace(/\bdh\b/g, 'district hospital').replace(/\bpc\b/g, 'polyclinic')
    .replace(/\bdhd\b/g, 'district health directorate').replace(/\b(?:center|centere|cetre)\b/g, 'centre')
    .replace(/\bheath centre\b/g, 'health centre');
}
const typePattern = /\b(rural health centre|district health directorate|district hospital|health centre|medical centre|health post|hospital|polyclinic|clinic|chps)$/;
function parts(value: string) {
  const name = normalizeGeneralFacilityName(value), type = name.match(typePattern)?.[1] || '';
  return { name, type, locality: type ? name.slice(0, -type.length).trim() : name };
}
export const hasGeneralFacilityType = (value: string) => !!parts(value).type;
const rawType = '(?:community[- ]based health planning and services|rural health cent(?:re|er)|district health directorate|district hospital|health cent(?:re|er)|medical cent(?:re|er)|health post|c[. ]*h[. ]*p[. ]*s(?: compound)?|r[. ]*h[. ]*c|r[. ]*c[. ]*h|h[. /]*c|hsp|hosp(?:ital)?|dhd|dh|pc|polyclinic|clinic)';
const typedName = new RegExp(`^([\\p{L}][\\p{L}\\p{N}'’.-]*(?:[ \\t]+[\\p{L}\\p{N}][\\p{L}\\p{N}'’.-]*){0,7}?[ \\t-]+${rawType})(?=$|[^\\p{L}\\p{N}])`, 'iu');
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Independent source extraction; explicit labels are handled by the caller first. */
export function findGeneralFacilityNames(text: string, records: GeneralFacilityRecord[] = []): string[] {
  const found = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\s*(?:district|region|drop area|delivery\s*\/\s*drop area|orderer|contact|phone|notes?)\s*:/i.test(line)) continue;
    const plain = line.trim().replace(/^(?:[-*•]\s*)/, '');
    const lineNames = new Map<string, string>();
    const literalMentions: { name: string; start: number; end: number }[] = [];
    const add = (name: string) => { if (name.trim()) lineNames.set(normalizeGeneralFacilityName(name), name.trim().replace(/[.!]+$/, '')); };
    const direct = plain.replace(/^(?:good\s+(?:morning|afternoon|evening)|hello|hi|please|kindly)[,! .]*\s+/i, '').match(typedName);
    if (direct && !/^(?:i(?:['’]m)?|we(?:['’]re)?|this|here)\b/i.test(direct[1]) && !/\b(?:need|send|supply|request|order|please|kindly|deliver|from|for|to|at)\b/i.test(direct[1])) add(direct[1]);
    for (const match of plain.matchAll(/\b(?:in\s+charge\s+of|on\s+behalf\s+of|representing|this\s+is|we\s+are|i\s+am|from|at|to|for|facility(?:\s+is)?|supply|serving)\s+(?:the\s+)?/gi)) {
      const candidate = plain.slice(match.index! + match[0].length).match(typedName)?.[1];
      if (candidate && !/\b(?:need|send|request|please|kindly|deliver|from|for|to|at)\b/i.test(candidate)) add(candidate);
    }
    // Filter literal candidates before compiling patterns for the full served directory.
    const foldedLine = plain.toLowerCase().replace(/\s+/g, ' ');
    // Official names and verified aliases can also identify untyped names in prose.
    for (const record of records) for (const alias of [record.name, ...(record.verifiedAliases || [])]) {
      if (!foldedLine.includes(alias.toLowerCase().replace(/\s+/g, ' ')) || clean(alias).length < 4) continue;
      const expression = new RegExp(`(?<![\\p{L}\\p{N}-])${escape(alias).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
      for (const match of plain.matchAll(expression)) {
        literalMentions.push({ name: match[0], start: match.index!, end: match.index! + match[0].length });
        add(match[0]);
      }
    }
    // A single complete official mention can contain shorter typed or directory
    // names. Count its source span once; retain shorter names mentioned separately.
    for (const [normalized, name] of lineNames) {
      const occurrences = [...plain.matchAll(new RegExp(escape(name).replace(/\s+/g, '\\s+'), 'giu'))];
      const embedded = occurrences.length > 0 && occurrences.every(match => literalMentions.some(official =>
        official.start <= match.index! && official.end >= match.index! + match[0].length &&
        official.end - official.start > match[0].length && normalizeGeneralFacilityName(official.name) !== normalized));
      if (!embedded) found.set(normalized, name);
    }
  }
  return [...found.values()];
}

function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  return rows[a.length][b.length];
}
function similar(a: string, b: string) {
  if (!a || !b || a.length > 256 || b.length > 256) return false;
  return distance(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1);
}
/** Conservative typo tolerance for the name only. Distinct reference IDs,
 * geography, facility types and numeric site suffixes remain authoritative. */
export function generalFacilityNamesMatch(customer: string, fulfillment: string): boolean {
  if (customer === 'N/A' || fulfillment === 'N/A') return false;
  const a = parts(customer), b = parts(fulfillment);
  if (!a.locality || !b.locality || a.type !== b.type) return false;
  if (a.name === b.name) return true;
  if (!a.type || Math.min(a.locality.length, b.locality.length) < 5) return false;
  if ((a.locality.match(/\d+/g) || []).join('|') !== (b.locality.match(/\d+/g) || []).join('|')) return false;
  return distance(a.locality, b.locality) <= (Math.min(a.locality.length, b.locality.length) >= 10 ? 2 : 1);
}

/** Display names without exposing directory-selection ambiguity. */
export function generalFacilityDisplayStatus(facility: GeneralFacilityResult): GeneralFieldResult['status'] {
  return facility.status === 'review required' && generalFacilityNamesMatch(facility.whatsappValue, facility.fulfillmentValue) ? 'match' : facility.status;
}

function metadata(text: string, label: string) {
  return text.match(new RegExp(`^\\s*${label}\\s*[:=]\\s*([^\\n\\r]+)`, 'im'))?.[1].trim() || '';
}

// Cache stable reference vocabulary only, never orders or audit outcomes. Mutation
// signatures keep administrator edits and updated aliases visible immediately.
const referenceVocabulary = new WeakMap<GeneralFacilityRecord, { signature: string; names: string[]; district: string; region: string }>();
function vocabulary(record: GeneralFacilityRecord) {
  const signature = JSON.stringify([record.name, record.verifiedAliases, record.district, record.region]);
  let entry = referenceVocabulary.get(record);
  if (!entry || entry.signature !== signature) {
    entry = { signature, names: [record.name, ...(record.verifiedAliases || [])].map(normalizeGeneralFacilityName),
      district: normalizeGeneralDistrictName(record.district || ''), region: clean(record.region || '') };
    referenceVocabulary.set(record, entry);
  }
  return entry;
}

export function compareGeneralFacilities(customer: string, fulfillment: string, customerText: string, fulfillmentText: string,
  context: GeneralFacilityContext = {}): GeneralFacilityResult {
  const records = context.records || [];
  const namesFor = (name: string, text: string) => {
    const labelled = /^\s*(?:[-*•]\s*)?(?:name of (?:health )?facility|health facility|facility(?: name)?|hospital|clinic|delivery (?:facility|site)|destination)\s*[:=–—-]/im.test(text);
    if (labelled && name !== 'N/A') return [name];
    const mentions = findGeneralFacilityNames(text, records);
    if (mentions.length > 1) return mentions;
    if (mentions.length === 1 && records.some(record => [record.name, ...(record.verifiedAliases || [])].some(alias =>
      normalizeGeneralFacilityName(alias) === normalizeGeneralFacilityName(mentions[0]))) &&
      (name === 'N/A' || normalizeGeneralFacilityName(mentions[0]).includes(normalizeGeneralFacilityName(name)))) return mentions;
    return name === 'N/A' ? mentions : [name];
  };
  const customerNames = namesFor(customer, customerText);
  const systemNames = namesFor(fulfillment, fulfillmentText);
  const left = customerNames[0] || 'N/A', right = systemNames[0] || 'N/A';
  const base = { whatsappValue: customerNames.length > 1 ? customerNames.join(' / ') : left, fulfillmentValue: systemNames.length > 1 ? systemNames.join(' / ') : right };
  const result = (status: GeneralFacilityResult['status'], reason: string, extra: Partial<GeneralFacilityResult> = {}): GeneralFacilityResult => {
    const nameMatch = status === 'match' || status === 'review required' && customerNames.length === 1 && systemNames.length === 1 && generalFacilityNamesMatch(left, right);
    const identityResolved = status === 'match' && extra.verification === 'records';
    return { ...base, status: nameMatch ? 'match' : status, reason,
      ...extra, ...(nameMatch && !extra.verification ? { verification: 'normalized' as const } : {}),
      identityStatus: identityResolved ? 'resolved' : 'unresolved',
      requiresDispatchConfirmation: !identityResolved || !extra.fulfillmentFacilityId,
    };
  };
  if (customerNames.length > 1 || systemNames.length > 1) return result('review required', 'Multiple facilities appear in the source message. Verify the intended facility before dispatch.');
  if (left === 'N/A') return result('missing from customer request', 'No facility could be identified in the original customer order.');
  if (right === 'N/A') return result('not available in system entry', 'No facility could be identified in the Fulfilment Confirmation.');
  const a = parts(left), b = parts(right);
  if (a.type && !a.locality || b.type && !b.locality) return result('review required', 'A facility type alone does not identify the facility. Verify its complete name before dispatch.');
  const leftId = metadata(customerText, 'facility\\s+id'), rightId = metadata(fulfillmentText, 'facility\\s+id');
  const extra = { ...(leftId ? { customerFacilityId: leftId } : {}), ...(rightId ? { fulfillmentFacilityId: rightId } : {}) };
  if (leftId && rightId && leftId !== rightId) return result('mismatch', 'The facility identifiers are different.', extra);
  const names = new Map<string, GeneralFacilityRecord[]>();
  const ids = new Map<string, GeneralFacilityRecord[]>();
  for (const record of records) {
    for (const name of vocabulary(record).names) names.set(name, [...(names.get(name) || []), record]);
    if (record.id) ids.set(record.id, [...(ids.get(record.id) || []), record]);
  }
  const byName = (name: string) => names.get(name) || records.filter(record =>
    vocabulary(record).names.some(alias => generalFacilityNamesMatch(alias, name)));
  const candidates = (name: string, text: string, id: string) => {
    const district = normalizeGeneralDistrictName(metadata(text, 'district'), context), region = clean(metadata(text, 'region'));
    return byName(name).filter(record => (!id || record.id === id) &&
      (!district || !record.district || district === normalizeGeneralDistrictName(vocabulary(record).district, context)) &&
      (!region || !record.region || region === vocabulary(record).region));
  };
  const ac = candidates(a.name, customerText, leftId), bc = candidates(b.name, fulfillmentText, rightId);
  for (const [id, name, scoped] of [[leftId, a.name, ac], [rightId, b.name, bc]] as const) {
    const named = byName(name);
    if (id && ids.has(id) && named.length && named.every(record => record.id && record.id !== id)) {
      return result('mismatch', 'The supplied facility name belongs to a different official identifier.', { ...extra, evidence: named });
    }
    if (!scoped.length && named.length) return result('review required', 'The facility name exists in the directory, but its identifier, district or region does not agree. Verify before dispatch.', { ...extra, evidence: named });
  }

  // A duplicated record can occur in more than one allocation cycle. Only a real
  // source ID (or the same source path) can establish a single identity.
  const identity = (r: GeneralFacilityRecord) => r.id ? `id:${r.id}` : `source:${r.source}`;
  const unique = (list: GeneralFacilityRecord[]) => new Map(list.map(r => [identity(r), r]));
  const au = unique(ac), bu = unique(bc);
  const evidence = [...unique([...ac, ...bc]).values()];
  // A unique intersection resolves duplicates using the explicit source context.
  // Never select the first entry merely because its display name matches.
  const shared = [...au.keys()].filter(key => bu.has(key));
  if ((au.size > 1 || bu.size > 1) && shared.length === 1 && (au.size === 1 || bu.size === 1)) {
    const selected = bu.get(shared[0])!;
    return result('match', 'The Fulfilment System context identifies the matching facility.', {
      ...extra, ...(selected.id ? { customerFacilityId: selected.id, fulfillmentFacilityId: selected.id } : {}),
      verification: 'records', evidence: [selected],
    });
  }
  if ((au.size > 1 || bu.size > 1) && !shared.length &&
      (a.type && b.type && a.type !== b.type ||
       !generalFacilityNamesMatch(left, right) && !similar(a.locality, b.locality) && !similar(a.name, b.name))) {
    return result('mismatch', 'The facility names identify different locations or facility types.', { ...extra, evidence });
  }
  if (au.size > 1 || bu.size > 1) return result('review required', 'The name resolves to multiple facility records. Verify the facility ID, district and region.', { ...extra, evidence });
  if (au.size === 1 && bu.size === 1) {
    const ar = ac[0], br = bc[0];
    const ids = { ...extra, ...(ar.id ? { customerFacilityId: ar.id } : {}), ...(br.id ? { fulfillmentFacilityId: br.id } : {}) };
    if (identity(ar) === identity(br)) return result('match', 'Both names resolve to the same facility reference record or verified alias.', { ...ids, verification: 'records', evidence });
    const differentIds = ar.id && br.id && ar.id !== br.id;
    const differentGeography = ['district', 'region'].some(field => ar[field] && br[field] && (field === 'district' ? normalizeGeneralDistrictName(ar[field], context) !== normalizeGeneralDistrictName(br[field], context) : clean(ar[field]) !== clean(br[field])));
    const possibleName = a.locality === b.locality || similar(a.name, b.name) ||
      similar(normalizeGeneralFacilityName(clean(left).replace(/\brch\b/g, 'rhc')), normalizeGeneralFacilityName(clean(right).replace(/\brch\b/g, 'rhc')));
    if (!differentIds && !differentGeography && !(a.type && b.type && a.type !== b.type) && possibleName) {
      return result('review required', 'Similar names appear in separate reference records, but no shared official ID or verified alias confirms that they are the same facility.', { ...ids, evidence });
    }
    return result('mismatch', 'The names resolve to different facility records.', { ...ids, evidence });
  }
  // Explicit IDs cannot be used to force a name onto an unrelated official record.
  for (const [id, name] of [[leftId, a.name], [rightId, b.name]]) {
    if (id && ids.has(id) && !byName(name).some(r => r.id === id)) {
      return result('review required', 'A supplied facility ID does not agree with the name or verified aliases in its record. Verify before dispatch.', { ...extra, evidence });
    }
  }
  const siteNumbers = (value: string) => (value.match(/\d+/g) || []).join('|');
  if (a.type && a.type === b.type && siteNumbers(a.locality) !== siteNumbers(b.locality) && a.locality.replace(/\d+/g, '#') === b.locality.replace(/\d+/g, '#')) {
    return result('mismatch', 'The facility names identify different numbered sites.', { ...extra, evidence });
  }
  if (a.type && b.type && a.type !== b.type) return result('mismatch', 'The names specify different facility types; they cannot be assumed to be the same facility.', { ...extra, evidence });
  const geographyConflict = ['district', 'region'].some(label => {
    const x = metadata(customerText, label), y = metadata(fulfillmentText, label);
    return x && y && (label === 'district' ? normalizeGeneralDistrictName(x, context) !== normalizeGeneralDistrictName(y, context) : clean(x) !== clean(y));
  });
  if (geographyConflict) return result('review required', 'The district or region differs. Verify the intended facility using its official identifier.', { ...extra, evidence });
  if (a.name === b.name && !(leftId || rightId)) return result('match', 'The complete facility names match after standard abbreviation and formatting normalization.', { verification: 'normalized' });
  const suggestion = context.aiSuggestion;
  const aiPossible = suggestion && suggestion.confidence >= 0.95 && suggestion.customer === left && suggestion.fulfillment === right &&
    (!a.type || !b.type || similar(a.locality, b.locality));
  if (a.name === b.name || a.locality === b.locality || similar(a.name, b.name) || similar(a.locality, b.locality) ||
    similar(normalizeGeneralFacilityName(clean(left).replace(/\brch\b/g, 'rhc')), normalizeGeneralFacilityName(clean(right).replace(/\brch\b/g, 'rhc'))) || aiPossible) {
    return result('review required', `The names may refer to the same facility, but no shared official record or verified alias confirms this.${context.lookupUnavailable ? ' Facility records are currently unavailable.' : ''} Manually verify before dispatch.`, { ...extra, evidence, ...(aiPossible ? { aiSuggestion: suggestion } : {}) });
  }
  return result('mismatch', 'The facility names identify different locations or facilities.', { ...extra, evidence });
}
