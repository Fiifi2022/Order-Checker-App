import { authFetch } from '../utils/authFetch';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  Activity,
  User,
  Users,
  Search,
  Filter,
  RefreshCw,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  ArrowRight,
  Download,
  Trash2,
  ChevronRight,
  Shield,
  Layers,
  Sparkles,
  Eye,
  FileText,
  Calendar,
  Check,
  Building2,
  Syringe,
  BarChart3,
  TrendingUp,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ActivityLogEntry, AppUsageMetrics, UserRoleRecord } from '../types';

interface SystemAuditLogViewProps {
  currentUser?: UserRoleRecord | null;
  initialModuleFilter?: string;
  onNavigateToBlueprint?: () => void;
  onNavigateToChecker?: () => void;
}

export default function SystemAuditLogView({
  currentUser,
  initialModuleFilter,
  onNavigateToBlueprint,
  onNavigateToChecker
}: SystemAuditLogViewProps) {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [usage, setUsage] = useState<AppUsageMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [moduleFilter, setModuleFilter] = useState<string>(initialModuleFilter || 'all');
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('all');
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<'all' | 'today' | '24h' | '7d'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // View display mode
  const [viewMode, setViewMode] = useState<'timeline' | 'table'>('timeline');
  const [selectedEntry, setSelectedEntry] = useState<ActivityLogEntry | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showUsageDashboard, setShowUsageDashboard] = useState(true);

  // Fetch both logs and usage metrics
  const fetchAuditData = async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams();
      if (moduleFilter !== 'all') queryParams.append('module', moduleFilter);
      if (actionTypeFilter !== 'all') queryParams.append('actionType', actionTypeFilter);
      if (actorFilter !== 'all') queryParams.append('actor', actorFilter);
      if (dateRangeFilter !== 'all') queryParams.append('dateRange', dateRangeFilter);
      if (searchQuery.trim()) queryParams.append('search', searchQuery.trim());
      queryParams.append('limit', '300');

      const [logsRes, usageRes] = await Promise.all([
        authFetch(`/api/activity/logs?${queryParams.toString()}`),
        authFetch('/api/activity/usage')
      ]);

      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setLogs(logsData.logs || []);
      } else {
        throw new Error('Failed to retrieve activity audit logs.');
      }

      if (usageRes.ok) {
        const usageData = await usageRes.json();
        setUsage(usageData);
      }
    } catch (err: any) {
      console.error('Audit fetch error:', err);
      setError(err?.message || 'Error connecting to activity ledger.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditData();
  }, [moduleFilter, actionTypeFilter, actorFilter, dateRangeFilter]);

  // Handle clear logs
  const handleClearLogs = async () => {
    try {
      setLoading(true);
      const res = await authFetch('/api/activity/logs/clear', { method: 'POST' });
      if (res.ok) {
        setShowClearConfirm(false);
        fetchAuditData();
      }
    } catch (err) {
      console.error('Failed to clear logs:', err);
    } finally {
      setLoading(false);
    }
  };

  // Export filtered logs to CSV
  const handleExportCSV = () => {
    if (logs.length === 0) return;
    const headers = ['ID', 'Timestamp', 'Module', 'Action Type', 'Actor Name', 'Actor Email', 'Actor Role', 'Facility', 'District', 'Summary', 'Details'];
    const rows = logs.map(l => [
      `"${l.id}"`,
      `"${l.timestamp}"`,
      `"${l.module}"`,
      `"${l.actionType}"`,
      `"${l.actor?.name || ''}"`,
      `"${l.actor?.email || ''}"`,
      `"${l.actor?.role || ''}"`,
      `"${l.facility || ''}"`,
      `"${l.district || ''}"`,
      `"${(l.summary || '').replace(/"/g, '""')}"`,
      `"${l.details ? JSON.stringify(l.details).replace(/"/g, '""') : ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `system_audit_log_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export filtered logs to JSON
  const handleExportJSON = () => {
    if (logs.length === 0) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', dataStr);
    link.setAttribute('download', `system_audit_log_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered in-memory if user types search query without pressing enter
  const displayedLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;
    const q = searchQuery.toLowerCase().trim();
    return logs.filter(l =>
      (l.title && l.title.toLowerCase().includes(q)) ||
      (l.summary && l.summary.toLowerCase().includes(q)) ||
      (l.facility && l.facility.toLowerCase().includes(q)) ||
      (l.district && l.district.toLowerCase().includes(q)) ||
      (l.actor?.name && l.actor.name.toLowerCase().includes(q)) ||
      (l.actor?.email && l.actor.email.toLowerCase().includes(q)) ||
      (l.details?.product && l.details.product.toLowerCase().includes(q))
    );
  }, [logs, searchQuery]);

  // Distinct actors for filter dropdown
  const uniqueActors = useMemo(() => {
    if (!usage?.byActor) return [];
    return usage.byActor;
  }, [usage]);

  // Helpers for module formatting
  const getModuleLabel = (mod: string) => {
    switch (mod) {
      case 'vaccine_blueprint':
        return { label: 'Allocation Blueprint', color: 'bg-purple-100 text-purple-800 border-purple-200' };
      case 'vaccine_checker':
        return { label: 'Vaccine Checker', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
      case 'general_auditor':
        return { label: 'General Auditor', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' };
      case 'vaccine_dashboard':
        return { label: 'Vaccine Dashboard', color: 'bg-blue-100 text-blue-800 border-blue-200' };
      case 'app_system':
      default:
        return { label: 'App System', color: 'bg-slate-100 text-slate-800 border-slate-200' };
    }
  };

  const getActionBadge = (action: string, badgeType?: string) => {
    switch (action) {
      case 'blueprint_cell_edit':
        return { text: 'Cell Edit', color: 'bg-purple-50 text-purple-700 border-purple-200' };
      case 'blueprint_status_change':
        return { text: 'Status Change', color: 'bg-sky-50 text-sky-700 border-sky-200' };
      case 'blueprint_cycle_created':
        return { text: 'New Month Cycle', color: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' };
      case 'blueprint_district_renamed':
        return { text: 'District Update', color: 'bg-slate-50 text-slate-700 border-slate-200' };
      case 'checker_order_verified':
        return badgeType === 'error'
          ? { text: 'Audit Blocked (🔴 Do Not Process)', color: 'bg-rose-50 text-rose-700 border-rose-200' }
          : { text: 'Audit Verified (🟢 Green Light)', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      case 'checker_order_confirmed':
        return { text: 'Deduction Confirmed', color: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 'checker_quota_adjusted':
        return { text: 'Quota Adjusted', color: 'bg-amber-50 text-amber-800 border-amber-200' };
      case 'page_view':
        return { text: 'Page Visited', color: 'bg-slate-50 text-slate-600 border-slate-200' };
      case 'role_switched':
        return { text: 'User Switched', color: 'bg-purple-50 text-purple-700 border-purple-200' };
      default:
        return { text: action.replace(/_/g, ' '), color: 'bg-slate-50 text-slate-600 border-slate-200' };
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role?.toLowerCase()) {
      case 'admin':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'warehouse':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'cca':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'auditor':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'dco':
        return 'bg-teal-100 text-teal-800 border-teal-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      return { dateStr, timeStr, full: `${dateStr} · ${timeStr}` };
    } catch {
      return { dateStr: ts, timeStr: '', full: ts };
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner Ribbon */}
      <div className="bg-gradient-to-r from-[#3B1A5E] via-[#5C2D91] to-[#3B1A5E] rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 opacity-10 pointer-events-none flex items-center pr-8">
          <History size={180} />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="bg-white/20 backdrop-blur-xs text-white text-[10px] font-mono uppercase px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5 border border-white/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Live Audit & Accountability Trail
              </span>
              <span className="bg-purple-300/30 text-purple-100 text-[10px] px-2 py-0.5 rounded font-mono">
                Persistent Sync
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight flex items-center gap-2.5">
              <History className="w-6 h-6 text-purple-200" />
              Comprehensive System Activity & Audit Ledger
            </h1>
            <p className="text-xs md:text-sm text-purple-100 max-w-2xl leading-relaxed">
              Complete chronological audit trail recording all recent edits on the <b>Allocation Blueprint</b>, checks and deductions on the <b>Vaccine Checker</b>, individual accountability, and <b>App Usage Analytics</b>.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={fetchAuditData}
              disabled={loading}
              className="bg-white/10 hover:bg-white/20 text-white border border-white/20 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-xs disabled:opacity-50"
              title="Refresh logs from persistent store"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Syncing...' : 'Sync Live'}</span>
            </button>

            <button
              onClick={() => setShowUsageDashboard(prev => !prev)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer border ${
                showUsageDashboard
                  ? 'bg-white text-[#3B1A5E] border-white shadow-md'
                  : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>{showUsageDashboard ? 'Hide Usage Stats' : 'Show Usage Stats'}</span>
            </button>

            <div className="relative group">
              <button
                className="bg-white/10 hover:bg-white/20 text-white border border-white/20 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export</span>
              </button>
              <div className="absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-xl border border-slate-100 py-1 hidden group-hover:block z-30 text-slate-800">
                <button
                  onClick={handleExportCSV}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-purple-50 flex items-center gap-2 font-medium cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  Export as CSV
                </button>
                <button
                  onClick={handleExportJSON}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-purple-50 flex items-center gap-2 font-medium cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  Export as JSON
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top Metrics Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl p-3.5 border border-purple-100 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Events</span>
            <Activity className="w-4 h-4 text-purple-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900">{usage?.totalActivities ?? logs.length}</span>
            <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-mono">
              Today: {usage?.todayActivities ?? 0}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-purple-100 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Blueprint Edits</span>
            <FileSpreadsheet className="w-4 h-4 text-purple-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-purple-700">{usage?.recentEditsCount ?? 0}</span>
            <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-mono">
              Cells
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-purple-100 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Orders Checked</span>
            <Shield className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-emerald-700">{usage?.ordersVerifiedCount ?? 0}</span>
            <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-mono">
              Audits
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-purple-100 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Deductions</span>
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-blue-700">{usage?.ordersConfirmedCount ?? 0}</span>
            <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded font-mono">
              Confirmed
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-purple-100 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Errors Prevented</span>
            <AlertCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-rose-700">{usage?.errorsPreventedCount ?? 0}</span>
            <span className="text-[10px] text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded font-mono">
              Blocked
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-purple-100 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Active Team</span>
            <Users className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black text-indigo-700">{usage?.byActor?.length ?? 1}</span>
            <span className="text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded font-mono">
              Users
            </span>
          </div>
        </div>
      </div>

      {/* App Usage Analytics & Contributor Breakdown Panel */}
      <AnimatePresence>
        {showUsageDashboard && usage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white rounded-2xl p-5 border border-purple-100 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-purple-50 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-purple-100 rounded-lg text-purple-700">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">App Usage & Individual Contributor Ledger</h3>
                    <p className="text-[11px] text-slate-400">Activity breakdown by team member and workspace module</p>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                  Real-Time Engine Sync
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Contributor Leaderboard */}
                <div className="lg:col-span-2 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 px-1">
                    <span>Team Members & Recorded Edits</span>
                    <span className="text-slate-400 font-normal">Actions / Breakdown</span>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {usage.byActor.map((u, idx) => (
                      <div
                        key={u.email || idx}
                        onClick={() => setActorFilter(u.email || u.name)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          actorFilter.toLowerCase() === (u.email || u.name).toLowerCase()
                            ? 'bg-purple-50/80 border-purple-300 ring-2 ring-purple-200'
                            : 'bg-slate-50/50 hover:bg-purple-50/40 border-slate-100'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#3B1A5E] to-[#5C2D91] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                            {u.name?.slice(0, 2).toUpperCase() || 'U'}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-800 truncate">{u.name}</span>
                              <span className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-semibold border ${getRoleBadge(u.role)}`}>
                                {u.role}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
                              <span>{u.email}</span>
                              <span>•</span>
                              <span>{u.district || 'All Districts'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex items-center gap-2 text-[10px] font-mono">
                            <span className="bg-purple-100/70 text-purple-800 px-1.5 py-0.5 rounded" title="Blueprint Cell Edits">
                              ✏️ {u.cellEditsCount} edits
                            </span>
                            <span className="bg-emerald-100/70 text-emerald-800 px-1.5 py-0.5 rounded" title="Orders Checked">
                              🛡️ {u.ordersCheckedCount} checked
                            </span>
                            <span className="bg-blue-100/70 text-blue-800 px-1.5 py-0.5 rounded" title="Orders Confirmed">
                              📦 {u.ordersConfirmedCount} confirmed
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-black text-slate-800">{u.totalActions}</span>
                            <span className="block text-[9px] text-slate-400 font-mono">actions</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Module Usage Breakdown */}
                <div className="space-y-3 bg-purple-50/30 p-4 rounded-xl border border-purple-50 flex flex-col justify-between">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-slate-700">Workspace Module Distribution</span>
                    <p className="text-[10px] text-slate-400">Total activities recorded per application module</p>
                  </div>

                  <div className="space-y-2.5">
                    {Object.entries(usage.byModule).map(([modKey, count]) => {
                      const meta = getModuleLabel(modKey);
                      const numCount = Number(count) || 0;
                      const pct = usage.totalActivities > 0 ? Math.round((numCount / usage.totalActivities) * 100) : 0;
                      return (
                        <div
                          key={modKey}
                          onClick={() => setModuleFilter(modKey)}
                          className="cursor-pointer group"
                        >
                          <div className="flex justify-between items-center text-xs mb-1">
                            <span className="font-semibold text-slate-700 group-hover:text-purple-700 transition-colors">
                              {meta.label}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500">
                              {numCount} <span className="text-slate-400">({pct}%)</span>
                            </span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#5C2D91] to-purple-400 rounded-full transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[10px] text-slate-400 border-t border-purple-100/60 pt-2 flex items-center justify-between">
                    <span>Audit Store: Indexed Memory + Firestore</span>
                    <button
                      onClick={() => {
                        setModuleFilter('all');
                        setActorFilter('all');
                        setActionTypeFilter('all');
                        setDateRangeFilter('all');
                        setSearchQuery('');
                      }}
                      className="text-purple-700 hover:underline font-bold cursor-pointer"
                    >
                      Reset Filters
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-purple-100 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
          {/* Module Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1 shrink-0">
              Module:
            </span>
            {[
              { id: 'all', label: 'All Modules' },
              { id: 'vaccine_blueprint', label: 'Allocation Blueprint' },
              { id: 'vaccine_checker', label: 'Vaccine Checker' },
              { id: 'general_auditor', label: 'General Auditor' },
              { id: 'app_system', label: 'App Usage & System' }
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setModuleFilter(m.id)}
                className={`text-xs px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
                  moduleFilter === m.id
                    ? 'bg-[#5C2D91] text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-purple-50 text-slate-600 hover:text-[#5C2D91]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0 self-end md:self-auto">
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'timeline'
                  ? 'bg-white text-[#5C2D91] shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Timeline Feed
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white text-[#5C2D91] shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Data Table
            </button>
          </div>
        </div>

        {/* Detailed Secondary Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-purple-50">
          {/* Action Type Dropdown */}
          <div className="relative">
            <select
              value={actionTypeFilter}
              onChange={e => setActionTypeFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs rounded-xl px-3 py-2 text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer"
            >
              <option value="all">All Action Types</option>
              <option value="blueprint_cell_edit">✏️ Blueprint Cell Edits</option>
              <option value="checker_order_verified">🛡️ Order Verifications (Audits)</option>
              <option value="checker_order_confirmed">📦 Order Confirmations (Deductions)</option>
              <option value="blueprint_status_change">🔄 Facility Status Updates</option>
              <option value="checker_quota_adjusted">⚙️ Quota Authorizations / Adjustments</option>
              <option value="blueprint_cycle_created">📅 Month Cycles & Districts</option>
              <option value="page_view">👁️ Page Views & Navigation</option>
            </select>
          </div>

          {/* Actor / Contributor Dropdown */}
          <div className="relative">
            <select
              value={actorFilter}
              onChange={e => setActorFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs rounded-xl px-3 py-2 text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer"
            >
              <option value="all">All Individuals (Entire Team)</option>
              {uniqueActors.map(a => (
                <option key={a.email} value={a.email}>
                  👤 {a.name} ({a.role.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          {/* Time Range Filter */}
          <div className="relative">
            <select
              value={dateRangeFilter}
              onChange={e => setDateRangeFilter(e.target.value as any)}
              className="w-full bg-slate-50 border border-slate-200 text-xs rounded-xl px-3 py-2 text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer"
            >
              <option value="all">All Time History</option>
              <option value="today">Today Only</option>
              <option value="24h">Past 24 Hours</option>
              <option value="7d">Past 7 Days</option>
            </select>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search facility, vaccine, actor..."
              className="w-full bg-slate-50 border border-slate-200 text-xs rounded-xl pl-9 pr-3 py-2 text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
          <div className="text-xs">
            <span className="font-bold block">Ledger Sync Alert</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Main Logs View */}
      {loading && displayedLogs.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center space-y-3 bg-white rounded-2xl border border-purple-50">
          <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
          <p className="text-xs font-mono text-slate-400">Loading audit log events and tracking ledgers...</p>
        </div>
      ) : displayedLogs.length === 0 ? (
        <div className="py-20 text-center border-2 border-dashed border-purple-100 rounded-2xl bg-white flex flex-col items-center justify-center max-w-lg mx-auto p-6 space-y-3">
          <div className="p-3 bg-purple-50 text-[#5C2D91] rounded-full">
            <History className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">No Activity Records Match Your Filters</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            Try adjusting your module, contributor, or action type filters above, or perform actions in the Vaccine Checker or Allocation Blueprint.
          </p>
          <button
            onClick={() => {
              setModuleFilter('all');
              setActorFilter('all');
              setActionTypeFilter('all');
              setDateRangeFilter('all');
              setSearchQuery('');
            }}
            className="mt-2 bg-[#5C2D91] text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-[#3B1A5E] transition-all cursor-pointer"
          >
            Clear All Filters
          </button>
        </div>
      ) : viewMode === 'timeline' ? (
        /* TIMELINE FEED VIEW */
        <div className="space-y-3">
          {displayedLogs.map((entry, index) => {
            const time = formatTimestamp(entry.timestamp);
            const mod = getModuleLabel(entry.module);
            const actBadge = getActionBadge(entry.actionType, entry.badgeType);

            return (
              <motion.div
                key={entry.id || index}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, delay: Math.min(index * 0.02, 0.3) }}
                className="bg-white rounded-2xl p-4 sm:p-5 border border-purple-100/70 hover:border-purple-300 hover:shadow-md transition-all shadow-xs space-y-3 relative group"
              >
                {/* Entry Top Row */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${mod.color}`}>
                      {mod.label}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${actBadge.color}`}>
                      {actBadge.text}
                    </span>
                    {entry.facility && (
                      <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-slate-400" />
                        {entry.facility}
                      </span>
                    )}
                    {entry.district && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        {entry.district}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono shrink-0">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{time.full}</span>
                  </div>
                </div>

                {/* Narrative Summary */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-purple-50 text-[#5C2D91] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 border border-purple-100">
                    {entry.actor?.name?.slice(0, 2).toUpperCase() || 'US'}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900">{entry.actor?.name || 'Anonymous User'}</span>
                      <span className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-semibold border ${getRoleBadge(entry.actor?.role)}`}>
                        {entry.actor?.role || 'User'}
                      </span>
                      <span className="text-[11px] text-slate-400">({entry.actor?.email})</span>
                    </div>

                    <p className="text-xs sm:text-sm text-slate-800 font-medium leading-relaxed">
                      {entry.summary}
                    </p>
                  </div>
                </div>

                {/* Diff Box / Payloads */}
                {entry.details && (
                  <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100 text-xs space-y-2">
                    {/* Blueprint Cell Diff */}
                    {entry.details.field && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-semibold text-slate-500 uppercase text-[10px] tracking-wider">
                          Edited Field:
                        </span>
                        <span className="font-mono font-bold text-purple-900 bg-purple-100/60 px-2 py-0.5 rounded text-[11px]">
                          {entry.details.product ? `${entry.details.product} • ` : ''}
                          {entry.details.field}
                        </span>

                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-slate-400 line-through">
                            {entry.details.oldValue !== undefined && entry.details.oldValue !== '' ? entry.details.oldValue : 'empty'}
                          </span>
                          <ArrowRight className="w-3 h-3 text-slate-400" />
                          <span className="text-emerald-700 font-bold bg-emerald-100/60 px-2 py-0.5 rounded">
                            {entry.details.newValue}
                          </span>
                          {entry.details.diff && (
                            <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">
                              ({entry.details.diff})
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Confirmed Order Items */}
                    {Array.isArray(entry.details.items) && entry.details.items.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Verified & Deducted Products:
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {entry.details.items.map((it: any, iIdx: number) => (
                            <div key={iIdx} className="bg-white p-2 rounded-lg border border-slate-200/80 flex items-center justify-between text-[11px]">
                              <span className="font-bold text-slate-800">{it.vaccine}</span>
                              <div className="text-right font-mono">
                                <span className="text-blue-700 font-bold">
                                  {it.currentOrder !== undefined ? `-${it.currentOrder} v` : `${it.requestedQty} v`}
                                </span>
                                {it.remainingAfter !== undefined && (
                                  <span className="text-[10px] text-slate-400 block">
                                    Left: {it.remainingAfter} v
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Detected Errors */}
                    {Array.isArray(entry.details.errorsDetected) && entry.details.errorsDetected.length > 0 && (
                      <div className="bg-rose-50 border border-rose-100 rounded-lg p-2.5 text-[11px] text-rose-800 space-y-1">
                        <span className="font-bold block text-rose-900">Violations Detected:</span>
                        {entry.details.errorsDetected.map((errStr: string, eIdx: number) => (
                          <div key={eIdx} className="flex items-start gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                            <span>{errStr}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Footer Meta & Inspect Details */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-purple-50 pt-2 font-mono">
                  <span>Audit ID: {entry.id}</span>
                  <button
                    onClick={() => setSelectedEntry(entry)}
                    className="text-purple-700 hover:text-[#3B1A5E] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Inspect Raw Record</span>
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        /* COMPACT SPREADSHEET DATA TABLE VIEW */
        <div className="bg-white rounded-2xl border border-purple-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-purple-100 text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">
                  <th className="p-3.5">Time / ID</th>
                  <th className="p-3.5">Module</th>
                  <th className="p-3.5">Contributor (Actor)</th>
                  <th className="p-3.5">Facility / Context</th>
                  <th className="p-3.5">Action & Narrative</th>
                  <th className="p-3.5 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-50 text-slate-700">
                {displayedLogs.map((entry, idx) => {
                  const time = formatTimestamp(entry.timestamp);
                  const mod = getModuleLabel(entry.module);
                  const actBadge = getActionBadge(entry.actionType, entry.badgeType);

                  return (
                    <tr
                      key={entry.id || idx}
                      onClick={() => setSelectedEntry(entry)}
                      className="hover:bg-purple-50/30 transition-colors cursor-pointer"
                    >
                      <td className="p-3.5 whitespace-nowrap">
                        <span className="font-mono font-bold text-slate-900 block">{time.timeStr}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{time.dateStr}</span>
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${mod.color}`}>
                          {mod.label}
                        </span>
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800">{entry.actor?.name || 'Anonymous'}</span>
                          <span className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-semibold border ${getRoleBadge(entry.actor?.role)}`}>
                            {entry.actor?.role || 'User'}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 block">{entry.actor?.email}</span>
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        <span className="font-bold text-slate-800 block">{entry.facility || '—'}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{entry.district || ''}</span>
                      </td>

                      <td className="p-3.5">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${actBadge.color}`}>
                            {actBadge.text}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 max-w-md line-clamp-1">{entry.summary}</p>
                      </td>

                      <td className="p-3.5 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEntry(entry);
                          }}
                          className="p-1.5 text-purple-700 hover:bg-purple-100 rounded-lg transition-colors cursor-pointer"
                          title="View complete record details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Admin Log Reset / Clear Button */}
      {currentUser?.role === 'admin' && (
        <div className="flex justify-end pt-4">
          <button
            onClick={() => setShowClearConfirm(true)}
            className="text-slate-400 hover:text-rose-600 text-xs font-semibold flex items-center gap-1.5 p-2 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Reset / Re-baseline Audit Activity Ledger (Admin)</span>
          </button>
        </div>
      )}

      {/* Raw JSON / Inspection Modal */}
      <AnimatePresence>
        {selectedEntry && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col"
            >
              <div className="flex justify-between items-center border-b border-purple-50 pb-3">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-[#5C2D91]" />
                  <h3 className="font-extrabold text-[#3B1A5E] text-base">
                    Activity Audit Record Inspection
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedEntry(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-y-auto space-y-3 pr-1 text-xs">
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100 font-mono">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase block">Record ID</span>
                    <span className="font-bold text-slate-800">{selectedEntry.id}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase block">Timestamp</span>
                    <span className="font-bold text-slate-800">{selectedEntry.timestamp}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase block">Module</span>
                    <span className="font-bold text-purple-700">{selectedEntry.module}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase block">Action Type</span>
                    <span className="font-bold text-slate-800">{selectedEntry.actionType}</span>
                  </div>
                </div>

                <div className="bg-purple-50/50 p-3 rounded-xl border border-purple-100 space-y-1">
                  <span className="text-[10px] text-purple-800 uppercase font-bold tracking-wider block">
                    Individual Contributor (Actor)
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{selectedEntry.actor?.name}</span>
                    <span className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-semibold border ${getRoleBadge(selectedEntry.actor?.role)}`}>
                      {selectedEntry.actor?.role}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    Email: {selectedEntry.actor?.email} | Scope: {selectedEntry.actor?.district || 'All Districts'}
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                    Narrative Summary
                  </span>
                  <p className="text-slate-800 font-medium leading-relaxed">
                    {selectedEntry.summary}
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                    Full Payload / Verification JSON
                  </span>
                  <pre className="bg-slate-900 text-slate-100 p-3.5 rounded-xl overflow-x-auto text-[11px] font-mono leading-relaxed">
                    {JSON.stringify(selectedEntry, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="pt-2 border-t border-purple-50 flex justify-end">
                <button
                  onClick={() => setSelectedEntry(null)}
                  className="bg-[#5C2D91] text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-[#3B1A5E] transition-all cursor-pointer"
                >
                  Close Inspection
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Clear Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-3 text-rose-600">
                <AlertTriangle className="w-6 h-6" />
                <h3 className="font-extrabold text-base text-slate-900">
                  Reset Audit Activity Ledger?
                </h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                This will reset the in-memory activity ledger to baseline records. Persistent Firestore transactions and allocations remain safely intact. Are you sure you wish to continue?
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearLogs}
                  className="bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-rose-700 cursor-pointer"
                >
                  Confirm Reset
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
