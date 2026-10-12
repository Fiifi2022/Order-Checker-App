import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import * as vaccines from './vaccineService';
import { persistBlueprintConfirmation, blueprintSaveError } from './blueprintConfirmation';
import { FACILITY_NOT_FOUND, FACILITY_AMBIGUOUS } from './blueprintFacility';
import { canAccess } from './auth';
import { assignedRoles } from '../shared/roles';
import { normalizeCompanionAuditMode, companionVerificationReference, type CompanionVerificationResponse } from '../shared/companionAudit';
import { CompanionFacilityError, companionFacilityErrors, resolveCompanionFacility } from './companionFacility';

type Storage = Pick<Parameters<typeof persistBlueprintConfirmation>[0], 'db' | 'doc' | 'runTransaction' | 'clean' | 'productKey' | 'progress' | 'debug'>;
class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new RequestError(status, message); };
const stableText = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
export function companionOrderId(facilityId: string, confirmation: string) {
  return 'EXT-' + createHash('sha256').update(JSON.stringify([facilityId, stableText(confirmation)])).digest('hex');
}
export function suppliedItems(audit: ReturnType<typeof vaccines.validateVaccineOrder>) {
  return audit.items.filter(item => item.fsQty > 0).map(item => ({ vaccine: item.vaccine, currentOrder: item.fsQty }));
}

