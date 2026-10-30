import {assignedRoles} from '../shared/roles';

/** Existing ownerless legacy records retain their prior access policy. New
 * General audits always record an owner; only that owner or an admin may use them. */
export function canAccessAuditRecord(record: {createdByUserId?: string}, actor?: {id?: string;role?: string;roles?: string[]}) {
  return !record.createdByUserId || Boolean(actor &&
    (actor.id === record.createdByUserId || assignedRoles(actor).includes('admin')));
}

/** Recheck inside the storage transaction to close concurrent-create races. */
export function assertUnchangedAuditOwner(current: {createdByUserId?: string} | undefined, incoming: {createdByUserId?: string}) {
  if (current?.createdByUserId && current.createdByUserId !== incoming.createdByUserId) {
    throw Object.assign(new Error('This audit ID belongs to a different account.'),{code:7,status:403});
  }
}
