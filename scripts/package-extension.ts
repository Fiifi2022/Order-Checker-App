import { mkdir, writeFile } from 'node:fs/promises';
import { buildExtensionPackage } from '../server/extensionPackage';
import { extensionConfig } from '../extension/config.js';

await mkdir('dist', { recursive: true });
await writeFile('dist/ordercheck-compliance-companion.zip', await buildExtensionPackage(extensionConfig.backendUrl, extensionConfig.firebaseApiKey));
console.log('Packaged default OrderCheck side-panel extension: dist/ordercheck-compliance-companion.zip');
