import data from './generalMedicalTerminologyData.json';
import { medicalProductAcronyms, expandGeneralProductAcronyms } from './medicalProductAcronyms';

export interface GeneralMedicalTerm {
  canonicalId?: string;
  canonicalName: string;
  normalizationName: string;
  aliases: string[];
  acronyms: string[];
  genericName: string;
  brandNames: string[];
  formulation: string | null;
  strength: string | null;
  category: string;
  ageGroup: string | null;
  contextualAliases: string[];
  note: string;
}
export let generalMedicalTerminology: readonly GeneralMedicalTerm[] = data;
// Approved local catalogue identities. These mappings apply only to General
// Auditor product orders, not to clinical substitution or other tabs.
export let generalApprovedProductIdentities = [
  { canonicalId: 'ANTI_SNAKE', canonicalName: 'Anti Snake Serum Injection', aliases: [
    'ASV', 'Anti Snake Serum Injection', 'Anti Snake Serum', 'Anti Snake Venom',
    'Snake Venom Antiserum', 'Snake Venom Antivenom', 'Snake Antivenom', 'Antivenom',
    'Snake Serum', 'Snake Venom Serum', 'Snake Antiserum', 'Anti Snake',
    'Snake Bite Serum', 'Snake Injection', 'Snake Venom Injection', 'Antivenom Injection',
    'Anti Snake Vaccine'
  ] },
  { canonicalId: 'ANTI_RABIES_VACCINE', canonicalName: 'Anti Rabies Vaccine Injection', aliases: [
    'ARV', 'Anti Rabies Vaccine Injection', 'Anti Rabies Vaccine', 'Rabies Vaccine',
    'Rabies Injection', 'Rabies Inj', 'Anti Rabies Injection', 'Anti Rabies Inj',
    'Anti Rabies', 'Rabies Shot', 'Antirabies'
  ] }
] as { canonicalId: string; canonicalName: string; aliases: string[] }[];
export const generalMedicalAbbreviations: Record<string, string> = {
  PCM: 'Paracetamol', AL: 'Artemether/Lumefantrine', ACT: 'Artemisinin-based Combination Therapy (class)',
  ORS: 'Oral Rehydration Salts', ORT: 'Oral Rehydration Therapy; local ORS context required',
  RDT: 'Rapid Diagnostic Test; specify diagnostic target', MRDT: 'Malaria Rapid Diagnostic Test',
  BCG: 'Bacille Calmette-Guerin Vaccine', OPV: 'Oral Polio Vaccine', IPV: 'Inactivated Polio Vaccine',
  PCV: 'Pneumococcal Conjugate Vaccine', PENTA: 'Pentavalent Vaccine', ROTA: 'Rotavirus Vaccine',
  YF: 'Yellow Fever Vaccine', MR: 'Measles-Rubella Vaccine', TT: 'Tetanus Toxoid',
  TD: 'Tetanus-Diphtheria Vaccine', DT: 'Diphtheria-Tetanus Vaccine OR dispersible tablet; context required',
  HPV: 'Human Papillomavirus', ARV: 'Anti Rabies Vaccine Injection in General Auditor product orders; antiretroviral in other clinical contexts',
  RIG: 'Rabies Immunoglobulin', HRIG: 'Human Rabies Immunoglobulin', ERIG: 'Equine Rabies Immunoglobulin',
  ASV: 'Anti Snake Venom / Anti Snake Serum Injection; approved local catalogue identity; preserve specified formulation', NS: 'Normal Saline (0.9% sodium chloride)',
  RL: "Ringer's Lactate", DNS: 'Dextrose Normal Saline', D5: 'Dextrose 5%', D5W: 'Dextrose 5% in Water',
  D10: 'Dextrose 10%', D50: 'Dextrose 50%', MGSO4: 'Magnesium Sulphate',
  CPM: 'Chlorpheniramine', EPI: 'Epinephrine / Adrenaline', PRBC: 'Packed Red Blood Cells',
  FFP: 'Fresh Frozen Plasma', WB: 'Whole Blood', HC: 'Hydrocortisone OR Health Centre; context required',
  IV: 'Intravenous', IVF: 'Intravenous Fluids (category)', IM: 'Intramuscular', SC: 'Subcutaneous',
  PO: 'Oral / by mouth', INJ: 'Injection', TAB: 'Tablet', CAP: 'Capsule',
  SUSP: 'Suspension', SOLN: 'Solution', INF: 'Infusion'
};

