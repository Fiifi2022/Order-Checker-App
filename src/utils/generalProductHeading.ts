/** Display only: source wording, quantities and internal IDs remain untouched. */
export function generalProductHeading(name: string) {
  let value = name.trim().replace(/^(?:[-*•]\s*|\(\d+\)\s*|\d+[.)]\s+|\d+\s+[-–—]\s*)+/, '');
  const forms: Record<string, string> = { inj: 'Injection', injection: 'Injection', injections: 'Injection', tab: 'Tablet', tabs: 'Tablet', tablets: 'Tablet', tablet: 'Tablet', cap: 'Capsule', caps: 'Capsule', capsule: 'Capsule', capsules: 'Capsule', susp: 'Suspension', suspension: 'Suspension' };
  value = value.replace(/\b(inj|injections?|tabs?|tablets?|caps?|capsules?|susp|suspension)\b\.?/gi, word => forms[word.toLowerCase().replace(/\.$/, '')] || word);
  const observed = [...value.matchAll(/\b(Injection|Tablet|Capsule|Suspension)\b/g)].map(match => match[1]);
  if (observed.length && new Set(observed).size === 1 && (observed.length > 1 || /^(Injection|Tablet|Capsule|Suspension)\b/.test(value))) {
    value = value.replace(/\b(Injection|Tablet|Capsule|Suspension)\b/g, '').replace(/\s+/g, ' ').trim() + ' ' + observed[0];
  }
  return value.replace(/\s+/g, ' ').replace(/^\p{L}/u, letter => letter.toUpperCase()).trim();
}
