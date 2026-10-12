import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['extension/order-limits.ts'], outfile: 'extension/order-limits.js', bundle: true, platform: 'browser', format: 'esm', minify: true });
await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['extension/audit-contract.ts'], outfile: 'extension/audit-contract.js', bundle: true, platform: 'browser', format: 'esm', minify: true });

await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['extension/fs-content-entry.js'], outfile: 'extension/fs-content.js', bundle: true, platform: 'browser', format: 'iife' });

await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['extension/background-entry.js'], outfile: 'extension/background.js', bundle: true, external: ['./config.js'], platform: 'browser', format: 'esm' });
