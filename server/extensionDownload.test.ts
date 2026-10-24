import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ExtensionDownload, { downloadCompanionExtension } from '../src/components/ExtensionDownload';

test('extension page provides the download action and installation steps', () => {
  const html = renderToStaticMarkup(createElement(ExtensionDownload));
  assert.match(html, /Download Packed ZIP/);
  assert.match(html, /chrome:\/\/extensions/);
  assert.match(html, /Load unpacked/);
  assert.match(html, /manifest.json/);
});

test('authenticated download saves the current package and cleans up its temporary link', async () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const link = { href: '', download: '', click() { clicked++; }, remove() { removed++; } };
  let clicked = 0, removed = 0, appended = 0, revoked = '', requested: unknown;
  Object.assign(globalThis, { document: { createElement: () => link, body: { appendChild(value: unknown) { assert.equal(value, link); appended++; } } } });
  URL.createObjectURL = () => 'blob:extension-package'; URL.revokeObjectURL = value => { revoked = value; };
  try {
    await downloadCompanionExtension(async input => { requested = input; return new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'Content-Type': 'application/zip' } }); });
    assert.equal(requested, '/api/download-extension');
    assert.equal(link.download, 'ordercheck-compliance-companion.zip');
    assert.equal(clicked, 1); assert.equal(appended, 1); assert.equal(removed, 1); assert.equal(revoked, link.href);
    await assert.rejects(downloadCompanionExtension(async () => Response.json({ error: 'Please sign in again.' }, { status: 401 })), /Please sign in again/);
    assert.equal(clicked, 1, 'an error response cannot download as a ZIP');
  } finally { globalThis.document = originalDocument; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});
