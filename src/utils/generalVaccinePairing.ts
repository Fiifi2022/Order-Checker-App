import { CLINICAL_PAIRINGS, vaccinePairingFailure } from '../../shared/vaccinePairing';
import type { GeneralComparisonItem } from './generalAuditor';
import {generalAccessoryIdentity,type GeneralAccessoryCatalog} from '../../shared/generalAccessoryCatalog';

/** Fulfilment pairing is independent of what the customer called the companion. */
export function applyGeneralVaccinePairing(items: GeneralComparisonItem[], normalize: (name: string) => string,context?:GeneralAccessoryCatalog): GeneralComparisonItem[] {
  const result = [...items];
  const identities = new Map(Object.entries(CLINICAL_PAIRINGS).flatMap(([primary, pairing]) =>
    [primary, pairing.accessoryCanonical].map(name => [normalize(name), name] as const)));
  // Older audits key products by normalized name; catalogue audits key them by
  // product ID. Bind verified names to the same existing pairing configuration.
  const canonical = (item: GeneralComparisonItem) => {
    if(context){
      const fs=item.provenance.filter(p=>p.source==='fulfillment_confirmation');
      const matches=fs.map(p=>p.canonicalId?generalAccessoryIdentity(context,p.name,p.canonicalId):undefined);
      return matches.length&&matches[0]&&matches.every(m=>m?.canonical===matches[0]?.canonical)?matches[0].canonical:undefined;
    }
    return item.status === 'product identity discrepancy' ? undefined : identities.get(item.fulfillment.key) || identities.get(normalize(item.name));
  };
  for (const [primaryName, pairing] of Object.entries(CLINICAL_PAIRINGS)) {
    const primaryIndex = result.findIndex(item => canonical(item) === primaryName);
    const companionIndex = result.findIndex(item => canonical(item) === pairing.accessoryCanonical);
    if (primaryIndex < 0 && companionIndex < 0) continue;
    const primary = result[primaryIndex];
    let companion = result[companionIndex];
    const supplied = primary?.fulfillment.supplied || 0;
    const primaryQuantity = primary?.fulfillment.suppliedUnit === 'dose' ? supplied / pairing.dosesPerVial : supplied;
    const companionQuantity = companion?.fulfillment.supplied || 0;
    if(context&&primaryQuantity>0&&companionIndex<0&&result.some(item=>item.provenance.some(p=>{
      const hint=p.source==='fulfillment_confirmation'&&generalAccessoryIdentity(context,p.name);
      return hint&&hint.role==='accessory'&&hint.family===primaryName&&!canonical(item);
    })))continue; // Present but unresolved accessory identity needs review, not a missing warning.
    if (primaryQuantity > 0 && companion && !companion.provenance.some(product => product.source === 'customer_request')) {
      // The Vaccine Checker permits a required companion without an explicit
      // customer request. Its actual quantity is still checked below.
      companion = { ...companion, status: companionQuantity > 0 ? 'match' : 'out of stock',
        action: `Required ${pairing.type} for ${primaryName}; fulfilment quantities are checked together.`,
        fulfillment: { ...companion.fulfillment, fulfillmentStatus: companionQuantity > 0 ? 'fully supplied' : 'out of stock',
          orderLimitEligible: false, vaccineCompanionFor: primaryName } };
      result[companionIndex] = companion;
    }
    if (primary?.status === 'out of stock' && companion && companionQuantity === 0 && companion.status === 'missing item') {
      result[companionIndex] = { ...companion, status: 'out of stock',
        action: `${pairing.name} is not required because ${primaryName} was not supplied.`,
        fulfillment: { ...companion.fulfillment, fulfillmentStatus: 'out of stock', orderLimitEligible: false } };
    }
    const failure = vaccinePairingFailure(primaryQuantity, companionQuantity);
    if (!failure) continue;
    const message = failure === 'missing' ? `Required ${pairing.type} missing: ${pairing.name} is required for ${primaryQuantity} ${primaryName}.` :
      failure === 'quantity' ? `Vaccine companion quantity mismatch: ${primaryName} supplied ${primaryQuantity} vials, but ${pairing.name} supplied ${companionQuantity}. They must match 1:1.` :
      `Orphan ${pairing.type}: ${pairing.name} was supplied (${companionQuantity}) without ${primaryName}.`;
    const index = failure === 'orphan' ? companionIndex : primaryIndex;
    const item = result[index];
    result[index] = { ...item, status: 'vaccine pairing mismatch', action: message,
      fulfillment: { ...item.fulfillment, fulfillmentStatus: 'discrepancy', orderLimitEligible: false,
        vaccinePairingError: message } };
  }
  return result;
}
