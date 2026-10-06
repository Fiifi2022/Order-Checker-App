/** Opt-in diagnostics for the General Auditor only. */
export function traceGeneralAudit(stage: string, payload: unknown) {
  let enabled = typeof process !== 'undefined' && process.env.GENERAL_AUDITOR_DEBUG === 'true';
  try {
    enabled ||= typeof window !== 'undefined' && window.localStorage.getItem('generalAuditorDebug') === 'true';
  } catch { /* Storage may be disabled in the browser. */ }
  if (enabled) console.debug(`[General Auditor] ${stage}`, payload);
}
