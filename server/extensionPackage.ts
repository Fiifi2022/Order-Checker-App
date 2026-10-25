import AdmZip from 'adm-zip';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Prefer usable deployment settings, then the host serving the download. */
export function resolveExtensionBackendUrl({ appUrl, renderUrl, host }: { appUrl?: string; renderUrl?: string; host?: string }) {
  for (const candidate of [appUrl, renderUrl, host]) {
    const raw = candidate?.trim();
    if (!raw) continue;
    try {
      const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(raw);
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `${local ? 'http' : 'https'}://${raw}`);
      const localHostname = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(localHostname && url.protocol === 'http:')) continue;
      if (url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) continue;
      // Template values such as MY_APP_URL are not public hostnames.
      if (!localHostname && (!url.hostname.includes('.') || !/^[a-z\d.-]+$/i.test(url.hostname) || url.hostname.split('.').some(label => !label || label.startsWith('-') || label.endsWith('-')))) continue;
      return url.origin;
    } catch { /* An unset or placeholder setting must not break downloads. */ }
  }
  throw new Error('Extension download needs a valid app address. Set APP_URL to your app’s HTTPS base URL, or download from localhost.');
}

export const extensionAssets = ['manifest.json', 'popup.html', 'popup.js', 'backend.js', 'auth.js', 'catalog.js', 'screenshots.js', 'audit.js', 'audit-contract.js', 'vaccine.js', 'vaccine-api.js', 'vaccine-display.js', 'order-limits.js', 'content.js', 'fs-content.js', 'fs-state.js', 'fs-script.js', 'fs-origins.js', 'fs-messaging.js', 'fs-connection.js', 'fs-panel.js', 'background.js', 'icon.png'];
export async function buildExtensionPackage(backendUrl: string, firebaseApiKey: string, directory = path.join(process.cwd(), 'extension')) {
  const zip = new AdmZip();
  for (const file of extensionAssets) {
    const data = await readFile(path.join(directory, file));
    if (file === 'manifest.json') {
      const manifest = JSON.parse(data.toString());
      const origin = new URL(backendUrl).origin + '/*';
      if (!manifest.host_permissions.includes(origin)) manifest.host_permissions.push(origin);
      zip.addFile(file, Buffer.from(JSON.stringify(manifest, null, 2)));
    } else zip.addFile(file, data);
  }
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const fsOrigins = manifest.content_scripts.filter((script: any) => script.js?.includes('fs-content.js')).flatMap((script: any) => script.matches.map((pattern: string) => new URL(pattern).origin));
  zip.addFile('config.js', Buffer.from(`export const extensionConfig = ${JSON.stringify({ backendUrl, firebaseApiKey, fsOrigins }, null, 2)};\n`));
  return zip.toBuffer();
}
