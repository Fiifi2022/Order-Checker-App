import test from 'node:test';
import assert from 'node:assert/strict';
import {clearActivityLogs, getActivityLogs, getAppUsageMetrics, logActivity} from './activityService';
import type {ActivityLogEntry} from '../src/types';

const event = (overrides: Partial<ActivityLogEntry> = {}): Omit<ActivityLogEntry, 'timestamp'> => ({
  id: 'real-action', module: 'vaccine_blueprint', actionType: 'blueprint_cell_edit',
  title: 'Allocation updated', summary: 'Saved a cell edit',
  actor: {id: 'real-user', name: 'Real contributor', email: 'person@example.com', role: 'warehouse'},
  ...overrides,
});

test('activity starts empty and clearing never recreates demonstration users', () => {
  assert.deepEqual(getActivityLogs(), []);
  logActivity(event());
  clearActivityLogs();
  assert.deepEqual(getActivityLogs(), []);
  assert.equal(getAppUsageMetrics().totalActivities, 0);
  assert.deepEqual(getAppUsageMetrics().byActor, []);
});

test('persisted seed IDs and demo flags do not enter logs or contributor metrics', () => {
  clearActivityLogs();
  const demos = [{id: 'ACT-SYS-001'}, {isDemo: true}, {demo: true}, {recordType: 'demo'},
    {details: {metadata: {isDemo: true}}}, {details: {demo: true}}];
  demos.forEach((flags, i) => logActivity({...event({id: `demo-${i}`}), ...flags} as any));
  assert.deepEqual(getActivityLogs(), []);
  assert.equal(getAppUsageMetrics().totalActivities, 0);
  // A real person who also appeared in old seed data must not be blacklisted.
  logActivity(event({actor: {id: 'ohenedarko2014_gmail_com', name: 'Actual user', email: 'ohenedarko2014@gmail.com', role: 'admin'}}));
  assert.equal(getAppUsageMetrics().byActor.length, 1);
  assert.equal(getAppUsageMetrics().byActor[0].name, 'Actual user');
});

test('only identified users with work actions appear as contributors', () => {
  clearActivityLogs();
  logActivity(event({id: 'navigation', actionType: 'page_view'}));
  logActivity(event({id: 'role-switch', actionType: 'role_switched'}));
  logActivity(event({id: 'system', actor: {id: 'system', name: 'System', email: '', role: 'system'}}));
  logActivity(event({id: 'unidentified', actor: {name: 'Unknown', email: 'unknown@example.com', role: 'cca'}}));
  assert.deepEqual(getAppUsageMetrics().byActor, []);
  assert.equal(getActivityLogs().length, 4);
  logActivity(event());
  logActivity(event({id: 'check', actionType: 'checker_order_verified', actor: {...event().actor, email: ' PERSON@EXAMPLE.COM '}}));
  const metrics = getAppUsageMetrics();
  assert.equal(metrics.byActor.length, 1);
  assert.equal(metrics.byActor[0].totalActions, 2);
  assert.equal(metrics.byActor[0].cellEditsCount, 1);
  assert.equal(metrics.byActor[0].ordersCheckedCount, 1);
  assert.equal(metrics.totalActivities, 6);
});

test('hydrating the same persisted action does not double contributor counts', () => {
  clearActivityLogs();
  logActivity(event());
  logActivity(event());
  assert.equal(getActivityLogs().length, 1);
  assert.equal(getAppUsageMetrics().byActor[0].totalActions, 1);
  clearActivityLogs();
});
