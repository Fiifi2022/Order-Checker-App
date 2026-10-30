import { generalInventoryRows, sameGeneralAuditSources, generalInputFingerprint, retryAuditStorage } from './general-auditor.js';
import { buildIssues } from './explain.js';

export const escapeGeneralHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const e = escapeGeneralHtml;
const sourceIdentity = product => JSON.stringify([product.productName, ...[product.requestedProducts, product.fulfillmentProducts].map(sources => sources.map(source => [source.originalText, source.quantity, source.unit]))]);
const field = (label, result) => `<div class="general-field"><strong>${label}</strong><span class="general-status ${result?.status === 'informational' ? 'neutral' : result?.status === 'match' ? 'matched' : result?.status === 'mismatch' ? 'discrepancy' : 'pending'}">${e(result?.status === 'informational' ? 'Optional — information only' : result?.status || 'Not provided')}</span><p>Customer: ${e(result?.whatsappValue || 'Not available')}</p><p>Fulfilment: ${e(result?.fulfillmentValue || 'Not available')}</p></div>`;

export function buildGeneralReport(record, { drafts = new Map(), busy = false, storageError = '' } = {}) {
  const details = record.generalAudit;
  const rows = generalInventoryRows(record.items, details);
  const pending = rows.filter(row => row.product?.status === 'customer confirmation required');
  const types = record.allMatch ? [] : [...new Set(buildIssues(record).map(issue => issue.type))];
  const review = details.decision === 'review';
  let html = `<section class="audit-highlight ${record.allMatch ? 'verdict-ok' : review ? 'verdict-pending' : record.issueCount ? 'verdict-bad' : 'verdict-pending'}" aria-label="Audit summary"><span class="verdict-badge">${record.allMatch ? details.productComparisonMode === 'names_only' ? 'Product names verified' : details.productComparisonMode === 'names_and_quantities' ? e(details.finalStatus) : 'Order verified' : review ? 'REVIEW REQUIRED' : record.issueCount ? `Discrepancies: ${e(record.issueCount)}` : e(details.finalStatus || 'Verification required')}</span>${types.length ? `<ul class="highlight-types" aria-label="Discrepancy types">${types.map(type => `<li>${e(type)}</li>`).join('')}</ul>` : ''}</section>`;
  if(record.storage) html += `<section class="audit-section" aria-label="Audit storage"><p class="general-status ${record.storage.status==='saved'?'matched':'pending'}">${e(record.storage.message)}</p>${record.storage.status!=='saved'?`<button type="button" data-storage-retry${busy?' disabled':''}>${busy?'Checking save…':'Retry saving audit'}</button>`:''}${storageError?`<p role="alert">${e(storageError)}</p>`:''}</section>`;
  if (details.discrepancies.length) html += `<section class="audit-section audit-findings" aria-label="Discrepancies"><h3>Discrepancies (${details.discrepancies.length})</h3><ul>${details.discrepancies.map(issue => `<li>${e(issue)}</li>`).join('')}</ul></section>`;
  html += '<section class="audit-section general-inventory" aria-label="Inventory Cross Examination"><h3>Product results</h3><p class="audit-section-hint">Inventory Cross Examination</p>';
  if (pending.length) html += `<nav class="general-pending" aria-label="Products requiring confirmation"><p>${pending.length} ${pending.length === 1 ? 'product requires' : 'products require'} customer verification.</p>${pending.map(row => `<button type="button" class="action-link" data-open-product="${e(row.key)}">${e(row.product.productName)}</button>`).join('')}</nav>`;
  rows.forEach(({ key, product, items }) => {
    const requested = product?.requestedProducts || items.flatMap(item => item.provenance.filter(source => source.source === 'customer_request'));
    const fulfilled = product?.fulfillmentProducts || items.flatMap(item => item.provenance.filter(source => source.source === 'fulfillment_confirmation'));
    const paired = items.find(item => item.provenance.some(source => source.source === 'customer_request'));
    const quantity = paired?.fulfillment || items[0]?.fulfillment;
    const pendingConfirmation = product?.status === 'customer confirmation required';
    const discrepancy = product?.confirmation ? product.reviewState === 'product discrepancy' : !pendingConfirmation && items.some(item => ['missing item', 'extra item', 'vaccine pairing mismatch', 'product identity discrepancy'].includes(item.status));
    const productStatus = pendingConfirmation ? 'Customer Confirmation Required' : items.some(item=>item.status==='product identity discrepancy') ? 'Product Identity Discrepancy' : discrepancy ? 'Product Discrepancy' : product?.confirmation ? 'Customer Verified — Product Match' : 'Product Match';
    const requestedQuantity = product?.requestedQuantity ?? quantity?.requested ?? 0;
    const suppliedQuantity = product?.suppliedQuantity ?? items[0]?.fulfillment.supplied ?? 0;
    const comparable = fulfilled.length > 0 && new Set([...requested, ...fulfilled].map(source => source.unit)).size <= 1;
    const shortfall = pendingConfirmation && comparable && suppliedQuantity > 0 && suppliedQuantity < requestedQuantity;
    const quantityStatus = quantity?.quantityReviewRequired ? 'OUT OF STOCK — QUANTITY REVIEW REQUIRED' : shortfall || quantity?.orderLimitEligible && quantity.orderLimitDecision === undefined ? 'Order Limit Verification Required' : pendingConfirmation ? 'Awaiting product verification' : quantity?.fulfillmentStatus === 'order limit applied' ? 'Order Limit Applied' : quantity?.fulfillmentStatus === 'out of stock' ? quantity.stockStatus === 'partially out of stock' ? 'PARTIALLY OUT OF STOCK' : 'OUT OF STOCK' : quantity?.fulfillmentStatus === 'discrepancy' ? 'Quantity Discrepancy' : 'Quantity Match';
    html += `<article class="general-product" data-product-key="${e(key)}" tabindex="-1"><h4>${e(product?.productName || items[0]?.name)}</h4><p>Customer Request: ${e(product?.productName || [...new Set(requested.map(source => source.name))].join('; ') || 'Not requested')}</p><p>Fulfilment: ${e([...new Set(fulfilled.map(source => source.name))].join('; ') || 'Not fulfilled')}</p>`;
    if (quantity?.fulfillmentStatus === 'order limit applied' || details.productComparisonMode === 'names_and_quantities') {
      html += `<div class="general-quantities"><span>Requested: ${e(quantity.requestedQuantityMissing ? 'Not provided' : requestedQuantity)} ${e(quantity.requestedUnit || requested[0]?.unit || '')}</span><span>Fulfilled: ${e(quantity.suppliedQuantityMissing ? 'Not provided' : suppliedQuantity)} ${e(quantity.suppliedUnit || fulfilled[0]?.unit || '')}</span>${!quantity.quantityError && (quantity.conversion || comparable) ? `<span>Remaining to fulfil: ${e(Math.max(0, (quantity.conversion?.requested ?? requestedQuantity) - (quantity.conversion?.supplied ?? suppliedQuantity)))} ${e(quantity.conversion?.unit || quantity.requestedUnit || requested[0]?.unit || '')}</span>` : ''}</div>`;
    }
    if (quantity?.outOfStockQuantity !== undefined) html += `<p class="general-status pending">Out of stock: ${e(quantity.outOfStockQuantity)} ${e(quantity.conversion?.unit || quantity.requestedUnit)}</p>`;
    if(quantity?.confirmationRequested !== undefined) html += `<p>Fulfilment confirmation quantity: [${e(suppliedQuantity)}/${e(quantity.confirmationRequested)}]</p>`;
    html += `<p>Product: <span class="general-status ${pendingConfirmation ? 'pending' : discrepancy ? 'discrepancy' : 'matched'}">${e(productStatus)}</span></p>${details.productComparisonMode === 'names_only' ? '' : `<p>Quantity: <span class="general-status ${/Required|Awaiting|OUT OF STOCK/.test(quantityStatus) ? 'pending' : /Discrepancy/.test(quantityStatus) ? 'discrepancy' : 'neutral'}">${e(quantity?.quantityError || quantityStatus)}</span></p>`}`;
    if (quantity?.conversion) html += `<p>Packaging conversion: ${e(quantity.conversion.description)}</p>`;
    if (product) {
      let draft = drafts.get(key);
      const identity = sourceIdentity(product);
      if (!draft || draft.identity !== identity) { draft = { identity, selected: '', contacted: false, open: false, error: '' }; drafts.set(key, draft); }
      html += `<details data-review-key="${e(key)}"${draft.open ? ' open' : ''}><summary>${product.confirmation ? 'View verification details / Correct confirmation' : 'Confirm Dosage / Formulation'}</summary><div class="general-controls"><p>Requested: ${e(product.productName)}</p><p>Suggested: ${e(product.suggestedProduct || 'Select a catalogue product')}</p><p>Confirm the exact formulation with the customer.</p>`;
      if (product.confirmation) html += `<p>Confirmed: ${e(product.confirmation.productName)}</p><p>Confirmed by: ${e(product.confirmation.confirmedBy?.name || 'CCA')} — <time>${e(product.confirmation.confirmedAt)}</time></p>${(product.confirmationHistory || []).map(entry => `<p>Previous: ${e(entry.productName)} — ${e(entry.confirmedBy?.name || 'CCA')} — ${e(entry.confirmedAt)}</p>`).join('')}`;
      html += `<label>Select the product confirmed by the customer<select data-product-option aria-label="Confirmed formulation for ${e(product.productName)}"${busy ? ' disabled' : ''}><option value="">Select a product</option>${product.options.map(option => `<option value="${e(option.key)}"${draft.selected === option.key ? ' selected' : ''}>${e(option.name)}${option.fromFulfillment ? ' — recorded in fulfilment' : ''}</option>`).join('')}</select></label><label class="general-contact"><input data-customer-contact type="checkbox"${draft.contacted ? ' checked' : ''}${busy ? ' disabled' : ''}> I have contacted the customer and confirmed the exact dosage / formulation.</label><button type="button" class="btn-small btn-yes" data-confirm-product${busy || !draft.selected || !draft.contacted ? ' disabled' : ''}>${draft.saving ? 'Saving confirmation…' : 'Confirm Product'}</button>${draft.error ? `<p class="general-error" role="alert">${e(draft.error)}</p>` : ''}</div></details>`;
    }
    if (quantity?.orderLimitEligible) {
      html += `<div class="limit-prompt"><strong>Was this quantity reduced because of an order limit?</strong><div class="limit-buttons"><button type="button" class="btn-small btn-yes" data-general-limit="yes" data-key="${e(quantity.key)}" aria-pressed="${quantity.orderLimitDecision === true}"${busy ? ' disabled' : ''}>Yes — reduced by order limit</button><button type="button" class="btn-small" data-general-limit="no" data-key="${e(quantity.key)}" aria-pressed="${quantity.orderLimitDecision === false}"${busy ? ' disabled' : ''}>No — report discrepancy</button></div>${quantity.orderLimitDecision === true ? '<p role="status">Approved — Order Limit Applied</p>' : quantity.orderLimitDecision === false ? '<p role="status">Quantity Discrepancy — order limit not applied</p>' : ''}</div>`;
    }
    html += '</article>';
  });
  html += '</section><section class="audit-section general-identity" aria-label="Identity and order checks"><h3>Identity and order checks</h3>' + field('Health Facility', details.facility) + field('Orderer', details.orderer);
  if(details.extraction) html += '<details><summary>What we understood</summary><p>To correct these details, edit the original message and run the audit again.</p>' + ['customer','fulfillment'].map(source=>{
    const message=details.extraction[source];
    return `<div><h4>${source==='customer'?'Customer request':'Fulfilment confirmation'}</h4><p>Orderer: ${e(message.ordererName || 'Needs clarification')}</p><p>Facility: ${e(message.facilityName || 'Needs clarification')}</p><ul>${message.products.map(product=>`<li>${e(product.name)} — ${e(product.quantity ?? 'Quantity needed')} ${e(product.unit || '')}</li>`).join('')}</ul>${message.unresolvedFields.length?'<p class="general-status pending">Some details need clarification; check the findings below.</p>':''}</div>`;
  }).join('')+'</details>';
  for (const [label, value] of [['Delivery / Drop area (optional)', details.dropArea], ['District (optional)', details.district]]) if (value) html += field(label, value);
  const reviews = (details.semanticReviews || []).filter(review => !review.dosageFormKey);
  for (const review of reviews) html += `<div class="general-field"><strong>${review.field === 'quantity' ? 'Quantity review' : 'Order information requiring review'}</strong><blockquote>${e(review.originalText)}</blockquote><p>${e(review.reason)}</p></div>`;
  return html + '</section>';
}

