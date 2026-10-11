import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { buildExtensionPackage, extensionAssets } from './extensionPackage';

test('downloaded companion includes every module and only the selected public connection config', async () => {
  const zip = new AdmZip(await buildExtensionPackage('http://localhost:3000', 'public-browser-key'));
  const names = zip.getEntries().map(entry => entry.entryName);
  assert.deepEqual(new Set(names), new Set([...extensionAssets, 'config.js']));
  assert.equal(JSON.parse(zip.readAsText('manifest.json')).version, '1.4.1');
  assert.match(zip.readAsText('config.js'), /http:\/\/localhost:3000/);
  assert.match(zip.readAsText('config.js'), /public-browser-key/);
  for (const name of names.filter(name => name.endsWith('.js'))) {
    for (const match of zip.readAsText(name).matchAll(/from ['"]\.\/([^'"]+)['"]/g)) assert.ok(names.includes(match[1]), `Missing module ${match[1]}`);
  }
  assert.ok(!names.some(name => /test|env|firebase-applet/.test(name)));
  assert.match(zip.readAsText('popup.html'), /receivingDetails/);
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
