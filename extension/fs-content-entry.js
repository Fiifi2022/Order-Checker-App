import { createFsAdapter } from './fs-adapter.js';
import { cleanSelection, confirmedAddition, quantityStatus } from './fs-state.js';
import { FS_BRIDGE_VERSION as bridgeVersion, respondAsync, withTimeout } from './fs-messaging.js';
{
// Explicit reinjection replaces even a same-version bridge from a reloaded
// extension context. Successful diagnostics do not trigger reinjection.
try { globalThis.__ordercheckFsBridge?.dispose?.(); } catch (error) { console.warn('Previous FS bridge cleanup failed:', error.message); }
document.getElementById('ordercheck-allocation')?.remove();
const adapter = createFsAdapter(document);
let lastDraftIdentity = '', last = '', selection = null, pending = null, suppressed = '', response = null, timer, revision = 0, disposed = false;
const host = document.createElement('div'); host.id = 'ordercheck-allocation';
host.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;display:none';
const shadow = host.attachShadow({ mode: 'closed' });
shadow.innerHTML = '<style>:host{font:12px system-ui}div{max-width:260px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#f8fafc;color:#0f172a;box-shadow:0 2px 6px #0002;overflow-wrap:anywhere}small{display:block;margin-top:3px}</style><div role="status" aria-live="polite"><strong></strong><small></small></div>';
const position = () => {
  const anchor = adapter.anchor();
  if (!anchor || host.style.display === 'none') return;
  const rect = anchor.getBoundingClientRect(), width = host.offsetWidth || 280, height = host.offsetHeight || 90;
  const controls = [...adapter.root().querySelectorAll('input,select,button,[role="combobox"],[role="alert"],[aria-live]')].map(el => el.getBoundingClientRect());
  const points = [[rect.right + 10, rect.top], [rect.left - width - 10, rect.top], [rect.left, rect.bottom + 10], [rect.left, rect.top - height - 10]];
  for (let y = 8; y + height < innerHeight; y += height + 8) points.push([innerWidth - width - 8, y], [8, y]);
  const point = points.find(([x, y]) => x >= 8 && y >= 8 && x + width <= innerWidth - 8 && y + height <= innerHeight - 8 &&
    !controls.some(r => x < r.right + 4 && x + width > r.left - 4 && y < r.bottom + 4 && y + height > r.top - 4));
  if (point) { host.style.left = `${point[0]}px`; host.style.top = `${point[1]}px`; }
  else { host.style.left = '8px'; host.style.top = '8px'; }

};
function render() {
  if (!host.isConnected) document.documentElement.append(host);
  const draft = selection?.draft;
  if (!draft || suppressed === JSON.stringify([selection.facility, draft])) { host.style.display = 'none'; return; }
  host.style.display = 'block';
  const data = response?.allocation, product = data?.products?.[selection.order.length];
  if (product?.status === 'untracked') { host.style.display = 'none'; return; }
  shadow.querySelector('strong').textContent = `${product?.canonical || draft.name} — Available: ${Number.isFinite(product?.balance) ? product.balance : 'unavailable'}`;
  const committed = data?.products?.slice(0, selection.order.length).filter(p => (p.allocationKey || p.canonical) === (product?.allocationKey || product?.canonical)).reduce((n, p) => n + (Number(p.quantity) || 0), 0) || 0;
  shadow.querySelector('small').textContent = response?.error || data?.message || product?.message || (product ? quantityStatus(draft.quantity, product.balance, committed) : 'Loading current allocation…');
  position();
}
async function scan(force = false) {
  if (disposed) return { error: 'FS bridge was replaced. Reconnect to FS.' };
  let next = cleanSelection(adapter.read());
  if (pending && JSON.stringify(next.facility) === JSON.stringify(pending.facility) && confirmedAddition(pending.order, next.order, pending.draft)) {
    suppressed = JSON.stringify([next.facility, next.draft]); pending = null;
  }
  if (pending && !next.draft && JSON.stringify(next.facility) === JSON.stringify(pending.facility)) next.draft = pending.draft;
  if (pending && next.draft?.name !== pending.draft?.name) pending = null;
  if (selection && JSON.stringify(selection.facility) !== JSON.stringify(next.facility)) { pending = null; suppressed = ''; }
  const draftIdentity = JSON.stringify([next.draft?.name, next.draft?.id]);
  if (lastDraftIdentity && lastDraftIdentity !== draftIdentity) suppressed = '';
  lastDraftIdentity = draftIdentity;
  if (suppressed === JSON.stringify([next.facility, next.draft])) next.draft = null;
  const key = JSON.stringify(next);
  if (!force && key === last) { render(); return response; }
  const requestRevision = ++revision;
  last = key; selection = next; response = null; render();
  try {
    const result = await withTimeout(() => chrome.runtime.sendMessage({ type: 'FS_SELECTION', selection: next, refresh: force, diagnostics: adapter.diagnostics() }));
    if (!result) throw new Error('FS service worker returned no response.');
    if (key !== last || requestRevision !== revision || result.stale) return { stale: true };
    response = result; render();
  } catch (error) {
    if (/Extension context invalidated/i.test(error.message)) dispose();
    if (key === last && requestRevision === revision) { response = { selection: next, error: `FS service worker unavailable: ${error.message}. Reload OrderCheck and refresh the FS tab.`, code: 'FS_WORKER_UNAVAILABLE' }; render(); }
  }
  return response;
}
const safeScan = () => { void scan().catch(error => console.warn('FS snapshot failed:', error.message)); };
const schedule = () => { clearTimeout(timer); timer = setTimeout(safeScan, 100); };
const observer = new MutationObserver(mutations => { if (mutations.some(m => m.target !== host && !host.contains(m.target))) schedule(); });
observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
const change = () => { clearTimeout(timer); safeScan(); };
const click = event => {
  if (adapter.isNewOrder(event.target)) {
    try { void chrome.runtime.sendMessage({ type: 'FS_OPEN_PANEL' }).catch(() => {}); } catch { /* An extension reload may end the old context. */ }
    adapter.resetOrder(); pending = null; suppressed = ''; change(); }
  if (adapter.isAdd(event.target)) { pending = cleanSelection(adapter.read()); }
  schedule();
};
document.addEventListener('input', schedule, true); document.addEventListener('change', change, true);
document.addEventListener('click', click, true);
window.addEventListener('scroll', position, true); window.addEventListener('resize', position);
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
  clearTimeout(timer); observer.disconnect(); revision++;
  document.removeEventListener('input', schedule, true); document.removeEventListener('change', change, true); document.removeEventListener('click', click, true);
  window.removeEventListener('scroll', position, true); window.removeEventListener('resize', position);
  try { chrome.runtime.onMessage.removeListener?.(listener); } catch (error) { console.warn('FS listener context expired:', error.message); }
  host.remove();
  if (globalThis.__ordercheckFsBridge === bridge) delete globalThis.__ordercheckFsBridge;
}
const bridge = { version: bridgeVersion, dispose };
globalThis.__ordercheckFsBridge = bridge;
chrome.runtime.onMessage.addListener(listener);
safeScan();
}
