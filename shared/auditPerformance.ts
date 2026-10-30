/** Three seconds is a progress target, never an audit failure. */
export const AUDIT_TARGET_MS = 3000;
export const AUDIT_HARD_TIMEOUT_MS = 20_000;
export const AUDIT_SERVER_BUDGET_MS = 18_000;
export const AUDIT_AI_FALLBACK_MS = 4000;
/** Optional persistence must not delay the verification result. */
export const AUDIT_BACKGROUND_WAIT_MS = 200;
export const AUDIT_DELAY_MESSAGE = 'Your audit is taking slightly longer than expected. Please wait while we complete the verification.';
export const AUDIT_TIMEOUT_MESSAGE = 'The audit could not be completed within the available processing time. Please retry.';
export function auditTimeoutSetting(value: unknown, fallback: number, minimum = 4000, maximum = 60_000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? Math.floor(number) : fallback;
}
export type AuditStage = 'authentication' | 'catalogRead' | 'catalogApply' | 'facilityRecords' | 'facilityIdentification' | 'ordererIdentification' | 'productExtraction' | 'productNormalization' | 'quantityVerification' | 'gemini' | 'finalValidation' | 'deterministic' | 'historyWrite' | 'apiResponse' | 'total';
/** Stores only aggregate durations and counts. No input, IDs, names or errors. */
export class AuditTiming {
  private durations: Partial<Record<AuditStage, number>> = {};
  private counts: Partial<Record<AuditStage, number>> = {};
  private started = performance.now();
  constructor(readonly enabled = false) {}
  measure<T>(stage: AuditStage, task: () => T): T {
    if (!this.enabled) return task();
    const started = performance.now();
    try { return task(); } finally { this.record(stage, performance.now() - started); }
  }
  async measureAsync<T>(stage: AuditStage, task: () => Promise<T>): Promise<T> {
    if (!this.enabled) return task();
    const started = performance.now();
    try { return await task(); } finally { this.record(stage, performance.now() - started); }
  }
  record(stage: AuditStage, ms: number) {
    if (!this.enabled) return;
    this.durations[stage] = (this.durations[stage] || 0) + Math.max(0, ms);
    this.counts[stage] = (this.counts[stage] || 0) + 1;
  }
  snapshot() {
    return { elapsedMs: Math.round((performance.now() - this.started) * 100) / 100,
      stagesMs: Object.fromEntries(Object.entries(this.durations).map(([key, value]) => [key, Math.round(value * 100) / 100])), counts: { ...this.counts } };
  }
}
export function waitForAudit<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason || new DOMException('Request cancelled', 'AbortError'));
    if (signal.aborted) { void promise.catch(() => {}); aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
