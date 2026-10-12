import { fsOrigins } from './fs-origins.js';
import { extensionConfig } from './config.js';
import { FS_BRIDGE_VERSION, sendFsMessage, withTimeout } from './fs-messaging.js';
export const declaredFsOrigins = chromeApi => fsOrigins(extensionConfig, chromeApi.runtime.getManifest());
const originOf = tab => { try { return new URL(tab?.url || '').origin; } catch { return ''; } };
export async function findFsTab(chromeApi, origins) {
  const [active] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (active?.id !== undefined && origins.includes(originOf(active))) return active;
  const candidates = await chromeApi.tabs.query({ url: origins.map(origin => origin + '/*') });
  const allowed = candidates.filter(tab => tab.id !== undefined && origins.includes(originOf(tab)));
  if (allowed.length === 1) return allowed[0];
  if (allowed.length > 1) throw new Error('More than one FS tab is open. Focus the FS tab you want, then click Connect to FS from its OrderCheck popup or side panel.');
  throw new Error(`FS tab not found. No accessible tab matches the installed FS origins: ${origins.join(', ')}. Open and focus your configured FS site.`);
}
export async function connectFsTab(chromeApi, { repair = false, onSnapshot } = {}) {
  const origins = declaredFsOrigins(chromeApi);
  if (!origins.length) throw new Error('The installed extension has no enabled FS origins. Load the current OrderCheck extension.');
  const tab = await withTimeout(() => findFsTab(chromeApi, origins), 4000, 'FS tab lookup timed out. Reopen the OrderCheck side panel.');
  let details;
  try { details = await sendFsMessage(chromeApi, tab.id, { type: 'FS_DIAGNOSTICS' }, 4000); }
  catch (error) {
    if (!repair) throw new Error(`${error.message} Click Connect to FS to restore the connection.`);
  }
  if (!details || typeof details.formFound !== 'boolean' || details.bridgeVersion !== FS_BRIDGE_VERSION) {
    if (!repair) throw new Error('The FS script needs reconnecting. Click Connect to FS.');
    // Recheck the exact target immediately before injection, including navigation races.
    const current = await withTimeout(() => chromeApi.tabs.get(tab.id), 4000);
    const origin = originOf(current);
    if (!origins.includes(origin)) throw new Error('The selected tab left FS. Focus your FS tab and connect again.');
    if (!await withTimeout(() => chromeApi.permissions.contains({ origins: [origin + '/*'] }), 4000)) throw new Error('Chrome has withheld access to this configured FS site. Enable its Site access in OrderCheck’s Chrome extension settings, then reconnect.');
    try {
      await withTimeout(() => chromeApi.scripting.executeScript({ target: { tabId: tab.id }, files: ['fs-content.js'] }), 4000);
      details = await sendFsMessage(chromeApi, tab.id, { type: 'FS_DIAGNOSTICS' }, 4000);
    } catch (error) { throw new Error(`FS script could not start: ${error.message}. Check OrderCheck’s Errors entry in chrome://extensions.`); }
  }
  if (!details || typeof details.formFound !== 'boolean' || details.bridgeVersion !== FS_BRIDGE_VERSION) throw new Error('The injected FS script did not respond with the current bridge version. Refresh FS and check OrderCheck’s Errors entry in chrome://extensions.');
  const current = await withTimeout(() => chromeApi.tabs.get(tab.id), 4000);
  if (originOf(current) !== originOf(tab)) throw new Error('The selected tab left FS. Focus your FS tab and connect again.');
  onSnapshot?.({ tabId: tab.id, details });
  const state = await sendFsMessage(chromeApi, tab.id, { type: 'FS_REFRESH' });
  return { tabId: tab.id, origin: originOf(tab), details, state };
}
