import type { Request, RequestHandler } from 'express';
import { lookupFsAllocation, activeFsFacilities } from './fsAllocation';

const deadlines = new WeakMap<object, number>();
export const isFsCompanionRead = (path: string) => ['/vaccine/companion/context', '/vaccine/companion/facilities'].includes(path);
export const startFsReadBudget: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' && isFsCompanionRead(req.path)) {
    deadlines.set(req, Date.now() + 7500);
    res.once?.('finish', () => {
      if (![401, 403].includes(res.statusCode)) return;
      let facility: any;
      try { const input = JSON.parse(String(req.query.selection || '')); facility = Object.fromEntries(['name', 'district', 'region'].map(key => [key, String(input.facility?.[key] || '').slice(0, 160)])); } catch {}
      console.info({ event: 'fs_context', facility, status: res.statusCode === 401 ? 'unauthenticated' : 'forbidden', products: [] });
    });
  }
  next();
};
export async function fsReadBudget<T>(req: Request, task: () => Promise<T>): Promise<T> {
  const deadline = deadlines.get(req);
  if (!deadline) return task();
  let timer: ReturnType<typeof setTimeout>;
  const milliseconds = Math.max(0, deadline - Date.now());
  try {
    return await Promise.race([Promise.resolve().then(task), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('FS allocation lookup timed out. Please retry.'), { code: 'FS_CONTEXT_TIMEOUT' })), milliseconds);
    })]);
  } finally { clearTimeout(timer!); }
}

export function fsContextHandlers({ readSheets, readCatalog, applyCatalog, listFacilities = sheets => activeFsFacilities(sheets).map(({ sheet, row, ...facility }) => facility), log = console.info, now = () => new Date() }: {
  readSheets: () => Promise<any[]>; readCatalog: () => Promise<any>; applyCatalog: (catalog: any) => void; listFacilities?: (sheets: any[]) => any[]; log?: (entry: any) => void; now?: () => Date;
}) {
  const read = async (req: Request) => {
    const [sheets, catalog] = await fsReadBudget(req, () => Promise.all([readSheets(), readCatalog()]));
    applyCatalog(catalog);
    return sheets;
  };
  const context: RequestHandler = async (req, res) => {
    const started = Date.now();
    let selection: any;
    let logged = false;
    const report = (entry: any) => { logged = true; log(entry); };
    res.setHeader('Cache-Control', 'no-store');
    try {
      const raw = req.query.selection;
      if (typeof raw !== 'string' || raw.length > 24000) return void res.status(400).json({ error: 'Invalid or oversized FS selection.' });
      try { selection = JSON.parse(raw); } catch { return void res.status(400).json({ error: 'Invalid FS selection.' }); }
      if (!selection || Array.isArray(selection) || typeof selection !== 'object' ||
          (selection.allocationCycle !== undefined && (typeof selection.allocationCycle !== 'string' || selection.allocationCycle.length > 160)) ||
          !Array.isArray(selection.products) || selection.products.length > 101 || selection.products.some((p: any) => !p || typeof p.name !== 'string')) {
        return void res.status(400).json({ error: 'Invalid FS selection. Supply a products array with at most 101 named products.' });
      }
      const result = lookupFsAllocation(await read(req), selection, { automaticCycle: true, now: now() });
      report({ event: 'fs_context', facility: selection.facility, status: result.status, products: result.products.map((p: any) => ({ name: p.name, status: p.status })), durationMs: Date.now() - started });
      res.json(result);
    } catch (error: any) {
      report({ event: 'fs_context', facility: selection?.facility, status: 'error', code: error.code || error.status || 'READ_FAILED', durationMs: Date.now() - started });
      res.status([409, 503].includes(error.status) ? error.status : 503).json({ error: error.message || 'Could not read the current Allocation Blueprint. Please retry.' });
    } finally {
      if (!logged) log({ event: 'fs_context', facility: selection?.facility, status: 'invalid_selection', products: [], durationMs: Date.now() - started });
    }
  };
  const facilities: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // Facility discovery only needs Blueprint rows, never catalogue seeding or AI.
    try { res.json(listFacilities(await fsReadBudget(req,readSheets))); }
    catch (error: any) { res.status(503).json({ error: error.message || 'Could not read the current Allocation Blueprint. Please retry.' }); }
  };
  return { context, facilities };
}
