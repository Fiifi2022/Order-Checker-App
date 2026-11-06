import { identityResearchGeneration, hasActiveIdentityDecision, canConfirmProductReview, generalReviewKey, reviewProductDrafts, reviewProductEvidence, confirmGeneralReview, markResearchUnavailable, researchPendingProducts, mergeResearchResult, actOnProductResearch, productResearchNextSteps, canDecideIdentity, generalInventoryRows, generalProductFindingText, generalProductDecisionEvidence, sameGeneralAuditSources, generalInputFingerprint, retryAuditStorage, generalFourParameterStatuses, generalFourParameterRecord, generalAuditFindingLabel, generalFieldFindingLabel, generalAuditConfirmedLabel, markCatalogueSuggestion } from './general-auditor.js';
import { buildIssues } from './explain.js';

export const escapeGeneralHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const e = escapeGeneralHtml;
const sourceIdentity = product => JSON.stringify([product.productName, ...[product.requestedProducts, product.fulfillmentProducts].map(sources => sources.map(source => [source.originalText, source.quantity, source.unit]))]);
const field = (label, result) => `<div class="general-field"><strong>${label}</strong><span class="general-status ${result?.status === 'informational' ? 'neutral' : result?.status === 'match' ? 'matched' : result?.status === 'mismatch' ? 'discrepancy' : 'pending'}">${e(result?.status === 'informational' ? 'Optional — information only' : result && ['review required','missing from customer request','not available in system entry','mismatch'].includes(result.status) ? generalFieldFindingLabel(label, result) : result?.status || 'Not provided')}</span><p>Customer: ${e(result?.whatsappValue || 'Not available')}</p><p>Fulfilment: ${e(result?.fulfillmentValue || 'Not available')}</p></div>`;

export function buildIdentityCard(name,value,{busy=false,error=''}={}){
 if(!value)return '';
 const decision=value.identityDecision,decided=decision&&decision.action!=='reset';
 const matched=value.status==='match',pending=value.status==='review required';
 const status=decided?decision.action==='confirm'?'Manually Verified':'Discrepancy Confirmed':matched?'Verified':pending?'Awaiting CCA Confirmation':'Discrepancy';
 const canAct=canDecideIdentity(value)&&(!matched||decided);
 let html=`<article class="general-field identity-card ${matched?'identity-verified':pending?'identity-pending':'identity-rejected'}" data-identity-field="${e(name)}"><h4>${name==='orderer'?'Name of Orderer':'Facility Name'}</h4><p role="status">${e(status)}</p>${pending&&!decided?`<strong>Possible ${name==='orderer'?'Name':'Facility'} Match Detected</strong>`:''}<p>Customer WhatsApp: ${e(value.whatsappValue==='N/A'?'Not provided':value.whatsappValue)}</p><p>Fulfilment System: ${e(value.fulfillmentValue==='N/A'?'Not provided':value.fulfillmentValue)}</p><p><strong>Reason:</strong> ${e(value.reason||'Compare the original identity values.')}</p>`;
 if(value.previousIdentitySuggestion)html+=`<p>Previously ${value.previousIdentitySuggestion.decision==='confirm'?'confirmed':'rejected'} by ${e(value.previousIdentitySuggestion.actor)} on ${e(value.previousIdentitySuggestion.at)}. Confirm this order independently.</p>`;
 if(canAct&&!decided)html+=`<p><strong>Suggested Action:</strong> Confirm whether both names refer to the same ${name==='orderer'?'customer':'facility'}.</p><div class="limit-buttons"><button type="button" class="btn-small btn-yes" data-identity-action="confirm"${busy?' disabled':''}>Confirm Match</button><button type="button" class="btn-small btn-identity-reject" data-identity-action="reject"${busy?' disabled':''}>Reject Match</button></div>`;
 if(decided)html+=`<p>Decision by ${e(decision.actor.name)} — <time>${e(decision.at)}</time></p><button type="button" class="action-link" data-identity-action="reset"${busy?' disabled':''}>Change Decision</button>`;
 if(value.identityHistory?.length)html+=`<details><summary>Decision history</summary>${value.identityHistory.map(entry=>`<p>${e(entry.action==='reset'?'Decision reopened':entry.action==='confirm'?'Match confirmed':'Match rejected')} — ${e(entry.actor.name)} — ${e(entry.at)}<br>${e(entry.customer)} ↔ ${e(entry.fulfillment)}</p>`).join('')}</details>`;
 if(error)html+=`<p role="alert" class="general-error">${e(error)}</p>`;
 return html+'</article>';
}

