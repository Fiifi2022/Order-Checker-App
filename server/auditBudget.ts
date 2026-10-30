import type { RequestHandler } from 'express';
import { AUDIT_SERVER_BUDGET_MS, AUDIT_TIMEOUT_MESSAGE, AuditTiming, auditTimeoutSetting, waitForAudit } from '../shared/auditPerformance';
const contexts = new WeakMap<object, { deadline: number; controller: AbortController; timing: AuditTiming }>();
export const isAuditRequest = (method: string, path: string) => method === 'POST' && ['/verify', '/vaccine/validate'].includes(path.toLowerCase().replace(/\/+$/, ''));
export function auditDeadlineError() { return Object.assign(new Error(AUDIT_TIMEOUT_MESSAGE), { code: 'AUDIT_TIMEOUT', status: 503 }); }
export function createAuditBudget(milliseconds = auditTimeoutSetting(process.env.AUDIT_HARD_TIMEOUT_MS, AUDIT_SERVER_BUDGET_MS), diagnostics = process.env.AUDIT_PERFORMANCE_LOG === 'true'): RequestHandler {
  return (req, res, next) => {
    if (!isAuditRequest(req.method, req.path)) { next(); return; }
    const controller = new AbortController(), timing = new AuditTiming(diagnostics);
    contexts.set(req, { deadline: performance.now() + milliseconds, controller, timing });
    const timer = setTimeout(() => controller.abort(auditDeadlineError()), milliseconds);
    timer.unref?.();
    const disconnect = () => { if (!res.writableFinished) controller.abort(new DOMException('Request cancelled', 'AbortError')); cleanup(); };
    const finish = () => {
      timing.record('apiResponse', timing.snapshot().elapsedMs);
      timing.record('total', timing.snapshot().elapsedMs);
      if (diagnostics) console.info('[Audit performance]', { ...timing.snapshot(), status: res.statusCode });
      cleanup();
    };
    const cleanup = () => { clearTimeout(timer); req.removeListener?.('aborted', disconnect); res.removeListener?.('close', disconnect); res.removeListener?.('finish', finish); };
    req.once?.('aborted', disconnect);
    res.once?.('close', disconnect);
    res.once?.('finish', finish);
    next();
  };
}
export const startAuditBudget = createAuditBudget();
export const auditSignal = (req: object) => contexts.get(req)?.controller.signal;
export const auditTiming = (req: object) => contexts.get(req)?.timing;
export function auditRemainingMs(req: object) {
  const context = contexts.get(req);
  return context?.controller.signal.aborted ? 0 : Math.max(0, (context?.deadline ?? performance.now() + AUDIT_SERVER_BUDGET_MS) - performance.now());
}
export async function auditReadBudget<T>(req: object, task: () => Promise<T>): Promise<T> {
  const context = contexts.get(req);
  if (!context) return task();
  if (auditRemainingMs(req) <= 0) throw context.controller.signal.reason || auditDeadlineError();
  const result = await waitForAudit(task(), context.controller.signal);
  if (auditRemainingMs(req) <= 0) throw context.controller.signal.reason || auditDeadlineError();
  return result;
}
/** Cancels SDK work on its own deadline or when the caller disconnects. */
export async function optionalAuditAi<T>(task: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  if (milliseconds <= 0) throw auditDeadlineError();
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason);
  if (parent?.aborted) cancel();
  parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(auditDeadlineError()), milliseconds);
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    return await waitForAudit(task(controller.signal), controller.signal);
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', cancel); }
}

/** One allowance across sequential optional stages, rather than one per model call. */
export function sharedOptionalAuditBudget(milliseconds: number) {
  let deadline: number | undefined;
  return () => {
    deadline ??= performance.now() + Math.max(0, milliseconds);
    return Math.max(0, deadline - performance.now());
  };
}

/** Let an already-authorized write finish; report pending until it actually settles. */
export async function waitForOptionalAuditWrite<T>(task: Promise<T>, milliseconds: number): Promise<{completed: true; value: T} | {completed: false}> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task.then(value => ({completed: true as const, value})),
      new Promise<{completed: false}>(resolve => {timer = setTimeout(() => resolve({completed: false}), Math.max(0, milliseconds));}),
    ]);
  } finally {clearTimeout(timer);}
}