export const generalTerminologyKey = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['’]/g, '').replace(/(?<=[a-z])-(?=[a-z])/g, ' ').replace(/\s+/g, ' ').trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const forms: Record<string, string> = { tab: 'tablet', tabs: 'tablet', tablets: 'tablet', cap: 'capsule', caps: 'capsule', capsules: 'capsule',
  inj: 'injection', injectable: 'injection', injections: 'injection', syr: 'syrup', syrups: 'syrup', susp: 'suspension', suspensions: 'suspension',
  soln: 'solution', inf: 'infusion', drip: 'infusion', vac: 'vaccine', neb: 'nebule', nebules: 'nebule',
  paed: 'paediatric', pediatric: 'paediatric', child: 'paediatric', children: 'paediatric', childrens: 'paediatric',
  iv: 'intravenous', im: 'intramuscular', sc: 'subcutaneous', po: 'oral', sulfate: 'sulphate', sulphate: 'sulphate',
  exam: 'examination', diluents: 'diluent', droppers: 'dropper', vaccines: 'vaccine', solutions: 'solution' };
const formPattern = new RegExp(`\\b(${Object.keys(forms).join('|')})\\b`, 'g');
const standardWords = (text: string) => generalTerminologyKey(text).replace(formPattern, token => forms[token]);
let approvedIdentityPatterns = generalApprovedProductIdentities.map(identity => ({ identity,
  pattern: new RegExp(`(^|[^a-z0-9])(${identity.aliases.map(generalTerminologyKey).sort((a, b) => b.length - a.length).map(escape).join('|')})(?=$|[^a-z0-9])`, 'i')
}));
export function resolveGeneralApprovedIdentity(value: string) {
  const text = generalTerminologyKey(value);
  // Specific formulations have their own identities, never the default ASV ID.
  if (/\b(?:monovalent|polyvalent|specific snake|immunoglobulin|rig|hrig|erig|antiretroviral)\b/.test(text)) return null;
  for (const { identity, pattern } of approvedIdentityPatterns) {
    if (pattern.test(text)) {
      let qualifiers = text.replace(pattern, (_match, before: string) => before).replace(/\b(?:inj|injection)\b/g, ' ');
      if (identity.canonicalId === 'ANTI_RABIES_VACCINE') qualifiers = qualifiers.replace(/\b(?:vac|vaccine)\b/g, ' ');
      qualifiers = qualifiers.replace(/\s+/g, ' ').trim();
      return { ...identity, resolvedName: `${identity.canonicalName}${qualifiers ? ` ${qualifiers}` : ''}` };
    }
  }
  return null;
}
export const resolveCanonicalProduct = resolveGeneralApprovedIdentity;
const qualifiers = /\b(?:tablet|capsule|syrup|suspension|solution|cream|ointment|injection|infusion|drops|inhaler|nebule|suppository|intravenous|intramuscular|subcutaneous|oral|adult|paediatric|infant|neonate|sodium|potassium|sulphate|surgical|examination)\b/g;
let replacements: Map<string, string>;
let ageDefaults: Map<string, GeneralMedicalTerm>;
let pattern: RegExp;
export function setGeneralMedicalTerminology(terms: GeneralMedicalTerm[]) {
  generalMedicalTerminology = terms;
  generalApprovedProductIdentities = terms.filter(term => ['ANTI_SNAKE', 'ANTI_RABIES_VACCINE'].includes(term.canonicalId || '')).map(term => ({ canonicalId: term.canonicalId!, canonicalName: term.canonicalName, aliases: term.aliases }));
  approvedIdentityPatterns = generalApprovedProductIdentities.map(identity => ({ identity,
    pattern: new RegExp(`(^|[^a-z0-9])(${[identity.canonicalName, ...identity.aliases].map(generalTerminologyKey).sort((a, b) => b.length - a.length).map(escape).join('|')})(?=$|[^a-z0-9])`, 'i') }));
  rebuildTerminology();
}
function rebuildTerminology() {
  const candidates = new Map<string, Set<string>>();
  for (const term of generalMedicalTerminology) {
    for (const alias of [term.canonicalName, ...term.aliases]) {
      if (term.contextualAliases.some(value => generalTerminologyKey(value) === generalTerminologyKey(alias))) continue;
      let target = standardWords(term.normalizationName);
      const source = standardWords(alias);
      if (term.canonicalName === 'Cannula' && ['branula', 'venflon', 'iv line'].includes(generalTerminologyKey(alias))) target = 'intravenous cannula';
      for (const qualifier of source.match(qualifiers) || []) {
        if (qualifier === 'sodium' && /normal saline/.test(target)) continue;
        if (qualifier === 'drops' && term.canonicalName === 'Oral Polio Vaccine') continue;
        if (qualifier === 'injection' && term.canonicalName === 'Inactivated Polio Vaccine') continue;
        if (!new RegExp(`\\b${qualifier}\\b`).test(target)) target += ` ${qualifier}`;
      }
      const aliasKey = generalTerminologyKey(alias);
      const values = candidates.get(aliasKey) || new Set<string>();
      values.add(target);
      candidates.set(aliasKey, values);
    }
  }
  // Duplicate meanings (e.g. deworming tablet) never become automatic aliases.
  replacements = new Map([...candidates].filter(([, values]) => values.size === 1).map(([alias, values]) => [alias, [...values][0]]));
  ageDefaults = new Map(generalMedicalTerminology.filter(term => term.ageGroup && term.strength)
    .flatMap(term => term.aliases.filter(alias => !/\d/.test(alias)).map(alias => [generalTerminologyKey(alias), term] as const)));
  pattern = new RegExp(`(^|[^a-z0-9])(${[...replacements.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})(?=$|[^a-z0-9])`, 'g');

}
rebuildTerminology();

