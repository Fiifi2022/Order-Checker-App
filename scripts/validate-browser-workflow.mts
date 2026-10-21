// Actual React app + complete Express server on loopback, with clearly isolated
// synthetic Firebase providers. This is NOT production end-user authentication.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, symlink, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { validateBlueprintInsertion } from './validation/blueprint-insertion';
import { validateBlueprintSizing } from './validation/blueprint-sizing';
import { validateBlueprintProgressMenu } from './validation/blueprint-progress-menu';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.ORDERCHECK_VALIDATION_DIRECTORY || '/tmp/ordercheck-browser-validation';
const browserModule = process.env.ORDERCHECK_PLAYWRIGHT_MODULE;
if (!browserModule) throw new Error('Set ORDERCHECK_PLAYWRIGHT_MODULE to an installed Playwright module; use Node >=22.12.');
const { chromium } = await import(pathToFileURL(browserModule).href);
await mkdir(path.join(output, 'dist'), { recursive: true });
await copyFile(path.join(root, 'firebase-applet-config.json'), path.join(output, 'firebase-applet-config.json'));
await symlink(path.join(root, 'node_modules'), path.join(output, 'node_modules'), 'dir').catch(() => {});
const fixture = (name: string) => path.join(root, 'scripts/validation', name);
await build({ absWorkingDir: root, entryPoints: ['src/main.tsx'], outfile: path.join(output, 'dist/app.js'), bundle: true, platform: 'browser', format: 'esm', minify: true,
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' }, plugins: [{ name: 'isolated-client-provider', setup(builder) {
    builder.onResolve({ filter: /^(?:firebase\/auth|(?:\.\.\/|\.\/)+firebase)$/ }, () => ({ path: fixture('firebase-client.fixture.ts') }));
    builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'css' }));
  } }] });
const styles = (await readdir(path.join(root, 'dist/assets'))).find(file => file.endsWith('.css'));
if (styles) await copyFile(path.join(root, 'dist/assets', styles), path.join(output, 'dist/app.css'));
await writeFile(path.join(output, 'dist/index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
await build({ absWorkingDir: root, entryPoints: ['server.ts'], outfile: path.join(output, 'server.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'isolated-server-provider', setup(builder) {
    builder.onResolve({ filter: /(?:\.\/server\/firebaseAdmin|\.\/firebaseAdmin)$/ }, () => ({ path: fixture('firebase-admin.fixture.ts') }));
    builder.onLoad({ filter: /\/server\.ts$/ }, async args => {
      let contents = await readFile(args.path, 'utf8');
      contents = contents.replace("app.use('/api', startAuditBudget);", `app.use('/api', startAuditBudget);\napp.use('/api', (req, res, next) => { if (req.path === '/verify') res.on('finish', () => console.log('VALIDATION_TIMING ' + JSON.stringify({ run: req.headers['x-validation-run'], status: res.statusCode, ...auditTiming(req)?.snapshot() }))); next(); });`);
      return { contents, loader: 'ts', resolveDir: root };
    });
  } }] });
