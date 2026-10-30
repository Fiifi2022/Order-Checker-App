export function withTimeout(task, milliseconds = 18000, message = 'FS connection timed out. Check the extension service worker and reconnect.') {
  let timer;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'FS_TIMEOUT' })), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

export function respondAsync(respond, task) {
  // Chrome 116-compatible: claim only handled messages and settle every branch.
  void withTimeout(task).catch(error => ({ error: error?.message || String(error), code: error?.code || 'FS_MESSAGE_FAILED' }))
    .then(result => { try { respond(result); } catch { /* The sending tab may have closed. */ } });
  return true;
}

export async function sendFsMessage(chromeApi, tabId, message, timeoutMs = 18000) {
  try {
    const result = await withTimeout(() => chromeApi.tabs.sendMessage(tabId, message, { frameId: 0 }), timeoutMs);
    if (!result) throw new Error('The FS content script returned no response.');
    return result;
  } catch (cause) {
    const error = new Error(`FS content script unavailable: ${cause?.message || String(cause)}. Refresh the FS tab after reloading OrderCheck, then reconnect.`);
    error.code = cause?.code || 'FS_CONTENT_UNAVAILABLE';
    throw error;
  }
}
export const FS_BRIDGE_VERSION = '2.3.47';