// The browser sends source evidence; only the server decides the deduction items.
export function companionVaccineHandlers(deps: {
  refresh: () => Promise<void>;
  verifyFacility?: (facility: vaccines.FacilityAllocationRecord) => Promise<void> | void;
  storage: () => Storage;
  publish: (committed: Awaited<ReturnType<typeof persistBlueprintConfirmation>>) => void;
  activity?: (event: 'verified' | 'confirmed', data: any, actor: any) => any;
  publishActivity?: (record: any) => void;
}) {
  const respond = (res: any, error: any) => {
    const known = blueprintSaveError(error);
    const status = error instanceof RequestError || error instanceof CompanionFacilityError ? error.status : known === FACILITY_NOT_FOUND ? 404 : known === FACILITY_AMBIGUOUS || /^ALLOCATION |^This audit ID belongs/.test(known) ? 409 : 503;
    const message = error instanceof RequestError || error instanceof CompanionFacilityError ? error.message : status !== 503 ? known :
      'Allocation verification or storage is unavailable. No new deduction was confirmed. Keep this order and retry with the same audit ID.';
    return res.status(status).json({ error: message,
      allMatch: false, items: [], discrepancies: [message], auditStatus: 'requires_review' });
  };
  const verify: RequestHandler = async (req, res) => {
    try {
      const body = req.body || {};
      const auditMode = normalizeCompanionAuditMode(body.auditMode);
      if (!auditMode) fail(400, 'Unsupported audit mode. Use whatsapp_and_fulfillment or fulfillment_only.');
      const orderSource = auditMode === 'fulfillment_only' ? 'fs_only' : 'whatsapp';
      const fs = body.fulfillmentConfirmation;
      const wa = orderSource === 'fs_only' ? '' : body.whatsappMessage;
      if (typeof fs !== 'string' || !fs.trim() || (orderSource === 'whatsapp' && (typeof wa !== 'string' || !wa.trim()))) fail(400, 'Fulfilment confirmation is required; customer comparison also requires a customer request.');
      await deps.refresh();
      const facility = resolveCompanionFacility(body, fs);
      await deps.verifyFacility?.(facility);
      const orderId = companionOrderId(facility.id, fs);
      let auditRecord: vaccines.VaccineAuditLogRecord | undefined;
      const audit = vaccines.validateVaccineOrder({ facilityId: facility.id, orderSource, whatsappMessage: wa, fulfillmentConfirmation: fs,
        checkId: orderId, recordAudit: false, onAudit: record => { auditRecord = record; } });
      const facilityErrors = companionFacilityErrors(facility, wa, fs);
      if (!audit.facilityMismatch) for (const error of facilityErrors) audit.errors.push(error);
      if (facilityErrors.length) { audit.isValid = false; audit.facilityMismatch = true; }
      const items = suppliedItems(audit);
      const needsReview = audit.warnings.some(warning => /requires confirmation|fuzzy/i.test(warning));
      const canAuthorize = canAccess(assignedRoles(res.locals.authUser), 'POST', '/vaccine/allocations/commit');
      const checksPassed = audit.isValid && !needsReview && items.length > 0 && items.every(item => Number.isSafeInteger(item.currentOrder));
      const canCommit = canAuthorize && checksPassed;
      // Transactions are authoritative after a lost response or popup reload.
      const evidence = {
        orderId, facilityId: facility.id, sheetId: facility.sourceSheetId, rowId: facility.sourceRowId,
        ownerId: res.locals.authUser.id, orderSource, whatsappMessage: wa, fulfillmentConfirmation: fs,
        items, createdAt: new Date().toISOString(), approved: true
      };
      const storage = deps.storage();
      const activity = deps.activity?.('verified', { ...audit, isValid: audit.isValid && !needsReview, orderId, facilityId: facility.id }, res.locals.authUser);
      let sameEvidence = false;
      const previous = await storage.runTransaction(storage.db, async tx => {
        const saved = await tx.get(storage.doc(storage.db, 'vaccine_transactions', orderId));
        const approved = await tx.get(storage.doc(storage.db, 'vaccine_verified_orders', orderId));
        if (saved.exists()) {
          sameEvidence = approved.exists() && approved.data().orderSource === orderSource && stableText(approved.data().whatsappMessage) === stableText(wa);
          return saved.data();
        }
        if (canCommit) {
          if (approved.exists()) {
            const existing = approved.data();
            if (existing.ownerId !== evidence.ownerId) fail(403, 'This fulfilment event is already being reviewed by another account.');
            if (existing.orderSource !== orderSource || existing.whatsappMessage !== wa) fail(409, 'This fulfilment event already has a verified customer request. Use the original audit mode and request.');
          } else tx.set(storage.doc(storage.db, 'vaccine_verified_orders', orderId), storage.clean(evidence));
        }
        if (activity) tx.set(storage.doc(storage.db, 'activity_logs', activity.id), storage.clean(activity));
        return null;
      });
      if (!previous && activity) deps.publishActivity?.(activity);
      if (!previous && auditRecord) vaccines.publishVaccineAudit({ ...auditRecord, ccaUser: res.locals.authUser.name,
        auditResult: checksPassed ? 'GREEN_LIGHT' : 'DO_NOT_PROCESS', errorsDetected: [...audit.errors] });
      const receipt = previous && sameEvidence ? { ...audit, isValid: true, errors: [], warnings: [], duplicateWarning: undefined,
        orderSource: previous.source, items: previous.items.map((item: any) => ({ vaccine: item.vaccine, fsQty: item.currentOrder,
          requestedQty: item.requestedQty, remainingBefore: item.remainingAfter + item.currentOrder, remainingAfter: item.remainingAfter, status: 'valid' })) } : audit;
      const allMatch = previous && sameEvidence ? true : checksPassed;
      const discrepancies = [...receipt.errors, ...(!allMatch && needsReview ? receipt.warnings : [])];
      if (!allMatch && !discrepancies.length) discrepancies.push('No positive, verified fulfilment quantities were found. Review the confirmation.');
      const response: CompanionVerificationResponse = { ...receipt,
        id: orderId, auditId: orderId, verificationId: orderId, auditMode, allMatch, discrepancies, issueCount: discrepancies.length,
        verdict: allMatch ? 'All required audit checks passed.' : 'Audit failed or requires review. Do not dispatch.',
        items: receipt.items.map(item => ({ ...item, name: item.vaccine, requested: String(item.requestedQty), found: String(item.fsQty),
          vaccineStatus: item.status, status: item.status === 'valid' || item.status === 'not_in_order' ? 'match' : item.status.replace(/_/g, ' '),
          action: item.errorDetail || (item.errors || []).join(' | ') || item.warningDetail || '',
          category: item.productType === 'DILUENT' || item.productType === 'DROPPER' ? 'Vaccine Companion' : item.productType === 'OTHER_ACCESSORY' ? 'Consumable' : 'Vaccine' })),
        facilityId: facility.id, facilityName: facility.facilityName, orderId, canAuthorize, canCommit: canCommit && !previous,
        auditStatus: allMatch ? 'passed' : needsReview ? 'requires_review' : 'failed',
        allocationStatus: previous ? 'deducted' : canCommit ? 'ready' : 'awaiting_confirmation', transaction: previous };
      res.json(response);
    } catch (error) { respond(res, error); }
  };
  const commit: RequestHandler = async (req, res) => {
    try {
      if (!res.locals.authUser) fail(401, 'Sign in to confirm FS entry.');
      if (!canAccess(assignedRoles(res.locals.authUser), 'POST', '/vaccine/allocations/commit')) fail(403, 'Your role does not permit fulfilment confirmation.');
      const id = companionVerificationReference(req.body);
      if (!id) fail(400, 'A saved vaccine verification reference is required. Run Audit & Update Allocation again; do not use an FS shipment reference.');
      await deps.refresh();
      const storage = deps.storage();
      // Read inside the transaction again before writing; this first read only resolves routing.
      const evidenceSnapshot = await storage.runTransaction(storage.db, async tx => tx.get(storage.doc(storage.db, 'vaccine_verified_orders', id)));
      if (!evidenceSnapshot.exists()) fail(404, 'Verified order not found. Run the audit before confirming fulfilment.');
      const evidence = evidenceSnapshot.data();
      if (evidence.orderId !== id || typeof evidence.fulfillmentConfirmation !== 'string' || !evidence.fulfillmentConfirmation.trim() || !Array.isArray(evidence.items) || !evidence.items.length) fail(409, 'The verification reference does not match the saved fulfilment evidence. Run the vaccine allocation audit again.');
      if (!evidence.approved || evidence.ownerId !== res.locals.authUser.id) fail(403, 'This order was not approved for your account.');
      if (req.body.facilityId !== evidence.facilityId) fail(409, 'The selected facility differs from the verified order.');
      const facility = vaccines.getFacilityById(evidence.facilityId);
      if (!facility) fail(404, 'The audited facility is no longer in the Allocation Blueprint.');
      const committed = await persistBlueprintConfirmation({ ...storage, facility,
        context: { facilityName: facility.facilityName, sheetId: evidence.sheetId, rowId: evidence.rowId, district: facility.district, cycle: facility.cycle },
        params: { facilityId: facility.id, orderSource: evidence.orderSource, items: evidence.items,
          ccaUser: res.locals.authUser.name, orderId: id, rawOrderText: evidence.whatsappMessage, rawFsText: evidence.fulfillmentConfirmation },
        activity: result => deps.activity?.('confirmed', result, res.locals.authUser),
        authorize: async (tx, snapshot, alreadyCommitted) => {
          const approved = await tx.get(storage.doc(storage.db, 'vaccine_verified_orders', id));
          if (!approved.exists() || JSON.stringify(approved.data()) !== JSON.stringify(evidence)) fail(409, 'The verified order changed. Run the audit again.');
          if (alreadyCommitted) return;
          const audit = vaccines.validateVaccineOrder({ facilitySnapshot: snapshot, recordAudit: false, facilityId: facility.id, orderSource: evidence.orderSource,
            whatsappMessage: evidence.whatsappMessage, fulfillmentConfirmation: evidence.fulfillmentConfirmation });
          if (!audit.isValid || audit.warnings.some(w => /requires confirmation|fuzzy/i.test(w)) || JSON.stringify(suppliedItems(audit)) !== JSON.stringify(evidence.items)) fail(409, 'The order or allocation changed. No deduction was applied. Run the audit again.');
        }
      });
      deps.publish(committed);
      const activity = deps.activity?.('confirmed', committed.result, res.locals.authUser);
      if (activity) deps.publishActivity?.(activity);
      res.json({ ...committed.result, orderId: id, facilityId: facility.id, allocationStatus: 'deducted', updatedBlueprint: { districtId: committed.sheet.id, row: committed.sheet.rows[committed.rowIndex] } });
    } catch (error) { respond(res, error); }
  };
  const status: RequestHandler = async (req, res) => {
    try {
      if (!res.locals.authUser) fail(401, 'Sign in to check fulfilment confirmation.');
      if (!canAccess(assignedRoles(res.locals.authUser), 'POST', '/vaccine/allocations/commit')) fail(403, 'Your role does not permit fulfilment confirmation.');
      const id = companionVerificationReference({ orderId: req.params.orderId });
      if (!id) fail(400, 'A saved vaccine verification reference is required. Run the vaccine allocation audit again.');
      const storage = deps.storage();
      const saved = await storage.runTransaction(storage.db, async tx => {
        const approval = await tx.get(storage.doc(storage.db, 'vaccine_verified_orders', id));
        if (!approval.exists()) fail(404, 'Verified order not found. Run the audit before confirming fulfilment.');
        const evidence = approval.data();
        if (!evidence.approved || evidence.ownerId !== res.locals.authUser.id) fail(403, 'This order was not approved for your account.');
        const committed = await tx.get(storage.doc(storage.db, 'vaccine_transactions', id));
        const transaction = committed.exists() ? committed.data() : null;
        if (transaction && (transaction.facilityId !== evidence.facilityId || transaction.sourceSheetId !== evidence.sheetId)) fail(409, 'The saved deduction does not belong to this verified facility and Blueprint.');
        const allocation = transaction ? await tx.get(storage.doc(storage.db, 'vaccine_allocations', evidence.facilityId)) : null;
        // The persisted transaction proves the atomic deduction. A missing
        // later projection must not erase that receipt or provoke another write.
        return { orderId: id, facilityId: evidence.facilityId, allocationStatus: transaction ? 'deducted' : 'awaiting_confirmation',
          success: !!transaction, transaction, updatedFacility: allocation?.exists() ? allocation.data() : null };
      });
      res.json(saved);
    } catch (error) { respond(res, error); }
  };
  return { verify, commit, status };
}
