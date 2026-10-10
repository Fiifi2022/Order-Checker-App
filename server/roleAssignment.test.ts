import test from 'node:test';
import assert from 'node:assert/strict';
import { assignedRoles, hasRole, roleAssignment } from '../shared/roles';

test('assignments support multiple roles and legacy callers, rejecting invalid values', () => {
  assert.deepEqual(roleAssignment({ roles: ['warehouse', 'cca', 'warehouse'] }), ['warehouse', 'cca']);
  assert.deepEqual(roleAssignment({ role: 'auditor' }), ['auditor']);
  for (const roles of [[], ['owner'], ['warehouse', 'owner'], 'admin', [null]]) {
    assert.throws(() => roleAssignment({ roles }));
  }
  assert.throws(() => roleAssignment({}));
});
test('explicit role arrays control access while legacy records retain their role', () => {
  assert.deepEqual(assignedRoles({ role: 'warehouse' }), ['warehouse']);
  assert.equal(hasRole({ role: 'cca', roles: ['cca', 'admin'] }, 'admin'), true);
  assert.equal(hasRole({ role: 'admin', roles: [] }, 'admin'), false);
});
