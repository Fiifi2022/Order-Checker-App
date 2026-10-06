import * as vaccineService from './vaccineService';
import { resolveBlueprintFacility, normalizeFacilityName, FACILITY_NOT_FOUND, FACILITY_AMBIGUOUS, type BlueprintFacilityContext } from './blueprintFacility';

export function blueprintFacilitySnapshot(facility: vaccineService.FacilityAllocationRecord, sheet: any, row: any) {
  const snapshot = structuredClone(facility);
  snapshot.sourceSheetId = sheet.id;
  snapshot.sourceRowId = row.id;
  snapshot.vaccines = {};
  for (const [name, data] of Object.entries(row.vaccines || {})) {
    const value: any = data || {};
    const canonical = vaccineService.matchVaccineName(name).canonical;
    const carryOver = Number(value.carryOver) || 0;
    const original = Number(value.allocation) || 0;
    const taken = Number(value.distributed) || 0;
    const remaining = value.balance !== undefined && value.balance !== '' ? Number(value.balance) : Math.max(0, carryOver + original - taken);
    if (!Number.isFinite(remaining)) throw new Error('Invalid Blueprint balance. Correct the sheet before retrying.');
    if (snapshot.vaccines[canonical]) throw new Error('Duplicate vaccine columns found in the facility row. Correct the sheet before retrying.');
    snapshot.vaccines[canonical] = vaccineService.buildVaccineDetail(canonical, {original,carryOver,taken,remaining,takenHistory:value.takenHistory});
  }
  return snapshot;
}

// All computation inside the Firestore callback is staged. No live ledger or UI
// state is published until runTransaction resolves after the atomic commit.
export async function persistBlueprintConfirmation(options: {
  facility: vaccineService.FacilityAllocationRecord;
  context: BlueprintFacilityContext;
  params: Parameters<typeof vaccineService.confirmVaccineOrder>[0];
  db: any;
  doc: (...args: any[]) => any;
  runTransaction: (db: any, callback: (transaction: any) => Promise<any>) => Promise<any>;
  clean: (data: any) => any;
  productKey: (vaccines: any, name: string, products: string[]) => string;
  progress: (row: any, products: string[]) => string;
  debug: (details: Record<string, unknown>) => void;
}) {
  const {facility,context,params,db,doc,runTransaction,clean,productKey,progress,debug} = options;
  const sheetId = context.sheetId || context.selectedSheetId!;
  const sheetRef = doc(db,'vaccine_districts',sheetId);
  const allocationRef = doc(db,'vaccine_allocations',facility.id);
  const transactionRef = doc(db,'vaccine_transactions',params.orderId!);
  return runTransaction(db, async transaction => {
    const savedSheet = await transaction.get(sheetRef);
    const savedTransaction = await transaction.get(transactionRef);
    if (!savedSheet.exists()) throw new Error(FACILITY_NOT_FOUND);
    const sheet = structuredClone({...savedSheet.data(),id:sheetId});
    let target;
    try { target = resolveBlueprintFacility([sheet], {...context,sheetId}); }
    catch (error: any) { debug({candidateCount:error.candidateCount || 0,save:'rejected'}); throw error; }
    debug({candidateCount:target.candidateCount,resolvedDocumentId:sheetId,rowId:target.row.id || null,rowIndex:target.rowIndex,save:'pending'});
    const snapshot = blueprintFacilitySnapshot(facility,sheet,target.row);
    if (savedTransaction.exists()) {
      const previous = savedTransaction.data();
      if (previous.sourceSheetId !== sheetId || previous.facilityId !== facility.id ||
          normalizeFacilityName(previous.facilityName) !== normalizeFacilityName(facility.facilityName) ||
          (context.rowId && previous.sourceRowId !== context.rowId)) {
        throw new Error('This audit ID belongs to a different facility or Blueprint. Run the audit again.');
      }
      return {result:{success:true,transaction:previous,updatedFacility:snapshot},sheet,rowIndex:target.rowIndex};
    }

    const result = await vaccineService.confirmVaccineOrder({...params,facilitySnapshot:snapshot,deferCommit:true});
    if (!result.success || !result.updatedFacility || !result.transaction) throw new Error(result.error || 'The allocation could not be updated.');
    const row = target.row;
    const products = sheet.products || Object.keys(row.vaccines || {});
    for (const item of result.transaction.items) {
      const name = item.vaccine;
      const allocation = result.updatedFacility.vaccines[name];
      const key = productKey(row.vaccines,name,products);
      const value = row.vaccines[key];
      // Preserve original allocation/carry-over and append the service's arithmetic history.
      if (value) Object.assign(value,{distributed:allocation.taken,balance:allocation.remaining,takenHistory:allocation.takenHistory});
    }
    const today = new Date().toISOString().slice(0,10);
    const status = progress(row,products);
    const processing = String(row.processing || '').trim();
    const hasDate = processing && !/pending|completed/i.test(processing);
    row.processing = status === 'pending' ? '' : hasDate ? processing : today;
    row.completed = status === 'completed' ? row.completed || today : '';
    sheet.updatedAt = new Date().toISOString();
    transaction.set(sheetRef,clean(sheet),{merge:true});
    transaction.set(allocationRef,clean(result.updatedFacility),{merge:true});
    transaction.set(transactionRef,clean(result.transaction));
    return {result,sheet,rowIndex:target.rowIndex};
  });
}

export function blueprintSaveError(error: any): string {
  const message = String(error?.message || '');
  if ([FACILITY_NOT_FOUND,FACILITY_AMBIGUOUS].includes(message)) return message;
  if (/^(ALLOCATION (ERROR|CHANGED):|Invalid Blueprint balance\.|Duplicate vaccine columns found|This audit ID belongs)/.test(message)) return message;
  return 'Could not save the order to Firestore. No deduction was applied. Your order is preserved; please retry.';
}
