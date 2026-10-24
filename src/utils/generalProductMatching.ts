import { generalLearnedAliasAmbiguous } from '../../shared/generalProductAliases';
import { intentAliases } from '../../shared/generalIntentAliases';
import { getCatalogRevision } from '../../shared/productCatalog';
import { generalMedicalTerminology, getGeneralMedicalAmbiguity, isGeneralBiologic } from './generalMedicalTerminology';
import { isGeneralBloodProduct } from './medicalProductAcronyms';

export type GeneralMatchingStage = 'exact' | 'synonym' | 'attributes' | 'fuzzy' | 'verification' | 'distinct';
export interface GeneralClinicalAttributes {
  ingredient: string; measurements: string[]; bareNumbers: string[]; forms: string[]; routes: string[]; releases: string[]; qualifiers: string[];
}
export interface GeneralProductMatch { stage: GeneralMatchingStage; confident: boolean; plausible: boolean; reason: string }
type Normalizer = (name: string) => string;
const forms = /\b(?:tablet|capsule|syrup|suspension|injection|infusion|solution|suppository|cream|ointment|gel|powder|drops?|inhaler|nebule)\b/g;
const routes = /\b(?:intravenous|intramuscular|subcutaneous|oral|topical|rectal|ophthalmic|otic|inhaled)\b/g;
const releases = /\b(?:modified release|extended release|sustained release|immediate release|delayed release|enteric coated|sr|xr|xl|er|cr|mr|retard)\b/g;
const qualifiers = /\b(?:xxs|xs|s|m|l|xl|xxl|small|medium|large|adult|paediatric|pediatric|neonatal|sterile|non sterile|powdered|powder free|latex|nitrile)\b/g;
const measurement = /\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|l|miu|iu)(?:\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:mcg|mg|g|ml|l|miu|iu))?\b/g;
const equal = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
const tokens = (value: string, pattern: RegExp) => [...new Set(value.match(pattern) || [])].sort();
function normalizedMeasurement(value: string) {
  const parts = value.replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)(mcg|mg|g|ml|l|miu|iu)(?:\/(?:(\d+(?:\.\d+)?))?(mcg|mg|g|ml|l|miu|iu))?$/);
  if (!parts) return value;
  const unit = (amount: number, name: string) => ({ value: Number((amount * ({ mcg: 0.001, mg: 1, g: 1000, ml: 1, l: 1000, miu: 1000000, iu: 1 }[name] || 1)).toPrecision(12)), name: /^(?:mcg|mg|g)$/.test(name) ? 'mg' : /^(?:ml|l)$/.test(name) ? 'ml' : 'iu' });
  const numerator = unit(Number(parts[1]), parts[2]);
  if (!parts[4]) return `${numerator.value}${numerator.name}`;
  const denominator = unit(Number(parts[3] || 1), parts[4]);
  return denominator.value > 0 ? `${Number((numerator.value / denominator.value).toPrecision(12))}${numerator.name}/${denominator.name}` : value;
}
export function cleanGeneralProductDescription(name: string) {
  return name.replace(/^(?:(?:please|pls|kindly)\s+)?(?:(?:we|i)\s+)?(?:need|want|request|send|give|supply)(?:\s+(?:us|me))?\s+/i, '').trim();
}
export function generalClinicalAttributes(name: string, normalize: Normalizer): GeneralClinicalAttributes {
  const value = normalize(cleanGeneralProductDescription(name)).split('|').slice(-2)[0];
  const measurements = (value.match(measurement) || []).map(normalizedMeasurement).sort();
  const bareNumbers = (value.replace(measurement, ' ').match(/\b\d+(?:\.\d+)?\b/g) || []).map(value => String(Number(value)));
  return { ingredient: value.replace(measurement, ' ').replace(releases, ' ').replace(forms, ' ').replace(routes, ' ').replace(qualifiers, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '),
    measurements, bareNumbers, forms: tokens(value, forms), routes: tokens(value, routes), releases: tokens(value, releases), qualifiers: tokens(value.replace(measurement, ' '), qualifiers) };
}
let vocabulary: { terms: typeof generalMedicalTerminology; normalize: Normalizer; ingredients: Set<string> } | undefined;
function knownIngredients(normalize: Normalizer) {
  if (vocabulary?.terms !== generalMedicalTerminology || vocabulary.normalize !== normalize) {
    vocabulary = { terms: generalMedicalTerminology, normalize,
      ingredients: new Set(generalMedicalTerminology.flatMap(term => [term.canonicalName, term.genericName]).map(name => generalClinicalAttributes(name, normalize).ingredient).filter(Boolean)) };
  }
  return vocabulary.ingredients;
}
function containsKnownFamily(description: string, family: string) {
  const words = new Set(description.split(' '));
  return family.length >= 4 && family.split(' ').every(word => words.has(word));
}
/** Identity recognition is separate from a proposed clinical substitution. */
export function generalProductIdentityEstablished(name: string, normalize: Normalizer) {
  if (getGeneralMedicalAmbiguity(name) || /\b(?:unknown|unidentified|unspecified|unclear)\b/i.test(name)) return false;
  if (isGeneralKnownProductDescription(name, normalize)) return true;
  const ingredient = generalClinicalAttributes(name, normalize).ingredient;
  return [...knownIngredients(normalize)].filter(known => containsKnownFamily(ingredient, known)).length === 1;
}
function minorError(a: string, b: string) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const differences = [...a].flatMap((char, index) => char === b[index] ? [] : [index]);
    return differences.length === 1 || differences.length === 2 && differences[1] === differences[0] + 1 &&
      a[differences[0]] === b[differences[1]] && a[differences[1]] === b[differences[0]];
  }
  const shorter = a.length < b.length ? a : b, longer = a.length < b.length ? b : a;
  return [...longer].some((_, index) => longer.slice(0, index) + longer.slice(index + 1) === shorter);
}
function safeIngredientError(a: string, b: string, normalize: Normalizer) {
  const known = knownIngredients(normalize);
  if (known.has(a) && known.has(b)) return false; // Never substitute two distinct catalogue medicines.
  const unknown = known.has(a) ? b : a, expected = known.has(a) ? a : b;
  if (!known.has(expected) || !minorError(unknown, expected)) return false;
  return [...known].filter(candidate => minorError(unknown, candidate)).length === 1;
}
/** Recognition/routing only; matching still validates every clinical attribute. */
export function isGeneralKnownProductDescription(name: string, normalize: Normalizer) {
  if (getGeneralMedicalAmbiguity(name)) return false;
  const ingredient = generalClinicalAttributes(name, normalize).ingredient;
  return !!ingredient && (knownIngredients(normalize).has(ingredient) || [...knownIngredients(normalize)].some(known => safeIngredientError(ingredient, known, normalize)));
}
export function generalCatalogSupports(name: string, normalize: Normalizer) {
  const attributes = generalClinicalAttributes(name, normalize);
  if (!attributes.ingredient || getGeneralMedicalAmbiguity(name)) return false;
  return generalMedicalTerminology.some(term => {
    const base = generalClinicalAttributes(term.canonicalName, normalize);
    return base.ingredient === attributes.ingredient && (!base.forms.length || equal(base.forms, attributes.forms)) &&
      (!base.measurements.length || equal(base.measurements, attributes.measurements)) &&
      (!base.routes.length || equal(base.routes, attributes.routes)) && equal(base.releases, attributes.releases);
  });
}
function catalogueRatioShorthand(requested: string, fulfilled: string, normalize: Normalizer) {
  const bareRatio = normalize(requested).split('|').slice(-2)[0].match(/\b(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)(?![\da-z.])/);
  if (!bareRatio || Number(bareRatio[2]) <= 0) return false;
  const a = generalClinicalAttributes(requested, normalize), b = generalClinicalAttributes(fulfilled, normalize);
  if (!a.forms.length || !equal(a.forms, b.forms) || !equal(a.routes, b.routes) || a.bareNumbers.length !== 2) return false;
  const signatures = new Set<string>();
  for (const term of generalMedicalTerminology) {
    const attributes = generalClinicalAttributes(term.canonicalName, normalize);
    if (attributes.ingredient !== a.ingredient || !equal(attributes.forms, a.forms) || !equal(attributes.qualifiers, a.qualifiers) || !equal(attributes.releases, a.releases)) continue;
    const ratio = normalize(term.canonicalName).split('|').slice(-2)[0].match(/\b(\d+(?:\.\d+)?)(?:mcg|mg|g|miu|iu)\/(?:(\d+(?:\.\d+)?))?(?:ml|l)\b/);
    if (ratio && Number(ratio[1]) === Number(bareRatio[1]) && Number(ratio[2] || 1) === Number(bareRatio[2])) signatures.add(JSON.stringify(attributes.measurements));
  }
  return signatures.size === 1 && signatures.has(JSON.stringify(b.measurements));
}
/** One clinical decision function for assignment, review candidates and AI validation.
 * Quantities never enter this function. Explicit clinical conflicts cannot be fuzzy matched. */
