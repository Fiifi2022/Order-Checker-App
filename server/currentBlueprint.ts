import type { RequestHandler } from 'express';

/** A fresh document read for the visible sheet. Never serves an in-memory balance. */
export function currentBlueprintHandler(read: (id: string) => Promise<any | null>): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const id = req.params.id;
    if (typeof id !== 'string' || !id || id.length > 200 || /[\/\x00-\x1f]/.test(id)) {
      res.status(400).json({ error: 'Invalid allocation sheet.' }); return;
    }
    try {
      const sheet = await read(id);
      if (!sheet) { res.status(404).json({ error: 'This allocation sheet no longer exists. Reload the sheet list.' }); return; }
      res.json({ sheet: { ...sheet, id }, checkedAt: new Date().toISOString() });
    } catch { res.status(503).json({ error: 'Live allocation update unavailable. Displayed balances have not been refreshed.' }); }
  };
}
