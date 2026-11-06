/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ActivityLogEntry, ActivityModule, ActivityActionType, AppUsageMetrics } from '../src/types';

// In-memory activity store with fast indexing
const activityStore: ActivityLogEntry[] = [];

// Demo provenance, rather than names/emails, keeps genuine users' history intact.
export function isDemoActivity(record: any): boolean {
  return /^ACT-SYS-/i.test(record?.id || '') || [record, record?.details, record?.details?.metadata]
    .some(value => value?.isDemo === true || value?.demo === true || value?.recordType === 'demo');
}

function isContributor(record: ActivityLogEntry): boolean {
  const actor = record.actor;
  return Boolean(actor?.id?.trim() && actor?.email?.trim() &&
    !['system', 'anonymous', 'guest'].includes(actor.id.trim().toLowerCase()) &&
    !['system', 'anonymous', 'guest'].includes(actor.role?.toLowerCase()) &&
    !['page_view', 'role_switched'].includes(record.actionType));
}

/**
 * Log a new activity event
 */
export function logActivity(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'> & { timestamp?: string; id?: string }): ActivityLogEntry {
  const id = entry.id || `ACT-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
  const timestamp = entry.timestamp || new Date().toISOString();

  const record: ActivityLogEntry = {
    ...entry,
    id,
    timestamp
  };

  // Ignore old persisted demos too, so a restart cannot reintroduce them.
  if (isDemoActivity(record)) return record;
  const existing = activityStore.findIndex(item => item.id === id);
  if (existing >= 0) activityStore.splice(existing, 1);
  activityStore.unshift(record);

  // Bound in-memory store to latest 2,000 entries
  if (activityStore.length > 2000) {
    activityStore.pop();
  }

  return record;
}

/**
 * Retrieve activity logs with multi-parameter filtering
 */
export function getActivityLogs(filters?: {
  module?: string;
  actionType?: string;
  actor?: string;
  facility?: string;
  district?: string;
  search?: string;
  dateRange?: 'today' | '24h' | '7d' | 'all';
  limit?: number;
}): ActivityLogEntry[] {
  let list = [...activityStore];

  if (!filters) {
    return list.slice(0, 200);
  }

  const { module, actionType, actor, facility, district, search, dateRange, limit = 200 } = filters;

  if (module && module !== 'all') {
    list = list.filter(item => item.module === module);
  }

  if (actionType && actionType !== 'all') {
    list = list.filter(item => item.actionType === actionType);
  }

  if (actor && actor !== 'all') {
    const actorLower = actor.toLowerCase();
    list = list.filter(item => 
      (item.actor.name && item.actor.name.toLowerCase().includes(actorLower)) ||
      (item.actor.email && item.actor.email.toLowerCase().includes(actorLower)) ||
      (item.actor.id && item.actor.id.toLowerCase() === actorLower)
    );
  }

  if (facility && facility !== 'all') {
    const facLower = facility.toLowerCase();
    list = list.filter(item => item.facility && item.facility.toLowerCase().includes(facLower));
  }

  if (district && district !== 'all') {
    const distLower = district.toLowerCase();
    list = list.filter(item => item.district && item.district.toLowerCase().includes(distLower));
  }

  if (dateRange && dateRange !== 'all') {
    const now = Date.now();
    let threshold = 0;
    if (dateRange === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      threshold = startOfDay.getTime();
    } else if (dateRange === '24h') {
      threshold = now - 24 * 3600 * 1000;
    } else if (dateRange === '7d') {
      threshold = now - 7 * 86400 * 1000;
    }

    if (threshold > 0) {
      list = list.filter(item => {
        const itemTime = new Date(item.timestamp).getTime();
        return itemTime >= threshold;
      });
    }
  }

  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    list = list.filter(item => 
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.summary && item.summary.toLowerCase().includes(q)) ||
      (item.facility && item.facility.toLowerCase().includes(q)) ||
      (item.district && item.district.toLowerCase().includes(q)) ||
      (item.actor.name && item.actor.name.toLowerCase().includes(q)) ||
      (item.actor.email && item.actor.email.toLowerCase().includes(q)) ||
      (item.details?.product && item.details.product.toLowerCase().includes(q))
    );
  }

  return list.slice(0, limit);
}

/**
 * Compute App Usage Metrics and team breakdown
 */
export function getAppUsageMetrics(): AppUsageMetrics {
  const total = activityStore.length;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayMs = startOfDay.getTime();

  let todayCount = 0;
  const byModule: Record<string, number> = {
    vaccine_blueprint: 0,
    vaccine_checker: 0,
    vaccine_dashboard: 0,
    general_auditor: 0,
    app_system: 0
  };

  const byActionType: Record<string, number> = {
    blueprint_cell_edit: 0,
    blueprint_status_change: 0,
    blueprint_row_added: 0,
    blueprint_row_deleted: 0,
    blueprint_cycle_created: 0,
    blueprint_district_renamed: 0,
    blueprint_sheet_reset: 0,
    checker_order_verified: 0,
    checker_order_confirmed: 0,
    checker_quota_adjusted: 0,
    page_view: 0,
    role_switched: 0
  };

  const actorMap = new Map<string, {
    id?: string;
    name: string;
    email: string;
    role: string;
    district?: string;
    totalActions: number;
    cellEditsCount: number;
    ordersCheckedCount: number;
    ordersConfirmedCount: number;
    lastActive: string;
  }>();

  let recentEditsCount = 0;
  let ordersVerifiedCount = 0;
  let ordersConfirmedCount = 0;
  let errorsPreventedCount = 0;
  let statusChangesCount = 0;

  for (const item of activityStore) {
    const timeMs = new Date(item.timestamp).getTime();
    if (timeMs >= startOfDayMs) {
      todayCount++;
    }

    if (item.module) {
      byModule[item.module] = (byModule[item.module] || 0) + 1;
    }

    if (item.actionType) {
      byActionType[item.actionType] = (byActionType[item.actionType] || 0) + 1;
    }

    if (item.actionType === 'blueprint_cell_edit') {
      recentEditsCount++;
    } else if (item.actionType === 'checker_order_verified') {
      ordersVerifiedCount++;
      if (item.badgeType === 'error' || item.details?.verdict === 'DO_NOT_PROCESS') {
        errorsPreventedCount++;
      }
    } else if (item.actionType === 'checker_order_confirmed') {
      ordersConfirmedCount++;
    } else if (item.actionType === 'blueprint_status_change') {
      statusChangesCount++;
    }

    // Navigation alone is not a contribution; system events remain in the timeline.
    if (!isContributor(item)) continue;
    const actorKey = item.actor.email.trim().toLowerCase();
    if (!actorMap.has(actorKey)) {
      actorMap.set(actorKey, {
        id: item.actor.id,
        name: item.actor.name || 'Anonymous',
        email: item.actor.email || actorKey,
        role: item.actor.role || 'Member',
        district: item.actor.district,
        totalActions: 0,
        cellEditsCount: 0,
        ordersCheckedCount: 0,
        ordersConfirmedCount: 0,
        lastActive: item.timestamp
      });
    }

    const curActor = actorMap.get(actorKey)!;
    curActor.totalActions++;
    if (item.actionType === 'blueprint_cell_edit') {
      curActor.cellEditsCount++;
    } else if (item.actionType === 'checker_order_verified') {
      curActor.ordersCheckedCount++;
    } else if (item.actionType === 'checker_order_confirmed') {
      curActor.ordersConfirmedCount++;
    }

    if (new Date(item.timestamp).getTime() > new Date(curActor.lastActive).getTime()) {
      curActor.lastActive = item.timestamp;
    }
  }

  // Convert actor map to sorted array
  const byActor = Array.from(actorMap.values()).sort((a, b) => b.totalActions - a.totalActions);

  return {
    totalActivities: total,
    todayActivities: todayCount,
    byModule,
    byActionType,
    byActor,
    recentEditsCount,
    ordersVerifiedCount,
    ordersConfirmedCount,
    errorsPreventedCount,
    statusChangesCount
  };
}

/**
 * Clear activity logs
 */
export function clearActivityLogs(): void {
  activityStore.length = 0;
}
