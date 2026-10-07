import type { RequestHandler } from 'express';

export interface Registration { uid: string; email: string; name: string; position: string; nest: string; createdAt: string; updatedAt: string }
export function registrationFields(body: any) {
  const fields = {} as { name: string; position: string; nest: string };
  for (const key of ['name', 'position', 'nest'] as const) {
    const value = body?.[key];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
      throw new Error(`${key === 'nest' ? 'Nest' : key[0].toUpperCase() + key.slice(1)} must contain 1–100 characters.`);
    }
    fields[key] = value.trim();
  }
  return fields;
}
export function registrationHandlers(store: {
  get: (uid: string) => Promise<Registration | null>;
  save: (uid: string, fields: ReturnType<typeof registrationFields>, email: string) => Promise<Registration>;
}) {
  const get: RequestHandler = async (_req, res) => {
    try { res.json(await store.get(res.locals.identity.uid)); }
    catch { res.status(503).json({ error: 'Could not load your profile. Please retry.' }); }
  };
  const save: RequestHandler = async (req, res) => {
    let fields: ReturnType<typeof registrationFields>;
    try { fields = registrationFields(req.body); }
    catch (error: any) { res.status(400).json({ error: error.message }); return; }
    const identity = res.locals.identity;
    try { res.json(await store.save(identity.uid, fields, identity.email.toLowerCase())); }
    catch { res.status(503).json({ error: 'Could not save your profile. Please retry.' }); }
  };
  return { get, save };
}