/** General-only identity normalization. No quantities or final statuses are set here. */
export function expandGeneralMedicalTerms(value: string): string {
  const original = generalTerminologyKey(resolveGeneralApprovedIdentity(value)?.resolvedName ?? value);
  let normalized = original.replace(pattern, (_match, before: string, alias: string) => {
    let target = replacements.get(alias)!;
    if (alias === 'mr' && /\b(?:tabs?|tablets?|caps?|capsules?|oral|syrup)\b/.test(original) && !/\b(?:measles|rubella)\b/.test(original)) target = 'modified release';
    if (alias === 'rdt') {
      const context = original.replace(/\brdt\b|\b(?:malaria|rapid|diagnostic|test|kit)\b|\d+(?:\.\d+)?\s*(?:mg|ml|g|iu)?/g, '').trim();
      if (/[a-z]/.test(context)) target = 'rapid diagnostic test';
    }
    const ageDefault = ageDefaults.get(alias);
    // A partial alias must not insert a second/default strength into an
    // already qualified or reordered product name.
    if (ageDefault && original !== alias) target = target.replace(ageDefault.strength!, '').replace(/\bsyrup\b/g, '').replace(/\s+/g, ' ').trim();
    return before + target;
  });
  normalized = normalized.replace(formPattern, token => forms[token]);
  // Known concentration definitions, never a generic saline/dextrose default.
  normalized = normalized.replace(/\b(?:sodium chloride\s+0\.9\s*%(?=$|\s)|0\.9\s*%\s+(?:sodium chloride|saline)\b)/g, 'normal saline')
    .replace(/\bnormal saline\s+0\.9\s*%/g, 'normal saline')
    .replace(/\b(?:0\.45\s*%\s+(?:sodium chloride|saline)|sodium chloride\s+0\.45\s*%)/g, 'half normal saline');
  return normalized;
}

/** Ignore a repeated identity label, e.g. Paracetamol (PCM), not a clinical qualifier. */
export function stripGeneralRepeatedAlias(value: string): string {
  return value.replace(/\(([^()]*)\)/g, (annotation, label: string, offset: number) => {
    const alias = generalTerminologyKey(label);
    const known = replacements.has(alias) || medicalProductAcronyms.some(term => !term.contextual &&
      [term.name, ...term.aliases].some(name => generalTerminologyKey(name) === alias));
    if (!known || getGeneralMedicalAmbiguity(label)) return annotation;
    const identity = (name: string) => expandGeneralProductAcronyms(expandGeneralMedicalTerms(name))
      .replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    const surrounding = identity(value.slice(0, offset) + ' ' + value.slice(offset + annotation.length));
    const repeated = identity(label);
    return (` ${surrounding} `).includes(` ${repeated} `) ? ' ' : annotation;
  }).replace(/\s+/g, ' ').trim();
}

