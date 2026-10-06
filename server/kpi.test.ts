import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateKpis } from './kpi';

const check = (id: string, overrides: any = {}) => ({
  id, timestamp: '2026-09-20T10:00:00.000Z', district: 'North', facilityName: 'Clinic A', ccaUser: 'Operator',
  cycle: 'September', orderSource: 'whatsapp', orderId: `order-${id}`, ...overrides
});

test('calculates overall checks and rates without mixing blocked checks with audit discrepancies', () => {
  const result = calculateKpis({
    audits: [check('a1', { allMatch: true }), check('a2', { allMatch: false, issueCount: 1, status: 'pending' })],
    vaccineChecks: [check('v1', { auditResult: 'GREEN_LIGHT' }), check('v2', { auditResult: 'DO_NOT_PROCESS', errorsDetected: ['over allocation'] })]
  });
  assert.equal(result.counts.checks, 4);
  assert.equal(result.rates.auditPass.numerator, 2);
  assert.equal(result.rates.auditPass.denominator, 4);
  assert.equal(result.rates.discrepancy.numerator, 2);
  assert.equal(result.rates.block.numerator, 1);
  assert.equal(result.rates.block.denominator, 2);
});

test('excludes marked demo data and deduplicates unique orders by stable order ID', () => {
  const result = calculateKpis({ audits: [check('a', { orderId: 'shared' }), check('b', { orderId: 'shared' }), check('ACT-SYS-001', { isDemo: true })] });
  assert.equal(result.counts.auditChecks, 2);
  assert.equal(result.counts.uniqueOrders, 1);
});

test('applies date and dimension filters to checks', () => {
  const result = calculateKpis({ audits: [check('today'), check('old', { timestamp: '2026-09-01T10:00:00Z' }), check('south', { district: 'South' })], filter: { from: '2026-09-15', to: '2026-09-30', district: 'North' } });
  assert.equal(result.counts.auditChecks, 1);
  assert.equal(result.records.checks[0].id, 'today');
});

test('counts only confirmations linked to their exact verification check and transaction', () => {
  const vaccineChecks = [check('v1', { confirmed: true, confirmedTransactionId: 'tx1' }), check('v2', { confirmed: true, confirmedTransactionId: 'tx-elsewhere' })];
  const transactions = [{ id: 'tx1', orderId: 'v1', timestamp: '2026-09-20T10:02:00Z', district: 'North', facilityName: 'Clinic A', ccaUser: 'Operator', source: 'whatsapp' }];
  const result = calculateKpis({ vaccineChecks, transactions });
  assert.deepEqual(result.rates.confirmation, { numerator: 1, denominator: 2, rate: 0.5 });
});

test('handles empty and incomplete collections without dividing by zero', () => {
  const empty = calculateKpis({});
  assert.equal(empty.rates.auditPass.rate, null);
  assert.equal(empty.rates.confirmation.rate, null);
  const incomplete = calculateKpis({ audits: [{ id: 'missing', allMatch: true }] });
  assert.equal(incomplete.counts.auditChecks, 0);
  assert.equal(incomplete.quality.excludedInvalid, 1);
  assert.ok(incomplete.quality.missingFields.date > 0);
});

test('counts app and extension uses by day and agent from saved non-demo checks', () => {
  const result = calculateKpis({ audits: [
    check('app-1', { clientSource: 'order_checker_app' }),
    check('ext-1', { clientSource: 'companion_extension', user: 'Amina' }),
    check('ext-2', { clientSource: 'companion_extension', user: '', ccaUser: '' }),
    check('ACT-SYS-900', { clientSource: 'companion_extension', isDemo: true })
  ] });
  assert.equal(result.usage.appUses, 1);
  assert.equal(result.usage.extensionUses, 2);
  assert.equal(result.usage.totalUses, 3);
  assert.deepEqual(result.usage.daily[0], { date: '2026-09-20', appUses: 1, extensionUses: 2, uses: 3 });
  assert.equal(result.usage.agentsByDay.find(row => row.agent === 'Unknown agent')?.uses, 1);
});

test('counts entered issue items and resolved issue items using persisted resolution timestamps', () => {
  const result = calculateKpis({ audits: [
    check('pending', { allMatch: false, issueCount: 2, items: [{ name: 'BCG', status: 'quantity mismatch' }, { name: 'OPV', status: 'missing item' }], status: 'pending' }),
    check('resolved', { allMatch: false, issueCount: 1, resolvedIssueCount: 1, items: [{ name: 'BCG', status: 'quantity mismatch' }], status: 'resolved', resolvedAt: '2026-09-20T11:00:00Z' })
  ] });
  assert.equal(result.usage.enteredIssues, 3);
  assert.equal(result.usage.resolvedIssues, 1);
  assert.equal(result.usage.issueChecksEntered, 2);
  assert.equal(result.usage.issueChecksResolved, 1);
  assert.equal(result.timing.resolutionMedianSeconds, 3600);
  assert.deepEqual(result.errors[0], { label: 'BCG — quantity mismatch', count: 2 });
});

test('date and user filters scope app, extension, issue, and agent day counts', () => {
  const result = calculateKpis({ audits: [
    check('first', { clientSource: 'companion_extension', user: 'Amina' }),
    check('second', { timestamp: '2026-09-21T10:00:00Z', clientSource: 'order_checker_app', user: 'Yaw' })
  ], filter: { from: '2026-09-21', to: '2026-09-21', user: 'Yaw' } });
  assert.equal(result.usage.totalUses, 1);
  assert.equal(result.usage.appUses, 1);
  assert.equal(result.usage.extensionUses, 0);
  assert.deepEqual(result.usage.daily.map(row => row.date), ['2026-09-21']);
});