export function buildGeneralReport(record, { drafts = new Map(), busy = false, storageError = '' } = {}) {
  record = generalFourParameterRecord(record);
  const details = record.generalAudit;
  const rows = generalInventoryRows(record.items, details);
  const pending = rows.filter(row => row.product?.status === 'customer confirmation required');
  const types = record.allMatch ? [] : [...new Set(buildIssues(record).map(issue => issue.type))];
  const review = details.decision === 'review';
  let html = `<section class="audit-highlight ${record.allMatch ? 'verdict-ok' : review ? 'verdict-pending' : record.issueCount ? 'verdict-bad' : 'verdict-pending'}" aria-label="Audit summary"><span class="verdict-badge">${record.allMatch ? details.productComparisonMode === 'names_only' ? 'Product names verified' : details.productComparisonMode === 'names_and_quantities' ? e(generalAuditConfirmedLabel(details)) : 'Order verified' : review ? 'Needs Review' : record.issueCount ? `Discrepancies: ${e(record.issueCount)}` : e(/review required/i.test(details.finalStatus || '') ? generalAuditFindingLabel(details) : details.finalStatus || 'Verification required')}</span>${types.length ? `<ul class="highlight-types" aria-label="Discrepancy types">${types.map(type => `<li>${e(type)}</li>`).join('')}</ul>` : ''}</section>`;
  html+=record.allMatch?'<p>No Discrepancy Detected</p>':review?`<p>${e(generalAuditFindingLabel(details))}</p>`:'';
  if(record.storage) html += `<section class="audit-section" aria-label="Audit storage"><p class="general-status ${record.storage.status==='saved'?'matched':'pending'}">${e(record.storage.message)}</p>${record.storage.status!=='saved'?`<button type="button" data-storage-retry${busy?' disabled':''}>${busy?'Checking save…':'Retry saving audit'}</button>`:''}${storageError?`<p role="alert">${e(storageError)}</p>`:''}</section>`;
  if (details.discrepancies.length) html += `<section class="audit-section audit-findings" aria-label="Discrepancies"><h3>Discrepancies (${details.discrepancies.length})</h3><ul>${details.discrepancies.map(issue => `<li>${e(issue)}</li>`).join('')}</ul></section>`;
  const uncertainIdentity=['facility','orderer'].filter(field=>details[field]&&details[field].status!=='match'&&canDecideIdentity(details[field]));
  if(details.catalogueSuggestions?.length||uncertainIdentity.length)html+='<section class="audit-section" aria-label="Review Suggestions"><h3>Review Suggestions</h3>'+uncertainIdentity.map(field=>buildIdentityCard(field,details[field],{busy,error:drafts.get(`identity:${field}`)?.error})+(details.identityResearch?.[field]?.suggestion?`<p>Gemini suggestion: ${e(details.identityResearch[field].suggestion.reason)}</p>`:'')+`<button type="button" data-identity-research="${field}" ${busy?'disabled':''}>Search Again</button>`).join('')+(details.catalogueSuggestions||[]).map(group=>{
    const key=`catalogue:${group.alias}`;
    const identity=JSON.stringify([record.id,record.whatsappMessage,record.fulfillmentConfirmation,group.options]);
    let draft=drafts.get(key);if(!draft||draft.identity!==identity){draft={identity,selected:'',contacted:false,error:''};drafts.set(key,draft);}
    const locked=busy||draft.researching;
    return `<article data-catalogue-suggestion="${e(group.alias)}"><h4>${e(group.alias)}</h4><p>Customer Request: ${e(group.customerValue||group.alias)}</p><p>FS Confirmation: ${e(group.fulfillmentValue||group.options.map(o=>o.name).join('; ')||'Check the original FS entries below.')}</p>${group.options.length?`<p>Choose a suggestion and verify the product before approving its alias.</p><label>Choose the matching product<select data-catalogue-option aria-label="Suggested product for ${e(group.alias)}"${locked?' disabled':''}><option value="">Select a product</option>${group.options.map(option=>`<option value="${e(option.productId)}"${draft.selected===option.productId?' selected':''}>${e(option.name)}</option>`).join('')}</select></label>${group.options.find(option=>option.productId===draft.selected)?.reason?`<p>${e(group.options.find(option=>option.productId===draft.selected).reason)}</p>`:''}<label><input type="checkbox" data-catalogue-verified${draft.contacted?' checked':''}${locked||!draft.selected?' disabled':''}> I have verified that this is the same product, including any stated strength and formulation.</label><button type="button" data-confirm-catalogue${locked||!draft.selected||!draft.contacted?' disabled':''} aria-label="Confirm match and resume">Confirm &amp; Resume</button>`:'<p>No catalogue suggestion is available. Correct the product name or add its verified catalogue record.</p>'}<div>${group.options.length?`<button type="button" data-research-action="reject"${locked||!draft.selected?' disabled':''}>Reject</button>`:'<button type="button" disabled aria-label="Confirm match and resume">Confirm &amp; Resume</button><button type="button" disabled>Reject</button>'}<button type="button" data-research-action="research"${locked?' disabled':''}>Search Again</button></div><p>Confidence: ${e(group.options.find(option=>option.productId===draft.selected)?.confidenceCategory||group.confidenceCategory||'LOW')} — evidence category, not a verified probability.</p><p>${e(group.options.find(option=>option.productId===draft.selected)?.evidenceSource==='catalogue'?'Catalogue wording':group.options.find(option=>option.productId===draft.selected)?.evidenceSource==='gemini'?'Gemini terminology analysis':group.options.find(option=>option.productId===draft.selected)?.evidenceSource==='source'?'Customer request and FS wording':'Choose a candidate to inspect its evidence')}</p><ul>${(group.nextSteps||productResearchNextSteps(!!group.options.length)).map(step=>`<li>${e(step)}</li>`).join('')}</ul>${(group.terminology||[]).map(term=>`<p>Possible terminology to investigate: ${e(term.name)} — ${e(term.reason)}</p>`).join('')}${(group.sources||[]).filter(source=>/^https:\/\//i.test(source.url)).map(source=>`<p><a href="${e(source.url)}" target="_blank" rel="noopener noreferrer">${e(source.title)}</a></p>`).join('')}${group.searchEntryPoint?`<iframe title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${e(group.searchEntryPoint)}"></iframe>`:''}${group.researchStatus&&['rate_limited','unavailable','timed_out'].includes(group.researchStatus)?'<p>AI research could not complete. Use the catalogue options and next steps.</p>':''}${group.researchStatus==='deferred'&&!group.retainedDiscrepancy?'<p role="status">Pending research. Completed comparisons remain available.</p>':''}${group.retainedDiscrepancy?'<p>Discrepancy retained. The audit is not cleared.</p>':''}<button type="button" data-research-action="keep" ${locked||group.retainedDiscrepancy?'disabled':''}>Keep Discrepancy</button>${draft.error?`<p role="alert">${e(draft.error)}</p>`:''}</article>`;
  }).join('')+'</section>';
  html += '<section class="audit-section general-inventory" aria-label="Inventory Cross Examination"><h3>Product results</h3><p class="audit-section-hint">Inventory Cross Examination</p>';
  if (pending.length) html += `<nav class="general-pending" aria-label="Products requiring confirmation"><p>${pending.length} ${pending.length === 1 ? 'product requires' : 'products require'} customer verification.</p>${pending.map(row => `<button type="button" class="action-link" data-open-product="${e(row.key)}">${e(row.product.productName)}</button>`).join('')}</nav>`;
  rows.forEach(({ key, product, items }) => {
    const requested = product?.requestedProducts || items.flatMap(item => item.provenance.filter(source => source.source === 'customer_request'));
    const fulfilled = product?.fulfillmentProducts || items.flatMap(item => item.provenance.filter(source => source.source === 'fulfillment_confirmation'));
    const paired = items.find(item => item.provenance.some(source => source.source === 'customer_request'));
    const quantity = paired?.fulfillment || items[0]?.fulfillment;
    const pendingConfirmation = product?.status === 'customer confirmation required';
    const requiresReview = Boolean(quantity?.identityReviewRequired || product?.status === 'review required');
    const discrepancy = product?.confirmation ? product.reviewState === 'product discrepancy' : !requiresReview && !pendingConfirmation && items.some(item => ['missing item', 'extra item', 'vaccine pairing mismatch', 'product identity discrepancy'].includes(item.status));
    const productStatus = generalProductFindingText(requiresReview ? (quantity?.identityError || product?.reason || 'Product identity could not be verified') : pendingConfirmation ? 'Customer Confirmation Required' : items.some(item=>item.status==='product identity discrepancy') ? 'Product Identity Discrepancy' : discrepancy ? 'Product Discrepancy' : product?.confirmation ? 'Customer Verified — Product Match' : 'Product Match');
    const requestedQuantity = product?.requestedQuantity ?? quantity?.requested ?? 0;
    const suppliedQuantity = product?.suppliedQuantity ?? items[0]?.fulfillment.supplied ?? 0;
    const comparable = fulfilled.length > 0 && new Set([...requested, ...fulfilled].map(source => source.unit)).size <= 1;
    const shortfall = pendingConfirmation && comparable && suppliedQuantity > 0 && suppliedQuantity < requestedQuantity;
    const quantityStatus = generalProductFindingText(requiresReview ? (quantity?.identityError || product?.reason || 'Product identity could not be verified') : quantity?.quantityReviewRequired ? 'OUT OF STOCK — RECORDED QUANTITY MISMATCH' : shortfall || quantity?.orderLimitEligible && quantity.orderLimitDecision === undefined ? 'Order Limit Verification Required' : pendingConfirmation ? 'Awaiting product verification' : quantity?.fulfillmentStatus === 'order limit applied' ? 'Order Limit Applied' : quantity?.fulfillmentStatus === 'out of stock' ? quantity.stockStatus === 'partially out of stock' ? 'PARTIALLY OUT OF STOCK' : 'OUT OF STOCK' : quantity?.fulfillmentStatus === 'quantity review' ? `Needs Review: ${quantity.quantityError || 'Quantity could not be read'}` : quantity?.fulfillmentStatus === 'discrepancy' ? 'Quantity Discrepancy' : 'Quantity Match');
    html += `<article class="general-product" data-product-key="${e(key)}" tabindex="-1"><h4>${e(product?.productName || items[0]?.name)}</h4><p>Customer Request: ${e(product?.productName || [...new Set(requested.map(source => source.name))].join('; ') || (quantity?.identityReviewRequired ? 'Not provided' : 'Not requested'))}</p><p>Fulfilment: ${e([...new Set(fulfilled.map(source => source.name))].join('; ') || 'Not fulfilled')}</p>`;
    if (quantity?.fulfillmentStatus === 'order limit applied' || details.productComparisonMode === 'names_and_quantities') {
      html += `<div class="general-quantities"><span>Requested: ${e(quantity.requestedQuantityMissing ? 'Not provided' : requestedQuantity)} ${e(quantity.requestedUnit || requested[0]?.unit || '')}</span><span>Fulfilled: ${e(quantity.suppliedQuantityMissing ? 'Not provided' : suppliedQuantity)} ${e(quantity.suppliedUnit || fulfilled[0]?.unit || '')}</span>${!quantity.quantityError && (quantity.conversion || comparable) ? `<span>Remaining to fulfil: ${e(Math.max(0, (quantity.conversion?.requested ?? requestedQuantity) - (quantity.conversion?.supplied ?? suppliedQuantity)))} ${e(quantity.conversion?.unit || quantity.requestedUnit || requested[0]?.unit || '')}</span>` : ''}</div>`;
    }
    if (quantity?.outOfStockQuantity !== undefined) html += `<p class="general-status pending">Out of stock: ${e(quantity.outOfStockQuantity)} ${e(quantity.conversion?.unit || quantity.requestedUnit)}</p>`;
    if(quantity?.confirmationRequested !== undefined) html += `<p>Fulfilment confirmation quantity: [${e(suppliedQuantity)}/${e(quantity.confirmationRequested)}]</p>`;
    html += `<p>Product: <span class="general-status ${requiresReview || pendingConfirmation ? 'pending' : discrepancy ? 'discrepancy' : 'matched'}">${e(productStatus)}</span></p>${details.productComparisonMode === 'names_only' ? '' : `<p>Quantity: <span class="general-status ${/Required|Awaiting|OUT OF STOCK|Needs Review/.test(quantityStatus) ? 'pending' : /Discrepancy/.test(quantityStatus) ? 'discrepancy' : 'neutral'}">${e(generalProductFindingText(quantity?.quantityError || quantityStatus))}</span></p>`}`;
    if (quantity?.conversion) html += `<p>Packaging conversion: ${e(quantity.conversion.description)}</p>`;
    html += `<details aria-label="Product decision evidence"><summary>Product decision evidence</summary><dl>${generalProductDecisionEvidence(items).map(row => `<div><dt>${e(row.label)}</dt><dd style="white-space:pre-wrap">${e(row.value)}</dd></div>`).join('')}</dl></details>`;
    if (product) {
      let draft = drafts.get(key);
      const identity = sourceIdentity(product);
      if (!draft || draft.identity !== identity) { draft = { identity, selected: '', contacted: false, open: false, error: '' }; drafts.set(key, draft); }
      html += `<details data-review-key="${e(key)}"${draft.open ? ' open' : ''}><summary>${product.confirmation ? 'View verification details / Correct confirmation' : 'Confirm Product Identity'}</summary><div class="general-controls"><p>Requested: ${e(product.productName)}</p><p>Suggested: ${e(product.suggestedProduct || 'Select a catalogue product')}</p><p>Confirm the exact catalogue product with the customer.</p>`;
      if (product.confirmation) html += `<p>Confirmed: ${e(product.confirmation.productName)}</p><p>Confirmed by: ${e(product.confirmation.confirmedBy?.name || 'CCA')} — <time>${e(product.confirmation.confirmedAt)}</time></p>${(product.confirmationHistory || []).map(entry => `<p>Previous: ${e(entry.productName)} — ${e(entry.confirmedBy?.name || 'CCA')} — ${e(entry.confirmedAt)}</p>`).join('')}`;
      html += `<label>Select the product confirmed by the customer<select data-product-option aria-label="Confirmed formulation for ${e(product.productName)}"${busy ? ' disabled' : ''}><option value="">Select a product</option>${product.options.map(option => `<option value="${e(option.key)}"${draft.selected === option.key ? ' selected' : ''}>${e(option.name)}${option.fromFulfillment ? ' — recorded in fulfilment' : ''}</option>`).join('')}</select></label><label class="general-contact"><input data-customer-contact type="checkbox"${draft.contacted ? ' checked' : ''}${busy ? ' disabled' : ''}> I have contacted the customer and confirmed the exact product identity.</label><button type="button" class="btn-small btn-yes" data-confirm-product${busy || !draft.selected || !draft.contacted ? ' disabled' : ''}>${draft.saving ? 'Saving confirmation…' : 'Confirm Product'}</button>${draft.error ? `<p class="general-error" role="alert">${e(draft.error)}</p>` : ''}</div></details>`;
    }
    if (quantity?.orderLimitEligible) {
      html += `<div class="limit-prompt"><strong>Was this quantity reduced because of an order limit?</strong><div class="limit-buttons"><button type="button" class="btn-small btn-yes" data-general-limit="yes" data-key="${e(quantity.key)}" aria-pressed="${quantity.orderLimitDecision === true}"${busy ? ' disabled' : ''}>Yes — reduced by order limit</button><button type="button" class="btn-small" data-general-limit="no" data-key="${e(quantity.key)}" aria-pressed="${quantity.orderLimitDecision === false}"${busy ? ' disabled' : ''}>No — report discrepancy</button></div>${quantity.orderLimitDecision === true ? '<p role="status">Approved — Order Limit Applied</p>' : quantity.orderLimitDecision === false ? '<p role="status">Quantity Discrepancy — order limit not applied</p>' : ''}</div>`;
    }
    html += '</article>';
  });
  html += '</section><section class="audit-section general-identity" aria-label="Identity and order checks"><h3>Identity and order checks</h3>' + ['facility','orderer'].filter(field=>!uncertainIdentity.includes(field)).map(field=>buildIdentityCard(field,details[field],{busy,error:drafts.get(`identity:${field}`)?.error})).join('');
  const statuses = generalFourParameterStatuses(details);
  html += field('Products', {status: statuses.products,
    whatsappValue: `${details.productCount?.requested ?? 0} products`, fulfillmentValue: `${details.productCount?.found ?? 0} products`});
  const reviews = (details.semanticReviews || []).filter(review => !review.dosageFormKey);
  for (const review of reviews) {
    const reviewKey=generalReviewKey(review),key=`source-review:${reviewKey}`;
    const sourceRows=reviewProductDrafts(record.items,review,details.extraction),identity=JSON.stringify([record.id,record.whatsappMessage,record.fulfillmentConfirmation,sourceRows]),evidence=reviewProductEvidence(record.items,review);
    let draft=drafts.get(key);if(!draft||draft.identity!==identity){draft={identity,products:reviewProductDrafts(record.items,review,details.extraction),verified:false,error:''};drafts.set(key,draft);}
    const controls=canConfirmProductReview(review)?`<div data-source-review="${e(reviewKey)}"><p>Check the products and quantities in this source text, then confirm. Other differences remain checked separately.</p>${draft.products.map((row,index)=>`<fieldset data-review-row="${index}"${busy?' disabled':''}><legend>Product ${index+1}</legend><p><strong>${review.source==='customer_request'?'Customer requested':'Fulfilment product'}:</strong> ${e(row.name)}</p><label>${review.source==='customer_request'?'Requested quantity':'Fulfilled quantity'}<input type="number" min="0" step="any" data-review-value="quantity" value="${e(row.quantity)}"${evidence.some(p=>p.line===row.line&&!p.quantityReview)||row.line===null&&!!sourceRows[index]?.quantity?' readonly':''}></label><label>Unit (if stated)<input data-review-value="unit" maxlength="30" value="${e(row.unit)}"${evidence.some(p=>p.line===row.line&&!p.quantityReview)||row.line===null&&!!sourceRows[index]?.quantity?' readonly':''}></label>${review.source==='fulfillment_confirmation'?`<label>FS recorded requested quantity (if stated)<input type="number" min="0" step="any" data-review-value="confirmationRequested" value="${e(row.confirmationRequested)}"${evidence.some(p=>p.line===row.line&&p.ratioRequestedQuantity!==undefined)||row.line===null&&!!sourceRows[index]?.confirmationRequested?' readonly':''}></label>`:''}</fieldset>`).join('')}${!draft.products.length?'<p>No product name could be read from this source. Use the product suggestions to resolve its identity; no name has been assumed.</p>':''}<label><input type="checkbox" data-review-verified${draft.verified?' checked':''}${busy||!draft.products.length?' disabled':''}> I have verified these products and quantities against the source message.</label><button type="button" class="btn-small btn-yes" data-confirm-source-review${busy||!draft.verified||!draft.products.length||draft.products.some(row=>!row.name.trim()||!row.quantity.trim())?' disabled':''}>Confirm Products &amp; Quantities</button>${draft.error?`<p role="alert">${e(draft.error)}</p>`:''}</div>`:'';
    html += `<div class="general-field"><strong>${review.field === 'quantity' ? 'Quantity review' : 'Order information requiring review'}</strong><blockquote>${e(review.originalText)}</blockquote><p>${e(review.reason)}</p>${controls}</div>`;
  }
  return html + '</section>';
}

