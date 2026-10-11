const key = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/(?<=[a-z])-(?=[a-z])/g, ' ').replace(/\s+/g, ' ').trim();
const lines = value => value.split('\n').map(value => value.trim()).filter(Boolean);
export function initialLinkedProductId(product, products) {
  if (product.linkedProductId !== undefined) return product.linkedProductId;
  const matches = products.filter(other => other.scope !== product.scope && (key(other.name) === key(product.name) ||
    (product.scope === 'vaccine' && other.aliases.some(alias => key(alias) === key(product.name))) ||
    (other.scope === 'vaccine' && product.aliases.some(alias => key(alias) === key(other.name)))));
  return matches.length === 1 ? matches[0].id : '';
}
export function catalogDraft(product, values, revision) {
  return { ...product, id: product.id || undefined, name: product.id ? product.name : values.displayName.trim(),
    displayName: values.displayName, scope: values.scope, category: values.category, aliases: lines(values.aliases),
    contextualAliases: values.scope === 'general' ? lines(values.contextualAliases) : [], note: values.note,
    fulfillmentSystemName: values.fulfillmentSystemName, receivingDetails: values.receivingDetails,
    linkedProductId: values.linkedProductId, revision };
}
export function setupCatalog({ request, onUpdated }) {
  const $ = id => document.getElementById(id);
  const panel = $('catalogPanel'), form = $('catalogForm'), fields = $('catalogFields'), status = $('catalogStatus');
  let catalog = null, product = null, busy = false;
  const names = ['displayName', 'scope', 'category', 'aliases', 'contextualAliases', 'note', 'fulfillmentSystemName', 'receivingDetails', 'linkedProductId'];
  const control = name => form.elements.namedItem(name);
  const values = () => Object.fromEntries(names.map(name => [name, control(name).value]));
  const message = value => { status.textContent = value; };
  const clearSuggestions = () => { $('catalogSuggestions').replaceChildren(); $('addAliasSuggestions').hidden = true; };
  const setBusy = value => {
    busy = value; fields.disabled = value || !catalog?.canEdit;
    $('reloadCatalog').disabled = value; $('addCatalogProduct').disabled = value || !catalog?.canEdit;
  };
  const renderList = () => {
    const search = $('catalogSearch').value.toLowerCase(), scope = $('catalogScope').value;
    const list = $('catalogProducts'); list.replaceChildren();
    for (const entry of catalog?.products || []) {
      if (scope && entry.scope !== scope) continue;
      if (![entry.displayName || entry.name, entry.name, entry.fulfillmentSystemName || '', ...entry.aliases].some(value => value.toLowerCase().includes(search))) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'catalog-product';
      button.textContent = `${entry.displayName || entry.name} (${entry.scope === 'vaccine' ? 'Vaccine' : 'General'})`;
      button.disabled = busy; button.addEventListener('click', () => edit(entry)); list.append(button);
    }
  };
  const edit = entry => {
    if (busy) return;
    product = entry; form.hidden = false; clearSuggestions(); message(catalog.canEdit ? '' : 'Read only. Administrator, Warehouse, and Compliance can edit.');
    const initial = { ...entry, displayName: entry.displayName || entry.name,
      aliases: entry.aliases.join('\n'), contextualAliases: entry.contextualAliases.join('\n'),
      linkedProductId: initialLinkedProductId(entry, catalog.products) };
    const sync = control('linkedProductId'); sync.replaceChildren();
    const option = (value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; sync.append(node); };
    option('', 'This checker only');
    for (const other of catalog.products.filter(other => other.scope !== entry.scope)) option(other.id, other.displayName || other.name);
    for (const name of names) control(name).value = initial[name] || '';
    control('scope').disabled = !!entry.id;
    $('catalogContextLabel').hidden = entry.scope !== 'general';
    $('saveCatalogProduct').hidden = !catalog.canEdit; $('suggestCatalogAliases').hidden = !catalog.canEdit;
    setBusy(false);
  };
  const load = async () => {
    if (busy) return;
    setBusy(true); message('Loading catalog…');
    try { catalog = await request('/api/products'); product = null; form.hidden = true; clearSuggestions();
      message(catalog.canEdit ? 'Select a product to edit or request aliases.' : 'Browse only. Administrator, Warehouse, and Compliance can edit.');
    } catch (error) { catalog = null; product = null; form.hidden = true; message(error.message); }
    finally { setBusy(false); renderList(); }
  };
  $('openCatalog').addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) void load(); });
  $('closeCatalog').addEventListener('click', () => { if (!busy) panel.hidden = true; });
  $('reloadCatalog').addEventListener('click', load);
  $('catalogSearch').addEventListener('input', renderList); $('catalogScope').addEventListener('change', renderList);
  $('addCatalogProduct').addEventListener('click', () => edit({ id: '', scope: 'general', name: '', category: 'medicine', aliases: [], contextualAliases: [], note: '' }));
  control('scope').addEventListener('change', () => { const current = values(); edit({ ...catalogDraft(product, current, catalog.revision), id: '', linkedProductId: '' }); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !catalog?.canEdit || !product) return;
    const draft = catalogDraft(product, values(), catalog.revision); setBusy(true); message('Saving…');
    try { catalog = await request('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      product = null; form.hidden = true; clearSuggestions(); message('Saved. Matching aliases and receiving details are available to the app and extension.'); onUpdated();
    } catch (error) { message(error.message); }
    finally { setBusy(false); renderList(); }
  });
  $('suggestCatalogAliases').addEventListener('click', async () => {
    if (busy || !catalog?.canEdit || !product) return;
    const draft = catalogDraft(product, values(), catalog.revision); setBusy(true); clearSuggestions(); message('Requesting Gemini suggestions…');
    try {
      const data = await request('/api/products/suggest-aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      for (const suggestion of data.suggestions) {
        const label = document.createElement('label'), box = document.createElement('input'); box.type = 'checkbox'; box.suggestion = suggestion;
        label.append(box, document.createTextNode(`${suggestion.alias} (${suggestion.kind}${suggestion.requiresContext ? ', needs context' : ''}) — ${suggestion.reason}`));
        $('catalogSuggestions').append(label);
      }
      $('addAliasSuggestions').hidden = !data.suggestions.length;
      message(data.suggestions.length ? 'Select suggestions, add them to the draft, then save.' : 'No additional reliable aliases found.');
    } catch (error) { message(error.message); }
    finally { setBusy(false); }
  });
  $('addAliasSuggestions').addEventListener('click', () => {
    const selected = [...$('catalogSuggestions').querySelectorAll('input:checked')].map(box => box.suggestion);
    control('aliases').value = [...new Set([...lines(control('aliases').value), ...selected.map(row => row.alias)])].join('\n');
    control('contextualAliases').value = [...new Set([...lines(control('contextualAliases').value), ...selected.filter(row => row.requiresContext).map(row => row.alias)])].join('\n');
    clearSuggestions(); message('Suggestions added to draft. Save product to publish.');
  });
  return { reset() { catalog = null; product = null; panel.hidden = true; form.hidden = true; clearSuggestions(); renderList(); message(''); setBusy(false); } };
}
