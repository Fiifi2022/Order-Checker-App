import * as vaccines from './vaccineService';
import { normalizeFacilityName } from './blueprintFacility';

export class CompanionFacilityError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Stable selected IDs take precedence. Never fall back from a stale ID to a name.
export function resolveCompanionFacility(body: any, confirmation: string) {
  const facilities = vaccines.getAllFacilities();
  let candidates: vaccines.FacilityAllocationRecord[];
  if (body.facilityId && body.facilityId !== 'auto') {
    candidates = facilities.filter(facility => facility.id === body.facilityId);
  } else {
    const name = body.facilityName || vaccines.extractFacilityFromText(confirmation);
    if (!name) throw new CompanionFacilityError(400, 'Select a facility or include its name in the fulfilment confirmation.');
    candidates = facilities.filter(facility => normalizeFacilityName(facility.facilityName) === normalizeFacilityName(name));
  }
  const sheetId = body.blueprintSheetId || body.sheetId;
  candidates = candidates.filter(facility => (!sheetId || facility.sourceSheetId === sheetId) &&
    (!body.district || normalizeFacilityName(facility.district) === normalizeFacilityName(body.district)) &&
    (!body.allocationCycle || facility.cycle === body.allocationCycle));
  if (candidates.length > 1) throw new CompanionFacilityError(409, 'Multiple matching facilities found. Select the exact facility, district and allocation cycle.');
  const facility = candidates[0];
  if (!facility?.sourceSheetId) throw new CompanionFacilityError(404, 'The selected facility was not found in the current Allocation Blueprint. Reload facilities and select the correct cycle.');
  return facility;
}

export function companionFacilityErrors(facility: vaccines.FacilityAllocationRecord, customer: string, confirmation: string, requireConfirmationFacility = true) {
  const errors: string[] = [];
  const fsName = vaccines.extractFacilityFromText(confirmation);
  const customerName = vaccines.extractFacilityFromText(customer);
  if (!fsName && requireConfirmationFacility) errors.push('FACILITY ERROR: The fulfilment confirmation does not identify the selected facility.');
  for (const [label, name] of [['Fulfilment confirmation', fsName], ['Customer request', customerName]]) {
    if (name && normalizeFacilityName(name) !== normalizeFacilityName(facility.facilityName)) {
      errors.push(`FACILITY MISMATCH: ${label} identifies "${name}", but the selected Blueprint facility is "${facility.facilityName}".`);
    }
  }
  return errors;
}
