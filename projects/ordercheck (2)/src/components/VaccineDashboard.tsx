/**
 * Vaccine Allocation Dashboard Component
 * Synchronized with the 67-Column Multi-District Allocation Blueprint
 * Implements Section 19:
 * - Operational & strategic KPI cards with live Blueprint sync
 * - Carry-over stock vs New Monthly Allocation vs Distributed vs Balance metrics
 * - Real-time metrics: Total facilities, active vs exhausted, total allocated vs taken
 * - Operational safety metrics: Validation errors prevented & duplicate orders caught
 * - Multi-dimensional filtering by Nest, District, Sub-District, Facility, Vaccine, and Month/Cycle
 * - Separated District & Sub-District operational view tabs
 * - Vaccine product breakdown cards & facility allocation matrix with Blueprint statuses
 */

import React, { useState, useEffect, useMemo } from 'react';
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
  ArrowRight,
  ExternalLink,
  Sparkles,
  Check,
  Boxes,
  Syringe,
  ShieldAlert
} from 'lucide-react';
import {
  FacilityAllocation,
  VaccineDashboardMetrics,
  VaccineAllocationItem,
  getVaccineDosesPerVial,
  isDeviceProduct,
  getProductUnit,
  getProductCategory,
  BlueprintDistrictSummary
} from '../types';

interface VaccineDashboardProps {
  onSelectFacilityForAudit?: (facilityId: string) => void;
  onNavigateToBlueprint?: (districtId?: string) => void;
}

