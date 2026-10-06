/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ActivityLogEntry, ActivityModule, ActivityActionType, AppUsageMetrics } from '../src/types';

// In-memory activity store with fast indexing
const activityStore: ActivityLogEntry[] = [];

// Seed realistic historic records so the audit trail immediately shows past activities
function initializeSeedActivities() {
  if (activityStore.length > 0) return;

  const now = new Date();
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000).toISOString();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
  const daysAgo = (d: number, h: number = 0) => new Date(now.getTime() - (d * 86400 + h * 3600) * 1000).toISOString();

  const seed: ActivityLogEntry[] = [
    {
      id: 'ACT-SYS-001',
      timestamp: minsAgo(8),
      module: 'vaccine_blueprint',
      actionType: 'blueprint_cell_edit',
      title: 'Blueprint Cell Edit: Konkoma SDA Clinic - BCG',
      summary: 'Mary Alhassan (ADMIN) updated Konkoma SDA Clinic BCG Distributed from 5 to 15 vials (+10 vials). Remaining balance: 15.',
      actor: {
        id: 'ohenedarko2014_gmail_com',
        name: 'Mary Alhassan',
        email: 'ohenedarko2014@gmail.com',
        role: 'admin',
        district: 'All Districts'
      },
      facility: 'Konkoma SDA Clinic',
      district: 'West Mamprusi',
      cycle: 'September 2026',
      badgeType: 'purple',
      details: {
        product: 'BCG',
        field: 'distributed',
        oldValue: 5,
        newValue: 15,
        diff: '+10',
        metadata: { carryOver: 5, allocation: 25, distributed: 15, balance: 15 }
      }
    },
    {
      id: 'ACT-SYS-002',
      timestamp: minsAgo(18),
      module: 'vaccine_checker',
      actionType: 'checker_order_confirmed',
      title: 'Order Deduction Confirmed: Konkoma SDA Clinic',
      summary: 'Kwame Mensah (CCA) confirmed delivery order for Konkoma SDA Clinic: BCG (-10 vials), OPV (-20 vials), Penta (-15 vials). Balances deducted in live ledger.',
      actor: {
        id: 'kwame_mensah',
        name: 'Kwame Mensah',
        email: 'kwame.mensah@flyzipline.com',
        role: 'cca',
        district: 'West Mamprusi'
      },
      facility: 'Konkoma SDA Clinic',
      district: 'West Mamprusi',
      cycle: 'September 2026',
      badgeType: 'success',
      details: {
        transactionId: 'TX-VAC-CONF-0923-01',
        orderSource: 'whatsapp',
        items: [
          { vaccine: 'BCG', currentOrder: 10, previousTaken: 5, remainingAfter: 15, dosesPerVial: 20 },
          { vaccine: 'OPV', currentOrder: 20, previousTaken: 10, remainingAfter: 20, dosesPerVial: 20 },
          { vaccine: 'Penta', currentOrder: 15, previousTaken: 10, remainingAfter: 13, dosesPerVial: 10 }
        ]
      }
    },
    {
      id: 'ACT-SYS-003',
      timestamp: minsAgo(24),
      module: 'vaccine_checker',
      actionType: 'checker_order_verified',
      title: 'Order Audit Verified: Konkoma SDA Clinic',
      summary: 'Kwame Mensah (CCA) verified order against DCO monthly quota: 🟢 GREEN LIGHT. All 3 requested products within allocation remaining limits.',
      actor: {
        id: 'kwame_mensah',
        name: 'Kwame Mensah',
        email: 'kwame.mensah@flyzipline.com',
        role: 'cca',
        district: 'West Mamprusi'
      },
      facility: 'Konkoma SDA Clinic',
      district: 'West Mamprusi',
      cycle: 'September 2026',
      badgeType: 'success',
      details: {
        verdict: 'GREEN_LIGHT',
        orderSource: 'whatsapp',
        items: [
          { vaccine: 'BCG', requestedQty: 10, availableRemaining: 25, status: 'valid' },
          { vaccine: 'OPV', requestedQty: 20, availableRemaining: 40, status: 'valid' },
          { vaccine: 'Penta', requestedQty: 15, availableRemaining: 28, status: 'valid' }
        ]
      }
    },
    {
      id: 'ACT-SYS-004',
      timestamp: minsAgo(42),
      module: 'vaccine_blueprint',
      actionType: 'blueprint_status_change',
      title: 'Facility Status Updated: Sakogu H/C',
      summary: 'Audrey Mensah (DCO) marked Sakogu H/C processing as Completed (all quota distributed). Highlighted green.',
      actor: {
        id: 'audrey_mensah',
        name: 'Audrey Mensah',
        email: 'audrey.mensah@flyzipline.com',
        role: 'dco',
        district: 'West Mamprusi'
      },
      facility: 'Sakogu H/C',
      district: 'West Mamprusi',
      cycle: 'September 2026',
      badgeType: 'success',
      details: {
        field: 'completed',
        newValue: '2026-09-23'
      }
    },
    {
      id: 'ACT-SYS-005',
      timestamp: hoursAgo(1),
      module: 'vaccine_checker',
      actionType: 'checker_order_verified',
      title: 'Order Audit Blocked: Buzulungu CHPS',
      summary: 'Kwame Mensah (CCA) verified order: 🔴 DO NOT PROCESS. Exceeds remaining allocation for OPV (Requested: 15 vials, Remaining: 3 vials).',
      actor: {
        id: 'kwame_mensah',
        name: 'Kwame Mensah',
        email: 'kwame.mensah@flyzipline.com',
        role: 'cca',
        district: 'West Mamprusi'
      },
      facility: 'Buzulungu CHPS',
      district: 'West Mamprusi',
      cycle: 'September 2026',
      badgeType: 'error',
      details: {
        verdict: 'DO_NOT_PROCESS',
        orderSource: 'whatsapp',
        errorsDetected: [
          '🔴 EXCEEDS ALLOCATION: OPV requested: 15 vials (300 doses), Available Remaining: 3 vials (60 doses). Over-allocation by 12 vials.'
        ]
      }
    },
    {
      id: 'ACT-SYS-006',
      timestamp: hoursAgo(2),
      module: 'vaccine_blueprint',
      actionType: 'blueprint_cell_edit',
      title: 'Blueprint Cell Edit: Presbyterian Clinic, Langbinsi - OPV',
      summary: 'Mary Alhassan (ADMIN) updated Presbyterian Clinic, Langbinsi OPV Allocation from 30 to 45 vials (+15 top-up).',
      actor: {
        id: 'ohenedarko2014_gmail_com',
        name: 'Mary Alhassan',
        email: 'ohenedarko2014@gmail.com',
        role: 'admin',
        district: 'All Districts'
      },
      facility: 'Presbyterian Clinic, Langbinsi',
      district: 'West Mamprusi',
      cycle: 'September 2026',
      badgeType: 'purple',
      details: {
        product: 'OPV',
        field: 'allocation',
        oldValue: 30,
        newValue: 45,
        diff: '+15'
      }
    },
    {
      id: 'ACT-SYS-007',
      timestamp: hoursAgo(3),
      module: 'vaccine_checker',
      actionType: 'checker_quota_adjusted',
      title: 'Quota Authorization Adjusted: Wundua CHPS',
      summary: 'Audrey Mensah (DCO) authorized emergency quota top-up of +10 vials for Penta at Wundua CHPS (Reason: Community child health outreach).',
      actor: {
        id: 'audrey_mensah',
        name: 'Audrey Mensah',
        email: 'audrey.mensah@flyzipline.com',
        role: 'dco',
        district: 'East Mamprusi'
      },
      facility: 'Wundua CHPS',
      district: 'East Mamprusi',
      cycle: 'September 2026',
      badgeType: 'warning',
      details: {
        product: 'Penta',
        oldValue: 15,
        newValue: 25,
        diff: '+10',
        metadata: { reason: 'Community child health outreach campaign authorization' }
      }
    },
    {
      id: 'ACT-SYS-008',
      timestamp: hoursAgo(4),
      module: 'vaccine_blueprint',
      actionType: 'blueprint_status_change',
      title: 'Facility Status Updated: BMC PH',
      summary: 'Kwame Mensah (CCA) recorded BMC PH dispatch process started for September distribution cycle.',
      actor: {
        id: 'kwame_mensah',
        name: 'Kwame Mensah',
        email: 'kwame.mensah@flyzipline.com',
        role: 'cca',
        district: 'West Mamprusi'
      },
      facility: 'BMC PH',
      district: 'West Mamprusi',
      cycle: 'September 2026',
      badgeType: 'info',
      details: {
        field: 'processing',
        newValue: '2026-09-23'
      }
    },
    {
      id: 'ACT-SYS-009',
      timestamp: hoursAgo(5),
      module: 'vaccine_blueprint',
      actionType: 'blueprint_cycle_created',
      title: 'New Allocation Cycle Created: October 2026',
      summary: 'Mary Alhassan (ADMIN) created new multi-district allocation sheet "October 2026" with auto stock rollover from September.',
      actor: {
        id: 'ohenedarko2014_gmail_com',
        name: 'Mary Alhassan',
        email: 'ohenedarko2014@gmail.com',
        role: 'admin',
        district: 'All Districts'
      },
      district: 'West Mamprusi',
      cycle: 'October 2026',
      badgeType: 'purple',
      details: {
        metadata: { newMonth: 'October 2026', sourceMonth: 'September 2026', facilitiesRolledOver: 21 }
      }
    },
    {
      id: 'ACT-SYS-010',
      timestamp: daysAgo(1, 2),
      module: 'general_auditor',
      actionType: 'checker_order_verified',
      title: 'Cross-Discrepancy Audit: Walewale Health Center',
      summary: 'Dr. Samuel Osei (AUDITOR) verified WhatsApp order against warehouse fulfillment: 🟢 100% Match on all anti-malarials and vaccine supplies.',
      actor: {
        id: 'samuel_osei',
        name: 'Dr. Samuel Osei',
        email: 'samuel.osei@flyzipline.com',
        role: 'auditor',
        district: 'All Districts'
      },
      facility: 'Walewale Health Center',
      district: 'West Mamprusi',
      badgeType: 'success',
      details: {
        verdict: 'GREEN_LIGHT',
        orderSource: 'whatsapp'
      }
    },
    {
      id: 'ACT-SYS-011',
      timestamp: daysAgo(1, 4),
      module: 'app_system',
      actionType: 'page_view',
      title: 'App Usage: Vaccine Allocation Blueprint',
      summary: 'Mary Alhassan (ADMIN) opened Vaccine Allocation Blueprint (West Mamprusi - 21 health facilities).',
      actor: {
        id: 'ohenedarko2014_gmail_com',
        name: 'Mary Alhassan',
        email: 'ohenedarko2014@gmail.com',
        role: 'admin',
        district: 'All Districts'
      },
      district: 'West Mamprusi',
      badgeType: 'info'
    },
    {
      id: 'ACT-SYS-012',
      timestamp: daysAgo(1, 6),
      module: 'app_system',
      actionType: 'page_view',
      title: 'App Usage: Vaccine Allocation Checker',
      summary: 'Kwame Mensah (CCA) accessed Vaccine Allocation Checker workspace.',
      actor: {
        id: 'kwame_mensah',
        name: 'Kwame Mensah',
        email: 'kwame.mensah@flyzipline.com',
        role: 'cca',
        district: 'West Mamprusi'
      },
      badgeType: 'info'
    }
  ];

  activityStore.push(...seed);
}

// Call seed once on load
initializeSeedActivities();

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

  // Add to front of store
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

    // Accumulate by Actor
    const actorKey = (item.actor.email || item.actor.name || 'Anonymous').toLowerCase();
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
  // Re-seed default baseline
  initializeSeedActivities();
}