const report: any = { scope: 'Real Chromium rendering + actual React/AuthGate/authFetch + complete Express app over loopback. Firebase identity and storage are test-only in-memory providers; Gemini deliberately unavailable. Not deployed/live authentication performance.', runtime: process.version, facilityRecords: 1509, cases: [], browserErrors: [], backendTimings: [] };
const server = spawn(process.execPath, [path.join(output, 'server.cjs')], { cwd: output, env: { ...process.env, NODE_ENV: 'production', PORT: process.env.ORDERCHECK_VALIDATION_PORT || '43177', GEMINI_API_KEY: '', AUDIT_PERFORMANCE_LOG: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
let text = '', serverLog = '';
server.stdout.on('data', chunk => { text += chunk; serverLog += chunk; const lines = text.split('\n'); text = lines.pop() || ''; for (const line of lines) if (line.startsWith('VALIDATION_TIMING ')) report.backendTimings.push(JSON.parse(line.slice(18))); });
server.stderr.on('data', chunk => { serverLog += chunk; });
let browser: any, page: any;
const base = `http://127.0.0.1:${process.env.ORDERCHECK_VALIDATION_PORT || '43177'}`;
try {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} if (server.exitCode !== null) throw new Error('Isolated server failed to start'); await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  page.on('pageerror', (error: any) => report.browserErrors.push(error.name + ': ' + error.message));
  // tsx preserves function names with this helper when serializing callbacks.
  await page.addInitScript('globalThis.__name = (value) => value;');
  await page.addInitScript(() => {
    const state: any = (window as any).__auditValidation = { samples: [] };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input);
      if (!url.endsWith('/api/verify')) return nativeFetch(input, init);
      const sample: any = { run: state.run, requestAt: performance.now() };
      state.samples.push(sample);
      const headers = new Headers(init?.headers); headers.set('x-validation-run', state.run);
      const response = await nativeFetch(input, { ...init, headers });
      sample.responseAt = performance.now();
      response.clone().json().then(data => { sample.data = data; sample.bodyAt = performance.now(); requestAnimationFrame(() => state.checkRender?.()); });
      return response;
    };
    document.addEventListener('click', event => { if ((event.target as Element)?.closest('#verify-button')) { state.clickedAt = performance.now(); state.awaitingRender = true; state.sawEmpty = false; } }, true);
    state.checkRender = () => {
      if (!state.awaitingRender) return;
      const sample = state.samples.at(-1), data = sample?.data;
      const panel = document.getElementById('results-panel');
      const normalize = (value: string) => value.replace(/\s+/g, ' ').toLowerCase();
      const visible = normalize(panel?.textContent || '');
      const ready = sample?.run === state.run && data && panel && !document.getElementById('verify-button')?.textContent?.includes('Auditing Order Logs') &&
        visible.includes(normalize(data.generalAudit.finalStatus)) && data.items.every((item: any) => visible.includes(normalize(item.name)));
      if (ready) { state.renderedAt = performance.now(); state.awaitingRender = false; }
    };
    new MutationObserver(state.checkRender).observe(document, { childList: true, subtree: true, characterData: true });
  });
  const navigationStarted = performance.now();
  await page.goto(base);
  const liveResponse = await page.waitForResponse((response: any) => response.url().includes('/blueprint-districts/validation-sheet/current') && response.status() === 200);
  assert.equal((await liveResponse.json()).sheet.rows[0].vaccines.OPV.balance, 20);
  const initialReads = await (await fetch(base + '/api/admin/firestore-reads', { headers: { Authorization: 'Bearer validation-token:0' } })).json();
  const poll = initialReads.operations.filter((entry: any) => entry.route === '/vaccine/blueprint-districts/:id/current');
  assert.equal(poll.length, 2, 'Polling must read only the current role and current sheet; no product catalogue');
  for (const collection of ['user_roles', 'vaccine_districts']) {
    const entry = poll.find((row: any) => row.collection === collection);
    assert.ok(entry && entry.operations >= 1);
    assert.equal(entry.returnedDocuments, entry.operations);
  }
  assert.equal(initialReads.operations.filter((entry: any) => entry.route === '/roles').length, 0);
  report.initialReadDiagnostics = initialReads;
  report.liveBlueprintPolling = { passed: true, freshSelectedSheet: true, automaticTeamDirectoryLoads: 0, scope: 'SDK-result counters with isolated in-memory Firebase provider' };
  await page.getByRole('button', { name: 'General Auditor', exact: true }).click();
  await page.locator('#verify-button').waitFor();
  report.initialAppReadyMs = performance.now() - navigationStarted;
  const header = 'Facility: Asaam HC\nOrderer: Test Operator\n';
  const scenarios = [
    ['multivitamin-exact', 'Multivitamin Syrup — 5 bottles', 'Multivitamin Syrup — 5 bottles', true],
    ['multivitamin-children-exact', "Children's Multivitamin Syrup — 5 bottles", "Children's Multivitamin Syrup — 5 bottles", true],
    ['multivitamin-children-quantity', "Children's Multivitamin Syrup — 5 bottles", "Children's Multivitamin Syrup — 3 bottles", false],
    ['clinical-synonym', 'PCM - 5', 'Paracetamol [5/5]', true],
    ['quantity-difference', 'Multivitamin Syrup - 5 bottles', 'Multivitamin Syrup [3/5] bottles', false],
    ['partial-stock', 'Multivitamin Syrup - 5\nAmoxicillin - 2', 'Multivitamin Syrup [5/5]\nAmoxicillin [0/2]', true],
    ['unresolved-separate-line', 'Multivitamin Syrup - 5\nPlease include an additional product for the patient.', 'Multivitamin Syrup [5/5]', false],
    ['clinical-specification', 'Multivitamin Syrup 100ml - 5 bottles', 'Multivitamin Syrup 200ml [5/5] bottles', false],
  ];
  async function run(name: string, customer: string, system: string, expected: boolean, delay = 0) {
    await page.evaluate(({ name, delay }: any) => { (window as any).__auditValidation.run = name; sessionStorage.setItem('validationAuthDelay', String(delay)); }, { name, delay });
    await page.locator('textarea').nth(0).fill(customer);
    await page.locator('textarea').nth(1).fill(system);
    await page.locator('#verify-button').click();
    if (delay > 3000) { await page.getByText('Your audit is taking slightly longer than expected. Please wait while we complete the verification.', { exact: true }).waitFor(); report.slowProgressShown = true; }
    await page.getByText('Session Log', { exact: true }).waitFor({ timeout: 25000 });
    await page.waitForFunction(() => { const s: any = (window as any).__auditValidation; return s.samples.at(-1)?.data && s.renderedAt >= s.clickedAt; });
    const sample = await page.evaluate(() => { const s: any = (window as any).__auditValidation, a = s.samples.at(-1); return { run: a.run, frontendBeforeRequestMs: a.requestAt - s.clickedAt, requestHeadersMs: a.responseAt - a.requestAt, requestResponseMs: a.bodyAt - a.requestAt, frontendAfterResponseMs: s.renderedAt - a.responseAt, clickToRenderedMs: s.renderedAt - s.clickedAt, allMatch: a.data.allMatch, items: a.data.items.map((x: any) => ({ name: x.name, status: x.status })), reviews: a.data.generalAudit.semanticReviews?.map((x: any) => ({ kind: x.kind, originalText: x.originalText })), semanticStatus: a.data.semanticAnalysis.status }; });
    report.cases.push(sample); assert.equal(sample.allMatch, expected, name);
    assert.ok(!await page.getByText('The audit exceeded the three-second processing target. Review required; please retry.', { exact: true }).count());
    if (name === 'unresolved-separate-line') { assert.equal(sample.items[0].status, 'match'); assert.equal(sample.reviews[0].kind, 'unparsed_text'); assert.ok(!sample.reviews[0].originalText.includes('Multivitamin')); }
    if (name.startsWith('multivitamin')) assert.equal(sample.semanticStatus, 'skipped', 'Explicit matched identities must not request AI, including when quantities differ');
  }
  for (const [name, a, b, expected] of scenarios) {
    await run(name as string, header + a, header + b, expected as boolean);
    if (name === 'quantity-difference') {
      const acknowledgement = page.waitForResponse((response: any) => /\/api\/audits\/[^/]+\/order-limit$/.test(response.url()));
      await page.getByRole('button', { name: 'Yes', exact: true }).first().click();
      assert.equal((await acknowledgement).status(), 200);
      await page.waitForFunction(() => document.getElementById('results-panel')?.textContent?.includes('ORDER LIMIT APPLIED — CONFIRMED'));
      report.orderLimitAcknowledgement = true;
    }
  }
  await run('optional-missing-fulfilment', header + 'Delivery/Drop Area: Asaam\nDistrict: Asante Mampong\nMultivitamin Syrup - 5', header + 'Multivitamin Syrup [5/5]', true);
  assert.equal(await page.getByLabel('General audit field results').getByText('OPTIONAL — NOT PROVIDED IN FULFILMENT', { exact: true }).count(), 2);
  await run('optional-location-conflict', header + 'Delivery/Drop Area: Asaam\nDistrict: Asante Mampong\nMultivitamin Syrup - 5', header + 'Delivery/Drop Area: Walewale\nDistrict: East Mamprusi\nMultivitamin Syrup [5/5]', false);
  assert.ok(await page.getByText('LOCATION MISMATCH — MANUAL REVIEW REQUIRED', { exact: true }).count());
  assert.ok(await page.getByText('DISTRICT MISMATCH — MANUAL REVIEW REQUIRED', { exact: true }).count());
  await run('missing-required-orderer', header + 'Multivitamin Syrup - 5', 'Facility: Asaam HC\nMultivitamin Syrup [5/5]', false);
  assert.ok(await page.getByLabel('General audit field results').getByText('MISSING REQUIRED INFORMATION', { exact: true }).count());
  const adminFooter = 'Expected delivery: between June 26, 2026 10:38 AM and June 26, 2026 12:38 PM.\nLet us know if any changes are required or contact 0800719102 if any questions.';
  await run('administrative-footer', header + 'Multivitamin Syrup - 5\nParacetamol 120mg/5mL Syrup, 100mL - 5', header + 'Multivitamin Syrup [5/5]\nParacetamol 120mg/5mL Syrup, 100mL [5/5]\n' + adminFooter, true);
  assert.equal(report.cases.at(-1).semanticStatus, 'skipped');
  assert.equal(await page.getByText(/IGNORED — ADMINISTRATIVE INFORMATION/).count(), 0);
  assert.doesNotMatch(await page.locator('#results-panel').innerText(), /Expected delivery|0800719102/);
  await page.screenshot({ path: path.join(output, 'administrative-footer.png'), fullPage: true });
  await run('notification-with-order-change', header + 'Multivitamin Syrup - 5', header + 'Multivitamin Syrup [5/5]\n' + adminFooter + '\nChange the quantity from 5 to 10.', false);
  assert.ok(report.cases.at(-1).reviews.some((review: any) => /Change the quantity/.test(review.originalText)));
  for (const notice of ['You will receive your flight notifications via SMS.', 'Your order is expected to arrive between 10:00 AM and 12:00 PM.', 'You will receive your flight notifications via SMS. thank you for your order.']) {
    await run('silent-routine-notice', header + 'Multivitamin Syrup - 5', header + 'Multivitamin Syrup [5/5]\n' + notice, true);
    assert.equal(report.cases.at(-1).semanticStatus, 'skipped');
    assert.doesNotMatch(await page.locator('#results-panel').innerText(), /notifications via SMS|expected to arrive|IGNORED/);
  }
  await run('sms-with-quantity-change', header + 'Multivitamin Syrup - 5', header + 'Multivitamin Syrup [5/5]\nYou will receive flight notifications via SMS. Please increase Multivitamin Syrup to 10 bottles.', false);
  assert.ok(report.cases.at(-1).reviews.some((review: any) => /increase Multivitamin Syrup to 10 bottles/.test(review.originalText)));
  assert.doesNotMatch(await page.locator('#results-panel').innerText(), /notifications via SMS/);
  const restockingFooter = 'Please reach out to the nearest stock for the rest of the order. Once re-stocked, we will notify you and be able to deliver the rest, if still needed.';
  for (const [name, customer, system, expected, statuses] of [
    ['restocking-footer-match', 'Multivitamin Syrup - 5 bottles', 'Multivitamin Syrup - 5 bottles\n' + restockingFooter, true, ['match']],
    ['restocking-explicit-stock', 'Paracetamol Tablets - 10 boxes\nMultivitamin Syrup - 5 bottles', 'Paracetamol Tablets - 10 boxes\nMultivitamin Syrup - 0/5\n' + restockingFooter, true, ['match', 'out of stock']],
    ['restocking-shortage', 'Multivitamin Syrup - 10 bottles', 'Multivitamin Syrup - 5 bottles\n' + restockingFooter, false, ['quantity mismatch']],
    ['restocking-mixed-sms-stock', 'Paracetamol Tablets - 10 boxes', 'You will receive SMS notifications. Paracetamol Tablets are out of stock, 0/10.', true, ['out of stock']],
    ['restocking-missing-product', 'Paracetamol Tablets - 10 boxes\nMultivitamin Syrup - 5 bottles', 'Paracetamol Tablets - 10 boxes\n' + restockingFooter, false, ['match', 'missing item']],
  ] as const) {
    await run(name, header + customer, header + system, expected);
    const sample = report.cases.at(-1);
    assert.deepEqual(sample.items.map((item: any) => item.status), statuses);
    assert.equal(sample.semanticStatus, 'skipped');
    assert.equal(sample.reviews?.length || 0, 0);
    assert.doesNotMatch(await page.locator('#results-panel').innerText(), /nearest stock|re-stocked|SMS notifications|UNRESOLVED TEXT/);
  }
  await run('sms-with-lowercase-destination-change', header + 'Multivitamin Syrup - 5', header + 'Multivitamin Syrup [5/5]\nYou will receive flight notifications via SMS. please deliver these products to a different facility.', false);
  assert.ok(report.cases.at(-1).reviews.some((review: any) => review.originalText === 'please deliver these products to a different facility.'));
  assert.doesNotMatch(await page.locator('#results-panel').innerText(), /notifications via SMS/);
  await run('facility-mismatch', header + 'Multivitamin Syrup - 5', header.replace('Asaam HC', 'Another HC') + 'Multivitamin Syrup [5/5]', false);
  await run('orderer-mismatch', header + 'Multivitamin Syrup - 5', header.replace('Test Operator', 'Different Operator') + 'Multivitamin Syrup [5/5]', false);
  await run('ambiguous-facility', header.replace('Asaam HC', 'Kotoso RHC') + 'Multivitamin Syrup - 5', header.replace('Asaam HC', 'Kotoso RCH') + 'Multivitamin Syrup [5/5]', false);
  await run('slow-backend-3300ms', header + 'Multivitamin Syrup - 5', header + 'Multivitamin Syrup [5/5]', true, 3300);
  await page.evaluate(() => sessionStorage.setItem('validationAuthDelay', '0'));
  await page.screenshot({ path: path.join(output, 'verified-audit.png'), fullPage: true });
  report.unauthenticatedVerifyStatus = (await fetch(base + '/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status;
  report.forgedTokenStatus = (await fetch(base + '/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer forged' }, body: '{}' })).status;
  assert.equal(report.unauthenticatedVerifyStatus, 401); assert.equal(report.forgedTokenStatus, 401);
  await page.getByRole('button', { name: /^Allocation Blueprint/ }).click(); await page.waitForFunction(() => document.body.textContent?.includes('Asaam HC') || Array.from(document.querySelectorAll('input')).some(input => input.value === 'Asaam HC')); report.blueprintRendered = true;
  if (process.env.ORDERCHECK_VALIDATE_BLANK_INSERTION === '1') {
    report.blankInsertion = await validateBlueprintInsertion(page, base);
    report.sheetSizing = await validateBlueprintSizing(page, base);
    report.progressMenu = await validateBlueprintProgressMenu(page, base);
  }
  await page.getByRole('button', { name: /^Vaccine Checker/ }).click(); report.vaccineCheckerRendered = await page.getByText('Vaccine Checker', { exact: false }).count() > 0;
  const oldChrome = (globalThis as any).chrome;
  (globalThis as any).chrome = { storage: { session: { get: async () => ({ authSession: { idToken: 'validation-token:0', expiresAt: Date.now() + 3600000 } }) } } };
  try {
    const { backendRequest } = await import('../extension/auth.js');
    const { auditBody } = await import('../extension/audit.js');
    const started = performance.now();
    const extension = await backendRequest(base, '/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-validation-run': 'extension-client' }, body: JSON.stringify(auditBody(header + 'Multivitamin Syrup - 5', header + 'Multivitamin Syrup [5/5]', undefined)) });
    report.extensionClient = { elapsedMs: performance.now() - started, allMatch: extension.allMatch };
    assert.equal(extension.allMatch, true);
  } finally { (globalThis as any).chrome = oldChrome; }
  const api = async (endpoint: string, body?: any) => {
    const response = await fetch(base + endpoint, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer validation-token:0', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); assert.equal(response.status, 200, endpoint + ': ' + (data.error || '')); return data;
  };
  const before = (await api('/api/vaccine/allocations')).find((facility: any) => facility.facilityName === 'Asaam HC');
  assert.ok(before);
  const vaccine = await api('/api/verify', { auditScope: 'vaccine_checker', auditMode: 'fulfillment_only', facilityId: before.id,
    fulfillmentConfirmation: 'Facility: Asaam HC\nOPV [3/3]\nOPV Dropper [3/3]\nBCG [2/2]\nBCG Diluent [2/2]' });
  assert.equal(vaccine.allMatch, true); assert.equal(vaccine.canCommit, true);
  const confirmation = { orderId: vaccine.orderId, facilityId: before.id, authorized: true };
  await api('/api/vaccine/allocations/commit', confirmation);
  const after = (await api('/api/vaccine/allocations')).find((facility: any) => facility.id === before.id);
  await api('/api/vaccine/allocations/commit', confirmation);
  const retry = (await api('/api/vaccine/allocations')).find((facility: any) => facility.id === before.id);
  assert.equal(after.vaccines.OPV.remaining, before.vaccines.OPV.remaining - 3);
  assert.equal(retry.vaccines.OPV.remaining, after.vaccines.OPV.remaining);
  report.vaccineAtomicDeduction = { before: before.vaccines.OPV.remaining, after: after.vaccines.OPV.remaining, retry: retry.vaccines.OPV.remaining, passed: true, storage: 'isolated in-memory provider, not Firestore emulator' };
  const currentSheet = await api('/api/vaccine/blueprint-districts/validation-sheet/current');
  const confirmedRow = currentSheet.sheet.rows.find((row: any) => row.id === 'validation-row');
  assert.equal(confirmedRow.vaccines.OPV.balance, 17);
  report.liveBlueprintPolling.afterConfirmationBalance = confirmedRow.vaccines.OPV.balance;
  report.finalReadDiagnostics = await api('/api/admin/firestore-reads');
  report.status = 'passed';
} catch (error: any) { report.status = 'failed'; report.failure = error.message; process.exitCode = 1; if (page) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(path.join(output, 'failure.html'), await page.content().catch(() => '')); } }
finally {
  await browser?.close(); server.kill('SIGTERM');
  await writeFile(path.join(output, 'server.log'), serverLog);
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
