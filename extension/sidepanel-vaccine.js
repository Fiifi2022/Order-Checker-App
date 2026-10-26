import { verifiedDeductionReceipt } from './vaccine-api.js';
// Vaccine Checker tab.
// Flow: select facility -> audit -> auto-deduct only if backend reports recorded FS authorization; otherwise request confirmation.
import { buildReport, escapeHtml } from './report.js';
import { captureFromActiveTab } from './capture.js';
import { auditedFulfillmentItems } from './vaccine-display.js';
import {
  VACCINE_API, loadFacilities, parseManualFacilities, vaccineAuditBody, commitAllocation, normalizeDeductions,
} from './sidepanel-vaccine-api.js';

const AUTO_CLEAR_SECONDS = 3;
const EMPTY_RESULT = 'Add the logs, then run the audit.';

export function setupVaccine({ request }) {
  const $ = (id) => document.getElementById(id);
  const el = {
    pick: $('vxPick'), audit: $('vxAudit'), search: $('vxSearch'), list: $('vxFacilities'),
    status: $('vxFacilityStatus'), reload: $('vxReload'),
    modeCards: [...document.querySelectorAll('#vaccineView .mode-card')],
    facilityName: $('vxFacilityName'), facilityMeta: $('vxFacilityMeta'), change: $('vxChange'),
    waBlock: $('vxWhatsappBlock'), wa: $('vxWhatsapp'), waHint: $('vxWhatsappHint'),
    ff: $('vxFulfillment'), capture: $('vxCapture'), clear: $('vxClear'),
    analyze: $('vxAnalyze'), confirmGroup: $('vxConfirmGroup'), confirm: $('vxConfirm'),
    results: $('vxResults'),
    manual: $('vxManual'), manualText: $('vxManualText'), manualSave: $('vxManualSave'), manualClear: $('vxManualClear'), routeInput: $('vxRouteInput'), routeSave: $('vxRouteSave'),
  };

  let mode = 'both';
  let facilities = [], loaded = false, loading = false, usingManual = false;
  let facility = null, fsCandidate = null, fsRevision = 0, fsKey = '', facilitiesLoad = null;
  let activeResult = null, durationMs = 0, lastKey = '', lastCheckId = '';
  let commit = null;                       // { status: 'busy' | 'done' | 'failed', rows?, message? }
  let revision = 0, busy = false;
  let analysisTimer = null, clearTimer = null;

  const inputKey = () => JSON.stringify([mode, facility?.id, el.wa.value, el.ff.value]);

  /* ---------- Result box ---------- */

  const setMessage = (message, tone = 'muted') => {
    el.results.dataset.state = 'message';
    el.results.dataset.tone = tone;
    el.results.textContent = message;
  };

  const setAwaitingFix = (value) => { el.confirmGroup.hidden = !value; };
  const cancelAutoClear = () => { clearInterval(clearTimer); clearTimer = null; };
  const stopTimer = () => { clearInterval(analysisTimer); analysisTimer = null; };

  const startTimer = () => {
    const startedAt = Date.now();
    el.results.dataset.state = 'busy';
    delete el.results.dataset.tone;
    el.results.innerHTML = '<div class="spinner" aria-hidden="true"></div>'
      + '<div class="busy-label">Analyzing order</div><div class="elapsed" id="vxElapsed">0s</div>';
    el.analyze.textContent = 'Analyzing… 0s';
    el.results.parentElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    stopTimer();
    analysisTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      const label = $('vxElapsed');
      if (label) label.textContent = `${seconds}s`;
      el.analyze.textContent = `Analyzing… ${seconds}s`;
    }, 250);
    return startedAt;
  };

  const addNotice = (message) => {
    const verdict = el.results.querySelector('.verdict-ok, .verdict-bad');
    if (!verdict) return;
    const note = document.createElement('p');
    note.className = 'confirm-note';
    note.textContent = message;
    verdict.after(note);
  };

  // Presentation-only filtering: do not change the full server audit or its compliance verdict.
  const displayedItems = (items) => {
    if (!Array.isArray(items)) return [];
    const visible = auditedFulfillmentItems(items);
    if (visible.length || items.some((item) => 'fsQty' in item || 'fsPresent' in item)) return visible;
    // Legacy /api/verify report format: requested and found are numbers or quantities such as "2/2".
    const positive = (value) => {
      if (typeof value === 'number') return value > 0;
      const t = String(value ?? '').trim();
      const match = t.match(/^(?:\[)?\s*(\d+)\s*(?:\/\s*\d+)?\s*(?:\])?$/);
      return !!match && Number(match[1]) > 0;
    };
    return items.filter((item) => positive(item.found) || positive(item.requested)
      || item.fulfillment?.present === true || item.request?.present === true);
  };

  /* ---------- Report + allocation deduction ---------- */

  const deductionHtml = () => {
    if (!commit) return '';
    if (commit.status === 'busy') return '<p class="deduct-status" role="status">Requesting allocation deduction…</p>';
    if (commit.status === 'review') return `<p class="hint" role="status">${escapeHtml(commit.message)}</p>`;
    if (commit.status === 'pending') return '<div class="deduction"><h3>Audit passed — allocation unchanged</h3>'
      + '<p class="hint">Confirm that fulfillment has been authorized before deducting the allocation.</p>'
      + '<button type="button" class="btn-small" data-action="confirm-commit">Confirm fulfillment &amp; deduct allocation</button></div>';
    if (commit.status === 'failed') {
      return '<div class="deduct-failed" role="alert"><strong>Allocation not deducted</strong>'
        + `<p>${escapeHtml(commit.message)}</p>`
        + '<button type="button" class="btn-small" data-action="retry-commit">Retry same deduction request</button></div>';
    }
    if (commit.status === 'unknown') return '<p class="hint" role="status">Allocation status pending verification. Check the saved allocation record before another deduction.</p>';
    const rows = commit.rows ?? [];
    let html = '<div class="deduction"><h3>Deducted from allocation</h3>'
      + `<p class="issues-hint">${escapeHtml(facility?.name)}</p>`;
    if (rows.length) {
      html += '<ul class="alloc-list">';
      rows.forEach((row) => {
        const known = row.deducted !== null && row.before !== null && row.after !== null;
        const change = known ? `${row.before} \u2192 ${row.after} (\u2212${row.deducted})`
          : (row.after !== null ? `${row.after} left` : (row.deducted !== null ? `\u2212${row.deducted}` : ''));
        html += `<li><span class="alloc-name">${escapeHtml(row.name)}</span>`
          + `<span class="alloc-change">${escapeHtml(change)}</span></li>`;
      });
      html += '</ul>';
    } else {
      html += '<p class="hint">The allocation for this facility has been updated.</p>';
    }
    html += `<p class="clear-note">Clearing in <b id="vxClearCount">${AUTO_CLEAR_SECONDS}</b>s for the next order.</p>`
      + '<div class="clear-bar" aria-hidden="true"><span></span></div></div>';
    return html;
  };

  const render = () => {
    if (!activeResult) return;
    const report = { ...activeResult, items: displayedItems(activeResult.items) };
    const { html } = buildReport(report, {
      durationMs, holdClear: true, autoClearSeconds: AUTO_CLEAR_SECONDS, orderLimitPrompts: false,
    });
    el.results.dataset.state = 'report';
    delete el.results.dataset.tone;
    el.results.innerHTML = html;
    const verdict = el.results.querySelector('.verdict-ok, .verdict-bad');
    if (verdict && activeResult.allMatch && commit) verdict.insertAdjacentHTML('afterend', deductionHtml());
  };

  const friendlyError = (error, fallbackFor404) => (error?.unreadable ? error.message : (error?.status === 404 ? fallbackFor404 : (error?.message || 'Unable to contact the backend.')));

  const scheduleAutoClear = (rev) => {
    cancelAutoClear();
    let left = AUTO_CLEAR_SECONDS;
    clearTimer = setInterval(() => {
      if (rev !== revision) { cancelAutoClear(); return; }
      left -= 1;
      const count = $('vxClearCount');
      if (count) count.textContent = left;
      if (left <= 0) clearAll({ note: 'Cleared. Choose the next facility.' });
    }, 1000);
  };

  // Backend must verify authorization and enforce idempotency; never infer authorization from allMatch.
  const deduct = async (rev) => {
    if (!activeResult?.allMatch || !['pending', 'failed'].includes(commit?.status)) return;
    if (activeResult.canCommit !== true || activeResult.isValid !== true) return;
    commit = { status: 'busy' };
    render();
    try {
      const response = await commitAllocation(request, {
        audit: activeResult,
      });
      if (rev !== revision) return;
      // An empty/ambiguous response must never be interpreted as proof of a deduction.
      const rows = normalizeDeductions(response);
      const confirmed = !!verifiedDeductionReceipt(response, activeResult);
      // Item arrays alone do not prove that a write was committed.
      if (!confirmed) {
        commit = { status: 'unknown', message: 'The backend responded but did not confirm the allocation was deducted. Check the allocation record before attempting another deduction.' };
        render();
        return;
      }
      const displayNames = new Set(displayedItems(activeResult.items).map((item) => String(item.name ?? item.vaccine ?? '').toLowerCase()));
      commit = { status: 'done', rows: rows.filter((row) => displayNames.has(row.name.toLowerCase())) };
      render();
      scheduleAutoClear(rev);
    } catch (error) {
      if (rev !== revision) return;
      commit = {
        status: error.allocationPending ? 'unknown' : 'failed',
        message: error?.status === 404
          ? 'Allocation endpoint not found (HTTP 404). The backend must implement POST /api/vaccine/allocations/commit, or the route must be corrected.'
          : error?.status === 401 ? 'Please sign in again. The allocation request was not authorized (401).'
          : error?.status === 403 ? 'Your account does not have permission to deduct allocation (403).'
          : error?.status === 409 ? 'Allocation conflict (409). Verify the balance and order status before retrying.'
          : error?.status >= 500 ? `Backend error (${error.status}): ${error.message}`
          : (error?.message || 'Unable to contact the backend. Check connection and server logs.'),
      };
      render();
    }
  };

  /* ---------- Clearing ---------- */

  const persist = () => chrome.storage.local.set({ vaccineWhatsapp: el.wa.value, vaccineFulfillment: el.ff.value });

  const invalidate = () => {
    revision += 1;
    cancelAutoClear();
    activeResult = null;
    commit = null;
    setMessage(el.wa.value.trim() || el.ff.value.trim() ? 'Logs changed. Run the audit again.' : EMPTY_RESULT);
  };

  // Clears the order and returns to the facility list, ready for the next one.
  function clearAll({ note = '' } = {}) {
    revision += 1;
    cancelAutoClear();
    stopTimer();
    el.wa.value = '';
    el.ff.value = '';
    activeResult = null;
    commit = null;
    facility = null;
    setAwaitingFix(false);
    setMessage(EMPTY_RESULT);
    el.analyze.textContent = 'Audit order';
    persist();
    showStage('pick');
    el.search.value = '';
    renderFacilities();
    el.status.textContent = note;
  }

  /* ---------- Mode ---------- */

  const applyMode = (next, { save = true } = {}) => {
    mode = next;
    el.modeCards.forEach((card) => card.setAttribute('aria-checked', String(card.dataset.mode === mode)));
    const withWhatsapp = mode === 'both';
    el.wa.disabled = !withWhatsapp;
    el.waBlock.classList.toggle('is-inactive', !withWhatsapp);
    el.waHint.textContent = withWhatsapp
      ? 'Paste the client request or capture it from WhatsApp Web.'
      : 'Not used for fulfillment-only audits.';
    el.wa.placeholder = withWhatsapp ? 'Paste WhatsApp request here' : 'Inactive in fulfillment-only mode';
    if (save) chrome.storage.local.set({ vaccineMode: mode });
  };

  el.modeCards.forEach((card) => card.addEventListener('click', () => {
    if (card.dataset.mode === mode) return;
    applyMode(card.dataset.mode);
    if (facility) invalidate();
  }));

  /* ---------- Facility picker ---------- */

  const showStage = (stage) => {
    el.pick.hidden = stage !== 'pick';
    el.audit.hidden = stage !== 'audit';
  };

  function renderFacilities() {
    const query = el.search.value.trim().toLowerCase();
    const matches = facilities.filter((f) => !query || `${f.name} ${f.district}`.toLowerCase().includes(query));
    el.list.replaceChildren();
    for (const f of matches) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'facility-row';
      button.dataset.id = f.id;
      const name = document.createElement('span');
      name.className = 'facility-name';
      name.textContent = f.name;
      button.append(name);
      if (f.district) {
        const district = document.createElement('span');
        district.className = 'facility-district';
        district.textContent = f.district;
        button.append(district);
      }
      item.append(button);
      el.list.append(item);
    }
    el.list.hidden = matches.length === 0;
    if (loaded && !usingManual) {
      el.status.textContent = matches.length
        ? `${matches.length} ${matches.length === 1 ? 'facility' : 'facilities'}`
        : (facilities.length ? 'No facility matches your search.' : 'No facilities found in the allocation blueprint.');
    }
  }

  async function load() {
    if (facilitiesLoad) return facilitiesLoad;
    facilitiesLoad = loadOnce();
    try { await facilitiesLoad; } finally { facilitiesLoad = null; }
  }

  async function loadOnce() {
    if (loading) return;
    loading = true;
    el.status.textContent = 'Loading facilities…';
    el.list.hidden = true;
    usingManual = false;
    try {
      ({ facilities } = await loadFacilities(request));
      loaded = true;
      el.manual.hidden = true;
      renderFacilities();
    } catch (error) {
      const { manualFacilities } = await chrome.storage.local.get('manualFacilities');
      const saved = parseManualFacilities(manualFacilities);
      el.manual.hidden = false;
      el.manualText.value = manualFacilities ?? '';
      el.routeInput.value = (await chrome.storage.local.get('facilityRoute')).facilityRoute ?? '';
      if (saved.length) {
        facilities = saved; loaded = true; usingManual = true;
        renderFacilities();
        el.status.textContent = `${saved.length} ${saved.length === 1 ? 'facility' : 'facilities'} from your saved list (the backend has no facility list).`;
      } else {
        loaded = false;
        facilities = [];
        el.list.replaceChildren();
        el.status.textContent = friendlyError(error, 'The backend has no facility list yet. Add your facilities below to continue, or ask for the facility route to be added.');
        el.manual.open = true;
      }
    } finally {
      loading = false;
    }
  }

  el.manualSave.addEventListener('click', async () => {
    const saved = parseManualFacilities(el.manualText.value);
    if (!saved.length) { el.status.textContent = 'Add at least one facility, one per line.'; return; }
    await chrome.storage.local.set({ manualFacilities: el.manualText.value });
    loaded = false;
    await load();
  });
  el.routeSave.addEventListener('click', async () => {
    const route = el.routeInput.value.trim();
    if (!/^\/[\w\-./~%]*$/.test(route)) { el.status.textContent = 'Enter a route that starts with /, for example /api/facilities.'; return; }
    await chrome.storage.local.set({ facilityRoute: route });
    loaded = false;
    await load();
  });
  el.manualClear.addEventListener('click', async () => {
    await chrome.storage.local.remove('manualFacilities');
    el.manualText.value = '';
    loaded = false;
    await load();
  });

  el.list.addEventListener('click', (event) => {
    const row = event.target.closest('.facility-row');
    if (!row) return;
    const picked = facilities.find((f) => f.id === row.dataset.id);
    if (!picked) return;
    if (!picked.id) {
      el.status.textContent = 'This facility has no allocation record ID. Reload the current Allocation Blueprint; the backend must return a real facility ID.';
      return;
    }
    fsRevision++; fsCandidate = null;
    facility = picked;
    el.facilityName.textContent = picked.name;
    el.facilityMeta.textContent = picked.district || '';
    el.facilityMeta.hidden = !picked.district;
    showStage('audit');
    invalidate();
    (mode === 'both' && !el.wa.value ? el.wa : el.ff).focus();
  });

  el.search.addEventListener('input', renderFacilities);
  el.reload.addEventListener('click', () => { loaded = false; void load(); });
  el.change.addEventListener('click', () => {
    revision += 1;
    cancelAutoClear();
    facility = null;
    activeResult = null;
    commit = null;
    setAwaitingFix(false);
    setMessage(EMPTY_RESULT);
    showStage('pick');
    renderFacilities();
    el.search.focus();
  });

  /* ---------- Inputs ---------- */

  el.wa.addEventListener('input', () => { persist(); invalidate(); });
  el.ff.addEventListener('input', () => { persist(); invalidate(); });
  el.clear.addEventListener('click', () => {
    el.wa.value = '';
    el.ff.value = '';
    persist();
    invalidate();
    setAwaitingFix(false);
    setMessage('Logs cleared. Ready for the next order.');
  });

  el.capture.addEventListener('click', async () => {
    setMessage('Capturing page data…', 'busy');
    const page = await captureFromActiveTab();
    if (!page.ok) { setMessage(page.reason, 'warn'); return; }
    let updated = false;
    if (page.fulfillment) { el.ff.value = page.fulfillment; updated = true; }
    if (mode === 'both' && page.whatsapp) { el.wa.value = page.whatsapp; updated = true; }
    if (!updated) { setMessage('No page data found. Highlight the fulfillment data, or paste it manually.'); return; }
    persist();
    invalidate();
    setMessage('Page data captured. Ready to audit.', 'success');
  });

  /* ---------- Audit ---------- */

  async function analyze({ confirm = false } = {}) {
    if (busy) return;
    if (!facility?.id) {
      setMessage('Select a facility tied to a current allocation record. If your facility is listed but rejected, the backend facility list must provide its real record ID.', 'error');
      return;
    }
    const withWhatsapp = mode === 'both';
    const wa = el.wa.value.trim();
    const ff = el.ff.value.trim();
    if ((withWhatsapp && !wa) || !ff) {
      setMessage(withWhatsapp ? 'Add both the WhatsApp request and the fulfillment confirmation first.' : 'Add the fulfillment confirmation first.', 'error');
      return;
    }
    cancelAutoClear();
    const rev = ++revision;
    busy = true;
    el.analyze.disabled = true;
    el.confirm.disabled = true;
    lastKey = inputKey();
    commit = null;
    activeResult = null;
    const startedAt = startTimer();
    try {
      const catalog = await request('/api/products');
      if (rev !== revision) return;
      const body = vaccineAuditBody({ mode, facility, whatsapp: wa, fulfillment: ff, revision: catalog.revision });
      lastCheckId = body.checkId;
      const data = await request(VACCINE_API.verify, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!Array.isArray(data.items) || typeof data.allMatch !== 'boolean') throw new Error('Unexpected audit response from the backend.');
      if (data.allMatch && !data.items.length) throw new Error('The backend returned no audited products. Review the confirmation before dispatch.');
      if (rev !== revision) return;
      durationMs = Date.now() - startedAt;
      activeResult = data;
      setAwaitingFix(!data.allMatch);
      if (data.allMatch) {
        stopTimer();
        commit = { status: 'pending' };
        render();
        const receipt = verifiedDeductionReceipt(data, data);
        if (receipt) {
          commit = { status: 'done', rows: normalizeDeductions(receipt) }; render(); scheduleAutoClear(rev);
        } else if (data.allocationStatus === 'deducted') {
          commit = { status: 'unknown', message: 'Allocation status pending verification.' }; render();
        } else if (data.canCommit === true && data.isValid === true) {
          void deduct(rev);
        } else {
          commit = { status: 'review', message: 'Audit passed. An authorized operator must update the allocation.' }; render();
        }
      } else {
        render();
        if (confirm) addNotice(`Not resolved yet. ${data.issueCount ?? 'Some'} discrepanc${data.issueCount === 1 ? 'y remains' : 'ies remain'}.`);
      }
    } catch (error) {
      if (rev === revision) {
        const reason = error.message || 'Unable to contact the backend.';
        const looksLikeFacilityError = /select a facility from the current allocation blueprint/i.test(reason);
        setMessage(looksLikeFacilityError
          ? `The backend rejected the selected allocation record for ${facility.name} (ID: ${facility.id}). The facility dropdown and audit endpoint may be using different allocation cycles or IDs. Reload facilities and confirm the backend uses the same active blueprint for both endpoints.`
          : reason, 'error');
      }
    } finally {
      stopTimer();
      busy = false;
      el.analyze.disabled = false;
      el.confirm.disabled = false;
      el.analyze.textContent = 'Audit order';
    }
  }

  el.analyze.addEventListener('click', () => { void analyze(); });

  // After the fix: re-capture the log, re-check, and deduct + clear when it is clean.
  el.confirm.addEventListener('click', async () => {
    if (busy) return;
    const page = await captureFromActiveTab();
    if (page.ok && page.fulfillment && page.fulfillment !== el.ff.value) { el.ff.value = page.fulfillment; persist(); }
    if (activeResult && inputKey() === lastKey) {
      render();
      addNotice('The fulfillment log hasn\u2019t changed since the last check. Fix the entry, capture the updated log, then confirm again.');
      return;
    }
    await analyze({ confirm: true });
  });

  el.results.addEventListener('click', (event) => {
    if ((event.target.closest('[data-action="retry-commit"]') || event.target.closest('[data-action="confirm-commit"]'))
        && activeResult?.allMatch && !busy && ['pending', 'failed'].includes(commit?.status)) {
      void deduct(revision);
    }
  });

  /* ---------- Public API ---------- */

  chrome.storage.local.get(['vaccineMode', 'vaccineWhatsapp', 'vaccineFulfillment'], (saved) => {
    applyMode(saved.vaccineMode === 'fulfillment' ? 'fulfillment' : 'both', { save: false });
    el.wa.value = saved.vaccineWhatsapp ?? '';
    el.ff.value = saved.vaccineFulfillment ?? '';
  });
  setMessage(EMPTY_RESULT);
  showStage('pick');

  return {
    async setFsFacility(candidate) {
      const key = JSON.stringify(candidate);
      if (key === fsKey) return;
      fsKey = key;
      const operation = ++fsRevision;
      fsCandidate = candidate;
      facility = null;
      invalidate();
      if (!candidate) { showStage('pick'); return; }
      // Show the FS selection even if authentication, lookup or Blueprint matching fails.
      el.facilityName.textContent = candidate.name || candidate.facilityName || 'Selected FS facility';
      el.facilityMeta.textContent = [candidate.district, candidate.region, 'Checking Blueprint record…'].filter(Boolean).join(' · ');
      el.facilityMeta.hidden = false;
      showStage('audit');
      if (!loaded) await load();
      if (operation !== fsRevision) return;
      const norm = value => String(value || '').toLowerCase().replace(/\bhealth cent(?:er|re)\b/g, 'hc').replace(/[^a-z0-9]+/g, ' ').trim();
      let found = candidate.allocationStatus && candidate.allocationStatus !== 'matched' ? [] : facilities.filter(f =>
        (candidate.id && f.id === candidate.id) ||
        (candidate.sourceSheetId && candidate.sourceRowId && f.sourceSheetId === candidate.sourceSheetId && f.sourceRowId === candidate.sourceRowId) ||
        (norm(f.name) === norm(candidate.name || candidate.facilityName) &&
          (!candidate.district || norm(f.district) === norm(candidate.district)) &&
          (!candidate.cycle || f.cycle === candidate.cycle))
      );
      if (found.length === 1 && found[0].id) {
        facility = found[0];
        el.facilityMeta.textContent = [candidate.district || facility.district, candidate.region, facility.cycle].filter(Boolean).join(' · ');
      } else {
        el.facilityMeta.textContent = [candidate.district, candidate.region, candidate.allocationStatus === 'loading' ? 'Loading Blueprint…' : 'No unique Blueprint record. Refresh allocation or choose a Blueprint facility.'].filter(Boolean).join(' · ');
        setMessage('Selected in FS. A verified Blueprint facility is required before auditing.');
      }
      el.facilityMeta.hidden = !el.facilityMeta.textContent;
    },
    // Called whenever the tab becomes visible while signed in.
    activate() { if (fsCandidate && !loaded) { fsKey = ''; void this.setFsFacility(fsCandidate); } else if (!loaded) void load(); },
    // Called on sign-out or when the backend changes.
    reset() {
      revision += 1;
      cancelAutoClear();
      stopTimer();
      fsRevision++; fsCandidate = null; fsKey = '';
      facilities = []; loaded = false; facility = null; activeResult = null; commit = null;
      setAwaitingFix(false);
      setMessage(EMPTY_RESULT);
      showStage('pick');
      el.list.replaceChildren();
      el.status.textContent = '';
      el.manual.hidden = true;
      usingManual = false;
    },
  };
}
