import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['extension/order-limits.ts'], outfile: 'extension/order-limits.js', bundle: true, platform: 'browser', format: 'esm', minify: true });
