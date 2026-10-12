import { auditedFulfillmentItems } from './vaccine-display.js';
import { auditVaccineOrder, commitVaccineOrder, getDeductionStatus, verifiedDeductionReceipt, pendingDeductionStatus } from './vaccine-api.js';

export function setupVaccines({ request, inputs, results, onChanged }) {
  const mode = document.getElementById('auditMode');
  const facility = document.getElementById('vaccineFacility');
  const panel = document.getElementById('vaccineControls');
  const customer = document.getElementById('customerInputs');
  const status = document.getElementById('allocationStatus');
  const auditStatus = document.getElementById('auditStatus');
  const confirm = document.getElementById('confirmAllocation');
  const reload = document.getElementById('reloadFacilities');
  const receipt = document.getElementById('deductionReceipt');
  const confirmLabel = 'Check allocation status';
  let fsFacility = null;
  let audit = null, version = 0, busy = false, loading = 0;
  const vaccineMode = () => mode.value !== 'general';
  const invalidate = () => {
    version++; audit = null; confirm.hidden = true;
    confirm.textContent = confirmLabel; receipt.hidden = true; receipt.textContent = '';
    status.textContent = vaccineMode() ? 'Awaiting allocation update' : 'Not applicable';
    auditStatus.textContent = 'Awaiting audit';
  };
  const updateMode = () => {
    loading++; reload.disabled = false;
    panel.hidden = !vaccineMode(); customer.hidden = mode.value === 'fulfillment_only';
    document.getElementById('btnVerify').textContent = vaccineMode() ? 'Audit & Update Allocation' : 'Analyze For Discrepancies';
    invalidate();
  };
  const applyFsFacility = () => {
    if (!fsFacility) return;
    const byId = [...facility.options].filter(option => fsFacility.id && option.value === fsFacility.id);
    const candidates = byId.length ? byId : [...facility.options].filter(option => option.dataset.name === fsFacility.facilityName && option.dataset.district === fsFacility.district && option.dataset.cycle === fsFacility.cycle && (!fsFacility.region || !option.dataset.region || option.dataset.region === fsFacility.region));
    const value = candidates.length === 1 ? candidates[0].value : '';
    if (facility.value !== value) { facility.value = value; invalidate(); onChanged(); }
  };
  const loadFacilities = async ({ preserveAudit = false } = {}) => {
    if (!preserveAudit) { invalidate(); onChanged(); }
    const current = ++loading;
    reload.disabled = true;
    try {
      const facilities = await request('/api/vaccine/companion/facilities');
      if (current !== loading) return;
      if (!Array.isArray(facilities)) throw new Error('Unexpected facility list.');
      const selected = facility.value;
      facility.replaceChildren();
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Select facility · district · allocation cycle'; facility.append(placeholder);
      for (const item of facilities) {
        const option = document.createElement('option'); option.value = item.id;
        option.dataset.name = item.facilityName; option.dataset.district = item.district; option.dataset.cycle = item.cycle;
        option.dataset.region = item.region || '';
        option.textContent = [item.facilityName, item.district, item.cycle].filter(Boolean).join(' · '); facility.append(option);
      }
      facility.value = facilities.some(item => item.id === selected) ? selected : '';
      if (selected !== facility.value) { invalidate(); onChanged(); }
      applyFsFacility();
      if (!preserveAudit) status.textContent = facilities.length ? 'Awaiting allocation update' : 'No facility allocation records found';
    } catch (error) { if (current === loading && !preserveAudit) { invalidate(); status.textContent = error.message; } }
    finally { if (current === loading) reload.disabled = false; }
  };
  mode.addEventListener('change', () => { updateMode(); onChanged(); if (vaccineMode()) void loadFacilities(); });
  facility.addEventListener('change', () => { invalidate(); onChanged(); });
  reload.addEventListener('click', loadFacilities);
  const render = data => {
    results.replaceChildren();
    const committed = !!verifiedDeductionReceipt(data, data);
    const message = document.createElement('p');
    message.textContent = committed ? data.allMatch ? 'This fulfilment event has already been recorded. No further deduction is needed.' : 'This fulfilment event was already recorded, but the current audit has discrepancies. Resolve them before dispatch; do not deduct again.' : data.allocationStatus === 'deducted' ? 'Allocation status pending verification' : data.canCommit && data.allMatch ? 'Audit passed. Updating the Allocation Blueprint.' : data.allMatch && data.canAuthorize === false ? 'Audit passed. Your role permits review; an authorized CCA or warehouse operator must update the allocation.' : 'Do not dispatch until the listed checks are resolved.';
    results.append(message);
    for (const item of auditedFulfillmentItems(data.items)) {
      const row = document.createElement('p');
      const optional = !item.originalAllocation && ['DILUENT', 'DROPPER', 'OTHER_ACCESSORY'].includes(item.productType);
      if (committed && data.transaction.items.some(saved => saved.vaccine === item.vaccine && saved.remainingAfter === 0)) row.className = 'allocation-balance-zero';
      row.textContent = `${item.vaccine}: supplied ${item.fsQty}; ${optional ? 'validated; no separate allocation' : `available ${item.remainingBefore}; balance after ${item.remainingAfter}`} — ${item.status}`;
      results.append(row);
    }
    for (const text of [...(data.errors || []), ...(data.warnings || [])]) { const row = document.createElement('p'); row.textContent = text; results.append(row); }
    auditStatus.textContent = data.auditStatus === 'requires_review' ? 'Requires review' : data.auditStatus === 'passed' ? 'Passed' : 'Failed';
    status.textContent = committed ? 'Already deducted' : data.allocationStatus === 'deducted' ? 'Allocation status pending verification' : data.allocationStatus === 'not_applicable' ? 'Not applicable' : /allocation (exceeded|exhausted)/i.test((data.errors || []).join(' ')) ? 'Insufficient allocation' : 'Awaiting allocation update';
    confirm.hidden = true;
    confirm.textContent = confirmLabel;
    if (verifiedDeductionReceipt(data, data)) showReceipt(data.transaction);
  };
  const verify = async () => {
    if (busy) return;
    invalidate(); const current = version; const source = inputs();
    busy = true; confirm.disabled = true; auditStatus.textContent = 'Audit in progress';
    try {
      const data = await auditVaccineOrder(request, { mode: mode.value, facilityId: facility.value, ...source });
      if (current !== version || JSON.stringify(inputs()) !== JSON.stringify(source)) return;
      const existingReceipt = verifiedDeductionReceipt(data, data);
      audit = existingReceipt ? { ...data, success: true, canCommit: false, allocationStatus: 'deducted' } : data;
      render(audit);
      busy = false;
      if (data.allocationStatus === 'deducted' && !existingReceipt) {
        await deduct(data, current, true); return;
      }
      if (!existingReceipt && data.canCommit && data.allMatch === true && data.isValid === true) await deduct(data, current);
    } catch (error) {
      if (current === version) { auditStatus.textContent = 'Audit requires review'; status.textContent = 'Awaiting allocation update'; results.textContent = error.message; }
    } finally { busy = false; confirm.disabled = false; }
  };
  const showReceipt = transaction => {
    receipt.hidden = false;
    receipt.textContent = `Allocation Deducted · Transaction: ${transaction.id}${transaction.timestamp ? ` · ${transaction.timestamp}` : ''}`;
  };
  const deduct = async (approved, current, retry = false) => {
    if (busy || current !== version || audit !== approved) return;
    busy = true; confirm.disabled = true; status.textContent = retry ? 'Allocation status pending verification' : 'Processing deduction';
    try {
      // A lost response may already have committed. Read its receipt before retrying.
      const prior = retry ? await getDeductionStatus(request, approved) : null;
      if (retry && prior?.allocationStatus !== 'deducted') throw pendingDeductionStatus();
      const saved = retry ? prior : await commitVaccineOrder(request, approved);
      if (current !== version) return;
      audit = { ...approved, success: true, canCommit: false, allocationStatus: 'deducted', transaction: saved.transaction }; render(audit);
      status.textContent = prior?.allocationStatus === 'deducted' ? 'Already deducted' : 'Successfully deducted';
      const success = document.createElement('p'); success.textContent = 'Allocation successfully deducted.'; results.append(success);
      const visible = new Set(auditedFulfillmentItems(approved.items).map(item => item.vaccine));
      for (const item of saved.transaction.items.filter(item => visible.has(item.vaccine))) {
        const row = document.createElement('p');
        if (item.remainingAfter === 0) row.className = 'allocation-balance-zero';
        row.textContent = `${item.vaccine}: deducted ${item.currentOrder}; remaining ${item.remainingAfter}${item.remainingAfter === 0 ? ' · Fully distributed' : ''}`;
        results.append(row);
      }
      await loadFacilities({ preserveAudit: true });
      // A refresh failure cannot change a verified deduction receipt.
      if (globalThis.chrome?.runtime) chrome.runtime.sendMessage({ type: 'FS_REFRESH_ALL' }).catch(() => {});
    } catch (error) {
      if (current === version) {
        if (error.allocationPending) {
          status.textContent = 'Allocation status pending verification';
          receipt.hidden = true; receipt.textContent = '';
          confirm.textContent = confirmLabel; confirm.hidden = false;
          return;
        }
        status.textContent = [401, 403].includes(error.status) ? 'Authorization denied' : /allocation.*(changed|insufficient)|insufficient.*allocation/i.test(error.message) ? 'Insufficient allocation' : 'Deduction failed';
        const row = document.createElement('p'); row.textContent = `${error.message} Check allocation status for this same audited order before taking further action.`; results.append(row);
        confirm.textContent = confirmLabel; confirm.hidden = false;
      }
    } finally { busy = false; confirm.disabled = false; }
  };
  confirm.addEventListener('click', () => {
    if (busy || !audit || confirm.hidden) return;
    return deduct(audit, version, true);
  });
  updateMode();
  return { setFsFacility(value) {
    if (JSON.stringify(fsFacility) === JSON.stringify(value)) return;
    fsFacility = value;
    if (!value) { if (facility.value) { facility.value = ''; invalidate(); onChanged(); } return; }
    applyFsFacility();
  }, vaccineMode, verify, invalidate, isBusy: () => busy, reset() { loading++; reload.disabled = false; facility.replaceChildren(); invalidate(); }, loadFacilities };
}
