import { CLINICAL_PAIRINGS, vaccinePairingFailure } from '../../shared/vaccinePairing';
import type { GeneralComparisonItem } from './generalAuditor';

/** Fulfilment pairing is independent of what the customer called the companion. */
export function applyGeneralVaccinePairing(items: GeneralComparisonItem[], normalize: (name: string) => string): GeneralComparisonItem[] {
  const result = [...items];
  const identities = new Map(Object.entries(CLINICAL_PAIRINGS).flatMap(([primary, pairing]) =>
    [primary, pairing.accessoryCanonical].map(name => [normalize(name), name] as const)));
  const canonical = (item: GeneralComparisonItem) => identities.get(item.fulfillment.key);
  for (const [primaryName, pairing] of Object.entries(CLINICAL_PAIRINGS)) {
    const primaryIndex = result.findIndex(item => canonical(item) === primaryName);
    const companionIndex = result.findIndex(item => canonical(item) === pairing.accessoryCanonical);
    if (primaryIndex < 0 && companionIndex < 0) continue;
    const primary = result[primaryIndex];
    let companion = result[companionIndex];
    const supplied = primary?.fulfillment.supplied || 0;
    const primaryQuantity = primary?.fulfillment.suppliedUnit === 'dose' ? supplied / pairing.dosesPerVial : supplied;
    const companionQuantity = companion?.fulfillment.supplied || 0;
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
