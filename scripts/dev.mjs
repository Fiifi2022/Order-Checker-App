import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const supportedNode = version => {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
};
// npm can inherit an older system Node even when nvm has a supported runtime.
if (!supportedNode(process.version)) {
  const runtimeRoots = [process.env.NVM_DIR, join(homedir(), '.nvm'), join(homedir(), '.config', 'nvm')].filter(Boolean);
  const runtimes = runtimeRoots.flatMap(directory => {
    const versions = join(directory, 'versions', 'node');
    if (!existsSync(versions)) return [];
    return readdirSync(versions).filter(supportedNode).map(version => ({ version, executable: join(versions, version, 'bin', 'node') }));
  }).filter(runtime => existsSync(runtime.executable)).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  if (!runtimes.length) {
    console.error(`OrderCheck requires Node 22.12 or newer; this terminal uses ${process.version}. Run nvm install 22 and nvm use 22, then npm run dev.`);
    process.exit(1);
  }
  console.log(`Starting development with installed Node ${runtimes[0].version}.`);
  const launcher = spawn(runtimes[0].executable, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: process.env });
  process.on('SIGINT', () => launcher.kill('SIGINT'));
  process.on('SIGTERM', () => launcher.kill('SIGTERM'));
  await new Promise(resolve => launcher.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); resolve(); }));
  process.exit(process.exitCode || 0);
}

await import('./build-extension.mjs');

const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../dist/dev-server.cjs', import.meta.url));
let server;
let stopping = false;
async function stopServer() {
  const previous = server;
  server = undefined;
  if (!previous || previous.exitCode !== null || previous.signalCode !== null) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => previous.kill('SIGKILL'), 5000);
    previous.once('exit', () => { clearTimeout(timeout); resolve(); });
    previous.kill('SIGTERM');
  });
}
const build = await context({
  absWorkingDir: root,
  entryPoints: ['server.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
  plugins: [{ name: 'restart-development-server', setup(builder) {
    builder.onEnd(async result => {
      if (stopping || result.errors.length) return;
      await stopServer();
      if (stopping) return;
      server = spawn(process.execPath, ['--enable-source-maps', output], {
        cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' },
      });
      server.on('error', error => console.error('Could not start the development server:', error.message));
      server.on('exit', (code, signal) => {
        if (!stopping && code && !signal) console.error(`Development server exited with code ${code}. Fix the error above; saving a backend file will restart it.`);
      });
    });
  } }],
});
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await build.dispose();
  await stopServer();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await build.watch();
