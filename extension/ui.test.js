import test from 'node:test';
import assert from 'node:assert/strict';
import { setupCatalog } from './catalog.js';
import { setupScreenshots } from './screenshots.js';

// Small DOM fixture for extension event flows; uses no additional runtime dependencies.
class Element {
  value = ''; hidden = false; disabled = false; textContent = ''; children = []; handlers = {};
  addEventListener(type, callback) { this.handlers[type] = callback; }
  async fire(type, extra = {}) { return this.handlers[type]?.({ preventDefault() {}, ...extra }); }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  querySelectorAll() { return this.children.flatMap(child => child.children || []).filter(child => child.type === 'checkbox' && child.checked); }
}
function fixture() {
  const previous = globalThis.document, nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  globalThis.document = { getElementById: get, createElement: () => new Element(), createTextNode: text => ({ textContent: text }) };
  const controls = new Map(); get('catalogForm').elements = { namedItem(name) { if (!controls.has(name)) controls.set(name, new Element()); return controls.get(name); } };
  return { get, control: name => get('catalogForm').elements.namedItem(name), restore() { globalThis.document = previous; } };
}
const product = { id: 'g', name: 'Canonical', scope: 'general', category: 'medicine', aliases: ['C'], contextualAliases: [], note: '', fulfillmentSystemName: 'System Canonical', receivingDetails: 'Received as a box' };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('extension editor honors backend permissions and explicit Gemini review before saving', async () => {
  const dom = fixture(), calls = []; let canEdit = false, updates = 0;
  try {
    setupCatalog({ request: async (endpoint, options) => {
      calls.push({ endpoint, body: options?.body && JSON.parse(options.body) });
      if (endpoint.endsWith('suggest-aliases')) return { suggestions: [{ alias: 'CN', kind: 'abbreviation', requiresContext: true, reason: 'Needs context' }] };
      return { revision: 4, canEdit, products: [product] };
    }, onUpdated: () => updates++ });
    await dom.get('reloadCatalog').fire('click');
    await dom.get('catalogProducts').children[0].fire('click');
    assert.equal(dom.get('catalogFields').disabled, true);
    await dom.get('catalogForm').fire('submit'); assert.equal(calls.length, 1);
    canEdit = true; await dom.get('reloadCatalog').fire('click'); await dom.get('catalogProducts').children[0].fire('click');
    assert.equal(dom.get('catalogFields').disabled, false);
    assert.equal(dom.control('scope').disabled, true);
    dom.control('displayName').value = 'New display';
    await dom.get('suggestCatalogAliases').fire('click');
    assert.equal(updates, 0); assert.equal(calls.at(-1).endpoint, '/api/products/suggest-aliases');
    dom.get('catalogSuggestions').children[0].children[0].checked = true;
    await dom.get('addAliasSuggestions').fire('click');
    assert.equal(dom.control('aliases').value, 'C\nCN'); assert.equal(dom.control('contextualAliases').value, 'CN');
    await dom.get('catalogForm').fire('submit');
    const saved = calls.at(-1).body;
    assert.equal(saved.name, 'Canonical'); assert.equal(saved.displayName, 'New display');
    assert.equal(saved.revision, 4); assert.equal(saved.fulfillmentSystemName, product.fulfillmentSystemName);
    assert.equal(saved.receivingDetails, product.receivingDetails); assert.equal(updates, 1);
  } finally { dom.restore(); }
});

test('screenshot flow preserves edited input and resets uploaded files on account/backend changes', async () => {
  const dom = fixture(), oldReader = globalThis.FileReader; let finish, inputKey = 'before', applied = [];
  globalThis.FileReader = class { readAsDataURL() { this.result = 'data:image/png;base64,eA=='; this.onload(); } };
  try {
    const scans = setupScreenshots({ request: async () => new Promise(resolve => { finish = resolve; }), inputs: () => inputKey, onText: (...args) => applied.push(args) });
    dom.get('whatsappImage').files = [{ type: 'image/png', size: 1 }]; await dom.get('whatsappImage').fire('change');
    const pending = dom.get('whatsappScan').fire('click');
    inputKey = 'edited'; scans.invalidate(); finish({ text: 'Old scan' }); await pending;
    assert.deepEqual(applied, []); assert.match(dom.get('whatsappScanStatus').textContent, /Inputs changed/);
    const next = dom.get('whatsappScan').fire('click'); finish({ text: 'Current scan' }); await next;
    assert.deepEqual(applied, [['whatsapp', 'Current scan']]);
    scans.reset(); assert.equal(dom.get('whatsappScan').disabled, true);
    dom.get('whatsappImage').files = [{ type: 'text/plain', size: 1 }]; await dom.get('whatsappImage').fire('change');
    assert.equal(dom.get('whatsappScan').disabled, true); assert.match(dom.get('whatsappScanStatus').textContent, /PNG/);
  } finally { globalThis.FileReader = oldReader; dom.restore(); }
});
