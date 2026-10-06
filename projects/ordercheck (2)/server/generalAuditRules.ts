export type GeneralAuditItem = {
  name?: string;
  status?: string;
};

export type GeneralAuditMetaField = {
  status?: string;
};

const DISCREPANCY_STATUSES = new Set(['quantity mismatch', 'missing item', 'extra item']);

export function normalizeAuditText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeGhanaPhone(value: unknown): string {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) digits = `0${digits.slice(3)}`;
  else if (digits.length === 9) digits = `0${digits}`;
  return digits;
}

export function normalizeFacilityName(value: unknown): string {
  let facility = normalizeAuditText(value);
  const suffixes = ['health center', 'health centre', 'chps compound', 'chps', 'clinic', 'hospital', 'center', 'centre', 'hc', 'rch'];
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of suffixes) {
      if (facility !== suffix && facility.endsWith(` ${suffix}`)) {
        facility = facility.slice(0, -(suffix.length + 1)).trim();
        changed = true;
        break;
      }
    }
  }
  return facility;
}

export function isExplicitZeroFulfillment(value: unknown): boolean {
  return /\b0\s*\/\s*\d+\b|\b0\s+of\s+\d+\b|\b0\s+(?:units?|vials?|packs?|boxes?|cards?|doses?|loaded)\b|\bout[\s-]?of[\s-]?stock\b/i.test(String(value ?? ''));
}

function extractQuantity(value: unknown): number | null {
  const match = String(value ?? '').match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

const COUNT_UNIT_ALIASES: Record<string, string> = {
  box: 'box', boxes: 'box',
  pack: 'pack', packs: 'pack',
  card: 'card', cards: 'card',
  sachet: 'sachet', sachets: 'sachet',
  tablet: 'tablet', tablets: 'tablet',
  unit: 'unit', units: 'unit',
  test: 'test', tests: 'test',
  vial: 'vial', vials: 'vial',
  dose: 'dose', doses: 'dose',
  capsule: 'capsule', capsules: 'capsule',
  bottle: 'bottle', bottles: 'bottle',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece'
};

function extractCountUnit(value: unknown): string | null {
  const match = String(value ?? '').match(/\d+\s*([a-z]+)\b/i);
  return match ? COUNT_UNIT_ALIASES[match[1].toLowerCase()] || null : null;
}

export function quantitiesMatchWithInternalQuantity(
  requestedValue: unknown,
  foundValue: unknown,
  internalQuantity = 1
): boolean {
  const requested = extractQuantity(requestedValue);
  const found = extractQuantity(foundValue);
  if (requested === null || found === null) return false;
  if (requested === found) return true;

  // Apply package conversion only when both sides explicitly state different count units.
  // Otherwise the same factor could incorrectly make, for example, 2 packs match 50 packs.
  const requestedUnit = extractCountUnit(requestedValue);
  const foundUnit = extractCountUnit(foundValue);
  const hasDifferentExplicitUnits = requestedUnit !== null && foundUnit !== null && requestedUnit !== foundUnit;
  return hasDifferentExplicitUnits && internalQuantity > 1 && (
    found === requested * internalQuantity || requested === found * internalQuantity
  );
}

export function reconcileGeneralQuantityStatus(
  status: string | undefined,
  requestedValue: unknown,
  foundValue: unknown,
  internalQuantity = 1
): string | undefined {
  const requested = extractQuantity(requestedValue);
  const found = extractQuantity(foundValue);

  if (found !== null && found > 0 && (status === 'out of stock' || status === 'missing item')) {
    if (requested === null) return 'extra item';
    return quantitiesMatchWithInternalQuantity(requestedValue, foundValue, internalQuantity)
      ? 'match'
      : 'quantity mismatch';
  }

  if (requested !== null && found !== null && (status === 'match' || status === 'quantity mismatch')) {
    return quantitiesMatchWithInternalQuantity(requestedValue, foundValue, internalQuantity)
      ? 'match'
      : 'quantity mismatch';
  }

  return status;
}

export function calculateGeneralAuditSummary(
  items: GeneralAuditItem[],
  metadataIssues: string[]
): { issueCount: number; allMatch: boolean; hasOutOfStockItems: boolean; verdict: string } {
  const activeItems = items.filter(item => item && item.status && DISCREPANCY_STATUSES.has(item.status));
  const issueCount = activeItems.length + metadataIssues.length;
  const allMatch = issueCount === 0;
  const hasOutOfStockItems = items.some(item => item?.status === 'out of stock');
  const activeIssues = [
    ...activeItems.map(item => `${item.name || 'Product'} (${item.status})`),
    ...metadataIssues
  ];
  const verdict = activeIssues.length > 0
    ? `Discrepancy: ${Array.from(new Set(activeIssues)).join(', ')}.`
    : hasOutOfStockItems
      ? 'The requested product(s) are currently out of stock'
      : 'All active packaging and compliance details match perfectly.';
  return { issueCount, allMatch, hasOutOfStockItems, verdict };
}
