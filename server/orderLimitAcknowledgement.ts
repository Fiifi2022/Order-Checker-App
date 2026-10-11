import type { RequestHandler } from 'express';
import { acknowledgeOrderLimit } from '../shared/orderLimitAcknowledgement';

export function orderLimitAcknowledgementHandler(deps: { read: (id: string) => Promise<any>; save: (record: any) => Promise<void> }): RequestHandler {
  const pending = new Map<string, Promise<void>>();
  return async (req, res) => {
    const { key, answer } = req.body || {};
    if (typeof key !== 'string' || !key || key.length > 1000 || typeof answer !== 'boolean') { res.status(400).json({ error: 'Choose an eligible product and answer Yes or No.' }); return; }
    const id = req.params.id;
    const previous = pending.get(id);
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    pending.set(id, current);
    await previous;
    try {
      const record = await deps.read(req.params.id);
      if (!record) { res.status(404).json({ error: 'Audit record not found.' }); return; }
      if (!record.generalAudit || !record.items?.some((item: any) => item.fulfillment?.key === key && item.fulfillment.orderLimitEligible)) {
        res.status(400).json({ error: 'This product is not eligible for an order-limit acknowledgement.' }); return;
      }
      const updated = acknowledgeOrderLimit(record, key, answer);
      await deps.save(updated);
      res.json({ acknowledged: true });
    } catch { res.status(503).json({ error: 'Acknowledgement could not be saved. Your current result remains available.' }); }
    finally { release(); if (pending.get(id) === current) pending.delete(id); }
  };
}
