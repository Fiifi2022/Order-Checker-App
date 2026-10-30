import {findGeneralFacilityNames, normalizeGeneralFacilityName, type GeneralFacilityContext} from '../src/utils/generalFacility';
import {projectGeneralOrderSentences} from '../src/utils/generalSentenceExtraction';

/** Source-backed detection shared by vaccine verification and allocation confirmation. */
export function vaccineFacilityMentions(text: string, context: GeneralFacilityContext = {}): string[] {
  const projected = projectGeneralOrderSentences(text, context);
  const labels = [...projected.matchAll(/^\s*(?:name of (?:health )?facility|health facility|facility(?: name)?|ordering facility|hospital|clinic|health\s*cent(?:er|re)|hc|dhd|chps|polyclinic|dispensary|delivered\s*to|destination|location|site|to)\s*[:=–—]\s*([^\n\r]+)/gim)]
    .map(match => match[1].trim().replace(/^['"]|['"]$/g, '').replace(/[-–—.,]+$/, '').trim())
    .filter(value => value.length > 2 && !/^(?:n\/?a|none|unknown|not provided)$/i.test(value));
  const names = labels.length ? labels : findGeneralFacilityNames(projected, context.records);
  return [...new Map(names.map(name => [normalizeGeneralFacilityName(name), name])).values()];
}

/** Dispatch uses formatting equivalence and approved aliases, never substring or typo guesses. */
export function vaccineFacilityMatcher(context: GeneralFacilityContext = {}) {
  const names = new Map<string, Set<string>>();
  for (const record of context.records || []) {
    const canonical = normalizeGeneralFacilityName(record.name);
    for (const alias of [record.name, ...(record.verifiedAliases || [])]) {
      const key = normalizeGeneralFacilityName(alias);
      if (!names.has(key)) names.set(key, new Set());
      names.get(key)!.add(canonical);
    }
  }
  return (left: string, right: string) => {
    const a = normalizeGeneralFacilityName(left), b = normalizeGeneralFacilityName(right);
    if (!a || !b) return false;
    if (a === b) return true;
    const ac = names.get(a), bc = names.get(b);
    return ac?.size === 1 && bc?.size === 1 && [...ac][0] === [...bc][0];
  };
}

export function vaccineFacilityNamesMatch(left: string, right: string, context: GeneralFacilityContext = {}): boolean {
  return vaccineFacilityMatcher(context)(left, right);
}
