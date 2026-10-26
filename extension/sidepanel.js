import { setupGeneralProductReview } from './general-report.js';
import { restoreGeneralAudit, rememberGeneralAudit } from './general-session.js';
import { setupFsPanel } from './fs-panel.js';
import { createFsScriptSync } from './fs-script.js';
import { setupCatalog } from './catalog.js';
import { setupScreenshots } from './screenshots.js';
import { auditBody, profileRoles } from './audit.js';
import { extensionConfig } from './config.js';
import { normalizeBackendUrl, fetchJson } from './backend.js';
import { signIn, signOut, restoreSession, backendRequest } from './auth.js';
import { acknowledgeOrderLimit } from './order-limits.js';
import { buildReport } from './report.js';
import { setupVaccine } from './sidepanel-vaccine.js';

const SERVER_URL = extensionConfig.backendUrl;
const EMPTY_RESULT = 'Add both logs, then run the audit.';
const AUTO_CLEAR_SECONDS = 3;  // keep in sync with the drain animation in sidepanel.css

// Used only until the backend returns the account's display name.
const nameFromEmail = (email) => String(email || '').split('@')[0]
  .split(/[._-]+/).filter(Boolean)
  .map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  const btnVerify = $('btnVerify');
  const btnCapture = $('btnCapture');
  const btnClear = $('btnClear');
  const whatsappText = $('whatsappText');
  const fulfillmentText = $('fulfillmentText');
  const results = $('results');
  const backendUrlInput = $('backendUrlInput');
  const backendSaveMsg = $('backendSaveMsg');
  const connectionBadge = $('connectionBadge');

  const authView = $('authView');
  const appView = $('appView');
  const signInForm = $('signInForm');
  const signInMessage = $('signInMessage');
  const titleEl = $('title');
  const subtitleEl = $('subtitle');
  const authStatus = $('authStatus');

  let savedBackendUrl = SERVER_URL;
  let connectionAttempt = 0;
  let contextRevision = 0, inputRevision = 0, hintRevision = 0, hintTimer;
  let activeResult = null;
  let lastGeneralAudit = null;
  let declinedLimitItems = [];
  let limitDecisions = {};
  let sessionEmail = '', profileName = '', profileRole = '';
  let analysisTimer = null, autoClearTimer = null, lastDurationMs = 0;
  let awaitingFix = false, lastAuditedKey = '';
  let productReview;
  const btnConfirm = $('btnConfirm');
  const confirmGroup = $('confirmGroup');
  const setAwaitingFix = (value) => { awaitingFix = value; confirmGroup.hidden = !value; };

  /* ---------- Result box helpers ---------- */

  const setMessage = (text, tone = 'muted') => {
    results.dataset.state = 'message';
    results.dataset.tone = tone;
    results.textContent = text;
  };

  const showError = (error) => {
    const message = error?.message || 'Unable to contact the backend.';
    if (authView.hidden) setMessage(message, 'error');
    else setSignInMessage(message, 'error');
  };

  function setSignInMessage(text, tone = 'error') {
    signInMessage.dataset.tone = tone;
    signInMessage.textContent = text;
  }

  /* ---------- Requests and hints ---------- */

  const inputKey = () => JSON.stringify([whatsappText.value, fulfillmentText.value]);

  const request = async (endpoint, options = {}) => {
    const context = contextRevision;
    const data = await backendRequest(normalizeBackendUrl(savedBackendUrl), endpoint, options);
    if (context !== contextRevision) throw new Error('Account or backend changed. Retry on the current service.');
    return data;
  };

  const clearHints = () => {
    hintRevision++;
    clearTimeout(hintTimer);
    for (const source of ['whatsapp', 'fulfillment']) {
      const box = $(`${source}Hints`);
      box.replaceChildren();
      box.hidden = true;
    }
  };

  const refreshHints = async () => {
    const current = ++hintRevision;
    for (const [source, text] of [['whatsapp', whatsappText.value], ['fulfillment', fulfillmentText.value]]) {
      const box = $(`${source}Hints`);
      if (!text.trim()) { box.hidden = true; box.replaceChildren(); continue; }
      try {
        const data = await request('/api/products/hints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'general', text }),
        });
        if (current !== hintRevision) return;
        box.replaceChildren();
        box.hidden = !data.products.length;
        if (data.products.length) {
          const heading = document.createElement('strong');
          heading.textContent = 'Fulfillment System reminders';
          box.append(heading);
          for (const product of data.products) {
            const row = document.createElement('p');
            row.textContent = [
              product.name,
              product.fulfillmentSystemName ? `System name: ${product.fulfillmentSystemName}` : '',
              product.receivingDetails,
            ].filter(Boolean).join('\n');
            box.append(row);
          }
        }
      } catch (error) {
        if (current === hintRevision) { box.hidden = false; box.textContent = `Receiving reminders unavailable: ${error.message}`; }
      }
    }
  };

  // The result sits below the logs, so bring it into view when analysis starts.
  const showResultBox = () => results.parentElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const cancelAutoClear = () => { clearInterval(autoClearTimer); autoClearTimer = null; };
  const stopAnalysisTimer = () => { clearInterval(analysisTimer); analysisTimer = null; };

  // Shows a live seconds counter in the result box and on the button.
  const startAnalysisTimer = () => {
    const startedAt = Date.now();
    results.dataset.state = 'busy';
    delete results.dataset.tone;
    results.innerHTML = '<div class="spinner" aria-hidden="true"></div>'
      + '<div class="busy-label">Analyzing order</div>'
      + '<div class="elapsed" id="elapsed">0s</div>';
    btnVerify.textContent = 'Analyzing… 0s';
    showResultBox();
    stopAnalysisTimer();
    analysisTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      const label = $('elapsed');
      if (label) label.textContent = `${seconds}s`;
      btnVerify.textContent = `Analyzing… ${seconds}s`;
    }, 250);
    return startedAt;
  };

  const clearAll = (message, tone = 'muted') => {
    lastGeneralAudit = null;
    cancelAutoClear();
    setAwaitingFix(false);
    whatsappText.value = '';
    fulfillmentText.value = '';
    invalidate();
    screenshots.reset();
    clearHints();
    chrome.storage.local.set({ whatsappText: '', fulfillmentText: '' }, () => {
      setMessage(message, tone);
      whatsappText.focus();
    });
  };

  // A clean order leaves the screen after a few seconds so the next one starts fresh.
  const scheduleAutoClear = () => {
    cancelAutoClear();
    let left = AUTO_CLEAR_SECONDS;
    autoClearTimer = setInterval(() => {
      left -= 1;
      const count = $('clearCount');
      if (count) count.textContent = left;
      if (left <= 0) clearAll(EMPTY_RESULT);
    }, 1000);
  };

  const invalidate = () => {
    cancelAutoClear();
    inputRevision++;
    activeResult = null;
    limitDecisions = {};
    declinedLimitItems = [];
    const hasInput = whatsappText.value.trim() || fulfillmentText.value.trim();
    setMessage(hasInput ? 'Logs changed. Run the audit again to check this order.' : EMPTY_RESULT);
    screenshots.invalidate();
    clearHints();
    hintTimer = setTimeout(refreshHints, 400);
  };

  const catalogUI = setupCatalog({ request, onUpdated: invalidate });
  const screenshots = setupScreenshots({
    request,
    inputs: inputKey,
    onText: (source, text) => {
      const input = source === 'whatsapp' ? whatsappText : fulfillmentText;
      input.value = text;
      chrome.storage.local.set({ [source === 'whatsapp' ? 'whatsappText' : 'fulfillmentText']: text });
      invalidate();
    },
  });

  const vaccine = setupVaccine({ request });
  document.addEventListener('ordercheck:fs-facility', event => { void vaccine.setFsFacility(event.detail).catch(error => console.warn('[OrderCheck] FS facility sync failed:', error.message)); });

  /* ---------- Checker tabs ---------- */

  const tabButtons = { general: $('tabGeneral'), vaccine: $('tabVaccine') };
  let activeTab = 'general';
  const setTab = (name, { save = true } = {}) => {
    activeTab = name === 'vaccine' ? 'vaccine' : 'general';
    for (const [key, button] of Object.entries(tabButtons)) {
      button.setAttribute('aria-selected', String(key === activeTab));
      button.tabIndex = key === activeTab ? 0 : -1;
    }
    $('auditView').hidden = activeTab !== 'general';
    $('vaccineView').hidden = activeTab !== 'vaccine';
    if (activeTab === 'vaccine' && !appView.hidden) vaccine.activate();
    if (save) chrome.storage.local.set({ activeTab });
  };
  for (const [key, button] of Object.entries(tabButtons)) {
    button.addEventListener('click', () => setTab(key));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const next = key === 'general' ? 'vaccine' : 'general';
      setTab(next);
      tabButtons[next].focus();
    });
  }

  const resetContext = () => {
    lastGeneralAudit = null; productReview?.reset();
    vaccine.reset();
    cancelAutoClear();
    setAwaitingFix(false);
    contextRevision++;
    inputRevision++;
    activeResult = null;
    limitDecisions = {};
    catalogUI.reset();
    screenshots.reset();
    clearHints();
  };

  /* ---------- Sign-in gate and greeting ---------- */

  const renderIdentity = () => {
    const name = profileName || nameFromEmail(sessionEmail) || 'there';
    titleEl.textContent = `Hello, ${name}`;
    subtitleEl.textContent = 'Compliance companion';
    authStatus.textContent = profileRole ? `Signed in as ${profileRole}` : `Signed in as ${sessionEmail}`;
    authStatus.hidden = false;
  };

  const renderSignedOut = () => {
    titleEl.textContent = 'OrderCheck';
    subtitleEl.textContent = 'Compliance companion';
    authStatus.hidden = true;
    authStatus.textContent = '';
  };

  const updateAuth = async () => {
    const { authSession } = await chrome.storage.session.get('authSession');
    const signedIn = !!authSession;
    authView.hidden = signedIn;
    appView.hidden = !signedIn;
    if (signedIn) {
      sessionEmail = authSession.email || sessionEmail;
      renderIdentity();
      if (activeTab === 'vaccine') vaccine.activate();
    } else {
      sessionEmail = ''; profileName = ''; profileRole = '';
      renderSignedOut();
      resetContext();
    }
  };

  const loadProfile = async () => {
    const profile = await request('/api/auth/me');
    profileName = profile.name || '';
    profileRole = profileRoles(profile);
    renderIdentity();
    void refreshHints();
  };

  signInForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('btnSignIn');
    const emailInput = $('signInEmail');
    const passwordInput = $('signInPassword');
    if (!emailInput.value.trim() || !passwordInput.value) {
      setSignInMessage('Enter your email and password.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Signing in…';
    setSignInMessage('');
    try {
      normalizeBackendUrl(savedBackendUrl);
      const email = emailInput.value.trim();
      const keepSignedIn = $('keepSignedIn').checked;
      await signIn(email, passwordInput.value, { keepSignedIn });
      await chrome.storage.local.set({ rememberEmail: $('rememberEmail').checked, keepSignedInPref: keepSignedIn });
      if ($('rememberEmail').checked) await chrome.storage.local.set({ rememberedEmail: email });
      else await chrome.storage.local.remove('rememberedEmail');
      await updateAuth();
      await loadProfile();
      setMessage(EMPTY_RESULT);
    } catch (error) {
      await signOut();
      await updateAuth();
      showError(error);
    } finally {
      passwordInput.value = '';
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });

  $('btnSignOut').addEventListener('click', async () => {
    await signOut();
    await updateAuth();
    setMessage(EMPTY_RESULT);
    setSignInMessage('You have been signed out.', 'muted');
    focusSignIn();
  });

  $('openPortal').addEventListener('click', () => {
    try { chrome.tabs.create({ url: normalizeBackendUrl(savedBackendUrl) }); } catch (error) { showError(error); }
  });

  $('btnHide').addEventListener('click', async () => {
    try {
      if (chrome.sidePanel?.close) {
        const current = await chrome.windows.getCurrent();
        await chrome.sidePanel.close({ windowId: current.id });
        return;
      }
    } catch { /* fall through to window.close() */ }
    window.close();
  });

  // Put the cursor where it is useful: password if the email is already filled in.
  const focusSignIn = () => { ($('signInEmail').value ? $('signInPassword') : $('signInEmail')).focus(); };

  /* ---------- Connection ---------- */

  const setBadge = (state, text, title = '') => {
    connectionBadge.dataset.state = state;
    connectionBadge.textContent = text;
    connectionBadge.title = title;
  };

  const checkConnection = async () => {
    const attempt = ++connectionAttempt;
    if (!savedBackendUrl) { setBadge('error', 'No URL saved'); return; }
    setBadge('pending', 'Connecting…');
    try {
      const data = await fetchJson(`${normalizeBackendUrl(savedBackendUrl)}/api/health`);
      if (data.status !== 'ok') throw new Error('Unexpected health response.');
      if (attempt !== connectionAttempt) return;
      setBadge('ok', 'Connected');
    } catch (error) {
      if (attempt !== connectionAttempt) return;
      setBadge('error', 'Connection failed', error.message);
    }
  };

  const saveBackend = async (value) => {
    try {
      const normalized = normalizeBackendUrl(value);
      if (savedBackendUrl !== normalized) {
        await signOut();
        await updateAuth();
        activeResult = null;
        setSignInMessage('Backend changed. Sign in to this service to continue.', 'muted');
      }
      savedBackendUrl = normalized;
      backendUrlInput.value = normalized;
      await chrome.storage.local.set({ customBackendUrl: normalized });
      backendSaveMsg.textContent = 'Backend URL saved.';
      backendSaveMsg.hidden = false;
      checkConnection();
    } catch (error) { showError(error); }
  };

  $('btnSaveBackend').addEventListener('click', () => saveBackend(backendUrlInput.value));
  $('btnResetBackend').addEventListener('click', async () => {
    if (SERVER_URL) return saveBackend(SERVER_URL);
    savedBackendUrl = '';
    backendUrlInput.value = '';
    await chrome.storage.local.remove('customBackendUrl');
    await signOut();
    await updateAuth();
    checkConnection();
  });

  /* ---------- Audit report ---------- */

  const renderResults = ({ holdClear = false } = {}) => {
    if (!activeResult) return;
    const { html: legacyHtml, autoClear } = buildReport(activeResult, {
      durationMs: lastDurationMs, declinedLimitItems, holdClear, autoClearSeconds: AUTO_CLEAR_SECONDS,
    });
    results.dataset.state = 'report';
    delete results.dataset.tone;
    results.innerHTML = activeResult.generalAudit ? productReview.render(activeResult) : legacyHtml;
    setAwaitingFix(!activeResult.allMatch);
    if (autoClear && !activeResult.generalAudit) scheduleAutoClear(); else cancelAutoClear();
    void rememberGeneralAudit(activeResult, savedBackendUrl);
  };

  productReview = setupGeneralProductReview({ root: results, request, getResult: () => activeResult,
    getSources: () => ({ whatsappMessage: whatsappText.value, fulfillmentConfirmation: fulfillmentText.value }),
    contextKey: () => `${contextRevision}:${inputRevision}:${savedBackendUrl}`,
    onSaved: updated => { activeResult = updated; lastGeneralAudit = updated; }, rerender: () => renderResults({ holdClear: true }),
    onBusy: busy => { btnVerify.disabled = busy; btnConfirm.disabled = busy; cancelAutoClear(); },
  });

  // Records the order-limit decision on the audit history. Returns whether it saved.
  const saveLimitAcknowledgement = async (id, key, answer) => {
    const context = contextRevision, version = inputRevision;
    try {
      await request(`/api/audits/${encodeURIComponent(id)}/order-limit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, answer }),
      });
      return true;
    } catch {
      if (context === contextRevision && version === inputRevision) {
        const warning = document.createElement('p');
        warning.className = 'limit-warning';
        warning.textContent = 'Decision acknowledged here, but could not be saved to history.';
        results.append(warning);
      }
      return false;
    }
  };

  // Applies the decision locally (no second audit), then saves it. A clean result
  // only starts its auto-clear once the decision is saved, so nothing is wiped early.
  const acknowledgeLimit = async (item, answer) => {
    activeResult = acknowledgeOrderLimit(activeResult, item.fulfillment.key, answer);
    renderResults({ holdClear: true });
    const id = activeResult.id, version = inputRevision, context = contextRevision;
    const saved = await saveLimitAcknowledgement(id, item.fulfillment.key, answer);
    if (saved && activeResult?.allMatch && version === inputRevision && context === contextRevision) renderResults();
  };

  results.addEventListener('click', (event) => {
    const general = event.target.closest('button[data-general-limit]');
    if (general && activeResult && !productReview.isBusy()) {
      const item = activeResult.items.find(item => item.fulfillment.key === general.dataset.key);
      if (item) { const answer = general.dataset.generalLimit === 'yes'; limitDecisions[item.fulfillment.key] = answer; void acknowledgeLimit(item, answer); }
      return;
    }
    const button = event.target.closest('button[data-limit]');
    if (!button || !activeResult || productReview.isBusy()) return;
    const item = activeResult.items[Number(button.dataset.index)];
    if (!item) return;
    const answer = button.dataset.limit === 'yes';
    limitDecisions[item.fulfillment.key] = answer;
    if (!answer) declinedLimitItems.push(item.name);
    void acknowledgeLimit(item, answer);
  });

  /* ---------- Inputs ---------- */

  chrome.storage.local.get(['whatsappText', 'fulfillmentText', 'customBackendUrl', 'rememberedEmail', 'rememberEmail', 'keepSignedInPref', 'activeTab'], async (saved) => {
    setTab(saved.activeTab, { save: false });
    if (saved.whatsappText != null) whatsappText.value = saved.whatsappText;
    if (saved.fulfillmentText != null) fulfillmentText.value = saved.fulfillmentText;
    // Migrate the obsolete development default; keep any explicitly configured service.
    const oldDefault = 'https://ais-dev-ksv3oiifrmnhdib3nb7awh-944779874869.europe-west2.run.app';
    savedBackendUrl = saved.customBackendUrl && saved.customBackendUrl !== oldDefault ? saved.customBackendUrl : SERVER_URL;
    backendUrlInput.value = savedBackendUrl;
    $('rememberEmail').checked = saved.rememberEmail !== false;
    $('keepSignedIn').checked = saved.keepSignedInPref === true;
    if (saved.rememberedEmail) $('signInEmail').value = saved.rememberedEmail;
    const restored = await restoreSession();   // automatic sign-in when "Keep me signed in" was chosen
    await updateAuth();
    if (authView.hidden === false) focusSignIn();
    checkConnection();
    const { authSession } = await chrome.storage.session.get('authSession');
    if (authSession && savedBackendUrl) {
      try { await loadProfile();
        const restoreVersion = inputRevision;
        const savedAudit = await restoreGeneralAudit(request, savedBackendUrl, { whatsappMessage: whatsappText.value, fulfillmentConfirmation: fulfillmentText.value });
        if (savedAudit && restoreVersion === inputRevision) { activeResult = savedAudit; lastGeneralAudit = savedAudit; renderResults({ holdClear: true }); }
      } catch (error) {
        await updateAuth();
        if (restored && !authView.hidden) { setSignInMessage('Your saved session expired. Please sign in again.'); focusSignIn(); }
        else showError(error);
      }
    }
  });

  whatsappText.addEventListener('input', () => { chrome.storage.local.set({ whatsappText: whatsappText.value }); invalidate(); });
  fulfillmentText.addEventListener('input', () => { chrome.storage.local.set({ fulfillmentText: fulfillmentText.value }); invalidate(); });

  btnClear.addEventListener('click', () => clearAll('Both logs cleared. Ready for the next order.'));

  const captureSelection = () => {
    setMessage('Capturing page data…', 'busy');
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0 || !tabs[0]?.id) {
        setMessage('No active tab found. Open WhatsApp Web or the fulfillment page, then capture again.', 'error');
        return;
      }
      const tabId = tabs[0].id;
      const tabUrl = tabs[0].url || '';
      if (/^(chrome|edge|about|chrome-extension):/.test(tabUrl)) {
        setMessage('Browser pages cannot be captured. Switch to a website tab first.', 'warn');
        return;
      }
      chrome.tabs.sendMessage(tabId, { action: 'scrape' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[OrderCheck] Could not contact content script:', chrome.runtime.lastError.message);
          setMessage('This tab is not ready for capture. Refresh the page, or paste the details above.', 'muted');
          return;
        }
        if (!response) { setMessage('Nothing came back from the page. Paste the details manually.', 'error'); return; }

        let updated = false;
        // A highlighted selection wins over the page-wide fallback.
        if (response.selection) {
          fulfillmentText.value = response.selection;
          chrome.storage.local.set({ fulfillmentText: response.selection });
          updated = true;
        } else if (response.fulfillment) {
          fulfillmentText.value = response.fulfillment;
          chrome.storage.local.set({ fulfillmentText: response.fulfillment });
          updated = true;
        }
        if (response.whatsapp) {
          whatsappText.value = response.whatsapp;
          chrome.storage.local.set({ whatsappText: response.whatsapp });
          updated = true;
        }
        if (updated) {
          invalidate();
          setMessage('Page data captured. Ready to analyze.', 'success');
        } else {
          setMessage('No page data found. Highlight the fulfillment data, or paste it manually.');
        }
      });
    });
  };
  btnCapture.addEventListener('click', captureSelection);

  /* ---------- Audit ---------- */

  // Adds a short note directly under the verdict in the current report.
  const addNotice = (text) => {
    const verdict = results.querySelector('.verdict-ok, .verdict-bad');
    if (!verdict) return;
    const note = document.createElement('p');
    note.className = 'confirm-note';
    note.textContent = text;
    verdict.after(note);
  };

  // After the fix, pull the updated fulfillment log from the active page if possible.
  const recaptureFulfillment = () => new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) { resolve(); return; }
      chrome.tabs.sendMessage(tab.id, { action: 'scrape' }, (response) => {
        if (chrome.runtime.lastError || !response) { resolve(); return; }
        const text = response.selection || response.fulfillment;
        if (text && text !== fulfillmentText.value) {
          fulfillmentText.value = text;
          chrome.storage.local.set({ fulfillmentText: text });
        }
        resolve();
      });
    });
  });

  const confirmResolved = async () => {
    if (btnVerify.disabled || productReview.isBusy()) return;
    if (!whatsappText.value.trim() || !fulfillmentText.value.trim()) {
      setMessage('Add both the WhatsApp order and the fulfillment log first.', 'error');
      return;
    }
    await recaptureFulfillment();
    if (activeResult && inputKey() === lastAuditedKey) {
      // Nothing changed since the last check, so another audit would repeat the same result.
      renderResults();
      addNotice('The fulfillment log hasn\u2019t changed since the last check. Fix the entry, capture the updated log, then confirm again.');
      showResultBox();
      return;
    }
    await verify({ confirm: true });
  };
  btnConfirm.addEventListener('click', () => { void confirmResolved(); });

  const verify = async ({ confirm = false } = {}) => {
    const wa = whatsappText.value.trim();
    const ff = fulfillmentText.value.trim();
    if (!wa || !ff) {
      setMessage('Add both the WhatsApp order and the fulfillment log first.', 'error');
      return;
    }
    if (btnVerify.disabled || productReview.isBusy()) return;

    cancelAutoClear();
    const version = inputRevision, context = contextRevision;
    activeResult = null;
    btnVerify.disabled = true;
    btnConfirm.disabled = true;
    lastAuditedKey = inputKey();
    const startedAt = startAnalysisTimer();

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
        body: JSON.stringify(auditBody(wa, ff, catalog.revision, limitDecisions, lastGeneralAudit)),
      });
      if (!Array.isArray(data.items) || typeof data.allMatch !== 'boolean') {
        throw new Error('Unexpected audit response from the backend.');
      }
      if (version !== inputRevision || context !== contextRevision) return;
      void refreshHints();
      lastDurationMs = Date.now() - startedAt;
      activeResult = data;
      lastGeneralAudit = data.generalAudit ? data : null;
      renderResults();
      if (confirm) {
        if (autoClearTimer !== null) {
          // Clean on re-check: the fix is confirmed, so clear straight away.
          clearAll('Resolved. Everything cleared, ready for the next order.', 'success');
        } else {
          addNotice(`Not resolved yet. ${data.issueCount ?? 'Some'} discrepanc${data.issueCount === 1 ? 'y remains' : 'ies remain'}.`);
        }
      }
    } catch (err) {
      // Decide before updateAuth(): signing out resets the context revision.
      const stillCurrent = version === inputRevision && context === contextRevision;
      await updateAuth();
      if (stillCurrent) showError(err);
    } finally {
      stopAnalysisTimer();
      btnVerify.disabled = false;
      btnConfirm.disabled = false;
      btnVerify.textContent = 'Analyze discrepancies';
    }
  };

  btnVerify.addEventListener('click', () => {
    limitDecisions = {};
    declinedLimitItems = [];
    void verify();
  });
});

// Sync live FS facility and customer script into the original OrderCheck side panel.
// This runs after the core panel initializes; it never writes to FS.
document.addEventListener('DOMContentLoaded', () => {
  try {
    const fulfillment = document.getElementById('vxFulfillment');
    const sync = fulfillment ? createFsScriptSync({
      field: fulfillment,
      onChanged: () => fulfillment.dispatchEvent(new Event('input', { bubbles: true })),
      persist: text => { void chrome.storage.local.set({ vaccineFulfillment: text }); },
    }) : null;
    setupFsPanel({
      onFacility: facility => { document.dispatchEvent(new CustomEvent('ordercheck:fs-facility', {detail: facility})); },
      onScript: script => { if (sync) sync.apply(script); },
    });
  } catch (error) { console.error('[OrderCheck] FS panel initialization failed:', error); }
});
