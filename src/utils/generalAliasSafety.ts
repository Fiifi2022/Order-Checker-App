import { generalClinicalAttributes, generalProductIdentityEstablished, matchGeneralClinicalProducts } from './generalProductMatching';
const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
/** Clinical evidence is checked before applying learned identity substitutions. */
export function generalAliasSafety(source: string, canonical: string, normalize: (name: string) => string) {
  const a = generalClinicalAttributes(source, normalize), b = generalClinicalAttributes(canonical, normalize);
  const conflicts: string[] = [];
  if (a.ingredient !== b.ingredient && generalProductIdentityEstablished(source, normalize) && !matchGeneralClinicalProducts(source, canonical, normalize).confident) conflicts.push('active ingredient');
  for (const [field, label] of [['measurements', 'strength or concentration'], ['forms', 'dosage form'], ['routes', 'route'], ['qualifiers', 'clinical qualifiers']] as const) {
    if (a[field].length && b[field].length && !same(a[field], b[field])) conflicts.push(label);
  }
  if (!same(a.releases, b.releases)) conflicts.push('release type');
  const complete = (['measurements', 'forms', 'routes', 'releases', 'qualifiers', 'bareNumbers'] as const).every(field => same(a[field], b[field]));
  // An identity-only alias supplies an ingredient, never an omitted strength/form.
  const resolvedDescription = [b.ingredient, ...a.measurements, ...a.bareNumbers, ...a.forms, ...a.routes, ...a.releases, ...a.qualifiers].join(' ');
  return { conflicts, complete, resolvedDescription: complete ? canonical : resolvedDescription, attributes: b };
}
