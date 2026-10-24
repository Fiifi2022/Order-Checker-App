import type { GeneralComparisonItem, GeneralProductEvidence as Evidence } from './generalAuditor';
import type { GeneralProductVerification as Verification } from './generalAuditTypes';
import { canonicalizeGeneralEvidence, generalEvidenceOrigin } from './generalProductEvidence';
import type { GeneralProductMatch } from './generalProductMatching';

type Matcher = (a: string, b: string) => GeneralProductMatch;
export const generalVerificationOrigin = (product: Verification) => JSON.stringify([...new Set(product.requestedProducts.map(generalEvidenceOrigin))].sort());

/** One confirmation state per original entry; candidate names are supporting evidence. */
export function canonicalGeneralVerifications(products: Verification[], match: Matcher): Verification[] {
  const groups = new Map<string, Verification[]>();
  for (const product of products) {
    const key = generalVerificationOrigin(product);
    // Unbound/empty provenance cannot establish that two requests are the same.
    const identity = product.requestedProducts.length ? key : product.key;
    groups.set(identity, [...(groups.get(identity) || []), product]);
  }
  return [...groups.values()].map(candidates => {
    const confirmed = candidates.filter(product => product.confirmation);
    const chosen = confirmed.length ? confirmed.reduce((a, b) => a.confirmation!.confirmedAt >= b.confirmation!.confirmedAt ? a : b) : candidates[0];
    const requestedProducts = canonicalizeGeneralEvidence(chosen.requestedProducts, match);
    const fulfillmentProducts = canonicalizeGeneralEvidence(candidates.flatMap(product => product.fulfillmentProducts), match);
    const options = [...new Map(candidates.flatMap(product => product.options).map(option => [option.key, option])).values()];
    const history = [...new Map(candidates.flatMap(product => [...(product.confirmationHistory || []), ...(product.confirmation && JSON.stringify(product.confirmation) !== JSON.stringify(chosen.confirmation) ? [product.confirmation] : [])]).map(entry => [JSON.stringify(entry), entry])).values()];
    const rejectedSuggestions = [...new Map(candidates.flatMap(product => product.rejectedSuggestions || []).map(entry => [JSON.stringify(entry), entry])).values()];
    return { ...chosen, ...(rejectedSuggestions.length ? { rejectedSuggestions } : {}), key: chosen.requestedProducts.length ? generalVerificationOrigin(chosen) : chosen.key, candidateKeys: [...new Set(candidates.flatMap(product => [product.key, ...(product.candidateKeys || [])]))], requestedProducts, fulfillmentProducts, options,
      requestedQuantity: requestedProducts.reduce((sum, product) => sum + product.quantity, 0), suppliedQuantity: fulfillmentProducts.reduce((sum, product) => sum + product.quantity, 0),
      ...(history.length ? { confirmationHistory: history } : {}) };
  });
}

/** Prevent extraction candidates from contributing the same source quantity twice. */
export function canonicalGeneralComparisonItems(items: GeneralComparisonItem[], verifications: Verification[], match: Matcher) {
  const owners = new Map<string, Verification>();
  for (const product of verifications) for (const source of [...product.requestedProducts, ...product.fulfillmentProducts]) owners.set(generalEvidenceOrigin(source), product);
  const retained: GeneralComparisonItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const provenance = canonicalizeGeneralEvidence(item.provenance, match);
    const pending = provenance.some(source => { const owner = owners.get(generalEvidenceOrigin(source)); return owner && !owner.confirmation && owner.fulfillmentProducts.length > 0; });
    if (pending) continue;
    const identity = JSON.stringify(provenance.map(generalEvidenceOrigin).sort());
    if (provenance.length && seen.has(identity)) continue;
    seen.add(identity); retained.push(provenance.length === item.provenance.length ? item : { ...item, provenance });
  }
  return retained;
}
