import type { GeneralFieldResult, GeneralNameEvidence } from './generalAuditTypes';

const aliases: Record<string, string> = {
  jnr: 'junior', jr: 'junior', snr: 'senior', sr: 'senior',
  sam: 'samuel', saml: 'samuel', emman: 'emmanuel', emml: 'emmanuel',
  wm: 'william', chas: 'charles', jos: 'joseph', robt: 'robert',
  alex: 'alexander', geo: 'george', thos: 'thomas', ben: 'benjamin',
  mohammed: 'muhammad', mohamed: 'muhammad', muhammad: 'muhammad',
};
const titles = /^(?:(?:dr|doctor|nurse|officer|mr|mrs|ms|miss|prof|sir|madam)\s+)+/;
export function normalizeGeneralOrdererName(value: string): string[] {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .replace(titles, '').split(/\s+/).filter(Boolean)
    .map(word => aliases[word] || word);
}

// Adjacent transpositions count as a single typo. Short names deliberately have
// stricter thresholds because a one-letter change can identify a different person.
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  return rows[a.length][b.length];
}
const ocr = (word: string) => word.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's');
const suffix = (word: string) => ['junior', 'senior', 'ii', 'iii', 'iv'].includes(word);
const full = (word: string) => word.length > 1 && !suffix(word);

/** Maximum one-to-one coverage: repeated tokens cannot match multiple names. */
function pair(a: string[], b: string[], eligible: (a: string, b: string) => boolean) {
  const owners = new Map<number, number>();
  function assign(i: number, seen: Set<number>): boolean {
    for (let j = 0; j < b.length; j++) {
      if (seen.has(j) || !eligible(a[i], b[j])) continue;
      seen.add(j);
      if (!owners.has(j) || assign(owners.get(j)!, seen)) { owners.set(j, i); return true; }
    }
    return false;
  }
  for (let i = 0; i < a.length; i++) assign(i, new Set());
  return { left: a.filter((_, i) => ![...owners.values()].includes(i)), right: b.filter((_, j) => !owners.has(j)), count: owners.size };
}
export interface GeneralNameMatch {
  status: 'match' | 'mismatch' | 'review required';
  reason: string;
  method: 'deterministic' | 'fuzzy' | 'gemini';
  aiMatchAllowed?: boolean;
}

