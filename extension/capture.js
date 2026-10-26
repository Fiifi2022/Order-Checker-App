// Reads highlighted text (or the page) from the active tab through the content script.
export function captureFromActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.id) { resolve({ ok: false, reason: 'No active tab found. Open WhatsApp Web or the fulfillment page, then capture again.' }); return; }
      if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) {
        resolve({ ok: false, reason: 'Browser pages cannot be captured. Switch to a website tab first.' }); return;
      }
      chrome.tabs.sendMessage(tab.id, { action: 'scrape' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: 'This tab is not ready for capture. Refresh the page, or paste the details above.' }); return;
        }
        if (!response) { resolve({ ok: false, reason: 'Nothing came back from the page. Paste the details manually.' }); return; }
        resolve({ ok: true, fulfillment: response.selection || response.fulfillment || '', whatsapp: response.whatsapp || '' });
      });
    });
  });
}
