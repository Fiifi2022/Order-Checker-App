import { CLINICAL_PAIRINGS } from './audit-contract.js';

// Filter presentation only. The original audit still validates the entire order.
export function auditedFulfillmentItems(items) {
  const present = new Set(items.filter(item => item.fsPresent === true || Number(item.fsQty) > 0).map(item => item.vaccine));
  const relevant = new Set(present);
  for (const name of present) {
    const pairing = CLINICAL_PAIRINGS[name];
    if (pairing) relevant.add(pairing.accessoryCanonical);
  }
  return items.filter(item => relevant.has(item.vaccine));
}
