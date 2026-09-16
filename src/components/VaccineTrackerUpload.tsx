/**
 * Vaccine Allocation Tracker & Multi-Tab Upload Component
 * Implements Section 2, 15 & 20 of requirements:
 * - Scans ALL tabs/sheets in uploaded Excel workbooks
 * - Interactive Tab Selector with multi-tab preview & sub-district detection
 * - Supports Hierarchical Multi-Antigen Matrix sheets (Carry-over | Allocation | Distributed | Balance)
 * - Automatic sub-district handling (via tab names, section banner rows, or dedicated columns)
 * - Batch Import (All Tabs, Selected Tabs, or Single Tab)
 * - Fallback interactive column-mapping screen if headers vary
 * - Generates & downloads a ready-to-test multi-tab GHS EPI sample workbook
 * - Displays all facilities with Original, Taken, Adjustments, and Remaining
 * - DCO Quota Adjustment Modal (+/- adjustments with reasons without touching immutable original baseline)
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Download,
  Filter,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Building2,
  ArrowUpDown,
  History,
  ShieldAlert,
  XCircle,
  HelpCircle,
  Layers,
  CheckSquare,
  Square,
  Eye,
  Sparkles,
  MapPin,
  Table,
  Check,
  ChevronRight,
  Trash2,
  LayoutGrid,
  List
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  FacilityAllocation,
  AllocationAdjustment,
  VaccineAllocationItem,
  ScannedSheetTab,
  ParsedAllocationRow
} from '../types';
import { scanFullWorkbook } from '../utils/vaccineSheetParser';

interface VaccineTrackerUploadProps {
  onFacilitySelectedForOrder?: (facilityId: string) => void;
}

export default function VaccineTrackerUpload({ onFacilitySelectedForOrder }: VaccineTrackerUploadProps) {
  const [facilities, setFacilities] = useState<FacilityAllocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [districtFilter, setDistrictFilter] = useState('all');
  const [subDistrictFilter, setSubDistrictFilter] = useState('all');
  const [nestFilter, setNestFilter] = useState('all');
  const [vaccineFilter, setVaccineFilter] = useState('all');
  const [trackerLayout, setTrackerLayout] = useState<'matrix' | 'cards'>('matrix');

  // Multi-tab Workbook Scanner states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scannedTabs, setScannedTabs] = useState<ScannedSheetTab[]>([]);
  const [activeTabIdx, setActiveTabIdx] = useState<number>(0);
  const [showTabScannerModal, setShowTabScannerModal] = useState(false);

  // Fallback Single-Sheet Column mapping states
  const [uploadedRawData, setUploadedRawData] = useState<any[] | null>(null);
  const [uploadedHeaders, setUploadedHeaders] = useState<string[]>([]);
  const [showColumnMapper, setShowColumnMapper] = useState(false);
  const [columnMap, setColumnMap] = useState({
    facility: '',
    vaccine: '',
    allocation: '',
    taken: '',
    subDistrict: '',
    district: '',
    nest: '',
    cycle: ''
  });

  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // Adjustment Modal states
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedFacilityForAdjust, setSelectedFacilityForAdjust] = useState<FacilityAllocation | null>(null);
  const [adjustVaccine, setAdjustVaccine] = useState('');
  const [adjustQuantity, setAdjustQuantity] = useState<number | ''>('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustOfficer, setAdjustOfficer] = useState('DCO Coordinator');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Clear Allocations Modal states
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearHistoryLogs, setClearHistoryLogs] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const fetchFacilities = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vaccine/allocations');
      if (res.ok) {
        const data = await res.json();
        setFacilities(data);
      }
    } catch (err) {
      console.error('Failed to load facilities:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleClearAllocations = async () => {
    setClearing(true);
    setClearError(null);
    try {
      const res = await fetch('/api/vaccine/allocations/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearHistory: clearHistoryLogs })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to clear allocations');

      setFacilities([]);
      setShowClearModal(false);
      setImportMessage('Previous allocations have been cleared successfully. Workspace is now ready for your new cycle workbook.');
    } catch (err: any) {
      setClearError(err.message || 'Failed to clear allocations');
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => {
    fetchFacilities();
  }, []);

  const handleResetDemo = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vaccine/allocations/reset-demo', { method: 'POST' });
      if (res.ok) {
        await fetchFacilities();
      }
    } catch (err) {
      console.error('Failed to reset demo allocations:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter values
  const districts = Array.from(new Set(facilities.map(f => f.district).filter(Boolean))) as string[];
  const subDistricts = Array.from(
    new Set(
      facilities
        .filter(f => districtFilter === 'all' || f.district === districtFilter)
        .map(f => f.subDistrict)
        .filter(Boolean)
    )
  ) as string[];
  const nests = Array.from(new Set(facilities.map(f => f.nest).filter(Boolean))) as string[];
  const allAllocatedVaccines: string[] = Array.from(
    new Set(facilities.flatMap(f => Object.keys(f.vaccines)))
  );

  // File parsing (Excel or CSV) with Multi-Sheet Workbook Scanner
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    parseFile(file);
    if (e.target) e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  };

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          alert('Uploaded file contains no sheets.');
          return;
        }

        // Scan ALL sheets in the workbook
        const tabs = scanFullWorkbook(workbook);

        if (tabs.length === 0) {
          alert('No readable data rows found across any sheets in the uploaded file.');
          return;
        }

        setScannedTabs(tabs);
        setActiveTabIdx(0);
        setShowTabScannerModal(true);

        // Also prepare first sheet data in case user switches to manual column mapper
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawJson: any[] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        if (rawJson.length > 1) {
          const headers = (rawJson[0] || []).map((h: any) => String(h || '').trim());
          setUploadedHeaders(headers);
          const rows = rawJson.slice(1).map(row => {
            const rowObj: any = {};
            headers.forEach((h, idx) => {
              rowObj[h] = row[idx];
            });
            return rowObj;
          });
          setUploadedRawData(rows);

          setColumnMap({
            facility: headers.find(h => /facility|hospital|clinic|site|name/i.test(h)) || '',
            vaccine: headers.find(h => /vaccine|product|item|antigen/i.test(h)) || '',
            allocation: headers.find(h => /allocation|allocated|original|doses|quota/i.test(h)) || '',
            taken: headers.find(h => /taken|ordered|issued|dispatched|consumed/i.test(h)) || '',
            subDistrict: headers.find(h => /sub[-\s]?district/i.test(h)) || '',
            district: headers.find(h => /district/i.test(h)) || '',
            nest: headers.find(h => /nest|hub|depot/i.test(h)) || '',
            cycle: headers.find(h => /cycle|month|period/i.test(h)) || ''
          });
        }
      } catch (err: any) {
        alert('Failed to read file: ' + err.message);
      }
    };
    reader.readAsBinaryString(file);
  };

  // Toggle tab selection for batch import
  const toggleTabSelection = (idx: number) => {
    setScannedTabs(prev => prev.map((tab, i) => i === idx ? { ...tab, selectedForImport: !tab.selectedForImport } : tab));
  };

  // Select all or deselect all tabs
  const toggleSelectAllTabs = (select: boolean) => {
    setScannedTabs(prev => prev.map(tab => ({ ...tab, selectedForImport: select })));
  };

  // Update detected district or sub-district override on active tab
  const updateActiveTabMetadata = (field: 'detectedDistrict' | 'detectedSubDistrict', val: string) => {
    setScannedTabs(prev => prev.map((tab, i) => {
      if (i !== activeTabIdx) return tab;
      const updated = { ...tab, [field]: val };
      // Also update parsed rows default district/sub-district
      updated.rows = tab.rows.map(r => ({
        ...r,
        district: field === 'detectedDistrict' ? val : r.district,
        subDistrict: field === 'detectedSubDistrict' ? (val || undefined) : r.subDistrict
      }));
      return updated;
    }));
  };

  // Submit scanned tabs directly into backend
  const handleImportScannedTabs = async (tabsToImport: ScannedSheetTab[]) => {
    if (!tabsToImport || tabsToImport.length === 0) {
      alert('Please select at least one tab to import.');
      return;
    }

    const allRows: ParsedAllocationRow[] = tabsToImport.flatMap(t => t.rows);

    if (allRows.length === 0) {
      alert('No facility allocation rows found in the selected tab(s).');
      return;
    }

    setImporting(true);
    setImportMessage(null);

    try {
      const res = await fetch('/api/vaccine/allocations/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: allRows,
          updatedBy: `DCO Workbook Scanner (${tabsToImport.map(t => t.sheetName).join(', ')})`
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');

      setImportMessage(`Successfully imported ${data.importedCount} allocation records across ${data.facilitiesCount} facilities from ${tabsToImport.length} tab(s).`);
      setShowTabScannerModal(false);
      setScannedTabs([]);
      await fetchFacilities();
    } catch (err: any) {
      alert('Import error: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  // Submit manual mapped records to backend (Fallback)
  const handleApplyImport = async () => {
    if (!uploadedRawData) return;
    if (!columnMap.facility || !columnMap.vaccine || !columnMap.allocation) {
      alert('Please select the columns for Facility, Vaccine, and Allocation.');
      return;
    }

    setImporting(true);
    setImportMessage(null);

    try {
      const normalizedRows = uploadedRawData.map(r => ({
        facility: String(r[columnMap.facility] || ''),
        vaccine: String(r[columnMap.vaccine] || ''),
        allocation: parseFloat(r[columnMap.allocation]) || 0,
        taken: columnMap.taken ? parseFloat(r[columnMap.taken]) || 0 : 0,
        subDistrict: columnMap.subDistrict ? String(r[columnMap.subDistrict] || '') : undefined,
        district: columnMap.district ? String(r[columnMap.district] || '') : undefined,
        nest: columnMap.nest ? String(r[columnMap.nest] || '') : undefined,
        cycle: columnMap.cycle ? String(r[columnMap.cycle] || '') : 'September 2026'
      }));

      const res = await fetch('/api/vaccine/allocations/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: normalizedRows,
          updatedBy: 'DCO Manual Column Mapper'
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');

      setImportMessage(`Successfully imported ${data.importedCount} vaccine allocation items across ${data.facilitiesCount} facilities.`);
      setShowColumnMapper(false);
      setUploadedRawData(null);
      await fetchFacilities();
    } catch (err: any) {
      alert('Import error: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  // Export Realistic Multi-Tab Ghana Health Service (GHS) EPI Vaccine Allocation Matrix
  const handleDownloadSampleExcel = () => {
    const wb = XLSX.utils.book_new();

    // TAB 1: Sekyere Central (Hierarchical Multi-Antigen Matrix with Sub-District Sections)
    const tab1Data = [
      // Row 0: Top Antigen Headers
      ['Facility', 'BCG', '', '', '', 'OPV', '', '', '', 'Penta', '', '', '', 'PCV', '', '', '', 'MR', '', '', ''],
      // Row 1: Sub-Headers (Carry-over, Allocation, Distributed, Balance)
      [
        'Health Facility',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance'
      ],
      // Row 2: Sub-district 1 Header Row
      ['NSUTA SUB-DISTRICT', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      // Row 3..5: Nsuta Facilities
      ['Konkoma SDA Clinic', 10, 40, 20, 30, 20, 80, 60, 40, 15, 45, 20, 40, 0, 0, 0, 0, 5, 35, 10, 30],
      ['Nsuta Health Centre', 20, 80, 30, 70, 30, 120, 50, 100, 20, 60, 25, 55, 10, 40, 15, 35, 10, 40, 15, 35],
      ['Birim Clinic', 5, 25, 10, 20, 10, 50, 20, 40, 10, 30, 10, 30, 5, 25, 10, 20, 5, 20, 5, 20],
      // Row 6: Sub-district 2 Header Row
      ['KWAMANG SUB-DISTRICT', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      // Row 7..9: Kwamang Facilities
      ['Kwamang Health Centre', 15, 60, 25, 50, 25, 100, 40, 85, 15, 50, 20, 45, 10, 35, 10, 35, 10, 30, 10, 30],
      ['Apaah CHPS', 5, 20, 5, 20, 10, 40, 10, 40, 5, 20, 5, 20, 5, 15, 5, 15, 5, 15, 5, 15],
      ['Kyebi CHPS', 5, 25, 10, 20, 10, 30, 10, 30, 5, 20, 5, 20, 5, 15, 5, 15, 5, 15, 5, 15]
    ];

    const ws1 = XLSX.utils.aoa_to_sheet(tab1Data);
    // Merge cells for the antigen titles
    ws1['!merges'] = [
      { s: { r: 0, c: 1 }, e: { r: 0, c: 4 } }, // BCG
      { s: { r: 0, c: 5 }, e: { r: 0, c: 8 } }, // OPV
      { s: { r: 0, c: 9 }, e: { r: 0, c: 12 } }, // Penta
      { s: { r: 0, c: 13 }, e: { r: 0, c: 16 } }, // PCV
      { s: { r: 0, c: 17 }, e: { r: 0, c: 20 } }  // MR
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Sekyere Central');

    // TAB 2: Atebubu Sub-District (Dedicated Sub-district Tab)
    const tab2Data = [
      ['Facility', 'BCG', '', '', '', 'OPV', '', '', '', 'Penta', '', '', '', 'PCV', '', '', '', 'Yellow Fever', '', '', ''],
      [
        'Health Facility',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance'
      ],
      ['Atebubu Municipal Hospital', 0, 80, 80, 0, 20, 100, 90, 30, 10, 80, 50, 40, 10, 50, 20, 40, 5, 45, 10, 40],
      ['Atebubu Health Centre', 10, 40, 15, 35, 15, 60, 25, 50, 10, 40, 15, 35, 10, 30, 10, 30, 5, 25, 5, 25],
      ['Akokoa Health Centre', 5, 30, 10, 25, 10, 40, 15, 35, 5, 25, 10, 20, 5, 20, 5, 20, 5, 20, 5, 20]
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(tab2Data);
    ws2['!merges'] = [
      { s: { r: 0, c: 1 }, e: { r: 0, c: 4 } },
      { s: { r: 0, c: 5 }, e: { r: 0, c: 8 } },
      { s: { r: 0, c: 9 }, e: { r: 0, c: 12 } },
      { s: { r: 0, c: 13 }, e: { r: 0, c: 16 } },
      { s: { r: 0, c: 17 }, e: { r: 0, c: 20 } }
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Atebubu Sub-District');

    // TAB 3: Ejura Sub-District (Dedicated Sub-district Tab)
    const tab3Data = [
      ['Facility', 'BCG', '', '', '', 'OPV', '', '', '', 'Penta', '', '', '', 'PCV', '', '', '', 'Men A', '', '', ''],
      [
        'Health Facility',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance',
        'Carry-over', 'Allocation', 'Distributed', 'Balance'
      ],
      ['Ejura Government Hospital', 15, 85, 30, 70, 25, 125, 50, 100, 10, 90, 40, 60, 10, 70, 30, 50, 0, 40, 10, 30],
      ['Sekyedumase Health Centre', 10, 50, 20, 40, 15, 60, 25, 50, 10, 40, 15, 35, 10, 30, 10, 30, 5, 25, 5, 25],
      ['Anyinasu Health Post', 5, 25, 5, 25, 10, 35, 10, 35, 5, 25, 5, 25, 5, 20, 5, 20, 0, 20, 5, 15]
    ];
    const ws3 = XLSX.utils.aoa_to_sheet(tab3Data);
    ws3['!merges'] = [
      { s: { r: 0, c: 1 }, e: { r: 0, c: 4 } },
      { s: { r: 0, c: 5 }, e: { r: 0, c: 8 } },
      { s: { r: 0, c: 9 }, e: { r: 0, c: 12 } },
      { s: { r: 0, c: 13 }, e: { r: 0, c: 16 } },
      { s: { r: 0, c: 17 }, e: { r: 0, c: 20 } }
    ];
    XLSX.utils.book_append_sheet(wb, ws3, 'Ejura Sub-District');

    XLSX.writeFile(wb, 'GHS_EPI_Vaccine_Allocation_Matrix_MultiTab.xlsx');
  };

  // Submit DCO Quota Adjustment (Section 15)
  const handleApplyAdjustment = async () => {
    if (!selectedFacilityForAdjust || !adjustVaccine || adjustQuantity === '' || isNaN(Number(adjustQuantity))) {
      setAdjustError('Please specify a valid adjustment quantity.');
      return;
    }

    if (!adjustReason.trim()) {
      setAdjustError('A reason/justification is required for audit trail.');
      return;
    }

    setAdjusting(true);
    setAdjustError(null);

    try {
      const res = await fetch(`/api/vaccine/allocations/${selectedFacilityForAdjust.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaccine: adjustVaccine,
          quantity: Number(adjustQuantity),
          reason: adjustReason,
          user: adjustOfficer
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Adjustment failed');

      setShowAdjustModal(false);
      setSelectedFacilityForAdjust(null);
      setAdjustVaccine('');
      setAdjustQuantity('');
      setAdjustReason('');
      await fetchFacilities();
    } catch (err: any) {
      setAdjustError(err.message || 'Failed to save adjustment');
    } finally {
      setAdjusting(false);
    }
  };

  // Filtered facilities
  const filtered = facilities.filter(f => {
    const matchesSearch = f.facilityName.toLowerCase().includes(search.toLowerCase()) ||
      (f.subDistrict && f.subDistrict.toLowerCase().includes(search.toLowerCase())) ||
      (f.district && f.district.toLowerCase().includes(search.toLowerCase())) ||
      Object.keys(f.vaccines).some(v => v.toLowerCase().includes(search.toLowerCase()));
    const matchesDistrict = districtFilter === 'all' || f.district === districtFilter;
    const matchesSubDistrict = subDistrictFilter === 'all' || f.subDistrict === subDistrictFilter;
    const matchesNest = nestFilter === 'all' || f.nest === nestFilter;
    const matchesVaccine = vaccineFilter === 'all' || Object.keys(f.vaccines).includes(vaccineFilter);
    return matchesSearch && matchesDistrict && matchesSubDistrict && matchesNest && matchesVaccine;
  });

  // Calculate cohort stats
  const totalCohortAllocated = facilities.reduce((sum, f) => {
    return sum + (Object.values(f.vaccines) as VaccineAllocationItem[]).reduce((vSum, v) => vSum + v.original + (v.adjustment || 0), 0);
  }, 0);
  const totalCohortTaken = facilities.reduce((sum, f) => {
    return sum + (Object.values(f.vaccines) as VaccineAllocationItem[]).reduce((vSum, v) => vSum + v.taken, 0);
  }, 0);
  const totalCohortRemaining = facilities.reduce((sum, f) => {
    return sum + (Object.values(f.vaccines) as VaccineAllocationItem[]).reduce((vSum, v) => vSum + v.remaining, 0);
  }, 0);

  // Antigen-level summary across all facilities
  const vaccineCohortStats: Record<string, { totalAlloc: number; totalTaken: number; totalRem: number; facilityCount: number }> = {};
  for (const f of facilities) {
    for (const [vName, vItem] of Object.entries(f.vaccines) as [string, VaccineAllocationItem][]) {
      if (!vaccineCohortStats[vName]) {
        vaccineCohortStats[vName] = { totalAlloc: 0, totalTaken: 0, totalRem: 0, facilityCount: 0 };
      }
      vaccineCohortStats[vName].totalAlloc += vItem.original + (vItem.adjustment || 0);
      vaccineCohortStats[vName].totalTaken += vItem.taken;
      vaccineCohortStats[vName].totalRem += vItem.remaining;
      vaccineCohortStats[vName].facilityCount += 1;
    }
  }

  const activeTab = scannedTabs[activeTabIdx] || null;
  const selectedTabsCount = scannedTabs.filter(t => t.selectedForImport).length;
  const totalFacilitiesInScanned = new Set(scannedTabs.flatMap(t => t.rows.map(r => r.facility.toLowerCase()))).size;

  return (
    <div className="space-y-6">
      {/* SECTION 2: ALLOCATION TRACKER UPLOAD & MULTI-TAB SCANNER */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-[#5C2D91] text-white text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Section 2
              </span>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">
                Vaccine Allocation Tracker &bull; DCO Intake &amp; Sheet Scanner
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Scans <strong>all tabs/worksheets</strong>, detects sub-districts and hierarchical antigen matrices (Carry-over, Allocation, Distributed, Balance), and validates allocations.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowClearModal(true)}
              className="bg-rose-50 hover:bg-rose-100/90 text-rose-700 text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-rose-200 shadow-2xs"
              title="Clear previous allocations to pave the way for a new cycle"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              Clear Previous Allocations
            </button>
            <button
              onClick={handleDownloadSampleExcel}
              className="bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-slate-200"
              title="Download GHS EPI Multi-Tab & Sub-District Sample Spreadsheet"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              Download Multi-Tab Sample .xlsx
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#5C2D91] hover:bg-[#482372] text-white text-xs font-bold px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload &amp; Scan Workbook
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx,.xls,.csv"
              className="hidden"
            />
          </div>
        </div>

        {/* Drag & Drop Target Area */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="mt-5 border-2 border-dashed border-slate-200 hover:border-[#5C2D91] hover:bg-purple-50/20 rounded-2xl p-6 text-center cursor-pointer transition-all"
        >
          <div className="w-12 h-12 rounded-2xl bg-purple-100/70 text-[#5C2D91] flex items-center justify-center mx-auto mb-2">
            <Layers className="w-6 h-6" />
          </div>
          <div className="text-xs font-bold text-slate-800">
            Drag &amp; drop DCO Vaccine Allocation Workbook (.xlsx or .csv)
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Automatically parses all tabs, sub-districts, and matrix columns while updating balances safely
          </div>
        </div>

        {importMessage && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{importMessage}</span>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* WORKBOOK TAB SCANNER & SELECTOR MODAL (New User Request)                 */}
      {/* ========================================================================= */}
      {showTabScannerModal && scannedTabs.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-4xl w-full overflow-hidden flex flex-col my-auto max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-purple-50/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#5C2D91] text-white flex items-center justify-center shadow-sm">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    Workbook Scanner: Detected Tabs &amp; Sub-Districts
                    <span className="text-xs font-bold bg-purple-100 text-[#5C2D91] px-2 py-0.5 rounded-full">
                      {scannedTabs.length} Tabs Found
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Select which sheet(s) to import into the authoritative vaccine tracker. All tabs and sub-districts have been scanned.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowTabScannerModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Summary Metrics Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/70 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Tabs</span>
                  <span className="font-black text-slate-800 text-sm">{scannedTabs.length} Sheets</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Facilities</span>
                  <span className="font-black text-slate-800 text-sm">{totalFacilitiesInScanned} Facilities</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Tabs Selected</span>
                  <span className="font-black text-[#5C2D91] text-sm">{selectedTabsCount} of {scannedTabs.length}</span>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleSelectAllTabs(true)}
                    className="text-[11px] font-bold text-[#5C2D91] hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300">&bull;</span>
                  <button
                    type="button"
                    onClick={() => toggleSelectAllTabs(false)}
                    className="text-[11px] font-bold text-slate-500 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Tabs Selector Ribbon */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                  <span>Available Sheets in File:</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    Click a tab to preview its data below
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {scannedTabs.map((tab, idx) => {
                    const isActive = idx === activeTabIdx;
                    return (
                      <div
                        key={tab.sheetName}
                        onClick={() => setActiveTabIdx(idx)}
                        className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                          isActive
                            ? 'bg-purple-50/70 border-[#5C2D91] shadow-sm'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTabSelection(idx);
                              }}
                              className="text-slate-600 hover:text-[#5C2D91] cursor-pointer"
                            >
                              {tab.selectedForImport ? (
                                <CheckSquare className="w-4 h-4 text-[#5C2D91]" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-400" />
                              )}
                            </button>
                            <span className="font-bold text-xs text-slate-900 truncate">
                              {tab.sheetName}
                            </span>
                          </div>

                          {tab.isSubDistrictTab ? (
                            <span className="text-[10px] font-bold bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded">
                              Sub-District
                            </span>
                          ) : tab.subDistrictsFound.length > 0 ? (
                            <span className="text-[10px] font-bold bg-purple-100 text-[#5C2D91] px-1.5 py-0.5 rounded">
                              {tab.subDistrictsFound.length} Sub-Districts
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                              District Tab
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-100 pt-2">
                          <span>{tab.facilityCount} facilities</span>
                          <span className="text-[10px] text-slate-400">
                            {tab.isMatrixLayout ? 'Matrix Format' : 'Flat Table'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Active Tab Preview & Configuration */}
              {activeTab && (
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm space-y-3 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Table className="w-4 h-4 text-[#5C2D91]" />
                      <h4 className="text-xs font-black text-slate-900 uppercase tracking-wide">
                        Inspecting Tab: &quot;{activeTab.sheetName}&quot;
                      </h4>
                      {activeTab.isMatrixLayout && (
                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Check className="w-3 h-3" /> Matrix (Carry-over &bull; Alloc &bull; Dist &bull; Bal)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">Parent District:</span>
                      <input
                        type="text"
                        value={activeTab.detectedDistrict}
                        onChange={e => updateActiveTabMetadata('detectedDistrict', e.target.value)}
                        className="font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-0.5 text-xs outline-none focus:border-[#5C2D91]"
                        placeholder="District name"
                      />
                    </div>
                  </div>

                  {/* Sub-districts identified in this tab */}
                  {activeTab.subDistrictsFound.length > 0 && (
                    <div className="flex items-center gap-2 text-xs bg-indigo-50/60 border border-indigo-100 p-2 rounded-xl">
                      <span className="font-bold text-indigo-900 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-indigo-600" />
                        Sub-districts detected in this tab:
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {activeTab.subDistrictsFound.map(sub => (
                          <span key={sub} className="bg-white border border-indigo-200 text-indigo-800 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                            {sub}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Antigens detected in this tab */}
                  {activeTab.antigensFound.length > 0 && (
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <span className="font-bold text-slate-700">Antigens found:</span>
                      {activeTab.antigensFound.map(ant => (
                        <span key={ant} className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-medium">
                          {ant}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Scanned rows table preview */}
                  <div className="overflow-x-auto max-h-60 border border-slate-100 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-slate-600 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="py-2 px-3">Facility</th>
                          <th className="py-2 px-3">Sub-District</th>
                          <th className="py-2 px-3">Vaccine</th>
                          <th className="py-2 px-3 text-right">Carry-Over</th>
                          <th className="py-2 px-3 text-right">Allocation</th>
                          <th className="py-2 px-3 text-right">Distributed</th>
                          <th className="py-2 px-3 text-right font-black text-emerald-800">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {activeTab.rows.slice(0, 15).map((r, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50/60">
                            <td className="py-1.5 px-3 font-semibold text-slate-900">{r.facility}</td>
                            <td className="py-1.5 px-3">
                              {r.subDistrict ? (
                                <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.2 rounded">
                                  {r.subDistrict}
                                </span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="py-1.5 px-3 font-bold text-slate-800">{r.vaccine}</td>
                            <td className="py-1.5 px-3 text-right text-slate-500">{r.carryOver || 0}</td>
                            <td className="py-1.5 px-3 text-right text-slate-700">{r.allocation}</td>
                            <td className="py-1.5 px-3 text-right text-slate-600">{r.taken || 0}</td>
                            <td className="py-1.5 px-3 text-right font-black text-emerald-700">{r.remaining}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {activeTab.rows.length > 15 && (
                    <div className="text-[10px] text-center text-slate-400 pt-1">
                      Showing first 15 of {activeTab.rows.length} allocation rows for this sheet.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowTabScannerModal(false);
                  setShowColumnMapper(true);
                }}
                className="text-xs font-bold text-[#5C2D91] hover:underline flex items-center gap-1 cursor-pointer"
              >
                Switch to Manual Column Mapper &rarr;
              </button>

              <div className="flex items-center gap-2 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => setShowTabScannerModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>

                {activeTab && (
                  <button
                    type="button"
                    onClick={() => handleImportScannedTabs([activeTab])}
                    disabled={importing}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold px-3.5 py-2 rounded-xl cursor-pointer"
                  >
                    Import Only &quot;{activeTab.sheetName}&quot;
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const selected = scannedTabs.filter(t => t.selectedForImport);
                    handleImportScannedTabs(selected);
                  }}
                  disabled={importing || selectedTabsCount === 0}
                  className="bg-[#5C2D91] hover:bg-[#482372] disabled:bg-slate-300 text-white text-xs font-bold px-4 py-2 rounded-xl shadow cursor-pointer flex items-center gap-1.5"
                >
                  {importing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  )}
                  Import Selected Tabs ({selectedTabsCount})
                </button>

                <button
                  type="button"
                  onClick={() => handleImportScannedTabs(scannedTabs)}
                  disabled={importing}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-xl shadow cursor-pointer flex items-center gap-1.5"
                >
                  {importing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  Import All {scannedTabs.length} Tabs ({totalFacilitiesInScanned} Facilities)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MANUAL COLUMN MAPPING MODAL (Fallback / Custom Flat Sheets)              */}
      {/* ========================================================================= */}
      {showColumnMapper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-wide">
                  Map Spreadsheet Columns
                </h4>
                <p className="text-xs text-slate-500">
                  Select which columns in your sheet correspond to each allocation field:
                </p>
              </div>
              <button
                onClick={() => setShowColumnMapper(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 items-center gap-2">
                <label className="font-bold text-slate-700">Facility Name *</label>
                <select
                  value={columnMap.facility}
                  onChange={e => setColumnMap({ ...columnMap, facility: e.target.value })}
                  className="bg-slate-50 border border-slate-200 p-2 rounded-xl font-medium outline-none text-xs"
                >
                  <option value="">Select column...</option>
                  {uploadedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 items-center gap-2">
                <label className="font-bold text-slate-700">Vaccine / Product *</label>
                <select
                  value={columnMap.vaccine}
                  onChange={e => setColumnMap({ ...columnMap, vaccine: e.target.value })}
                  className="bg-slate-50 border border-slate-200 p-2 rounded-xl font-medium outline-none text-xs"
                >
                  <option value="">Select column...</option>
                  {uploadedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 items-center gap-2">
                <label className="font-bold text-slate-700">Original Allocation *</label>
                <select
                  value={columnMap.allocation}
                  onChange={e => setColumnMap({ ...columnMap, allocation: e.target.value })}
                  className="bg-slate-50 border border-slate-200 p-2 rounded-xl font-medium outline-none text-xs"
                >
                  <option value="">Select column...</option>
                  {uploadedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 items-center gap-2">
                <label className="font-bold text-slate-700">Previously Taken (Optional)</label>
                <select
                  value={columnMap.taken}
                  onChange={e => setColumnMap({ ...columnMap, taken: e.target.value })}
                  className="bg-slate-50 border border-slate-200 p-2 rounded-xl font-medium outline-none text-xs"
                >
                  <option value="">(Default to 0)</option>
                  {uploadedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 items-center gap-2">
                <label className="font-bold text-slate-700">Sub-District (Optional)</label>
                <select
                  value={columnMap.subDistrict}
                  onChange={e => setColumnMap({ ...columnMap, subDistrict: e.target.value })}
                  className="bg-slate-50 border border-slate-200 p-2 rounded-xl font-medium outline-none text-xs"
                >
                  <option value="">(Auto-assign or None)</option>
                  {uploadedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 items-center gap-2">
                <label className="font-bold text-slate-700">District (Optional)</label>
                <select
                  value={columnMap.district}
                  onChange={e => setColumnMap({ ...columnMap, district: e.target.value })}
                  className="bg-slate-50 border border-slate-200 p-2 rounded-xl font-medium outline-none text-xs"
                >
                  <option value="">(Auto-assign)</option>
                  {uploadedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 items-center gap-2">
                <label className="font-bold text-slate-700">Nest (Optional)</label>
                <select
                  value={columnMap.nest}
                  onChange={e => setColumnMap({ ...columnMap, nest: e.target.value })}
                  className="bg-slate-50 border border-slate-200 p-2 rounded-xl font-medium outline-none text-xs"
                >
                  <option value="">(Auto-assign)</option>
                  {uploadedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowColumnMapper(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyImport}
                disabled={importing}
                className="bg-[#5C2D91] hover:bg-[#482372] text-white text-xs font-bold px-4 py-2 rounded-xl shadow cursor-pointer flex items-center gap-1.5"
              >
                {importing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Import Allocations
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* FACILITIES ALLOCATION INVENTORY TABLE                                    */}
      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        {/* Table Controls */}
        <div className="p-5 border-b border-slate-100 flex flex-col gap-4 bg-slate-50/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#5C2D91]" />
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-wide">
                  Facility Vaccine Allocation Ledger ({filtered.length} {filtered.length === 1 ? 'Facility' : 'Facilities'})
                </h4>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Displays authorized facilities and their specific vaccine allocations across districts and sub-districts
              </p>
            </div>

            {/* Layout view switcher */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setTrackerLayout('matrix')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    trackerLayout === 'matrix'
                      ? 'bg-[#5C2D91] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Master Matrix spreadsheet view"
                >
                  <Table className="w-3.5 h-3.5" />
                  Matrix View
                </button>
                <button
                  type="button"
                  onClick={() => setTrackerLayout('cards')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    trackerLayout === 'cards'
                      ? 'bg-[#5C2D91] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Detailed facility cards view"
                >
                  <List className="w-3.5 h-3.5" />
                  Detail Cards
                </button>
              </div>

              {facilities.length === 0 && (
                <button
                  type="button"
                  onClick={handleResetDemo}
                  disabled={loading}
                  className="text-xs font-bold text-[#5C2D91] bg-purple-50 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Load Baseline
                </button>
              )}
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/50">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search facility, sub-district, vaccine..."
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:border-[#5C2D91] w-56"
              />
            </div>

            {/* Nest Filter */}
            <select
              value={nestFilter}
              onChange={e => setNestFilter(e.target.value)}
              className="bg-white border border-slate-200 text-xs px-2.5 py-1.5 rounded-xl font-medium outline-none text-slate-700 cursor-pointer"
            >
              <option value="all">All Nests</option>
              {nests.map(n => <option key={n} value={n}>{n}</option>)}
            </select>

            {/* District Filter */}
            <select
              value={districtFilter}
              onChange={e => {
                setDistrictFilter(e.target.value);
                setSubDistrictFilter('all');
              }}
              className="bg-white border border-slate-200 text-xs px-2.5 py-1.5 rounded-xl font-medium outline-none text-slate-700 cursor-pointer"
            >
              <option value="all">All Districts</option>
              {districts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Sub-District Filter (Separated from District) */}
            <select
              value={subDistrictFilter}
              onChange={e => setSubDistrictFilter(e.target.value)}
              className="bg-white border border-slate-200 text-xs px-2.5 py-1.5 rounded-xl font-medium outline-none text-slate-700 cursor-pointer"
            >
              <option value="all">All Sub-Districts</option>
              {subDistricts.map(sd => <option key={sd} value={sd}>{sd}</option>)}
            </select>

            {/* Specific Vaccine / Antigen Filter */}
            <select
              value={vaccineFilter}
              onChange={e => setVaccineFilter(e.target.value)}
              className="bg-white border border-slate-200 text-xs px-2.5 py-1.5 rounded-xl font-medium outline-none text-slate-700 cursor-pointer"
            >
              <option value="all">All Antigens ({allAllocatedVaccines.length})</option>
              {allAllocatedVaccines.map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>

            {(search || districtFilter !== 'all' || subDistrictFilter !== 'all' || nestFilter !== 'all' || vaccineFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setDistrictFilter('all');
                  setSubDistrictFilter('all');
                  setNestFilter('all');
                  setVaccineFilter('all');
                }}
                className="text-[11px] font-bold text-[#5C2D91] hover:underline px-2 py-1 cursor-pointer"
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Allocated Antigens Summary Ribbon */}
          {facilities.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-2xs space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    Allocated Vaccines & Quotas:
                  </span>
                  <span className="text-[10px] bg-purple-100 text-[#5C2D91] font-bold px-2 py-0.5 rounded-full">
                    {allAllocatedVaccines.length} Antigens Authorised
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-3">
                  <span>
                    Total Allocated: <strong className="text-slate-900">{totalCohortAllocated.toLocaleString()}</strong> doses
                  </span>
                  &bull;
                  <span>
                    Taken: <strong className="text-amber-700">{totalCohortTaken.toLocaleString()}</strong>
                  </span>
                  &bull;
                  <span>
                    Available: <strong className="text-emerald-700">{totalCohortRemaining.toLocaleString()}</strong>
                  </span>
                </div>
              </div>

              {/* Vaccine Chips Filter Bar */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
                <button
                  type="button"
                  onClick={() => setVaccineFilter('all')}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                    vaccineFilter === 'all'
                      ? 'bg-[#5C2D91] text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All ({facilities.length} Facilities)
                </button>
                {allAllocatedVaccines.map(vName => {
                  const stat = vaccineCohortStats[vName];
                  const isSelected = vaccineFilter === vName;
                  return (
                    <button
                      key={vName}
                      type="button"
                      onClick={() => setVaccineFilter(isSelected ? 'all' : vName)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 border ${
                        isSelected
                          ? 'bg-[#5C2D91] text-white border-[#5C2D91] shadow-2xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100'
                      }`}
                    >
                      <span>{vName}</span>
                      {stat && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-purple-100 text-[#5C2D91]'
                          }`}
                        >
                          {stat.totalAlloc.toLocaleString()} doses ({stat.facilityCount} fac)
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Facilities List or Master Matrix */}
        <div>
          {facilities.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center max-w-md mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-purple-50 text-[#5C2D91] flex items-center justify-center mb-3 shadow-2xs">
                <FileSpreadsheet className="w-7 h-7" />
              </div>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider mb-2">
                Workspace Ready For New Cycle
              </span>
              <h4 className="text-sm font-black text-slate-900 mb-1">
                No Active Allocations Loaded
              </h4>
              <p className="text-xs text-slate-500 mb-5 leading-relaxed">
                Previous allocations have been cleared. The system is prepared for live operational use. Upload your official DCO vaccine allocation spreadsheet (.xlsx or .csv) above or load baseline allocations to initialize facility quotas.
              </p>
              <div className="flex items-center gap-2.5 flex-wrap justify-center">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-[#5C2D91] hover:bg-[#482372] text-white text-xs font-bold px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload New Allocation Sheet
                </button>
                <button
                  type="button"
                  onClick={handleResetDemo}
                  disabled={loading}
                  className="bg-purple-50 hover:bg-purple-100 text-[#5C2D91] text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-purple-200"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Load Baseline Allocations
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSampleExcel}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-slate-200"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  Sample .xlsx
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No facilities found matching current filters.
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setDistrictFilter('all');
                    setSubDistrictFilter('all');
                    setNestFilter('all');
                    setVaccineFilter('all');
                  }}
                  className="text-[#5C2D91] font-bold underline"
                >
                  Reset filters
                </button>
              </div>
            </div>
          ) : trackerLayout === 'matrix' ? (
            /* ========================================================================= */
            /* MASTER SPREADSHEET MATRIX VIEW                                           */
            /* ========================================================================= */
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">Facility & Operational Level</th>
                    <th className="py-3 px-3">District</th>
                    <th className="py-3 px-3">Sub-District</th>
                    <th className="py-3 px-4">Allocated Vaccines & Quotas</th>
                    <th className="py-3 px-3 text-right">Total Alloc</th>
                    <th className="py-3 px-3 text-right">Taken</th>
                    <th className="py-3 px-3 text-right">Remaining</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filtered.map(facility => {
                    const totalAlloc = (Object.values(facility.vaccines) as VaccineAllocationItem[]).reduce(
                      (sum, v) => sum + v.original + (v.adjustment || 0),
                      0
                    );
                    const totalTaken = (Object.values(facility.vaccines) as VaccineAllocationItem[]).reduce(
                      (sum, v) => sum + v.taken,
                      0
                    );
                    const totalRem = (Object.values(facility.vaccines) as VaccineAllocationItem[]).reduce(
                      (sum, v) => sum + v.remaining,
                      0
                    );

                    return (
                      <tr key={facility.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Facility & Info */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 text-sm">{facility.facilityName}</div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                            <span className="bg-purple-100 text-[#5C2D91] font-bold px-1.5 py-0.2 rounded">
                              {facility.nest}
                            </span>
                            &bull;
                            <span>{facility.cycle}</span>
                          </div>
                        </td>

                        {/* District */}
                        <td className="py-3.5 px-3">
                          <span className="font-bold text-slate-800">{facility.district || 'General District'}</span>
                        </td>

                        {/* Sub-District */}
                        <td className="py-3.5 px-3">
                          <span className="text-[11px] bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full border border-indigo-200/80 inline-block whitespace-nowrap">
                            {facility.subDistrict || 'General'}
                          </span>
                        </td>

                        {/* Allocated Vaccines Ribbon per Facility */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1.5 max-w-xl">
                            {(Object.entries(facility.vaccines) as [string, VaccineAllocationItem][]).map(([vName, vItem]) => {
                              const allocAmount = vItem.original + (vItem.adjustment || 0);
                              const isExhausted = vItem.remaining <= 0;
                              const isLow = vItem.remaining > 0 && (vItem.remaining <= 5 || vItem.remaining / allocAmount <= 0.2);

                              return (
                                <span
                                  key={vName}
                                  className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-all ${
                                    isExhausted
                                      ? 'bg-rose-50 border-rose-200 text-rose-800'
                                      : isLow
                                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                                      : 'bg-purple-50/80 border-purple-200/80 text-purple-950'
                                  }`}
                                  title={`${vName}: Original ${vItem.original}, Adj ${vItem.adjustment || 0}, Taken ${vItem.taken}, Remaining ${vItem.remaining}`}
                                >
                                  <span className="font-medium text-slate-600">{vName}:</span>
                                  <strong className="text-slate-900 font-black">{allocAmount}</strong>
                                  <span className={`text-[9px] font-bold ${isExhausted ? 'text-rose-600' : 'text-emerald-700'}`}>
                                    ({vItem.remaining} rem)
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        </td>

                        {/* Total Alloc */}
                        <td className="py-3.5 px-3 text-right font-black text-slate-900">
                          {totalAlloc.toLocaleString()}
                        </td>

                        {/* Taken */}
                        <td className="py-3.5 px-3 text-right font-bold text-amber-700">
                          {totalTaken.toLocaleString()}
                        </td>

                        {/* Remaining */}
                        <td className="py-3.5 px-3 text-right font-black text-emerald-700">
                          {totalRem.toLocaleString()}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedFacilityForAdjust(facility);
                                setAdjustVaccine(Object.keys(facility.vaccines)[0] || 'BCG');
                                setShowAdjustModal(true);
                              }}
                              className="text-[11px] font-bold text-[#5C2D91] bg-purple-50 hover:bg-purple-100 px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 border border-purple-200/60"
                              title="Perform DCO quota adjustment"
                            >
                              <Plus className="w-3 h-3" />
                              Adjust
                            </button>

                            {onFacilitySelectedForOrder && (
                              <button
                                type="button"
                                onClick={() => onFacilitySelectedForOrder(facility.id)}
                                className="text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 border border-emerald-200/60"
                                title="Check order against facility allocation"
                              >
                                Order &rarr;
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* ========================================================================= */
            /* DETAILED FACILITY CARDS VIEW                                             */
            /* ========================================================================= */
            <div className="divide-y divide-slate-100">
              {filtered.map(facility => {
                const hasAnyCarryOver = (Object.values(facility.vaccines) as VaccineAllocationItem[]).some(
                  v => v.carryOver && v.carryOver > 0
                );
                const totalAlloc = (Object.values(facility.vaccines) as VaccineAllocationItem[]).reduce(
                  (sum, v) => sum + v.original + (v.adjustment || 0),
                  0
                );
                const totalTaken = (Object.values(facility.vaccines) as VaccineAllocationItem[]).reduce(
                  (sum, v) => sum + v.taken,
                  0
                );
                const totalRem = (Object.values(facility.vaccines) as VaccineAllocationItem[]).reduce(
                  (sum, v) => sum + v.remaining,
                  0
                );

                return (
                  <div key={facility.id} className="p-5 hover:bg-slate-50/40 transition-colors">
                    {/* Facility Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h5 className="text-base font-bold text-slate-900">{facility.facilityName}</h5>
                          {facility.subDistrict && (
                            <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                              Sub-District: {facility.subDistrict}
                            </span>
                          )}
                          <span className="text-[10px] bg-purple-100 text-[#5C2D91] font-bold px-2 py-0.5 rounded-full">
                            {facility.cycle}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {facility.nest} &bull; District: <strong className="text-slate-700">{facility.district}</strong> &bull; Updated by: {facility.updatedBy || 'DCO Depot'}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Quota adjustment button (Section 15) */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFacilityForAdjust(facility);
                            setAdjustVaccine(Object.keys(facility.vaccines)[0] || 'BCG');
                            setShowAdjustModal(true);
                          }}
                          className="text-xs font-bold text-[#5C2D91] bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1 border border-purple-200/60"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          DCO Adjustment
                        </button>

                        {onFacilitySelectedForOrder && (
                          <button
                            type="button"
                            onClick={() => onFacilitySelectedForOrder(facility.id)}
                            className="text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1 border border-emerald-200/60"
                          >
                            Check Order &rarr;
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Prominent Allocated Vaccines Ribbon for this Facility */}
                    <div className="mb-3 bg-purple-50/50 border border-purple-100 rounded-xl p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#5C2D91]">
                          Allocated Antigens ({Object.keys(facility.vaccines).length}):
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {(Object.entries(facility.vaccines) as [string, VaccineAllocationItem][]).map(([vName, vItem]) => (
                            <span
                              key={vName}
                              className="text-[10px] bg-white border border-purple-200/80 px-2 py-0.5 rounded-md font-bold text-slate-800 shadow-2xs"
                            >
                              {vName}: <strong className="text-[#5C2D91]">{vItem.original + (vItem.adjustment || 0)}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-[11px] font-medium text-slate-500 whitespace-nowrap self-end sm:self-auto">
                        Total: <strong className="text-slate-900">{totalAlloc}</strong> doses &bull; Taken: <strong className="text-amber-700">{totalTaken}</strong> &bull; Rem: <strong className="text-emerald-700">{totalRem}</strong>
                      </div>
                    </div>

                    {/* Vaccines sub-table */}
                    <div className="overflow-x-auto bg-slate-50/70 border border-slate-200/70 rounded-2xl p-2.5">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="text-slate-400 font-semibold uppercase text-[10px] border-b border-slate-200/60">
                            <th className="py-1.5 px-2.5">Vaccine</th>
                            {hasAnyCarryOver && (
                              <th className="py-1.5 px-2.5 text-right text-slate-500">Carry-Over</th>
                            )}
                            <th className="py-1.5 px-2.5 text-right">Original Alloc</th>
                            <th className="py-1.5 px-2.5 text-right">Adjustment</th>
                            <th className="py-1.5 px-2.5 text-right">Previously Taken</th>
                            <th className="py-1.5 px-2.5 text-right font-bold text-slate-800">Remaining Balance</th>
                            <th className="py-1.5 px-2.5 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/40 font-medium">
                          {(Object.entries(facility.vaccines) as [string, VaccineAllocationItem][]).map(([vaccine, alloc]) => {
                            const isExhausted = alloc.remaining <= 0;
                            const totalAuth = alloc.original + (alloc.adjustment || 0);
                            const isLow = alloc.remaining > 0 && (alloc.remaining <= 5 || alloc.remaining / totalAuth <= 0.2);

                            return (
                              <tr key={vaccine}>
                                <td className="py-1.5 px-2.5 font-bold text-slate-800">{vaccine}</td>
                                {hasAnyCarryOver && (
                                  <td className="py-1.5 px-2.5 text-right text-slate-500">{alloc.carryOver || 0}</td>
                                )}
                                <td className="py-1.5 px-2.5 text-right text-slate-600">{alloc.original}</td>
                                <td className="py-1.5 px-2.5 text-right">
                                  {alloc.adjustment ? (
                                    <span className={alloc.adjustment > 0 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                      {alloc.adjustment > 0 ? `+${alloc.adjustment}` : alloc.adjustment}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">0</span>
                                  )}
                                </td>
                                <td className="py-1.5 px-2.5 text-right text-slate-600">{alloc.taken}</td>
                                <td className="py-1.5 px-2.5 text-right font-black">
                                  <span className={isExhausted ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-700'}>
                                    {alloc.remaining}
                                  </span>
                                </td>
                                <td className="py-1.5 px-2.5 text-center">
                                  {isExhausted ? (
                                    <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                                      Exhausted
                                    </span>
                                  ) : isLow ? (
                                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                                      Low ({alloc.remaining})
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                      Available
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 15: DCO QUOTA ADJUSTMENT MODAL                                   */}
      {/* ========================================================================= */}
      {showAdjustModal && selectedFacilityForAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-bold bg-purple-100 text-[#5C2D91] px-2 py-0.5 rounded-full uppercase">
                  Section 15 &bull; Audit Trail
                </span>
                <h4 className="text-sm font-black text-slate-900 mt-1">
                  Adjust Facility Vaccine Quota
                </h4>
                <p className="text-xs text-slate-500">
                  {selectedFacilityForAdjust.facilityName} ({selectedFacilityForAdjust.district})
                </p>
              </div>
              <button
                onClick={() => setShowAdjustModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {adjustError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>{adjustError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Select Vaccine / Antigen *</label>
                <select
                  value={adjustVaccine}
                  onChange={e => setAdjustVaccine(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl font-medium outline-none text-xs"
                >
                  {Object.keys(selectedFacilityForAdjust.vaccines).map(v => (
                    <option key={v} value={v}>{v} (Remaining: {selectedFacilityForAdjust.vaccines[v].remaining})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Adjustment Delta (Positive or Negative) *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={adjustQuantity}
                    onChange={e => setAdjustQuantity(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    placeholder="e.g. 20 (to add) or -10 (to decrease)"
                    className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl font-bold outline-none text-xs"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Immutable original baseline remains unchanged. Remaining balance updates immediately.
                </p>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Justification / Reason (Required for Audit Trail) *
                </label>
                <textarea
                  value={adjustReason}
                  onChange={e => setAdjustReason(e.target.value)}
                  placeholder="e.g. Campaign re-allocation approved by DCO; transfer from sub-depot..."
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl font-medium outline-none text-xs h-20 resize-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">DCO Officer / User</label>
                <input
                  type="text"
                  value={adjustOfficer}
                  onChange={e => setAdjustOfficer(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded-xl font-medium outline-none text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAdjustModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyAdjustment}
                disabled={adjusting}
                className="bg-[#5C2D91] hover:bg-[#482372] disabled:bg-slate-300 text-white text-xs font-bold px-4 py-2 rounded-xl shadow cursor-pointer flex items-center gap-1.5"
              >
                {adjusting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                Save Quota Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CLEAR PREVIOUS ALLOCATIONS CONFIRMATION MODAL                            */}
      {/* ========================================================================= */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900">
                  Clear Previous Allocations?
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Pave the way for a new allocation workbook and cycle.
                </p>
              </div>
            </div>

            <div className="bg-rose-50/80 border border-rose-200/80 rounded-2xl p-3.5 text-xs text-rose-900 space-y-2">
              <div className="font-bold flex items-center gap-1.5 text-rose-800">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                Prepares Workspace For Live Operational Use
              </div>
              <p className="text-[11px] text-rose-700/90 leading-relaxed">
                This will clear all {facilities.length} current facility quotas and allocations. You can immediately upload your new cycle's multi-tab DCO Excel workbook or single-tab spreadsheet.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer font-medium p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
                <input
                  type="checkbox"
                  checked={clearHistoryLogs}
                  onChange={e => setClearHistoryLogs(e.target.checked)}
                  className="rounded border-slate-300 text-[#5C2D91] focus:ring-[#5C2D91] w-4 h-4"
                />
                <span className="text-slate-800 font-semibold">
                  Also clear previous order transaction ledger &amp; quota adjustment history
                </span>
              </label>
              <p className="text-[11px] text-slate-400 px-1">
                Leave unchecked if you wish to retain previous audit trail logs for compliance reporting.
              </p>
            </div>

            {clearError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
                {clearError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                disabled={clearing}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAllocations}
                disabled={clearing}
                className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                {clearing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Yes, Clear All Allocations
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
