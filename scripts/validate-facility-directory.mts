import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { servedFacilityRecords as records } from '../server/generalFacilityRecords.ts';
import { compareGeneralFacilities, normalizeGeneralFacilityName } from '../src/utils/generalFacility.ts';
import { runGeneralAuditor } from '../server/generalAuditor.ts';
const started = performance.now();
const groups = new Map<string, typeof records>();
for (const record of records) { const key = normalizeGeneralFacilityName(record.name); groups.set(key, [...(groups.get(key) || []), record]); }
const baseline = process.env.ORDERCHECK_BASELINE_PATH ? await import(pathToFileURL(process.env.ORDERCHECK_BASELINE_PATH).href) : null;
const report: any = { facilityRecords: records.length, scope: 'Every supplied reference record, exact/case/spacing, prose and different-record comparisons; synthetic orderer/product; not independent verification of the directory', cases: 0, passed: 0, failed: 0, falseVerifiedMatches: 0, baselineComparisons: 0, optimizationDecisionChanges: 0, timings: [] as number[], failures: [] as any[] };
const context = { records: [...records] };
for (const [index, record] of records.entries()) {
  const geography = `${record.district ? '\nDistrict: ' + record.district : ''}${record.region ? '\nRegion: ' + record.region : ''}`;
  const customer = `Orderer: Test Operator\nFacility: ${record.name}${geography}\nMultivitamin Syrup - 5 bottles`;
  const system = `Orderer: Test Operator\nFacility: ${record.name.toUpperCase().replace(/ /g, '  ')}${geography}\nMultivitamin Syrup [5/5] bottles`;
  const candidates = groups.get(normalizeGeneralFacilityName(record.name))!.filter(other => (!record.district || !other.district || record.district === other.district) && (!record.region || !other.region || record.region === other.region));
  const expected = candidates.length === 1 ? 'match' : 'review required';
  const check = (kind: string, actual: string, valid: boolean, falseMatch = false) => {
    report.cases++; report[valid ? 'passed' : 'failed']++;
    if (falseMatch) report.falseVerifiedMatches++;
    if (!valid && report.failures.length < 50) report.failures.push({ recordIndex: index, name: record.name, kind, expected: kind === 'different-record' ? 'not match' : expected, actual });
  };
  const stamp = performance.now();
  const audit = runGeneralAuditor(customer, system, {}, { facilityContext: context });
  report.timings.push(performance.now() - stamp);
  check('labelled-case-spacing', audit.generalAudit.facility.status, audit.generalAudit.facility.status === expected, expected !== 'match' && audit.generalAudit.facility.status === 'match');
  const prose = `Orderer: Test Operator\nPlease send supplies to ${record.name}.${geography}\nMultivitamin Syrup - 5 bottles`;
  const unstructured = runGeneralAuditor(prose, system, {}, { facilityContext: context });
  check('prose', unstructured.generalAudit.facility.status, unstructured.generalAudit.facility.status === expected, expected !== 'match' && unstructured.generalAudit.facility.status === 'match');
  const other = records[(index + 1) % records.length];
  if (normalizeGeneralFacilityName(other.name) !== normalizeGeneralFacilityName(record.name)) {
    const different = compareGeneralFacilities(record.name, other.name, customer, `Facility: ${other.name}`, context);
    check('different-record', different.status, different.status !== 'match', different.status === 'match');
  }
  if (groups.get(normalizeGeneralFacilityName(record.name))!.length > 1) {
    const ambiguous = compareGeneralFacilities(record.name, record.name, `Facility: ${record.name}`, `Facility: ${record.name}`, context);
    check('duplicate-without-geography', ambiguous.status, ambiguous.status === 'review required', ambiguous.status === 'match');
  }
  if (baseline) {
    const old = baseline.compareGeneralFacilities(record.name, record.name.toUpperCase(), customer, system, context);
    const current = compareGeneralFacilities(record.name, record.name.toUpperCase(), customer, system, context);
    report.baselineComparisons++; if (old.status !== current.status) report.optimizationDecisionChanges++;
  }
  if ((index + 1) % 250 === 0) console.log(JSON.stringify({ progress: index + 1, total: records.length, failures: report.failed }));
}
const times = report.timings.sort((a: number, b: number) => a - b); delete report.timings;
report.elapsedMs = performance.now() - started;
report.labelledAudit = { samples: times.length, meanMs: times.reduce((a: number, b: number) => a + b, 0) / times.length,
  medianMs: (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2, p95Ms: times[Math.ceil(times.length * .95) - 1] };
writeFileSync(process.env.ORDERCHECK_VALIDATION_OUTPUT || '/tmp/ordercheck-facility-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (report.failed || report.optimizationDecisionChanges) process.exitCode = 1;
