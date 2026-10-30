import { readFile, access } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Keep the supplied audit UI. Build maintained FS and shared audit helpers so
// browser acknowledgements use the same current rules as the website.
const project = fileURLToPath(new URL('../', import.meta.url));
await build({ absWorkingDir: project, entryPoints: ['extension/fs-content-entry.js'], outfile: 'extension/fs-content.js', bundle: true, platform: 'browser', format: 'iife' });
await build({ absWorkingDir: project, entryPoints: ['extension/background-entry.js'], outfile: 'extension/background.js', bundle: true, external: ['./config.js'], platform: 'browser', format: 'esm' });
await build({ absWorkingDir: project, entryPoints: ['extension/order-limits.ts'], outfile: 'extension/order-limits.js', bundle: true, platform: 'browser', format: 'esm', minify: true });
await build({ absWorkingDir: project, entryPoints: ['extension/general-auditor-entry.ts'], outfile: 'extension/general-auditor.js', bundle: true, platform: 'browser', format: 'esm', minify: true });
const root = new URL('../extension/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const files = [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  manifest.options_page,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap(script => script.js),
];
for (const file of files) await access(new URL(file, root));
