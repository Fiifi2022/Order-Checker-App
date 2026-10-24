import { generalInputFingerprint, sameGeneralAuditSources } from '../shared/generalAuditFingerprint';
import { generalAuditMutations } from './generalAuditMutation';
import type { RequestHandler } from 'express';
import { applyGeneralProductConfirmation, summarizeGeneralProducts, enforceGeneralProductAssignments } from './generalAuditor';

export function generalProductConfirmationHandler(deps: {
  read: (id: string) => Promise<any>; save: (record: any) => Promise<void>; refreshCatalog?: () => Promise<void>;
}): RequestHandler {
  const pending = generalAuditMutations;
  return async (req, res) => {
    const body = req.body || {};
    if (body.rejectSuggestion !== true && body.customerContactConfirmed !== true || typeof body.key !== 'string' || typeof body.productKey !== 'string' ||
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
      let record = await deps.read(id);
      if (!record?.generalAudit) { res.status(404).json({ error: 'General audit not found.' }); return; }
      if (!sameGeneralAuditSources(record, body) || body.inputFingerprint && body.inputFingerprint !== generalInputFingerprint(record)) {
        res.status(409).json({ error: 'The audit inputs have changed. Run the audit again and reconfirm the product.' }); return;
      }
      await deps.refreshCatalog?.();
      record = enforceGeneralProductAssignments(record, record.whatsappMessage, record.fulfillmentConfirmation);
      const inputFingerprint = generalInputFingerprint(record);
      const previousConfirmation = record.generalAudit.productVerifications?.find((product: any) => (product.key === body.key || product.candidateKeys?.includes(body.key)))?.confirmation;
      if (previousConfirmation && body.rejectSuggestion === true) { res.status(409).json({ error: 'This product is already confirmed. Correct its confirmation instead.' }); return; }
      if (previousConfirmation) {
        if (previousConfirmation.productKey === body.productKey && (!previousConfirmation.inputFingerprint || previousConfirmation.inputFingerprint === inputFingerprint)) {
          res.json(record); return; // Idempotent retry: retain the original actor and timestamp.
        }
        if (body.previousProductKey !== previousConfirmation.productKey) {
          res.status(409).json({ error: 'This confirmation changed. Refresh the audit before correcting it.' }); return;
        }
      }
      let updated: any;
      try {
        const actor = res.locals.authUser;
        if (body.rejectSuggestion === true) {
          const detail = record.generalAudit;
          const target = detail.productVerifications?.find((product: any) => (product.key === body.key || product.candidateKeys?.includes(body.key)));
          if (target?.kind !== 'ai product match' || !target.options.some((option: any) => option.key === body.productKey)) throw Error('Select an available AI suggestion to reject.');
          const productVerifications = detail.productVerifications.map((product: any) => product !== target ? product : { ...product, rejectedSuggestions: [...(product.rejectedSuggestions || []), { productKey: body.productKey, rejectedAt: new Date().toISOString(), rejectedBy: { id: actor.id, name: actor.name } }] });
          updated = { ...record, ...summarizeGeneralProducts(record.items, detail.facility, detail.orderer, detail.phone, detail.productCount.requested, detail.productCount.found, detail.semanticReviews, { ...detail, productVerifications }) };
        } else updated = applyGeneralProductConfirmation({ ...record, inputFingerprint }, body.key, body.productKey, body.customerContactConfirmed,
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
