// Local HTTP replay using the real auth middleware with a fixture verifier.
// This is deliberately not a live Firebase-account authentication test.
import express from 'express';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createAuthentication } from '../server/auth.ts';
import { fsContextHandlers, fsReadBudget, startFsReadBudget } from '../server/fsContext.ts';
import { fsContextSheets, fsContextCases } from '../server/fsContextFixtures.ts';

const before = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : new URL('../docs/fs-context-before.mjs', import.meta.url).href);
const liveSheets = JSON.parse(await readFile(new URL('../docs/fs-context-readonly-snapshot.json', import.meta.url), 'utf8'));
const rawCurl = url => new Promise((resolve, reject) => {
  const process = spawn('curl', ['--silent', '--show-error', '--max-time', '8', '--config', '-', url]);
  let body = '', error = '';
  process.stdout.on('data', chunk => { body += chunk; }); process.stderr.on('data', chunk => { error += chunk; });
  process.on('error', reject); process.on('close', code => code ? reject(new Error(error)) : resolve(JSON.parse(body)));
  process.stdin.end('header = "Authorization: Bearer fixture-valid"\n');
});
async function replay(sheets, cases, original) {
  const app = express();
  app.use('/api', startFsReadBudget);
  app.use('/api', createAuthentication(async token => {
    if (token !== 'fixture-valid') throw new Error('Invalid fixture token');
    return { uid: 'fixture-test', email: 'fixture@example.com', email_verified: true };
  }, async email => ({ id: 'fixture', email, role: 'cca', name: 'Fixture CCA', district: 'Test', createdAt: '' }), fsReadBudget));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/auth/me', (_req, res) => res.json(res.locals.authUser));
  const handlers = fsContextHandlers({ readSheets: async () => sheets, readCatalog: async () => ({}), applyCatalog() {}, log() {} });
  app.get('/api/vaccine/companion/facilities', handlers.facilities);
  app.get('/api/vaccine/companion/context', original ? (req, res) => res.json(before.lookupFsAllocation(sheets, JSON.parse(req.query.selection))) : handlers.context);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const results = {};
  try {
    for (const [key, selection] of Object.entries(cases)) results[key] = await rawCurl(base + '/api/vaccine/companion/context?selection=' + encodeURIComponent(JSON.stringify(selection)));
    return results;
  } finally { await new Promise(resolve => server.close(resolve)); }
}
const cases = { ...fsContextCases,
  a: { ...fsContextCases.a, products: [{ id: '', name: 'BCG', quantity: '1' }] },
  west_bcg: { ...fsContextCases.a, facility: { ...fsContextCases.a.facility, district: 'West Mamprusi' }, products: [{ id: '', name: 'BCG', quantity: '1' }] },
  west_unallocated: { ...fsContextCases.c, facility: { ...fsContextCases.c.facility, district: 'West Mamprusi' } },
};
const result = {
  authentication: 'Fixture verifier, not a valid live Firebase ID token. No live account curl test is claimed.',
  liveSnapshot: { inputs: cases, before: await replay(liveSheets, cases, true), after: await replay(liveSheets, cases, false) },
  syntheticFormattingFixture: { inputs: fsContextCases, before: await replay(fsContextSheets, fsContextCases, true), after: await replay(fsContextSheets, fsContextCases, false) },
};
await writeFile('docs/fs-context-curl-results.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
