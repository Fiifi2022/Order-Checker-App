import { createInlineAllocation } from './inline-allocation.js';
import { createFsActivation } from './fs-activation.js';
import { createFsAdapter } from './fs-adapter.js';
import { cleanSelection, confirmedAddition } from './fs-state.js';
import { FS_BRIDGE_VERSION as bridgeVersion, respondAsync, withTimeout } from './fs-messaging.js';
{
// Explicit reinjection replaces even a same-version bridge from a reloaded
// extension context. Successful diagnostics do not trigger reinjection.
try { globalThis.__ordercheckFsBridge?.dispose?.(); } catch (error) { console.warn('Previous FS bridge cleanup failed:', error.message); }
const adapter = createFsAdapter(document);
let lastDraftIdentity = '', last = '', selection = null, pending = null, suppressed = '', response = null, timer, refreshTimer, revision = 0, disposed = false, inFlight = false;
const indicator = createInlineAllocation(adapter, document);
const host = indicator.host;
const activation = createFsActivation(document, bridgeVersion, () => adapter.inspect());
function render() { indicator.render(selection, response); activation.render(selection, response); }
function refreshLater() {
  clearTimeout(refreshTimer);
  if (disposed) return;
  const interval = response?.displaySettings?.refreshMs || 30000;
  refreshTimer = setTimeout(() => {
    if (selection?.draft && document.visibilityState !== 'hidden' && !inFlight) void scan(true).catch(error => console.warn('FS refresh failed:', error.message));
    else refreshLater();
  }, interval);
  refreshTimer?.unref?.();
}
async function scan(force = false) {
  if (disposed) return { error: 'FS bridge was replaced. Reconnect to FS.' };
  let next = cleanSelection(adapter.read());
  if (pending && JSON.stringify(next.facility) === JSON.stringify(pending.facility) && confirmedAddition(pending.order, next.order, pending.draft)) {
    suppressed = JSON.stringify([next.facility, next.draft]); pending = null;
  }
  if (pending && next.draft?.name !== pending.draft?.name) pending = null;
  if (selection && JSON.stringify(selection.facility) !== JSON.stringify(next.facility)) { pending = null; suppressed = ''; }
  const draftIdentity = JSON.stringify([next.draft?.name, next.draft?.id]);
  if (lastDraftIdentity && lastDraftIdentity !== draftIdentity) suppressed = '';
  lastDraftIdentity = draftIdentity;
  if (suppressed === JSON.stringify([next.facility, next.draft])) next.draft = null;
  const key = JSON.stringify(next);
  if (!force && key === last) { render(); return response; }
  const requestRevision = ++revision;
  last = key; selection = next; response = null; inFlight = true; render();
  try {
    const result = await withTimeout(() => chrome.runtime.sendMessage({ type: 'FS_SELECTION', selection: next, refresh: force, diagnostics: adapter.diagnostics() }));
    if (!result) throw new Error('FS service worker returned no response.');
    if (key !== last || requestRevision !== revision || result.stale) return { stale: true };
    response = result; render();
  } catch (error) {
    if (/Extension context invalidated/i.test(error.message)) dispose();
    if (key === last && requestRevision === revision) { response = { selection: next, error: `FS service worker unavailable: ${error.message}. Reload OrderCheck and refresh the FS tab.`, code: 'FS_WORKER_UNAVAILABLE' }; render(); }
  } finally {
    if (requestRevision === revision) { inFlight = false; refreshLater(); }
  }
  return response;
}
const safeScan = () => { void scan().catch(error => console.warn('FS snapshot failed:', error.message)); };
const schedule = () => { clearTimeout(timer); timer = setTimeout(safeScan, 100); };
const observer = new MutationObserver(mutations => { if (mutations.some(m => m.target !== host && !host.contains(m.target) && m.target !== activation.host && !activation.host.contains(m.target))) safeScan(); });
observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
const change = () => { clearTimeout(timer); safeScan(); };
const click = event => {
  if (adapter.isNewOrder(event.target)) {
    if (event.isTrusted) {
      // Send first, synchronously inside the click handler, to retain activation.
      try {
        void chrome.runtime.sendMessage({ type: 'FS_OPEN_PANEL' }).then(result => {
          if (result?.error) activation.render(selection, { error: `Unable to open OrderCheck: ${result.error}. Click the OrderCheck toolbar icon.` });
        }).catch(error => console.warn('OrderCheck panel could not open:', error.message));
      } catch (error) { console.warn('OrderCheck panel could not open:', error.message); }
    }
    adapter.resetOrder(); pending = null; suppressed = ''; change();
  }
  if (adapter.isAdd(event.target)) { pending = cleanSelection(adapter.read()); }
  schedule();
};
document.addEventListener('input', change, true); document.addEventListener('change', change, true);
document.addEventListener('click', click, true);
const recover = () => { if (selection?.draft && document.visibilityState !== 'hidden' && !inFlight) void scan(true).catch(error => console.warn('FS recovery failed:', error.message)); };
window.addEventListener('online', recover); window.addEventListener('focus', recover); document.addEventListener('visibilitychange', recover);
const listener = (message, sender, respond) => {
  if (message?.type === 'FS_REFRESH') return respondAsync(respond, () => scan(true));
  if (!['FS_DIAGNOSTICS', 'FS_ALLOCATION'].includes(message?.type)) return false;
  try {
    if (message.type === 'FS_DIAGNOSTICS') respond({ ...adapter.diagnostics(), selection: cleanSelection(adapter.read()), bridgeVersion });
    else {
      if (JSON.stringify(message.state?.selection) === last) { response = message.state; render(); }
      respond({ success: true });
    }
  } catch (error) { respond({ error: error.message, code: 'FS_DOM_ERROR' }); }
  return false;
};
function dispose() {
  if (disposed) return;
  disposed = true;
  clearTimeout(timer); clearTimeout(refreshTimer); observer.disconnect(); revision++;
  document.removeEventListener('input', change, true); document.removeEventListener('change', change, true); document.removeEventListener('click', click, true);
  window.removeEventListener('online', recover); window.removeEventListener('focus', recover); document.removeEventListener('visibilitychange', recover);
  try { chrome.runtime.onMessage.removeListener?.(listener); } catch (error) { console.warn('FS listener context expired:', error.message); }
  indicator.dispose();
  activation.dispose();
  if (globalThis.__ordercheckFsBridge === bridge) delete globalThis.__ordercheckFsBridge;
}
const bridge = { version: bridgeVersion, dispose };
globalThis.__ordercheckFsBridge = bridge;
chrome.runtime.onMessage.addListener(listener);
safeScan();
}