/** One controller per extension surface; server saves remain authoritative. */
export function setupGeneralProductReview({ root, request, getResult, getSources, contextKey, onSaved, rerender, onBusy = () => {} }) {
  const drafts = new Map(); let busy = false, storageError = '';
  const cardFor = key => [...root.querySelectorAll('[data-product-key]')].find(card => card.dataset.productKey === key);
  root.addEventListener('toggle', event => { const key = event.target.dataset?.reviewKey; if (key && drafts.has(key)) drafts.get(key).open = event.target.open; }, true);
  root.addEventListener('change', event => {
    const panel = event.target.closest('[data-review-key]'); const draft = panel && drafts.get(panel.dataset.reviewKey); if (!draft) return;
    if (event.target.matches('[data-product-option]')) { draft.selected = event.target.value; draft.contacted = false; panel.querySelector('[data-customer-contact]').checked = false; }
    if (event.target.matches('[data-customer-contact]')) draft.contacted = event.target.checked;
    panel.querySelector('[data-confirm-product]').disabled = busy || !draft.selected || !draft.contacted;
  });
  root.addEventListener('click', event => {
    if(event.target.closest('[data-storage-retry]')) {
      if(busy)return;
      const record=getResult(), context=contextKey();busy=true;storageError='';onBusy(true);rerender();
      void retryAuditStorage(request,record).then(updated=>{if(context===contextKey() && getResult()===record)onSaved(updated);})
        .catch(error=>{if(context===contextKey())storageError=error.message || 'Saving could not be confirmed. The audit remains retained locally.';})
        .finally(()=>{busy=false;onBusy(false);if(context===contextKey())rerender();});
      return;
    }
    const jump = event.target.closest('[data-open-product]');
    if (jump) { const card = cardFor(jump.dataset.openProduct); const panel = card?.querySelector('details'); if (panel) { panel.open = true; const draft = drafts.get(jump.dataset.openProduct); if (draft) draft.open = true; panel.querySelector('summary').focus(); } card?.scrollIntoView?.({ behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); }
    const button = event.target.closest('[data-confirm-product]');
    if (button) void confirm(button.closest('[data-review-key]').dataset.reviewKey);
  });
  const confirm = async key => {
    const record = getResult(); const product = record?.generalAudit?.productVerifications?.find(product => product.key === key); const draft = drafts.get(key);
    if (busy || !product || !draft?.contacted || !product.options.some(option => option.key === draft.selected)) return;
    if (!sameGeneralAuditSources(record, getSources())) { draft.error = 'The audit inputs changed. Audit the current order before confirming.'; rerender(); return; }
    const context = contextKey(); busy = true; draft.saving = true; draft.error = ''; draft.open = true; onBusy(true); rerender();
    try {
      const updated = await request(`/api/audits/${encodeURIComponent(record.id)}/product-confirmation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, productKey: draft.selected, previousProductKey: product.confirmation?.productKey, customerContactConfirmed: true, whatsappMessage: record.whatsappMessage, fulfillmentConfirmation: record.fulfillmentConfirmation, inputFingerprint: generalInputFingerprint(record) }) });
      if (context !== contextKey() || getResult() !== record || !sameGeneralAuditSources(record, getSources())) return;
      if (!updated?.generalAudit || updated.id !== record.id || !updated.generalAudit.productVerifications?.some(product => product.key === key && product.confirmation?.productKey === draft.selected)) throw Error('The server did not return a saved confirmation. Please retry.');
      draft.open = false; draft.contacted = false; onSaved(updated);
    } catch (error) { if (context === contextKey() && getResult() === record) draft.error = error.message || 'Confirmation could not be saved. Please retry.'; }
    finally { busy = false; draft.saving = false; onBusy(false); if (context === contextKey() && getResult()) rerender(); }
  };
  return { render: record => buildGeneralReport(record, { drafts, busy, storageError }), reset: () => drafts.clear(), isBusy: () => busy, drafts };
}
