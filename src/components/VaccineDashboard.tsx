import { authFetch } from '../utils/authFetch';
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
  ShieldAlert,
  Trash2
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
  onNavigateToChecker?: () => void;
}

export default function VaccineDashboard({ onSelectFacilityForAudit, onNavigateToBlueprint, onNavigateToChecker }: VaccineDashboardProps) {
  const [facilities, setFacilities] = useState<FacilityAllocation[]>([]);
  const [dashboardMetrics, setDashboardMetrics] = useState<VaccineDashboardMetrics | null>(null);
  const [blueprintDistricts, setBlueprintDistricts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearSuccessMsg, setClearSuccessMsg] = useState<string | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>('');

  // Unit display switcher: 'both' | 'vials' | 'doses'
  const [unitDisplayMode, setUnitDisplayMode] = useState<'both' | 'vials' | 'doses'>('both');

  // Commodity category filter: 'vaccines' (Antigens) | 'devices' (Syringes & Consumables) | 'all' (Side-by-side separated view)
  const [commodityFilter, setCommodityFilter] = useState<'vaccines' | 'devices' | 'all'>('vaccines');

  // Active view tab: Separate District from Sub-District view, and separate Vaccine Antigens from Syringes & Devices
  const [dashboardTab, setDashboardTab] = useState<'districts' | 'sub_districts' | 'vaccines' | 'syringes' | 'facilities'>('districts');

  // Facilities matrix sub-view: 'both' | 'vaccines' | 'devices'
  const [matrixCommodityView, setMatrixCommodityView] = useState<'both' | 'vaccines' | 'devices'>('both');

  // Filters
  const [selectedNest, setSelectedNest] = useState('all');
  const [selectedDistrict, setSelectedDistrict] = useState('all');
  const [selectedSubDistrict, setSelectedSubDistrict] = useState('all');
  const [selectedCycle, setSelectedCycle] = useState('all');
  const [selectedVaccine, setSelectedVaccine] = useState('all');

  // Accordion state
  const [expandedDistrict, setExpandedDistrict] = useState<string | null>(null);
  const [expandedSubDistrict, setExpandedSubDistrict] = useState<string | null>(null);
  const [expandedFacilityRow, setExpandedFacilityRow] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [facRes, dashRes, bpRes] = await Promise.all([
        authFetch('/api/vaccine/allocations'),
        authFetch('/api/vaccine/dashboard'),
        authFetch('/api/vaccine/blueprint-districts')
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
      const syncRes = await authFetch('/api/vaccine/blueprint-districts/sync', { method: 'POST' });
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

  const handleClearAllData = async () => {
    if (!window.confirm('Are you sure you want to clear all vaccine allocations, orders, and history? This will reset the app to a clean state ready to receive new allocations.')) {
      return;
    }
    setClearing(true);
    try {
      const res = await authFetch('/api/app/clear-all', { method: 'POST' });
      if (res.ok) {
        setFacilities([]);
        setDashboardMetrics(null);
        setClearSuccessMsg('All allocations and data have been cleared. System is ready to receive new allocations.');
        setTimeout(() => setClearSuccessMsg(null), 5000);
      }
    } catch (e) {
      console.error('Failed to clear app data:', e);
    } finally {
      setClearing(false);
      fetchData();
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
  const vaccineConsumptionPercent = vaccineAllocated > 0 ? Math.round((vaccineOrdered / vaccineAllocated) * 100) : 0;
  const deviceConsumptionPercent = deviceAllocated > 0 ? Math.round((deviceOrdered / deviceAllocated) * 100) : 0;
  const vaccineAntigenList = Object.values(vaccineBreakdown).filter(v => !v.isDevice);
  const syringeDeviceList = Object.values(vaccineBreakdown).filter(v => v.isDevice);

  // Compute District-level Aggregations mapped to Blueprint with separated vaccine & syringe streams
  interface AntigenDetailItem {
    name: string;
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
    dosesPerVial: number;
  }

  interface DeviceDetailItem {
    name: string;
    carryOver: number;
    monthlyAlloc: number;
    allocated: number;
    taken: number;
    remaining: number;
  }

  interface DistrictGroup {
    districtName: string;
    districtId?: string;
    nest: string;
    month?: string;
    subDistricts: string[];
    facilities: FacilityAllocation[];
    // Vaccines (Antigens - Vials & Clinical Doses)
    vaccineCarryOver: number;
    vaccineCarryOverDoses: number;
    vaccineMonthlyAlloc: number;
    vaccineMonthlyAllocDoses: number;
    vaccineAllocated: number;
    vaccineAllocatedDoses: number;
    vaccineTaken: number;
    vaccineTakenDoses: number;
    vaccineRemaining: number;
    vaccineRemainingDoses: number;
    // Injection Devices & Syringes (Physical Consumables - Pieces)
    deviceCarryOver: number;
    deviceMonthlyAlloc: number;
    deviceAllocated: number;
    deviceTaken: number;
    deviceRemaining: number;
    // Separated individual product maps
    antigenItems: Record<string, AntigenDetailItem>;
    deviceItems: Record<string, DeviceDetailItem>;
    // Consolidated compatibility fields
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
    devicesAllocated: Record<string, number>;
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
        vaccineCarryOver: 0,
        vaccineCarryOverDoses: 0,
        vaccineMonthlyAlloc: 0,
        vaccineMonthlyAllocDoses: 0,
        vaccineAllocated: 0,
        vaccineAllocatedDoses: 0,
        vaccineTaken: 0,
        vaccineTakenDoses: 0,
        vaccineRemaining: 0,
        vaccineRemainingDoses: 0,
        deviceCarryOver: 0,
        deviceMonthlyAlloc: 0,
        deviceAllocated: 0,
        deviceTaken: 0,
        deviceRemaining: 0,
        antigenItems: {},
        deviceItems: {},
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
        devicesAllocated: {},
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

      if (isDevice) {
        districtGroupsMap[dName].deviceCarryOver += carry;
        districtGroupsMap[dName].deviceMonthlyAlloc += monthly;
        districtGroupsMap[dName].deviceAllocated += totalAuth;
        districtGroupsMap[dName].deviceTaken += vAlloc.taken;
        districtGroupsMap[dName].deviceRemaining += vAlloc.remaining;
        districtGroupsMap[dName].devicesAllocated[vName] = (districtGroupsMap[dName].devicesAllocated[vName] || 0) + totalAuth;

        if (!districtGroupsMap[dName].deviceItems[vName]) {
          districtGroupsMap[dName].deviceItems[vName] = {
            name: vName,
            carryOver: 0,
            monthlyAlloc: 0,
            allocated: 0,
            taken: 0,
            remaining: 0
          };
        }
        const di = districtGroupsMap[dName].deviceItems[vName];
        di.carryOver += carry;
        di.monthlyAlloc += monthly;
        di.allocated += totalAuth;
        di.taken += vAlloc.taken;
        di.remaining += vAlloc.remaining;
      } else {
        districtGroupsMap[dName].vaccineCarryOver += carry;
        districtGroupsMap[dName].vaccineCarryOverDoses += carryD;
        districtGroupsMap[dName].vaccineMonthlyAlloc += monthly;
        districtGroupsMap[dName].vaccineMonthlyAllocDoses += monthlyD;
        districtGroupsMap[dName].vaccineAllocated += totalAuth;
        districtGroupsMap[dName].vaccineAllocatedDoses += totalAuthDoses;
        districtGroupsMap[dName].vaccineTaken += vAlloc.taken;
        districtGroupsMap[dName].vaccineTakenDoses += takenD;
        districtGroupsMap[dName].vaccineRemaining += vAlloc.remaining;
        districtGroupsMap[dName].vaccineRemainingDoses += remD;
        districtGroupsMap[dName].antigensAllocated[vName] = (districtGroupsMap[dName].antigensAllocated[vName] || 0) + totalAuth;

        if (!districtGroupsMap[dName].antigenItems[vName]) {
          districtGroupsMap[dName].antigenItems[vName] = {
            name: vName,
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
            dosesPerVial: dpv
          };
        }
        const ai = districtGroupsMap[dName].antigenItems[vName];
        ai.carryOver += carry;
        ai.carryOverDoses += carryD;
        ai.monthlyAlloc += monthly;
        ai.monthlyAllocDoses += monthlyD;
        ai.allocated += totalAuth;
        ai.allocatedDoses += totalAuthDoses;
        ai.taken += vAlloc.taken;
        ai.takenDoses += takenD;
        ai.remaining += vAlloc.remaining;
        ai.remainingDoses += remD;
      }

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
    }
  }
  const districtList = Object.values(districtGroupsMap).sort((a, b) => a.districtName.localeCompare(b.districtName));

  // Compute Sub-District-level Aggregations with separated vaccine & syringe streams
  interface SubDistrictGroup {
    subDistrictName: string;
    districtName: string;
    nest: string;
    facilities: FacilityAllocation[];
    // Vaccines (Antigens - Vials & Clinical Doses)
    vaccineCarryOver: number;
    vaccineCarryOverDoses: number;
    vaccineMonthlyAlloc: number;
    vaccineMonthlyAllocDoses: number;
    vaccineAllocated: number;
    vaccineAllocatedDoses: number;
    vaccineTaken: number;
    vaccineTakenDoses: number;
    vaccineRemaining: number;
    vaccineRemainingDoses: number;
    // Injection Devices & Syringes (Physical Consumables - Pieces)
    deviceCarryOver: number;
    deviceMonthlyAlloc: number;
    deviceAllocated: number;
    deviceTaken: number;
    deviceRemaining: number;
    // Separated individual product maps
    antigenItems: Record<string, AntigenDetailItem>;
    deviceItems: Record<string, DeviceDetailItem>;
    // Consolidated compatibility fields
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
    devicesAllocated: Record<string, number>;
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
        vaccineCarryOver: 0,
        vaccineCarryOverDoses: 0,
        vaccineMonthlyAlloc: 0,
        vaccineMonthlyAllocDoses: 0,
        vaccineAllocated: 0,
        vaccineAllocatedDoses: 0,
        vaccineTaken: 0,
        vaccineTakenDoses: 0,
        vaccineRemaining: 0,
        vaccineRemainingDoses: 0,
        deviceCarryOver: 0,
        deviceMonthlyAlloc: 0,
        deviceAllocated: 0,
        deviceTaken: 0,
        deviceRemaining: 0,
        antigenItems: {},
        deviceItems: {},
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
        devicesAllocated: {}
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

      if (isDevice) {
        subDistrictGroupsMap[key].deviceCarryOver += carry;
        subDistrictGroupsMap[key].deviceMonthlyAlloc += monthly;
        subDistrictGroupsMap[key].deviceAllocated += totalAuth;
        subDistrictGroupsMap[key].deviceTaken += vAlloc.taken;
        subDistrictGroupsMap[key].deviceRemaining += vAlloc.remaining;
        subDistrictGroupsMap[key].devicesAllocated[vName] = (subDistrictGroupsMap[key].devicesAllocated[vName] || 0) + totalAuth;

        if (!subDistrictGroupsMap[key].deviceItems[vName]) {
          subDistrictGroupsMap[key].deviceItems[vName] = {
            name: vName,
            carryOver: 0,
            monthlyAlloc: 0,
            allocated: 0,
            taken: 0,
            remaining: 0
          };
        }
        const di = subDistrictGroupsMap[key].deviceItems[vName];
        di.carryOver += carry;
        di.monthlyAlloc += monthly;
        di.allocated += totalAuth;
        di.taken += vAlloc.taken;
        di.remaining += vAlloc.remaining;
      } else {
        subDistrictGroupsMap[key].vaccineCarryOver += carry;
        subDistrictGroupsMap[key].vaccineCarryOverDoses += carryD;
        subDistrictGroupsMap[key].vaccineMonthlyAlloc += monthly;
        subDistrictGroupsMap[key].vaccineMonthlyAllocDoses += monthlyD;
        subDistrictGroupsMap[key].vaccineAllocated += totalAuth;
        subDistrictGroupsMap[key].vaccineAllocatedDoses += totalAuthDoses;
        subDistrictGroupsMap[key].vaccineTaken += vAlloc.taken;
        subDistrictGroupsMap[key].vaccineTakenDoses += takenD;
        subDistrictGroupsMap[key].vaccineRemaining += vAlloc.remaining;
        subDistrictGroupsMap[key].vaccineRemainingDoses += remD;
        subDistrictGroupsMap[key].antigensAllocated[vName] = (subDistrictGroupsMap[key].antigensAllocated[vName] || 0) + totalAuth;

        if (!subDistrictGroupsMap[key].antigenItems[vName]) {
          subDistrictGroupsMap[key].antigenItems[vName] = {
            name: vName,
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
            dosesPerVial: dpv
          };
        }
        const ai = subDistrictGroupsMap[key].antigenItems[vName];
        ai.carryOver += carry;
        ai.carryOverDoses += carryD;
        ai.monthlyAlloc += monthly;
        ai.monthlyAllocDoses += monthlyD;
        ai.allocated += totalAuth;
        ai.allocatedDoses += totalAuthDoses;
        ai.taken += vAlloc.taken;
        ai.takenDoses += takenD;
        ai.remaining += vAlloc.remaining;
        ai.remainingDoses += remD;
      }

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
          <div className="mt-4 pt-4 border-t border-purple-800/60 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
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

            <button
              onClick={handleClearAllData}
              disabled={clearing}
              className="bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-rose-200"
              title="Clear all allocation records to receive new vaccine allocations"
            >
              <Trash2 className={`w-3.5 h-3.5 ${clearing ? 'animate-spin' : ''}`} />
              {clearing ? 'Clearing...' : 'Clear All Data'}
            </button>
          </div>
        </div>

        {clearSuccessMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-bold text-emerald-800 flex items-center justify-between">
            <span>{clearSuccessMsg}</span>
            <button onClick={() => setClearSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-900 cursor-pointer">&times;</button>
          </div>
        )}

        {facilities.length === 0 && (
          <div className="bg-gradient-to-r from-purple-50 via-indigo-50 to-sky-50 border border-purple-200/90 rounded-3xl p-6 sm:p-7 text-center space-y-3 shadow-xs">
            <div className="w-12 h-12 bg-white rounded-2xl shadow-xs border border-purple-200 text-[#5C2D91] flex items-center justify-center mx-auto">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div className="max-w-xl mx-auto space-y-1">
              <h3 className="text-base font-black text-slate-900 tracking-tight">
                Ready to Receive Vaccine Allocations
              </h3>
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                The application has been cleared of all previous data. The system is clean and ready to receive fresh vaccine allocations. You can import an Excel/CSV tracker, enter rows in the 67-Column Blueprint sheet, or dispatch allocations.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-1 flex-wrap">
              {onNavigateToBlueprint && (
                <button
                  type="button"
                  onClick={() => onNavigateToBlueprint()}
                  className="bg-[#5C2D91] hover:bg-purple-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Open Allocation Blueprint
                </button>
              )}
              {onNavigateToChecker && (
                <button
                  type="button"
                  onClick={() => onNavigateToChecker()}
                  className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Upload Allocation Sheet
                </button>
              )}
            </div>
          </div>
        )}

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
              <span>Syringes (Consumables)</span>
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
              <span>Separated View (Both)</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                commodityFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {vaccineProducts.length} Antigens &bull; {deviceProducts.length} Syringes
              </span>
            </button>
          </div>

          <div className="text-xs font-medium text-slate-500">
            {commodityFilter === 'vaccines' && (
              <span className="text-purple-700 font-bold bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-lg">
                Dose multiplier active for clinical vaccine antigens (Vials &amp; Doses)
              </span>
            )}
            {commodityFilter === 'devices' && (
              <span className="text-sky-700 font-bold bg-sky-50 border border-sky-200 px-2.5 py-1 rounded-lg">
                Syringes (Consumables): Soloshot 0.05ml, Soloshot 0.5ml, Syringes and needles 2ml &amp; 5ml (Pieces)
              </span>
            )}
            {commodityFilter === 'all' && (
              <span className="text-indigo-800 font-bold bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg">
                Side-by-side separated streams &mdash; Vaccine Antigens and Syringes (Consumables) never summed together
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
              {commodityFilter === 'devices' ? 'Specific Syringe (Consumable)' : 'Specific Vaccine Antigen'}
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
                  ? `All Syringes & Consumables (${deviceProducts.length})`
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
                  <optgroup label="Syringes &amp; Consumables (Pieces)">
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

      {/* High-Level Operational Context - Separated Streams & Facility Scopes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Card 1: Facilities Monitored */}
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Facilities Monitored</span>
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

        {/* Card 2: Clinical Vaccine Antigens (Hidden in Syringes Tab / Devices Filter) */}
        {dashboardTab === 'syringes' || commodityFilter === 'devices' ? (
          /* Syringes (Consumables) Summary Card takes primary position */
          <div className="bg-gradient-to-br from-sky-900 via-sky-950 to-slate-950 text-white rounded-3xl p-5 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-sky-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>Syringes (Consumables)</span>
                <span className="bg-sky-500/30 text-sky-200 text-[9px] px-1.5 py-0.2 rounded-full border border-sky-400/30 font-bold">
                  Pieces (pcs)
                </span>
              </div>
              <div className="text-2xl font-black tracking-tight">
                {syringeDeviceList.length} <span className="text-xs font-medium text-sky-300">Syringe Products</span>
              </div>
              <div className="text-[11px] text-sky-200/90 flex items-center gap-1.5">
                <span className="text-emerald-400 font-bold">{syringeDeviceList.filter(v => v.remaining > 0).length} In Stock</span> &bull;{' '}
                <span className="text-sky-300">Soloshot 0.05ml, 0.5ml, Syringes 2ml &amp; 5ml</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-sky-200">
              <Package className="w-5 h-5" />
            </div>
          </div>
        ) : (
          /* Clinical Vaccine Antigens Card (Shown in Vaccine Antigen tab and separated tabs) */
          <div className="bg-gradient-to-br from-purple-900 via-purple-950 to-indigo-950 text-white rounded-3xl p-5 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-purple-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>Clinical Vaccine Antigens</span>
                <span className="bg-purple-500/30 text-purple-200 text-[9px] px-1.5 py-0.2 rounded-full border border-purple-400/30 font-bold">
                  Separated
                </span>
              </div>
              <div className="text-2xl font-black tracking-tight">
                {vaccineAntigenList.length} <span className="text-xs font-medium text-purple-300">Antigens Tracked</span>
              </div>
              <div className="text-[11px] text-purple-200/90 flex items-center gap-1.5">
                <span className="text-emerald-400 font-bold">{vaccineAntigenList.filter(v => v.remaining > 0).length} In Stock</span> &bull;{' '}
                <span className="text-rose-300 font-bold">{vaccineAntigenList.filter(v => v.remaining <= 0).length} Depleted</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-purple-200">
              <Syringe className="w-5 h-5" />
            </div>
          </div>
        )}

        {/* Card 3: Context-Dependent Balance Card */}
        {dashboardTab === 'syringes' || commodityFilter === 'devices' ? (
          /* In Syringes tab, show Available Syringe Stock & Balance instead of Vaccine Antigens */
          <div className="bg-gradient-to-br from-sky-950 via-indigo-950 to-slate-950 text-white rounded-3xl p-5 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-sky-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>Available Syringes Stock</span>
                <span className="bg-emerald-500/30 text-emerald-300 text-[9px] px-1.5 py-0.2 rounded-full border border-emerald-400/30 font-bold">
                  Physical Balance
                </span>
              </div>
              <div className="text-2xl font-black tracking-tight text-emerald-300">
                {deviceRemaining.toLocaleString()} <span className="text-xs font-medium text-sky-200">pcs</span>
              </div>
              <div className="text-[11px] text-sky-200/90 flex items-center gap-1.5">
                <span className="text-emerald-400 font-bold">{deviceRemaining.toLocaleString()} pcs balance</span> &bull;{' '}
                <span>{deviceOrdered.toLocaleString()} pcs distributed ({deviceConsumptionPercent}%)</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-sky-200">
              <Package className="w-5 h-5" />
            </div>
          </div>
        ) : dashboardTab === 'vaccines' || dashboardTab === 'antigens' || commodityFilter === 'vaccines' ? (
          /* In Vaccine Antigen tab, show Available Vaccine Stock instead of Syringes */
          <div className="bg-gradient-to-br from-emerald-900 via-teal-950 to-slate-950 text-white rounded-3xl p-5 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-emerald-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>Available Vaccine Stock</span>
                <span className="bg-emerald-500/30 text-emerald-200 text-[9px] px-1.5 py-0.2 rounded-full border border-emerald-400/30 font-bold">
                  Clinical Cold Chain
                </span>
              </div>
              <div className="text-2xl font-black tracking-tight">
                {unitDisplayMode === 'doses'
                  ? `${vaccineRemainingDoses.toLocaleString()} doses`
                  : `${vaccineRemaining.toLocaleString()} vials`}
              </div>
              <div className="text-[11px] text-emerald-200/90 flex items-center gap-1.5">
                <span className="text-emerald-300 font-bold">{vaccineRemaining.toLocaleString()} vials</span> &bull;{' '}
                <span>{vaccineRemainingDoses.toLocaleString()} doses ready</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-emerald-200">
              <ShieldAlert className="w-5 h-5" />
            </div>
          </div>
        ) : (
          /* In other tabs (Districts, Sub-Districts, Facilities Matrix), show Syringes card side-by-side */
          <div className="bg-gradient-to-br from-sky-900 via-sky-950 to-slate-950 text-white rounded-3xl p-5 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-bold text-sky-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>Syringes (Consumables)</span>
                <span className="bg-sky-500/30 text-sky-200 text-[9px] px-1.5 py-0.2 rounded-full border border-sky-400/30 font-bold">
                  Pieces (pcs)
                </span>
              </div>
              <div className="text-2xl font-black tracking-tight">
                {syringeDeviceList.length} <span className="text-xs font-medium text-sky-300">Syringe Products</span>
              </div>
              <div className="text-[11px] text-sky-200/90 flex items-center gap-1.5">
                <span className="text-emerald-400 font-bold">{syringeDeviceList.filter(v => v.remaining > 0).length} In Stock</span> &bull;{' '}
                <span className="text-sky-300">Soloshot 0.05ml, 0.5ml, Syringes 2ml &amp; 5ml</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-sky-200">
              <Package className="w-5 h-5" />
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SEPARATED COMMODITY STREAM KPI PANELS: VACCINES VS SYRINGES              */}
      {/* ========================================================================= */}
      {dashboardTab !== 'syringes' && (commodityFilter === 'vaccines' || commodityFilter === 'all') && (
        <div className="border border-purple-200 bg-gradient-to-br from-purple-50/70 via-white to-purple-50/30 rounded-3xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-purple-100 pb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#5C2D91]"></span>
              <h4 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
                <Syringe className="w-4 h-4 text-[#5C2D91]" />
                Clinical Vaccine Antigens (Separated by Antigen)
              </h4>
              <span className="bg-purple-100 text-[#5C2D91] text-[10px] font-bold px-2 py-0.5 rounded-full">
                Individual Quotas &amp; Balances &bull; Never Lumped Together
              </span>
            </div>
            <div className="text-xs text-purple-700 font-semibold flex items-center gap-2">
              <span>{vaccineAntigenList.length} distinct clinical antigens</span>
              <span className="text-slate-300">&bull;</span>
              <span className="text-emerald-700 font-bold">{vaccineAntigenList.filter(v => v.remaining > 0).length} In Stock</span>
              {vaccineAntigenList.some(v => v.remaining <= 0) && (
                <>
                  <span className="text-slate-300">&bull;</span>
                  <span className="text-rose-600 font-bold">{vaccineAntigenList.filter(v => v.remaining <= 0).length} Exhausted</span>
                </>
              )}
            </div>
          </div>

          {/* Individual Vaccine Antigen Cards Grid - Each Vaccine Separated */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {vaccineAntigenList
              .filter(stat => selectedVaccine === 'all' || stat.name === selectedVaccine)
              .map(stat => {
                const pct = stat.allocated > 0 ? Math.round((stat.ordered / stat.allocated) * 100) : 0;
                const isExhausted = stat.remaining <= 0;
                const isLow = !isExhausted && stat.remaining < stat.allocated * 0.25;

                return (
                  <div
                    key={stat.name}
                    className={`bg-white border rounded-2xl p-4 shadow-2xs space-y-3 transition-all hover:shadow-sm ${
                      isExhausted
                        ? 'border-rose-200 bg-rose-50/15'
                        : isLow
                        ? 'border-amber-200 bg-amber-50/15'
                        : 'border-purple-100'
                    }`}
                  >
                    {/* Header: Antigen Name & Badges */}
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#5C2D91]"></span>
                          <span className="font-black text-slate-900 text-sm tracking-tight" title={stat.name}>
                            {stat.name}
                          </span>
                        </div>
                        <div className="text-[10px] text-purple-700 font-semibold pl-4">
                          {stat.dosesPerVial} doses / vial &bull; {stat.facilitiesCount} facilities
                        </div>
                      </div>

                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          isExhausted
                            ? 'bg-rose-100 text-rose-800'
                            : isLow
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {isExhausted ? 'Exhausted' : isLow ? 'Low Stock' : 'In Stock'}
                      </span>
                    </div>

                    {/* Available Balance (Prominent) */}
                    <div className="bg-purple-50/60 border border-purple-100 rounded-xl p-2.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">
                        Available Balance
                      </span>
                      <div className="text-xl font-black text-emerald-700 tracking-tight">
                        {unitDisplayMode === 'doses' ? (
                          <>
                            {stat.remainingDoses.toLocaleString()}{' '}
                            <span className="text-xs font-bold text-emerald-600/70">doses</span>
                          </>
                        ) : (
                          <>
                            {stat.remaining.toLocaleString()}{' '}
                            <span className="text-xs font-bold text-emerald-600/70">vials</span>
                            {unitDisplayMode === 'both' && (
                              <span className="text-xs text-purple-700 font-bold ml-1.5">
                                ({stat.remainingDoses.toLocaleString()} d)
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Quota & Distributed Breakdown */}
                    <div className="grid grid-cols-3 gap-1 bg-slate-50 rounded-xl p-2 text-center text-[10px]">
                      <div>
                        <span className="text-indigo-600 font-bold block text-[9px] uppercase">Carry-Over</span>
                        <span className="font-black text-slate-800">
                          {unitDisplayMode === 'doses'
                            ? `${stat.carryOverDoses.toLocaleString()}d`
                            : `${stat.carryOver.toLocaleString()}v`}
                        </span>
                      </div>
                      <div>
                        <span className="text-blue-600 font-bold block text-[9px] uppercase">New Monthly</span>
                        <span className="font-black text-slate-800">
                          {unitDisplayMode === 'doses'
                            ? `${stat.monthlyAllocDoses.toLocaleString()}d`
                            : `${stat.monthlyAlloc.toLocaleString()}v`}
                        </span>
                      </div>
                      <div>
                        <span className="text-amber-600 font-bold block text-[9px] uppercase">Taken</span>
                        <span className="font-black text-amber-700">
                          {unitDisplayMode === 'doses'
                            ? `${stat.orderedDoses.toLocaleString()}d`
                            : `${stat.ordered.toLocaleString()}v`}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar & Total Quota */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 font-medium">
                          Total Quota:{' '}
                          <strong className="text-slate-800">
                            {unitDisplayMode === 'doses'
                              ? `${stat.allocatedDoses.toLocaleString()} doses`
                              : `${stat.allocated.toLocaleString()} vials`}
                          </strong>
                        </span>
                        <span className="font-bold text-slate-700">{pct}% taken</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isExhausted ? 'bg-rose-600' : pct >= 80 ? 'bg-amber-500' : 'bg-[#5C2D91]'
                          }`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {dashboardTab !== 'vaccines' && dashboardTab !== 'antigens' && (commodityFilter === 'devices' || commodityFilter === 'all') && (
        <div className="border border-sky-200 bg-gradient-to-br from-sky-50/70 via-white to-sky-50/30 rounded-3xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-sky-100 pb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-sky-600"></span>
              <h4 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
                <Package className="w-4 h-4 text-sky-600" />
                Syringes (Consumables) &mdash; Soloshot &amp; Syringes Quota
              </h4>
              <span className="bg-sky-100 text-sky-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                Tracked Strictly in Physical Pieces / Units (pcs)
              </span>
            </div>
            <div className="text-xs text-sky-700 font-semibold flex items-center gap-2">
              <span>{syringeDeviceList.length} Syringe Consumables Tracked</span>
              <span className="text-slate-300">&bull;</span>
              <span className="text-emerald-700 font-bold">{syringeDeviceList.filter(v => v.remaining > 0).length} In Stock</span>
              {syringeDeviceList.some(v => v.remaining <= 0) && (
                <>
                  <span className="text-slate-300">&bull;</span>
                  <span className="text-rose-600 font-bold">{syringeDeviceList.filter(v => v.remaining <= 0).length} Exhausted</span>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Syringe Available Quota */}
            <div className="bg-white border border-sky-100 rounded-2xl p-4 shadow-2xs space-y-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Total Available Syringes (Consumables)
              </span>
              <div className="text-2xl font-black text-sky-900 tracking-tight">
                {deviceAllocated.toLocaleString()}
                <span className="text-xs font-bold text-slate-400 ml-1">pcs</span>
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1 flex-wrap pt-0.5">
                <span className="text-indigo-600 font-bold">{deviceCarryOver.toLocaleString()} pcs carry-over</span>
                <span>+</span>
                <span className="text-blue-600 font-bold">{deviceMonthlyAlloc.toLocaleString()} pcs new monthly</span>
              </div>
            </div>

            {/* Syringe Distributed */}
            <div className="bg-white border border-sky-100 rounded-2xl p-4 shadow-2xs space-y-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Syringes Distributed (Taken)
              </span>
              <div className="text-2xl font-black text-amber-700 tracking-tight">
                {deviceOrdered.toLocaleString()}
                <span className="text-xs font-bold text-slate-400 ml-1">pcs</span>
              </div>
              <div className="text-[11px] text-amber-700 font-bold pt-0.5">
                {deviceConsumptionPercent}% of syringe quota taken
              </div>
            </div>

            {/* Syringe Available Balance */}
            <div className="bg-white border border-sky-100 rounded-2xl p-4 shadow-2xs space-y-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Available Syringes Balance
              </span>
              <div className="text-2xl font-black text-emerald-700 tracking-tight">
                {deviceRemaining.toLocaleString()}
                <span className="text-xs font-bold text-emerald-600/70 ml-1">pcs</span>
              </div>
              <div className="text-[11px] text-emerald-600 font-medium pt-0.5">
                Physical consumables ready for warehouse packaging &amp; dispatch
              </div>
            </div>
          </div>

          {/* Individual Syringes (Consumables) Cards Grid - Separated per Syringe */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-1">
            {syringeDeviceList
              .filter(stat => selectedVaccine === 'all' || stat.name === selectedVaccine)
              .map(stat => {
                const pct = stat.allocated > 0 ? Math.round((stat.ordered / stat.allocated) * 100) : 0;
                const isExhausted = stat.remaining <= 0;
                const isLow = !isExhausted && stat.remaining < stat.allocated * 0.25;

                return (
                  <div
                    key={stat.name}
                    className={`bg-white border rounded-2xl p-4 shadow-2xs space-y-3 transition-all hover:shadow-sm ${
                      isExhausted
                        ? 'border-rose-200 bg-rose-50/15'
                        : isLow
                        ? 'border-amber-200 bg-amber-50/15'
                        : 'border-sky-100'
                    }`}
                  >
                    {/* Header: Syringe Name & Badges */}
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
                          <span className="font-black text-slate-900 text-sm tracking-tight" title={stat.name}>
                            {stat.name}
                          </span>
                        </div>
                        <div className="text-[10px] text-sky-700 font-semibold pl-4">
                          Syringe Consumable &bull; {stat.facilitiesCount} facilities
                        </div>
                      </div>

                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          isExhausted
                            ? 'bg-rose-100 text-rose-800'
                            : isLow
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {isExhausted ? 'Exhausted' : isLow ? 'Low Stock' : 'In Stock'}
                      </span>
                    </div>

                    {/* Available Balance (Prominent) */}
                    <div className="bg-sky-50/60 border border-sky-100 rounded-xl p-2.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">
                        Available Balance
                      </span>
                      <div className="text-xl font-black text-emerald-700 tracking-tight">
                        {stat.remaining.toLocaleString()}{' '}
                        <span className="text-xs font-bold text-emerald-600/70">pcs</span>
                      </div>
                    </div>

                    {/* Breakdown Numbers */}
                    <div className="grid grid-cols-3 gap-1 bg-slate-50 border border-slate-100 rounded-xl p-2 text-center text-[10px]">
                      <div>
                        <span className="text-indigo-600 font-bold block text-[9px] uppercase">Carry-Over</span>
                        <span className="font-black text-slate-800">{stat.carryOver.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-blue-600 font-bold block text-[9px] uppercase">New Quota</span>
                        <span className="font-black text-slate-800">{stat.monthlyAlloc.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-amber-600 font-bold block text-[9px] uppercase">Taken</span>
                        <span className="font-black text-amber-700">{stat.ordered.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Progress Bar & Total Quota */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 font-medium">
                          Total Quota:{' '}
                          <strong className="text-slate-800">
                            {stat.allocated.toLocaleString()} pcs
                          </strong>
                        </span>
                        <span className="font-bold text-slate-700">{pct}% taken</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isExhausted ? 'bg-rose-600' : pct >= 80 ? 'bg-amber-500' : 'bg-sky-600'
                          }`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

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
              onClick={() => {
                setDashboardTab('vaccines');
                if (commodityFilter === 'devices') {
                  setCommodityFilter('vaccines');
                }
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                dashboardTab === 'vaccines'
                  ? 'bg-[#5C2D91] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Syringe className="w-4 h-4" />
              <span>Vaccine Antigens</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                dashboardTab === 'vaccines' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {vaccineAntigenList.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDashboardTab('syringes');
                if (commodityFilter === 'vaccines') {
                  setCommodityFilter('devices');
                }
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                dashboardTab === 'syringes'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Syringes (Consumables)</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                dashboardTab === 'syringes' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {syringeDeviceList.length}
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
            {dashboardTab === 'districts' && 'Showing live Blueprint district sheets with separated Vaccine & Syringe balances'}
            {dashboardTab === 'sub_districts' && 'Showing independent breakdown by Sub-District with segregated commodities'}
            {dashboardTab === 'vaccines' && 'Showing clinical antigen stock consumption in vials & doses'}
            {dashboardTab === 'syringes' && 'Showing physical syringe & consumable inventory in pieces'}
            {dashboardTab === 'facilities' && 'Showing facility-level quotas, separated balances, and audit actions'}
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
                  const vacPct = dg.vaccineAllocated > 0 ? Math.round((dg.vaccineTaken / dg.vaccineAllocated) * 100) : 0;
                  const devPct = dg.deviceAllocated > 0 ? Math.round((dg.deviceTaken / dg.deviceAllocated) * 100) : 0;
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

                        {/* Separated Balance Badges */}
                        <div className="flex flex-col items-end gap-1">
                          <div className="bg-purple-50 border border-purple-200 rounded-xl px-2.5 py-1 text-right">
                            <div className="text-[9px] font-bold text-purple-700 uppercase">Vaccine Antigens</div>
                            <div className="text-xs font-black text-purple-900">
                              {Object.keys(dg.antigenItems).length} Antigens Tracked
                            </div>
                          </div>
                          <div className="bg-sky-50 border border-sky-200 rounded-xl px-2.5 py-1 text-right">
                            <div className="text-[9px] font-bold text-sky-700 uppercase">Syringes Balance</div>
                            <div className="text-xs font-black text-sky-900">
                              {dg.deviceRemaining.toLocaleString()} pcs
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* SECTION 1: Vaccine Antigens Breakdown - Separated per Antigen (Never Lumped) */}
                      <div className="bg-white/95 border border-purple-200/90 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-[#5C2D91]">
                          <span className="flex items-center gap-1.5">
                            <Syringe className="w-3.5 h-3.5" />
                            Vaccine Antigens (Separated per Antigen)
                          </span>
                          <span className="text-[10px] text-purple-700 font-semibold">
                            {Object.keys(dg.antigenItems).length} clinical vaccines
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-purple-100 text-[9px] text-slate-400 uppercase font-bold">
                                <th className="py-1 px-1.5">Antigen</th>
                                <th className="py-1 px-1.5 text-right text-indigo-700">Carry-Over</th>
                                <th className="py-1 px-1.5 text-right text-blue-700">Monthly</th>
                                <th className="py-1 px-1.5 text-right text-amber-700">Taken</th>
                                <th className="py-1 px-1.5 text-right text-emerald-700 font-black">Balance</th>
                                <th className="py-1 px-1.5 text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-purple-50 text-[11px]">
                              {Object.values(dg.antigenItems)
                                .filter(ai => selectedVaccine === 'all' || ai.name === selectedVaccine)
                                .map(ai => {
                                  const isEx = ai.remaining <= 0;
                                  return (
                                    <tr key={ai.name} className="hover:bg-purple-50/40">
                                      <td className="py-1 px-1.5 font-bold text-slate-900">
                                        {ai.name}{' '}
                                        <span className="text-[9px] font-normal text-slate-400">({ai.dosesPerVial}d/v)</span>
                                      </td>
                                      <td className="py-1 px-1.5 text-right text-indigo-800 font-medium">
                                        {unitDisplayMode === 'doses' ? `${ai.carryOverDoses.toLocaleString()}d` : `${ai.carryOver.toLocaleString()}v`}
                                      </td>
                                      <td className="py-1 px-1.5 text-right text-blue-800 font-medium">
                                        {unitDisplayMode === 'doses' ? `${ai.monthlyAllocDoses.toLocaleString()}d` : `${ai.monthlyAlloc.toLocaleString()}v`}
                                      </td>
                                      <td className="py-1 px-1.5 text-right text-amber-700 font-medium">
                                        {unitDisplayMode === 'doses' ? `${ai.takenDoses.toLocaleString()}d` : `${ai.taken.toLocaleString()}v`}
                                      </td>
                                      <td className="py-1 px-1.5 text-right text-emerald-700 font-black">
                                        {unitDisplayMode === 'doses'
                                          ? `${ai.remainingDoses.toLocaleString()}d`
                                          : unitDisplayMode === 'both'
                                          ? `${ai.remaining.toLocaleString()}v (${ai.remainingDoses.toLocaleString()}d)`
                                          : `${ai.remaining.toLocaleString()}v`}
                                      </td>
                                      <td className="py-1 px-1.5 text-center">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                          isEx ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                        }`}>
                                          {isEx ? 'Exhausted' : 'Available'}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* SECTION 2: Syringes (Consumables) Breakdown - Separated per Syringe */}
                      <div className="bg-white/95 border border-sky-200/90 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-sky-800">
                          <span className="flex items-center gap-1.5">
                            <Package className="w-3.5 h-3.5 text-sky-600" />
                            Syringes (Consumables) Breakdown
                          </span>
                          <span className="text-[10px] text-sky-700 font-semibold">
                            {Object.keys(dg.deviceItems).length} syringe products &bull; {devPct}% Taken
                          </span>
                        </div>
                        {Object.keys(dg.deviceItems).length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="border-b border-sky-100 text-[9px] text-slate-400 uppercase font-bold">
                                  <th className="py-1 px-1.5">Syringe Product</th>
                                  <th className="py-1 px-1.5 text-right text-indigo-700">Carry-Over</th>
                                  <th className="py-1 px-1.5 text-right text-blue-700">Monthly</th>
                                  <th className="py-1 px-1.5 text-right text-amber-700">Taken</th>
                                  <th className="py-1 px-1.5 text-right text-emerald-700 font-black">Balance</th>
                                  <th className="py-1 px-1.5 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-sky-50 text-[11px]">
                                {Object.values(dg.deviceItems)
                                  .filter(di => selectedVaccine === 'all' || di.name === selectedVaccine)
                                  .map(di => {
                                    const isEx = di.remaining <= 0;
                                    return (
                                      <tr key={di.name} className="hover:bg-sky-50/40">
                                        <td className="py-1 px-1.5 font-bold text-slate-900">
                                          {di.name}{' '}
                                          <span className="text-[9px] font-normal text-slate-400">(pcs)</span>
                                        </td>
                                        <td className="py-1 px-1.5 text-right text-indigo-800 font-medium">
                                          {di.carryOver.toLocaleString()} pcs
                                        </td>
                                        <td className="py-1 px-1.5 text-right text-blue-800 font-medium">
                                          {di.monthlyAlloc.toLocaleString()} pcs
                                        </td>
                                        <td className="py-1 px-1.5 text-right text-amber-700 font-medium">
                                          {di.taken.toLocaleString()} pcs
                                        </td>
                                        <td className="py-1 px-1.5 text-right text-emerald-700 font-black">
                                          {di.remaining.toLocaleString()} pcs
                                        </td>
                                        <td className="py-1 px-1.5 text-center">
                                          <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                            isEx ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                          }`}>
                                            {isEx ? 'Exhausted' : 'Available'}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="grid grid-cols-4 gap-2 text-center text-xs">
                            <div>
                              <div className="text-[9px] font-bold text-indigo-600 uppercase">Carry-Over</div>
                              <div className="text-xs font-black text-indigo-800">{dg.deviceCarryOver.toLocaleString()} pcs</div>
                            </div>
                            <div>
                              <div className="text-[9px] font-bold text-blue-600 uppercase">Monthly Alloc</div>
                              <div className="text-xs font-black text-blue-800">{dg.deviceMonthlyAlloc.toLocaleString()} pcs</div>
                            </div>
                            <div>
                              <div className="text-[9px] font-bold text-amber-600 uppercase">Distributed</div>
                              <div className="text-xs font-black text-amber-700">{dg.deviceTaken.toLocaleString()} pcs</div>
                            </div>
                            <div>
                              <div className="text-[9px] font-bold text-emerald-600 uppercase">Balance</div>
                              <div className="text-xs font-black text-emerald-700">{dg.deviceRemaining.toLocaleString()} pcs</div>
                            </div>
                          </div>
                        )}
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              devPct >= 100 ? 'bg-rose-600' : devPct >= 80 ? 'bg-amber-500' : 'bg-sky-600'
                            }`}
                            style={{ width: `${Math.min(100, devPct)}%` }}
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

                      {/* Separated Product Allocations across District */}
                      <div className="space-y-2 pt-1 border-t border-purple-100">
                        {/* Vaccines */}
                        {Object.keys(dg.antigensAllocated).length > 0 && (
                          <div className="space-y-1">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[#5C2D91] flex items-center gap-1">
                              <Syringe className="w-3 h-3" />
                              Vaccine Antigens:
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                              {Object.entries(dg.antigensAllocated).map(([vName, total]) => (
                                <span
                                  key={vName}
                                  className="text-[10px] bg-purple-50/80 border border-purple-200 font-bold px-2 py-0.5 rounded-lg text-purple-900 shadow-2xs"
                                >
                                  {vName}: <span className="text-[#5C2D91]">{total}v</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Syringes */}
                        {Object.keys(dg.devicesAllocated).length > 0 && (
                          <div className="space-y-1">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700 flex items-center gap-1">
                              <Package className="w-3 h-3" />
                              Syringes &amp; Injection Consumables:
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                              {Object.entries(dg.devicesAllocated).map(([vName, total]) => (
                                <span
                                  key={vName}
                                  className="text-[10px] bg-sky-50/80 border border-sky-200 font-bold px-2 py-0.5 rounded-lg text-sky-900 shadow-2xs"
                                >
                                  {vName}: <span className="text-sky-700">{total} pcs</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
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

                      {/* Expanded Facilities List with separated product badges */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-purple-100 space-y-2">
                          {dg.facilities.map(fac => {
                            const bpFac = blueprintRowMap[fac.facilityName.toLowerCase()];
                            const facVaccines = Object.entries(fac.vaccines).filter(([v]) => !isDeviceProduct(v));
                            const facDevices = Object.entries(fac.vaccines).filter(([v]) => isDeviceProduct(v));

                            return (
                              <div
                                key={fac.id}
                                className="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-2"
                              >
                                <div className="flex items-center justify-between">
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
                                      {fac.subDistrict || 'Central'} &bull; {facVaccines.length} Vaccines, {facDevices.length} Syringes
                                    </div>
                                  </div>
                                </div>

                                {/* Separated Vaccine vs Syringe Chips for Facility */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                                  {/* Facility Vaccines */}
                                  <div className="bg-purple-50/50 p-2 rounded-lg border border-purple-100">
                                    <span className="text-[10px] font-bold text-purple-700 uppercase block mb-1">
                                      Vaccines:
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                      {facVaccines.map(([v, a]) => (
                                        <span key={v} className="text-[10px] bg-white px-1.5 py-0.5 rounded font-bold text-purple-900 border border-purple-200">
                                          {v}: {a.original}v
                                        </span>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Facility Syringes */}
                                  <div className="bg-sky-50/50 p-2 rounded-lg border border-sky-100">
                                    <span className="text-[10px] font-bold text-sky-700 uppercase block mb-1">
                                      Syringes &amp; Devices:
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                      {facDevices.map(([v, a]) => (
                                        <span key={v} className="text-[10px] bg-white px-1.5 py-0.5 rounded font-bold text-sky-900 border border-sky-200">
                                          {v}: {a.original} pcs
                                        </span>
                                      ))}
                                    </div>
                                  </div>
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
                  const vacPct = sdg.vaccineAllocated > 0 ? Math.round((sdg.vaccineTaken / sdg.vaccineAllocated) * 100) : 0;
                  const devPct = sdg.deviceAllocated > 0 ? Math.round((sdg.deviceTaken / sdg.deviceAllocated) * 100) : 0;
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

                        {/* Separated Balance Badges */}
                        <div className="flex flex-col items-end gap-1">
                          <div className="bg-purple-50 border border-purple-200 rounded-xl px-2 py-0.5 text-right">
                            <div className="text-[9px] font-bold text-purple-700 uppercase">Vaccine Antigens</div>
                            <div className="text-xs font-black text-purple-900">
                              {Object.keys(sdg.antigenItems).length} Antigens Tracked
                            </div>
                          </div>
                          <div className="bg-sky-50 border border-sky-200 rounded-xl px-2 py-0.5 text-right">
                            <div className="text-[9px] font-bold text-sky-700 uppercase">Syringes Balance</div>
                            <div className="text-xs font-black text-sky-900">
                              {sdg.deviceRemaining.toLocaleString()} pcs
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* SECTION 1: Vaccine Antigens Breakdown - Separated per Antigen (Never Lumped) */}
                      <div className="bg-white/95 border border-purple-200/80 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-[#5C2D91]">
                          <span className="flex items-center gap-1">
                            <Syringe className="w-3.5 h-3.5" />
                            Vaccines (Separated per Antigen)
                          </span>
                          <span className="text-[10px] font-bold text-purple-700">
                            {Object.keys(sdg.antigenItems).length} clinical antigens
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-purple-100 text-[9px] text-slate-400 uppercase font-bold">
                                <th className="py-1 px-1.5">Antigen</th>
                                <th className="py-1 px-1.5 text-right text-indigo-700">Carry-Over</th>
                                <th className="py-1 px-1.5 text-right text-blue-700">Monthly</th>
                                <th className="py-1 px-1.5 text-right text-amber-700">Taken</th>
                                <th className="py-1 px-1.5 text-right text-emerald-700 font-black">Balance</th>
                                <th className="py-1 px-1.5 text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-purple-50 text-[11px]">
                              {Object.values(sdg.antigenItems)
                                .filter(ai => selectedVaccine === 'all' || ai.name === selectedVaccine)
                                .map(ai => {
                                  const isEx = ai.remaining <= 0;
                                  return (
                                    <tr key={ai.name} className="hover:bg-purple-50/40">
                                      <td className="py-1 px-1.5 font-bold text-slate-900">
                                        {ai.name}{' '}
                                        <span className="text-[9px] font-normal text-slate-400">({ai.dosesPerVial}d/v)</span>
                                      </td>
                                      <td className="py-1 px-1.5 text-right text-indigo-800 font-medium">
                                        {unitDisplayMode === 'doses' ? `${ai.carryOverDoses.toLocaleString()}d` : `${ai.carryOver.toLocaleString()}v`}
                                      </td>
                                      <td className="py-1 px-1.5 text-right text-blue-800 font-medium">
                                        {unitDisplayMode === 'doses' ? `${ai.monthlyAllocDoses.toLocaleString()}d` : `${ai.monthlyAlloc.toLocaleString()}v`}
                                      </td>
                                      <td className="py-1 px-1.5 text-right text-amber-700 font-medium">
                                        {unitDisplayMode === 'doses' ? `${ai.takenDoses.toLocaleString()}d` : `${ai.taken.toLocaleString()}v`}
                                      </td>
                                      <td className="py-1 px-1.5 text-right text-emerald-700 font-black">
                                        {unitDisplayMode === 'doses'
                                          ? `${ai.remainingDoses.toLocaleString()}d`
                                          : unitDisplayMode === 'both'
                                          ? `${ai.remaining.toLocaleString()}v (${ai.remainingDoses.toLocaleString()}d)`
                                          : `${ai.remaining.toLocaleString()}v`}
                                      </td>
                                      <td className="py-1 px-1.5 text-center">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                          isEx ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                        }`}>
                                          {isEx ? 'Exhausted' : 'Available'}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* SECTION 2: Syringes (Consumables) Breakdown - Separated per Syringe */}
                      <div className="bg-white/95 border border-sky-200/80 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-sky-800">
                          <span className="flex items-center gap-1">
                            <Package className="w-3.5 h-3.5 text-sky-600" />
                            Syringes (Consumables) Breakdown
                          </span>
                          <span className="text-[11px] font-bold text-sky-700">{devPct}% Taken</span>
                        </div>
                        {Object.keys(sdg.deviceItems).length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="border-b border-sky-100 text-[9px] text-slate-400 uppercase font-bold">
                                  <th className="py-1 px-1.5">Syringe Product</th>
                                  <th className="py-1 px-1.5 text-right text-indigo-700">Carry-Over</th>
                                  <th className="py-1 px-1.5 text-right text-blue-700">Monthly</th>
                                  <th className="py-1 px-1.5 text-right text-amber-700">Taken</th>
                                  <th className="py-1 px-1.5 text-right text-emerald-700 font-black">Balance</th>
                                  <th className="py-1 px-1.5 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-sky-50 text-[11px]">
                                {Object.values(sdg.deviceItems)
                                  .filter(di => selectedVaccine === 'all' || di.name === selectedVaccine)
                                  .map(di => {
                                    const isEx = di.remaining <= 0;
                                    return (
                                      <tr key={di.name} className="hover:bg-sky-50/40">
                                        <td className="py-1 px-1.5 font-bold text-slate-900">
                                          {di.name}{' '}
                                          <span className="text-[9px] font-normal text-slate-400">(pcs)</span>
                                        </td>
                                        <td className="py-1 px-1.5 text-right text-indigo-800 font-medium">
                                          {di.carryOver.toLocaleString()} pcs
                                        </td>
                                        <td className="py-1 px-1.5 text-right text-blue-800 font-medium">
                                          {di.monthlyAlloc.toLocaleString()} pcs
                                        </td>
                                        <td className="py-1 px-1.5 text-right text-amber-700 font-medium">
                                          {di.taken.toLocaleString()} pcs
                                        </td>
                                        <td className="py-1 px-1.5 text-right text-emerald-700 font-black">
                                          {di.remaining.toLocaleString()} pcs
                                        </td>
                                        <td className="py-1 px-1.5 text-center">
                                          <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                            isEx ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                          }`}>
                                            {isEx ? 'Exhausted' : 'Available'}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="grid grid-cols-4 gap-2 text-center text-xs">
                            <div>
                              <div className="text-[9px] font-bold text-indigo-600 uppercase">Carry-Over</div>
                              <div className="text-xs font-black text-indigo-800">{sdg.deviceCarryOver.toLocaleString()} pcs</div>
                            </div>
                            <div>
                              <div className="text-[9px] font-bold text-blue-600 uppercase">Monthly Alloc</div>
                              <div className="text-xs font-black text-blue-800">{sdg.deviceMonthlyAlloc.toLocaleString()} pcs</div>
                            </div>
                            <div>
                              <div className="text-[9px] font-bold text-amber-600 uppercase">Distributed</div>
                              <div className="text-xs font-black text-amber-700">{sdg.deviceTaken.toLocaleString()} pcs</div>
                            </div>
                            <div>
                              <div className="text-[9px] font-bold text-emerald-600 uppercase">Balance</div>
                              <div className="text-xs font-black text-emerald-700">{sdg.deviceRemaining.toLocaleString()} pcs</div>
                            </div>
                          </div>
                        )}
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              devPct >= 100 ? 'bg-rose-600' : devPct >= 80 ? 'bg-amber-500' : 'bg-sky-600'
                            }`}
                            style={{ width: `${Math.min(100, devPct)}%` }}
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
                          {sdg.facilities.map(fac => {
                            const facVaccines = Object.entries(fac.vaccines).filter(([v]) => !isDeviceProduct(v));
                            const facDevices = Object.entries(fac.vaccines).filter(([v]) => isDeviceProduct(v));

                            return (
                              <div
                                key={fac.id}
                                className="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-2"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="font-bold text-slate-900">{fac.facilityName}</div>
                                  <div className="text-[11px] text-slate-400">
                                    {facVaccines.length} Vaccines &bull; {facDevices.length} Syringes
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                                  <div className="bg-purple-50/50 p-2 rounded-lg border border-purple-100">
                                    <span className="text-[10px] font-bold text-purple-700 uppercase block mb-1">
                                      Vaccine Antigens:
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                      {facVaccines.map(([v, a]) => (
                                        <span key={v} className="text-[10px] bg-white px-1.5 py-0.5 rounded font-bold text-purple-900 border border-purple-200">
                                          {v}: {a.remaining !== undefined ? a.remaining : a.original}v
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="bg-sky-50/50 p-2 rounded-lg border border-sky-100">
                                    <span className="text-[10px] font-bold text-sky-700 uppercase block mb-1">
                                      Syringes (Consumables):
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                      {facDevices.map(([v, a]) => (
                                        <span key={v} className="text-[10px] bg-white px-1.5 py-0.5 rounded font-bold text-sky-900 border border-sky-200">
                                          {v}: {a.remaining !== undefined ? a.remaining : a.original} pcs
                                        </span>
                                      ))}
                                    </div>
                                  </div>
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
        {/* TAB 3: VACCINE ANTIGENS BREAKDOWN (CLINICAL COLD CHAIN ONLY)          */}
        {/* --------------------------------------------------------------------- */}
        {(dashboardTab === 'vaccines' || dashboardTab === 'antigens') && (
          <div className="space-y-4">
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-2xl flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Syringe className="w-4 h-4 text-[#5C2D91]" />
                <span className="text-xs font-black text-purple-900">
                  Clinical Vaccine Antigens Only
                </span>
                <span className="text-[10px] bg-purple-100 text-[#5C2D91] font-bold px-2 py-0.5 rounded-full">
                  Cold-Chain Clinical Inventory
                </span>
              </div>
              <span className="text-xs text-purple-700 font-semibold">
                Showing {vaccineAntigenList.length} Antigens &bull; Doses calculated with clinical conversion factors
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {vaccineAntigenList.map(stat => {
                const pct = stat.allocated > 0 ? Math.round((stat.ordered / stat.allocated) * 100) : 0;
                const isExhausted = stat.remaining <= 0;

                return (
                  <div key={stat.name} className="p-4 bg-purple-50/20 border border-purple-200/80 rounded-2xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#5C2D91]"></span>
                        <span className="truncate max-w-[180px]" title={stat.name}>{stat.name}</span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isExhausted
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {isExhausted
                          ? 'Exhausted'
                          : unitDisplayMode === 'doses'
                          ? `${stat.remainingDoses.toLocaleString()} doses Rem.`
                          : unitDisplayMode === 'both'
                          ? `${stat.remaining.toLocaleString()} v (${stat.remainingDoses.toLocaleString()} d) Rem.`
                          : `${stat.remaining.toLocaleString()} v Rem.`}
                      </span>
                    </div>

                    {/* Breakdown Numbers */}
                    <div className="grid grid-cols-3 gap-1.5 bg-white border border-purple-100 rounded-xl p-2 text-center text-[10px]">
                      <div>
                        <span className="text-indigo-600 font-bold block">Carry-Over</span>
                        <strong className="text-slate-800">
                          {unitDisplayMode === 'doses'
                            ? `${stat.carryOverDoses.toLocaleString()} d`
                            : `${stat.carryOver.toLocaleString()} v`}
                        </strong>
                      </div>
                      <div>
                        <span className="text-blue-600 font-bold block">Monthly Alloc</span>
                        <strong className="text-slate-800">
                          {unitDisplayMode === 'doses'
                            ? `${stat.monthlyAllocDoses.toLocaleString()} d`
                            : `${stat.monthlyAlloc.toLocaleString()} v`}
                        </strong>
                      </div>
                      <div>
                        <span className="text-amber-600 font-bold block">Distributed</span>
                        <strong className="text-amber-700">
                          {unitDisplayMode === 'doses'
                            ? `${stat.orderedDoses.toLocaleString()} d`
                            : `${stat.ordered.toLocaleString()} v`}
                        </strong>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          pct >= 100 ? 'bg-rose-600' : pct >= 80 ? 'bg-amber-500' : 'bg-[#5C2D91]'
                        }`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      ></div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                      <span>
                        Total Quota:{' '}
                        <strong>
                          {unitDisplayMode === 'doses'
                            ? `${stat.allocatedDoses.toLocaleString()} d`
                            : `${stat.allocated.toLocaleString()} v`}
                        </strong>
                      </span>
                      <span className="font-bold text-slate-700">{pct}% taken</span>
                    </div>

                    <div className="text-[10px] text-slate-400 flex items-center justify-between">
                      <span>{stat.facilitiesCount} {stat.facilitiesCount === 1 ? 'facility' : 'facilities'}</span>
                      <span className="font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                        {stat.dosesPerVial} doses / vial
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* --------------------------------------------------------------------- */}
        {/* TAB 4: SYRINGES & INJECTION CONSUMABLES BREAKDOWN (PIECES ONLY)       */}
        {/* --------------------------------------------------------------------- */}
        {dashboardTab === 'syringes' && (
          <div className="space-y-4">
            <div className="p-3 bg-sky-50 border border-sky-200 rounded-2xl flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-sky-600" />
                <span className="text-xs font-black text-sky-900">
                  Syringes (Consumables) Only
                </span>
                <span className="text-[10px] bg-sky-100 text-sky-800 font-bold px-2 py-0.5 rounded-full">
                  Soloshot 0.05ml, Soloshot 0.5ml, Syringes and needles 2ml &amp; 5ml (Pieces)
                </span>
              </div>
              <span className="text-xs text-sky-700 font-semibold">
                Showing {syringeDeviceList.length} Syringe Products &bull; Tracked strictly in physical pieces (pcs)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {syringeDeviceList.map(stat => {
                const pct = stat.allocated > 0 ? Math.round((stat.ordered / stat.allocated) * 100) : 0;
                const isExhausted = stat.remaining <= 0;

                return (
                  <div key={stat.name} className="p-4 bg-sky-50/20 border border-sky-200/80 rounded-2xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
                        <span className="truncate max-w-[180px]" title={stat.name}>{stat.name}</span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isExhausted
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-sky-100 text-sky-800'
                      }`}>
                        {isExhausted
                          ? 'Exhausted'
                          : `${stat.remaining.toLocaleString()} pcs Rem.`}
                      </span>
                    </div>

                    {/* Breakdown Numbers in Physical Pieces */}
                    <div className="grid grid-cols-3 gap-1.5 bg-white border border-sky-100 rounded-xl p-2 text-center text-[10px]">
                      <div>
                        <span className="text-indigo-600 font-bold block">Carry-Over</span>
                        <strong className="text-slate-800">
                          {stat.carryOver.toLocaleString()} pcs
                        </strong>
                      </div>
                      <div>
                        <span className="text-blue-600 font-bold block">Monthly Alloc</span>
                        <strong className="text-slate-800">
                          {stat.monthlyAlloc.toLocaleString()} pcs
                        </strong>
                      </div>
                      <div>
                        <span className="text-amber-600 font-bold block">Distributed</span>
                        <strong className="text-amber-700">
                          {stat.ordered.toLocaleString()} pcs
                        </strong>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          pct >= 100 ? 'bg-rose-600' : pct >= 80 ? 'bg-amber-500' : 'bg-sky-600'
                        }`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      ></div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                      <span>
                        Total Quota:{' '}
                        <strong>{stat.allocated.toLocaleString()} pcs</strong>
                      </span>
                      <span className="font-bold text-slate-700">{pct}% taken</span>
                    </div>

                    <div className="text-[10px] text-slate-400 flex items-center justify-between">
                      <span>{stat.facilitiesCount} {stat.facilitiesCount === 1 ? 'facility' : 'facilities'}</span>
                      <span className="font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
                        Syringe Consumable
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* --------------------------------------------------------------------- */}
        {/* TAB 5: FACILITIES MATRIX VIEW (SEPARATED VACCINES VS SYRINGES)        */}
        {/* --------------------------------------------------------------------- */}
        {dashboardTab === 'facilities' && (
          <div className="space-y-4">
            {/* Facilities Matrix Commodity Switcher */}
            <div className="flex items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-2xl border border-slate-200 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase px-1">View Columns:</span>
                <button
                  type="button"
                  onClick={() => setMatrixCommodityView('both')}
                  className={`px-3 py-1 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    matrixCommodityView === 'both' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900 bg-white border border-slate-200'
                  }`}
                >
                  Side-by-Side Separated (Both)
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixCommodityView('vaccines')}
                  className={`px-3 py-1 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1 ${
                    matrixCommodityView === 'vaccines' ? 'bg-[#5C2D91] text-white shadow-xs' : 'text-purple-800 hover:text-purple-950 bg-purple-50 border border-purple-200'
                  }`}
                >
                  <Syringe className="w-3 h-3" />
                  Vaccines Only (Vials &amp; Doses)
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixCommodityView('devices')}
                  className={`px-3 py-1 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1 ${
                    matrixCommodityView === 'devices' ? 'bg-sky-600 text-white shadow-xs' : 'text-sky-800 hover:text-sky-950 bg-sky-50 border border-sky-200'
                  }`}
                >
                  <Package className="w-3 h-3" />
                  Syringes Only (Pieces)
                </button>
              </div>

              <div className="text-xs text-slate-500 font-medium">
                {matrixCommodityView === 'both' && 'Vaccines and Syringes presented in separate dedicated columns'}
                {matrixCommodityView === 'vaccines' && 'Focusing strictly on clinical antigens in vials & doses'}
                {matrixCommodityView === 'devices' && 'Focusing strictly on injection devices & syringes in pieces'}
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Facility Name</th>
                    <th className="py-2.5 px-3">District &amp; Sub-District</th>
                    <th className="py-2.5 px-3">Blueprint Status</th>

                    {/* Both View: Clearly separated columns */}
                    {matrixCommodityView === 'both' && (
                      <>
                        <th className="py-2.5 px-3 text-left bg-purple-50/50 text-[#5C2D91]">
                          {selectedVaccine === 'all' ? 'Vaccine Antigens (Separated Balance)' : `${selectedVaccine} Balance`}
                        </th>
                        <th className="py-2.5 px-3 text-right bg-purple-50/50 text-amber-700">
                          {selectedVaccine === 'all' ? 'Vaccines Distributed' : `${selectedVaccine} Taken`}
                        </th>
                        <th className="py-2.5 px-3 text-right bg-sky-50/50 text-sky-900">
                          Syringes Quota (pcs)
                        </th>
                        <th className="py-2.5 px-3 text-right bg-sky-50/50 text-emerald-700 font-black">
                          Syringes Balance (pcs)
                        </th>
                      </>
                    )}

                    {/* Vaccines Only View */}
                    {matrixCommodityView === 'vaccines' && (
                      <>
                        <th className="py-2.5 px-3 text-left bg-purple-50/50 text-indigo-700">
                          {selectedVaccine === 'all' ? 'Individual Vaccines Tracked' : `${selectedVaccine} Quota`}
                        </th>
                        <th className="py-2.5 px-3 text-right bg-purple-50/50 text-amber-700">Distributed / Taken</th>
                        <th className="py-2.5 px-3 text-left bg-purple-50/50 text-emerald-700 font-black">
                          {selectedVaccine === 'all' ? 'Separated Vaccine Balances' : `${selectedVaccine} Balance`}
                        </th>
                      </>
                    )}

                    {/* Syringes Only View */}
                    {matrixCommodityView === 'devices' && (
                      <>
                        <th className="py-2.5 px-3 text-right bg-sky-50/50 text-indigo-700">Carry-Over (pcs)</th>
                        <th className="py-2.5 px-3 text-right bg-sky-50/50 text-slate-800">Monthly Alloc</th>
                        <th className="py-2.5 px-3 text-right bg-sky-50/50 text-amber-700">Distributed</th>
                        <th className="py-2.5 px-3 text-right bg-sky-50/50 text-emerald-700 font-black">Balance (pcs)</th>
                      </>
                    )}

                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredFacilities.map(f => {
                    const bpFac = blueprintRowMap[f.facilityName.toLowerCase()];
                    const facEntries = Object.entries(f.vaccines) as [string, VaccineAllocationItem][];

                    // Separate Vaccines vs Devices
                    const vaccineEntries = facEntries.filter(([vName]) => !isDeviceProduct(vName));
                    const deviceEntries = facEntries.filter(([vName]) => isDeviceProduct(vName));

                    // Filtered antigen entries based on selectedVaccine
                    const activeVaccineEntries = selectedVaccine === 'all'
                      ? vaccineEntries
                      : vaccineEntries.filter(([vName]) => vName === selectedVaccine);

                    // Device metrics (Pieces)
                    const devCarry = deviceEntries.reduce((acc, [, v]) => acc + (v.carryOver || 0), 0);
                    const devMonthly = deviceEntries.reduce((acc, [, v]) => acc + (v.original || 0), 0);
                    const devAlloc = devCarry + devMonthly;
                    const devTaken = deviceEntries.reduce((acc, [, v]) => acc + (v.taken || 0), 0);
                    const devRem = deviceEntries.reduce((acc, [, v]) => acc + (v.remaining || 0), 0);

                    const isRowExpanded = expandedFacilityRow === f.id;

                    return (
                      <React.Fragment key={f.id}>
                        <tr className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setExpandedFacilityRow(isRowExpanded ? null : f.id)}
                                className="text-slate-400 hover:text-[#5C2D91] cursor-pointer"
                                title="Toggle separated vaccine breakdown for this facility"
                              >
                                {isRowExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                              <div>
                                <div className="font-bold text-slate-900">{f.facilityName}</div>
                                <div className="text-[10px] text-slate-400">{f.nest} &bull; {f.cycle}</div>
                              </div>
                            </div>
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

                          {/* Both View: Separated Columns */}
                          {matrixCommodityView === 'both' && (
                            <>
                              {/* Separated Vaccine Balances */}
                              <td className="py-3 px-3 bg-purple-50/30 max-w-xs">
                                <div className="flex flex-wrap gap-1">
                                  {activeVaccineEntries.map(([vName, v]) => {
                                    const isEx = v.remaining <= 0;
                                    const dpv = v.dosesPerVial || getVaccineDosesPerVial(vName);
                                    const remD = v.remainingDoses !== undefined ? v.remainingDoses : v.remaining * dpv;

                                    return (
                                      <span
                                        key={vName}
                                        className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                          isEx
                                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                                            : 'bg-white text-purple-900 border-purple-200 shadow-2xs'
                                        }`}
                                      >
                                        {vName}:{' '}
                                        <span className={isEx ? 'text-rose-700' : 'text-[#5C2D91]'}>
                                          {unitDisplayMode === 'doses'
                                            ? `${remD.toLocaleString()}d`
                                            : unitDisplayMode === 'both'
                                            ? `${v.remaining}v (${remD.toLocaleString()}d)`
                                            : `${v.remaining}v`}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>

                              <td className="py-3 px-3 text-right font-bold text-amber-700 bg-purple-50/30">
                                {activeVaccineEntries.map(([vName, v]) => (
                                  <div key={vName} className="text-[10px] text-amber-800">
                                    {vName}: {v.taken}v
                                  </div>
                                ))}
                              </td>

                              <td className="py-3 px-3 text-right font-bold text-sky-900 bg-sky-50/30">
                                {devAlloc.toLocaleString()} pcs
                              </td>
                              <td className="py-3 px-3 text-right font-black text-emerald-700 bg-sky-50/30">
                                {devRem.toLocaleString()} pcs
                              </td>
                            </>
                          )}

                          {/* Vaccines Only View: Separated Antigens for Facility */}
                          {matrixCommodityView === 'vaccines' && (
                            <>
                              <td className="py-3 px-3 bg-purple-50/30">
                                <div className="text-xs font-bold text-slate-800">
                                  {activeVaccineEntries.length} Antigens Tracked
                                </div>
                                <div className="text-[10px] text-purple-700">
                                  Click arrow to view individual lines
                                </div>
                              </td>

                              <td className="py-3 px-3 text-right font-bold text-amber-700 bg-purple-50/30">
                                {activeVaccineEntries.map(([vName, v]) => (
                                  <div key={vName} className="text-[10px] text-amber-800">
                                    {vName}: {v.taken}v taken
                                  </div>
                                ))}
                              </td>

                              <td className="py-3 px-3 bg-purple-50/30">
                                <div className="flex flex-wrap gap-1">
                                  {activeVaccineEntries.map(([vName, v]) => {
                                    const isEx = v.remaining <= 0;
                                    const dpv = v.dosesPerVial || getVaccineDosesPerVial(vName);
                                    const remD = v.remainingDoses !== undefined ? v.remainingDoses : v.remaining * dpv;

                                    return (
                                      <span
                                        key={vName}
                                        className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                          isEx
                                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                                            : 'bg-white text-purple-900 border-purple-200 shadow-2xs'
                                        }`}
                                      >
                                        {vName}:{' '}
                                        <span className={isEx ? 'text-rose-700' : 'text-emerald-700 font-black'}>
                                          {unitDisplayMode === 'doses'
                                            ? `${remD.toLocaleString()}d`
                                            : unitDisplayMode === 'both'
                                            ? `${v.remaining}v (${remD.toLocaleString()}d)`
                                            : `${v.remaining}v`}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                            </>
                          )}

                          {/* Syringes Only View */}
                          {matrixCommodityView === 'devices' && (
                            <>
                              <td className="py-3 px-3 text-right font-bold text-indigo-700 bg-sky-50/30">
                                {devCarry.toLocaleString()} pcs
                              </td>
                              <td className="py-3 px-3 text-right font-black text-slate-900 bg-sky-50/30">
                                {devMonthly.toLocaleString()} pcs
                              </td>
                              <td className="py-3 px-3 text-right font-bold text-amber-700 bg-sky-50/30">
                                {devTaken.toLocaleString()} pcs
                              </td>
                              <td className="py-3 px-3 text-right font-black text-emerald-700 bg-sky-50/30">
                                {devRem.toLocaleString()} pcs
                              </td>
                            </>
                          )}

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

                        {/* Expandable Per-Antigen Sub-Table for this Health Facility */}
                        {isRowExpanded && (
                          <tr className="bg-purple-50/30">
                            <td colSpan={matrixCommodityView === 'both' ? 8 : 5} className="p-3">
                              <div className="bg-white border border-purple-200 rounded-xl p-3 space-y-2">
                                <div className="text-xs font-bold text-[#5C2D91] flex items-center justify-between">
                                  <span className="flex items-center gap-1.5">
                                    <Syringe className="w-3.5 h-3.5" />
                                    {f.facilityName} &bull; Separated Vaccine Antigens Breakdown
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-normal">
                                    Never added together &bull; Individual antigen quotas and clinical conversions
                                  </span>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                      <tr className="border-b border-purple-100 text-[9px] text-slate-400 uppercase font-bold">
                                        <th className="py-1 px-1.5">Antigen</th>
                                        <th className="py-1 px-1.5 text-right text-indigo-700">Carry-Over</th>
                                        <th className="py-1 px-1.5 text-right text-blue-700">Monthly Alloc</th>
                                        <th className="py-1 px-1.5 text-right text-amber-700">Distributed</th>
                                        <th className="py-1 px-1.5 text-right text-emerald-700 font-black">Balance</th>
                                        <th className="py-1 px-1.5 text-center">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-purple-50 text-[11px]">
                                      {activeVaccineEntries.map(([vName, vAlloc]) => {
                                        const dpv = vAlloc.dosesPerVial || getVaccineDosesPerVial(vName);
                                        const carry = vAlloc.carryOver || 0;
                                        const carryD = vAlloc.carryOverDoses !== undefined ? vAlloc.carryOverDoses : carry * dpv;
                                        const monthly = vAlloc.original || 0;
                                        const monthlyD = vAlloc.originalDoses !== undefined ? vAlloc.originalDoses : monthly * dpv;
                                        const takenD = vAlloc.takenDoses !== undefined ? vAlloc.takenDoses : vAlloc.taken * dpv;
                                        const remD = vAlloc.remainingDoses !== undefined ? vAlloc.remainingDoses : vAlloc.remaining * dpv;
                                        const isEx = vAlloc.remaining <= 0;

                                        return (
                                          <tr key={vName} className="hover:bg-purple-50/50">
                                            <td className="py-1 px-1.5 font-bold text-slate-900">
                                              {vName} <span className="text-[9px] font-normal text-slate-400">({dpv}d/v)</span>
                                            </td>
                                            <td className="py-1 px-1.5 text-right text-indigo-800">
                                              {unitDisplayMode === 'doses' ? `${carryD.toLocaleString()}d` : `${carry.toLocaleString()}v`}
                                            </td>
                                            <td className="py-1 px-1.5 text-right text-blue-800">
                                              {unitDisplayMode === 'doses' ? `${monthlyD.toLocaleString()}d` : `${monthly.toLocaleString()}v`}
                                            </td>
                                            <td className="py-1 px-1.5 text-right text-amber-700">
                                              {unitDisplayMode === 'doses' ? `${takenD.toLocaleString()}d` : `${vAlloc.taken.toLocaleString()}v`}
                                            </td>
                                            <td className="py-1 px-1.5 text-right text-emerald-700 font-black">
                                              {unitDisplayMode === 'doses'
                                                ? `${remD.toLocaleString()}d`
                                                : unitDisplayMode === 'both'
                                                ? `${vAlloc.remaining.toLocaleString()}v (${remD.toLocaleString()}d)`
                                                : `${vAlloc.remaining.toLocaleString()}v`}
                                            </td>
                                            <td className="py-1 px-1.5 text-center">
                                              <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                                isEx ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                              }`}>
                                                {isEx ? 'Exhausted' : 'Available'}
                                              </span>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
