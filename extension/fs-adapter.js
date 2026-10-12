// Read confirmed selections and order rows through field labels, never page-wide text.
export function createFsAdapter(doc) {
  const scripts = createFsScriptReader();
  let cachedRoot;
  const labels = { Facility: ['facility', 'health facility', 'select facility', 'selected facility'], District: ['district'], Region: ['region'], Product: ['product', 'product name', 'select product', 'select a product', 'search products', 'search product'], Quantity: ['quantity', 'qty', 'requested quantity', 'requested qty'] };
  const key = value => String(value || '').replace(/\s+/g, ' ').trim().replace(/[\s*:]+$/, '').toLowerCase();
  const matches = (value, field) => labels[field].includes(key(value));
  const widgets = 'input:not([type="hidden"]),select,[role="combobox"],[role="spinbutton"],button[aria-haspopup="listbox"],button[aria-haspopup="true"],[role="button"][aria-haspopup="listbox"]';
  function captionValue(scope, field) {
    if (!scope) return '';
    const marked = scope.querySelector(`[data-ordercheck-${field.toLowerCase()}]`);
    if (marked) return marked.textContent.trim();
    // Dedicated label/value pairs (including definition lists); never read an
    // entire card or selected dropdown options elsewhere on the page.
    for (const label of scope.querySelectorAll('label,dt,span,p,div')) {
      if (label.closest('table,[role="table"],[role="grid"], [role="listbox"]') || !matches(label.textContent, field) || label.querySelector(widgets)) continue;
      if ([...label.children].some(child => matches(child.textContent, field))) continue;
      const value = label.nextElementSibling;
      if (!value || value.matches(widgets) || value.querySelector(widgets) || value.querySelector('label,dt,[role="option"]')) continue;
      const text = value.textContent.trim();
      if (text && text.length <= 160 && !Object.keys(labels).some(name => matches(text, name))) return text;
    }
    return '';
  }
  function nearbyWidget(label, scope) {
    // Plain React text labels may lack for/aria-labelledby. Only accept a
    // uniquely associated widget in a small field container, never an order card.
    for (let container = label.parentElement, depth = 0; container && scope.contains(container) && depth < 2; container = container.parentElement, depth++) {
      const candidates = [...container.querySelectorAll(widgets)].filter(el => !el.matches(':disabled'));
      if (candidates.length === 1) {
        const otherLabels = [...container.querySelectorAll('label,span,p')].filter(el => el !== label && !el.contains(label) && !label.contains(el) && !el.closest(widgets));
        if (otherLabels.some(el => Object.keys(labels).some(field => matches(el.textContent, field)) && key(el.textContent) !== key(label.textContent))) return null;
        return candidates[0];
      }
      if (candidates.length > 1) return null;
    }
    return null;
  }
  function labelledWidget(label, scope) {
    const id = label.htmlFor || label.getAttribute('for');
    const target = id && doc.getElementById(id);
    if (target && scope.contains(target)) return target.matches(widgets) ? target : target.querySelector(widgets) || target;
    if (label.id) {
      const linked = [...scope.querySelectorAll(widgets)].find(el => (el.getAttribute('aria-labelledby') || '').split(/\s+/).includes(label.id));
      if (linked) return linked;
    }
    return label.querySelector(widgets) || nearbyWidget(label, scope);
  }
  function control(scope, field) {
    if (!scope) return null;
    const marked = scope.querySelector(`[data-ordercheck-field="${field.toLowerCase()}"]`);
    if (marked) return marked;
    for (const el of scope.querySelectorAll(widgets)) {
      const name = key(el.getAttribute('name')).replace(/[_-]/g, ' ');
      if (matches(el.getAttribute('aria-label'), field) || matches(name, field)) return el;
      if (matches(el.getAttribute('placeholder'), field)) return el;
      const labelIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/);
      if (labelIds.some(id => { const label = id && doc.getElementById(id); return label && matches(label.textContent, field); })) return el;
    }
    for (const label of scope.querySelectorAll('label')) {
      if (!matches(label.textContent, field)) continue;
      const target = labelledWidget(label, scope);
      if (target) return target;
    }
    for (const label of scope.querySelectorAll('span,p,div')) {
      if (label.closest(widgets) || !matches(label.textContent, field)) continue;
      // Skip wrappers around the actual label or any controls.
      if (label.querySelector(widgets) || [...label.children].some(child => matches(child.textContent, field))) continue;
      const target = nearbyWidget(label, scope);
      if (target) return target;
    }
    return null;
  }
  const facilityPresent = scope => control(scope, 'Facility') || captionValue(scope, 'Facility');
  const complete = scope => facilityPresent(scope) && (control(scope, 'Product') || table(scope) || captionValue(scope, 'District') && captionValue(scope, 'Region') || [...scope.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],legend')].some(heading => ['add new order', 'new order', 'requested products'].includes(key(heading.textContent))));
  function root() {
    if (cachedRoot?.isConnected && complete(cachedRoot)) return cachedRoot;
    const marked = doc.querySelector('[data-ordercheck-order-form], [data-testid="add-order-form"], [data-testid="new-order-form"]');
    if (marked && facilityPresent(marked)) return cachedRoot = marked;
    const semantic = [...doc.querySelectorAll('form,[role="dialog"],main')].find(complete);
    if (semantic) return cachedRoot = semantic;
    // React screens often render divs rather than a form or main. Start from a
    // specifically labelled Facility widget and find its smallest shared container.
    const facility = control(doc, 'Facility');
    for (let scope = facility?.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
      if (complete(scope)) return cachedRoot = scope;
    }
    for (const label of doc.querySelectorAll('label,dt,span,p,div')) {
      if (!matches(label.textContent, 'Facility') || label.closest('table,[role="listbox"]')) continue;
      for (let scope = label.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
        if (complete(scope)) return cachedRoot = scope;
      }
    }
    return cachedRoot = null;
  }
  function selected(el) {
    if (!el) return { name: '', id: '' };
    const option = el.tagName === 'SELECT' ? el.selectedOptions?.[0] || el.querySelector('option:checked') :
      el.querySelector('[aria-selected="true"],[data-selected-value],[class*="singleValue"],[class*="single-value"]');
    let rendered = option;
    // React Select puts its confirmed singleValue next to a nested search input.
    const readonly = el.readOnly || el.hasAttribute('readonly');
    const valueOnly = readonly || el.getAttribute('aria-autocomplete') === 'none';
    if (!rendered && el.tagName === 'INPUT' && !valueOnly) {
      for (let scope = el.parentElement, depth = 0; scope && depth < 4; scope = scope.parentElement, depth++) {
        if (scope.querySelectorAll(widgets).length > 1) break;
        rendered = scope.querySelector('[class*="singleValue"],[class*="single-value"],[data-selected-value]');
        if (rendered || scope.querySelector('label')) break;
      }
    }
    const name = el.dataset.selectedName || rendered?.dataset.name || rendered?.textContent?.trim() ||
      (el.tagName === 'INPUT' ? valueOnly ? el.value : '' : el.textContent?.trim()) || '';
    return { name: /^(select|choose)\b/i.test(name) ? '' : name,
      id: el.dataset.selectedId || rendered?.dataset.id || (el.tagName === 'SELECT' ? el.value : '') || '' };
  }
  function table(scope) {
    return scope?.querySelector('[data-ordercheck-requested-products],[data-testid="requested-products"],table[aria-label="Requested Products"]') ||
      [...(scope?.querySelectorAll('table,[role="table"],[role="grid"]') || [])].find(t => {
        const headers = [...t.querySelectorAll('th,[role="columnheader"]')];
        return headers.some(h => matches(h.textContent, 'Product')) && headers.some(h => matches(h.textContent, 'Quantity'));
      });
  }
  function read() {
    const scope = root();
    if (!scope) return { facility: {}, draft: null, order: [], script: scripts.read(null) };
    const facilityEl = control(scope, 'Facility'), productEl = control(scope, 'Product'), quantityEl = control(scope, 'Quantity');
    const facilitySelection = selected(facilityEl);
    const metadata = (field, attribute) => facilityEl?.dataset[attribute] || (control(scope, field) ? selected(control(scope, field)).name : '') || captionValue(scope, field);
    const facility = { ...facilitySelection, name: facilitySelection.name || captionValue(scope, 'Facility'), district: metadata('District', 'district'), region: metadata('Region', 'region') };
    const product = selected(productEl), requested = table(scope);
    const headers = [...(requested?.querySelectorAll('th,[role="columnheader"]') || [])];
    const productIndex = headers.findIndex(h => matches(h.textContent, 'Product')), quantityIndex = headers.findIndex(h => matches(h.textContent, 'Quantity'));
    const order = requested ? [...requested.querySelectorAll('tbody tr,[data-ordercheck-product-row],[role="row"]')].map(row => {
      const cells = [...row.querySelectorAll('td,[role="cell"],[role="gridcell"]')];
      if (!row.dataset.productName && cells.length === 1 && (Number(cells[0].getAttribute('colspan')) > 1 || /^no requested products\.?$/.test(key(cells[0].textContent)))) return null;
      const productCell = row.querySelector('[data-product-name]') || cells[productIndex];
      const qtyCell = row.querySelector('[data-quantity]') || cells[quantityIndex];
      return { name: row.dataset.productName || productCell?.textContent?.trim() || '', id: row.dataset.productId || '', quantity: row.dataset.quantity || qtyCell?.querySelector('input')?.value || qtyCell?.textContent?.trim() || '' };
    }).filter(p => p?.name) : [];
    return { facility, draft: product.name ? { ...product, quantity: quantityEl?.value || '' } : null, order, script: scripts.read(scope) };
  }
  return { read, root, resetOrder: () => scripts.reset(), isNewOrder: target => { const button = target?.closest('button,[role="button"]'); return !!button && ['add order', 'add new order', 'new order'].includes(key(button.textContent)); }, anchor: () => { const scope = root(); return control(scope, 'Quantity') || control(scope, 'Product'); },
    diagnostics: () => { const scope = root(); return { formFound: !!scope, facilityControl: !!facilityPresent(scope || doc), productControl: !!control(scope || doc, 'Product'), quantityControl: !!control(scope || doc, 'Quantity'), tableFound: !!table(scope) }; },
    isAdd: target => { const scope = root(), button = target?.closest('button,[role="button"]'); return !!(scope && button && scope.contains(button) && key(button.textContent) === 'add'); } };
}
import { createFsScriptReader } from './fs-script.js';
