import { assignedRoles } from '../shared/roles';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

export interface AuthProfile {
  id: string; email: string; name: string; role: string; roles?: string[]; district: string; createdAt: string;
}
export const actorContext = new AsyncLocalStorage<AuthProfile>();
export function canAccess(role: string | readonly string[], method: string, path: string): boolean {
  if (Array.isArray(role)) return role.some(value => canAccess(value, method, path));
  if (!assignedRoles({ role: role as string }).length) return false;
  if (path === '/roles/switch') return false;
  if (role === 'admin') return true;
  if (path === '/admin' || path.startsWith('/admin/')) return false;
  if (path.startsWith('/roles') && method !== 'GET') return false;
  const blueprintPath = /^\/vaccine\/(?:blueprint(?:[/-]|$)|allocations\/(?:upload|clear|reset-demo|[^/]+\/topup)$|adjust$|aliases$|facilities\/)/.test(path);
  if (blueprintPath && ['warehouse', 'dco', 'auditor'].includes(role as string)) return true;
  if (blueprintPath && method !== 'GET') return false;
  if (path === '/products/hints' && method === 'POST') return true;
  if (path === '/products' || path.startsWith('/products/')) return method === 'GET' || ['warehouse', 'dco', 'auditor'].includes(role as string);
  if (/clear|reset-demo/.test(path)) return false;
  if (method === 'GET') return true;
  if (['/activity/log', '/verify', '/scan-screenshot', '/vaccine/validate'].includes(path)) return true;
  if (method === 'POST' && /^\/audits\/[^/]+\/order-limit$/.test(path)) return true;
  if (role === 'auditor') return false;
  if (/topup|\/adjust$|dhd-inventory\/stock/.test(path)) return ['warehouse', 'dco'].includes(role as string);
  if (/blueprint|\/upload$|\/facilities\//.test(path)) return false;
  return ['cca', 'warehouse', 'dco'].includes(role as string);
}
export function createAuthentication(
  verify: (token: string) => Promise<any>,
  findProfile: (email: string) => Promise<AuthProfile | null>,
): RequestHandler {
  return async (req, res, next) => {
    if (req.path === '/health' && req.method === 'GET') { next(); return; }
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization || '');
    if (!match) { res.status(401).json({ error: 'Sign in to continue.' }); return; }
    let identity: any;
    try { identity = await verify(match[1]); }
    catch { res.status(401).json({ error: 'Your session has expired. Please sign in again.' }); return; }
    const registrationRequest = (req.path === '/auth/register' && req.method === 'POST') || (req.path === '/auth/registration' && req.method === 'GET');
    if (registrationRequest) {
      if (!identity.uid || !identity.email || identity.firebase?.sign_in_provider === 'anonymous') {
        res.status(403).json({ error: 'Sign in with an email account to complete your profile.' }); return;
      }
      res.locals.identity = identity;
      next(); return;
    }
    if (!identity.email || identity.email_verified !== true || identity.firebase?.sign_in_provider === 'anonymous') {
      res.status(403).json({ error: 'A verified email account is required.' }); return;
    }
    let profile: AuthProfile | null;
    try { profile = await findProfile(identity.email.toLowerCase()); }
    catch { res.status(503).json({ error: 'Account access could not be verified. Please retry.' }); return; }
    if (!profile || !assignedRoles(profile).length) {
      res.status(403).json({ error: 'Your account has not been granted access. Contact an administrator.' }); return;
    }
    if (!canAccess(assignedRoles(profile), req.method, req.path)) {
      res.status(403).json({ error: 'Your role does not permit this action.' }); return;
    }
    res.locals.authUser = profile;
    // Never accept a caller-supplied operating identity for writes.
    if (req.body && typeof req.body === 'object') {
      req.body.actor = profile;
      req.body.user = profile.name;
      req.body.ccaUser = profile.name;
      req.body.addedBy = profile.name;
    }
    actorContext.run(profile, next);
  };
}