export function matchGeneralClinicalProducts(requested: string, fulfilled: string, normalize: Normalizer): GeneralProductMatch {
  requested = cleanGeneralProductDescription(requested);
  fulfilled = cleanGeneralProductDescription(fulfilled);
  const result = (stage: GeneralMatchingStage, reason: string): GeneralProductMatch => ({ stage,
    confident: ['exact', 'synonym', 'attributes', 'fuzzy'].includes(stage), plausible: stage !== 'distinct', reason });
  if (!getCatalogRevision()) {
    const written = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();
    const alias = intentAliases.find(row => row.aliases.some(alias => written(alias) === written(requested)) && normalize(row.name) === normalize(fulfilled));
    if (alias) return result('synonym', 'An approved whole-source catalogue alias defines this complete clinical identity.');
  }
  if (generalLearnedAliasAmbiguous(requested) || generalLearnedAliasAmbiguous(fulfilled)) return result('verification', 'An approved alias has competing catalogue targets. Review the product identity.');
  if (normalize(requested) === normalize(fulfilled)) {
    const surface = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9.]+/g, ' ').trim().split(/\s+/).sort().join(' ');
    return result(surface(requested) === surface(fulfilled) ? 'exact' : 'synonym', 'Complete identities agree after approved synonym and formatting normalization.');
  }
  if (isGeneralBiologic(requested) || isGeneralBiologic(fulfilled) || isGeneralBloodProduct(requested) || isGeneralBloodProduct(fulfilled)) return result('distinct', 'Biologic and blood identities retain their existing strict rules.');
  const a = generalClinicalAttributes(requested, normalize), b = generalClinicalAttributes(fulfilled, normalize);
  if (a.qualifiers.length && b.qualifiers.length && !equal(a.qualifiers, b.qualifiers)) return result('distinct', 'Explicit size, age or material qualifiers differ.');
  const sameIngredient = a.ingredient === b.ingredient && !!a.ingredient;
  const fuzzy = !sameIngredient && safeIngredientError(a.ingredient, b.ingredient, normalize);
  const known = knownIngredients(normalize);
  const partialFamily = !known.has(a.ingredient) && known.has(b.ingredient) && containsKnownFamily(a.ingredient, b.ingredient) ||
    !known.has(b.ingredient) && known.has(a.ingredient) && containsKnownFamily(b.ingredient, a.ingredient);
  if (!sameIngredient && !fuzzy && !partialFamily) return result('distinct', 'No verified ingredient identity or uniquely bounded OCR variant.');
  if (a.measurements.length > 1 && b.measurements.length > 1 && !a.measurements.some(value => value.includes('/')) && !b.measurements.some(value => value.includes('/')) && !equal((normalize(requested).split('|').at(-1)!.match(measurement) || []).map(normalizedMeasurement), (normalize(fulfilled).split('|').at(-1)!.match(measurement) || []).map(normalizedMeasurement))) return result('distinct', 'Compound measurement assignments differ.');
  if (a.measurements.length && b.measurements.length && !equal(a.measurements, b.measurements)) {
    if (sameIngredient && a.measurements.some(value => value.includes('/')) && b.measurements.some(value => value.includes('/')) && equal(a.forms, b.forms) && a.forms.length === 1 && a.forms[0] === 'injection' && equal(a.routes, b.routes) && equal(a.releases, b.releases)) return result('verification', 'Concentrations differ. Confirm the exact concentration and formulation with the customer; quantities are checked independently.');
    return result('distinct', 'Explicit strengths, concentrations or container specifications conflict.');
  }
  if (a.routes.length && b.routes.length && !equal(a.routes, b.routes) || !equal(a.releases, b.releases)) return result('distinct', 'Explicit routes or release types conflict.');
  const injectionInfusion = a.forms.length === 1 && b.forms.length === 1 &&
    [a.forms[0], b.forms[0]].sort().join('|') === 'infusion|injection';
  if (a.forms.length && b.forms.length && !equal(a.forms, b.forms) && !injectionInfusion) return result('distinct', 'Explicit dosage forms differ.');
  if (!equal(a.qualifiers, b.qualifiers)) return result('verification', 'An age, size or material qualifier is missing on one side; verify the intended specification.');
  if (partialFamily) return result('verification', 'A known ingredient family matches, but additional product qualifiers require customer verification.');
  if (sameIngredient && catalogueRatioShorthand(requested, fulfilled, normalize)) return result('attributes', 'The written concentration amounts identify one catalogue-supported unit signature with the same formulation.');
  if (sameIngredient && equal(a.forms, b.forms) && a.forms.length > 0 && equal(a.routes, b.routes) &&
    a.bareNumbers.length === 1 && !a.measurements.length && b.measurements.length === 1 && !b.bareNumbers.length &&
    /^\d+(?:\.\d+)?(?:mcg|mg|g|miu|iu)$/.test((normalize(fulfilled).split('|').slice(-2)[0].match(measurement) || [])[0] || '') &&
    Number(a.bareNumbers[0]) === Number((normalize(fulfilled).split('|').slice(-2)[0].match(measurement) || [''])[0].match(/^[\d.]+/)?.[0]) && generalCatalogSupports(fulfilled, normalize)) {
    return result('attributes', 'The explicit amount and dosage form agree; a unique counterpart supplies the missing strength unit.');
  }
  if (equal(a.measurements, b.measurements) && equal(a.bareNumbers, b.bareNumbers) && equal(a.forms, b.forms) && equal(a.routes, b.routes)) {
    if (fuzzy && (generalCatalogSupports(requested, normalize) || generalCatalogSupports(fulfilled, normalize))) return result('fuzzy', 'A unique minor OCR/spelling error preserves all clinical specifications.');
    if (sameIngredient) return result('attributes', 'Structured clinical attributes agree.');
  }
  return result('verification', injectionInfusion ? 'Injection and infusion describe potentially related products, but formulation, concentration, route and container details require customer verification.' :
    `${!a.forms.length && b.forms.length ? 'The Customer Request omits the dosage form. ' : ''}A plausible ingredient match exists, but missing strength, formulation or route information requires customer verification.`);
}

