import { generalProductResults, generalAuditResult, generalInventoryRows, sameGeneralAuditSources } from './general-auditor.js';

export const escapeGeneralHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const e = escapeGeneralHtml;
const field = (label, result) => `<div class="general-field"><strong>${label}</strong><span class="general-status ${result?.status === 'match' ? 'matched' : result?.status === 'mismatch' ? 'discrepancy' : 'pending'}">${e(result?.status || 'Not provided')}</span><p>Customer: ${e(result?.whatsappValue || 'Not available')}</p><p>Fulfilment: ${e(result?.fulfillmentValue || 'Not available')}</p></div>`;

export function buildGeneralReport(record, { drafts = new Map(), busy = false } = {}) {
  const details = record.generalAudit;
  const rows = generalProductResults(record.items, details);
  const summary = generalAuditResult(record.items, details, record.allMatch);
  let html = `<div class="${summary.tone === 'matched' ? 'verdict-ok' : summary.tone === 'pending' ? 'verdict-pending' : 'verdict-bad'}"><div class="verdict-head"><span class="verdict-badge">${e(summary.title)}</span></div><p class="verdict-text">${e(summary.message)}</p></div>`;
  html += '<section class="general-inventory" aria-label="Inventory Cross Examination"><h3>Inventory Cross Examination</h3>';
  rows.forEach(result => {
    const { key, product, requested, fulfilled, quantity } = result;
    html += `<article class="general-product" data-product-key="${e(key)}" tabindex="-1"><h4>${e(result.name)}</h4><p>Customer: ${e(result.customer)}</p><p>Fulfilment: ${e(result.fulfillment)}</p>`;
    if (requested.length > 1) html += `<details><summary>Original requested entries (${requested.length})</summary>${requested.map(source => `<p>${e(source.originalText)}</p>`).join('')}</details>`;
    html += `<div class="general-quantities"><span>Requested: ${e(result.requestedQuantity)} ${e(quantity?.requestedUnit || requested[0]?.unit || '')}</span><span>Fulfilled: ${e(result.suppliedQuantity)} ${e(quantity?.suppliedUnit || fulfilled[0]?.unit || '')}</span></div>`;
    html += `<p role="status">Status: <span class="general-status ${result.tone}">${e(result.status)}${result.status === 'MATCH' ? ' — Product and quantity verified' : ''}</span></p>`;
    if (result.reason) html += `<p><strong>Reason:</strong> ${e(result.reason)}</p>`;
    if (quantity?.orderLimitEligible && quantity.orderLimitDecision === undefined) {
      html += `<div class="limit-prompt"><strong>Was an Order Limit applied to this product?</strong><div class="limit-buttons"><button type="button" class="btn-small" data-general-limit="no" data-key="${e(quantity.key)}"${busy ? ' disabled' : ''}>No, discrepancy</button><button type="button" class="btn-small btn-yes" data-general-limit="yes" data-key="${e(quantity.key)}"${busy ? ' disabled' : ''}>Yes, apply limit</button></div></div>`;
    }
    if (result.tone === 'matched' && result.customer.toLowerCase() !== result.fulfillment.toLowerCase() && record.id) {
      const identity = product?.confirmation?.productKey || quantity?.key;
      const previous = drafts.get('alias:' + key);
      const learned = previous?.identity === identity ? previous : {};
      if (previous && previous.identity !== identity) drafts.delete('alias:' + key);
      html += `<div><button type="button" class="action-link" data-learn-alias="${e(key)}"${busy || learned.saved ? ' disabled' : ''}>${learned.saved ? 'Verified wording saved' : 'Approve and save this wording for future audits'}</button>${learned.message ? `<p role="${learned.saved ? 'status' : 'alert'}">${e(learned.message)}</p>` : ''}</div>`;
    }
    html += '</article>';
  });
  html += '</section><details class="result-section general-identity"><summary>Identity and order checks</summary>' + field('Health Facility', details.facility) + field('Orderer', details.orderer);
  for (const [label, value] of [['Delivery / Drop area (optional)', details.dropArea], ['District (optional)', details.district]]) if (value) html += field(label, value);
  const reviews = (details.semanticReviews || []).filter(review => !review.dosageFormKey && !rows.some(row => [...row.requested, ...row.fulfilled].some(source => source.source === review.source && source.originalText.trim() === review.originalText.trim())));
  for (const review of reviews) html += `<div class="general-field"><strong>${review.field === 'quantity' ? 'Quantity review' : 'Order information requiring review'}</strong><blockquote>${e(review.originalText)}</blockquote><p>${e(review.reason)}</p></div>`;

  return html + '</details>';
}

/** One controller per extension surface; server saves remain authoritative. */
export function setupGeneralProductReview({ root, request, getResult, getSources, contextKey, onSaved, rerender, onBusy = () => {} }) {
  const drafts = new Map(); let busy = false;
  root.addEventListener('click', event => {
    const learn = event.target.closest('[data-learn-alias]');
    if (learn) void learnAlias(learn.dataset.learnAlias);
  });
  const learnAlias = async key => {
    const record = getResult(); if (busy || !record?.id || !sameGeneralAuditSources(record, getSources())) return;
    const row = generalInventoryRows(record.items, record.generalAudit).find(row => row.key === key);
    const identity = row?.product?.confirmation?.productKey || row?.items.find(item => item.provenance.some(source => source.source === 'customer_request'))?.fulfillment.key;
    const context = contextKey(); const draft = { identity, saved: false, message: '' }; drafts.set('alias:' + key, draft); busy = true; onBusy(true); rerender();
    try {
      const state = await request('/api/general/product-aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', approvePermanently: true, auditId: record.id, key }) });
      if (!Array.isArray(state?.aliases) || !state.aliases.some(alias => alias.status === 'approved')) throw Error('The server did not return a saved dictionary. Please retry.');
      if (context !== contextKey() || getResult() !== record) return;
      draft.saved = true; draft.message = 'Verified wording saved for future audits. Clinical details will still be checked.';
    } catch (error) { if (context === contextKey()) draft.message = error.message || 'Could not save the name. Please retry.'; }
    finally { busy = false; onBusy(false); if (context === contextKey()) rerender(); }
  };
  return { render: record => buildGeneralReport(record, { drafts, busy }), reset: () => drafts.clear(), isBusy: () => busy, drafts };
}
