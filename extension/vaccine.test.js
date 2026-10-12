import test from 'node:test';
import assert from 'node:assert/strict';
import { auditVaccineOrder, commitVaccineOrder, getDeductionStatus } from './vaccine-api.js';
import { auditedFulfillmentItems } from './vaccine-display.js';
import { setupVaccines } from './vaccine.js';
const approved = { allMatch: true, isValid: true, orderId: 'verified', facilityId: 'clinic', canCommit: true, auditStatus: 'passed', allocationStatus: 'ready',
  items: [{ vaccine: 'IPV', fsQty: 3, remainingBefore: 10, remainingAfter: 7, status: 'valid' }], errors: [], warnings: [] };
const saved = { success: true, orderId: 'verified', facilityId: 'clinic', allocationStatus: 'deducted', transaction: { id: 'verified', items: [{ vaccine: 'IPV', currentOrder: 3, remainingAfter: 7 }] }, updatedFacility: { id: 'clinic' } };
class Element {
  value = ''; hidden = false; disabled = false; textContent = ''; children = []; handlers = {}; dataset = {};
  get options() { return this.children; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  fire(type) { return this.handlers[type]?.(); }
  replaceChildren() { this.children = []; }
  append(...children) { this.children.push(...children); }
}
function fixture(request) {
  const previous = globalThis.document, elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  globalThis.document = { getElementById: get, createElement: () => new Element() };
  get('auditMode').value = 'general';
  let source = { whatsappMessage: 'IPV 3', fulfillmentConfirmation: 'Facility: Clinic\nIPV 3' };
  const ui = setupVaccines({ request, inputs: () => source, results: get('results'), onChanged() {} });
  return { get, ui, setSource(value) { source = value; ui.invalidate(); }, restore() { globalThis.document = previous; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function select(dom, mode = 'fulfillment_only') {
  dom.get('auditMode').value = mode; dom.get('auditMode').fire('change'); await settle(); dom.get('vaccineFacility').value = 'clinic';
}
test('API uses the verified reference without an extra authorization flag and retains validation/receipt guards', async () => {
  for (const mode of ['whatsapp_and_fulfillment', 'customer_fulfillment', 'fulfillment_only']) {
    const calls = [];
    const request = async (path, options) => { calls.push({ path, body: JSON.parse(options.body) }); return path.endsWith('commit') ? saved : approved; };
    const audit = await auditVaccineOrder(request, { mode, facilityId: 'clinic', whatsappMessage: 'IPV 3', fulfillmentConfirmation: 'Facility: Clinic\nIPV 3' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.auditMode, mode === 'fulfillment_only' ? mode : 'whatsapp_and_fulfillment');
    assert.equal(calls[0].body.whatsappMessage, mode === 'fulfillment_only' ? '' : 'IPV 3');
    await commitVaccineOrder(request, audit);
    assert.deepEqual(calls[1].body, { orderId: 'verified', facilityId: 'clinic' });
    await assert.rejects(commitVaccineOrder(request, { ...audit, allMatch: false }), /required audit checks/);
    await assert.rejects(commitVaccineOrder(async () => ({ ...saved, orderId: 'different' }), audit), error => error.allocationPending === true);
  }
  await assert.rejects(getDeductionStatus(async () => ({ ...saved, transaction: { id: 'different' } }), approved), error => error.allocationPending === true);
});
test('manual audit updates allocation in both vaccine modes without a dialog and blocks repeated submissions', async () => {
  for (const mode of ['whatsapp_and_fulfillment', 'fulfillment_only']) {
    let commits = 0, complete;
    const dom = fixture(async (path, options) => {
      if (path.endsWith('facilities')) return [{ id: 'clinic' }];
      if (path.endsWith('commit')) { commits++; assert.deepEqual(JSON.parse(options.body), { orderId: 'verified', facilityId: 'clinic' }); return new Promise(resolve => { complete = resolve; }); }
      return approved;
    });
    try {
      assert.equal(dom.get('btnVerify').textContent, 'Analyze For Discrepancies');
      await select(dom, mode); assert.equal(dom.get('btnVerify').textContent, 'Audit & Update Allocation');
      assert.equal(commits, 0);
      const pending = dom.ui.verify(); await settle();
      assert.equal(commits, 1); assert.equal(dom.get('allocationStatus').textContent, 'Processing deduction');
      await dom.ui.verify(); await dom.get('confirmAllocation').fire('click'); assert.equal(commits, 1);
      complete(saved); await pending;
      assert.equal(dom.get('allocationStatus').textContent, 'Successfully deducted');
      assert.equal(dom.get('confirmAllocation').hidden, true); assert.match(dom.get('deductionReceipt').textContent, /Transaction: verified/);
    } finally { dom.restore(); }
  }
});
test('failed and review-only audits never update allocations', async () => {
  for (const data of [{ ...approved, allMatch: false, isValid: false, canCommit: false, auditStatus: 'failed' }, { ...approved, canCommit: false, canAuthorize: false }]) {
    let commits = 0;
    const dom = fixture(async path => {
      if (path.endsWith('facilities')) return [{ id: 'clinic' }];
      if (path.endsWith('commit')) { commits++; return saved; }
      return data;
    });
    try { await select(dom); await dom.ui.verify(); await dom.get('confirmAllocation').fire('click'); assert.equal(commits, 0); assert.equal(dom.get('confirmAllocation').hidden, true); }
    finally { dom.restore(); }
  }
});
test('lost response retrieves the original receipt without a second deduction', async () => {
  let commits = 0, lookups = 0;
  const dom = fixture(async path => {
    if (path.endsWith('facilities')) return [{ id: 'clinic' }];
    if (path.includes('/commit/')) { lookups++; return saved; }
    if (path.endsWith('commit')) { commits++; throw new Error('Timeout after saving'); }
    return approved;
  });
  try {
    await select(dom); await dom.ui.verify(); assert.equal(dom.get('allocationStatus').textContent, 'Successfully deducted');
    await dom.get('confirmAllocation').fire('click'); assert.equal(commits, 1); assert.equal(lookups, 1);
    assert.equal(dom.get('allocationStatus').textContent, 'Successfully deducted');
  } finally { dom.restore(); }
});
test('status checking after a rejected write never resubmits the deduction', async () => {
  let commits = 0; const ids = [];
  const dom = fixture(async (path, options) => {
    if (path.endsWith('facilities')) return [{ id: 'clinic' }];
    if (path.includes('/commit/')) return { orderId: 'verified', facilityId: 'clinic', allocationStatus: 'awaiting_confirmation' };
    if (path.endsWith('commit')) { ids.push(JSON.parse(options.body).orderId); if (++commits === 1) { const error = new Error('Your role does not permit this action.'); error.status = 403; throw error; } return saved; }
    return approved;
  });
  try {
    await select(dom); await dom.ui.verify(); assert.equal(dom.get('allocationStatus').textContent, 'Authorization denied');
    assert.equal(dom.get('deductionReceipt').hidden, true);
    await dom.get('confirmAllocation').fire('click'); assert.deepEqual(ids, ['verified']);
    assert.equal(dom.get('allocationStatus').textContent, 'Allocation status pending verification');
  } finally { dom.restore(); }
});
test('a stale audit cannot trigger allocation deduction', async () => {
  let commits = 0, complete;
  const dom = fixture(async path => {
    if (path.endsWith('facilities')) return [{ id: 'clinic' }];
    if (path.endsWith('commit')) { commits++; return saved; }
    return new Promise(resolve => { complete = resolve; });
  });
  try {
    await select(dom); const pending = dom.ui.verify(); dom.setSource({ fulfillmentConfirmation: 'Changed order' }); complete(approved); await pending;
    assert.equal(commits, 0); assert.equal(dom.get('confirmAllocation').hidden, true);
  } finally { dom.restore(); }
});

test('deduction uses the returned verification reference rather than the external FS order ID', async () => {
  for (const field of ['verificationId', 'auditId', 'auditLogId']) {
    const data = { ...approved, orderId: 'FS-SHIPMENT-42', [field]: 'verified' };
    const audit = await auditVaccineOrder(async () => data, { mode: 'fulfillment_only', facilityId: 'clinic', fulfillmentConfirmation: 'Facility: Clinic\nIPV 3' });
    assert.equal(audit.orderId, 'verified');
    await commitVaccineOrder(async (_path, options) => {
      assert.equal(JSON.parse(options.body).orderId, 'verified'); return saved;
    }, audit);
  }
  let writes = 0;
  await assert.rejects(commitVaccineOrder(async () => { writes++; return saved; }, { ...approved, verificationId: '../bad' }), /verification reference/);
  assert.equal(writes, 0);
});

test('a matching confirmed transaction is accepted without incompatible wrapper fields', async () => {
  let lookups = 0;
  const receipt = { transaction: { ...saved.transaction, status: 'confirmed', facilityId: 'clinic' } };
  const result = await commitVaccineOrder(async path => { if (path.includes('/commit/')) lookups++; return receipt; }, approved);
  assert.equal(result.allocationStatus, 'deducted'); assert.equal(lookups, 0);
});

test('incompatible commit response is independently verified with GET only; unresolved status stays neutral', async () => {
  for (const outcome of ['confirmed', 'unknown', 'awaiting']) {
    const calls = [];
    const dom = fixture(async (path, options) => {
      if (path.endsWith('facilities')) return [{ id: 'clinic' }];
      if (path.endsWith('commit')) { calls.push(options.method); return { success: true }; }
      if (path.includes('/commit/')) {
        calls.push(options?.method || 'GET');
        if (outcome === 'confirmed') return saved;
        if (outcome === 'awaiting') return { allocationStatus: 'awaiting_confirmation', orderId: 'verified', facilityId: 'clinic' };
        throw new Error('Lookup unavailable');
      }
      return approved;
    });
    try {
      await select(dom); await dom.ui.verify();
      assert.deepEqual(calls, ['POST', 'GET']);
      if (outcome === 'confirmed') {
        assert.equal(dom.get('allocationStatus').textContent, 'Successfully deducted');
        assert.equal(dom.get('confirmAllocation').hidden, true);
        assert.ok(!dom.get('results').children.some(row => /unavailable|did not confirm|pending verification/.test(row.textContent)));
      } else {
        assert.equal(dom.get('allocationStatus').textContent, 'Allocation status pending verification');
        assert.equal(dom.get('deductionReceipt').hidden, true);
        await dom.get('confirmAllocation').fire('click');
        assert.deepEqual(calls, ['POST', 'GET', 'GET']);
      }
    } finally { dom.restore(); }
  }
});

test('both modes display only current FS products and their relevant companions, retaining missing-pair errors', async () => {
  const items = [
    { vaccine: 'OPV', fsQty: 3, fsPresent: true }, { vaccine: 'OPV Dropper', fsQty: 3, fsPresent: true },
    { vaccine: 'BCG', fsQty: 2, fsPresent: true }, { vaccine: 'BCG Diluent', fsQty: 0, status: 'missing_companion' },
    { vaccine: 'IPV', fsQty: 0, status: 'not_in_order' }, { vaccine: 'MR', fsQty: 0 }, { vaccine: 'MR Diluent', fsQty: 0 },
    { vaccine: 'Rota', fsQty: 0 }, { vaccine: 'Rota Dropper', fsQty: 0 }
  ];
  assert.deepEqual(auditedFulfillmentItems(items).map(item => item.vaccine), ['OPV', 'OPV Dropper', 'BCG', 'BCG Diluent']);
  assert.equal(items.length, 9, 'Display filtering must not mutate the validation matrix.');
  assert.deepEqual(auditedFulfillmentItems([{ vaccine: 'IPV', fsQty: 0, fsPresent: true }]).map(item => item.vaccine), ['IPV']);
  for (const mode of ['whatsapp_and_fulfillment', 'fulfillment_only']) {
    const dom = fixture(async path => path.endsWith('facilities') ? [{ id: 'clinic' }] : {
      ...approved, items, canCommit: false, allMatch: false, isValid: false, errors: ['BCG Diluent is required.']
    });
    try {
      await select(dom, mode); await dom.ui.verify();
      const display = dom.get('results').children.map(row => row.textContent).join('\n');
      assert.match(display, /OPV: supplied 3/); assert.match(display, /OPV Dropper: supplied 3/);
      assert.match(display, /BCG Diluent is required/);
      assert.ok(!/IPV:|MR:|MR Diluent:|Rota:|Rota Dropper:/.test(display));
    } finally { dom.restore(); }
  }
});

test('successful receipts do not restore unrelated Blueprint products in either mode', async () => {
  for (const mode of ['whatsapp_and_fulfillment', 'fulfillment_only']) {
    const dom = fixture(async path => path.endsWith('facilities') ? [{ id: 'clinic' }] : path.endsWith('commit') ? saved : {
      ...approved, items: [...approved.items, { vaccine: 'BCG', fsQty: 0 }, { vaccine: 'BCG Diluent', fsQty: 0 }, { vaccine: 'OPV', fsQty: 0 }, { vaccine: 'OPV Dropper', fsQty: 0 }]
    });
    try {
      await select(dom, mode); await dom.ui.verify();
      const display = dom.get('results').children.map(row => row.textContent).join('\n');
      assert.match(display, /IPV: supplied 3/); assert.match(display, /IPV: deducted 3; remaining 7/);
      assert.ok(!/BCG:|BCG Diluent:|OPV:|OPV Dropper:/.test(display));
      assert.equal(dom.get('allocationStatus').textContent, 'Successfully deducted');
    } finally { dom.restore(); }
  }
});

test('a receipt returned with the audit prevents another commit despite incompatible eligibility flags', async () => {
  let commits = 0;
  const dom = fixture(async path => {
    if (path.endsWith('facilities')) return [{ id: 'clinic' }];
    if (path.endsWith('commit')) { commits++; return saved; }
    return { ...approved, transaction: { ...saved.transaction, status: 'confirmed', facilityId: 'clinic' } };
  });
  try {
    await select(dom); await dom.ui.verify();
    assert.equal(commits, 0); assert.equal(dom.get('allocationStatus').textContent, 'Already deducted');
    assert.equal(dom.get('confirmAllocation').hidden, true);
  } finally { dom.restore(); }
});

test('live FS matching selects the loaded Blueprint facility, clears stale matches and never deducts', async () => {
  const gbangu = { id: 'north-east:gbangu', facilityName: 'Gbangu CHPS', district: 'East Mamprusi', region: 'North East', cycle: 'October 2026' };
  let records = [gbangu];
  const paths = [];
  const dom = fixture(async path => { paths.push(path); assert.equal(path, '/api/vaccine/companion/facilities'); return records; });
  try {
    dom.ui.setFsFacility(gbangu);
    await dom.ui.loadFacilities();
    assert.equal(dom.get('vaccineFacility').value, gbangu.id);
    dom.ui.setFsFacility({ ...gbangu, id: 'unknown', facilityName: 'Other CHPS' });
    assert.equal(dom.get('vaccineFacility').value, '');
    records = [gbangu, { ...gbangu, id: 'other-cycle:gbangu' }];
    dom.ui.setFsFacility({ ...gbangu, id: '' });
    await dom.ui.loadFacilities();
    assert.equal(dom.get('vaccineFacility').value, '', 'Ambiguous facility/cycle names require explicit matching.');
    dom.ui.setFsFacility(gbangu);
    assert.equal(dom.get('vaccineFacility').value, gbangu.id);
    dom.ui.setFsFacility(null);
    assert.equal(dom.get('vaccineFacility').value, '');
    assert.equal(paths.length, 2);
  } finally { dom.restore(); }
});
