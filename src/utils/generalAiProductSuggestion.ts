import { isGeneralBiologic } from './generalMedicalTerminology';
import { isGeneralBloodProduct } from './medicalProductAcronyms';
import { generalClinicalAttributes, generalProductIdentityEstablished, matchGeneralClinicalProducts } from './generalProductMatching';

/** Suggestions identify candidates; they never establish clinical equivalence. */
export function generalAiCandidateEligible(source: string, candidate: string, normalize: (name: string) => string) {
  if ((isGeneralBiologic(source) || isGeneralBiologic(candidate) || isGeneralBloodProduct(source) || isGeneralBloodProduct(candidate)) && !matchGeneralClinicalProducts(source, candidate, normalize).confident) return false;
  if (source.replace(/[^a-z]/gi, '').length < 3 || /\b(?:unknown|something|medicine|medication|antibiotic|drug|product|item)\b/i.test(source)) return false;
  if (generalProductIdentityEstablished(source, normalize)) return matchGeneralClinicalProducts(source, candidate, normalize).plausible;
  const a = generalClinicalAttributes(source, normalize), b = generalClinicalAttributes(candidate, normalize);
  for (const field of ['measurements', 'routes', 'releases', 'qualifiers'] as const) {
    if (a[field].length && b[field].length && JSON.stringify(a[field]) !== JSON.stringify(b[field])) return false;
  }
  if (a.forms.length && b.forms.length && JSON.stringify(a.forms) !== JSON.stringify(b.forms) && ![...a.forms, ...b.forms].every(form => /injection|infusion/.test(form))) return false;
  return true;
}
