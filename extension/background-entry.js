import { fsOrigins } from './fs-origins.js';
import { extensionConfig } from './config.js';
import { backendRequest } from './auth.js';
import { cleanSelection, selectionProducts } from './fs-state.js';
import { allocationCycleKey } from './allocation-cycle.js';
import { respondAsync, withTimeout, sendFsMessage } from './fs-messaging.js';
const versions = new Map();
const writes = new Map();
const lookups = new Map();
const configuredNumber = (value, fallback, min, max) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
const displaySettings = {
  lowThreshold: configuredNumber(extensionConfig.allocationLowThreshold, 10, 0, 1000000),
  refreshMs: configuredNumber(extensionConfig.allocationRefreshMs, 30000, 15000, 300000),
};
function enqueueWrite(tabId, task) {
  const pending = (writes.get(tabId) || Promise.resolve()).catch(() => {}).then(task);
  writes.set(tabId, pending);
  const cleanup = () => { if (writes.get(tabId) === pending) writes.delete(tabId); };
  void pending.then(cleanup, cleanup);
  return pending;
}
const persist = (tabId, state, version) => enqueueWrite(tabId, async () => {
  if (versions.get(tabId) !== version) return false;
  await chrome.storage.session.set({ [`fsContext:${tabId}`]: state });
  return versions.get(tabId) === version;
});
const allowedOrigins = fsOrigins(extensionConfig, chrome.runtime.getManifest?.());
const allowed = sender => { try { return sender.tab?.id !== undefined && allowedOrigins.includes(new URL(sender.url || sender.tab.url).origin); } catch { return false; } };
async function update(tabId, selection, manualFacilityId, refresh = false) {
  const version = (versions.get(tabId) || 0) + 1; versions.set(tabId, version);
  const key = `fsContext:${tabId}`;
  const prior = (await chrome.storage.session.get(key))[key];
  if (versions.get(tabId) !== version) return { stale: true };
  if (manualFacilityId === undefined) manualFacilityId = JSON.stringify(prior?.selection?.facility) === JSON.stringify(selection.facility) ? prior?.manualFacilityId || '' : '';
  const identity = s => JSON.stringify([s.facility, selectionProducts(s).map(p => [p.name, p.id])]);
  const { customBackendUrl } = await chrome.storage.local.get('customBackendUrl');
  const base = customBackendUrl || extensionConfig.backendUrl;
  const cycleKey = allocationCycleKey(base), cycleSetting = await chrome.storage.local.get(cycleKey);
  const allocationCycle = typeof cycleSetting[cycleKey] === 'string' ? cycleSetting[cycleKey] : '';
  if (versions.get(tabId) !== version) return { stale: true };
  if (!refresh && (prior?.allocationCycle || '') === allocationCycle && (!prior?.backendUrl || prior.backendUrl === base) && prior?.allocation?.status === 'matched' && Date.now() - prior.checkedAt < displaySettings.refreshMs && prior.manualFacilityId === manualFacilityId && identity(prior.selection) === identity(selection)) {
    const allocation = { ...prior.allocation, products: prior.allocation.products.map((p, i) => ({ ...p, quantity: selectionProducts(selection)[i].quantity })) };
    const state = { ...prior, selection, allocation };
    if (versions.get(tabId) !== version) return { stale: true };
    return await persist(tabId, state, version) ? state : { stale: true };
  }
  const state = { tabId, selection, manualFacilityId, allocationCycle, backendUrl: base, displaySettings, loading: true, allocation: null };
  if (!await persist(tabId, state, version)) return { stale: true };
  try {
    const lookupKey = JSON.stringify([tabId, base, allocationCycle, manualFacilityId, identity(selection)]);
    let lookup = lookups.get(lookupKey);
    if (!lookup) {
      lookup = selection.facility.name || selection.facility.id ? withTimeout(() => backendRequest(base, '/api/vaccine/companion/context?selection=' + encodeURIComponent(JSON.stringify({ facility: selection.facility, products: selectionProducts(selection), manualFacilityId, ...(allocationCycle ? { allocationCycle } : {}) })), {}, 10000), 12000, 'Backend unreachable: allocation lookup timed out. Check the OrderCheck server and sign-in session.') : Promise.resolve({ status: 'no_facility', products: [] });
      lookups.set(lookupKey, lookup);
      const cleanup = () => { if (lookups.get(lookupKey) === lookup) lookups.delete(lookupKey); };
      void lookup.then(cleanup, cleanup);
    }
    const found = await lookup;
    const allocation = { ...found, products: found.products?.map((p, i) => ({ ...p, quantity: selectionProducts(selection)[i]?.quantity })) || [] };
    if (versions.get(tabId) !== version) return { stale: true };
    Object.assign(state, { allocation, loading: false, checkedAt: Date.now() });
  } catch (error) {
    if (versions.get(tabId) !== version) return { stale: true };
    const message = error?.message || String(error);
    Object.assign(state, { loading: false, error: message, code: error?.status === 401 || /sign in|approved portal account/i.test(message) ? 'AUTH_REQUIRED' : error?.status === 403 ? 'PERMISSION_DENIED' : 'BACKEND_UNREACHABLE' });
  }
  if (!await persist(tabId, state, version)) return { stale: true };
  void sendFsMessage(chrome, tabId, { type: 'FS_ALLOCATION', state }).catch(error => console.warn('FS allocation delivery failed:', error.message));
  return state;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'FS_OPEN_PANEL') {
    if (!allowed(sender) || sender.frameId && sender.frameId !== 0) { respond({ error: 'FS message sender is not authorized.' }); return false; }
    // Keep the content-script click's user gesture: no storage/network await
    // or deferred task before Chrome's open call.
    try {
      chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => respond({ success: true }), error => respond({ error: error.message }));
    } catch (error) { respond({ error: error.message }); }
    return true;
  }
  if (!['FS_SELECTION', 'FS_REFRESH_ALL', 'FS_MANUAL'].includes(message?.type)) return false;
  return respondAsync(respond, async () => {
  if (message.type === 'FS_SELECTION' && allowed(sender)) {
    const selection = cleanSelection(message.selection);
    const key = `fsContext:${sender.tab.id}`;
    if (message.diagnostics?.formFound === false) {
      const version = (versions.get(sender.tab.id) || 0) + 1;
      versions.set(sender.tab.id, version);
      const state = { tabId: sender.tab.id, selection, loading: false, allocation: null,
        error: 'FS Add New Order controls were not detected. Open Add New Order. If it is already open, the FS form adapter needs inspection.' };
      return await persist(sender.tab.id, state, version) ? state : { stale: true };
    }
    return update(sender.tab.id, selection, undefined, message.refresh === true);
  }
  if (message.type === 'FS_SELECTION') return { error: 'This FS origin is not enabled in the installed extension. Reload or install the current extension package.' };
  if (message.type === 'FS_REFRESH_ALL' && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    const saved = await chrome.storage.session.get(null);
    const deliveries = await Promise.allSettled(Object.entries(saved).filter(([key]) => key.startsWith('fsContext:')).map(([, state]) => sendFsMessage(chrome, state.tabId, { type: 'FS_REFRESH' })));
    return { success: deliveries.every(result => result.status === 'fulfilled'), errors: deliveries.filter(result => result.status === 'rejected').map(result => result.reason.message) };
  }
  if (message.type === 'FS_MANUAL' && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    const key = `fsContext:${message.tabId}`;
    const tab = await chrome.tabs.get(message.tabId);
    if (!allowed({ tab, url: tab.url })) return { error: 'The selected tab left FS. Reconnect to the current FS tab.' };
    const saved = await chrome.storage.session.get(key);
    return saved[key] ? update(message.tabId, saved[key].selection, message.facilityId) : { error: 'No active FS selection. Reconnect to FS.' };
  }
  return { error: 'FS message sender is not authorized.' };
  });
});
const clearTab = tabId => { versions.set(tabId, (versions.get(tabId) || 0) + 1); void enqueueWrite(tabId, () => chrome.storage.session.remove(`fsContext:${tabId}`)).catch(error => console.warn('FS state cleanup failed:', error.message)); };
chrome.tabs.onRemoved.addListener(clearTab);
// Reloading an unpacked extension leaves existing tabs with an expired context.
// Replace that context immediately instead of requiring the user to open a panel first.
chrome.runtime.onInstalled?.addListener(() => {
  void (async () => {
    const tabs = await chrome.tabs.query({ url: allowedOrigins.map(origin => origin + '/*') });
    const results = await Promise.allSettled(tabs.filter(tab => allowed({ tab })).map(async tab => {
      const origin = new URL(tab.url).origin;
      if (!await chrome.permissions.contains({ origins: [origin + '/*'] })) return;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['fs-content.js'] });
    }));
    for (const result of results) if (result.status === 'rejected') console.warn('FS activation failed:', result.reason?.message);
  })().catch(error => console.warn('FS activation failed:', error.message));
});
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'loading' || info.url && !allowed({ tab: { id: tabId }, url: info.url })) clearTab(tabId); });
chrome.storage.onChanged.addListener((changes, area) => {
  const auth = changes.authSession;
  const accountChanged = auth && (!auth.oldValue || !auth.newValue || auth.oldValue.email !== auth.newValue.email);
  if ((area === 'session' && accountChanged) || (area === 'local' && (changes.customBackendUrl || Object.keys(changes).some(key => key.startsWith('allocationCyclePreference:'))))) {
    lookups.clear();
    void chrome.storage.session.get(null).then(async saved => {
      for (const [key, state] of Object.entries(saved)) if (key.startsWith('fsContext:')) {
        versions.set(state.tabId, (versions.get(state.tabId) || 0) + 1);
        await enqueueWrite(state.tabId, () => chrome.storage.session.remove(key));
        void sendFsMessage(chrome, state.tabId, { type: 'FS_REFRESH' }).catch(error => console.warn('FS session refresh failed:', error.message));
      }
    }).catch(error => console.warn('FS session invalidation failed:', error.message));
  }
});
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(error => console.warn('Side panel behavior failed:', error.message));
