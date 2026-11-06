import {PRODUCTION_BACKEND_URL} from '../extension/backend-target.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { readFile } from 'node:fs/promises';
import { buildExtensionPackage, extensionAssets, resolveExtensionBackendUrl } from './extensionPackage';

test('downloaded companion includes every module and only the selected public connection config', async () => {
  const zip = new AdmZip(await buildExtensionPackage('http://localhost:3000', 'public-browser-key'));
  const names = zip.getEntries().map(entry => entry.entryName);
  assert.deepEqual(new Set(names), new Set([...extensionAssets, 'config.js']));
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.equal(manifest.version, '2.3.64');
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.match(zip.readAsText('sidepanel.html'), /<details class="fs-connection-check" aria-label="FS connection"/);
  assert.match(zip.readAsText('sidepanel.html'), /<details[^>]*aria-label="FS connection"[^>]*\bhidden\b[^>]*display:none/);
  assert.ok(manifest.host_permissions.includes('https://fulfillment-gh2-production.platform.flyzipline.com/*'));
  for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_page, ...Object.values(manifest.icons) as string[]]) {
    assert.ok(names.includes(file), `Missing manifest asset ${file}`);
  }
  assert.ok(zip.readAsText('config.js').includes(PRODUCTION_BACKEND_URL));
  assert.doesNotMatch(zip.readAsText('config.js'), /localhost|onrender/);
  assert.match(zip.readAsText('config.js'), /public-browser-key/);
  assert.match(zip.readAsText('config.js'), /fulfillment-gh3-production/);
  assert.ok(JSON.parse(zip.readAsText('manifest.json')).host_permissions.includes('https://fulfillment-gh3-production.platform.flyzipline.com/*'));
  for (const name of names.filter(name => name.endsWith('.js'))) {
    for (const match of zip.readAsText(name).matchAll(/from ['"]\.\/([^'"]+)['"]/g)) assert.ok(names.includes(match[1]), `Missing module ${match[1]}`);
  }
  assert.ok(!names.some(name => /test|env|firebase-applet/.test(name)));
  assert.match(zip.readAsText('popup.html'), /receivingDetails/);
  assert.match(zip.readAsText('popup.html'), /Check allocation status/);
  assert.ok(!zip.readAsText('popup.html').includes('id="fulfilmentDialog"'));
  for (const name of extensionAssets.filter(name => name !== 'manifest.json')) {
    assert.deepEqual(zip.readFile(name), await readFile(new URL('../extension/' + name, import.meta.url)), `Download must contain the current workspace ${name}`);
  }
  for (const name of names.filter(name => /\.(html|css)$/.test(name))) {
    for (const match of zip.readAsText(name).matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      if (/^(?:https?:|data:|#)/.test(match[1])) continue;
      assert.ok(names.includes(match[1].replace(/^\.\//, '').split(/[?#]/)[0]), `Missing asset ${match[1]} in ${name}`);
    }
  }
});

test('extension packages always use production despite old URLs, local downloads or environment overrides', async () => {
  for (const settings of [{}, {host:'localhost:3000'}, {appUrl:'http://localhost:3000'},
    {appUrl:'https://old.onrender.com', railwayDomain:'different.up.railway.app'},
    {appUrl:'https://unrelated.example', host:'other.example'}]) {
    assert.equal(resolveExtensionBackendUrl(settings), PRODUCTION_BACKEND_URL);
  }
  for (const input of ['http://localhost:3000', 'https://old.onrender.com', 'https://unrelated.example']) {
    const zip = new AdmZip(await buildExtensionPackage(input, 'public-browser-key'));
    assert.ok(zip.readAsText('config.js').includes(PRODUCTION_BACKEND_URL));
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    assert.ok(manifest.host_permissions.includes(PRODUCTION_BACKEND_URL + '/*'));
    assert.ok(!manifest.host_permissions.includes(input + '/*'));
  }
});
