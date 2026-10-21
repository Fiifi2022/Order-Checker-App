// Explicitly opt-in read-only live validation. Never creates users, writes
// Firestore documents, mints sign-in tokens or prints credential values.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createPrivateKey, randomUUID } from 'node:crypto';
const args = new Set(process.argv.slice(2));
const report: any = { scope: 'Read-only external probes; no authenticated end-user browser session', firebase: { status: 'not_requested' }, gemini: { status: 'not_requested', requests: 0 } };
const output = process.env.ORDERCHECK_VALIDATION_OUTPUT || '/tmp/ordercheck-external-validation.json';
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const watchdog = setTimeout(() => { report.incomplete = 'External probe exceeded 15-second hard limit'; save(); process.exit(0); }, 15_000);
function classify(error: any) { const code = typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : Number(error?.status) || 'unavailable'; return { code, ...({ 8: 'RESOURCE_EXHAUSTED', 7: 'PERMISSION_DENIED', 16: 'UNAUTHENTICATED' }[code] ? { codeName: ({ 8: 'RESOURCE_EXHAUSTED', 7: 'PERMISSION_DENIED', 16: 'UNAUTHENTICATED' } as any)[code] } : {}) }; }
try {
  if (args.has('--firebase-read-only')) {
    const started = performance.now();
    let db: any;
    try {
      createPrivateKey((process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'));
      const admin = await import('../server/firebaseAdmin.ts'); db = admin.adminDb;
      report.firebase = { status: 'running', credentialFormat: 'valid_PEM', operations: 0 };
      save();
      const readStarted = performance.now();
      report.firebase.operations++;
      const snapshot = await db.collection('product_catalog').doc('current').get();
      report.firebase.firestoreRead = { status: 'success', elapsedMs: performance.now() - readStarted, exists: snapshot.exists,
        revisionPresent: Number.isSafeInteger(snapshot.data()?.revision), productCount: Array.isArray(snapshot.data()?.products) ? snapshot.data().products.length : null };
      const authStarted = performance.now();
      report.firebase.operations++;
      try { await admin.adminAuth.getUser('validation-nonexistent-' + randomUUID()); report.firebase.authRead = { status: 'unexpected_record', elapsedMs: performance.now() - authStarted }; }
      catch (error: any) { report.firebase.authRead = { status: error?.code === 'auth/user-not-found' ? 'service_reachable_expected_user_not_found' : 'failed', elapsedMs: performance.now() - authStarted, ...classify(error) }; }
      report.firebase.status = 'completed';
    } catch (error) { report.firebase = { ...report.firebase, status: 'failed', ...classify(error) }; }
    finally { report.firebase.elapsedMs = performance.now() - started; save(); if (db) void db.terminate().catch(() => {}); }
  }
  if (args.has('--firebase-read-only') && !report.firebase.authRead) {
    const started = performance.now();
    try {
      const { adminAuth } = await import('../server/firebaseAdmin.ts');
      report.firebase.operations = (report.firebase.operations || 0) + 1;
      try { await adminAuth.getUser('validation-nonexistent-' + randomUUID()); report.firebase.authRead = { status: 'unexpected_record' }; }
      catch (error: any) { report.firebase.authRead = { status: error?.code === 'auth/user-not-found' ? 'service_reachable_expected_user_not_found' : 'failed', ...classify(error) }; }
    } catch (error) { report.firebase.authRead = { status: 'failed', ...classify(error) }; }
    report.firebase.authRead.elapsedMs = performance.now() - started;
    save();
  }
  if (args.has('--gemini-once')) {
    const key = process.env.GEMINI_API_KEY?.trim() || '';
    if (!/^AIza[\w-]{35}$/.test(key)) report.gemini = { status: 'not_tested_invalid_configured_key_format', requests: 0 };
    else {
      const { GoogleGenAI } = await import('@google/genai');
      const { runGeneralSemanticAudit } = await import('../server/generalSemanticAudit.ts');
      const ai = new GoogleGenAI({ apiKey: key });
      let calls = 0;
      const started = performance.now();
      const result = await runGeneralSemanticAudit('Facility: Asaam HC\nOrderer: Synthetic Operator\nPlease send 5 PCM 500mg tablets today.',
        'Facility: Asaam HC\nOrderer: Synthetic Operator\nWe have packed 5 Paracetamol 500mg tablets today.', {}, { semanticTimeoutMs: 4000, semanticCacheScope: 'explicit-live-validation' },
        () => ({ models: { generateContent: (options: any) => { if (++calls > 1) throw new Error('Live validation request limit'); return ai.models.generateContent(options); } } }));
      report.gemini = { status: result.semanticAnalysis.status, elapsedMs: performance.now() - started, requests: calls, verifiedMatch: result.allMatch,
        manualReviews: result.generalAudit.semanticReviews?.length || 0 };
    }
  }
} catch (error) { report.probeError = classify(error); }
finally { clearTimeout(watchdog); save(); }
console.log(JSON.stringify(report));
