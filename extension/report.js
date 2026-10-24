import { buildGeneralReport } from './general-report.js';
// Builds the audit report markup shared by the General and Vaccine tabs.
import { buildIssues, explainItem } from './explain.js';

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
));

export const formatDuration = (ms) => (ms < 1000 ? 'under 1s' : `${Math.round(ms / 1000)}s`);

const metaValue = (field) => {
  const value = field?.whatsappValue;
  return value && String(value).trim() && value !== 'N/A' ? escapeHtml(value) : '';
};

const explainHtml = (note) => '<div class="explain">'
  + `<h4>${escapeHtml(note.wrongLabel || 'What went wrong')}</h4><p>${escapeHtml(note.wrong)}</p>`
  + `<h4>How to fix it</h4><p>${escapeHtml(note.fix)}</p></div>`;

const typeLabel = (status) => { const t = String(status ?? '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : 'Unknown'; };
const isClean = (status) => ['match', 'order limit applied'].includes(status);
const rank = (status) => (isClean(status) ? 2 : (status === 'out of stock' ? 1 : 0));

/**
 * @returns {{ html: string, autoClear: boolean }} autoClear is true when the report is clean
 * and the caller should start its "clearing in N seconds" countdown.
 */
export function buildReport(r, {
  durationMs = 0,
  declinedLimitItems = [],
  holdClear = false,
  autoClearSeconds = 3,
  orderLimitPrompts = true,
} = {}) {
  if (r.generalAudit) return { html: buildGeneralReport(r), autoClear: false };
  let html = '';

  const limitPending = orderLimitPrompts && r.items.some((it) => it.fulfillment?.orderLimitEligible
    && it.fulfillment.orderLimitDecision === undefined && !declinedLimitItems.includes(it.name));
  const autoClear = r.allMatch && !limitPending && !holdClear;

  html += `<div class="${r.allMatch ? 'verdict-ok' : 'verdict-bad'}">`;
  html += '<div class="verdict-head">';
  html += `<span class="verdict-badge">${r.allMatch ? 'Cleared for launch' : `Discrepancy alert (${escapeHtml(r.issueCount)})`}</span>`;
  html += `<span class="took">Checked in ${formatDuration(durationMs)}</span></div>`;
  html += `<p class="verdict-text">${escapeHtml(r.generalAudit?.message || r.verdict)}</p></div>`;

  // Discrepancy types come first. Tapping one explains what went wrong and how to fix it.
  const issues = r.allMatch ? [] : buildIssues(r);
  if (issues.length) {
    html += '<div class="issues"><h3>Discrepancy types</h3><p class="issues-hint">Tap a discrepancy to see what went wrong.</p>';
    issues.forEach((issue) => {
      html += '<details class="issue"><summary><div class="issue-main">'
        + `<span class="issue-type">${escapeHtml(issue.type)}</span>`
        + (issue.subject ? `<span class="issue-sub">${escapeHtml(issue.subject)}</span>` : '')
        + `</div></summary>${explainHtml(issue)}</details>`;
    });
    html += '</div>';
  } else if (!r.allMatch && r.insights?.length) {
    html += '<div class="issues"><h3>Discrepancy types</h3><ul>'
      + r.insights.map((ins) => `<li>${escapeHtml(ins)}</li>`).join('') + '</ul></div>';
  }

  if (autoClear) {
    html += `<p class="clear-note">No discrepancies. Clearing in <b id="clearCount">${autoClearSeconds}</b>s for the next order.</p>`;
    html += '<div class="clear-bar" aria-hidden="true"><span></span></div>';
  }

  const ordered = r.items.map((it, idx) => ({ it, idx })).sort((a, b) => rank(a.it.status) - rank(b.it.status) || a.idx - b.idx);

  html += '<ul class="items">';
  ordered.forEach(({ it, idx }) => {
    const tone = isClean(it.status) ? 'ok' : (it.status === 'out of stock' ? 'warn' : 'bad');
    const symbol = tone === 'ok' ? '✓' : (tone === 'warn' ? '⚠' : '✗');
    html += `<li class="item item-${tone}">`;
    const head = `<span class="type-tag">${symbol} ${escapeHtml(typeLabel(it.status))}</span>`
      + `<div class="item-name">${escapeHtml(it.name)}</div>`
      + `<div class="item-qty">Requested ${escapeHtml(it.requested)}, system ${escapeHtml(it.found)}</div>`;
    const note = tone === 'ok' ? null : explainItem(it);
    if (note) {
      html += `<details class="item-details"><summary><div>${head}</div></summary>${explainHtml(note)}</details>`;
    } else {
      html += head;
      if (it.action) html += `<div class="item-action">${escapeHtml(it.action)}</div>`;
    }

    if (orderLimitPrompts && it.fulfillment?.orderLimitEligible && it.fulfillment.orderLimitDecision === undefined && !declinedLimitItems.includes(it.name)) {
      html += '<div class="limit-prompt">';
      html += '<strong>Order limit check needed</strong>';
      html += `<p>Is this item subject to an order limit of ${escapeHtml(it.found)} units?</p>`;
      html += '<div class="limit-buttons">';
      html += `<button type="button" class="btn-small" data-limit="no" data-index="${idx}">No, it's a discrepancy</button>`;
      html += `<button type="button" class="btn-small btn-yes" data-limit="yes" data-index="${idx}">Yes, apply limit</button>`;
      html += '</div></div>';
    }
    html += '</li>';
  });
  html += '</ul>';

  if (r.allMatch && r.insights?.length) {
    html += '<div class="result-section"><h3>Key insights</h3><ul>'
      + r.insights.map((ins) => `<li>${escapeHtml(ins)}</li>`).join('') + '</ul></div>';
  }

  if (r.meta) {
    const rows = [
      ['Date', metaValue(r.meta.date) || 'N/A'],
      ['Orderer', metaValue(r.meta.ordererName) || 'N/A'],
      ['Health facility', metaValue(r.meta.facilityName) || 'N/A'],
    ];
    const dropArea = metaValue(r.meta.dropArea);
    const district = metaValue(r.meta.district);
    const deliveryTime = metaValue(r.meta.deliveryTime);
    if (dropArea) rows.push(['Drop area', dropArea]);
    if (district) rows.push(['District', district]);
    if (deliveryTime) rows.push(['Delivery time', deliveryTime]);
    html += '<div class="result-section"><h3>Order details</h3><dl class="meta-list">';
    rows.forEach(([label, value]) => { html += `<dt>${label}</dt><dd>${value}</dd>`; });
    html += '</dl></div>';
  }

  return { html, autoClear };
}
