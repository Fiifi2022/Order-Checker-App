/** Opt-in, content-free diagnostics. Never log customer payloads. */
export function traceGeneralAudit(stage: string, _payload: unknown) {
  let enabled = typeof process !== 'undefined' && process.env.GENERAL_AUDITOR_DEBUG === 'true';
  try { enabled ||= typeof window !== 'undefined' && window.localStorage.getItem('generalAuditorDebug') === 'true'; } catch {}
  if (enabled && ['rawInputs', 'parsedInputs', 'comparison', 'beforeRendering', 'productMatching'].includes(stage)) console.debug('[General Auditor]', { stage, ...(stage === 'productMatching' && _payload && typeof _payload === 'object' ? { matching: _payload } : {}) });
}
