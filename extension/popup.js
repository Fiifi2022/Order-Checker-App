import { acknowledgeOrderLimit } from './order-limits.js';
import { setupCatalog } from './catalog.js';
import { setupScreenshots } from './screenshots.js';
import { auditBody, profileRoles } from './audit.js';
import { extensionConfig } from './config.js';
import { normalizeBackendUrl, fetchJson } from './backend.js';
import { signIn, signOut, backendRequest } from './auth.js';

const SERVER_URL = extensionConfig.backendUrl;

document.addEventListener('DOMContentLoaded', () => {
  const btnVerify = document.getElementById('btnVerify');
  const btnCapture = document.getElementById('btnCapture');
  const btnClear = document.getElementById('btnClear');
  const whatsappText = document.getElementById('whatsappText');
  const agentNameInput = document.getElementById('agentName');
  const fulfillmentText = document.getElementById('fulfillmentText');
  const results = document.getElementById('results');
  const backendUrlInput = document.getElementById('backendUrlInput');
  const btnSaveBackend = document.getElementById('btnSaveBackend');
  const btnResetBackend = document.getElementById('btnResetBackend');
  const backendSaveMsg = document.getElementById('backendSaveMsg');
  const connectionBadge = document.getElementById('connectionBadge');

  let savedBackendUrl = SERVER_URL;
  let connectionAttempt = 0;
  let contextRevision = 0, inputRevision = 0, hintRevision = 0, hintTimer;
  const inputKey = () => JSON.stringify([whatsappText.value, fulfillmentText.value]);
  const request = async (endpoint, options = {}) => {
    const context = contextRevision;
    const data = await backendRequest(normalizeBackendUrl(savedBackendUrl), endpoint, options);
    if (context !== contextRevision) throw new Error('Account or backend changed. Retry on the current service.');
    return data;
  };
  const clearHints = () => {
    hintRevision++; clearTimeout(hintTimer);
    for (const source of ['whatsapp', 'fulfillment']) { const box = document.getElementById(`${source}Hints`); box.replaceChildren(); box.hidden = true; }
  };
  const refreshHints = async () => {
    const current = ++hintRevision;
    for (const [source, text] of [['whatsapp', whatsappText.value], ['fulfillment', fulfillmentText.value]]) {
      const box = document.getElementById(`${source}Hints`);
      if (!text.trim()) { box.hidden = true; box.replaceChildren(); continue; }
      try {
        const data = await request('/api/products/hints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'general', text }) });
        if (current !== hintRevision) return;
        box.replaceChildren(); box.hidden = !data.products.length;
        if (data.products.length) {
          const heading = document.createElement('strong'); heading.textContent = 'Fulfillment System reminders'; box.append(heading);
          for (const product of data.products) { const row = document.createElement('p'); row.textContent = [product.name, product.fulfillmentSystemName ? `System name: ${product.fulfillmentSystemName}` : '', product.receivingDetails].filter(Boolean).join('\n'); box.append(row); }
        }
      } catch (error) { if (current === hintRevision) { box.hidden = false; box.textContent = `Receiving reminders unavailable: ${error.message}`; } }
    }
  };
  const invalidate = () => {
    inputRevision++; activeResult = null; limitDecisions = {}; declinedLimitItems = [];
    results.textContent = 'Inputs changed. Run Analyze to verify the current order.';
    screenshots.invalidate(); clearHints();
    hintTimer = setTimeout(refreshHints, 400);
  };
  const catalogUI = setupCatalog({ request, onUpdated: invalidate });
  const screenshots = setupScreenshots({ request, inputs: inputKey, onText: (source, text) => {
    const input = source === 'whatsapp' ? whatsappText : fulfillmentText; input.value = text;
    chrome.storage.local.set({ [source === 'whatsapp' ? 'whatsappText' : 'fulfillmentText']: text }); invalidate();
  } });
  const resetContext = () => { contextRevision++; inputRevision++; activeResult = null; limitDecisions = {}; catalogUI.reset(); screenshots.reset(); clearHints(); };
  document.getElementById('openPortal').addEventListener('click', () => {
    try { chrome.tabs.create({ url: normalizeBackendUrl(savedBackendUrl) }); } catch (error) { showError(error); }
  });
  const authStatus = document.getElementById('authStatus');
  const signInForm = document.getElementById('signInForm');
  const btnSignOut = document.getElementById('btnSignOut');

  const showError = (error) => {
    results.textContent = error.message || 'Unable to contact the backend.';

  };
  const updateAuth = async () => {
    const { authSession } = await chrome.storage.session.get('authSession');
    signInForm.hidden = !!authSession;
    btnSignOut.hidden = !authSession;
    authStatus.textContent = authSession ? `Signed in as ${authSession.email}` : 'Sign in with your approved portal email/password account.';
    if (!authSession) { resetContext(); }
    if (!authSession) agentNameInput.value = '';
  };
  const loadProfile = async () => {
    const profile = await request('/api/auth/me');
    agentNameInput.value = profile.name;
    authStatus.textContent = `Signed in as ${profile.name} (${profileRoles(profile)})`;
    void refreshHints();
  };
  signInForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('btnSignIn');
    const passwordInput = document.getElementById('signInPassword');
    button.disabled = true;
    try {
      normalizeBackendUrl(savedBackendUrl);
      await signIn(document.getElementById('signInEmail').value.trim(), passwordInput.value);
      await updateAuth();
      await loadProfile();
      results.textContent = 'Signed in. Ready for an audit.';
    } catch (error) {
      await signOut();
      await updateAuth();
      showError(error);
    } finally {
      passwordInput.value = '';
      button.disabled = false;
    }
  });
  btnSignOut.addEventListener('click', async () => {
    await signOut();
    await updateAuth();
    activeResult = null;
    results.textContent = 'Signed out.';
  });

  const checkConnection = async () => {
    const attempt = ++connectionAttempt;
    if (!savedBackendUrl) {
      connectionBadge.textContent = '● Save your Render URL';
      return;
    }
    connectionBadge.textContent = '● Connecting / waking service…';
    connectionBadge.style.color = '#B45309';
    connectionBadge.style.backgroundColor = '#FEF3C7';
    try {
      const data = await fetchJson(`${normalizeBackendUrl(savedBackendUrl)}/api/health`);
      if (data.status !== 'ok') throw new Error('Unexpected health response.');
      if (attempt !== connectionAttempt) return;
      connectionBadge.title = '';
      connectionBadge.textContent = '● Connected (Live)';
      connectionBadge.style.color = '#047857';
      connectionBadge.style.backgroundColor = '#D1FAE5';
    } catch (error) {
      if (attempt !== connectionAttempt) return;
      connectionBadge.textContent = '● Connection failed';
      connectionBadge.title = error.message;
      connectionBadge.style.color = '#DC2626';
      connectionBadge.style.backgroundColor = '#FEE2E2';
    }
  };

  // State variables for dynamic interactive flows
  let activeResult = null;
  let declinedLimitItems = [];
  let limitDecisions = {};

  const saveLimitAcknowledgement = async (id, key, answer) => {
    const context = contextRevision, version = inputRevision;
    try { await request(`/api/audits/${encodeURIComponent(id)}/order-limit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, answer }) }); }
    catch { if (context === contextRevision && version === inputRevision) {
      const warning = document.createElement('p'); warning.textContent = 'Decision acknowledged here, but could not be saved to history.'; results.append(warning);
    } }
  };
  const renderResults = () => {
    if (!activeResult) return;

    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    let html = '';
    if (activeResult.allMatch) {
       html += '<div class="badge badge-success">CLEARED FOR LAUNCH</div>';
       html += '<p style="color:#065F46; font-weight:bold; margin:4px 0 0 0; font-size:11px;">' + escape(activeResult.verdict) + '</p>';
    } else {
       html += '<div class="badge badge-error">DISCREPANCY ALERT (' + escape(activeResult.issueCount) + ')</div>';
       html += '<p style="color:#991B1B; font-weight:bold; margin:4px 0; font-size:11px;">' + escape(activeResult.verdict) + '</p>';
    }

    // Display compared items list
    html += '<div style="margin-top:8px; border-top: 1px solid #F3E8FF; padding-top:6px;">';
    activeResult.items.forEach((it, idx) => {
      const itemColor = ['match', 'order limit applied'].includes(it.status) ? '#047857' : (it.status === 'out of stock' ? '#D97706' : '#DC2626');
      const itemSymbol = ['match', 'order limit applied'].includes(it.status) ? '✓' : (it.status === 'out of stock' ? '⚠' : '✗');
      
      html += '<div style="border-bottom:1px solid #FAF5FF; padding:6px 0; font-size:10.5px;">';
      html += '<strong style="color:#3B1A5E;">' + itemSymbol + ' ' + escape(it.name) + '</strong>';
      html += ' (Req: ' + escape(it.requested) + ' | Sys: ' + escape(it.found) + ')';
      html += '<br/><span style="color:' + itemColor + '; font-size:9.5px; font-weight:600;">Status: ' + escape(it.status.toUpperCase()) + '</span>';
      
      if (it.action) {
        html += '<br/><span style="color:#5C2D91; font-size:9.5px; font-weight:500;">➔ ' + escape(it.action) + '</span>';
      }

      // Inline Order Limit confirmation block (matching React app's interactive behavior)
      if (it.fulfillment?.orderLimitEligible && it.fulfillment.orderLimitDecision === undefined && !declinedLimitItems.includes(it.name)) {
        html += '<div class="order-limit-prompt" style="background:#FFFDF5; border:1px solid #FCD34D; border-radius:6px; padding:6px; margin:6px 0; font-size:10px; text-align:left;">';
        html += '<div style="font-weight:bold; color:#78350F; margin-bottom:2px;">⚠ Order Limit Verification Required</div>';
        html += '<div style="color:#555; margin-bottom:4px;">Is this subject to an order limit of <strong>' + escape(it.found) + '</strong> units?</div>';
        html += '<div style="display:flex; gap:6px;">';
        html += '<button class="btn-limit-no" data-index="' + idx + '" style="flex:1; background:#F3F4F6; border:1px solid #D1D5DB; border-radius:4px; padding:3px; font-size:9px; cursor:pointer; font-weight:bold; color:#4B5563;">No, Discrepancy</button>';
        html += '<button class="btn-limit-yes" data-index="' + idx + '" style="flex:1; background:#5C2D91; color:white; border:none; border-radius:4px; padding:3px; font-size:9px; cursor:pointer; font-weight:bold;">Yes, Apply Limit</button>';
        html += '</div>';
        html += '</div>';
      }

      html += '</div>';
    });
    html += '</div>';

    // Key insights
    if (activeResult.insights && activeResult.insights.length > 0) {
      html += '<div style="margin-top:8px; padding-top:6px; border-top:1px solid #F3E8FF; color:#555; font-size:10px;"><strong>Key Insights:</strong><ul style="padding-left:12px; margin:4px 0 0 0;">';
      activeResult.insights.forEach(ins => {
        html += '<li style="margin-bottom:3px;">' + escape(ins) + '</li>';
      });
      html += '</ul></div>';
    }

    // Metadata details
    if (activeResult.meta) {
       html += '<div style="margin-top:8px; border-top:1px dashed #D6C2EB; padding-top:6px; font-size:10px; color:#1E1B4B; background:#FAF5FF; padding:5px; border-radius:4px;">';
       html += '<strong style="color:#5C2D91; display:block; margin-bottom:3px;">Audited Metadata Details:</strong>';
       html += '• <strong>Date:</strong> ' + (activeResult.meta.date ? escape(activeResult.meta.date.whatsappValue) || 'N/A' : 'N/A');
       html += '<br/>• <strong>Name of Orderer:</strong> ' + (activeResult.meta.ordererName ? escape(activeResult.meta.ordererName.whatsappValue) || 'N/A' : 'N/A');
       html += '<br/>• <strong>Name of Health Facility:</strong> ' + (activeResult.meta.facilityName ? escape(activeResult.meta.facilityName.whatsappValue) || 'N/A' : 'N/A');

       if (activeResult.meta.dropArea && activeResult.meta.dropArea.whatsappValue && activeResult.meta.dropArea.whatsappValue !== 'N/A' && activeResult.meta.dropArea.whatsappValue.trim() !== '') {
         html += '<br/>• <strong>Delivery / Drop area:</strong> ' + escape(activeResult.meta.dropArea.whatsappValue);
       }
       if (activeResult.meta.district && activeResult.meta.district.whatsappValue && activeResult.meta.district.whatsappValue !== 'N/A' && activeResult.meta.district.whatsappValue.trim() !== '') {
         html += '<br/>• <strong>District:</strong> ' + escape(activeResult.meta.district.whatsappValue);
       }
       if (activeResult.meta.deliveryTime && activeResult.meta.deliveryTime.whatsappValue && activeResult.meta.deliveryTime.whatsappValue !== 'N/A' && activeResult.meta.deliveryTime.whatsappValue.trim() !== '') {
         html += '<br/>• <strong>Preferred time for Delivery:</strong> ' + escape(activeResult.meta.deliveryTime.whatsappValue);
       }
       html += '</div>';
    }

    results.innerHTML = html;

    // Attach listeners to order limit action buttons
    const yesButtons = results.querySelectorAll('.btn-limit-yes');
    yesButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const item = activeResult.items[idx];
        if (item) {
          limitDecisions[item.fulfillment.key] = true;
          activeResult = acknowledgeOrderLimit(activeResult, item.fulfillment.key, true);
          renderResults();
          void saveLimitAcknowledgement(activeResult.id, item.fulfillment.key, true);
        }
      });
    });

    const noButtons = results.querySelectorAll('.btn-limit-no');
    noButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const item = activeResult.items[idx];
        if (item) {
          limitDecisions[item.fulfillment.key] = false;
          declinedLimitItems.push(item.name);
          activeResult = acknowledgeOrderLimit(activeResult, item.fulfillment.key, false);
          renderResults();
          void saveLimitAcknowledgement(activeResult.id, item.fulfillment.key, false);
        }
      });
    });
  };

  // Load saved state and custom backend URL
  chrome.storage.local.get(['whatsappText', 'fulfillmentText', 'customBackendUrl'], async (saved) => {
    if (saved.whatsappText !== undefined && saved.whatsappText !== null) {
      whatsappText.value = saved.whatsappText;
    }
    if (saved.fulfillmentText !== undefined && saved.fulfillmentText !== null) {
      fulfillmentText.value = saved.fulfillmentText;
    }
    // Migrate the obsolete development default; preserve explicitly configured services.
    const oldDefault = 'https://ais-dev-ksv3oiifrmnhdib3nb7awh-944779874869.europe-west2.run.app';
    savedBackendUrl = saved.customBackendUrl && saved.customBackendUrl !== oldDefault ? saved.customBackendUrl : SERVER_URL;
    backendUrlInput.value = savedBackendUrl;
    await updateAuth();
    checkConnection();
    const { authSession } = await chrome.storage.session.get('authSession');
    if (authSession && savedBackendUrl) {
      try { await loadProfile(); } catch (error) { showError(error); await updateAuth(); }
    }
  });

  whatsappText.addEventListener('input', () => { chrome.storage.local.set({ whatsappText: whatsappText.value }); invalidate(); });
  fulfillmentText.addEventListener('input', () => { chrome.storage.local.set({ fulfillmentText: fulfillmentText.value }); invalidate(); });

  const saveBackend = async (value) => {
    try {
      const normalized = normalizeBackendUrl(value);
      if (savedBackendUrl !== normalized) {
        await signOut();
        await updateAuth();
        activeResult = null;
        results.textContent = 'Backend changed. Sign in to this service to continue.';
      }
      savedBackendUrl = normalized;
      backendUrlInput.value = normalized;
      await chrome.storage.local.set({ customBackendUrl: normalized });
      backendSaveMsg.textContent = 'Backend URL saved.';
      backendSaveMsg.style.display = 'block';
      checkConnection();
    } catch (error) { showError(error); }
  };
  btnSaveBackend.addEventListener('click', () => saveBackend(backendUrlInput.value));
  btnResetBackend.addEventListener('click', async () => {
    if (SERVER_URL) return saveBackend(SERVER_URL);
    savedBackendUrl = '';
    backendUrlInput.value = '';
    await chrome.storage.local.remove('customBackendUrl');
    await signOut();
    await updateAuth();
    checkConnection();
  });

  // Clear inputs action
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      whatsappText.value = '';
      fulfillmentText.value = '';
      invalidate(); screenshots.reset(); clearHints();
      chrome.storage.local.set({ whatsappText: '', fulfillmentText: '' }, () => {
        results.innerHTML = '<p style="color:#6B7280; margin:0; text-align:center;">Inputs cleared. Ready for new audit data!</p>';
      });
    });
  }

  // Standalone Window / Keep Open Behavior
  const urlParams = new URLSearchParams(window.location.search);
  const isStandalone = urlParams.get('standalone') === 'true';
  const btnKeepOpen = document.getElementById('btnKeepOpen');
  if (isStandalone && btnKeepOpen) {
    btnKeepOpen.style.display = 'none';
    // Make the body size adapt nicely to window size
    document.body.style.width = '100%';
    document.body.style.height = '100vh';
    document.body.style.boxSizing = 'border-box';
  } else if (btnKeepOpen) {
    btnKeepOpen.addEventListener('click', () => {
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html?standalone=true'),
        type: 'popup',
        width: 380,
        height: 610,
        focused: true
      });
    });
  }

  // Function to request content scrape or selection capture
  const captureSelection = () => {
    results.innerHTML = '<span style="color:#5C2D91; font-weight:500;">Scraping page data...</span>';
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0 || !tabs[0]?.id) {
        results.innerHTML = '<span style="color:#DC2626; font-size:11px;">Error: No active tab found. Use the capture button on a real website/WhatsApp tab.</span>';
        return;
      }
      
      const tabId = tabs[0].id;
      const tabUrl = tabs[0].url || '';
      if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('edge://') || tabUrl.startsWith('about:') || tabUrl.startsWith('chrome-extension://')) {
        results.innerHTML = '<span style="color:#D97706; font-size:11px;">Note: Cannot capture highlights on internal chrome:// pages. Access a website first.</span>';
        return;
      }

      chrome.tabs.sendMessage(tabId, { action: "scrape" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[OrderCheck] Could not contact content script:", chrome.runtime.lastError.message);
          results.innerHTML = '<span style="color:#6B7280; font-size:11px; line-height:1.3; display:block;">Active tab does not have a running content script yet.<br/>Please copy & paste directly into the inputs above, or refresh the webpage to enable auto-capture.</span>';
          return;
        }

        if (response) {
          let hasUpdated = false;
          // Priority: use mouse selection if present
          if (response.selection) {
            fulfillmentText.value = response.selection;
            chrome.storage.local.set({ fulfillmentText: response.selection });
            hasUpdated = true;
          } else if (response.fulfillment) {
            fulfillmentText.value = response.fulfillment;
            chrome.storage.local.set({ fulfillmentText: response.fulfillment });
            hasUpdated = true;
          }
          
          if (response.whatsapp) {
            whatsappText.value = response.whatsapp;
            chrome.storage.local.set({ whatsappText: response.whatsapp });
            hasUpdated = true;
          }

          if (hasUpdated) {
            invalidate();
            results.innerHTML = '<span style="color:#047857; font-size:11px; font-weight:bold;">✓ Page data captured! Ready for analysis.</span>';
          } else {
            results.innerHTML = '<span style="color:#6B7280; font-size:11px;">No screen state detected. You can paste details manually.</span>';
          }
        } else {
          results.innerHTML = '<span style="color:#DC2626; font-size:11px;">No active scraper response. You can paste details manually!</span>';
        }
      });
    });
  };

  // Capture selection trigger click
  btnCapture.addEventListener('click', captureSelection);

  const verify = async () => {
    const wa = whatsappText.value.trim();
    const ff = fulfillmentText.value.trim();

    if (!wa || !ff) {
      results.innerHTML = '<span style="color:red; font-size:11px;">Error: Paste or load both the WhatsApp client order and the systems fulfillment log.</span>';
      return;
    }

    if (btnVerify.disabled) return;
    const version = inputRevision, context = contextRevision;
    activeResult = null;
    btnVerify.disabled = true;
    results.innerHTML = '<span style="color:#5C2D91; font-weight:bold; animation:pulse 1s infinite;">Checking clinical compliance portal...</span>';

    try {
      const activeUrl = normalizeBackendUrl(savedBackendUrl);
      if (normalizeBackendUrl(backendUrlInput.value) !== activeUrl) {
        throw new Error('Click Save to apply your changed backend URL before auditing.');
      }
      const catalog = await request('/api/products');
      if (version !== inputRevision || context !== contextRevision) return;
      const data = await request('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(auditBody(wa, ff, catalog.revision, limitDecisions)),
      });
      if (!Array.isArray(data.items) || typeof data.allMatch !== 'boolean') {
        throw new Error('Unexpected audit response from the backend.');
      }

      if (version !== inputRevision || context !== contextRevision) return;
      void refreshHints();
      // Initialize active results and render dynamically
      activeResult = data;
      renderResults();

    } catch (err) {
      if (version === inputRevision && context === contextRevision) showError(err);
      await updateAuth();
    } finally {
      btnVerify.disabled = false;
    }
  };
  btnVerify.addEventListener('click', () => { limitDecisions = {}; declinedLimitItems = []; void verify(); });
});
