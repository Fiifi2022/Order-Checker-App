import { connectFsTab } from './fs-connection.js';
import { withTimeout } from './fs-messaging.js';
import { quantityStatus } from './fs-state.js';
export function setupFsPanel({ onFacility, onScript = () => {} }) {
  const panel = document.getElementById('fsLiveContext'), manual = document.getElementById('fsManualFacility');
  const connection = document.getElementById('fsConnectionStatus');
  let activeTabId, current, facilityKey, revision = 0;
  const status = text => { if (connection) connection.textContent = text; };
  const line = text => { const p = document.createElement('p'); p.textContent = text; panel.append(p); };
  const render = state => {
    current = state; panel.replaceChildren(); manual.hidden = true;
    if (!state) { facilityKey = undefined; line('Select a facility in the active FS tab to view live allocation advice.'); onFacility(null); onScript(null); return; }
    const data = state.allocation, selection = state.selection;
    onScript(selection.script);
    const nextFacilityKey = JSON.stringify([state.tabId, selection.facility]);
    if (facilityKey !== nextFacilityKey || !state.loading) onFacility(data?.status === 'matched' ? data.facility : null);
    facilityKey = nextFacilityKey;
    line([data?.facility?.facilityName || selection.facility.name || 'No facility selected', data?.facility?.district || selection.facility.district, data?.facility?.region || selection.facility.region].filter(Boolean).join(' · '));
    if (state.loading) { status('Connected to FS · Loading current Allocation Blueprint…'); line('Loading current Allocation Blueprint…'); return; }
    if (state.error) { status(state.code === 'BACKEND_UNREACHABLE' ? `Backend unreachable · ${state.error}` : state.error); line(state.error); return; }
    status(data?.status === 'not_found' ? 'Facility not found in Allocation Blueprint' : data?.status === 'ambiguous' ? 'Connected to FS · Multiple Blueprint matches; select the exact facility/cycle.' : !selection.facility.name && !selection.facility.id ? 'Waiting for facility selection' : 'Connected to FS');
    if (data?.message) line(data.message);
    if (!selection.draft && !selection.order.length) line('No requested products yet. Open the product picker in FS to view allocation advice.');
    if (data?.status === 'ambiguous') {
      manual.replaceChildren();
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Select exact facility · district · cycle'; manual.append(option);
      for (const candidate of data.candidates) { const option = document.createElement('option'); option.value = candidate.id; option.textContent = [candidate.facilityName, candidate.district, candidate.region, candidate.cycle].filter(Boolean).join(' · '); manual.append(option); }
      manual.hidden = false;
    }
    const products = data?.products || [];
    for (let i = 0; i < products.length; i++) {
      const product = products[i], draft = i >= selection.order.length;
      const orderTotal = products.slice(0, selection.order.length).filter(p => (p.allocationKey || p.canonical) === (product.allocationKey || product.canonical)).reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
      line(`${draft ? 'Draft: ' : 'In order: '}${product.name} — ${product.quantity || 'no quantity'} requested · Available allocation: ${Number.isFinite(product.balance) ? product.balance : 'unavailable'}`);
      line(product.message || quantityStatus(draft ? product.quantity : String(orderTotal), product.balance, draft ? orderTotal : 0));
    }
    for (const companion of data?.companions || []) line(`Required companion: ${companion.name} · Allocation: ${Number.isFinite(companion.balance) ? companion.balance : 'no separate allocation record'} · Confirm its quantity in FS.`);
  };
  async function checkConnection(repair = false) {
    const operation = ++revision;
    activeTabId = undefined; render(null);
    status(repair ? 'Connecting to FS…' : 'Checking FS connection…');
    try {
      const { tabId, details, state } = await withTimeout(() => connectFsTab(chrome, { repair, onSnapshot: snapshot => {
        if (revision !== operation) return;
        activeTabId = snapshot.tabId;
        if (snapshot.details.selection) render({ tabId: activeTabId, selection: snapshot.details.selection, loading: true });
      } }), 30000, 'FS connection timed out. Refresh FS and check OrderCheck’s service-worker errors.');
      if (revision !== operation) return;
      activeTabId = tabId;
      const saved = state?.selection ? state : state?.error && details.selection ? { tabId, selection: details.selection, loading: false, error: state.error, code: state.code } : (await chrome.storage.session.get(`fsContext:${tabId}`))[`fsContext:${tabId}`];
      if (revision !== operation) return;
      render(saved);
      if (state?.error && !state.selection) status(state.error);
      else if (!details.formFound) status('Connected to FS · Facility/order controls unavailable. Open the order screen; if it is open, its DOM needs inspection.');
    } catch (error) { if (revision === operation) {
      const observed = current?.selection;
      activeTabId = undefined;
      render(observed ? { selection: observed, loading: false, error: error.message } : null);
      status(error.message);
      if (!observed) line(error.message);
    } }
  }
  document.getElementById('fsCheckConnection')?.addEventListener('click', () => {
    void checkConnection(true);
  });
  manual.addEventListener('change', () => {
    if (!manual.value || !current) return;
    const operation = revision;
    void withTimeout(() => chrome.runtime.sendMessage({ type: 'FS_MANUAL', tabId: activeTabId, facilityId: manual.value })).then(state => {
      if (operation !== revision) return;
      if (state?.selection) render(state);
      else status(state?.error || 'FS worker returned no facility context. Reconnect to FS.');
    }).catch(error => { if (operation === revision) status(error.message); });
  });
  document.getElementById('fsRefresh').addEventListener('click', () => {
    void checkConnection(false);
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes[`fsContext:${activeTabId}`]) render(changes[`fsContext:${activeTabId}`].newValue); });
  chrome.tabs.onActivated.addListener(() => void checkConnection(false));
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (id === activeTabId && (info.status === 'loading' || info.url)) { revision++; activeTabId = undefined; render(null); status('FS tab disconnected or navigating. Check FS connection after it loads.'); }
    if (info.status === 'complete') void checkConnection(false);
  });
  chrome.tabs.onRemoved?.addListener(id => { if (id === activeTabId) { revision++; activeTabId = undefined; render(null); status('FS tab not found · The connected FS tab was closed.'); } });
  void checkConnection(false);
}
