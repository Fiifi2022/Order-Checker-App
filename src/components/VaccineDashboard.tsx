/**
 * Vaccine Allocation Dashboard Component
 * Implements Section 19:
 * - Operational & strategic KPI cards
 * - Real-time metrics: Total facilities, remaining vs exhausted, total allocated vs taken
 * - Operational safety metrics: Validation errors prevented & duplicate orders caught
 * - Multi-dimensional filtering by Nest, District, Sub-District, Facility, Vaccine, and Month/Cycle
 * - Separated District & Sub-District operational view tabs
 * - Vaccine product breakdown cards & facility allocation matrix
 */

import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  ShieldCheck,
  AlertTriangle,
  Building2,
  Package,
  Layers,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Activity,
  ChevronDown,
  ChevronUp,
  MapPin,
  FileSpreadsheet,
  ArrowRight
} from 'lucide-react';
import { FacilityAllocation, VaccineDashboardMetrics, VaccineAllocationItem } from '../types';

interface VaccineDashboardProps {
  onSelectFacilityForAudit?: (facilityId: string) => void;
  onNavigateToTracker?: () => void;
}

export default function VaccineDashboard({ onSelectFacilityForAudit, onNavigateToTracker }: VaccineDashboardProps) {
  const [facilities, setFacilities] = useState<FacilityAllocation[]>([]);
  const [dashboardMetrics, setDashboardMetrics] = useState<VaccineDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  // Active view tab: Separate District from Sub-District view
  const [dashboardTab, setDashboardTab] = useState<'districts' | 'sub_districts' | 'antigens' | 'facilities'>('districts');

  // Filters
  const [selectedNest, setSelectedNest] = useState('all');
  const [selectedDistrict, setSelectedDistrict] = useState('all');
  const [selectedSubDistrict, setSelectedSubDistrict] = useState('all');
  const [selectedCycle, setSelectedCycle] = useState('all');
  const [selectedVaccine, setSelectedVaccine] = useState('all');

  // Accordion state
  const [expandedDistrict, setExpandedDistrict] = useState<string | null>(null);
  const [expandedSubDistrict, setExpandedSubDistrict] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [facRes, dashRes] = await Promise.all([
        fetch('/api/vaccine/allocations'),
        fetch('/api/vaccine/dashboard')
      ]);

      if (facRes.ok) setFacilities(await facRes.json());
      if (dashRes.ok) setDashboardMetrics(await dashRes.json());
    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const nests = Array.from(new Set(facilities.map(f => f.nest).filter(Boolean))) as string[];
  const districts = Array.from(new Set(facilities.map(f => f.district).filter(Boolean))) as string[];
  const cycles = Array.from(new Set(facilities.map(f => f.cycle).filter(Boolean))) as string[];

  // Dynamic sub-districts based on selected district
  const availableSubDistricts = Array.from(
    new Set(
      facilities
        .filter(f => selectedDistrict === 'all' || f.district === selectedDistrict)
        .map(f => f.subDistrict)
        .filter(Boolean)
    )
  ) as string[];

  const allVaccineNames = Array.from(
    new Set(facilities.flatMap(f => Object.keys(f.vaccines)))
  );

  // Filter facilities according to selected criteria
  const filteredFacilities = facilities.filter(f => {
    const matchNest = selectedNest === 'all' || f.nest === selectedNest;
    const matchDistrict = selectedDistrict === 'all' || f.district === selectedDistrict;
    const matchSubDistrict = selectedSubDistrict === 'all' || f.subDistrict === selectedSubDistrict;
    const matchCycle = selectedCycle === 'all' || f.cycle === selectedCycle;
    const matchVaccine = selectedVaccine === 'all' || Object.keys(f.vaccines).includes(selectedVaccine);
    return matchNest && matchDistrict && matchSubDistrict && matchCycle && matchVaccine;
  });

  // Calculate dynamic metrics for filtered facilities
  let filterAllocated = 0;
  let filterOrdered = 0;
  let filterRemaining = 0;
  let facilitiesWithRem = 0;
  let facilitiesExhausted = 0;

  const vaccineBreakdown: Record<string, { allocated: number; ordered: number; remaining: number; facilitiesCount: number }> = {};

  for (const f of filteredFacilities) {
    let facHasRem = false;
    let facHasExhausted = false;

    for (const [vName, vAlloc] of Object.entries(f.vaccines) as [string, VaccineAllocationItem][]) {
      if (selectedVaccine !== 'all' && vName !== selectedVaccine) continue;

      const totalAuth = vAlloc.original + (vAlloc.adjustment || 0);
      filterAllocated += totalAuth;
      filterOrdered += vAlloc.taken;
      filterRemaining += vAlloc.remaining;

      if (vAlloc.remaining > 0) facHasRem = true;
      if (vAlloc.remaining === 0 && totalAuth > 0) facHasExhausted = true;

      if (!vaccineBreakdown[vName]) {
        vaccineBreakdown[vName] = { allocated: 0, ordered: 0, remaining: 0, facilitiesCount: 0 };
      }
      vaccineBreakdown[vName].allocated += totalAuth;
      vaccineBreakdown[vName].ordered += vAlloc.taken;
      vaccineBreakdown[vName].remaining += vAlloc.remaining;
      vaccineBreakdown[vName].facilitiesCount++;
    }

    if (facHasRem) facilitiesWithRem++;
    if (!facHasRem && facHasExhausted) facilitiesExhausted++;
  }

  const consumptionPercent = filterAllocated > 0 ? Math.round((filterOrdered / filterAllocated) * 100) : 0;

  // Compute District-level Aggregations
  interface DistrictGroup {
    districtName: string;
    nest: string;
    subDistricts: string[];
    facilities: FacilityAllocation[];
    allocated: number;
    taken: number;
    remaining: number;
    antigensAllocated: Record<string, number>;
  }

  const districtGroupsMap: Record<string, DistrictGroup> = {};
  for (const f of filteredFacilities) {
    const dName = f.district || 'Unassigned District';
    if (!districtGroupsMap[dName]) {
      districtGroupsMap[dName] = {
        districtName: dName,
        nest: f.nest || 'Central Hub',
        subDistricts: [],
        facilities: [],
        allocated: 0,
        taken: 0,
        remaining: 0,
        antigensAllocated: {}
      };
    }
    if (f.subDistrict && !districtGroupsMap[dName].subDistricts.includes(f.subDistrict)) {
      districtGroupsMap[dName].subDistricts.push(f.subDistrict);
    }
    districtGroupsMap[dName].facilities.push(f);

    for (const [vName, vAlloc] of Object.entries(f.vaccines) as [string, VaccineAllocationItem][]) {
      if (selectedVaccine !== 'all' && vName !== selectedVaccine) continue;
      const totalAuth = vAlloc.original + (vAlloc.adjustment || 0);
      districtGroupsMap[dName].allocated += totalAuth;
      districtGroupsMap[dName].taken += vAlloc.taken;
      districtGroupsMap[dName].remaining += vAlloc.remaining;
      districtGroupsMap[dName].antigensAllocated[vName] = (districtGroupsMap[dName].antigensAllocated[vName] || 0) + totalAuth;
    }
  }
  const districtList = Object.values(districtGroupsMap).sort((a, b) => a.districtName.localeCompare(b.districtName));

  // Compute Sub-District-level Aggregations (Dedicated separate grouping)
  interface SubDistrictGroup {
    subDistrictName: string;
    districtName: string;
    nest: string;
    facilities: FacilityAllocation[];
    allocated: number;
    taken: number;
    remaining: number;
    antigensAllocated: Record<string, number>;
  }

  const subDistrictGroupsMap: Record<string, SubDistrictGroup> = {};
  for (const f of filteredFacilities) {
    const sdName = f.subDistrict || `${f.district || 'General'} (Central)`;
    const key = `${f.district || 'General'}__${sdName}`;
    if (!subDistrictGroupsMap[key]) {
      subDistrictGroupsMap[key] = {
        subDistrictName: sdName,
        districtName: f.district || 'Unassigned District',
        nest: f.nest || 'Central Hub',
        facilities: [],
        allocated: 0,
        taken: 0,
        remaining: 0,
        antigensAllocated: {}
      };
    }
    subDistrictGroupsMap[key].facilities.push(f);

    for (const [vName, vAlloc] of Object.entries(f.vaccines) as [string, VaccineAllocationItem][]) {
      if (selectedVaccine !== 'all' && vName !== selectedVaccine) continue;
      const totalAuth = vAlloc.original + (vAlloc.adjustment || 0);
      subDistrictGroupsMap[key].allocated += totalAuth;
      subDistrictGroupsMap[key].taken += vAlloc.taken;
      subDistrictGroupsMap[key].remaining += vAlloc.remaining;
      subDistrictGroupsMap[key].antigensAllocated[vName] = (subDistrictGroupsMap[key].antigensAllocated[vName] || 0) + totalAuth;
    }
  }
  const subDistrictList = Object.values(subDistrictGroupsMap).sort((a, b) => a.subDistrictName.localeCompare(b.subDistrictName));

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls (Section 19) */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-[#5C2D91] text-white text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Section 19
              </span>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">
                Vaccine Allocation Operational Dashboard
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Live monitoring of DCO allocations, CCA dispatch velocity, stockout risks, and prevented errors.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            {onNavigateToTracker && (
              <button
                type="button"
                onClick={onNavigateToTracker}
                className="bg-purple-50 hover:bg-purple-100 text-[#5C2D91] border border-purple-200 text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Layers className="w-3.5 h-3.5" />
                Allocation Tracker
              </button>
            )}
            <button
              onClick={fetchData}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-slate-200"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh Data
            </button>
          </div>
        </div>

        {/* Filters: District and Sub-District are completely separated */}
        <div className="pt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Nest / Hub
            </label>
            <select
              value={selectedNest}
              onChange={e => setSelectedNest(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-xl font-medium outline-none text-slate-700"
            >
              <option value="all">All Nests ({nests.length})</option>
              {nests.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-[#5C2D91] block mb-1 flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              District
            </label>
            <select
              value={selectedDistrict}
              onChange={e => {
                setSelectedDistrict(e.target.value);
                setSelectedSubDistrict('all');
              }}
              className="w-full bg-purple-50/40 border border-purple-200 text-xs px-3 py-1.5 rounded-xl font-bold outline-none text-slate-800"
            >
              <option value="all">All Districts ({districts.length})</option>
              {districts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 block mb-1 flex items-center gap-1">
              <Layers className="w-3 h-3" />
              Sub-District
            </label>
            <select
              value={selectedSubDistrict}
              onChange={e => setSelectedSubDistrict(e.target.value)}
              className="w-full bg-indigo-50/40 border border-indigo-200 text-xs px-3 py-1.5 rounded-xl font-bold outline-none text-slate-800"
            >
              <option value="all">All Sub-Districts ({availableSubDistricts.length})</option>
              {availableSubDistricts.map(sd => <option key={sd} value={sd}>{sd}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Specific Antigen
            </label>
            <select
              value={selectedVaccine}
              onChange={e => setSelectedVaccine(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-xl font-medium outline-none text-slate-700"
            >
              <option value="all">All Vaccines ({allVaccineNames.length})</option>
              {allVaccineNames.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Allocation Cycle
            </label>
            <select
              value={selectedCycle}
              onChange={e => setSelectedCycle(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-xl font-medium outline-none text-slate-700"
            >
              <option value="all">All Cycles</option>
              {cycles.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Primary KPI Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Metric 1: Total Facilities */}
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Facilities Tracked</span>
            <div className="w-8 h-8 rounded-xl bg-purple-100 text-[#5C2D91] flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {filteredFacilities.length}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <span className="text-emerald-600 font-bold">{facilitiesWithRem} Active</span> &bull;{' '}
            <span className="text-rose-600 font-bold">{facilitiesExhausted} Exhausted</span>
          </div>
        </div>

        {/* Metric 2: Total Doses Allocated */}
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Allocated</span>
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {filterAllocated.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400">
            DCO Authorized Doses
          </div>
        </div>

        {/* Metric 3: Ordered / Taken */}
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Doses Consumed</span>
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {filterOrdered.toLocaleString()}
          </div>
          <div className="text-[11px] text-amber-700 font-bold">
            {consumptionPercent}% of allocation taken
          </div>
        </div>

        {/* Metric 4: Remaining Available */}
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Available Balance</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-700 tracking-tight">
            {filterRemaining.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400">
            Doses ready for order
          </div>
        </div>
      </div>

      {/* Safety & Prevention Metrics (Section 19: Errors Prevented & Duplicate Alerts) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-gradient-to-r from-emerald-900 to-emerald-950 text-white rounded-3xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
              Validation Errors Prevented
            </div>
            <div className="text-3xl font-black mt-1">
              {dashboardMetrics?.errorsPrevented || 0}
            </div>
            <div className="text-xs text-emerald-200/80 mt-0.5">
              Excess quantities, unallocated antigens, and missing items blocked at entry
            </div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-300">
            <ShieldCheck className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-gradient-to-r from-amber-900 to-amber-950 text-white rounded-3xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-amber-300 uppercase tracking-wider">
              Duplicate Orders Prevented
            </div>
            <div className="text-3xl font-black mt-1">
              {dashboardMetrics?.duplicateAlerts || 0}
            </div>
            <div className="text-xs text-amber-200/80 mt-0.5">
              Identical facility re-orders intercepted within 30-minute protection window
            </div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-amber-300">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SEPARATED DISTRICT & SUB-DISTRICT TABS NAVIGATION                         */}
      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
        {/* Tab Controls Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl">
            <button
              type="button"
              onClick={() => setDashboardTab('districts')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                dashboardTab === 'districts'
                  ? 'bg-[#5C2D91] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>Districts View</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                dashboardTab === 'districts' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {districtList.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setDashboardTab('sub_districts')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                dashboardTab === 'sub_districts'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Sub-Districts View</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                dashboardTab === 'sub_districts' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {subDistrictList.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setDashboardTab('antigens')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                dashboardTab === 'antigens'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Antigens Breakdown</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                dashboardTab === 'antigens' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {Object.keys(vaccineBreakdown).length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setDashboardTab('facilities')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                dashboardTab === 'facilities'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Facilities Matrix</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                dashboardTab === 'facilities' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {filteredFacilities.length}
              </span>
            </button>
          </div>

          <div className="text-xs text-slate-500 font-medium">
            {dashboardTab === 'districts' && 'Showing aggregated allocations by District'}
            {dashboardTab === 'sub_districts' && 'Showing independent breakdown by Sub-District'}
            {dashboardTab === 'antigens' && 'Showing antigen stock consumption and velocity'}
            {dashboardTab === 'facilities' && 'Showing facility-level quotas and allocated antigens'}
          </div>
        </div>

        {/* --------------------------------------------------------------------- */}
        {/* TAB 1: DISTRICTS VIEW                                                 */}
        {/* --------------------------------------------------------------------- */}
        {dashboardTab === 'districts' && (
          <div className="space-y-4">
            {districtList.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No districts match current filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {districtList.map(dg => {
                  const pct = dg.allocated > 0 ? Math.round((dg.taken / dg.allocated) * 100) : 0;
                  const isExpanded = expandedDistrict === dg.districtName;

                  return (
                    <div
                      key={dg.districtName}
                      className="border border-purple-200/80 bg-purple-50/20 hover:bg-purple-50/40 rounded-2xl p-5 space-y-4 transition-all"
                    >
                      {/* District Card Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="w-2.5 h-2.5 rounded-full bg-[#5C2D91]"></span>
                            <h4 className="text-base font-black text-slate-900 tracking-tight">
                              {dg.districtName}
                            </h4>
                            <span className="text-[10px] bg-purple-100 text-[#5C2D91] font-bold px-2 py-0.5 rounded-full">
                              {dg.nest}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-medium">
                            {dg.facilities.length} {dg.facilities.length === 1 ? 'facility' : 'facilities'} &bull;{' '}
                            {dg.subDistricts.length} {dg.subDistricts.length === 1 ? 'sub-district' : 'sub-districts'}
                          </p>
                        </div>

                        <div className="text-right">
                          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Remaining
                          </div>
                          <div className="text-lg font-black text-emerald-700">
                            {dg.remaining.toLocaleString()} <span className="text-xs font-normal text-slate-400">doses</span>
                          </div>
                        </div>
                      </div>

                      {/* District Metrics Bar */}
                      <div className="grid grid-cols-3 gap-2 bg-white/90 border border-slate-200/80 rounded-xl p-3 text-center">
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase">Allocated</div>
                          <div className="text-xs font-black text-slate-900">{dg.allocated.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-amber-600 uppercase">Taken</div>
                          <div className="text-xs font-black text-amber-700">{dg.taken.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-emerald-600 uppercase">Remaining</div>
                          <div className="text-xs font-black text-emerald-700">{dg.remaining.toLocaleString()}</div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div>
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
                          <span>District Quota Consumption</span>
                          <span className="font-bold text-slate-800">{pct}% Taken</span>
                        </div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              pct >= 100 ? 'bg-rose-600' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-600'
                            }`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Sub-Districts inside this District */}
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Sub-Districts in {dg.districtName}:
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {dg.subDistricts.length > 0 ? (
                            dg.subDistricts.map(sd => (
                              <button
                                key={sd}
                                type="button"
                                onClick={() => {
                                  setSelectedDistrict(dg.districtName);
                                  setSelectedSubDistrict(sd);
                                  setDashboardTab('sub_districts');
                                }}
                                className="text-[11px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded-lg border border-indigo-200 cursor-pointer transition-all flex items-center gap-1"
                              >
                                <Layers className="w-3 h-3 text-indigo-500" />
                                {sd}
                              </button>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400 italic">General / Central</span>
                          )}
                        </div>
                      </div>

                      {/* Vaccines Allocated across District */}
                      <div className="space-y-1.5 pt-1 border-t border-purple-100">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Vaccines Allocated:
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(dg.antigensAllocated).map(([vName, total]) => (
                            <span
                              key={vName}
                              className="text-[11px] bg-white border border-slate-200 font-bold px-2 py-0.5 rounded-lg text-slate-700 shadow-2xs"
                            >
                              {vName}: <span className="text-[#5C2D91]">{total}</span>
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Facilities Drilldown Button */}
                      <div className="pt-2 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setExpandedDistrict(isExpanded ? null : dg.districtName)}
                          className="text-xs font-bold text-[#5C2D91] hover:text-[#482372] flex items-center gap-1 cursor-pointer"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {isExpanded ? 'Hide Health Facilities' : `View ${dg.facilities.length} Health Facilities`}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDistrict(dg.districtName);
                            setDashboardTab('facilities');
                          }}
                          className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                        >
                          View in Matrix &rarr;
                        </button>
                      </div>

                      {/* Expanded Facilities List */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-purple-100 space-y-2">
                          {dg.facilities.map(fac => (
                            <div
                              key={fac.id}
                              className="p-2.5 bg-white rounded-xl border border-slate-200 text-xs flex items-center justify-between"
                            >
                              <div>
                                <div className="font-bold text-slate-900">{fac.facilityName}</div>
                                <div className="text-[11px] text-slate-400">
                                  {fac.subDistrict || 'Central'} &bull; {Object.keys(fac.vaccines).length} Vaccines
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {Object.entries(fac.vaccines).slice(0, 3).map(([v, a]) => (
                                  <span key={v} className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-bold text-slate-700">
                                    {v}: {a.original}
                                  </span>
                                ))}
                                {Object.keys(fac.vaccines).length > 3 && (
                                  <span className="text-[10px] text-slate-400 font-bold">
                                    +{Object.keys(fac.vaccines).length - 3}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* --------------------------------------------------------------------- */}
        {/* TAB 2: SUB-DISTRICTS VIEW (SEPARATED FROM DISTRICTS)                   */}
        {/* --------------------------------------------------------------------- */}
        {dashboardTab === 'sub_districts' && (
          <div className="space-y-4">
            <div className="p-3 bg-indigo-50/80 border border-indigo-200/80 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-700" />
                <span className="text-xs font-bold text-indigo-900">
                  Sub-Districts Operational Breakdown
                </span>
              </div>
              <span className="text-xs text-indigo-700 font-medium">
                {subDistrictList.length} active sub-districts tracked across districts
              </span>
            </div>

            {subDistrictList.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No sub-districts match current filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {subDistrictList.map(sd => {
                  const pct = sd.allocated > 0 ? Math.round((sd.taken / sd.allocated) * 100) : 0;
                  const isExpanded = expandedSubDistrict === sd.subDistrictName;

                  return (
                    <div
                      key={sd.subDistrictName + sd.districtName}
                      className="border border-indigo-200/80 bg-indigo-50/20 hover:bg-indigo-50/40 rounded-2xl p-5 space-y-4 transition-all"
                    >
                      {/* Sub-District Card Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
                            <h4 className="text-base font-black text-slate-900 tracking-tight">
                              {sd.subDistrictName}
                            </h4>
                            <span className="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full">
                              {sd.districtName}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-medium">
                            {sd.nest} &bull; {sd.facilities.length} {sd.facilities.length === 1 ? 'Health Facility' : 'Health Facilities'}
                          </p>
                        </div>

                        <div className="text-right">
                          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Available Stock
                          </div>
                          <div className="text-lg font-black text-emerald-700">
                            {sd.remaining.toLocaleString()} <span className="text-xs font-normal text-slate-400">doses</span>
                          </div>
                        </div>
                      </div>

                      {/* Sub-District Metrics Bar */}
                      <div className="grid grid-cols-3 gap-2 bg-white/90 border border-slate-200/80 rounded-xl p-3 text-center">
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase">Allocated</div>
                          <div className="text-xs font-black text-slate-900">{sd.allocated.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-amber-600 uppercase">Taken</div>
                          <div className="text-xs font-black text-amber-700">{sd.taken.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-emerald-600 uppercase">Remaining</div>
                          <div className="text-xs font-black text-emerald-700">{sd.remaining.toLocaleString()}</div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div>
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
                          <span>Sub-District Consumption Rate</span>
                          <span className="font-bold text-slate-800">{pct}% Taken</span>
                        </div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              pct >= 100 ? 'bg-rose-600' : pct >= 80 ? 'bg-amber-500' : 'bg-indigo-600'
                            }`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Vaccines Allocated across Sub-District */}
                      <div className="space-y-1.5 pt-1 border-t border-indigo-100">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Antigens Allocated in {sd.subDistrictName}:
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(sd.antigensAllocated).map(([vName, total]) => (
                            <span
                              key={vName}
                              className="text-[11px] bg-white border border-slate-200 font-bold px-2 py-0.5 rounded-lg text-slate-700 shadow-2xs"
                            >
                              {vName}: <span className="text-indigo-700">{total}</span>
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Facilities Drilldown Button */}
                      <div className="pt-2 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setExpandedSubDistrict(isExpanded ? null : sd.subDistrictName)}
                          className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 cursor-pointer"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {isExpanded ? 'Hide Health Facilities' : `View ${sd.facilities.length} Facilities`}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDistrict(sd.districtName);
                            setSelectedSubDistrict(sd.subDistrictName);
                            setDashboardTab('facilities');
                          }}
                          className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                        >
                          Facility Ledger &rarr;
                        </button>
                      </div>

                      {/* Expanded Facilities under Sub-District */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-indigo-100 space-y-2">
                          {sd.facilities.map(fac => (
                            <div
                              key={fac.id}
                              className="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-900">{fac.facilityName}</span>
                                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                                  {fac.cycle}
                                </span>
                              </div>
                              {/* Allocated Vaccines for this facility */}
                              <div className="flex flex-wrap gap-1 pt-1">
                                {Object.entries(fac.vaccines).map(([v, a]) => (
                                  <span
                                    key={v}
                                    className="text-[10px] bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded font-semibold text-slate-700"
                                  >
                                    {v}: <strong className="text-slate-900">{a.original}</strong> (rem: {a.remaining})
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* --------------------------------------------------------------------- */}
        {/* TAB 3: ANTIGEN BREAKDOWN                                              */}
        {/* --------------------------------------------------------------------- */}
        {dashboardTab === 'antigens' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {Object.entries(vaccineBreakdown).map(([vName, stat]) => {
                const pct = stat.allocated > 0 ? Math.round((stat.ordered / stat.allocated) * 100) : 0;
                const isExhausted = stat.remaining <= 0;

                return (
                  <div key={vName} className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#5C2D91]"></span>
                        {vName}
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isExhausted ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {isExhausted ? 'Exhausted' : `${stat.remaining} Rem.`}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          pct >= 100 ? 'bg-rose-600' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-600'
                        }`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      ></div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                      <span>Taken: <strong>{stat.ordered}</strong> / {stat.allocated}</span>
                      <span className="font-bold text-slate-700">{pct}%</span>
                    </div>

                    <div className="text-[10px] text-slate-400">
                      Allocated across {stat.facilitiesCount} {stat.facilitiesCount === 1 ? 'facility' : 'facilities'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* --------------------------------------------------------------------- */}
        {/* TAB 4: FACILITIES MATRIX VIEW                                         */}
        {/* --------------------------------------------------------------------- */}
        {dashboardTab === 'facilities' && (
          <div className="space-y-4">
            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Facility Name</th>
                    <th className="py-2.5 px-3">District</th>
                    <th className="py-2.5 px-3">Sub-District</th>
                    <th className="py-2.5 px-3">Allocated Vaccines &amp; Quotas</th>
                    <th className="py-2.5 px-3 text-right">Total Allocated</th>
                    <th className="py-2.5 px-3 text-right">Taken</th>
                    <th className="py-2.5 px-3 text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredFacilities.map(f => {
                    const totalAlloc = (Object.values(f.vaccines) as VaccineAllocationItem[]).reduce(
                      (acc, v) => acc + v.original + (v.adjustment || 0),
                      0
                    );
                    const totalTaken = (Object.values(f.vaccines) as VaccineAllocationItem[]).reduce(
                      (acc, v) => acc + v.taken,
                      0
                    );
                    const totalRem = (Object.values(f.vaccines) as VaccineAllocationItem[]).reduce(
                      (acc, v) => acc + v.remaining,
                      0
                    );

                    return (
                      <tr key={f.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900">{f.facilityName}</div>
                          <div className="text-[10px] text-slate-400">{f.nest} &bull; {f.cycle}</div>
                        </td>
                        <td className="py-3 px-3 font-semibold text-slate-700">{f.district}</td>
                        <td className="py-3 px-3">
                          <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                            {f.subDistrict || 'General'}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1 max-w-md">
                            {(Object.entries(f.vaccines) as [string, VaccineAllocationItem][]).map(([v, a]) => (
                              <span
                                key={v}
                                className="text-[10px] bg-slate-100 border border-slate-200/80 px-1.5 py-0.5 rounded font-bold text-slate-700"
                              >
                                {v}: <strong className="text-slate-900">{a.original + (a.adjustment || 0)}</strong>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-black text-slate-900">
                          {totalAlloc.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-amber-700">
                          {totalTaken.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right font-black text-emerald-700">
                          {totalRem.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