/** One controller per extension surface; server saves remain authoritative. */
export function setupGeneralProductReview({ root, request, getResult, getSources, contextKey, onSaved, rerender, onBusy = () => {} }) {
  const drafts = new Map(); let busy = false, storageError = '';
  const attemptedResearch=new Set();let queuedResearchResponse,queuedResearchFailure;
  const applyResearch=response=>{if(busy){queuedResearchResponse=queuedResearchResponse?mergeResearchResult(queuedResearchResponse,response):response;return;}const current=getResult();if(current&&sameGeneralAuditSources(current,getSources())){const merged=mergeResearchResult(current,response);if(merged!==current)onSaved(merged);}};
  const applyResearchFailure=record=>{if(busy){queuedResearchFailure=record;return;}const current=getResult();if(current&&sameGeneralAuditSources(current,getSources())){const updated=markResearchUnavailable(current,record);if(updated!==current)onSaved(updated);}};
  const maybeResearch=record=>{
    if(busy)return;
    if(queuedResearchResponse){const response=queuedResearchResponse;queuedResearchResponse=undefined;applyResearch(response);return;}
    if(queuedResearchFailure){const failed=queuedResearchFailure;queuedResearchFailure=undefined;applyResearchFailure(failed);return;}
    const pending=record?.generalAudit?.catalogueSuggestions?.filter(g=>g.researchStatus==='deferred'&&!g.retainedDiscrepancy)||[];
    const identities=Object.entries(record?.generalAudit?.identityResearch||{}).filter(([field,value])=>value.status==='deferred'&&record.generalAudit[field]?.status==='review required'&&!hasActiveIdentityDecision(record.generalAudit[field]));
    if(!pending.length&&!identities.length||record!==getResult()||!sameGeneralAuditSources(record,getSources()))return;
    const key=JSON.stringify([contextKey(),record.id,generalInputFingerprint(record),pending.map(g=>[g.alias,g.researchRevision||0]),identities,identityResearchGeneration(record.generalAudit)]);if(attemptedResearch.has(key))return;
    if(attemptedResearch.size>128)attemptedResearch.clear();attemptedResearch.add(key);const context=contextKey();
    void researchPendingProducts(request,record).then(response=>{if(context===contextKey())applyResearch(response);}).catch(()=>{if(context===contextKey())applyResearchFailure(record);});
  };
  const cardFor = key => [...root.querySelectorAll('[data-product-key]')].find(card => card.dataset.productKey === key);
  root.addEventListener('toggle', event => { const key = event.target.dataset?.reviewKey; if (key && drafts.has(key)) drafts.get(key).open = event.target.open; }, true);
  root.addEventListener('change', event => {
    const sourceReview=event.target.closest('[data-source-review]');
    if(sourceReview){const draft=drafts.get(`source-review:${sourceReview.dataset.sourceReview}`);if(!draft||busy)return;
      const field=event.target.dataset.reviewValue;
      if(['quantity','unit','confirmationRequested'].includes(field)){const index=Number(event.target.closest('[data-review-row]').dataset.reviewRow);draft.products[index][field]=event.target.value;draft.verified=false;draft.error='';}
      if(event.target.matches('[data-review-verified]'))draft.verified=event.target.checked;
      rerender();return;
    }

    const suggestion=event.target.closest('[data-catalogue-suggestion]');
    if(suggestion){const draft=drafts.get(`catalogue:${suggestion.dataset.catalogueSuggestion}`);if(!draft||busy)return;
      if(event.target.matches('[data-catalogue-option]')){draft.selected=event.target.value;draft.contacted=false;}
      if(event.target.matches('[data-catalogue-verified]'))draft.contacted=event.target.checked;
      rerender();return;
    }
    const panel = event.target.closest('[data-review-key]'); const draft = panel && drafts.get(panel.dataset.reviewKey); if (!draft) return;
    if (event.target.matches('[data-product-option]')) { draft.selected = event.target.value; draft.contacted = false; panel.querySelector('[data-customer-contact]').checked = false; }
    if (event.target.matches('[data-customer-contact]')) draft.contacted = event.target.checked;
    panel.querySelector('[data-confirm-product]').disabled = busy || !draft.selected || !draft.contacted;
  });
  root.addEventListener('click', event => {
    const review=event.target.closest('[data-source-review]');
    if(review&&event.target.closest('[data-confirm-source-review]')){void confirmSourceReview(review.dataset.sourceReview);return;}

    const retryIdentity=event.target.closest('[data-identity-research]');
    if(retryIdentity){const record=getResult(),context=contextKey();if(busy||!record||!sameGeneralAuditSources(record,getSources()))return;void researchPendingProducts(request,record,retryIdentity.dataset.identityResearch).then(updated=>{if(context===contextKey())applyResearch(updated);}).catch(()=>{if(context===contextKey())applyResearchFailure(record);});return;}
    const identity=event.target.closest('[data-identity-action]');
    if(identity){void chooseIdentity(identity.closest('[data-identity-field]').dataset.identityField,identity.dataset.identityAction);return;}
    const research=event.target.closest('[data-research-action]');
    if(research){void researchAction(research.closest('[data-catalogue-suggestion]').dataset.catalogueSuggestion,research.dataset.researchAction);return;}
    const approve=event.target.closest('[data-confirm-catalogue]');
    if(approve){void chooseSuggestion(approve.closest('[data-catalogue-suggestion]').dataset.catalogueSuggestion);return;}
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
  const confirmSourceReview=async reviewKey=>{
    const record=getResult(),context=contextKey(),draft=drafts.get(`source-review:${reviewKey}`);
    if(busy||!record||!draft?.verified)return;
    if(!sameGeneralAuditSources(record,getSources())){draft.error='The messages changed. Open the current audit before confirming.';rerender();return;}
    busy=true;onBusy(true);draft.error='';rerender();
    try{const updated=await confirmGeneralReview(request,record,{reviewKey,products:draft.products,verified:true});if(context===contextKey()&&getResult()===record&&sameGeneralAuditSources(record,getSources()))onSaved(updated);}
    catch(error){if(context===contextKey())draft.error=error.message||'Confirmation could not be saved. Please retry.';}
    finally{busy=false;onBusy(false);if(context===contextKey())rerender();}
  };
  const chooseIdentity=async(field,action)=>{
    const record=getResult(),context=contextKey();if(busy||!record?.generalAudit)return;
    if(!sameGeneralAuditSources(record,getSources())){drafts.set(`identity:${field}`,{error:'The messages changed. Audit the current messages before deciding.'});rerender();return;}
    busy=true;drafts.delete(`identity:${field}`);onBusy(true);rerender();
    try{
      const updated=await request(`/api/audits/${encodeURIComponent(record.id)}/identity-decision`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({field,action,previousRevision:record.generalAudit[field].identityDecision?.revision||0,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)})});
      if(!updated?.generalAudit||updated.id!==record.id)throw Error('The server did not return a saved identity decision. Retry.');
      if(context===contextKey()&&getResult()===record&&sameGeneralAuditSources(record,getSources()))onSaved(updated);
    }catch(error){if(context===contextKey())drafts.set(`identity:${field}`,{error:error.message||'Decision could not be saved. Retry.'});}
    finally{busy=false;onBusy(false);if(context===contextKey())rerender();}
  };
  const researchAction=async(alias,action)=>{
    const record=getResult(),context=contextKey(),draft=drafts.get(`catalogue:${alias}`);
    if(busy||draft?.researching||!draft||!record)return;
    if(!sameGeneralAuditSources(record,getSources())){draft.error='The messages changed. Open the current audit before researching.';rerender();return;}
    if(action==='research'){draft.researching=true;draft.error='';rerender();try{const updated=await actOnProductResearch(request,record,alias,action);if(context===contextKey())applyResearch(updated);}catch(error){draft.error=error.message||'Research unavailable';}finally{draft.researching=false;rerender();}return;}
    busy=true;draft.error='';onBusy(true);rerender();
    try{const updated=await actOnProductResearch(request,record,alias,action,draft.selected||undefined);if(context===contextKey()&&getResult()===record&&sameGeneralAuditSources(record,getSources()))onSaved(updated);}
    catch(error){if(context===contextKey())draft.error=error.message||'Product research action could not be saved.';}
    finally{busy=false;onBusy(false);if(context===contextKey())rerender();}
  };
  const chooseSuggestion=async alias=>{
    const record=getResult(),context=contextKey(),draft=drafts.get(`catalogue:${alias}`);
    const group=record?.generalAudit?.catalogueSuggestions?.find(group=>group.alias===alias);
    if(busy||!draft?.contacted||!group?.options.some(option=>option.productId===draft.selected))return;
    if(!sameGeneralAuditSources(record,getSources())){draft.error='The messages changed. Run a new audit before choosing a suggestion.';rerender();return;}
    busy=true;draft.error='';onBusy(true);rerender();
    try{const updated=await actOnProductResearch(request,record,alias,'confirm',draft.selected);if(context===contextKey()&&getResult()===record&&sameGeneralAuditSources(record,getSources()))onSaved(updated); }
    catch(error){if(context===contextKey())draft.error=error.message||'Suggestion could not be approved.';}
    finally{busy=false;onBusy(false);if(context===contextKey())rerender();}
  };
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
  return { render: record => {queueMicrotask(()=>maybeResearch(record));return buildGeneralReport(record, { drafts, busy, storageError });}, reset: () => {drafts.clear();queuedResearchResponse=undefined;queuedResearchFailure=undefined;}, isBusy: () => busy, drafts };
}