const vague = /^(?:drip|antibiotics?|pain ?killers?|cough (?:syrup|medicine)|malaria (?:medicine|drug|tablets?)|injection|infusion|solution|suspension|capsule|vaccine|serum|tablet|iv fluids?|intravenous fluids?|ivf|intravenous|intramuscular|subcutaneous|oral|test kit|salt water)$/i;
export function getGeneralMedicalAmbiguity(name: string, productContext = ''): string | null {
  const text = generalTerminologyKey(name);
  if (resolveGeneralApprovedIdentity(name)) return null;
  if (/\b(?:ors\s*(?:and|[+/&])\s*zinc|diarrh(?:ea|oea) pack)\b/.test(text)) return 'ORS and zinc remain separate products unless the actual catalog defines a combination pack. Verify each requested quantity.';
  if (/\b(?:0\.9|0\.45)\s*%/.test(text) && /\b(?:saline|sodium chloride)\b/.test(text)) return null;
  if (/\bdextrose\b/.test(text) && /\b(?:5|10|50)\s*%/.test(text)) return null;
  // Preserve established local ACT/AL wording only with independently named
  // AL product evidence, rather than treating every ACT combination as AL.
  if (text === 'act' && /\b(?:al|coartem|artemether\s*[/+]?\s*lumefantrine)\b/i.test(productContext)) return null;
  if (vague.test(standardWords(text))) return 'This term describes a product class or route, not a specific catalog product.';
  const withoutStrength = text.replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|l|iu|%)?\b/g, '').replace(/[()[\]%,/]/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutForm = standardWords(withoutStrength).replace(/\b(?:injection|infusion|intravenous|intramuscular|subcutaneous|oral|tablet|capsule|syrup|suspension|solution)\b/g, '').replace(/\s+/g, ' ').trim();
  const withoutBloodGroup = withoutForm.replace(/\b(?:ab|a|b|o)\s*(?:rh\s*)?(?:positive|negative|pos|neg|[+−-])/g, '').replace(/\s+/g, ' ').trim();
  const matches = generalMedicalTerminology.filter(term => term.contextualAliases.some(alias =>
    [text, withoutStrength, withoutForm, withoutBloodGroup].includes(generalTerminologyKey(alias))));
  if (matches.length) return matches[0].note;
  const legacy = medicalProductAcronyms.find(term => term.contextual && !['ACT', 'RDT'].includes(term.aliases[0]) &&
    term.aliases.some(alias => generalTerminologyKey(alias) === withoutBloodGroup));
  if (legacy) return legacy.note || 'This abbreviation has multiple possible product meanings.';
  return null;
}

export function isGeneralBiologic(value: string): boolean {
  return /\b(?:vaccine|diluent|dropper|rabies|snake|immunoglobulin|antivenom|antiserum|tetanus|polio|measles|rubella|rotavirus|calmette|bcg|opv|ipv|pcv|penta|rota|yf|mr|tt|td|rig|hrig|erig|asv)\b/i.test(expandGeneralMedicalTerms(value));
}

export const getGeneralTerminologyAliases = () => generalMedicalTerminology.map(term => ({
  name: term.canonicalName, canonicalId: term.canonicalId, aliases: term.aliases, acronyms: term.acronyms.length ? term.acronyms : undefined,
  genericName: term.genericName !== term.canonicalName ? term.genericName : undefined,
  brandNames: term.brandNames.length ? term.brandNames : undefined, formulation: term.formulation || undefined,
  strength: term.strength || undefined, ageGroup: term.ageGroup || undefined,
  contextual: term.contextualAliases.length > 0, contextualAliases: term.contextualAliases,
  note: term.note.startsWith('Preserve specified strength, dosage form, route') ? undefined : term.note
}));
export const generalTerminologyAliases = getGeneralTerminologyAliases();
export function relevantGeneralAbbreviations(input: string): Record<string, string> {
  const text = ` ${input.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  return Object.fromEntries(Object.entries(generalMedicalAbbreviations).filter(([term]) => text.includes(` ${term} `)));
}

export const generalCombinationTerminology = {
  name: 'ORS + Zinc', aliases: ['ORS and zinc', 'ORS/zinc', 'diarrhea pack'], contextual: true,
  note: 'Separate ORS and zinc when the catalog stores them separately. Never infer a quantity for each component from a single pack quantity; require review if quantities are unclear.'
};