export interface GeneralProductGroup<T> { key: string; name: string; products: T[] }
export function assignGeneralProductGroups<T>(requested: GeneralProductGroup<T>[], fulfilled: GeneralProductGroup<T>[], normalize: Normalizer) {
  // All-pairs validation must not repeatedly expand the same catalogue aliases.
  const originalNormalize = normalize, normalized = new Map<string, string>();
  normalize = name => {
    if (!normalized.has(name)) normalized.set(name, originalNormalize(name));
    return normalized.get(name)!;
  };
  const pairs: { requested: GeneralProductGroup<T>; fulfilled: GeneralProductGroup<T>; match: GeneralProductMatch }[] = [];
  const usedRequest = new Set<string>(), usedFulfilled = new Set<string>();
  // Resolve canonical groups before constructing the unresolved candidate graph.
  // Large exact orders therefore avoid quadratic clinical/fuzzy comparisons.
  const canonical = new Map<string, GeneralProductGroup<T>[]>();
  for (const group of fulfilled) {
    const key = normalize(group.name);
    canonical.set(key, [...(canonical.get(key) || []), group]);
  }
  for (const group of requested) {
    const counterpart = canonical.get(normalize(group.name))?.find(other => !usedFulfilled.has(other.key));
    if (!counterpart || usedRequest.has(group.key)) continue;
    const match = matchGeneralClinicalProducts(group.name, counterpart.name, normalize);
    if (!match.confident) continue;
    pairs.push({ requested: group, fulfilled: counterpart, match });
    usedRequest.add(group.key); usedFulfilled.add(counterpart.key);
  }
  const decisions = requested.filter(group => !usedRequest.has(group.key)).flatMap(a =>
    fulfilled.filter(group => !usedFulfilled.has(group.key)).map(b => ({ requested: a, fulfilled: b, match: matchGeneralClinicalProducts(a.name, b.name, normalize) })));
  const available = () => decisions.filter(pair => !usedRequest.has(pair.requested.key) && !usedFulfilled.has(pair.fulfilled.key));
  for (const pair of available().filter(pair => pair.match.stage === 'exact' || pair.match.stage === 'synonym')) {
    const aliases = available().filter(edge => edge.match.stage === 'exact' || edge.match.stage === 'synonym');
    if (aliases.filter(edge => edge.requested.key === pair.requested.key).length !== 1 ||
      aliases.filter(edge => edge.fulfilled.key === pair.fulfilled.key).length !== 1) continue;
    pairs.push(pair); usedRequest.add(pair.requested.key); usedFulfilled.add(pair.fulfilled.key);
  }
  for (const pair of available().filter(pair => pair.match.confident)) {
    const edges = available();
    if (edges.filter(edge => edge.requested.key === pair.requested.key && edge.match.plausible).length !== 1 ||
      edges.filter(edge => edge.fulfilled.key === pair.fulfilled.key && edge.match.plausible).length !== 1) continue;
    pairs.push(pair); usedRequest.add(pair.requested.key); usedFulfilled.add(pair.fulfilled.key);
  }
  const uncertain = available().filter(pair => pair.match.plausible).map(pair => ({ ...pair,
    match: { ...pair.match, stage: 'verification' as const, confident: false,
      reason: pair.match.confident ? 'Competing product candidates prevent a unique assignment; verify the intended product.' : pair.match.reason } }));
  return { pairs, uncertain };
}
