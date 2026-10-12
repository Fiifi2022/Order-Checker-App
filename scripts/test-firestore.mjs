import { spawnSync } from 'node:child_process';
if (!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw new Error('Start a local Firestore emulator, then set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080. Production databases are not permitted.');
}
const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'server/companionVaccine.firestore.test.ts'], { stdio: 'inherit' });
process.exit(run.status ?? 1);
