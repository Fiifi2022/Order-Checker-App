import {PRODUCTION_BACKEND_URL} from '../extension/backend-target.js';
import AdmZip from 'adm-zip';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Always ship the production service, including downloads from a local or old host. */
export function resolveExtensionBackendUrl(_settings: {appUrl?: string; railwayDomain?: string; renderUrl?: string; host?: string} = {}) {
  return PRODUCTION_BACKEND_URL;
}

export const extensionAssets = ['backend-target.js', 'audit-input-clear.js', 'manifest.json', 'icon-48.png', 'icon-128.png', 'popup.html', 'sidepanel.html', 'logo-white.png', 'general-report.css', 'icon-32.png', 'general-session.js', 'logo-mark.png', 'sidepanel-vaccine.js', 'allocation-cycle.js', 'fs-origins.js', 'sidepanel.css', 'vaccine.js', 'vaccine-display.js', 'icon.png', 'vaccine-api.js', 'general-auditor.js', 'icon-16.png', 'explain.js', 'backend.js', 'fs-connection.js', 'fs-panel.js', 'fs-script.js', 'fs-state.js', 'fs-messaging.js', 'auth.js', 'report.js', 'audit-contract.js', 'capture.js', 'screenshots.js', 'sidepanel-vaccine-api.js', 'content.js', 'general-report.js', 'catalog.js', 'alias-management.js', 'popup.js', 'background.js', 'fs-content.js', 'audit.js', 'sidepanel.js', 'order-limits.js'];
export async function buildExtensionPackage(backendUrl: string, firebaseApiKey: string, directory = path.join(process.cwd(), 'extension')) {
  backendUrl = PRODUCTION_BACKEND_URL;
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
  const allocationLowThreshold = Number(process.env.FS_ALLOCATION_LOW_THRESHOLD ?? 10);
  const allocationRefreshMs = Number(process.env.FS_ALLOCATION_REFRESH_MS ?? 30000);
  zip.addFile('config.js', Buffer.from(`export const extensionConfig = ${JSON.stringify({ backendUrl, firebaseApiKey, fsOrigins, allocationLowThreshold, allocationRefreshMs }, null, 2)};\n`));
  return zip.toBuffer();
}
