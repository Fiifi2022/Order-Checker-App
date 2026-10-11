import { applyGeneralOrderLimitDecision, type runGeneralAuditor } from '../src/utils/generalAuditor';

export function acknowledgeOrderLimit<T extends ReturnType<typeof runGeneralAuditor>>(record: T, key: string, answer: boolean) {
  const updated = applyGeneralOrderLimitDecision(record, key, answer);
  if (updated === record) return record;
  return { ...updated, finalVerdict: updated.generalAudit.finalStatus, generalCounts: updated.generalAudit.counts,
    status: updated.allMatch ? 'resolved' : 'pending', resolutionNotes: updated.allMatch ? updated.generalAudit.finalStatus : '',
    resolvedAt: updated.allMatch ? new Date().toISOString() : null };
}
