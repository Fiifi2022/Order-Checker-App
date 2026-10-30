// Keep cycle choices separate for each configured OrderCheck backend.
export function allocationCycleKey(backendUrl) {
  let origin = '';
  try { origin = new URL(backendUrl).origin; } catch { origin = String(backendUrl || ''); }
  return `allocationCyclePreference:${origin}`;
}
