// Closed count-unit spellings used in customer requests; never clinical strengths.
export const GENERAL_COUNT_UNIT_PATTERN = '(?:units?|vials?|vails?|vialls?|vilas?|packs?|box(?:es)?|cards?|blisters?|strips?|doses?|sachets?|tablets?|capsules?|bottles?|btls?|pieces?|pcs?|pics|tests?)';

export function normalizeGeneralCountUnit(value = ''): string {
  const unit = value.trim().toLowerCase();
  if (/^(?:vails?|vialls?|vilas?)$/.test(unit)) return 'vial';
  if (/^(?:btls?|bottles?)$/.test(unit)) return 'bottle';
  if (/^(?:pcs?|pics|pieces?)$/.test(unit)) return 'piece';
  return unit.replace(/^boxes$/, 'box').replace(/s$/, '');
}
