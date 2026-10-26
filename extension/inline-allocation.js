// Read-only UI: this module never edits an FS input or sends a write request.
export function createInlineAllocation(adapter, doc) {
  doc.getElementById('ordercheck-allocation')?.remove();
  doc.getElementById('order-checker-vaccine-allocation')?.remove();
  const host = doc.createElement('div');
  host.id = 'order-checker-vaccine-allocation';
  host.style.cssText = 'display:none;flex:0 0 auto;align-self:flex-end;max-width:160px';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host{font:12px system-ui;box-sizing:border-box}div{box-sizing:border-box;min-height:38px;display:flex;align-items:center;padding:6px 9px;border:1px solid #bbf7d0;border-radius:6px;background:#f0fdf4;color:#166534;line-height:1.3;overflow-wrap:anywhere}
    div[data-tone="low"]{background:#fffbeb;border-color:#fde68a;color:#92400e}
    div[data-tone="danger"]{background:#fef2f2;border-color:#fecaca;color:#991b1b}
    div[data-tone="unavailable"]{background:#f8fafc;border-color:#cbd5e1;color:#475569}
    @media(max-width:700px){div{padding:5px 6px;font-size:11px}}
    </style><div role="status" aria-live="polite" data-tone="unavailable"><strong></strong></div>`;
  let row, group, priorRowClass, priorGroupClass;
  const restore = () => {
    // Removing an absent token can still mutate the class attribute. The page
    // observer would render again forever while Product is empty/untracked.
    if (row && !priorRowClass && row.classList.contains('ordercheck-allocation-row')) row.classList.remove('ordercheck-allocation-row');
    if (group && !priorGroupClass && group.classList.contains('ordercheck-allocation-product')) group.classList.remove('ordercheck-allocation-product');
    row = group = null;
  };
  const style = doc.createElement('style');
  style.textContent = '.ordercheck-allocation-row{display:flex!important;flex-wrap:wrap;align-items:flex-end;column-gap:8px}.ordercheck-allocation-product{flex:1 1 240px!important;min-width:200px}';
  (doc.head || doc.documentElement).append(style);
  function mount(visible) {
    const placement = adapter.productPlacement();
    if (!placement) { restore(); host.style.display = 'none'; return false; }
    if (row !== placement.row || group !== placement.group) {
      restore(); ({ row, group } = placement);
      priorRowClass = row.classList.contains('ordercheck-allocation-row');
      priorGroupClass = group.classList.contains('ordercheck-allocation-product');
    }
    // Only style the controls row, never a table or unrelated page section.
    if (visible && !row.querySelector('table,[role="table"],section')) {
      if (!row.classList.contains('ordercheck-allocation-row')) row.classList.add('ordercheck-allocation-row');
      if (!group.classList.contains('ordercheck-allocation-product')) group.classList.add('ordercheck-allocation-product');
    }
    if (host.previousElementSibling !== group) row.insertBefore(host, group.nextSibling);
    return true;
  }
  function render(selection, response) {
    const draft = selection?.draft;
    const data = response?.allocation, product = data?.products?.[selection?.order?.length || 0];
    const visible = !!draft && product?.isVaccine !== false && product?.status !== 'untracked';
    if (!visible) restore();
    if (!mount(visible)) return;
    if (!visible) { host.style.display = 'none'; return; }
    host.style.display = 'block';
    const badge = shadow.querySelector('div'), text = shadow.querySelector('strong');
    const balance = product?.balance;
    let label = 'Checking allocation…', tone = 'unavailable';
    let status = response?.error ? 'Allocation temporarily unavailable. ' + response.error : data?.message || product?.message || 'Unable to verify allocation.';
    if (response?.error || data && data.status !== 'matched') label = data?.status === 'not_found' ? 'Facility not found' : data?.status === 'no_facility' ? 'Facility not detected' : data?.status === 'ambiguous' ? 'Unable to verify allocation' : 'Allocation unavailable';
    if (!response?.error && data?.status === 'matched' && Number.isFinite(balance) && balance >= 0) {
      label = `Available: ${balance}`;
      const requested = Number(draft.quantity), threshold = response?.displaySettings?.lowThreshold ?? 10;
      const excess = Number.isFinite(requested) && requested > balance ? requested - balance : 0;
      tone = balance === 0 || excess > 0 ? 'danger' : balance <= threshold ? 'low' : 'available';
      status = excess > 0 ? `Requested quantity exceeds available allocation by ${excess}.` : balance === 0 ? 'Allocation exhausted.' : 'Sufficient allocation.';
    }
    const title = [status, `Facility: ${data?.facility?.facilityName || selection.facility.name}`, `Vaccine: ${product?.canonical || draft.name}`,
      ...[['Allocated', product?.allocated], ['Distributed', product?.distributed], ['Carryover', product?.carryOver], ['Remaining allocation', balance], ['Last checked', data?.refreshedAt], ['Last updated', product?.updatedAt]].filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${v}`)].join('\n');
    if (text.textContent !== label) text.textContent = label;
    if (badge.dataset.tone !== tone) badge.dataset.tone = tone;
    if (host.title !== title) host.title = title;
    const aria = `${label}. ${status}`;
    if (badge.getAttribute('aria-label') !== aria) badge.setAttribute('aria-label', aria);
  }
  return { host, render, dispose() { restore(); host.remove(); style.remove(); } };
}
