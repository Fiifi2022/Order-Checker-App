console.log("[Compliance Companion] Extension script active.");

// Listen for scrape request
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrape") {
    // 1. Read mouse highlight selection currently made by user on active screen
    const selectedText = window.getSelection() ? window.getSelection().toString().trim() : '';

    // 2. Read message confirmation draft pasted on WhatsApp Web text area (if applicable)
    const waInput = document.querySelector('footer div[contenteditable="true"]') || document.querySelector('footer textarea');
    const whatsappDraft = waInput ? waInput.innerText || waInput.value : '';

    // 3. Read general page text if selection is empty as a fail-safe fallback
    let fallbackText = '';
    const rows = document.querySelectorAll('.fulfillment-item-row, .order-details-card, tr, .item-details');
    if (rows.length > 0) {
      fallbackText = Array.from(rows).map(row => row.innerText || row.textContent).join('\n');
    } else {
      const mainBox = document.querySelector('#fulfillment-root, .manifest-details, main, body');
      if (mainBox) {
        fallbackText = mainBox.innerText || mainBox.textContent;
      }
    }

    sendResponse({
      selection: selectedText || "",
      whatsapp: whatsappDraft || "",
      fulfillment: fallbackText || ""
    });
  }
  return true;
});
