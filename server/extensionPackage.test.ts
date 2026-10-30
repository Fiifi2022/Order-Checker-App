import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { readFile } from 'node:fs/promises';
import { buildExtensionPackage, extensionAssets } from './extensionPackage';

test('downloaded companion includes every module and only the selected public connection config', async () => {
  const zip = new AdmZip(await buildExtensionPackage('http://localhost:3000', 'public-browser-key'));
  const names = zip.getEntries().map(entry => entry.entryName);
  assert.deepEqual(new Set(names), new Set([...extensionAssets, 'config.js']));
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.equal(manifest.version, '2.3.47');
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.match(zip.readAsText('sidepanel.html'), /<details class="fs-connection-check" aria-label="FS connection"/);
  assert.match(zip.readAsText('sidepanel.html'), /<details[^>]*aria-label="FS connection"[^>]*\bhidden\b[^>]*display:none/);
  assert.ok(manifest.host_permissions.includes('https://fulfillment-gh2-production.platform.flyzipline.com/*'));
  for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_page, ...Object.values(manifest.icons) as string[]]) {
    assert.ok(names.includes(file), `Missing manifest asset ${file}`);
  }
  assert.match(zip.readAsText('config.js'), /http:\/\/localhost:3000/);
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

test('extension URL resolution skips placeholders and handles local and Render downloads', async () => {
  const { resolveExtensionBackendUrl: resolve } = await import('./extensionPackage');
  assert.equal(resolve({ appUrl: 'MY_APP_URL', host: 'localhost:3000' }), 'http://localhost:3000');
  assert.equal(resolve({ appUrl: 'undefined', renderUrl: 'https://ordercheck.onrender.com', host: 'localhost:3000' }), 'https://ordercheck.onrender.com');
  assert.equal(resolve({ appUrl: ' https://dispatch.example.com/ ', renderUrl: 'https://ordercheck.onrender.com', host: 'localhost:3000' }), 'https://dispatch.example.com');
  assert.equal(resolve({ appUrl: 'dispatch.example.com', host: 'localhost:3000' }), 'https://dispatch.example.com');
  assert.equal(resolve({ appUrl: 'dispatch.example.com:8443' }), 'https://dispatch.example.com:8443');
  assert.equal(resolve({ appUrl: 'localhost:3000' }), 'http://localhost:3000');
  assert.equal(resolve({ host: '[::1]:3000' }), 'http://[::1]:3000');
  for (const appUrl of ['not a URL', 'ftp://dispatch.example.com', 'https://user:password@dispatch.example.com', 'https://dispatch.example.com/api?secret=value']) {
    assert.equal(resolve({ appUrl, host: 'localhost:3000' }), 'http://localhost:3000');
  }
  assert.throws(() => resolve({ appUrl: 'MY_APP_URL' }), /valid app address/);
});