export function matchGeneralOrdererNames(left: string, right: string): GeneralNameMatch {
  const a = normalizeGeneralOrdererName(left), b = normalizeGeneralOrdererName(right);
  const result = (status: GeneralNameMatch['status'], reason: string, method: GeneralNameMatch['method'] = 'deterministic', aiMatchAllowed = false): GeneralNameMatch => ({ status, reason, method, aiMatchAllowed });
  if (!a.length || !b.length || /^(?:n\/?a|unknown|not available)$/i.test(left.trim()) || /^(?:n\/?a|unknown|not available)$/i.test(right.trim())) return result('review required', 'An orderer name is missing or unreadable.');
  if (a.length > 12 || b.length > 12 || [...a, ...b].some(word => word.length > 60)) return result('review required', 'The extracted name needs manual verification.');
  const sa = a.filter(suffix), sb = b.filter(suffix);
  if (sa.length && sb.length && pair(sa, sb, (x, y) => x === y).count !== Math.max(sa.length, sb.length)) return result('mismatch', 'Conflicting generational suffixes identify different people.');
  const exact = pair(a, b, (x, y) => x === y);
  const anchors = pair([...new Set(a.filter(full))], [...new Set(b.filter(full))], (x, y) => x === y).count;
  if (!exact.left.length && !exact.right.length) {
    if (anchors < 2) return result('review required', 'At least two meaningful full name components are needed to establish identity.');
    return result('match', a.length === 3 ? 'All three name components match regardless of arrangement.' : `All ${a.length === 2 ? 'two' : a.length} name components match regardless of arrangement.`);
  }
  // Omitted middle names are supported only when the shorter form preserves
  // the full first and last names. Unordered subsets alone do not prove identity.
  const aBody = a.filter(word => !suffix(word)), bBody = b.filter(word => !suffix(word));
  const shorter = aBody.length < bBody.length ? aBody : bBody, longer = aBody.length < bBody.length ? bBody : aBody;
  if (sa.length === sb.length && shorter.length >= 2 && shorter.every(full) && full(longer[0]) && full(longer.at(-1)!) &&
    new Set(shorter).size >= 2 && pair(shorter, longer, (x, y) => x === y).count === shorter.length &&
    [longer[0], longer.at(-1)!].every(word => shorter.includes(word))) {
    return result('match', 'Full first and surname components match regardless of arrangement; only middle names were omitted.');
  }
  if (sa.length !== sb.length) return result('review required', 'A generational suffix is missing from one name.');
  const initials = pair(exact.left, exact.right, (x, y) => (x.length === 1 || y.length === 1) && x[0] === y[0]);
  if (!initials.left.length && !initials.right.length) return anchors >= 2
    ? result('match', 'Two full name components match and the remaining initials agree.')
    : result('review required', 'Initials alone do not establish the complete orderer identity.');
  const fuzzyEligible = (x: string, y: string) => {
    if (!full(x) || !full(y)) return false;
    if (ocr(x) === ocr(y) && /[015]/.test(x + y)) return true;
    const min = Math.min(x.length, y.length), max = Math.max(x.length, y.length), d = distance(x, y);
    return min >= 5 && d <= (min >= 9 ? 2 : 1) && d / max <= 0.2;
  };
  const fuzzy = pair(initials.left, initials.right, fuzzyEligible);
  if (!fuzzy.left.length && !fuzzy.right.length && fuzzy.count === 1 && anchors >= 1 && new Set(a.filter(full)).size >= 2 && new Set(b.filter(full)).size >= 2) {
    return result('match', 'Full name components align regardless of arrangement, with one minor spelling or OCR difference.', 'fuzzy');
  }
  const duplicateExtraction = exact.left.length > 0 && exact.right.length > 0 && exact.left.every(word => b.includes(word)) && exact.right.every(word => a.includes(word));
  const plausible = pair(exact.left, exact.right, (x, y) =>
    !suffix(x) && !suffix(y) && (x[0] === y[0] && (x.length === 1 || y.length === 1) ||
      Math.min(x.length, y.length) >= 2 && (x.startsWith(y) || y.startsWith(x)) && Math.abs(x.length - y.length) <= 3 ||
      Math.min(x.length, y.length) >= 3 && distance(ocr(x), ocr(y)) <= 2));
  if (duplicateExtraction || !plausible.left.length && !plausible.right.length || !exact.left.length || !exact.right.length ||
    a.some(word => /\d/.test(word)) || b.some(word => /\d/.test(word))) {
    return result('review required', 'Possible abbreviated, incomplete, or misspelled names require verification.', 'fuzzy',
      plausible.left.length === 0 && plausible.right.length === 0 && anchors >= 1 && new Set(a.filter(full)).size >= 2 && new Set(b.filter(full)).size >= 2);
  }
  return result('mismatch', 'The names contain conflicting full name components; shared components do not establish a match.');
}

export function compareGeneralOrdererNames(whatsappValue: string, fulfillmentValue: string, evidence?: GeneralNameEvidence): GeneralFieldResult {
  const match = matchGeneralOrdererNames(whatsappValue, fulfillmentValue);
  let status: GeneralFieldResult['status'] = whatsappValue === 'N/A' ? 'missing from customer request' : fulfillmentValue === 'N/A' ? 'not available in system entry' : match.status;
  const accepted = status === 'review required' && evidence && evidence.customer === whatsappValue && evidence.fulfillment === fulfillmentValue &&
    Number.isFinite(evidence.confidence) && evidence.confidence >= 0.98 && evidence.confidence <= 1 &&
    typeof evidence.reason === 'string' && evidence.reason.trim() && (evidence.decision === 'mismatch' || evidence.decision === 'match' && match.aiMatchAllowed);
  if (accepted) status = evidence.decision;
  return { whatsappValue, fulfillmentValue, status, reason: accepted ? evidence.reason : match.reason, nameMatchMethod: accepted ? 'gemini' : match.method,
    ...(accepted ? { nameEvidence: evidence } : {}) };
}
