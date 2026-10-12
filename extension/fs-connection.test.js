import test from 'node:test';
import assert from 'node:assert/strict';
import { connectFsTab, findFsTab } from './fs-connection.js';

const origin = 'https://fulfillment-gh1-production.platform.flyzipline.com';
const tab = { id: 7, url: `${origin}/v3/orders/Draft` };
const diagnostics = { formFound: true, facilityControl: true, bridgeVersion: '1.5.14' };
const state = { success: true };
function mock({ connected = true, permitted = true, current = tab, active = tab, candidates = [tab] } = {}) {
  const calls = [];
  const api = {
    runtime: { getManifest: () => ({ content_scripts: [{ js: ['fs-content.js'], matches: [`${origin}/*`] }] }) },
    tabs: {
      query: async query => query.active ? [active] : candidates,
      get: async () => current,
      sendMessage: async (id, message) => {
        calls.push([id, message.type]);
        if (message.type === 'FS_DIAGNOSTICS') {
          if (!connected) throw new Error('Receiving end does not exist');
          return diagnostics;
        }
        return state;
      },
    },
    permissions: { contains: async () => permitted },
    scripting: { executeScript: async request => { calls.push(request); connected = true; } },
  };
  return { api, calls };
}

test('connected FS refreshes without injecting another bridge', async () => {
  const { api, calls } = mock();
  assert.deepEqual(await connectFsTab(api), { tabId: tab.id, origin, details: diagnostics, state });
  assert.deepEqual(calls, [[7, 'FS_DIAGNOSTICS'], [7, 'FS_REFRESH']]);
});

test('repair injects into the selected permitted FS tab and verifies the bridge', async () => {
  const { api, calls } = mock({ connected: false });
  assert.equal((await connectFsTab(api, { repair: true })).details.formFound, true);
  assert.deepEqual(calls, [[7, 'FS_DIAGNOSTICS'], { target: { tabId: 7 }, files: ['fs-content.js'] }, [7, 'FS_DIAGNOSTICS'], [7, 'FS_REFRESH']]);
});

test('diagnostics alone do not inject a missing bridge', async () => {
  const { api, calls } = mock({ connected: false });
  await assert.rejects(connectFsTab(api), /Click Connect to FS/);
  assert.deepEqual(calls, [[7, 'FS_DIAGNOSTICS']]);
});

test('repair refuses withheld permissions and navigation away from FS', async () => {
  for (const options of [{ permitted: false }, { current: { ...tab, url: 'https://example.com/' } }]) {
    const { api, calls } = mock({ connected: false, ...options });
    await assert.rejects(connectFsTab(api, { repair: true }), /withheld access|left FS/);
    assert.deepEqual(calls, [[7, 'FS_DIAGNOSTICS']]);
  }
});

test('tab discovery requires an unambiguous FS tab unless FS is focused', async () => {
  const { api } = mock({ active: { id: 1, url: 'https://example.com/' }, candidates: [tab, { ...tab, id: 8 }] });
  await assert.rejects(findFsTab(api, [origin]), /More than one FS tab/);
  const single = mock({ active: { id: 1, url: 'https://example.com/' } });
  assert.deepEqual(await findFsTab(single.api, [origin]), tab);
  const none = mock({ active: {}, candidates: [] });
  await assert.rejects(findFsTab(none.api, [origin]), /FS tab not found/);
});