export default function VaccineDashboard({ onSelectFacilityForAudit, onNavigateToBlueprint }: VaccineDashboardProps) {
  const [facilities, setFacilities] = useState<FacilityAllocation[]>([]);
  const [dashboardMetrics, setDashboardMetrics] = useState<VaccineDashboardMetrics | null>(null);
  const [blueprintDistricts, setBlueprintDistricts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>('');

  // Unit display switcher: 'both' | 'vials' | 'doses'
  const [unitDisplayMode, setUnitDisplayMode] = useState<'both' | 'vials' | 'doses'>('both');

  // Commodity category filter: 'vaccines' (Antigens) | 'devices' (Syringes & Consumables) | 'all'
  const [commodityFilter, setCommodityFilter] = useState<'vaccines' | 'devices' | 'all'>('vaccines');

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
      const [facRes, dashRes, bpRes] = await Promise.all([
        fetch('/api/vaccine/allocations'),
        fetch('/api/vaccine/dashboard'),
        fetch('/api/vaccine/blueprint-districts')
      ]);

      if (facRes.ok) setFacilities(await facRes.json());
      if (dashRes.ok) setDashboardMetrics(await dashRes.json());
      if (bpRes.ok) {
        const bpData = await bpRes.json();
        setBlueprintDistricts(bpData.districts || []);
      }
      setLastSyncedTime(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncFromBlueprint = async () => {
    setSyncing(true);
    try {
      const syncRes = await fetch('/api/vaccine/blueprint-districts/sync', { method: 'POST' });
      if (syncRes.ok) {
        await fetchData();
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Failed to sync blueprint to dashboard:', err);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Map blueprint rows for status lookup
  const blueprintRowMap = useMemo(() => {
    const map: Record<string, { processing: string; completed?: string; district: string; subDistrict?: string }> = {};
    for (const d of blueprintDistricts) {
      for (const r of (d.rows || [])) {
        if (r.facility && r.facility.trim()) {
          const normName = r.facility.trim().toLowerCase();
          map[normName] = {
            processing: r.processing || 'Pending',
            completed: r.completed || '',
            district: d.district || '',
            subDistrict: r.subDistrict || ''
          };
        }
      }
    }
    return map;
  }, [blueprintDistricts]);

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

  const allVaccineNames: string[] = Array.from(
    new Set<string>(facilities.flatMap(f => Object.keys(f.vaccines)))
  );

  const vaccineProducts = allVaccineNames.filter(n => !isDeviceProduct(n));
  const deviceProducts = allVaccineNames.filter(n => isDeviceProduct(n));

  // Filter facilities according to selected criteria
  const filteredFacilities = facilities.filter(f => {
    const matchNest = selectedNest === 'all' || f.nest === selectedNest;
    const matchDistrict = selectedDistrict === 'all' || f.district === selectedDistrict;
    const matchSubDistrict = selectedSubDistrict === 'all' || f.subDistrict === selectedSubDistrict;
    const matchCycle = selectedCycle === 'all' || f.cycle === selectedCycle;
    const matchVaccine = selectedVaccine === 'all' || Object.keys(f.vaccines).includes(selectedVaccine);
    return matchNest && matchDistrict && matchSubDistrict && matchCycle && matchVaccine;
  });

  // Calculate dynamic metrics for filtered facilities matching the 67-column blueprint formula
  let filterCarryOver = 0;
  let filterCarryOverDoses = 0;
  let filterMonthlyAlloc = 0;
  let filterMonthlyAllocDoses = 0;
  let filterAllocated = 0;
  let filterAllocatedDoses = 0;
  let filterOrdered = 0;
  let filterOrderedDoses = 0;
  let filterRemaining = 0;
  let filterRemainingDoses = 0;

  // Pure Vaccines (Antigens)
  let vaccineCarryOver = 0;
  let vaccineCarryOverDoses = 0;
  let vaccineMonthlyAlloc = 0;
  let vaccineMonthlyAllocDoses = 0;
  let vaccineAllocated = 0;
  let vaccineAllocatedDoses = 0;
  let vaccineOrdered = 0;
  let vaccineOrderedDoses = 0;
  let vaccineRemaining = 0;
  let vaccineRemainingDoses = 0;

  // Pure Injection Devices (Syringes & Consumables in pieces)
  let deviceCarryOver = 0;
  let deviceMonthlyAlloc = 0;
  let deviceAllocated = 0;
  let deviceOrdered = 0;
  let deviceRemaining = 0;

  let facilitiesWithRem = 0;
  let facilitiesExhausted = 0;

  const vaccineBreakdown: Record<string, {
    name: string;
    isDevice: boolean;
    carryOver: number;
    carryOverDoses: number;
    monthlyAlloc: number;
    monthlyAllocDoses: number;
    allocated: number;
    allocatedDoses: number;
    ordered: number;
    orderedDoses: number;
    remaining: number;
    remainingDoses: number;
    dosesPerVial: number;
    facilitiesCount: number;
  }> = {};

  for (const f of filteredFacilities) {
    let facHasRem = false;
    let facHasExhausted = false;

    for (const [vName, vAlloc] of Object.entries(f.vaccines) as [string, VaccineAllocationItem][]) {
      const isDevice = isDeviceProduct(vName);
      if (commodityFilter === 'vaccines' && isDevice) continue;
      if (commodityFilter === 'devices' && !isDevice) continue;
      if (selectedVaccine !== 'all' && vName !== selectedVaccine) continue;

      const dpv = isDevice ? 0 : (vAlloc.dosesPerVial || getVaccineDosesPerVial(vName));
      const carry = vAlloc.carryOver || 0;
      const carryD = isDevice ? 0 : (vAlloc.carryOverDoses !== undefined ? vAlloc.carryOverDoses : carry * dpv);
      const monthly = vAlloc.original || 0;
      const monthlyD = isDevice ? 0 : (vAlloc.originalDoses !== undefined ? vAlloc.originalDoses : monthly * dpv);
      const topUp = vAlloc.topUp || 0;
      const topUpD = isDevice ? 0 : (vAlloc.topUpDoses !== undefined ? vAlloc.topUpDoses : topUp * dpv);
      const adj = vAlloc.adjustment || 0;
      const adjD = isDevice ? 0 : (vAlloc.adjustmentDoses !== undefined ? vAlloc.adjustmentDoses : adj * dpv);

      const totalAuth = carry + monthly + topUp + adj;
      const totalAuthDoses = carryD + monthlyD + topUpD + adjD;
      const takenDoses = isDevice ? 0 : (vAlloc.takenDoses !== undefined ? vAlloc.takenDoses : vAlloc.taken * dpv);
      const remainingDoses = isDevice ? 0 : (vAlloc.remainingDoses !== undefined ? vAlloc.remainingDoses : vAlloc.remaining * dpv);

      filterCarryOver += carry;
      filterCarryOverDoses += carryD;
      filterMonthlyAlloc += monthly;
      filterMonthlyAllocDoses += monthlyD;
      filterAllocated += totalAuth;
      filterAllocatedDoses += totalAuthDoses;
      filterOrdered += vAlloc.taken;
      filterOrderedDoses += takenDoses;
      filterRemaining += vAlloc.remaining;
      filterRemainingDoses += remainingDoses;

      if (isDevice) {
        deviceCarryOver += carry;
        deviceMonthlyAlloc += monthly;
        deviceAllocated += totalAuth;
        deviceOrdered += vAlloc.taken;
        deviceRemaining += vAlloc.remaining;
      } else {
        vaccineCarryOver += carry;
        vaccineCarryOverDoses += carryD;
        vaccineMonthlyAlloc += monthly;
        vaccineMonthlyAllocDoses += monthlyD;
        vaccineAllocated += totalAuth;
        vaccineAllocatedDoses += totalAuthDoses;
        vaccineOrdered += vAlloc.taken;
        vaccineOrderedDoses += takenDoses;
        vaccineRemaining += vAlloc.remaining;
        vaccineRemainingDoses += remainingDoses;
      }

      if (vAlloc.remaining > 0) facHasRem = true;
      if (vAlloc.remaining === 0 && totalAuth > 0) facHasExhausted = true;

      if (!vaccineBreakdown[vName]) {
        vaccineBreakdown[vName] = {
          name: vName,
          isDevice,
          carryOver: 0,
          carryOverDoses: 0,
          monthlyAlloc: 0,
          monthlyAllocDoses: 0,
          allocated: 0,
          allocatedDoses: 0,
          ordered: 0,
          orderedDoses: 0,
          remaining: 0,
          remainingDoses: 0,
          dosesPerVial: dpv,
          facilitiesCount: 0
        };
      }
      vaccineBreakdown[vName].carryOver += carry;
      vaccineBreakdown[vName].carryOverDoses += carryD;
      vaccineBreakdown[vName].monthlyAlloc += monthly;
      vaccineBreakdown[vName].monthlyAllocDoses += monthlyD;
      vaccineBreakdown[vName].allocated += totalAuth;
      vaccineBreakdown[vName].allocatedDoses += totalAuthDoses;
      vaccineBreakdown[vName].ordered += vAlloc.taken;
      vaccineBreakdown[vName].orderedDoses += takenDoses;
      vaccineBreakdown[vName].remaining += vAlloc.remaining;
      vaccineBreakdown[vName].remainingDoses += remainingDoses;
      vaccineBreakdown[vName].facilitiesCount++;
    }

    if (facHasRem) facilitiesWithRem++;
    if (!facHasRem && facHasExhausted) facilitiesExhausted++;
  }

  const consumptionPercent = filterAllocated > 0 ? Math.round((filterOrdered / filterAllocated) * 100) : 0;

  // Compute District-level Aggregations mapped to Blueprint
  interface DistrictGroup {
    districtName: string;
    districtId?: string;
    nest: string;
    month?: string;
    subDistricts: string[];
    facilities: FacilityAllocation[];
    carryOver: number;
    carryOverDoses: number;
    monthlyAlloc: number;
    monthlyAllocDoses: number;
    allocated: number;
    allocatedDoses: number;
    taken: number;
    takenDoses: number;
    remaining: number;
    remainingDoses: number;
    antigensAllocated: Record<string, number>;
    blueprintSummary?: BlueprintDistrictSummary;
  }

  const districtGroupsMap: Record<string, DistrictGroup> = {};
  for (const f of filteredFacilities) {
    const dName = f.district || 'Unassigned District';
    if (!districtGroupsMap[dName]) {
      const bpSummary = dashboardMetrics?.blueprintSyncInfo?.districts?.find(
        bd => bd.district.toLowerCase() === dName.toLowerCase()
      );
      const bpDistrict = blueprintDistricts.find(
        bd => (bd.district || '').toLowerCase() === dName.toLowerCase()
      );

      districtGroupsMap[dName] = {
        districtName: dName,
        districtId: bpSummary?.id || bpDistrict?.id,
        nest: f.nest || 'Central Hub',
        month: bpSummary?.month || bpDistrict?.month || f.cycle || 'September 2026',
        subDistricts: [],
        facilities: [],
        carryOver: 0,
        carryOverDoses: 0,
        monthlyAlloc: 0,
        monthlyAllocDoses: 0,
        allocated: 0,
        allocatedDoses: 0,
        taken: 0,
        takenDoses: 0,
        remaining: 0,
        remainingDoses: 0,
        antigensAllocated: {},
        blueprintSummary: bpSummary
      };
    }
    if (f.subDistrict && !districtGroupsMap[dName].subDistricts.includes(f.subDistrict)) {
      districtGroupsMap[dName].subDistricts.push(f.subDistrict);
    }
    districtGroupsMap[dName].facilities.push(f);

    for (const [vName, vAlloc] of Object.entries(f.vaccines) as [string, VaccineAllocationItem][]) {
      const isDevice = isDeviceProduct(vName);
      if (commodityFilter === 'vaccines' && isDevice) continue;
      if (commodityFilter === 'devices' && !isDevice) continue;
      if (selectedVaccine !== 'all' && vName !== selectedVaccine) continue;

      const dpv = isDevice ? 0 : (vAlloc.dosesPerVial || getVaccineDosesPerVial(vName));
      const carry = vAlloc.carryOver || 0;
      const carryD = isDevice ? 0 : (vAlloc.carryOverDoses !== undefined ? vAlloc.carryOverDoses : carry * dpv);
      const monthly = vAlloc.original || 0;
      const monthlyD = isDevice ? 0 : (vAlloc.originalDoses !== undefined ? vAlloc.originalDoses : monthly * dpv);
      const topUp = vAlloc.topUp || 0;
      const topUpD = isDevice ? 0 : (vAlloc.topUpDoses !== undefined ? vAlloc.topUpDoses : topUp * dpv);
      const adj = vAlloc.adjustment || 0;
      const adjD = isDevice ? 0 : (vAlloc.adjustmentDoses !== undefined ? vAlloc.adjustmentDoses : adj * dpv);

      const totalAuth = carry + monthly + topUp + adj;
      const totalAuthDoses = carryD + monthlyD + topUpD + adjD;
      const takenD = isDevice ? 0 : (vAlloc.takenDoses !== undefined ? vAlloc.takenDoses : vAlloc.taken * dpv);
      const remD = isDevice ? 0 : (vAlloc.remainingDoses !== undefined ? vAlloc.remainingDoses : vAlloc.remaining * dpv);

      districtGroupsMap[dName].carryOver += carry;
      districtGroupsMap[dName].carryOverDoses += carryD;
      districtGroupsMap[dName].monthlyAlloc += monthly;
      districtGroupsMap[dName].monthlyAllocDoses += monthlyD;
      districtGroupsMap[dName].allocated += totalAuth;
      districtGroupsMap[dName].allocatedDoses += totalAuthDoses;
      districtGroupsMap[dName].taken += vAlloc.taken;
      districtGroupsMap[dName].takenDoses += takenD;
      districtGroupsMap[dName].remaining += vAlloc.remaining;
      districtGroupsMap[dName].remainingDoses += remD;
      districtGroupsMap[dName].antigensAllocated[vName] = (districtGroupsMap[dName].antigensAllocated[vName] || 0) + totalAuth;
    }
  }
  const districtList = Object.values(districtGroupsMap).sort((a, b) => a.districtName.localeCompare(b.districtName));

  // Compute Sub-District-level Aggregations
  interface SubDistrictGroup {
    subDistrictName: string;
    districtName: string;
    nest: string;
    facilities: FacilityAllocation[];
    carryOver: number;
    carryOverDoses: number;
    monthlyAlloc: number;
    monthlyAllocDoses: number;
    allocated: number;
    allocatedDoses: number;
    taken: number;
    takenDoses: number;
    remaining: number;
    remainingDoses: number;
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
        carryOver: 0,
        carryOverDoses: 0,
        monthlyAlloc: 0,
        monthlyAllocDoses: 0,
        allocated: 0,
        allocatedDoses: 0,
        taken: 0,
        takenDoses: 0,
        remaining: 0,
        remainingDoses: 0,
        antigensAllocated: {}
      };
    }
    subDistrictGroupsMap[key].facilities.push(f);

    for (const [vName, vAlloc] of Object.entries(f.vaccines) as [string, VaccineAllocationItem][]) {
      const isDevice = isDeviceProduct(vName);
      if (commodityFilter === 'vaccines' && isDevice) continue;
      if (commodityFilter === 'devices' && !isDevice) continue;
      if (selectedVaccine !== 'all' && vName !== selectedVaccine) continue;

      const dpv = isDevice ? 0 : (vAlloc.dosesPerVial || getVaccineDosesPerVial(vName));
      const carry = vAlloc.carryOver || 0;
      const carryD = isDevice ? 0 : (vAlloc.carryOverDoses !== undefined ? vAlloc.carryOverDoses : carry * dpv);
      const monthly = vAlloc.original || 0;
      const monthlyD = isDevice ? 0 : (vAlloc.originalDoses !== undefined ? vAlloc.originalDoses : monthly * dpv);
      const topUp = vAlloc.topUp || 0;
      const topUpD = isDevice ? 0 : (vAlloc.topUpDoses !== undefined ? vAlloc.topUpDoses : topUp * dpv);
      const adj = vAlloc.adjustment || 0;
      const adjD = isDevice ? 0 : (vAlloc.adjustmentDoses !== undefined ? vAlloc.adjustmentDoses : adj * dpv);

      const totalAuth = carry + monthly + topUp + adj;
      const totalAuthDoses = carryD + monthlyD + topUpD + adjD;
      const takenD = isDevice ? 0 : (vAlloc.takenDoses !== undefined ? vAlloc.takenDoses : vAlloc.taken * dpv);
      const remD = isDevice ? 0 : (vAlloc.remainingDoses !== undefined ? vAlloc.remainingDoses : vAlloc.remaining * dpv);

      subDistrictGroupsMap[key].carryOver += carry;
      subDistrictGroupsMap[key].carryOverDoses += carryD;
      subDistrictGroupsMap[key].monthlyAlloc += monthly;
      subDistrictGroupsMap[key].monthlyAllocDoses += monthlyD;
      subDistrictGroupsMap[key].allocated += totalAuth;
      subDistrictGroupsMap[key].allocatedDoses += totalAuthDoses;
      subDistrictGroupsMap[key].taken += vAlloc.taken;
      subDistrictGroupsMap[key].takenDoses += takenD;
      subDistrictGroupsMap[key].remaining += vAlloc.remaining;
      subDistrictGroupsMap[key].remainingDoses += remD;
      subDistrictGroupsMap[key].antigensAllocated[vName] = (subDistrictGroupsMap[key].antigensAllocated[vName] || 0) + totalAuth;
    }
  }
  const subDistrictList = Object.values(subDistrictGroupsMap).sort((a, b) => a.subDistrictName.localeCompare(b.subDistrictName));

  const syncInfo = dashboardMetrics?.blueprintSyncInfo;

  return (
    <div className="space-y-6">
      {/* Real-time Allocation Blueprint Live Sync Banner */}
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 text-white rounded-3xl p-5 shadow-sm border border-purple-800/60">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 text-[11px] font-bold px-3 py-0.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Live Synced with Allocation Blueprint
              </span>
              <span className="bg-white/10 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full">
                67-Column Standard
              </span>
              {lastSyncedTime && (
                <span className="text-[11px] text-purple-200/80">
                  Last updated {lastSyncedTime}
                </span>
              )}
            </div>

            <h3 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
              Vaccine Allocation Operational Dashboard
            </h3>

            <p className="text-xs text-purple-200/90 max-w-3xl">
              Real-time synchronization across all multi-district sheets. Metrics reflect live carry-over stock,
              monthly supply quotas, verified orders, and remaining balances matching the authoritative blueprint.
            </p>

            {/* Quick District Chips */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider">
                Districts Synced ({syncInfo?.totalDistricts || districtList.length}):
              </span>
              {(syncInfo?.districts || districtList.map(d => ({ id: d.districtId, district: d.districtName, month: d.month }))).map((d: any) => (
                <button
                  key={d.id || d.district}
                  type="button"
                  onClick={() => {
                    setSelectedDistrict(d.district);
                    setDashboardTab('districts');
                  }}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer flex items-center gap-1 ${
                    selectedDistrict === d.district
                      ? 'bg-[#C55A11] text-white border-orange-300 shadow-xs'
                      : 'bg-white/10 hover:bg-white/20 text-purple-100 border-white/20'
                  }`}
                >
                  <MapPin className="w-3 h-3 text-orange-300" />
                  {d.district}
                  {d.month && <span className="opacity-70 text-[10px]">({d.month})</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap self-start lg:self-center">
            {onNavigateToBlueprint && (
              <button
                type="button"
                onClick={() => onNavigateToBlueprint()}
                className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Open Blueprint Sheet</span>
              </button>
            )}

            <button
              type="button"
              disabled={syncing || loading}
              onClick={handleSyncFromBlueprint}
              className={`bg-white/15 hover:bg-white/25 text-white border border-white/20 text-xs font-bold px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                syncing ? 'opacity-70' : ''
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${syncing || loading ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : syncSuccess ? 'Synced!' : 'Sync Blueprint'}</span>
            </button>
          </div>
        </div>

        {/* Blueprint Status Tracker Pills */}
        {syncInfo && (
          <div className="mt-4 pt-4 border-t border-purple-800/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-white/5 rounded-xl p-2.5 border border-white/10">
              <div className="text-[10px] uppercase font-bold text-purple-300">Total Blueprint Facilities</div>
              <div className="text-lg font-black text-white">{syncInfo.totalBlueprintFacilities || filteredFacilities.length}</div>
            </div>
            <div className="bg-emerald-500/10 rounded-xl p-2.5 border border-emerald-400/20">
              <div className="text-[10px] uppercase font-bold text-emerald-300">Completed Audits</div>
              <div className="text-lg font-black text-emerald-300">{syncInfo.completedFacilities} Facilities</div>
            </div>
            <div className="bg-amber-500/10 rounded-xl p-2.5 border border-amber-400/20">
              <div className="text-[10px] uppercase font-bold text-amber-300">In Progress Audits</div>
              <div className="text-lg font-black text-amber-300">{syncInfo.inProgressFacilities} Facilities</div>
            </div>
            <div className="bg-slate-500/10 rounded-xl p-2.5 border border-slate-400/20">
              <div className="text-[10px] uppercase font-bold text-slate-300">Pending Audits</div>
              <div className="text-lg font-black text-slate-300">{syncInfo.pendingFacilities} Facilities</div>
            </div>
          </div>
        )}
      </div>

      {/* Header & Filter Controls */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        {/* Top bar: Title + Commodity Segmented Switcher + Unit Toggle + Refresh */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-[#5C2D91] text-white text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Operational Controls
              </span>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">
                Allocation &amp; Logistics Inventory
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Synchronized with Multi-District Blueprint formula: <span className="font-semibold text-slate-700">Total Auth = Carry-Over + Monthly Alloc + TopUp + Adjustment</span>.
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start lg:self-auto flex-wrap">
            {/* Unit display selector (Active for Vaccines) */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase px-2">Unit:</span>
              <button
                type="button"
                onClick={() => setUnitDisplayMode('both')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  unitDisplayMode === 'both' ? 'bg-[#5C2D91] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Both
              </button>
              <button
                type="button"
                onClick={() => setUnitDisplayMode('vials')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  unitDisplayMode === 'vials' ? 'bg-[#5C2D91] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Vials
              </button>
              <button
                type="button"
                onClick={() => setUnitDisplayMode('doses')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  unitDisplayMode === 'doses' ? 'bg-[#5C2D91] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Doses
              </button>
            </div>

            <button
              onClick={fetchData}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-slate-200"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Commodity Category Segmented Selector */}
        <div className="flex items-center justify-between gap-3 pb-1 flex-wrap">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-2xl border border-slate-200/80">
            <button
              type="button"
              onClick={() => {
                setCommodityFilter('vaccines');
                if (selectedVaccine !== 'all' && isDeviceProduct(selectedVaccine)) {
                  setSelectedVaccine('all');
                }
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                commodityFilter === 'vaccines'
                  ? 'bg-[#5C2D91] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Vaccine Antigens</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                commodityFilter === 'vaccines' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {vaccineProducts.length} Items (Vials &amp; Doses)
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCommodityFilter('devices');
                if (selectedVaccine !== 'all' && !isDeviceProduct(selectedVaccine)) {
                  setSelectedVaccine('all');
                }
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                commodityFilter === 'devices'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Injection Devices &amp; Syringes</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                commodityFilter === 'devices' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {deviceProducts.length} Items (Pieces)
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCommodityFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                commodityFilter === 'all'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>All Commodities</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                commodityFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {allVaccineNames.length} Combined
              </span>
            </button>
          </div>

          <div className="text-xs font-medium text-slate-500">
            {commodityFilter === 'vaccines' && (
              <span className="text-purple-700 font-bold bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-lg">
                Dose multiplier active for clinical antigens
              </span>
            )}
            {commodityFilter === 'devices' && (
              <span className="text-sky-700 font-bold bg-sky-50 border border-sky-200 px-2.5 py-1 rounded-lg">
                Measured in physical units/pieces (No dose multiplication)
              </span>
            )}
            {commodityFilter === 'all' && (
              <span className="text-slate-700 font-bold bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                Consolidated Supply Chain View
              </span>
            )}
          </div>
        </div>

        {/* Multi-Dimensional Filters */}
        <div className="pt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 border-t border-slate-100">
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
              {commodityFilter === 'devices' ? 'Specific Device' : 'Specific Antigen'}
            </label>
            <select
              value={selectedVaccine}
              onChange={e => setSelectedVaccine(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-xl font-medium outline-none text-slate-700"
            >
              <option value="all">
                {commodityFilter === 'vaccines'
                  ? `All Vaccines (${vaccineProducts.length})`
                  : commodityFilter === 'devices'
                  ? `All Devices (${deviceProducts.length})`
                  : `All Commodities (${allVaccineNames.length})`}
              </option>
              {commodityFilter === 'vaccines' && vaccineProducts.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
              {commodityFilter === 'devices' && deviceProducts.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
              {commodityFilter === 'all' && (
                <>
                  <optgroup label="Vaccine Antigens (Vials &amp; Doses)">
                    {vaccineProducts.map(v => <option key={v} value={v}>{v}</option>)}
                  </optgroup>
                  <optgroup label="Injection Devices (Pieces)">
                    {deviceProducts.map(v => <option key={v} value={v}>{v}</option>)}
                  </optgroup>
                </>
              )}
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

      {/* Primary KPI Metrics Grid with Carry-Over & Blueprint Breakdown */}
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

        {/* Metric 2: Total Available Quota (Carry-over + Monthly Allocation) */}
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {commodityFilter === 'devices' ? 'Total Available Devices' : 'Total Available Quota'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {commodityFilter === 'devices' ? (
              <>
                {filterAllocated.toLocaleString()}
                <span className="text-xs font-bold text-slate-400 ml-1">pcs</span>
              </>
            ) : commodityFilter === 'all' ? (
              <div className="text-lg font-black leading-tight">
                <span>{vaccineAllocated.toLocaleString()} <span className="text-xs font-bold text-slate-400">vials</span></span>
                <span className="text-slate-300 mx-1">+</span>
                <span>{deviceAllocated.toLocaleString()} <span className="text-xs font-bold text-slate-400">pcs</span></span>
              </div>
            ) : unitDisplayMode === 'doses' ? (
              <>
                {filterAllocatedDoses.toLocaleString()}
                <span className="text-xs font-bold text-slate-400 ml-1">doses</span>
              </>
            ) : (
              <>
                {filterAllocated.toLocaleString()}
                <span className="text-xs font-bold text-slate-400 ml-1">vials</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500 flex items-center gap-1 flex-wrap">
            {commodityFilter === 'devices' ? (
              <>
                <span className="text-indigo-600 font-bold">{filterCarryOver.toLocaleString()} pcs carry-over</span>
                <span>+</span>
                <span className="text-blue-600 font-bold">{filterMonthlyAlloc.toLocaleString()} pcs new</span>
              </>
            ) : commodityFilter === 'all' ? (
              <span className="text-purple-700 font-bold">
                {vaccineAllocatedDoses.toLocaleString()} doses &bull; {filterCarryOver.toLocaleString()} carry + {filterMonthlyAlloc.toLocaleString()} new
              </span>
            ) : (
              <>
                <span className="text-indigo-600 font-bold">
                  {unitDisplayMode === 'doses' ? `${filterCarryOverDoses.toLocaleString()}d` : `${filterCarryOver.toLocaleString()}v`} carry-over
                </span>
                <span>+</span>
                <span className="text-blue-600 font-bold">
                  {unitDisplayMode === 'doses' ? `${filterMonthlyAllocDoses.toLocaleString()}d` : `${filterMonthlyAlloc.toLocaleString()}v`} new
                </span>
              </>
            )}
          </div>
        </div>

        {/* Metric 3: Ordered / Taken */}
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {commodityFilter === 'devices' ? 'Devices Distributed' : 'Stock Distributed'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {commodityFilter === 'devices' ? (
              <>
                {filterOrdered.toLocaleString()}
                <span className="text-xs font-bold text-slate-400 ml-1">pcs</span>
              </>
            ) : commodityFilter === 'all' ? (
              <div className="text-lg font-black leading-tight">
                <span>{vaccineOrdered.toLocaleString()} <span className="text-xs font-bold text-slate-400">vials</span></span>
                <span className="text-slate-300 mx-1">+</span>
                <span>{deviceOrdered.toLocaleString()} <span className="text-xs font-bold text-slate-400">pcs</span></span>
              </div>
            ) : unitDisplayMode === 'doses' ? (
              <>
                {filterOrderedDoses.toLocaleString()}
                <span className="text-xs font-bold text-slate-400 ml-1">doses</span>
              </>
            ) : (
              <>
                {filterOrdered.toLocaleString()}
                <span className="text-xs font-bold text-slate-400 ml-1">vials</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-amber-700 font-bold">
            {commodityFilter === 'devices' ? (
              <span>{consumptionPercent}% of devices taken</span>
            ) : commodityFilter === 'all' ? (
              <span>{vaccineOrderedDoses.toLocaleString()} doses &bull; {consumptionPercent}% taken</span>
            ) : unitDisplayMode === 'both' ? (
              <span>({filterOrderedDoses.toLocaleString()} doses &bull; {consumptionPercent}%)</span>
            ) : (
              <span>{consumptionPercent}% of quota taken</span>
            )}
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
            {commodityFilter === 'devices' ? (
              <>
                {filterRemaining.toLocaleString()}
                <span className="text-xs font-bold text-emerald-600/70 ml-1">pcs</span>
              </>
            ) : commodityFilter === 'all' ? (
              <div className="text-lg font-black leading-tight">
                <span>{vaccineRemaining.toLocaleString()} <span className="text-xs font-bold text-emerald-600/70">vials</span></span>
                <span className="text-slate-300 mx-1">+</span>
                <span>{deviceRemaining.toLocaleString()} <span className="text-xs font-bold text-emerald-600/70">pcs</span></span>
              </div>
            ) : unitDisplayMode === 'doses' ? (
              <>
                {filterRemainingDoses.toLocaleString()}
                <span className="text-xs font-bold text-emerald-600/70 ml-1">doses</span>
              </>
            ) : (
              <>
                {filterRemaining.toLocaleString()}
                <span className="text-xs font-bold text-emerald-600/70 ml-1">vials</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-emerald-600 font-medium">
            {commodityFilter === 'devices' ? (
              <span>Ready for facility dispatch</span>
            ) : commodityFilter === 'all' ? (
              <span>{vaccineRemainingDoses.toLocaleString()} doses ready for dispatch</span>
            ) : unitDisplayMode === 'both' ? (
              <span>({filterRemainingDoses.toLocaleString()} doses ready)</span>
            ) : (
              <span>Ready for dispatch</span>
            )}
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
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl flex-wrap">
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
            {dashboardTab === 'districts' && 'Showing live Blueprint district sheets and aggregate quotas'}
            {dashboardTab === 'sub_districts' && 'Showing independent breakdown by Sub-District'}
            {dashboardTab === 'antigens' && 'Showing antigen stock consumption and velocity'}
            {dashboardTab === 'facilities' && 'Showing facility-level quotas, balances, and audit status'}
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
                  const bpSum = dg.blueprintSummary;

                  return (
                    <div
                      key={dg.districtName}
                      className="border border-purple-200/80 bg-purple-50/20 hover:bg-purple-50/40 rounded-2xl p-5 space-y-4 transition-all shadow-2xs"
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
                            <span className="text-[10px] bg-orange-100 text-[#C55A11] font-bold px-2 py-0.5 rounded-full">
                              {dg.month}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-medium">
                            {dg.facilities.length} {dg.facilities.length === 1 ? 'facility' : 'facilities'} &bull;{' '}
                            {dg.subDistricts.length} {dg.subDistricts.length === 1 ? 'sub-district' : 'sub-districts'}
                            {bpSum && (
                              <span className="ml-1 text-slate-400">
                                ({bpSum.completedCount} completed &bull; {bpSum.inProgressCount} in progress)
                              </span>
                            )}
                          </p>
                        </div>

                        <div className="text-right">
                          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Remaining
                          </div>
                          <div className="text-lg font-black text-emerald-700">
                            {commodityFilter === 'devices'
                              ? `${dg.remaining.toLocaleString()} pcs`
                              : commodityFilter === 'all'
                              ? `${dg.remaining.toLocaleString()} units`
                              : unitDisplayMode === 'doses'
                              ? `${dg.remainingDoses.toLocaleString()} doses`
                              : `${dg.remaining.toLocaleString()} vials`}
                          </div>
                          {commodityFilter === 'vaccines' && unitDisplayMode === 'both' && (
                            <div className="text-[11px] font-semibold text-emerald-600/80">
                              {dg.remainingDoses.toLocaleString()} doses
                            </div>
                          )}
                        </div>
                      </div>

                      {/* District Breakdown: Carry-over vs New Monthly vs Taken vs Remaining */}
                      <div className="grid grid-cols-4 gap-2 bg-white/90 border border-slate-200/80 rounded-xl p-3 text-center">
                        <div>
                          <div className="text-[9px] font-bold text-indigo-600 uppercase">Carry-Over</div>
                          <div className="text-xs font-black text-indigo-800">
                            {commodityFilter === 'devices'
                              ? `${dg.carryOver.toLocaleString()} pcs`
                              : commodityFilter === 'all'
                              ? `${dg.carryOver.toLocaleString()} u`
                              : unitDisplayMode === 'doses'
                              ? `${dg.carryOverDoses.toLocaleString()} d`
                              : `${dg.carryOver.toLocaleString()} v`}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-blue-600 uppercase">Monthly Alloc</div>
                          <div className="text-xs font-black text-blue-800">
                            {commodityFilter === 'devices'
                              ? `${dg.monthlyAlloc.toLocaleString()} pcs`
                              : commodityFilter === 'all'
                              ? `${dg.monthlyAlloc.toLocaleString()} u`
                              : unitDisplayMode === 'doses'
                              ? `${dg.monthlyAllocDoses.toLocaleString()} d`
                              : `${dg.monthlyAlloc.toLocaleString()} v`}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-amber-600 uppercase">Distributed</div>
                          <div className="text-xs font-black text-amber-700">
                            {commodityFilter === 'devices'
                              ? `${dg.taken.toLocaleString()} pcs`
                              : commodityFilter === 'all'
                              ? `${dg.taken.toLocaleString()} u`
                              : unitDisplayMode === 'doses'
                              ? `${dg.takenDoses.toLocaleString()} d`
                              : `${dg.taken.toLocaleString()} v`}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-emerald-600 uppercase">Balance</div>
                          <div className="text-xs font-black text-emerald-700">
                            {commodityFilter === 'devices'
                              ? `${dg.remaining.toLocaleString()} pcs`
                              : commodityFilter === 'all'
                              ? `${dg.remaining.toLocaleString()} u`
                              : unitDisplayMode === 'doses'
                              ? `${dg.remainingDoses.toLocaleString()} d`
                              : `${dg.remaining.toLocaleString()} v`}
                          </div>
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
                          Vaccines Available:
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                          {Object.entries(dg.antigensAllocated).map(([vName, total]) => (
                            <span
                              key={vName}
                              className="text-[10px] bg-white border border-slate-200 font-bold px-2 py-0.5 rounded-lg text-slate-700 shadow-2xs"
                            >
                              {vName}: <span className="text-[#5C2D91]">{total}</span>
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* District Footer Actions */}
                      <div className="pt-2 flex items-center justify-between border-t border-purple-100">
                        <button
                          type="button"
                          onClick={() => setExpandedDistrict(isExpanded ? null : dg.districtName)}
                          className="text-xs font-bold text-[#5C2D91] hover:text-[#482372] flex items-center gap-1 cursor-pointer"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {isExpanded ? 'Hide Health Facilities' : `View ${dg.facilities.length} Health Facilities`}
                        </button>

                        <div className="flex items-center gap-2">
                          {onNavigateToBlueprint && dg.districtId && (
                            <button
                              type="button"
                              onClick={() => onNavigateToBlueprint(dg.districtId)}
                              className="text-xs font-bold text-[#C55A11] hover:text-orange-700 flex items-center gap-1 cursor-pointer bg-orange-50 px-2.5 py-1 rounded-lg border border-orange-200"
                            >
                              <FileSpreadsheet className="w-3 h-3" />
                              Open Blueprint
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDistrict(dg.districtName);
                              setDashboardTab('facilities');
                            }}
                            className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                          >
                            View Matrix &rarr;
                          </button>
                        </div>
                      </div>

                      {/* Expanded Facilities List */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-purple-100 space-y-2">
                          {dg.facilities.map(fac => {
                            const bpFac = blueprintRowMap[fac.facilityName.toLowerCase()];
                            return (
                              <div
                                key={fac.id}
                                className="p-2.5 bg-white rounded-xl border border-slate-200 text-xs flex items-center justify-between"
                              >
                                <div>
                                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                    {fac.facilityName}
                                    {bpFac && (
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                        bpFac.processing === 'Completed'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : bpFac.processing === 'In Progress'
                                          ? 'bg-amber-100 text-amber-800'
                                          : 'bg-slate-100 text-slate-600'
                                      }`}>
                                        {bpFac.processing}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {fac.subDistrict || 'Central'} &bull; {Object.keys(fac.vaccines).length} Products
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
                            );
                          })}
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
        {/* TAB 2: SUB-DISTRICTS VIEW                                             */}
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
                {subDistrictList.map(sdg => {
                  const pct = sdg.allocated > 0 ? Math.round((sdg.taken / sdg.allocated) * 100) : 0;
                  const isExpanded = expandedSubDistrict === `${sdg.districtName}__${sdg.subDistrictName}`;

                  return (
                    <div
                      key={`${sdg.districtName}__${sdg.subDistrictName}`}
                      className="border border-indigo-200/80 bg-indigo-50/20 hover:bg-indigo-50/40 rounded-2xl p-5 space-y-4 transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
                            <h4 className="text-base font-black text-slate-900 tracking-tight">
                              {sdg.subDistrictName}
                            </h4>
                            <span className="text-[10px] bg-purple-100 text-[#5C2D91] font-bold px-2 py-0.5 rounded-full">
                              {sdg.districtName}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-medium">
                            {sdg.facilities.length} {sdg.facilities.length === 1 ? 'facility' : 'facilities'}
                          </p>
                        </div>

                        <div className="text-right">
                          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Remaining
                          </div>
                          <div className="text-lg font-black text-emerald-700">
                            {commodityFilter === 'devices'
                              ? `${sdg.remaining.toLocaleString()} pcs`
                              : commodityFilter === 'all'
                              ? `${sdg.remaining.toLocaleString()} units`
                              : unitDisplayMode === 'doses'
                              ? `${sdg.remainingDoses.toLocaleString()} doses`
                              : `${sdg.remaining.toLocaleString()} vials`}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 bg-white/90 border border-slate-200/80 rounded-xl p-3 text-center">
                        <div>
                          <div className="text-[9px] font-bold text-indigo-600 uppercase">Carry-Over</div>
                          <div className="text-xs font-black text-indigo-800">
                            {commodityFilter === 'devices'
                              ? `${sdg.carryOver.toLocaleString()} pcs`
                              : commodityFilter === 'all'
                              ? `${sdg.carryOver.toLocaleString()} u`
                              : unitDisplayMode === 'doses'
                              ? `${sdg.carryOverDoses.toLocaleString()} d`
                              : `${sdg.carryOver.toLocaleString()} v`}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-blue-600 uppercase">Monthly Alloc</div>
                          <div className="text-xs font-black text-blue-800">
                            {commodityFilter === 'devices'
                              ? `${sdg.monthlyAlloc.toLocaleString()} pcs`
                              : commodityFilter === 'all'
                              ? `${sdg.monthlyAlloc.toLocaleString()} u`
                              : unitDisplayMode === 'doses'
                              ? `${sdg.monthlyAllocDoses.toLocaleString()} d`
                              : `${sdg.monthlyAlloc.toLocaleString()} v`}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-amber-600 uppercase">Distributed</div>
                          <div className="text-xs font-black text-amber-700">
                            {commodityFilter === 'devices'
                              ? `${sdg.taken.toLocaleString()} pcs`
                              : commodityFilter === 'all'
                              ? `${sdg.taken.toLocaleString()} u`
                              : unitDisplayMode === 'doses'
                              ? `${sdg.takenDoses.toLocaleString()} d`
                              : `${sdg.taken.toLocaleString()} v`}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-emerald-600 uppercase">Balance</div>
                          <div className="text-xs font-black text-emerald-700">
                            {commodityFilter === 'devices'
                              ? `${sdg.remaining.toLocaleString()} pcs`
                              : commodityFilter === 'all'
                              ? `${sdg.remaining.toLocaleString()} u`
                              : unitDisplayMode === 'doses'
                              ? `${sdg.remainingDoses.toLocaleString()} d`
                              : `${sdg.remaining.toLocaleString()} v`}
                          </div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div>
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
                          <span>Sub-District Consumption</span>
                          <span className="font-bold text-slate-800">{pct}%</span>
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

                      <div className="pt-2 flex items-center justify-between border-t border-indigo-100">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSubDistrict(
                              isExpanded ? null : `${sdg.districtName}__${sdg.subDistrictName}`
                            )
                          }
                          className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 cursor-pointer"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {isExpanded ? 'Hide Facilities' : `View ${sdg.facilities.length} Facilities`}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-indigo-100 space-y-2">
                          {sdg.facilities.map(fac => (
                            <div
                              key={fac.id}
                              className="p-2.5 bg-white rounded-xl border border-slate-200 text-xs flex items-center justify-between"
                            >
                              <div className="font-bold text-slate-900">{fac.facilityName}</div>
                              <div className="text-emerald-700 font-bold">
                                {Object.values(fac.vaccines).reduce((acc, v) => acc + v.remaining, 0)} vials rem.
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
        {/* TAB 3: ANTIGEN & PRODUCT BREAKDOWN                                    */}
        {/* --------------------------------------------------------------------- */}
        {dashboardTab === 'antigens' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {Object.entries(vaccineBreakdown).map(([vName, stat]) => {
                const pct = stat.allocated > 0 ? Math.round((stat.ordered / stat.allocated) * 100) : 0;
                const isExhausted = stat.remaining <= 0;
                const isDev = stat.isDevice || isDeviceProduct(vName);

                return (
                  <div key={vName} className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${isDev ? 'bg-sky-500' : 'bg-[#5C2D91]'}`}></span>
                        <span className="truncate max-w-[180px]" title={vName}>{vName}</span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isExhausted
                          ? 'bg-rose-100 text-rose-800'
                          : isDev
                          ? 'bg-sky-100 text-sky-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {isExhausted
                          ? 'Exhausted'
                          : isDev
                          ? `${stat.remaining.toLocaleString()} pcs Rem.`
                          : unitDisplayMode === 'doses'
                          ? `${stat.remainingDoses.toLocaleString()} doses Rem.`
                          : unitDisplayMode === 'both'
                          ? `${stat.remaining.toLocaleString()} v (${stat.remainingDoses.toLocaleString()} d) Rem.`
                          : `${stat.remaining.toLocaleString()} v Rem.`}
                      </span>
                    </div>

                    {/* Breakdown Numbers */}
                    <div className="grid grid-cols-3 gap-1.5 bg-white border border-slate-200/70 rounded-xl p-2 text-center text-[10px]">
                      <div>
                        <span className="text-indigo-600 font-bold block">Carry-Over</span>
                        <strong className="text-slate-800">
                          {isDev
                            ? `${stat.carryOver.toLocaleString()} pcs`
                            : unitDisplayMode === 'doses'
                            ? `${stat.carryOverDoses.toLocaleString()} d`
                            : `${stat.carryOver.toLocaleString()} v`}
                        </strong>
                      </div>
                      <div>
                        <span className="text-blue-600 font-bold block">Monthly Alloc</span>
                        <strong className="text-slate-800">
                          {isDev
                            ? `${stat.monthlyAlloc.toLocaleString()} pcs`
                            : unitDisplayMode === 'doses'
                            ? `${stat.monthlyAllocDoses.toLocaleString()} d`
                            : `${stat.monthlyAlloc.toLocaleString()} v`}
                        </strong>
                      </div>
                      <div>
                        <span className="text-amber-600 font-bold block">Distributed</span>
                        <strong className="text-amber-700">
                          {isDev
                            ? `${stat.ordered.toLocaleString()} pcs`
                            : unitDisplayMode === 'doses'
                            ? `${stat.orderedDoses.toLocaleString()} d`
                            : `${stat.ordered.toLocaleString()} v`}
                        </strong>
                      </div>
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
                      <span>
                        Total Quota:{' '}
                        <strong>
                          {isDev
                            ? `${stat.allocated.toLocaleString()} pcs`
                            : unitDisplayMode === 'doses'
                            ? `${stat.allocatedDoses.toLocaleString()} d`
                            : `${stat.allocated.toLocaleString()} v`}
                        </strong>
                      </span>
                      <span className="font-bold text-slate-700">{pct}% taken</span>
                    </div>

                    <div className="text-[10px] text-slate-400 flex items-center justify-between">
                      <span>{stat.facilitiesCount} {stat.facilitiesCount === 1 ? 'facility' : 'facilities'}</span>
                      <span className="font-semibold text-slate-500">
                        {isDev ? 'Device' : `${stat.dosesPerVial} doses/vial`}
                      </span>
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
                    <th className="py-2.5 px-3">District &amp; Sub-District</th>
                    <th className="py-2.5 px-3">Blueprint Status</th>
                    <th className="py-2.5 px-3 text-right">Carry-Over</th>
                    <th className="py-2.5 px-3 text-right">Monthly Alloc</th>
                    <th className="py-2.5 px-3 text-right">Distributed (Taken)</th>
                    <th className="py-2.5 px-3 text-right">Remaining Balance</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredFacilities.map(f => {
                    const bpFac = blueprintRowMap[f.facilityName.toLowerCase()];
                    const facEntries = (Object.entries(f.vaccines) as [string, VaccineAllocationItem][]).filter(([vName]) => {
                      const isDev = isDeviceProduct(vName);
                      if (commodityFilter === 'vaccines' && isDev) return false;
                      if (commodityFilter === 'devices' && !isDev) return false;
                      if (selectedVaccine !== 'all' && vName !== selectedVaccine) return false;
                      return true;
                    });

                    const totalCarry = facEntries.reduce((acc, [, v]) => acc + (v.carryOver || 0), 0);
                    const totalMonthly = facEntries.reduce((acc, [, v]) => acc + (v.original || 0), 0);
                    const totalTaken = facEntries.reduce((acc, [, v]) => acc + (v.taken || 0), 0);
                    const totalRem = facEntries.reduce((acc, [, v]) => acc + (v.remaining || 0), 0);

                    const totalCarryD = facEntries.reduce((acc, [vName, v]) => {
                      if (isDeviceProduct(vName)) return acc;
                      const dpv = v.dosesPerVial || getVaccineDosesPerVial(vName);
                      return acc + (v.carryOverDoses !== undefined ? v.carryOverDoses : (v.carryOver || 0) * dpv);
                    }, 0);
                    const totalMonthlyD = facEntries.reduce((acc, [vName, v]) => {
                      if (isDeviceProduct(vName)) return acc;
                      const dpv = v.dosesPerVial || getVaccineDosesPerVial(vName);
                      return acc + (v.originalDoses !== undefined ? v.originalDoses : (v.original || 0) * dpv);
                    }, 0);
                    const totalTakenD = facEntries.reduce((acc, [vName, v]) => {
                      if (isDeviceProduct(vName)) return acc;
                      const dpv = v.dosesPerVial || getVaccineDosesPerVial(vName);
                      return acc + (v.takenDoses !== undefined ? v.takenDoses : (v.taken || 0) * dpv);
                    }, 0);
                    const totalRemD = facEntries.reduce((acc, [vName, v]) => {
                      if (isDeviceProduct(vName)) return acc;
                      const dpv = v.dosesPerVial || getVaccineDosesPerVial(vName);
                      return acc + (v.remainingDoses !== undefined ? v.remainingDoses : (v.remaining || 0) * dpv);
                    }, 0);

                    const renderCell = (qty: number, doses: number) => {
                      if (commodityFilter === 'devices') {
                        return `${qty.toLocaleString()} pcs`;
                      }
                      if (commodityFilter === 'all') {
                        return `${qty.toLocaleString()} u (${doses.toLocaleString()}d)`;
                      }
                      if (unitDisplayMode === 'doses') {
                        return `${doses.toLocaleString()} d`;
                      }
                      if (unitDisplayMode === 'both') {
                        return `${qty.toLocaleString()} v (${doses.toLocaleString()}d)`;
                      }
                      return `${qty.toLocaleString()} v`;
                    };

                    return (
                      <tr key={f.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900">{f.facilityName}</div>
                          <div className="text-[10px] text-slate-400">{f.nest} &bull; {f.cycle}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-800">{f.district}</div>
                          <span className="text-[10px] text-indigo-700 font-bold">
                            {f.subDistrict || 'General'}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            bpFac?.processing === 'Completed'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : bpFac?.processing === 'In Progress'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-slate-50 text-slate-700 border-slate-200'
                          }`}>
                            {bpFac?.processing || 'Synced'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-indigo-700">
                          {renderCell(totalCarry, totalCarryD)}
                        </td>
                        <td className="py-3 px-3 text-right font-black text-slate-900">
                          {renderCell(totalMonthly, totalMonthlyD)}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-amber-700">
                          {renderCell(totalTaken, totalTakenD)}
                        </td>
                        <td className="py-3 px-3 text-right font-black text-emerald-700">
                          {renderCell(totalRem, totalRemD)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {onSelectFacilityForAudit && (
                            <button
                              type="button"
                              onClick={() => onSelectFacilityForAudit(f.id)}
                              className="text-[11px] font-bold text-[#5C2D91] hover:text-purple-900 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
                            >
                              Audit Order
                            </button>
                          )}
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
