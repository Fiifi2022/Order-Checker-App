// Read confirmed selections and order rows through field labels, never page-wide text.
export function createFsAdapter(doc) {
  const scripts = createFsScriptReader();
  let cachedRoot;
  const labels = { Facility: ['facility', 'health facility', 'select facility', 'selected facility'], District: ['district'], Region: ['region'], Product: ['product', 'product name', 'select product', 'select a product', 'search products', 'search product'], Quantity: ['quantity', 'qty', 'requested quantity', 'requested qty'] };
  const key = value => String(value || '').replace(/\s+/g, ' ').trim().replace(/[\s*:]+$/, '').toLowerCase();
  const matches = (value, field) => labels[field].includes(key(value));
  // FS uses ordinary inputs with Bootstrap d-none for validation mirrors. They
  // are identities, never the visible React Select search/selection control.
  const widgets = 'input:not([type="hidden"]):not(.d-none):not([hidden]),select,[role="combobox"],[role="spinbutton"],button[aria-haspopup="listbox"],button[aria-haspopup="true"],[role="button"][aria-haspopup="listbox"]';
  const selectedValues = '[class*="singleValue"],[class*="single-value"],[data-selected-value]';
  function confirmedValues(scope) {
    return [...scope.querySelectorAll(`${selectedValues},.notranslate`)].filter(value => {
      if (value.closest('.d-none,[hidden],[role="listbox"],[role="option"],[aria-live]')) return false;
      if (value.matches(selectedValues)) return true;
      // FS renders selected product icons/text directly in React Select's value
      // container, without singleValue. Only accept a sibling of its search
      // input inside the control; menu results and stock badges are excluded.
      return !!value.parentElement?.querySelector('input[id^="react-select-"]') &&
        !!value.parentElement?.closest('[class*="-control"]') && !value.querySelector('input');
    });
  }
  const visibleWidgets = scope => [...scope.querySelectorAll(widgets)].filter(el => !el.closest('.d-none,[hidden]') && !el.matches(':disabled'));
  function captionValue(scope, field) {
    if (!scope) return '';
    const marked = scope.querySelector(`[data-ordercheck-${field.toLowerCase()}]`);
    if (marked) return marked.textContent.trim();
    // FS renders metadata as <p><strong>District:</strong> East Mamprusi</p>.
    for (const label of scope.querySelectorAll('strong,b')) {
      if (!matches(label.textContent, field) || label.closest('table,[role="listbox"]')) continue;
      const fragments = [];
      for (let node = label.nextSibling; node; node = node.nextSibling) {
        if (node.nodeType === 1 && (node.matches('strong,b,label') || node.matches(widgets) || node.querySelector(widgets))) break;
        fragments.push(node.textContent || '');
      }
      const text = fragments.join('').trim();
      if (text && text.length <= 160) return text;
    }
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
      const conflictingLabel = [...container.querySelectorAll('label')].some(other => other !== label && Object.keys(labels).some(field => matches(other.textContent, field)) && key(other.textContent) !== key(label.textContent));
      if (!conflictingLabel) {
        const values = confirmedValues(container);
        if (values.length === 1) return values[0];
      }
      const available = visibleWidgets(container);
      const candidates = available.filter(el => !available.some(other => other !== el && el.contains(other)));
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
    if (target && scope.contains(target) && !target.closest('.d-none,[hidden]') && target.type !== 'hidden') return target.matches(widgets) ? target : target.querySelector(widgets) || target;
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
    for (const el of visibleWidgets(scope)) {
      const name = key(el.getAttribute('name')).replace(/[_-]/g, ' ');
      if (matches(el.getAttribute('aria-label'), field) || matches(name, field) || field === 'Product' && name === 'sku') return el;
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
    const pageProduct = control(doc, 'Product');
    // Facility metadata lives in a different card from Requested Products.
    // Do not cache the facility card as the whole form when Product is outside.
    const suitable = scope => complete(scope) && (!pageProduct || scope.contains(pageProduct));
    if (cachedRoot?.isConnected && suitable(cachedRoot)) return cachedRoot;
    const marked = doc.querySelector('[data-ordercheck-order-form], [data-testid="add-order-form"], [data-testid="new-order-form"]');
    if (marked && facilityPresent(marked) && (!pageProduct || marked.contains(pageProduct))) return cachedRoot = marked;
    const semantic = [...doc.querySelectorAll('form,[role="dialog"],main')].find(suitable);
    if (semantic) return cachedRoot = semantic;
    // React screens often render divs rather than a form or main. Start from a
    // specifically labelled Facility widget and find its smallest shared container.
    const facility = control(doc, 'Facility');
    for (let scope = facility?.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
      if (suitable(scope)) return cachedRoot = scope;
    }
    for (const label of doc.querySelectorAll('label,dt,span,p,div')) {
      if (!matches(label.textContent, 'Facility') || label.closest('table,[role="listbox"]')) continue;
      for (let scope = label.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
        if (suitable(scope)) return cachedRoot = scope;
      }
    }
    // A missing/unrecognized Facility control must not hide a confirmed product
    // and its connection status. Scope this fallback to an actual entry row;
    // never infer a facility from unrelated text elsewhere on the page.
    const product = pageProduct, quantity = control(doc, 'Quantity');
    for (let scope = product?.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
      if (quantity && scope.contains(quantity) && [...scope.querySelectorAll('button,[role="button"]')].some(button => key(button.textContent) === 'add')) return scope;
    }
    return cachedRoot = null;
  }
  function selected(el) {
    if (!el) return { name: '', id: '' };
    const option = el.matches(selectedValues) || el.matches('.notranslate') && confirmedValues(el.parentElement).includes(el) ? el : el.tagName === 'SELECT' ? el.selectedOptions?.[0] || el.querySelector('option:checked') :
      confirmedValues(el)[0];
    let rendered = option;
    // React Select puts its confirmed singleValue next to a nested search input.
    const readonly = el.readOnly || el.hasAttribute('readonly');
    const valueOnly = readonly || el.getAttribute('aria-autocomplete') === 'none';
    if (!rendered && el.tagName === 'INPUT') {
      for (let scope = el.parentElement, depth = 0; scope && depth < 4; scope = scope.parentElement, depth++) {
        if (visibleWidgets(scope).filter(widget => widget !== el && !widget.contains(el)).length) break;
        rendered = confirmedValues(scope)[0];
        if (rendered || scope.querySelector('label')) break;
      }
    }
    const field = el.closest('.form-group') || el.parentElement;
    const hidden = field?.querySelector('input[name="sku"],input[name="facility"],input[name="facilityId"]');
    // Some FS React Select builds emit only hashed classes for singleValue.
    // A nonempty identity mirror plus a unique rendered sibling confirms the
    // value. Never use typed input, screen-reader announcements or menu options.
    if (!rendered && el.tagName === 'INPUT' && hidden !== el && hidden?.value) {
      let branch = el;
      for (let scope = el.parentElement, depth = 0; scope && field?.contains(scope) && depth < 4; branch = scope, scope = scope.parentElement, depth++) {
        if (scope.closest('[role="listbox"]')) break;
        const values = [...scope.children].filter(peer => peer !== branch &&
          !peer.matches('label,input,button,[aria-live],[aria-hidden="true"],[role="option"],.invalid-feedback,.d-none,[hidden],[class*="placeholder"],[class*="a11yText"]') &&
          !peer.querySelector('input,button,[role="option"],[aria-live]') && peer.textContent.trim() && !/^(select|choose)\b/i.test(peer.textContent.trim()));
        if (values.length === 1) { rendered = values[0]; break; }
        if (values.length > 1 || scope === field) break;
      }
    }
    const name = el.dataset.selectedName || rendered?.dataset.name || rendered?.textContent?.trim() ||
      (el.tagName === 'INPUT' ? valueOnly ? el.value : '' : el.textContent?.trim()) || '';
    return { name: /^(select|choose)\b/i.test(name) ? '' : name,
      id: el.dataset.selectedId || rendered?.dataset.id || hidden?.value || (el.tagName === 'SELECT' ? el.value : '') || '' };
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
    // Facility selection is independently useful before Requested Products
    // mounts, and may be outside its form (React portals / separate forms).
    const facilityEl = control(scope, 'Facility') || control(doc, 'Facility');
    let facilityScope = !facilityEl || scope?.contains(facilityEl) ? scope : null;
    if (!facilityScope && facilityEl) {
      facilityScope = facilityEl.closest('.form-group') || facilityEl.parentElement;
      for (let parent = facilityScope; parent && parent !== doc.documentElement; parent = parent.parentElement) {
        if (captionValue(parent, 'District') || captionValue(parent, 'Region')) { facilityScope = parent; break; }
      }
    }
    const productEl = control(scope, 'Product'), quantityEl = control(scope, 'Quantity');
    const facilitySelection = selected(facilityEl);
    const metadata = (field, attribute) => facilityEl?.dataset[attribute] || (control(facilityScope, field) ? selected(control(facilityScope, field)).name : '') || captionValue(facilityScope, field);
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
  function productPlacement() {
    const scope = root(), product = control(scope, 'Product'), quantity = control(scope, 'Quantity');
    if (!product || !quantity) return null;
    // FS's unlinked Product label sits above an existing flex input-group.
    // Insert inside that group, immediately after the React Select container,
    // preserving the label and any validation feedback beneath the input.
    const inputGroup = product.closest('.input-group'), field = inputGroup?.closest('.form-group');
    if (inputGroup && field && [...field.querySelectorAll('label')].some(label => matches(label.textContent, 'Product')) &&
      !inputGroup.contains(quantity) && field.parentElement?.contains(quantity)) {
      let select = product;
      while (select.parentElement && select.parentElement !== inputGroup) select = select.parentElement;
      if (select.parentElement === inputGroup && !inputGroup.querySelector('table')) return { group: select, row: inputGroup };
    }
    // Use the smallest field group containing the product and its label, without
    // borrowing Quantity or moving/replacing React-managed controls.
    let group = product;
    for (let parent = group.parentElement; parent && parent !== scope && !parent.contains(quantity); parent = parent.parentElement) group = parent;
    const row = group.parentElement;
    if (!row?.contains(quantity) || row === doc.body || row === doc.documentElement || row.querySelector('table,[role="table"],section') || row.contains(control(scope, 'Facility'))) return null;
    return { group, row };
  }
  function inspect() {
    const describe = el => el ? { tag: el.tagName, id: el.id, class: String(el.className || '').slice(0, 200), name: el.getAttribute('name'), type: el.getAttribute('type') } : null;
    const scope = root();
    return {
      scope: describe(scope),
      fields: ['Facility', 'Product', 'Quantity'].map(field => {
        const globalControl = control(doc, field), scopedControl = control(scope, field);
        return { field, globalControl: describe(globalControl), scopedControl: describe(scopedControl),
          selected: field !== 'Quantity' ? selected(globalControl).name.slice(0, 160) : undefined,
          labels: [...doc.querySelectorAll('label,span,p,div')].filter(el => matches(el.textContent, field) && !el.querySelector(widgets)).slice(0, 6).map(label => ({ label: describe(label),
            ancestors: [label.parentElement, label.parentElement?.parentElement, label.parentElement?.parentElement?.parentElement].map(describe),
          })) };
      }),
      frameCount: doc.querySelectorAll('iframe').length,
    };
  }
  return { read, root, productPlacement, resetOrder: () => scripts.reset(), isNewOrder: target => { const button = target?.closest('button,[role="button"]'); return !!button && ['add order', 'add new order', 'new order'].includes(key(button.textContent)); }, anchor: () => { const scope = root(); return control(scope, 'Quantity') || control(scope, 'Product'); },
    inspect,
    diagnostics: () => { const scope = root(); return { formFound: !!scope || !!control(doc, 'Facility'), facilityControl: !!facilityPresent(scope) || !!facilityPresent(doc), productControl: !!control(scope || doc, 'Product'), quantityControl: !!control(scope || doc, 'Quantity'), tableFound: !!table(scope) }; },
    isAdd: target => { const scope = root(), button = target?.closest('button,[role="button"]'); return !!(scope && button && scope.contains(button) && key(button.textContent) === 'add'); } };
}
import { createFsScriptReader } from './fs-script.js';
