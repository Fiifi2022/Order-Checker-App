import { verifiedDeductionReceipt } from './vaccine-api.js';
import { createFsScriptSync } from './fs-script.js';
import { allocationCycleKey } from './allocation-cycle.js';
// Vaccine Checker tab.
// Flow: select facility -> audit -> auto-deduct only if backend reports recorded FS authorization; otherwise request confirmation.
import { buildReport, escapeHtml } from './report.js';
import { captureFromActiveTab } from './capture.js';
import { auditedFulfillmentItems } from './vaccine-display.js';
import {
  VACCINE_API, loadFacilities, loadBlueprintQuantities, parseManualFacilities, vaccineAuditBody, commitAllocation, normalizeDeductions,
} from './sidepanel-vaccine-api.js';

const AUTO_CLEAR_SECONDS = 3;
const EMPTY_RESULT = 'Add the logs, then run the audit.';

export function setupVaccine({ request, getBackendUrl = () => '' }) {
  const $ = (id) => document.getElementById(id);
  const el = {
    pick: $('vxPick'), audit: $('vxAudit'), search: $('vxSearch'), list: $('vxFacilities'),
    status: $('vxFacilityStatus'), reload: $('vxReload'), cycle: $('vxCycle'), district: $('vxDistrict'), showAll: $('vxShowAll'),
    modeCards: [...document.querySelectorAll('#vaccineView .mode-card')],
    facilityName: $('vxFacilityName'), facilityMeta: $('vxFacilityMeta'), change: $('vxChange'),
    blueprint: $('vxBlueprint'), blueprintStatus: $('vxBlueprintStatus'), blueprintProducts: $('vxBlueprintProducts'), blueprintRefresh: $('vxBlueprintRefresh'),
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
  let blueprintRevision = 0;
  let selectedCycle = '';
  let selectedDistrict = '';
  let browsingFacilities = false;
  const districtOf = row => row.districtName || row.district || '';

  function renderDistricts() {
    el.district.replaceChildren();
    const all = document.createElement('option'); all.value = ''; all.textContent = 'All districts'; el.district.append(all);
    const districts = [...new Set(facilities.map(districtOf).filter(Boolean))];
    if (selectedDistrict && !districts.includes(selectedDistrict)) districts.push(selectedDistrict);
    districts.sort((a,b) => a.localeCompare(b));
    for (const district of districts) {
      const option = document.createElement('option'); option.value = district; option.textContent = district; el.district.append(option);
    }
    const chosen = [...el.district.options].find(option => option.value === selectedDistrict);
    if (chosen) chosen.selected = true;
  }

  function renderCycles() {
    el.cycle.replaceChildren();
    const all = document.createElement('option'); all.value = ''; all.textContent = 'Automatic · all months'; el.cycle.append(all);
    const cycles = [...new Set(facilities.filter(row => !selectedDistrict || districtOf(row) === selectedDistrict).map(row => row.cycle).filter(Boolean))];
    // Retain a saved choice that was removed from the backend, so it cannot
    // silently fall back to a different cycle and display the wrong balance.
    if (selectedCycle && !cycles.includes(selectedCycle)) cycles.push(selectedCycle);
    cycles.sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const cycle of cycles) {
      const option = document.createElement('option'); option.value = cycle; option.textContent = cycle; el.cycle.append(option);
    }
    const chosen = [...el.cycle.options].find(option => option.value === selectedCycle);
    if (chosen) chosen.selected = true;
  }

  function clearBlueprint() {
    blueprintRevision++;
    el.blueprint.hidden = true;
    el.blueprintProducts.replaceChildren();
    el.blueprintStatus.textContent = '';
  }

  async function refreshBlueprint() {
    const selected = facility, operation = ++blueprintRevision;
    if (!selected) { clearBlueprint(); return; }
    el.blueprint.hidden = false;
    el.blueprintProducts.replaceChildren();
    el.blueprintStatus.textContent = 'Reading saved Blueprint quantities…';
    el.blueprintRefresh.disabled = true;
    try {
      const result = await loadBlueprintQuantities(request, selected);
      if (operation !== blueprintRevision || facility !== selected) return;
      const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : 'Not entered';
      el.blueprintStatus.textContent = result.products.length
        ? `${result.cycle || 'Selected cycle'} · Updated ${new Date(result.checkedAt).toLocaleTimeString()} · Quantities from Blueprint`
        : 'No vaccine quantities have been entered for this facility in this allocation cycle.';
      el.blueprintProducts.innerHTML = result.products.length ? '<div class="blueprint-quantities"><table><thead><tr><th>Vaccine</th><th>Allocated</th><th>Taken</th><th>Available</th></tr></thead><tbody>'
        + result.products.map(product => `<tr><th scope="row">${escapeHtml(product.name)}</th><td>${number(product.allocated)}</td><td>${number(product.taken)}</td><td>${number(product.available)}</td></tr>`).join('')
        + '</tbody></table></div>' : '';
    } catch (error) {
      if (operation !== blueprintRevision || facility !== selected) return;
      el.blueprintStatus.textContent = error.status === 404 ? 'This backend needs the Blueprint quantities update. Update the backend, then refresh.' : (error.message || 'Blueprint quantities unavailable. Refresh to retry.');
    } finally {
      if (operation === blueprintRevision) el.blueprintRefresh.disabled = false;
    }
  }
  el.blueprintRefresh.addEventListener('click', () => { void refreshBlueprint(); });

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
      void refreshBlueprint();
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
    clearBlueprint();
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
    const searchable = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\bhealth center\b/g,'health centre').replace(/\bhc\b/g,'health centre').replace(/[^a-z0-9]+/g,' ').trim();
    const words = searchable(el.search.value).split(' ').filter(Boolean);
    const matches = facilities.filter(f => (!selectedCycle || f.cycle === selectedCycle) && (!selectedDistrict || districtOf(f) === selectedDistrict) && words.every(word => searchable([f.name,f.district,f.region,f.cycle].join(' ')).includes(word)));
    el.list.replaceChildren();
    for (const f of matches) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'facility-row';
      button.dataset.id = f.id;
      button.dataset.index = String(facilities.indexOf(f));
      // A saved source row can be browsed even before allocation quantities are
      // entered. Audit authorization still requires a real allocation ID.
      button.disabled = !f.id && !f.sourceSheetId;
      const name = document.createElement('span');
      name.className = 'facility-name';
      name.textContent = f.name;
      button.append(name);
      if (f.district || f.cycle || f.region) {
        const district = document.createElement('span');
        district.className = 'facility-district';
        district.textContent = [f.district,f.region,f.cycle].filter(Boolean).join(' · ');
        button.append(district);
      }
      if (!f.id || f.allocationAvailable === false) {
        const notice = document.createElement('span');
        notice.className = 'facility-district';
        notice.textContent = f.allocationNotice || 'No vaccine allocation record is set for this facility.';
        button.append(notice);
      }
      item.append(button);
      el.list.append(item);
    }
    el.list.hidden = matches.length === 0;
    if (loaded && !usingManual) {
      el.status.textContent = matches.length
        ? `Connected to Allocation Blueprint · Showing ${matches.length} of ${facilities.length} saved facility records${selectedDistrict ? ` · ${selectedDistrict}` : ''}${selectedCycle ? ` · ${selectedCycle}` : ''}`
        : (facilities.length ? `No facilities match these filters${selectedDistrict ? ` in ${selectedDistrict}` : ''}${selectedCycle ? ` for ${selectedCycle}` : ''}. Use “Show all facilities” to search all ${facilities.length} saved records.` : 'No facilities found in the allocation blueprint.');
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
      const cycleKey = allocationCycleKey(getBackendUrl());
      const [result, saved] = await Promise.all([loadFacilities(request), chrome.storage.local.get(cycleKey)]);
      facilities = result.facilities;
      selectedCycle = typeof saved[cycleKey] === 'string' ? saved[cycleKey] : '';
      renderCycles();
      renderDistricts();
      loaded = true;
      el.manual.hidden = true;
      renderFacilities();
    } catch (error) {
      const { manualFacilities } = await chrome.storage.local.get('manualFacilities');
      const saved = parseManualFacilities(manualFacilities);
      el.manual.hidden = error.status !== 404;
      el.manualText.value = manualFacilities ?? '';
      el.routeInput.value = (await chrome.storage.local.get('facilityRoute')).facilityRoute ?? '';
      if (saved.length && error.status === 404) {
        facilities = saved; loaded = true; usingManual = true;
        renderFacilities();
        el.status.textContent = `${saved.length} ${saved.length === 1 ? 'facility' : 'facilities'} from your saved list (the backend has no facility list).`;
      } else {
        loaded = false;
        facilities = [];
        el.list.replaceChildren();
        el.status.textContent = friendlyError(error, 'The backend has no facility list yet. Add your facilities below to continue, or ask for the facility route to be added.');
        el.manual.open = error.status === 404;
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
    if (!row || row.disabled) return;
    const picked = facilities[Number(row.dataset.index)];
    if (!picked) return;
    if (!picked.id && !picked.sourceSheetId) {
      el.status.textContent = 'This facility has no allocation record ID. Reload the current Allocation Blueprint; the backend must return a real facility ID.';
      return;
    }
    fsRevision++; browsingFacilities = true;
    facility = picked;
    el.facilityName.textContent = picked.name;
    el.facilityMeta.textContent = [picked.district, picked.cycle].filter(Boolean).join(' · ');
    el.facilityMeta.hidden = !el.facilityMeta.textContent;
    showStage('audit');
    invalidate();
    if (!picked.id) setMessage(picked.allocationNotice || 'No allocation is set. Blueprint quantities can be viewed; auditing requires a saved allocation record.');
    void refreshBlueprint();
    (mode === 'both' && !el.wa.value ? el.wa : el.ff).focus();
  });

  el.search.addEventListener('input', renderFacilities);
  el.district.addEventListener('change', async () => {
    if (busy || commit?.status === 'busy') { renderDistricts(); return; }
    selectedDistrict = el.district.value || '';
    const availableCycles = facilities.filter(row => !selectedDistrict || districtOf(row) === selectedDistrict).map(row => row.cycle);
    const cycleChanged = selectedCycle && !availableCycles.includes(selectedCycle);
    if (cycleChanged) selectedCycle = '';
    renderCycles();
    browsingFacilities = true;
    // District is a browsing filter; it never changes the selected FS facility.
    fsRevision++; fsKey = ''; facility = null;
    clearBlueprint(); invalidate(); showStage('pick');
    renderFacilities();
    if (cycleChanged) await persistSelectedCycle();
  });
  el.showAll.addEventListener('click', () => {
    if (busy || commit?.status === 'busy') return;
    selectedDistrict = ''; selectedCycle = ''; el.search.value = '';
    renderDistricts(); renderCycles();
    el.cycle.dispatchEvent(new Event('change', { bubbles: true }));
  });
  el.cycle.addEventListener('change', async () => {
    if (busy || commit?.status === 'busy') { renderCycles(); return; }
    selectedCycle = el.cycle.value || '';
    browsingFacilities = true;
    fsRevision++; fsKey = ''; facility = null;
    clearBlueprint(); invalidate(); showStage('pick'); renderFacilities();
    await persistSelectedCycle();
  });

  async function persistSelectedCycle() {
    await chrome.storage.local.set({ [allocationCycleKey(getBackendUrl())]: selectedCycle });
    // Refresh the live FS badge through the existing read-only connection.
    try { await chrome.runtime?.sendMessage?.({ type: 'FS_REFRESH_ALL' }); }
    catch (error) { el.status.textContent = `Cycle saved. Refresh FS to update allocation advice. ${error.message}`; }
  }
  el.reload.addEventListener('click', () => { loaded = false; void load(); });
  el.change.addEventListener('click', () => {
    browsingFacilities = true;
    revision += 1;
    cancelAutoClear();
    facility = null;
    clearBlueprint();
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

  const fulfillmentSync = createFsScriptSync({
    field: el.ff,
    onChanged: () => el.ff.dispatchEvent(new Event('input', { bubbles: true })),
    persist: text => { void chrome.storage.local.set({ vaccineFulfillment: text }); },
  });

  /* ---------- Public API ---------- */

  chrome.storage.local.get(['vaccineMode', 'vaccineWhatsapp', 'vaccineFulfillment'], (saved) => {
    applyMode(saved.vaccineMode === 'fulfillment' ? 'fulfillment' : 'both', { save: false });
    el.wa.value = saved.vaccineWhatsapp ?? '';
    if (!fulfillmentSync.observed) el.ff.value = saved.vaccineFulfillment ?? '';
  });
  setMessage(EMPTY_RESULT);
  showStage('pick');

  return {
    setFsScript(script) { fulfillmentSync.apply(script); },
    async setFsFacility(candidate) {
      const fsName = value => String(value?.name || value?.facilityName || '').trim().toLowerCase();
      // Background balance refreshes must not close the facility browser while
      // the user is choosing a district/cycle. An actual FS facility change
      // resumes automatic matching.
      if (browsingFacilities && (!fsCandidate || fsName(candidate) === fsName(fsCandidate))) {
        fsCandidate = candidate; return;
      }
      browsingFacilities = false;
      const key = JSON.stringify(candidate);
      if (key === fsKey) return;
      fsKey = key;
      const operation = ++fsRevision;
      fsCandidate = candidate;
      facility = null;
      clearBlueprint();
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
      // Once the backend supplies a source row, a same-name row in another
      // cycle must not turn an exact match into an ambiguous selection.
      let found = candidate.allocationStatus && candidate.allocationStatus !== 'matched' ? [] : facilities.filter(f => (!selectedCycle || f.cycle === selectedCycle) && (
        candidate.sourceSheetId ? f.sourceSheetId === candidate.sourceSheetId &&
          (candidate.sourceRowId ? f.sourceRowId === candidate.sourceRowId : norm(f.name) === norm(candidate.name || candidate.facilityName)) :
        candidate.id && facilities.some(entry => entry.id === candidate.id) ? f.id === candidate.id :
        (norm(f.name) === norm(candidate.name || candidate.facilityName) &&
          (!candidate.district || norm(f.district) === norm(candidate.district)) &&
          (!candidate.cycle || f.cycle === candidate.cycle)))
      );
      if (found.length === 1 && found[0].id) {
        facility = found[0];
        el.facilityMeta.textContent = [candidate.district || facility.district, candidate.region, facility.cycle].filter(Boolean).join(' · ');
      } else {
        el.facilityMeta.textContent = [candidate.district, candidate.region, candidate.allocationStatus === 'loading' ? 'Loading Blueprint…' : 'No unique Blueprint record. Refresh allocation or choose a Blueprint facility.'].filter(Boolean).join(' · ');
        setMessage('Selected in FS. A verified Blueprint facility is required before auditing.');
      }
      el.facilityMeta.hidden = !el.facilityMeta.textContent;
      if (facility) await refreshBlueprint();
    },
    // Called whenever the tab becomes visible while signed in.
    activate() { if (fsCandidate && !loaded) { fsKey = ''; void this.setFsFacility(fsCandidate); } else if (!facility) void load(); },
    // Called on sign-out or when the backend changes.
    reset() {
      revision += 1;
      cancelAutoClear();
      stopTimer();
      fsRevision++; fsCandidate = null; fsKey = '';
      facilities = []; loaded = false; facility = null; activeResult = null; commit = null;
      selectedCycle = ''; selectedDistrict = ''; browsingFacilities = false; renderCycles(); renderDistricts();
      clearBlueprint();
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
