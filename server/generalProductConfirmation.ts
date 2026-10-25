import { generalInputFingerprint, sameGeneralAuditSources } from '../shared/generalAuditFingerprint';
import { generalAuditMutations } from './generalAuditMutation';
import type { RequestHandler } from 'express';
import { applyGeneralProductConfirmation } from './generalAuditor';

export function generalProductConfirmationHandler(deps: {
  read: (id: string) => Promise<any>; save: (record: any) => Promise<void>; refreshCatalog?: () => Promise<void>;
}): RequestHandler {
  const pending = generalAuditMutations;
  return async (req, res) => {
    const body = req.body || {};
    if (body.customerContactConfirmed !== true || typeof body.key !== 'string' || typeof body.productKey !== 'string' ||
      typeof body.whatsappMessage !== 'string' || typeof body.fulfillmentConfirmation !== 'string') {
      res.status(400).json({ error: 'Select a product and explicitly confirm customer contact.' }); return;
    }
    const id = req.params.id;
    const previous = pending.get(id);
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    pending.set(id, current);
    await previous;
    try {
      const record = await deps.read(id);
      if (!record?.generalAudit) { res.status(404).json({ error: 'General audit not found.' }); return; }
      if (!sameGeneralAuditSources(record, body) || body.inputFingerprint && body.inputFingerprint !== generalInputFingerprint(record)) {
        res.status(409).json({ error: 'The audit inputs have changed. Run the audit again and reconfirm the product.' }); return;
      }
      const inputFingerprint = generalInputFingerprint(record);
      const previousConfirmation = record.generalAudit.productVerifications?.find((product: any) => product.key === body.key)?.confirmation;
      if (previousConfirmation) {
        if (previousConfirmation.productKey === body.productKey && (!previousConfirmation.inputFingerprint || previousConfirmation.inputFingerprint === inputFingerprint)) {
          res.json(record); return; // Idempotent retry: retain the original actor and timestamp.
        }
        if (body.previousProductKey !== previousConfirmation.productKey) {
          res.status(409).json({ error: 'This confirmation changed. Refresh the audit before correcting it.' }); return;
        }
      }
      await deps.refreshCatalog?.();
      let updated: any;
      try {
        const actor = res.locals.authUser;
        updated = applyGeneralProductConfirmation({ ...record, inputFingerprint }, body.key, body.productKey, body.customerContactConfirmed,
          actor ? { id: actor.id, name: actor.name } : undefined);
      } catch (error: any) { res.status(400).json({ error: error.message }); return; }
      updated = { ...updated, finalVerdict: updated.generalAudit.finalStatus, generalCounts: updated.generalAudit.counts,
        resolutionNotes: updated.allMatch ? updated.generalAudit.finalStatus : '', resolvedAt: updated.allMatch ? new Date().toISOString() : null };
      await deps.save(updated);
      res.json(updated);
    } catch { res.status(503).json({ error: 'Product confirmation could not be saved. Please retry before dispatch.' }); }
    finally { release(); if (pending.get(id) === current) pending.delete(id); }
  };
}
