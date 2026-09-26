import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  Download,
  Upload,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpDown,
  FileCheck,
  Save,
  Grid,
  Sparkles,
  Columns,
  Layers,
  ChevronRight,
  ChevronLeft,
  Calendar,
  Info,
  MapPin,
  Pencil,
  Copy,
  Building2,
  Play,
  Check,
  RotateCcw,
  MessageSquare,
  MessageCircle,
  ChevronDown,
  X,
  Tag,
  ClipboardPaste,
  Eraser,
  History
} from 'lucide-react';
import { safeFetchJson } from '../utils/api';
import { UserRoleRecord } from '../types';
import { getBlueprintProgressStatus } from '../utils/blueprintProgress';

// Exact 16 default vaccines & products as specified by blueprint
export const DEFAULT_BLUEPRINT_PRODUCTS = [
  'BCG',
  'OPV',
  'MR',
  'PENTA',
  'YF',
  'ROTA',
  'IPV',
  'PCV',
  'MEN A',
  'HPV',
  'TD',
  'R21',
  'Soloshot 0.05ml',
  'Soloshot 0.5ml',
  'Syringe and needle 2ml',
  'Syringe and needle 5ml'
];

export interface VaccineSectionData {
  carryOver?: number | string;
  allocation?: number | string;
  distributed?: number | string;
  balance?: number | string;
  comment?: string;
}

export interface FacilityBlueprintRow {
  id: string;
  processing: string;
  completed: string;
  facility: string;
  subDistrict?: string;
  comment?: string;
  commentUpdatedAt?: string;
  vaccineComments?: {
    [vaccineKey: string]: string;
  };
  vaccines: {
    [vaccineKey: string]: VaccineSectionData;
  };
}

export interface DistrictSheetData {
  id: string;
  district: string;
  month: string;
  updatedAt?: string;
  products?: string[];
  rows: FacilityBlueprintRow[];
}

interface VaccineAllocationBlueprintProps {
  onFacilitySelectedForOrder?: (facilityId: string) => void;
  onNavigateToChecker?: () => void;
  onNavigateToAuditLog?: (moduleFilter?: string) => void;
  currentUser?: UserRoleRecord | null;
}

// Convert 0-indexed column number to Excel column letters (A, B, ... Z, AA, ... BO)
export function getExcelColumnLetter(colIndex: number): string {
  let temp = colIndex + 1;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

// Facility status is derived from allocation, carry-over, and distributed quantities.
export function isFacilityCompleted(
  row: FacilityBlueprintRow,
  productList: string[] = DEFAULT_BLUEPRINT_PRODUCTS
): boolean {
  return getBlueprintProgressStatus(row, productList) === 'completed';
}

export function isFacilityInProgress(
  row: FacilityBlueprintRow,
  productList: string[] = DEFAULT_BLUEPRINT_PRODUCTS
): boolean {
  return getBlueprintProgressStatus(row, productList) === 'in_progress';
}

export function isFacilityPending(
  row: FacilityBlueprintRow,
  productList: string[] = DEFAULT_BLUEPRINT_PRODUCTS
): boolean {
  return getBlueprintProgressStatus(row, productList) === 'pending';
}

function normalizeFacilityProgress(
  row: FacilityBlueprintRow,
  productList: string[],
  today: string
): FacilityBlueprintRow {
  const status = getBlueprintProgressStatus(row, productList);
  const currentProcessing = (row.processing || '').trim();
  const hasProcessingDate = currentProcessing.length > 0 &&
    !currentProcessing.toLowerCase().includes('pending') &&
    !currentProcessing.toLowerCase().includes('completed');

  return {
    ...row,
    processing: status === 'pending' ? '' : (hasProcessingDate ? currentProcessing : today),
    completed: status === 'completed' ? (row.completed || today) : ''
  };
}

function normalizeBlueprintRowsProgress(
  rows: FacilityBlueprintRow[],
  productList: string[],
  today = new Date().toISOString().slice(0, 10)
): FacilityBlueprintRow[] {
  return rows.map(row => normalizeFacilityProgress(row, productList, today));
}

export default function VaccineAllocationBlueprint({
  onFacilitySelectedForOrder,
  onNavigateToChecker,
  onNavigateToAuditLog,
  currentUser
}: VaccineAllocationBlueprintProps) {
  // Pending cell edits tracker for live audit accountability
  const pendingEditsRef = useRef<Array<any>>([]);

  // District & Reporting Month
  const [district, setDistrict] = useState<string>('West Mamprusi');
  const [month, setMonth] = useState<string>('September 2026');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [customTitle, setCustomTitle] = useState('');

  // Products array (supports adding/removing columns while retaining the 16 core by default)
  const [products, setProducts] = useState<string[]>([...DEFAULT_BLUEPRINT_PRODUCTS]);

  // Rows state
  const [rows, setRows] = useState<FacilityBlueprintRow[]>([]);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // Active cell editing state for seamless Excel / Google Sheets like experience
  const [activeCell, setActiveCell] = useState<{ rowId: string; colKey: string } | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ rowId: string; colIdx: number } | null>(null);

  // UI / Filter / Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'in_progress' | 'pending' | 'discrepancy'>('all');
  const [sortField, setSortField] = useState<'default' | 'facility' | 'processing'>('default');
  const [sortAsc, setSortAsc] = useState(true);

  // Multi-District State
  const [districts, setDistricts] = useState<DistrictSheetData[]>([]);
  const [activeDistrictId, setActiveDistrictId] = useState<string>('west_mamprusi');
  const [showAddDistrictModal, setShowAddDistrictModal] = useState(false);
  const [newDistrictName, setNewDistrictName] = useState('');
  const [newDistrictMonth, setNewDistrictMonth] = useState('September 2026');
  const [newDistrictTemplate, setNewDistrictTemplate] = useState<'sample' | 'blank'>('sample');
  const [showRenameDistrictModal, setShowRenameDistrictModal] = useState(false);
  const [renameDistrictValue, setRenameDistrictValue] = useState('');

  // Months Selection & Management State
  const [showAddMonthModal, setShowAddMonthModal] = useState(false);
  const [newMonthName, setNewMonthName] = useState('');
  const [monthScope, setMonthScope] = useState<'current' | 'all'>('current');
  const [carryOverEndingBalances, setCarryOverEndingBalances] = useState(true);
  const [copyFacilitiesForNewMonth, setCopyFacilitiesForNewMonth] = useState(true);
  const [showRenameMonthModal, setShowRenameMonthModal] = useState(false);
  const [renameMonthValue, setRenameMonthValue] = useState('');

  // Modals / Dialogs
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [showClearModal, setShowClearModal] = useState(false);
  const [showClearColumnModal, setShowClearColumnModal] = useState(false);
  const [selectedClearVaccine, setSelectedClearVaccine] = useState<string>('BCG');
  const [selectedClearSubCol, setSelectedClearSubCol] = useState<'all' | 'carryOver' | 'allocation' | 'distributed'>('all');
  const [selectedClearTargetType, setSelectedClearTargetType] = useState<'vaccine' | 'base' | 'bulk'>('vaccine');
  const [selectedClearBaseCol, setSelectedClearBaseCol] = useState<'facility' | 'processing' | 'completed'>('facility');
  const [selectedClearBulkCol, setSelectedClearBulkCol] = useState<'all_distributed' | 'all_allocation' | 'all_carry'>('all_distributed');
  const [isClearing, setIsClearing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Paste from Excel State
  const [showPasteExcelModal, setShowPasteExcelModal] = useState(false);
  const [pastedExcelText, setPastedExcelText] = useState('');
  const [pasteAlignmentMode, setPasteAlignmentMode] = useState<'auto' | 'from_start' | 'from_facility' | 'alloc_only'>('auto');
  const [pasteDestination, setPasteDestination] = useState<'replace' | 'append'>('replace');
  const [pasteSkipHeader, setPasteSkipHeader] = useState(false);

  // Dedicated Comment Section Drawer & Modal State
  const [showCommentsDrawer, setShowCommentsDrawer] = useState(false);
  const [commentsFilter, setCommentsFilter] = useState<'all' | 'facility' | 'vaccine'>('all');
  const [commentsSearch, setCommentsSearch] = useState('');
  const [showEditCommentModal, setShowEditCommentModal] = useState(false);
  const [commentModalData, setCommentModalData] = useState<{
    rowId: string;
    facilityName: string;
    targetType: 'facility' | string;
    text: string;
  } | null>(null);

  // Active hover tooltip for displaying comments on cell hover
  const [hoveredCommentInfo, setHoveredCommentInfo] = useState<{
    title: string;
    facility: string;
    vaccineName?: string;
    targetType: 'facility' | string;
    comment: string;
    stats?: string;
    x: number;
    y: number;
    rowId: string;
  } | null>(null);
  const commentHoverTimeoutRef = useRef<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to suggest consecutive month based on current month string (e.g. "September 2026" -> "October 2026")
  const getSuggestedNextMonth = (currMonth: string) => {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const parts = (currMonth || '').trim().split(/\s+/);
    if (parts.length >= 2) {
      const monthPart = parts[0];
      const yearPart = parseInt(parts[1], 10);
      const idx = monthNames.findIndex(m => m.toLowerCase().startsWith(monthPart.toLowerCase().slice(0, 3)));
      if (idx !== -1 && !isNaN(yearPart)) {
        if (idx === 11) {
          return `${monthNames[0]} ${yearPart + 1}`;
        }
        return `${monthNames[idx + 1]} ${yearPart}`;
      }
    }
    return 'October 2026';
  };

  // Distinct district names across all sheets
  const uniqueDistrictNames = useMemo(() => {
    const map = new Map<string, string>();
    districts.forEach(d => {
      const name = (d.district || '').trim();
      if (name && !map.has(name.toLowerCase())) {
        map.set(name.toLowerCase(), name);
      }
    });
    return Array.from(map.values());
  }, [districts]);

  // Sheets available for the currently selected district
  const sheetsForCurrentDistrict = useMemo(() => {
    return districts.filter(
      d => (d.district || '').trim().toLowerCase() === district.trim().toLowerCase()
    );
  }, [districts, district]);

  // Current active month index within this district's sheets
  const currentMonthIndex = useMemo(() => {
    return sheetsForCurrentDistrict.findIndex(d => d.id === activeDistrictId);
  }, [sheetsForCurrentDistrict, activeDistrictId]);

  // All comments across the active sheet (facility level and specific vaccine allocations)
  const allComments = useMemo(() => {
    const list: Array<{
      id: string;
      rowId: string;
      facility: string;
      subDistrict?: string;
      targetType: 'facility' | string;
      targetLabel: string;
      comment: string;
      updatedAt?: string;
    }> = [];

    rows.forEach(r => {
      const facName = r.facility?.trim() || 'Unnamed Facility';

      // Facility level comment
      if (r.comment && r.comment.trim()) {
        list.push({
          id: `${r.id}_facility`,
          rowId: r.id,
          facility: facName,
          subDistrict: r.subDistrict,
          targetType: 'facility',
          targetLabel: 'Facility Logistics Note',
          comment: r.comment.trim(),
          updatedAt: r.commentUpdatedAt
        });
      }

      // Vaccine specific allocation comments
      if (r.vaccineComments) {
        Object.entries(r.vaccineComments).forEach(([vKey, cVal]) => {
          if (typeof cVal === 'string' && cVal.trim()) {
            list.push({
              id: `${r.id}_${vKey}`,
              rowId: r.id,
              facility: facName,
              subDistrict: r.subDistrict,
              targetType: vKey,
              targetLabel: `${vKey} Allocation Note`,
              comment: cVal.trim(),
              updatedAt: r.commentUpdatedAt
            });
          }
        });
      }

      // Also check r.vaccines[pName]?.comment
      products.forEach(pName => {
        const vComment = r.vaccines?.[pName]?.comment;
        if (vComment && vComment.trim() && (!r.vaccineComments || !r.vaccineComments[pName])) {
          list.push({
            id: `${r.id}_${pName}_sub`,
            rowId: r.id,
            facility: facName,
            subDistrict: r.subDistrict,
            targetType: pName,
            targetLabel: `${pName} Allocation Note`,
            comment: vComment.trim(),
            updatedAt: r.commentUpdatedAt
          });
        }
      });
    });

    return list;
  }, [rows, products]);

  const handleOpenCommentEditor = (
    rowId: string,
    facilityName: string,
    targetType: 'facility' | string,
    initialText?: string
  ) => {
    setCommentModalData({
      rowId,
      facilityName: facilityName || 'Facility',
      targetType,
      text: initialText !== undefined ? initialText : ''
    });
    setShowEditCommentModal(true);
    setHoveredCommentInfo(null);
  };

  const handleSaveComment = (rowId: string, targetType: 'facility' | string, text: string) => {
    const trimmed = text.trim();
    const nowIso = new Date().toISOString();

    const updatedRows = rows.map(r => {
      if (r.id !== rowId) return r;
      const updated = { ...r };
      if (targetType === 'facility') {
        if (trimmed) {
          updated.comment = trimmed;
          updated.commentUpdatedAt = nowIso;
        } else {
          delete updated.comment;
        }
      } else {
        const vComments = { ...(updated.vaccineComments || {}) };
        if (trimmed) {
          vComments[targetType] = trimmed;
        } else {
          delete vComments[targetType];
        }
        updated.vaccineComments = vComments;

        if (updated.vaccines && updated.vaccines[targetType]) {
          updated.vaccines = {
            ...updated.vaccines,
            [targetType]: {
              ...updated.vaccines[targetType],
              comment: trimmed || undefined
            }
          };
        }
      }
      return updated;
    });

    setRows(updatedRows);
    saveBlueprintToServer(updatedRows, products, district, month);
    setShowEditCommentModal(false);
    setCommentModalData(null);
    setSyncStatus(trimmed ? `Saved comment for ${targetType === 'facility' ? 'facility' : targetType}!` : 'Comment removed');
    setTimeout(() => setSyncStatus(null), 3000);
  };

  const handleDeleteComment = (rowId: string, targetType: 'facility' | string) => {
    handleSaveComment(rowId, targetType, '');
  };

  const handleCellCommentMouseEnter = (
    e: React.MouseEvent,
    row: FacilityBlueprintRow,
    targetType: 'facility' | string
  ) => {
    if (commentHoverTimeoutRef.current) {
      clearTimeout(commentHoverTimeoutRef.current);
    }

    const facName = row.facility?.trim() || 'Unnamed Facility';
    let commentText = '';
    let stats: string | undefined = undefined;

    if (targetType === 'facility') {
      commentText = row.comment?.trim() || '';
    } else {
      commentText =
        row.vaccineComments?.[targetType]?.trim() ||
        row.vaccines?.[targetType]?.comment?.trim() ||
        '';
      const vData = row.vaccines?.[targetType];
      if (vData) {
        const alloc = vData.allocation !== undefined ? vData.allocation : 0;
        const dist = vData.distributed !== undefined ? vData.distributed : 0;
        const bal = vData.balance !== undefined ? vData.balance : 0;
        stats = `Allocated: ${alloc} • Distributed: ${dist} • Balance: ${bal}`;
      }
    }

    if (!commentText) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const tooltipWidth = 300;
    let x = rect.left + rect.width / 2 - tooltipWidth / 2;
    if (x < 12) x = 12;
    if (x + tooltipWidth > window.innerWidth - 12) {
      x = window.innerWidth - tooltipWidth - 12;
    }

    let y = rect.top - 12;
    if (rect.top < 150) {
      y = rect.bottom + 12;
    }

    setHoveredCommentInfo({
      title: targetType === 'facility' ? 'Facility Comment' : `${targetType} Allocation Comment`,
      facility: facName,
      vaccineName: targetType !== 'facility' ? targetType : undefined,
      targetType,
      comment: commentText,
      stats,
      x,
      y,
      rowId: row.id
    });
  };

  const handleCellCommentMouseLeave = () => {
    commentHoverTimeoutRef.current = setTimeout(() => {
      setHoveredCommentInfo(null);
    }, 250);
  };

  // Load blueprint sheet state from server on mount
  useEffect(() => {
    loadBlueprintFromServer();
  }, []);

  const loadBlueprintFromServer = async () => {
    setLoading(true);
    try {
      const data = await safeFetchJson<any>('/api/vaccine/blueprint-districts');
      if (data && Array.isArray(data.districts) && data.districts.length > 0) {
        setDistricts(data.districts);
        const activeId = data.activeDistrictId || data.districts[0].id;
        setActiveDistrictId(activeId);
        const activeSheet = data.districts.find((d: DistrictSheetData) => d.id === activeId) || data.districts[0];
        setDistrict(activeSheet.district || 'West Mamprusi');
        setMonth(activeSheet.month || 'September 2026');
        setProducts(activeSheet.products?.length ? activeSheet.products : [...DEFAULT_BLUEPRINT_PRODUCTS]);
        const sheetProducts = activeSheet.products?.length ? activeSheet.products : [...DEFAULT_BLUEPRINT_PRODUCTS];
        setRows(normalizeBlueprintRowsProgress(activeSheet.rows || [], sheetProducts));
        return;
      }
      initializeDefaultRows();
    } catch (err) {
      console.warn('Could not load blueprint from server, using local defaults:', err);
      initializeDefaultRows();
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchDistrict = (targetId: string) => {
    const target = districts.find(d => d.id === targetId);
    if (!target) return;
    setActiveDistrictId(targetId);
    setDistrict(target.district);
    setMonth(target.month);
    setProducts(target.products?.length ? target.products : [...DEFAULT_BLUEPRINT_PRODUCTS]);
    setRows(normalizeBlueprintRowsProgress(target.rows || [], target.products?.length ? target.products : [...DEFAULT_BLUEPRINT_PRODUCTS]));
    setSelectedRowIds(new Set());
    setActiveCell(null);

    safeFetchJson('/api/vaccine/blueprint-districts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeId: targetId })
    }).catch(err => console.warn('Active district selection save failed:', err));
  };

  const handleAddDistrict = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newDistrictName.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const data = await safeFetchJson<any>('/api/vaccine/blueprint-districts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          districtName: trimmed,
          month: newDistrictMonth.trim() || month || 'September 2026',
          template: newDistrictTemplate
        })
      });
      if (data && data.districts) {
        setDistricts(data.districts);
        setActiveDistrictId(data.activeDistrictId);
        const newlyCreated = data.district;
        setDistrict(newlyCreated.district);
        setMonth(newlyCreated.month);
        setProducts(newlyCreated.products || [...DEFAULT_BLUEPRINT_PRODUCTS]);
        setRows(newlyCreated.rows || []);
        setShowAddDistrictModal(false);
        setNewDistrictName('');
        setSyncStatus(`Created sheet for "${newlyCreated.district}" with 67 standard columns & synced to Vaccine Checker!`);
        setTimeout(() => setSyncStatus(null), 4000);
      }
    } catch (err) {
      console.error('Failed to add district:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRenameDistrict = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = renameDistrictValue.trim();
    if (!trimmed || !activeDistrictId) return;

    try {
      const data = await safeFetchJson<any>(`/api/vaccine/blueprint-districts/${activeDistrictId}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newDistrictName: trimmed })
      });
      if (data && data.districts) {
        setDistricts(data.districts);
        setDistrict(trimmed);
        setShowRenameDistrictModal(false);
        setSyncStatus(`Renamed district to "${trimmed}" & synced to Vaccine Checker!`);
        setTimeout(() => setSyncStatus(null), 3500);
      }
    } catch (err) {
      console.error('Failed to rename district:', err);
    }
  };

  const handleDeleteDistrict = async (distId: string) => {
    if (districts.length <= 1) {
      alert('At least one district sheet must remain.');
      return;
    }
    const target = districts.find(d => d.id === distId);
    const name = target?.district || 'this district';
    if (!confirm(`Are you sure you want to delete the sheet for "${name}"? All its facility quotas will be removed.`)) {
      return;
    }

    setLoading(true);
    try {
      const data = await safeFetchJson<any>(`/api/vaccine/blueprint-districts/${distId}`, {
        method: 'DELETE'
      });
      if (data && data.districts) {
        setDistricts(data.districts);
        const nextActiveId = data.activeDistrictId;
        setActiveDistrictId(nextActiveId);
        const nextActive = data.districts.find((d: any) => d.id === nextActiveId) || data.districts[0];
        if (nextActive) {
          setDistrict(nextActive.district);
          setMonth(nextActive.month);
          setProducts(nextActive.products || [...DEFAULT_BLUEPRINT_PRODUCTS]);
          setRows(normalizeBlueprintRowsProgress(nextActive.rows || [], nextActive.products?.length ? nextActive.products : [...DEFAULT_BLUEPRINT_PRODUCTS]));
        }
        setSyncStatus(`Deleted "${name}" and refreshed Vaccine Checker.`);
        setTimeout(() => setSyncStatus(null), 3500);
      }
    } catch (err) {
      console.error('Failed to delete district:', err);
    } finally {
      setLoading(false);
    }
  };

  // ADD A NEW ALLOCATION MONTH FOR A DISTRICT (OR ALL DISTRICTS)
  const handleAddMonth = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newMonthName.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const data = await safeFetchJson<any>('/api/vaccine/blueprint-months/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: trimmed,
          scope: monthScope,
          districtId: activeDistrictId,
          baseSheetId: activeDistrictId,
          carryOverBalances: carryOverEndingBalances,
          copyFacilities: copyFacilitiesForNewMonth
        })
      });

      if (data && data.districts) {
        setDistricts(data.districts);
        if (data.activeDistrictId) {
          setActiveDistrictId(data.activeDistrictId);
        }
        if (data.district) {
          setDistrict(data.district.district);
          setMonth(data.district.month);
          setProducts(data.district.products?.length ? data.district.products : [...DEFAULT_BLUEPRINT_PRODUCTS]);
          setRows(normalizeBlueprintRowsProgress(data.district.rows || [], data.district.products?.length ? data.district.products : [...DEFAULT_BLUEPRINT_PRODUCTS]));
        }
        setShowAddMonthModal(false);
        setNewMonthName('');
        setSyncStatus(data.message || `Created "${trimmed}" allocation sheet with stock rollover!`);
        setTimeout(() => setSyncStatus(null), 4500);
      }
    } catch (err) {
      console.error('Failed to add month:', err);
    } finally {
      setLoading(false);
    }
  };

  // RENAME CURRENT MONTH CYCLE
  const handleRenameMonth = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = renameMonthValue.trim();
    if (!trimmed || !activeDistrictId) return;

    setMonth(trimmed);
    await saveBlueprintToServer(rows, products, district, trimmed);
    setShowRenameMonthModal(false);
    setSyncStatus(`Renamed allocation cycle to "${trimmed}" & synced.`);
    setTimeout(() => setSyncStatus(null), 3500);
  };

  // DELETE AN UNWANTED MONTH SHEET FOR THIS DISTRICT
  const handleDeleteMonth = async (sheetId: string) => {
    if (sheetsForCurrentDistrict.length <= 1) {
      alert(`Cannot delete the only allocation month for "${district}".`);
      return;
    }
    const target = districts.find(d => d.id === sheetId);
    const mName = target?.month || month;
    if (!confirm(`Are you sure you want to delete the "${mName}" allocation sheet for "${district}"?`)) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/vaccine/blueprint-districts/${sheetId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const data = await res.json();
        setDistricts(data.districts);
        const remainingForDist = (data.districts || []).filter(
          (d: any) => (d.district || '').trim().toLowerCase() === district.trim().toLowerCase()
        );
        const nextActive = remainingForDist[0] || (data.districts || [])[0];
        if (nextActive) {
          setActiveDistrictId(nextActive.id);
          setDistrict(nextActive.district);
          setMonth(nextActive.month);
          setProducts(nextActive.products || [...DEFAULT_BLUEPRINT_PRODUCTS]);
          setRows(normalizeBlueprintRowsProgress(nextActive.rows || [], nextActive.products?.length ? nextActive.products : [...DEFAULT_BLUEPRINT_PRODUCTS]));
        }
        setSyncStatus(`Deleted "${mName}" sheet for "${district}".`);
        setTimeout(() => setSyncStatus(null), 3500);
      }
    } catch (err) {
      console.error('Failed to delete month sheet:', err);
    } finally {
      setLoading(false);
    }
  };

  // Clear Blueprint Data (active sheet or all districts)
  const handleClearBlueprintData = async (scope: 'current' | 'all') => {
    setIsClearing(true);
    try {
      const res = await fetch('/api/vaccine/blueprint-districts/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          districtId: activeDistrictId
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.districts)) {
          setDistricts(data.districts);
        }

        const blankRows: FacilityBlueprintRow[] = Array.from({ length: 5 }, (_, idx) => ({
          id: `bp_${activeDistrictId}_${idx + 1}`,
          processing: '',
          completed: '',
          facility: '',
          subDistrict: '',
          vaccines: {}
        }));

        if (scope === 'all') {
          setRows(blankRows);
          setSyncStatus('All allocation data across all blueprint districts cleared & synced!');
        } else {
          const updatedTarget = data.district || (data.districts && data.districts.find((d: any) => d.id === activeDistrictId));
          if (updatedTarget && Array.isArray(updatedTarget.rows)) {
            setRows(normalizeBlueprintRowsProgress(updatedTarget.rows, updatedTarget.products?.length ? updatedTarget.products : [...DEFAULT_BLUEPRINT_PRODUCTS]));
          } else {
            setRows(blankRows);
          }
          setSyncStatus(`Cleared all allocation data for "${district}" & synced!`);
        }

        setSelectedRowIds(new Set());
        setActiveCell(null);
        setShowClearModal(false);
        setTimeout(() => setSyncStatus(null), 4000);
      } else {
        alert('Failed to clear blueprint data. Please try again.');
      }
    } catch (err) {
      console.error('Error clearing blueprint data:', err);
      alert('Network error while clearing blueprint data.');
    } finally {
      setIsClearing(false);
    }
  };

  const initializeDefaultRows = () => {
    const initialRows: FacilityBlueprintRow[] = [
      {
        id: 'bp_1',
        processing: 'Completed',
        completed: '2026-09-02',
        facility: 'Walewale District Hospital',
        subDistrict: 'Walewale',
        comment: 'Main district referral hospital with functional walk-in cold room. Morning drone delivery preferred.',
        vaccineComments: {
          'BCG': 'Emergency top-up +20 vials approved by Regional EPI officer.',
          'R21': 'Phase 2 malaria immunization cohort enrolled.',
          'HPV': 'School outreach delivery scheduled for week 2.'
        },
        vaccines: {
          'BCG': { carryOver: 15, allocation: 100, distributed: 115, balance: 0 },
          'OPV': { carryOver: 20, allocation: 150, distributed: 170, balance: 0 },
          'MR': { carryOver: 10, allocation: 80, distributed: 90, balance: 0 },
          'PENTA': { carryOver: 15, allocation: 120, distributed: 135, balance: 0 },
          'YF': { carryOver: 10, allocation: 70, distributed: 80, balance: 0 },
          'ROTA': { carryOver: 15, allocation: 90, distributed: 105, balance: 0 },
          'IPV': { carryOver: 10, allocation: 60, distributed: 70, balance: 0 },
          'PCV': { carryOver: 12, allocation: 85, distributed: 97, balance: 0 },
          'MEN A': { carryOver: 8, allocation: 50, distributed: 58, balance: 0 },
          'HPV': { carryOver: 5, allocation: 40, distributed: 45, balance: 0 },
          'TD': { carryOver: 10, allocation: 60, distributed: 70, balance: 0 },
          'R21': { carryOver: 20, allocation: 150, distributed: 170, balance: 0 },
          'Soloshot 0.05ml': { carryOver: 50, allocation: 200, distributed: 250, balance: 0 },
          'Soloshot 0.5ml': { carryOver: 50, allocation: 250, distributed: 300, balance: 0 },
          'Syringe and needle 2ml': { carryOver: 40, allocation: 200, distributed: 240, balance: 0 },
          'Syringe and needle 5ml': { carryOver: 30, allocation: 150, distributed: 180, balance: 0 }
        }
      },
      {
        id: 'bp_2',
        processing: 'In Progress',
        completed: '',
        facility: 'Kparigu Health Centre',
        subDistrict: 'Kparigu',
        comment: 'Drone delivery drop-zone active. Refrigerator serviced last week.',
        vaccineComments: {
          'OPV': 'Routine monthly replenishment.',
          'PENTA': 'Cold box carrier verified before dispatch.'
        },
        vaccines: {
          'BCG': { carryOver: 5, allocation: 50, distributed: 15, balance: 40 },
          'OPV': { carryOver: 10, allocation: 75, distributed: 25, balance: 60 },
          'MR': { carryOver: 8, allocation: 40, distributed: 15, balance: 33 },
          'PENTA': { carryOver: 10, allocation: 60, distributed: 20, balance: 50 },
          'YF': { carryOver: 5, allocation: 35, distributed: 10, balance: 30 },
          'ROTA': { carryOver: 8, allocation: 45, distributed: 15, balance: 38 },
          'IPV': { carryOver: 5, allocation: 30, distributed: 10, balance: 25 },
          'PCV': { carryOver: 6, allocation: 40, distributed: 15, balance: 31 },
          'MEN A': { carryOver: 4, allocation: 25, distributed: 10, balance: 19 },
          'HPV': { carryOver: 3, allocation: 20, distributed: 5, balance: 18 },
          'TD': { carryOver: 5, allocation: 30, distributed: 10, balance: 25 },
          'R21': { carryOver: 10, allocation: 70, distributed: 25, balance: 55 },
          'Soloshot 0.05ml': { carryOver: 20, allocation: 100, distributed: 40, balance: 80 },
          'Soloshot 0.5ml': { carryOver: 25, allocation: 120, distributed: 45, balance: 100 },
          'Syringe and needle 2ml': { carryOver: 20, allocation: 100, distributed: 35, balance: 85 },
          'Syringe and needle 5ml': { carryOver: 15, allocation: 75, distributed: 25, balance: 65 }
        }
      },
      {
        id: 'bp_3',
        processing: 'Pending',
        completed: '',
        facility: 'Wulugu Health Centre',
        subDistrict: 'Wulugu',
        vaccines: {}
      },
      {
        id: 'bp_4',
        processing: '',
        completed: '',
        facility: 'Janga Polyclinic',
        subDistrict: 'Janga',
        vaccines: {}
      },
      {
        id: 'bp_5',
        processing: '',
        completed: '',
        facility: 'Nasia CHPS Compound',
        subDistrict: 'Nasia',
        vaccines: {}
      }
    ];

    // Add 5 blank entry rows exactly like the uploaded reference sheet
    for (let i = 6; i <= 12; i++) {
      initialRows.push({
        id: `bp_${i}`,
        processing: '',
        completed: '',
        facility: '',
        subDistrict: '',
        vaccines: {}
      });
    }

    setRows(initialRows);
  };

  const saveTimerRef = useRef<any>(null);

  // Auto-save changes to server and sync across all districts with debounce & safe handling
  const debouncedSaveBlueprint = (
    currentRows = rows,
    currentProducts = products,
    currentDistrict = district,
    currentMonth = month
  ) => {
    setSaveStatus('Saving edits...');
    const updatedSheet: DistrictSheetData = {
      id: activeDistrictId,
      district: currentDistrict,
      month: currentMonth,
      products: currentProducts,
      rows: currentRows,
      updatedAt: new Date().toISOString()
    };

    // Optimistically update local districts array
    setDistricts(prev => prev.map(d => (d.id === activeDistrictId ? updatedSheet : d)));

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      try {
        const editsToFlush = [...pendingEditsRef.current];
        pendingEditsRef.current = [];

        const data = await safeFetchJson<{ districts?: DistrictSheetData[] }>('/api/vaccine/blueprint-districts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            district: updatedSheet,
            activeId: activeDistrictId,
            user: currentUser,
            cellEdits: editsToFlush
          })
        });

        if (data && Array.isArray(data.districts)) {
          setDistricts(data.districts);
        }
        setSaveStatus('Saved & Synced');
        setTimeout(() => setSaveStatus(null), 2000);
      } catch (err: any) {
        console.warn('Blueprint auto-save warning:', err?.message || err);
        setSaveStatus('Saved locally');
        setTimeout(() => setSaveStatus(null), 2000);
      }
    }, 450);
  };

  const saveBlueprintToServer = debouncedSaveBlueprint;

  // Evaluate numeric input from spreadsheet cells, supporting direct numbers, expressions (e.g. 20+10, =15+5), and incremental additions (+10)
  const evaluateCellNumericInput = (raw: string, currentVal?: number | ''): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;

    // Incremental addition, e.g. "+10" adds 10 to current cell value
    if (trimmed.startsWith('+') && currentVal !== undefined && currentVal !== '') {
      const addend = Number(trimmed.slice(1).trim());
      if (!isNaN(addend)) {
        return (Number(currentVal) || 0) + addend;
      }
    }

    // Direct plain number, e.g. "25" or "=25"
    const cleaned = trimmed.replace(/^=/, '').trim();
    const directNum = Number(cleaned);
    if (!isNaN(directNum)) {
      return directNum;
    }

    // Safe arithmetic expression, e.g. "20+10", "15 + 5", "50 - 10"
    const expr = cleaned.replace(/\s+/g, '');
    if (/^[+-]?\d+(\.\d+)?([+-]\d+(\.\d+)?)+$/.test(expr)) {
      try {
        const tokens = expr.match(/[+-]?\d+(\.\d+)?/g);
        if (tokens) {
          const sum = tokens.reduce((acc, t) => acc + parseFloat(t), 0);
          return isNaN(sum) ? null : sum;
        }
      } catch {
        return null;
      }
    }

    return null;
  };

  // Calculate Balance: Balance = Carry-over + Allocation - Distributed
  // Keep blank cells blank if all 3 are empty
  const computeBalance = (carry: any, alloc: any, dist: any): number | '' => {
    const isCarryBlank = carry === '' || carry === null || carry === undefined;
    const isAllocBlank = alloc === '' || alloc === null || alloc === undefined;
    const isDistBlank = dist === '' || dist === null || dist === undefined;

    if (isCarryBlank && isAllocBlank && isDistBlank) {
      return '';
    }

    const cNum = Number(carry) || 0;
    const aNum = Number(alloc) || 0;
    const dNum = Number(dist) || 0;

    return cNum + aNum - dNum;
  };

  // Direct cell update handler
  const handleCellChange = (
    rowId: string,
    field: 'processing' | 'completed' | 'facility' | 'subDistrict' | { vaccine: string; subCol: 'carryOver' | 'allocation' | 'distributed' },
    value: string
  ) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    setRows(prevRows => {
      const updated = prevRows.map(r => {
        if (r.id !== rowId) return r;

        if (typeof field === 'string') {
          const oldVal = (r as any)[field] ?? '';
          if (oldVal !== value) {
            pendingEditsRef.current.push({
              facility: r.facility || value,
              field,
              oldValue: oldVal,
              newValue: value,
              district,
              month
            });
          }

          const updatedRow = { ...r, [field]: value };
          return normalizeFacilityProgress(updatedRow, products, todayStr);
        } else {
          const { vaccine, subCol } = field;
          const currentVaccineData = r.vaccines[vaccine] || {};
          
          let sanitizedValue: number | '' = '';
          if (value.trim() !== '') {
            const evaluated = evaluateCellNumericInput(value, currentVaccineData[subCol]);
            if (evaluated !== null) {
              sanitizedValue = evaluated;
            } else {
              // Ignore non-evaluable input for quantity fields
              return r;
            }
          }

          const oldVal = currentVaccineData[subCol] ?? '';
          if (oldVal !== sanitizedValue) {
            const diffNum = typeof sanitizedValue === 'number' && typeof oldVal === 'number'
              ? sanitizedValue - oldVal
              : undefined;
            pendingEditsRef.current.push({
              facility: r.facility || 'Facility Row',
              field: subCol,
              product: vaccine,
              oldValue: oldVal,
              newValue: sanitizedValue,
              diff: diffNum !== undefined ? (diffNum > 0 ? `+${diffNum}` : `${diffNum}`) : undefined,
              district,
              month
            });
          }

          const newVaccineData: VaccineSectionData = {
            ...currentVaccineData,
            [subCol]: sanitizedValue
          };

          // Recompute balance formula: Balance = Carry-over + Allocation - Distributed
          const carry = subCol === 'carryOver' ? sanitizedValue : currentVaccineData.carryOver;
          const alloc = subCol === 'allocation' ? sanitizedValue : currentVaccineData.allocation;
          const dist = subCol === 'distributed' ? sanitizedValue : currentVaccineData.distributed;

          newVaccineData.balance = computeBalance(carry, alloc, dist);

          const updatedRow: FacilityBlueprintRow = {
            ...r,
            vaccines: {
              ...r.vaccines,
              [vaccine]: newVaccineData
            }
          };

          return normalizeFacilityProgress(updatedRow, products, todayStr);
        }
      });

      // Trigger debounced server save
      saveBlueprintToServer(updated, products, district, month);
      return updated;
    });
  };

  // Helper: Parse Tab-Separated Values (TSV) directly from Excel / Sheets clipboard
  const parseTsv = (tsvText: string): string[][] => {
    const normalized = tsvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawLines = normalized.split('\n');
    while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') {
      rawLines.pop();
    }
    return rawLines.map(line =>
      line.split('\t').map(cell => cell.trim().replace(/^"|"$/g, ''))
    );
  };

  // Helper: In-line mapping of cell values into a Facility row starting at startColIdx
  // Supports direct Google Sheets clipboard copying with automatic column arrangement
  const applyValuesToRow = (
    targetRow: FacilityBlueprintRow,
    values: string[],
    startColIdx: number,
    productList: string[] = products
  ): FacilityBlueprintRow => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const updatedRow: FacilityBlueprintRow = {
      ...targetRow,
      vaccines: { ...targetRow.vaccines }
    };

    // Google Sheets Auto-Pattern Detection:
    // Pattern A: 1 facility column + 16 allocation columns (17 cols) pasted at Col C (idx 2) or Col A (idx 0)
    const isFacilityPlusAllocations =
      (startColIdx === 2 && values.length === 1 + productList.length) ||
      (startColIdx === 0 && values.length === 1 + productList.length);

    // Pattern B: 3 columns (Start, Completed, Facility) + 16 allocation columns (19 cols) pasted at Col A (idx 0)
    const isFullDatesPlusAllocations =
      startColIdx === 0 && values.length === 3 + productList.length;

    // Pattern C: 1 facility column + 3 subcols per vaccine (49 cols) pasted at Col C (idx 2)
    const isFacilityPlus3PerVaccine =
      startColIdx === 2 && values.length === 1 + productList.length * 3;

    // Pattern D: 3 columns + 3 subcols per vaccine (51 cols) pasted at Col A (idx 0)
    const isFullPlus3PerVaccine =
      startColIdx === 0 && values.length === 3 + productList.length * 3;

    if (isFacilityPlusAllocations) {
      const facName = values[0];
      if (facName) updatedRow.facility = facName;
      productList.forEach((pName, pIdx) => {
        const valStr = values[1 + pIdx]?.trim() || '';
        const numVal = valStr !== '' && !isNaN(Number(valStr)) ? Number(valStr) : '';
        const prev = updatedRow.vaccines[pName] || {};
        const vData: VaccineSectionData = {
          carryOver: prev.carryOver || '',
          allocation: numVal,
          distributed: prev.distributed || '',
          balance: computeBalance(prev.carryOver, numVal, prev.distributed)
        };
        updatedRow.vaccines[pName] = vData;
      });
    } else if (isFullDatesPlusAllocations) {
      if (values[0]) updatedRow.processing = values[0];
      if (values[1]) updatedRow.completed = values[1];
      if (values[2]) updatedRow.facility = values[2];
      productList.forEach((pName, pIdx) => {
        const valStr = values[3 + pIdx]?.trim() || '';
        const numVal = valStr !== '' && !isNaN(Number(valStr)) ? Number(valStr) : '';
        const prev = updatedRow.vaccines[pName] || {};
        const vData: VaccineSectionData = {
          carryOver: prev.carryOver || '',
          allocation: numVal,
          distributed: prev.distributed || '',
          balance: computeBalance(prev.carryOver, numVal, prev.distributed)
        };
        updatedRow.vaccines[pName] = vData;
      });
    } else if (isFacilityPlus3PerVaccine) {
      if (values[0]) updatedRow.facility = values[0];
      productList.forEach((pName, pIdx) => {
        const cStr = values[1 + pIdx * 3]?.trim() || '';
        const aStr = values[1 + pIdx * 3 + 1]?.trim() || '';
        const dStr = values[1 + pIdx * 3 + 2]?.trim() || '';
        const cNum = cStr !== '' && !isNaN(Number(cStr)) ? Number(cStr) : '';
        const aNum = aStr !== '' && !isNaN(Number(aStr)) ? Number(aStr) : '';
        const dNum = dStr !== '' && !isNaN(Number(dStr)) ? Number(dStr) : '';
        updatedRow.vaccines[pName] = {
          carryOver: cNum,
          allocation: aNum,
          distributed: dNum,
          balance: computeBalance(cNum, aNum, dNum)
        };
      });
    } else if (isFullPlus3PerVaccine) {
      if (values[0]) updatedRow.processing = values[0];
      if (values[1]) updatedRow.completed = values[1];
      if (values[2]) updatedRow.facility = values[2];
      productList.forEach((pName, pIdx) => {
        const cStr = values[3 + pIdx * 3]?.trim() || '';
        const aStr = values[3 + pIdx * 3 + 1]?.trim() || '';
        const dStr = values[3 + pIdx * 3 + 2]?.trim() || '';
        const cNum = cStr !== '' && !isNaN(Number(cStr)) ? Number(cStr) : '';
        const aNum = aStr !== '' && !isNaN(Number(aStr)) ? Number(aStr) : '';
        const dNum = dStr !== '' && !isNaN(Number(dStr)) ? Number(dStr) : '';
        updatedRow.vaccines[pName] = {
          carryOver: cNum,
          allocation: aNum,
          distributed: dNum,
          balance: computeBalance(cNum, aNum, dNum)
        };
      });
    } else {
      // General direct cell-by-cell mapping matching Google Sheets exact range behavior
      values.forEach((rawVal, offset) => {
        const colIdx = startColIdx + offset;
        const val = rawVal.trim();

        if (colIdx === 0) {
          updatedRow.processing = val;
        } else if (colIdx === 1) {
          updatedRow.completed = val;
        } else if (colIdx === 2) {
          updatedRow.facility = val;
        } else if (colIdx >= 3) {
          const vaccineColOffset = colIdx - 3;
          const pIdx = Math.floor(vaccineColOffset / 4);
          const subIdx = vaccineColOffset % 4;

          if (pIdx < productList.length) {
            const pName = productList[pIdx];
            const vData: VaccineSectionData = {
              carryOver: '',
              allocation: '',
              distributed: '',
              balance: '',
              ...(updatedRow.vaccines[pName] || {})
            };

            let numVal: number | '' = '';
            if (val !== '' && !isNaN(Number(val))) {
              numVal = Number(val);
            }

            if (subIdx === 0) {
              vData.carryOver = numVal;
            } else if (subIdx === 1) {
              vData.allocation = numVal;
            } else if (subIdx === 2) {
              vData.distributed = numVal;
            }
            // Formula Balance = Carry-over + Allocation - Distributed
            vData.balance = computeBalance(vData.carryOver, vData.allocation, vData.distributed);
            updatedRow.vaccines[pName] = vData;
          }
        }
      });
    }

    return normalizeFacilityProgress(updatedRow, productList, todayStr);
  };

  // In-line paste handler for table inputs: pastes Excel / Google Sheets blocks seamlessly across rows and columns
  const handleDirectCellPasteRaw = (pasteData: string, startRowId: string, colIdx: number) => {
    if (!pasteData || (!pasteData.includes('\t') && !pasteData.includes('\n'))) {
      return;
    }

    const tsvRows = parseTsv(pasteData);
    if (tsvRows.length === 0) return;

    // Detect and skip header row if user copied headers from Google Sheets
    const firstRowLower = tsvRows[0].map(c => c.toLowerCase());
    const looksLikeHeader =
      tsvRows.length > 1 &&
      (firstRowLower.includes('facility') ||
        firstRowLower.includes('start date') ||
        firstRowLower.includes('processing') ||
        firstRowLower.includes('bcg') ||
        firstRowLower.includes('opv') ||
        firstRowLower.includes('allocation'));

    const effectiveRows = looksLikeHeader ? tsvRows.slice(1) : tsvRows;
    if (effectiveRows.length === 0) return;

    setRows(prevRows => {
      const startRowIdx = prevRows.findIndex(r => r.id === startRowId);
      const effectiveStartIdx = startRowIdx !== -1 ? startRowIdx : 0;

      const newRows = [...prevRows];

      effectiveRows.forEach((rowVals, rOffset) => {
        const targetRowIdx = effectiveStartIdx + rOffset;
        if (targetRowIdx < newRows.length) {
          newRows[targetRowIdx] = applyValuesToRow(newRows[targetRowIdx], rowVals, colIdx, products);
        } else {
          // Dynamically append new rows if pasted Google Sheets block exceeds current rows
          const brandNewRow: FacilityBlueprintRow = {
            id: `bp_pasted_cell_${Date.now()}_${rOffset}`,
            processing: '',
            completed: '',
            facility: '',
            subDistrict: '',
            vaccines: {}
          };
          products.forEach(p => {
            brandNewRow.vaccines[p] = {
              carryOver: '',
              allocation: '',
              distributed: '',
              balance: ''
            };
          });
          newRows.push(applyValuesToRow(brandNewRow, rowVals, colIdx, products));
        }
      });

      saveBlueprintToServer(newRows, products, district, month);
      setSaveStatus(`Pasted ${effectiveRows.length} rows seamlessly (Google Sheets layout)`);
      setTimeout(() => setSaveStatus(null), 3000);
      return newRows;
    });
  };

  const handleDirectCellPaste = (e: React.ClipboardEvent, rowId: string, colIdx: number) => {
    const pasteData =
      e.clipboardData?.getData('text/plain') || e.clipboardData?.getData('text') || '';
    if (!pasteData || (!pasteData.includes('\t') && !pasteData.includes('\n'))) {
      // Normal single-value clipboard text, allow standard input typing
      return;
    }

    e.preventDefault();
    handleDirectCellPasteRaw(pasteData, rowId, colIdx);
  };

  // Comprehensive Excel Clipboard Data Parser for dedicated "Paste from Excel" drawer/modal
  const parseExcelClipboardData = (
    tsvText: string,
    targetProducts: string[] = products,
    forcedAlignment: 'auto' | 'from_start' | 'from_facility' | 'alloc_only' = 'auto',
    skipHeaderRow: boolean = false
  ) => {
    const rawRows = parseTsv(tsvText);
    if (rawRows.length === 0) {
      return {
        rows: [],
        detectedAlignment: 'None',
        detectedRowCount: 0,
        detectedColCount: 0,
        hasHeaders: false
      };
    }

    let dataRows = [...rawRows];

    // Detect if first row looks like an Excel header row
    const firstRowJoined = (dataRows[0] || []).join(' ').toLowerCase();
    const looksLikeHeader =
      firstRowJoined.includes('facility') ||
      firstRowJoined.includes('vaccine') ||
      firstRowJoined.includes('carry') ||
      firstRowJoined.includes('alloc') ||
      firstRowJoined.includes('start') ||
      firstRowJoined.includes('distribut') ||
      firstRowJoined.includes('bcg') ||
      firstRowJoined.includes('opv');

    if (skipHeaderRow || (looksLikeHeader && dataRows.length > 1 && forcedAlignment === 'auto')) {
      dataRows = dataRows.slice(1);
    }

    // Skip secondary subcolumn header row if present (Carry, Alloc, Dist, Bal)
    if (dataRows.length > 0) {
      const nextRowJoined = dataRows[0].join(' ').toLowerCase();
      if (
        nextRowJoined.includes('carry') &&
        nextRowJoined.includes('alloc') &&
        nextRowJoined.includes('dist')
      ) {
        dataRows = dataRows.slice(1);
      }
    }

    const maxCols = Math.max(...dataRows.map(r => r.length), 0);

    // Determine alignment mode
    let alignment = forcedAlignment;
    if (alignment === 'auto') {
      const col0Sample = (dataRows[0]?.[0] || '').toLowerCase().trim();
      const isCol0Date =
        /\d{4}-\d{2}-\d{2}/.test(col0Sample) ||
        /\d{1,2}\/\d{1,2}/.test(col0Sample) ||
        col0Sample.includes('202') ||
        col0Sample.includes('started') ||
        col0Sample.includes('in progress');

      if (isCol0Date || maxCols >= 60) {
        alignment = 'from_start';
      } else if (maxCols <= targetProducts.length + 2 && maxCols > 1) {
        alignment = 'alloc_only';
      } else {
        alignment = 'from_facility';
      }
    }

    const parsedRows: FacilityBlueprintRow[] = [];

    dataRows.forEach((rawCols, rIdx) => {
      if (rawCols.every(c => c.trim() === '')) return;

      let processing = '';
      let completed = '';
      let facility = '';
      let colOffset = 0;

      if (alignment === 'from_start') {
        processing = rawCols[0] || '';
        completed = rawCols[1] || '';
        facility = rawCols[2] || '';
        colOffset = 3;
      } else if (alignment === 'from_facility') {
        facility = rawCols[0] || '';
        colOffset = 1;
      } else if (alignment === 'alloc_only') {
        facility = rawCols[0] || '';
        colOffset = 1;
      }

      const vaccinesObj: Record<string, VaccineSectionData> = {};

      targetProducts.forEach((pName, pIdx) => {
        let cVal: number | '' = '';
        let aVal: number | '' = '';
        let dVal: number | '' = '';

        if (alignment === 'alloc_only') {
          const rawA = rawCols[colOffset + pIdx];
          if (rawA !== undefined && rawA !== '' && !isNaN(Number(rawA))) {
            aVal = Number(rawA);
          }
        } else {
          const subColCount =
            maxCols - colOffset < targetProducts.length * 4 &&
            maxCols - colOffset >= targetProducts.length * 3
              ? 3
              : 4;
          const base = colOffset + pIdx * subColCount;

          const rawC = rawCols[base];
          const rawA = rawCols[base + 1];
          const rawD = rawCols[base + 2];

          if (rawC !== undefined && rawC !== '' && !isNaN(Number(rawC))) cVal = Number(rawC);
          if (rawA !== undefined && rawA !== '' && !isNaN(Number(rawA))) aVal = Number(rawA);
          if (rawD !== undefined && rawD !== '' && !isNaN(Number(rawD))) dVal = Number(rawD);
        }

        const bVal = computeBalance(cVal, aVal, dVal);

        vaccinesObj[pName] = {
          carryOver: cVal,
          allocation: aVal,
          distributed: dVal,
          balance: bVal
        };
      });

      parsedRows.push({
        id: `bp_pasted_${rIdx}_${Date.now()}`,
        processing: processing.trim(),
        completed: completed.trim(),
        facility: facility.trim(),
        subDistrict: '',
        vaccines: vaccinesObj
      });
    });

    let detectedAlignmentDesc = 'Col A (Start, Completed, Facility, 16 Vaccines)';
    if (alignment === 'from_facility') {
      detectedAlignmentDesc = 'Col C (Facility Name + 16 Vaccines)';
    } else if (alignment === 'alloc_only') {
      detectedAlignmentDesc = 'Facility + Vaccine Allocations Only';
    }

    return {
      rows: parsedRows,
      detectedAlignment: detectedAlignmentDesc,
      detectedRowCount: parsedRows.length,
      detectedColCount: maxCols,
      hasHeaders: looksLikeHeader
    };
  };

  // Live parsed preview for Paste from Excel Modal
  const parsedPreview = useMemo(() => {
    if (!pastedExcelText.trim()) {
      return {
        rows: [] as FacilityBlueprintRow[],
        detectedAlignment: 'None',
        detectedRowCount: 0,
        detectedColCount: 0,
        hasHeaders: false
      };
    }
    return parseExcelClipboardData(
      pastedExcelText,
      products,
      pasteAlignmentMode,
      pasteSkipHeader
    );
  }, [pastedExcelText, products, pasteAlignmentMode, pasteSkipHeader]);

  // Apply parsed Excel data to the blueprint
  const handleApplyPastedExcelData = () => {
    if (parsedPreview.rows.length === 0) return;

    let updatedRows: FacilityBlueprintRow[];
    if (pasteDestination === 'replace') {
      updatedRows = normalizeBlueprintRowsProgress(parsedPreview.rows, products);
    } else {
      updatedRows = normalizeBlueprintRowsProgress([...rows, ...parsedPreview.rows], products);
    }

    setRows(updatedRows);
    saveBlueprintToServer(updatedRows, products, district, month);
    setSaveStatus(`Applied ${parsedPreview.rows.length} rows in-line from Excel`);
    setTimeout(() => setSaveStatus(null), 3000);
    setShowPasteExcelModal(false);
    setPastedExcelText('');
  };

  // Record completion only after every allocated vaccine has a zero balance.
  const handleCompleteFacility = async (rowId: string, customCompleteDate?: string) => {
    const todayStr = customCompleteDate || new Date().toISOString().slice(0, 10);
    const target = rows.find(r => r.id === rowId);
    if (!target || getBlueprintProgressStatus(target, products) !== 'completed') return;

    const updated = rows.map(r => r.id === rowId
      ? normalizeFacilityProgress({ ...r, completed: todayStr }, products, todayStr)
      : r
    );
    setRows(updated);
    saveBlueprintToServer(updated, products, district, month);

    try {
      await fetch('/api/vaccine/blueprint/complete-facility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityId: rowId,
          facilityName: target.facility,
          districtId: activeDistrictId,
          date: todayStr
        })
      });
    } catch (e) {
      console.warn('Backend complete-facility call:', e);
    }
  };

  // Reopen a completed facility back to in-progress
  const handleReopenFacility = (rowId: string) => {
    const updated = rows.map(r => {
      if (r.id !== rowId) return r;
      return normalizeFacilityProgress({
        ...r,
        completed: ''
      }, products, new Date().toISOString().slice(0, 10));
    });
    setRows(updated);
    saveBlueprintToServer(updated, products, district, month);
  };

  // Move an in-progress or completed facility back to start (clears distributed values, keeps allocations and start date)
  // "Also we should be able to move from In progress to start."
  const handleMoveToStart = (rowId: string) => {
    setRows(prevRows => {
      const updated = prevRows.map(r => {
        if (r.id !== rowId) return r;
        const updatedVaccines = { ...r.vaccines };
        products.forEach(p => {
          if (updatedVaccines[p]) {
            const c = updatedVaccines[p].carryOver;
            const a = updatedVaccines[p].allocation;
            updatedVaccines[p] = {
              ...updatedVaccines[p],
              distributed: '',
              balance: computeBalance(c, a, '')
            };
          }
        });
        return normalizeFacilityProgress({
          ...r,
          completed: '',
          processing: '',
          vaccines: updatedVaccines
        }, products, new Date().toISOString().slice(0, 10));
      });
      saveBlueprintToServer(updated, products, district, month);
      setSaveStatus('Moved facility to Start');
      setTimeout(() => setSaveStatus(null), 2500);
      return updated;
    });
  };

  // Clear a single row's contents
  // "And we should be able to clear a row and column."
  const handleClearRow = (rowId: string) => {
    setRows(prevRows => {
      const updated = prevRows.map(r => {
        if (r.id !== rowId) return r;
        const emptyVaccines: Record<string, VaccineSectionData> = {};
        products.forEach(p => {
          emptyVaccines[p] = {
            carryOver: '',
            allocation: '',
            distributed: '',
            balance: ''
          };
        });
        return {
          ...r,
          facility: '',
          processing: '',
          completed: '',
          subDistrict: '',
          comment: '',
          vaccineComments: {},
          vaccines: emptyVaccines
        };
      });
      saveBlueprintToServer(updated, products, district, month);
      setSaveStatus('Row cleared');
      setTimeout(() => setSaveStatus(null), 2500);
      return updated;
    });
  };

  // Clear all selected rows
  const handleClearSelectedRows = () => {
    if (selectedRowIds.size === 0) return;
    setRows(prevRows => {
      const updated = prevRows.map(r => {
        if (!selectedRowIds.has(r.id)) return r;
        const emptyVaccines: Record<string, VaccineSectionData> = {};
        products.forEach(p => {
          emptyVaccines[p] = {
            carryOver: '',
            allocation: '',
            distributed: '',
            balance: ''
          };
        });
        return {
          ...r,
          facility: '',
          processing: '',
          completed: '',
          subDistrict: '',
          comment: '',
          vaccineComments: {},
          vaccines: emptyVaccines
        };
      });
      saveBlueprintToServer(updated, products, district, month);
      setSaveStatus(`Cleared ${selectedRowIds.size} selected rows`);
      setTimeout(() => setSaveStatus(null), 2500);
      return updated;
    });
  };

  // Clear an entire column across all rows
  // "And we should be able to clear a row and column."
  const handleClearColumn = (
    columnType:
      | 'processing'
      | 'completed'
      | 'facility'
      | 'all_distributed'
      | 'all_allocation'
      | 'all_carry'
      | { vaccine: string; subCol?: 'all' | 'carryOver' | 'allocation' | 'distributed' }
  ) => {
    setRows(prevRows => {
      const updated = prevRows.map(r => {
        const newRow: FacilityBlueprintRow = {
          ...r,
          vaccines: { ...r.vaccines }
        };

        if (typeof columnType === 'string') {
          if (columnType === 'processing') {
            newRow.processing = '';
          } else if (columnType === 'completed') {
            newRow.completed = '';
          } else if (columnType === 'facility') {
            newRow.facility = '';
          } else if (columnType === 'all_distributed') {
            products.forEach(p => {
              if (newRow.vaccines[p]) {
                const c = newRow.vaccines[p].carryOver;
                const a = newRow.vaccines[p].allocation;
                newRow.vaccines[p] = {
                  ...newRow.vaccines[p],
                  distributed: '',
                  balance: computeBalance(c, a, '')
                };
              }
            });
            newRow.completed = '';
          } else if (columnType === 'all_allocation') {
            products.forEach(p => {
              if (newRow.vaccines[p]) {
                const c = newRow.vaccines[p].carryOver;
                const d = newRow.vaccines[p].distributed;
                newRow.vaccines[p] = {
                  ...newRow.vaccines[p],
                  allocation: '',
                  balance: computeBalance(c, '', d)
                };
              }
            });
          } else if (columnType === 'all_carry') {
            products.forEach(p => {
              if (newRow.vaccines[p]) {
                const a = newRow.vaccines[p].allocation;
                const d = newRow.vaccines[p].distributed;
                newRow.vaccines[p] = {
                  ...newRow.vaccines[p],
                  carryOver: '',
                  balance: computeBalance('', a, d)
                };
              }
            });
          }
        } else {
          const { vaccine, subCol } = columnType;
          if (newRow.vaccines[vaccine]) {
            const v = { ...newRow.vaccines[vaccine] };
            if (!subCol || subCol === 'all') {
              v.carryOver = '';
              v.allocation = '';
              v.distributed = '';
              v.balance = '';
            } else if (subCol === 'carryOver') {
              v.carryOver = '';
              v.balance = computeBalance('', v.allocation, v.distributed);
            } else if (subCol === 'allocation') {
              v.allocation = '';
              v.balance = computeBalance(v.carryOver, '', v.distributed);
            } else if (subCol === 'distributed') {
              v.distributed = '';
              v.balance = computeBalance(v.carryOver, v.allocation, '');
            }
            newRow.vaccines[vaccine] = v;
          }
        }

        // Keep dates in sync with the current vaccine balances.
        return normalizeFacilityProgress(newRow, products, new Date().toISOString().slice(0, 10));
      });

      saveBlueprintToServer(updated, products, district, month);
      setSaveStatus('Column cleared across all rows');
      setTimeout(() => setSaveStatus(null), 2500);
      return updated;
    });
  };

  // Seamless Google Sheets Copy-Paste Export
  // Copies blueprint table to clipboard as TSV so user can paste straight into Google Sheets
  const handleCopyTableToClipboard = (selectedOnly: boolean = false) => {
    const targetRows = selectedOnly && selectedRowIds.size > 0
      ? rows.filter(r => selectedRowIds.has(r.id))
      : rows;

    if (targetRows.length === 0) return;

    // Header row
    const headerCols = ['Start Date', 'Completed Date', 'Facility'];
    products.forEach(p => {
      headerCols.push(`${p} Carry-over`, `${p} Allocation`, `${p} Distributed`, `${p} Balance`);
    });

    const lines = [headerCols.join('\t')];

    targetRows.forEach(r => {
      const rowCols = [
        r.processing || '',
        r.completed || '',
        r.facility || ''
      ];
      products.forEach(p => {
        const v = r.vaccines[p] || {};
        rowCols.push(
          v.carryOver !== undefined ? String(v.carryOver) : '',
          v.allocation !== undefined ? String(v.allocation) : '',
          v.distributed !== undefined ? String(v.distributed) : '',
          v.balance !== undefined ? String(v.balance) : ''
        );
      });
      lines.push(rowCols.join('\t'));
    });

    const tsvText = lines.join('\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(tsvText).then(() => {
        setSaveStatus(`Copied ${targetRows.length} rows to clipboard! Ready to paste into Google Sheets.`);
        setTimeout(() => setSaveStatus(null), 3500);
      }).catch(() => {
        alert('Failed to copy to clipboard.');
      });
    }
  };

  // Selecting a facility for audit does not change progress; only distribution does.
  const handleSelectFacilityForOrder = (row: FacilityBlueprintRow) => {
    if (onFacilitySelectedForOrder) {
      onFacilitySelectedForOrder(row.id);
    }
  };

  // Add a new facility row
  const handleAddRow = () => {
    const newId = `bp_${Date.now()}`;
    const newRow: FacilityBlueprintRow = {
      id: newId,
      processing: 'Pending',
      completed: '',
      facility: '',
      subDistrict: '',
      vaccines: {}
    };
    const updated = [...rows, newRow];
    setRows(updated);
    saveBlueprintToServer(updated);
  };

  // Add 5 blank entry rows
  const handleAddMultipleBlankRows = (count = 5) => {
    const newRows: FacilityBlueprintRow[] = [];
    for (let i = 0; i < count; i++) {
      newRows.push({
        id: `bp_${Date.now()}_${i}`,
        processing: '',
        completed: '',
        facility: '',
        subDistrict: '',
        vaccines: {}
      });
    }
    const updated = [...rows, ...newRows];
    setRows(updated);
    saveBlueprintToServer(updated);
  };

  // Delete selected or specific row
  const handleDeleteRow = (rowId: string) => {
    const updated = rows.filter(r => r.id !== rowId);
    setRows(updated);
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
    saveBlueprintToServer(updated);
  };

  const handleDeleteSelectedRows = () => {
    if (selectedRowIds.size === 0) return;
    const updated = rows.filter(r => !selectedRowIds.has(r.id));
    setRows(updated);
    setSelectedRowIds(new Set());
    saveBlueprintToServer(updated);
  };

  // Add a new vaccine/product group (4 subcolumns: Carry-over, Allocation, Distributed, Balance)
  const handleAddProductGroup = () => {
    const trimmed = newColumnName.trim();
    if (!trimmed) return;
    if (products.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      alert(`Product "${trimmed}" already exists in the blueprint.`);
      return;
    }
    const updatedProducts = [...products, trimmed];
    setProducts(updatedProducts);
    setNewColumnName('');
    setShowAddColumnModal(false);
    saveBlueprintToServer(rows, updatedProducts);
  };

  // Delete a product group
  const handleDeleteProductGroup = (vaccineName: string) => {
    if (confirm(`Remove "${vaccineName}" and its 4 subcolumns (Carry-over, Allocation, Distributed, Balance) from the grid?`)) {
      const updatedProducts = products.filter(p => p !== vaccineName);
      setProducts(updatedProducts);
      saveBlueprintToServer(rows, updatedProducts);
    }
  };

  // Sync Blueprint to the Order Checker & Master Allocation Engine
  const handleSyncToOrderChecker = async () => {
    setLoading(true);
    setSyncStatus('Synchronizing all districts with Order Checker...');
    try {
      const res = await fetch('/api/vaccine/blueprint-districts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(`Synchronized ${data.districtsCount || districts.length} districts (${data.syncedRowsCount || 0} facilities) to Order Checker!`);
        setTimeout(() => setSyncStatus(null), 4000);
      } else {
        setSyncStatus('Sync encountered an error.');
      }
    } catch (err) {
      console.error('Error syncing blueprint:', err);
      setSyncStatus('Network error while syncing.');
    } finally {
      setLoading(false);
    }
  };

  // Export exact blueprint to Excel (.xlsx)
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Row 1: District & Month Title centered across vaccine columns
    // Row 2: Processing, Completed, Facility, VACCINES
    // Row 3: Grouped vaccine headers (BCG, OPV, ...)
    // Row 4: Carry-over, Allocation, Distributed, Balance
    const sheetData: any[][] = [];

    // ROW 1:
    const row1: any[] = ['', '', ''];
    row1.push(`${district} ${month}`);
    for (let i = 4; i < 3 + products.length * 4; i++) {
      row1.push('');
    }
    sheetData.push(row1);

    // ROW 2:
    const row2: any[] = ['Processing', 'Completed', 'Facility', '                                                               VACCINES'];
    for (let i = 4; i < 3 + products.length * 4; i++) {
      row2.push('');
    }
    sheetData.push(row2);

    // ROW 3:
    const row3: any[] = ['', '', ''];
    products.forEach(p => {
      row3.push(p);
      row3.push('');
      row3.push('');
      row3.push('');
    });
    sheetData.push(row3);

    // ROW 4:
    const row4: any[] = ['', '', ''];
    products.forEach(() => {
      row4.push('Carry-over');
      row4.push('Allocation');
      row4.push('Distributed');
      row4.push('Balance');
    });
    sheetData.push(row4);

    // DATA ROWS (Row 5+):
    rows.forEach(r => {
      const rowData: any[] = [
        r.processing || '',
        r.completed || '',
        r.facility || ''
      ];

      products.forEach(p => {
        const vData = r.vaccines[p] || {};
        rowData.push(vData.carryOver !== undefined && vData.carryOver !== '' ? vData.carryOver : '');
        rowData.push(vData.allocation !== undefined && vData.allocation !== '' ? vData.allocation : '');
        rowData.push(vData.distributed !== undefined && vData.distributed !== '' ? vData.distributed : '');
        rowData.push(vData.balance !== undefined && vData.balance !== '' ? vData.balance : '');
      });

      sheetData.push(rowData);
    });

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Define Merges for visual blueprint:
    // Row 1: Merge D1 to BO1
    // Row 2: Merge D2 to BO2
    // Row 3: For each vaccine, merge 4 columns
    const totalCols = 3 + products.length * 4;
    const merges: XLSX.Range[] = [
      // Row 1: Title
      { s: { r: 0, c: 3 }, e: { r: 0, c: totalCols - 1 } },
      // Row 2: VACCINES
      { s: { r: 1, c: 3 }, e: { r: 1, c: totalCols - 1 } }
    ];

    // Row 3: Vaccine groups (4 columns each)
    products.forEach((_, idx) => {
      const startCol = 3 + idx * 4;
      merges.push({
        s: { r: 2, c: startCol },
        e: { r: 2, c: startCol + 3 }
      });
    });

    ws['!merges'] = merges;

    // Set column widths
    const colWidths: any[] = [
      { wch: 14 }, // Col A: Processing
      { wch: 14 }, // Col B: Completed
      { wch: 28 }  // Col C: Facility
    ];
    for (let i = 3; i < totalCols; i++) {
      colWidths.push({ wch: 12 });
    }
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, `${district} Allocation`);
    XLSX.writeFile(wb, `${district.replace(/\s+/g, '_')}_${month.replace(/\s+/g, '_')}_Allocation_Blueprint.xlsx`);
  };

  // Export exact CSV matching user uploaded file format
  const handleExportCSV = () => {
    const lines: string[] = [];

    // ROW 1
    const r1 = ['', '', '', `${district} ${month}`];
    for (let i = 4; i < 3 + products.length * 4; i++) r1.push('');
    lines.push(r1.join(','));

    // ROW 2
    const r2 = ['Processing ', 'Completed ', 'Facility', '                                                               VACCINES'];
    for (let i = 4; i < 3 + products.length * 4; i++) r2.push('');
    lines.push(r2.join(','));

    // ROW 3
    const r3: string[] = ['', '', ''];
    products.forEach(p => {
      r3.push(p);
      r3.push('');
      r3.push('');
      r3.push('');
    });
    lines.push(r3.join(','));

    // ROW 4
    const r4: string[] = ['', '', ''];
    products.forEach(() => {
      r4.push('Carry-over');
      r4.push('Allocation');
      r4.push('Distributed');
      r4.push('Balance');
    });
    lines.push(r4.join(','));

    // DATA ROWS
    rows.forEach(r => {
      const line: string[] = [
        `"${(r.processing || '').replace(/"/g, '""')}"`,
        `"${(r.completed || '').replace(/"/g, '""')}"`,
        `"${(r.facility || '').replace(/"/g, '""')}"`
      ];

      products.forEach(p => {
        const v = r.vaccines[p] || {};
        line.push(v.carryOver !== undefined && v.carryOver !== '' ? String(v.carryOver) : '');
        line.push(v.allocation !== undefined && v.allocation !== '' ? String(v.allocation) : '');
        line.push(v.distributed !== undefined && v.distributed !== '' ? String(v.distributed) : '');
        line.push(v.balance !== undefined && v.balance !== '' ? String(v.balance) : '');
      });

      lines.push(line.join(','));
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `${district}_${month}_sample.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Import Excel (.xlsx) or CSV file and automatically map into 67-column structure
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (!aoa || aoa.length === 0) {
          alert('Uploaded file is empty.');
          return;
        }

        // Detect if this is the exact sample.xlsx blueprint structure
        // Row 0: Title banner (contains district & month)
        // Row 1: Processing, Completed, Facility, VACCINES
        // Row 2: Vaccine headers
        // Row 3: Subcolumns (Carry-over, Allocation, Distributed, Balance)
        let parsedDistrict = district;
        let parsedMonth = month;
        let parsedProducts = [...products];
        let dataStartRow = 4;

        // Check Row 0 or 1 for title
        if (aoa[0] && Array.isArray(aoa[0])) {
          const titleCandidate = aoa[0].find((c: any) => typeof c === 'string' && c.trim().length > 3);
          if (titleCandidate) {
            const parts = titleCandidate.trim().split(' ');
            if (parts.length >= 2) {
              parsedDistrict = parts.slice(0, parts.length - 2).join(' ') || parts[0];
              parsedMonth = parts.slice(-2).join(' ');
              setDistrict(parsedDistrict);
              setMonth(parsedMonth);
            }
          }
        }

        // Check Row 2 for vaccine names
        if (aoa[2] && Array.isArray(aoa[2])) {
          const detectedProducts: string[] = [];
          for (let col = 3; col < aoa[2].length; col += 4) {
            const pName = aoa[2][col];
            if (typeof pName === 'string' && pName.trim()) {
              detectedProducts.push(pName.trim());
            }
          }
          if (detectedProducts.length > 0) {
            parsedProducts = detectedProducts;
            setProducts(detectedProducts);
          }
        }

        // Parse data rows starting from row 4
        const newParsedRows: FacilityBlueprintRow[] = [];
        for (let rIdx = dataStartRow; rIdx < aoa.length; rIdx++) {
          const rowData = aoa[rIdx];
          if (!rowData || rowData.length === 0) continue;

          const processing = String(rowData[0] || '').trim();
          const completed = String(rowData[1] || '').trim();
          const facility = String(rowData[2] || '').trim();

          // If entire row is blank and we already parsed some rows, still allow up to 10 blank rows
          const vaccinesObj: Record<string, VaccineSectionData> = {};

          parsedProducts.forEach((pName, pIdx) => {
            const baseCol = 3 + pIdx * 4;
            const cRaw = rowData[baseCol];
            const aRaw = rowData[baseCol + 1];
            const dRaw = rowData[baseCol + 2];

            const cVal = cRaw !== '' && cRaw !== null && !isNaN(Number(cRaw)) ? Number(cRaw) : '';
            const aVal = aRaw !== '' && aRaw !== null && !isNaN(Number(aRaw)) ? Number(aRaw) : '';
            const dVal = dRaw !== '' && dRaw !== null && !isNaN(Number(dRaw)) ? Number(dRaw) : '';

            const bVal = computeBalance(cVal, aVal, dVal);

            vaccinesObj[pName] = {
              carryOver: cVal,
              allocation: aVal,
              distributed: dVal,
              balance: bVal
            };
          });

          newParsedRows.push({
            id: `bp_upload_${rIdx}_${Date.now()}`,
            processing,
            completed,
            facility,
            subDistrict: '',
            vaccines: vaccinesObj
          });
        }

        if (newParsedRows.length > 0) {
          const normalizedRows = normalizeBlueprintRowsProgress(newParsedRows, parsedProducts);
          setRows(normalizedRows);
          saveBlueprintToServer(normalizedRows, parsedProducts, parsedDistrict, parsedMonth);
          setSaveStatus(`Imported ${newParsedRows.length} rows successfully from ${file.name}`);
          setTimeout(() => setSaveStatus(null), 3500);
        } else {
          alert('No valid facility rows could be extracted from this sheet.');
        }
      } catch (uploadErr) {
        console.error('Failed to parse spreadsheet:', uploadErr);
        alert('Could not parse Excel/CSV file. Please ensure it follows the standard allocation format.');
      }
    };
    reader.readAsBinaryString(file);
    if (e.target) e.target.value = '';
  };

  // Filter & Sort Logic
  const filteredAndSortedRows = useMemo(() => {
    let result = [...rows];

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        r =>
          r.facility.toLowerCase().includes(q) ||
          r.processing.toLowerCase().includes(q) ||
          r.completed.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(r => {
        if (statusFilter === 'completed') {
          return isFacilityCompleted(r, products);
        }
        if (statusFilter === 'in_progress') {
          return isFacilityInProgress(r, products);
        }
        if (statusFilter === 'pending') {
          return isFacilityPending(r, products);
        }
        if (statusFilter === 'discrepancy') {
          // Negative balance
          return Object.values(r.vaccines).some((v: any) => typeof v?.balance === 'number' && v.balance < 0);
        }
        return true;
      });
    }

    // Sorting
    if (sortField === 'facility') {
      result.sort((a, b) => (sortAsc ? a.facility.localeCompare(b.facility) : b.facility.localeCompare(a.facility)));
    } else if (sortField === 'processing') {
      result.sort((a, b) => (sortAsc ? a.processing.localeCompare(b.processing) : b.processing.localeCompare(a.processing)));
    }

    return result;
  }, [rows, searchQuery, statusFilter, sortField, sortAsc, products]);

  // Overall facility stats for quick status summary
  const facilityStats = useMemo(() => {
    let completedCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;
    const namedRows = rows.filter(r => r.facility && r.facility.trim().length > 0);
    namedRows.forEach(r => {
      if (isFacilityCompleted(r, products)) completedCount++;
      else if (isFacilityInProgress(r, products)) inProgressCount++;
      else if (isFacilityPending(r, products)) pendingCount++;
    });
    const total = namedRows.length;
    const completionRate = total > 0 ? Math.round((completedCount / total) * 100) : 0;
    return { completedCount, inProgressCount, pendingCount, total, completionRate };
  }, [rows, products]);

  // Calculations for Footer Totals
  const totals = useMemo(() => {
    const productTotals: Record<string, { carry: number; alloc: number; dist: number; bal: number }> = {};
    products.forEach(p => {
      productTotals[p] = { carry: 0, alloc: 0, dist: 0, bal: 0 };
    });

    rows.forEach(r => {
      products.forEach(p => {
        const v = r.vaccines[p];
        if (v) {
          if (typeof v.carryOver === 'number') productTotals[p].carry += v.carryOver;
          if (typeof v.allocation === 'number') productTotals[p].alloc += v.allocation;
          if (typeof v.distributed === 'number') productTotals[p].dist += v.distributed;
          if (typeof v.balance === 'number') productTotals[p].bal += v.balance;
        }
      });
    });

    return productTotals;
  }, [rows, products]);

  // Total 67 columns count calculation: 3 frozen columns + 4 columns per product
  const totalColumnCount = 3 + products.length * 4;
  const lastColLetter = getExcelColumnLetter(totalColumnCount - 1);

  return (
    <div className="flex flex-col gap-4 w-full bg-white rounded-3xl border border-slate-200 shadow-md p-4 sm:p-6 text-slate-800 antialiased">
      {/* Top Banner & Blueprint Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#ED7D31] text-white flex items-center justify-center shadow-md font-bold">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Vaccine Allocation Blueprint
              </h2>
              <span className="text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full bg-orange-100 text-[#C55A11] border border-orange-200">
                {totalColumnCount} Columns (A:{lastColLetter})
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Exact 67-column blueprint adhering to <strong className="text-slate-700">sample.xlsx</strong> with frozen headers, live formulas, and editable cells.
            </p>
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-all cursor-pointer border border-slate-300"
            title="Import from sample.xlsx or CSV"
          >
            <Upload className="w-3.5 h-3.5 text-[#ED7D31]" />
            <span>Import .xlsx / .csv</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />

          {/* Direct Copy-Paste from Excel */}
          <button
            type="button"
            onClick={() => setShowPasteExcelModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold rounded-xl transition-all cursor-pointer border border-emerald-300 shadow-2xs"
            title="Copy and paste rows/columns right from Excel in-line (or press Ctrl+V directly on any cell)"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-emerald-600" />
            <span>Paste from Excel</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#ED7D31] hover:bg-[#C55A11] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
            title="Download formatted sample.xlsx with orange headers"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export .xlsx</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-all cursor-pointer border border-slate-300"
            title="Download standard CSV"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={handleSyncToOrderChecker}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#5C2D91] hover:bg-[#482372] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
            title="Sync these facility quotas into the live Order Checker validation engine"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync to Order Checker</span>
          </button>

          <button
            type="button"
            onClick={() => setShowClearModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-800 text-xs font-bold rounded-xl transition-all cursor-pointer border border-rose-200 shadow-2xs"
            title="Clear all allocation data from this blueprint"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
            <span>Clear Blueprint Data</span>
          </button>

          {onNavigateToChecker && (
            <button
              type="button"
              onClick={onNavigateToChecker}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
              title="Compare incoming facility orders against this Blueprint to find discrepancies"
            >
              <FileCheck className="w-3.5 h-3.5" />
              <span>Compare Orders in Checker &rarr;</span>
            </button>
          )}
        </div>
      </div>

      {/* Multi-District & Months Selection Dropdown Bar - Unified Single Line */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:px-4 shadow-xs">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Left: District & Month Selectors on One Line */}
          <div className="flex items-center gap-2.5 flex-wrap xl:flex-nowrap flex-1 min-w-0">
            {/* DISTRICT SELECTOR */}
            <div className="flex items-center gap-1.5 min-w-[210px] sm:min-w-[260px] flex-1 xl:flex-initial">
              <label htmlFor="district-dropdown-select" className="text-xs font-black text-slate-700 flex items-center gap-1 shrink-0">
                <MapPin className="w-3.5 h-3.5 text-[#ED7D31]" />
                <span>District:</span>
              </label>

              <div className="relative flex-1 min-w-0">
                <select
                  id="district-dropdown-select"
                  value={district}
                  onChange={(e) => {
                    const selectedName = e.target.value;
                    const dSheets = districts.filter(d => (d.district || '').trim().toLowerCase() === selectedName.toLowerCase());
                    const target = dSheets.find(d => d.id === activeDistrictId) || dSheets[0];
                    if (target) handleSwitchDistrict(target.id);
                  }}
                  className="w-full appearance-none bg-slate-50 hover:bg-white border border-slate-300 hover:border-slate-400 focus:border-[#ED7D31] focus:ring-2 focus:ring-[#ED7D31]/20 rounded-xl pl-2.5 pr-7 py-1.5 text-xs font-bold text-slate-900 cursor-pointer shadow-2xs transition-all truncate"
                >
                  {uniqueDistrictNames.map(dName => {
                    const districtSheets = districts.filter(d => (d.district || '').trim().toLowerCase() === dName.toLowerCase());
                    const facCount = (districtSheets[0]?.rows || []).filter(r => r.facility?.trim()).length;
                    return (
                      <option key={dName} value={dName}>
                        {dName} ({facCount} fac)
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              {/* District Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setRenameDistrictValue(district);
                    setShowRenameDistrictModal(true);
                  }}
                  className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 rounded-lg text-xs transition-all cursor-pointer"
                  title={`Rename district "${district}"`}
                >
                  <Pencil className="w-3 h-3" />
                </button>

                {uniqueDistrictNames.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteDistrict(activeDistrictId)}
                    className="p-1.5 bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-700 rounded-lg text-xs transition-all cursor-pointer"
                    title={`Delete active sheet for "${district}"`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setNewDistrictName('');
                    setNewDistrictMonth(month || 'September 2026');
                    setNewDistrictTemplate('sample');
                    setShowAddDistrictModal(true);
                  }}
                  className="inline-flex items-center gap-0.5 px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-2xs"
                  title="Add new district"
                >
                  <Plus className="w-3 h-3" />
                  <span className="hidden sm:inline text-[11px]">Dist</span>
                </button>
              </div>
            </div>

            {/* Subtle Divider between District and Month */}
            <div className="hidden md:block w-px h-6 bg-slate-200 shrink-0" />

            {/* MONTH SELECTOR */}
            <div className="flex items-center gap-1.5 min-w-[240px] sm:min-w-[310px] flex-1 xl:flex-initial">
              <label htmlFor="month-dropdown-select" className="text-xs font-black text-amber-950 flex items-center gap-1 shrink-0">
                <Calendar className="w-3.5 h-3.5 text-[#ED7D31]" />
                <span>Month:</span>
              </label>

              {/* Prev Month stepper */}
              <button
                type="button"
                disabled={currentMonthIndex <= 0}
                onClick={() => {
                  if (currentMonthIndex > 0) {
                    const prevSheet = sheetsForCurrentDistrict[currentMonthIndex - 1];
                    if (prevSheet) handleSwitchDistrict(prevSheet.id);
                  }
                }}
                className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 hover:bg-amber-100/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all shrink-0"
                title="Previous Month Cycle"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>

              <div className="relative flex-1 min-w-0">
                <select
                  id="month-dropdown-select"
                  value={activeDistrictId}
                  onChange={(e) => {
                    handleSwitchDistrict(e.target.value);
                  }}
                  className="w-full appearance-none bg-amber-50/50 hover:bg-white border border-amber-300 hover:border-[#ED7D31] focus:border-[#ED7D31] focus:ring-2 focus:ring-[#ED7D31]/20 rounded-xl pl-2.5 pr-7 py-1.5 text-xs font-black text-[#C55A11] cursor-pointer shadow-2xs transition-all truncate"
                >
                  {sheetsForCurrentDistrict.map(sheet => {
                    const sheetFacs = (sheet.rows || []).filter(r => r.facility && r.facility.trim()).length;
                    const doneCount = (sheet.rows || []).filter(r => (r.completed || '').trim().length > 0).length;
                    return (
                      <option key={sheet.id} value={sheet.id}>
                        {sheet.month} {doneCount > 0 ? `(${doneCount}/${sheetFacs} Done)` : `(${sheetFacs} fac)`}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#ED7D31] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              {/* Next Month stepper */}
              <button
                type="button"
                disabled={currentMonthIndex < 0 || currentMonthIndex >= sheetsForCurrentDistrict.length - 1}
                onClick={() => {
                  if (currentMonthIndex >= 0 && currentMonthIndex < sheetsForCurrentDistrict.length - 1) {
                    const nextSheet = sheetsForCurrentDistrict[currentMonthIndex + 1];
                    if (nextSheet) handleSwitchDistrict(nextSheet.id);
                  }
                }}
                className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 hover:bg-amber-100/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all shrink-0"
                title="Next Month Cycle"
              >
                <ChevronRight className="w-3 h-3" />
              </button>

              {/* Month Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setRenameMonthValue(month);
                    setShowRenameMonthModal(true);
                  }}
                  className="p-1.5 bg-slate-100 hover:bg-amber-100/50 text-slate-600 rounded-lg text-xs transition-all cursor-pointer"
                  title={`Rename month cycle "${month}"`}
                >
                  <Pencil className="w-3 h-3" />
                </button>

                {sheetsForCurrentDistrict.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteMonth(activeDistrictId)}
                    className="p-1.5 bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-700 rounded-lg text-xs transition-all cursor-pointer"
                    title={`Delete month "${month}" sheet`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const suggested = getSuggestedNextMonth(month);
                    setNewMonthName(suggested);
                    setMonthScope('current');
                    setCarryOverEndingBalances(true);
                    setCopyFacilitiesForNewMonth(true);
                    setShowAddMonthModal(true);
                  }}
                  className="inline-flex items-center gap-0.5 px-2 py-1.5 bg-gradient-to-r from-amber-500 to-[#ED7D31] hover:from-amber-600 hover:to-[#C55A11] text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-2xs"
                  title="Add new monthly allocation sheet with automatic stock continuity"
                >
                  <Plus className="w-3 h-3" />
                  <span className="hidden sm:inline text-[11px]">Month</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right: Quick Stats, Sync Status, and Comment Section on the Same Line */}
          <div className="flex items-center gap-2 shrink-0 self-end xl:self-auto flex-wrap">
            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
              {facilityStats.completedCount}/{facilityStats.total} Completed ({facilityStats.completionRate}%)
            </span>

            {saveStatus && (
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>{saveStatus}</span>
              </span>
            )}

            {syncStatus && (
              <span className="text-[11px] font-bold text-[#5C2D91] bg-purple-50 border border-purple-200 px-2 py-1 rounded-lg flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>{syncStatus}</span>
              </span>
            )}

            {/* Dedicated Comment Section Toggle Button */}
            <button
              type="button"
              onClick={() => setShowCommentsDrawer(!showCommentsDrawer)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                showCommentsDrawer || allComments.length > 0
                  ? 'bg-amber-100 text-[#C55A11] border border-amber-300 hover:bg-amber-200/80 shadow-2xs'
                  : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
              }`}
              title="Open Comment Section to view and manage all facility and vaccine comments"
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#ED7D31]" />
              <span>Comments</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                allComments.length > 0 ? 'bg-[#ED7D31] text-white' : 'bg-slate-200 text-slate-600'
              }`}>
                {allComments.length}
              </span>
            </button>

            {/* Activity Audit Log Navigation Button */}
            {onNavigateToAuditLog && (
              <button
                type="button"
                onClick={() => onNavigateToAuditLog('vaccine_blueprint')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-purple-50 hover:bg-purple-100 text-[#5C2D91] border border-purple-200 transition-all cursor-pointer shrink-0 shadow-2xs"
                title="View complete activity audit log for Blueprint edits and contributor trail"
              >
                <History className="w-3.5 h-3.5 text-[#5C2D91]" />
                <span>Audit Trail</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Operational Controls & Table Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {/* Search */}
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search facility..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#ED7D31] focus:bg-white"
            />
          </div>

          {/* Interactive Workflow Status Filter Pills */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({rows.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('in_progress')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'in_progress'
                  ? 'bg-amber-100 text-amber-900 shadow-xs border border-amber-300'
                  : 'text-amber-800 hover:bg-amber-50'
              }`}
              title="Filter to facilities currently in progress (highlighted amber with start date)"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              <span>In Progress ({facilityStats.inProgressCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('completed')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'completed'
                  ? 'bg-emerald-100 text-emerald-950 shadow-xs border border-emerald-300'
                  : 'text-emerald-800 hover:bg-emerald-50'
              }`}
              title="Filter to completed facilities (highlighted green with completion date)"
            >
              <Check className="w-3 h-3 text-emerald-700 stroke-[2.5]" />
              <span>Done ({facilityStats.completedCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pending')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'pending'
                  ? 'bg-white text-slate-800 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Pending ({facilityStats.pendingCount})
            </button>
          </div>

          {/* Sort By Facility */}
          <button
            type="button"
            onClick={() => {
              if (sortField === 'facility') {
                setSortAsc(!sortAsc);
              } else {
                setSortField('facility');
                setSortAsc(true);
              }
            }}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1 cursor-pointer transition-all ${
              sortField === 'facility'
                ? 'bg-orange-100 text-[#C55A11] border-orange-300'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <ArrowUpDown className="w-3 h-3" />
            <span>Facility {sortField === 'facility' ? (sortAsc ? 'A-Z' : 'Z-A') : ''}</span>
          </button>
        </div>

        {/* Row & Column Add / Delete Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleAddRow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Facility Row</span>
          </button>

          <button
            type="button"
            onClick={() => handleAddMultipleBlankRows(5)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer border border-slate-300"
            title="Add 5 empty rows matching the blank rows in sample.xlsx"
          >
            <Plus className="w-3 h-3" />
            <span>+5 Blank Rows</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddColumnModal(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-orange-100 hover:bg-orange-200 text-[#C55A11] text-xs font-bold rounded-xl transition-all cursor-pointer border border-orange-300"
            title="Add a custom vaccine or product group (4 subcolumns)"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Add Product Group</span>
          </button>

          {/* Copy Table to Clipboard for Google Sheets */}
          <button
            type="button"
            onClick={() => handleCopyTableToClipboard(false)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold rounded-xl transition-all cursor-pointer border border-emerald-300 shadow-2xs"
            title="Copy entire sheet to clipboard formatted for Google Sheets (paste with Ctrl+V into any spreadsheet)"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy for Google Sheets</span>
          </button>

          {/* Clear Column Modal Trigger */}
          <button
            type="button"
            onClick={() => setShowClearColumnModal(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer border border-slate-300"
            title="Clear a specific column across all rows"
          >
            <Eraser className="w-3.5 h-3.5 text-slate-600" />
            <span>Clear Column...</span>
          </button>

          {selectedRowIds.size > 0 && (
            <>
              <button
                type="button"
                onClick={handleClearSelectedRows}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold rounded-xl transition-all cursor-pointer border border-amber-300 shadow-2xs"
                title="Clear contents of selected rows without deleting the rows"
              >
                <Eraser className="w-3 h-3 text-amber-700" />
                <span>Clear Row ({selectedRowIds.size})</span>
              </button>

              <button
                type="button"
                onClick={handleDeleteSelectedRows}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-2xs"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete ({selectedRowIds.size})</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 
        =============================================================================
        EXACT BLUEPRINT TABLE WITH 67 COLUMNS (A TO BO)
        Row 1: Centered District + Month Title across vaccines
        Row 2: Processing, Completed, Facility, VACCINES
        Row 3: Grouped vaccine headers (BCG, OPV, MR, PENTA, ...) 4 cols each
        Row 4: Carry-over, Allocation, Distributed, Balance
        Frozen columns: Col A (Processing), Col B (Completed), Col C (Facility)
        =============================================================================
      */}
      <div className="relative border border-black rounded-2xl overflow-hidden shadow-inner bg-white">
        <div className="overflow-x-auto overflow-y-auto max-h-[680px] scrollbar-thin">
          <table className="w-full text-left border-collapse select-text text-xs">
            {/* Table Header Section */}
            <thead className="sticky top-0 z-30 font-sans">
              {/* ========================================================= */}
              {/* ROW 1: DISTRICT & MONTH TITLE BANNER                     */}
              {/* ========================================================= */}
              <tr className="bg-[#ED7D31] text-white border-b border-black">
                {/* Columns A, B, C Frozen in Row 1 */}
                <th
                  className="sticky left-0 z-40 bg-[#ED7D31] border-r border-black py-2.5 px-2 text-center w-[140px] min-w-[140px] text-[10px] font-bold text-orange-100"
                  scope="col"
                >
                  Col A
                </th>
                <th
                  className="sticky left-[140px] z-40 bg-[#ED7D31] border-r border-black py-2.5 px-2 text-center w-[140px] min-w-[140px] text-[10px] font-bold text-orange-100"
                  scope="col"
                >
                  Col B
                </th>
                <th
                  className="sticky left-[280px] z-40 bg-[#ED7D31] border-r-2 border-black py-2.5 px-3 text-center w-[230px] min-w-[230px] text-[10px] font-bold text-orange-100"
                  scope="col"
                >
                  Col C
                </th>

                {/* Merged Title across all vaccine columns (Cols D:BO) */}
                <th
                  colSpan={products.length * 4}
                  className="bg-[#ED7D31] text-white py-2.5 px-4 text-center font-black tracking-widest text-sm sm:text-base uppercase border-r border-black"
                  scope="col"
                >
                  {district} {month}
                </th>
              </tr>

              {/* ========================================================= */}
              {/* ROW 2: PROCESSING, COMPLETED, FACILITY, VACCINES          */}
              {/* ========================================================= */}
              <tr className="bg-[#F8CBAD] text-slate-900 border-b border-black text-xs font-black uppercase tracking-wider">
                {/* Col A: Processing / Start Date */}
                <th
                  className="sticky left-0 z-40 bg-[#ED7D31] text-white border-r border-black py-2.5 px-2 text-center w-[140px] min-w-[140px]"
                  scope="col"
                >
                  Start Date
                </th>

                {/* Col B: Completed Date */}
                <th
                  className="sticky left-[140px] z-40 bg-[#ED7D31] text-white border-r border-black py-2.5 px-2 text-center w-[140px] min-w-[140px]"
                  scope="col"
                >
                  Completed Date
                </th>

                {/* Col C: Facility */}
                <th
                  className="sticky left-[280px] z-40 bg-[#ED7D31] text-white border-r-2 border-black py-2.5 px-3 text-center w-[230px] min-w-[230px]"
                  scope="col"
                >
                  Facility
                </th>

                {/* Merged VACCINES header spanning all vaccine columns */}
                <th
                  colSpan={products.length * 4}
                  className="bg-[#F8CBAD] text-slate-950 py-2 px-4 text-center font-black text-xs tracking-widest border-r border-black"
                  scope="col"
                >
                  VACCINES
                </th>
              </tr>

              {/* ========================================================= */}
              {/* ROW 3: GROUPED VACCINE HEADERS (4 COLUMNS EACH)           */}
              {/* ========================================================= */}
              <tr className="bg-[#FCE4D6] text-slate-900 border-b border-black text-[11px] font-black text-center">
                {/* Frozen column placeholders */}
                <th
                  className="sticky left-0 z-40 bg-[#FFF2CC] border-r border-black py-1.5 px-2 text-[10px] text-slate-600 font-bold"
                  scope="col"
                >
                  Started / In-Prog
                </th>
                <th
                  className="sticky left-[140px] z-40 bg-[#FFF2CC] border-r border-black py-1.5 px-2 text-[10px] text-slate-600 font-bold"
                  scope="col"
                >
                  Completed Date
                </th>
                <th
                  className="sticky left-[280px] z-40 bg-[#FFF2CC] border-r-2 border-black py-1.5 px-3 text-[10px] text-slate-600 font-bold"
                  scope="col"
                >
                  Facility Name
                </th>

                {/* 4 columns for each product */}
                {products.map((pName, pIdx) => {
                  const startColLetter = getExcelColumnLetter(3 + pIdx * 4);
                  const endColLetter = getExcelColumnLetter(3 + pIdx * 4 + 3);

                  return (
                    <th
                      key={pName}
                      colSpan={4}
                      className="bg-[#F8CBAD] text-slate-950 py-1.5 px-2 border-r border-black font-black uppercase text-center relative group"
                      scope="col"
                      title={`${pName} occupies columns ${startColLetter}:${endColLetter}`}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>{pName}</span>
                        <span className="text-[9px] font-normal text-slate-600">
                          ({startColLetter}:{endColLetter})
                        </span>
                        {/* Option to clear entire product column group */}
                        <button
                          type="button"
                          onClick={() => handleClearColumn({ vaccine: pName, subCol: 'all' })}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-700 rounded transition-opacity cursor-pointer ml-0.5"
                          title={`Clear all data in ${pName} across all rows`}
                        >
                          <Eraser className="w-2.5 h-2.5" />
                        </button>
                        {/* Option to remove custom column if not in base 16 */}
                        {!DEFAULT_BLUEPRINT_PRODUCTS.includes(pName) && (
                          <button
                            type="button"
                            onClick={() => handleDeleteProductGroup(pName)}
                            className="opacity-0 group-hover:opacity-100 text-rose-700 hover:text-rose-900 ml-1 cursor-pointer"
                            title="Delete this product group"
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>

              {/* ========================================================= */}
              {/* ROW 4: SUBCOLUMNS (Carry-over, Allocation, Dist, Balance)   */}
              {/* ========================================================= */}
              <tr className="bg-[#FFF2CC] text-slate-900 border-b-2 border-black text-[10.5px] font-black text-center uppercase tracking-tight">
                {/* Frozen column headers */}
                <th
                  className="sticky left-0 z-40 bg-[#FFF2CC] border-r border-black py-2 px-2 text-center w-[140px] min-w-[140px] group/colH"
                  scope="col"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>Start Date</span>
                    <button
                      type="button"
                      onClick={() => handleClearColumn('processing')}
                      className="opacity-0 group-hover/colH:opacity-100 text-slate-400 hover:text-rose-600 transition-opacity cursor-pointer p-0.5 rounded"
                      title="Clear Start Dates across all rows"
                    >
                      <Eraser className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </th>
                <th
                  className="sticky left-[140px] z-40 bg-[#FFF2CC] border-r border-black py-2 px-2 text-center w-[140px] min-w-[140px] group/colH"
                  scope="col"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>Completed</span>
                    <button
                      type="button"
                      onClick={() => handleClearColumn('completed')}
                      className="opacity-0 group-hover/colH:opacity-100 text-slate-400 hover:text-rose-600 transition-opacity cursor-pointer p-0.5 rounded"
                      title="Clear Completed Dates across all rows"
                    >
                      <Eraser className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </th>
                <th
                  className="sticky left-[280px] z-40 bg-[#FFF2CC] border-r-2 border-black py-2 px-3 text-left w-[230px] min-w-[230px] group/colH"
                  scope="col"
                >
                  <div className="flex items-center justify-between">
                    <span>Facility Name</span>
                    <button
                      type="button"
                      onClick={() => handleClearColumn('facility')}
                      className="opacity-0 group-hover/colH:opacity-100 text-slate-400 hover:text-rose-600 transition-opacity cursor-pointer p-0.5 rounded"
                      title="Clear Facility Names across all rows"
                    >
                      <Eraser className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </th>

                {/* Subcolumns for each vaccine: Carry-over, Allocation, Distributed, Balance */}
                {products.map(pName => (
                  <React.Fragment key={pName}>
                    <th
                      className="bg-[#FFF2CC] border-r border-slate-400 py-2 px-1 text-center w-[82px] min-w-[82px] text-slate-800 group/subCol"
                      scope="col"
                      title={`${pName} Carry-over`}
                    >
                      <div className="flex items-center justify-center gap-0.5">
                        <span>Carry-over</span>
                        <button
                          type="button"
                          onClick={() => handleClearColumn({ vaccine: pName, subCol: 'carryOver' })}
                          className="opacity-0 group-hover/subCol:opacity-100 text-slate-400 hover:text-rose-600 cursor-pointer p-0.5 transition-opacity"
                          title={`Clear ${pName} Carry-over across all rows`}
                        >
                          <Eraser className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </th>
                    <th
                      className="bg-[#FFF2CC] border-r border-slate-400 py-2 px-1 text-center w-[82px] min-w-[82px] text-slate-800 group/subCol"
                      scope="col"
                      title={`${pName} Allocation`}
                    >
                      <div className="flex items-center justify-center gap-0.5">
                        <span>Allocation</span>
                        <button
                          type="button"
                          onClick={() => handleClearColumn({ vaccine: pName, subCol: 'allocation' })}
                          className="opacity-0 group-hover/subCol:opacity-100 text-slate-400 hover:text-rose-600 cursor-pointer p-0.5 transition-opacity"
                          title={`Clear ${pName} Allocation across all rows`}
                        >
                          <Eraser className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </th>
                    <th
                      className="bg-[#FFF2CC] border-r border-slate-400 py-2 px-1 text-center w-[82px] min-w-[82px] text-slate-800 group/subCol"
                      scope="col"
                      title={`${pName} Distributed`}
                    >
                      <div className="flex items-center justify-center gap-0.5">
                        <span>Distributed</span>
                        <button
                          type="button"
                          onClick={() => handleClearColumn({ vaccine: pName, subCol: 'distributed' })}
                          className="opacity-0 group-hover/subCol:opacity-100 text-slate-400 hover:text-rose-600 cursor-pointer p-0.5 transition-opacity"
                          title={`Clear ${pName} Distributed across all rows`}
                        >
                          <Eraser className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </th>
                    <th
                      className="bg-[#FCE4D6] border-r border-black py-2 px-2 text-center w-[82px] min-w-[82px] text-[#C55A11] font-black"
                      scope="col"
                      title={`${pName} Balance = Carry-over + Allocation - Distributed`}
                    >
                      Balance
                    </th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>

            {/* Table Body: Facility Rows */}
            <tbody className="divide-y divide-black font-sans text-xs">
              {filteredAndSortedRows.length === 0 ? (
                <tr>
                  <td colSpan={totalColumnCount} className="py-12 text-center text-slate-400">
                    <p className="text-sm font-bold text-slate-600 mb-1">No rows found</p>
                    <p className="text-xs">Click "Add Facility Row" or "+5 Blank Rows" to start entering data.</p>
                  </td>
                </tr>
              ) : (
                filteredAndSortedRows.map((row, rowIdx) => {
                  const isSelected = selectedRowIds.has(row.id);
                  const isCompleted = isFacilityCompleted(row, products);
                  const isInProgress = isFacilityInProgress(row, products);
                  const isPending = isFacilityPending(row, products);

                  // Alternating zebra row bands matching Excel workbook
                  const isZebra = rowIdx % 2 === 1;

                  // Highlighting:
                  // Completed: Green highlight (#DCFCE7) with emerald accent
                  // In Progress: Yellow highlight (#FEF08A) with amber/yellow accent
                  const rowBg = isSelected
                    ? 'bg-purple-100/90'
                    : isCompleted
                    ? 'bg-[#DCFCE7] hover:bg-[#BBF7D0]'
                    : isInProgress
                    ? 'bg-[#FEF08A] hover:bg-[#FDE047]'
                    : isZebra
                    ? 'bg-[#FFFDF7] hover:bg-orange-50/50'
                    : 'bg-white hover:bg-orange-50/50';

                  const stickyCellBg = isSelected
                    ? 'bg-purple-100'
                    : isCompleted
                    ? 'bg-[#DCFCE7]'
                    : isInProgress
                    ? 'bg-[#FEF08A]'
                    : isZebra
                    ? 'bg-[#FFFDF7]'
                    : 'bg-white';

                  const rowBorderClass = isCompleted
                    ? 'border-b border-emerald-300 border-l-4 border-l-emerald-600'
                    : isInProgress
                    ? 'border-b border-yellow-300 border-l-4 border-l-amber-500'
                    : 'border-b border-black border-l-4 border-l-transparent';

                  return (
                    <tr
                      key={row.id}
                      className={`${rowBg} ${rowBorderClass} transition-colors group`}
                    >
                      {/* ===================================================== */}
                      {/* COL A: START DATE / PROCESSING (FROZEN)              */}
                      {/* ===================================================== */}
                      <td
                        className={`sticky left-0 z-20 ${stickyCellBg} border-r border-black p-0 w-[140px] min-w-[140px]`}
                      >
                        <div className="flex items-center h-full px-2 py-1.5 gap-1 relative">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedRowIds(prev => {
                                const next = new Set(prev);
                                if (next.has(row.id)) next.delete(row.id);
                                else next.add(row.id);
                                return next;
                              });
                            }}
                            className="mr-1 accent-[#ED7D31] rounded shrink-0 cursor-pointer"
                            title="Select row"
                          />
                          <div className="flex-1 flex items-center min-w-0">
                            <input
                              type="text"
                              value={row.processing}
                              onChange={e => handleCellChange(row.id, 'processing', e.target.value)}
                              onFocus={() => setFocusedCell({ rowId: row.id, colIdx: 0 })}
                              onPaste={e => handleDirectCellPaste(e, row.id, 0)}
                              placeholder="YYYY-MM-DD"
                              className={`w-full bg-transparent text-xs font-semibold focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#ED7D31] rounded px-1 truncate ${
                                isCompleted
                                  ? 'text-slate-600 font-medium'
                                  : isInProgress
                                  ? 'text-amber-900 font-bold'
                                  : isPending
                                  ? 'text-slate-400 font-normal'
                                  : 'text-slate-800'
                              }`}
                              title={
                                isInProgress
                                  ? `In Progress - Started on ${row.processing}`
                                  : isCompleted
                                  ? `Start Date: ${row.processing || 'Recorded'}`
                                  : 'Start Date (auto-filled when started)'
                              }
                            />
                          </div>

                          {/* Quick clear row button on hover */}
                          <button
                            type="button"
                            onClick={() => handleClearRow(row.id)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-600 rounded transition-opacity cursor-pointer shrink-0"
                            title="Clear this row's contents"
                          >
                            <Eraser className="w-3 h-3" />
                          </button>

                          {/* In Progress indicator */}
                          {isInProgress && (
                            <span
                              className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0"
                              title={`In Progress - Started on ${row.processing}`}
                            />
                          )}
                        </div>
                      </td>

                      {/* ===================================================== */}
                      {/* COL B: COMPLETED DATE (FROZEN)                       */}
                      {/* ===================================================== */}
                      <td
                        className={`sticky left-[140px] z-20 ${stickyCellBg} border-r border-black p-0 w-[140px] min-w-[140px]`}
                      >
                        <div className="flex items-center h-full px-2 py-1.5 gap-1">
                          <div className="flex-1 flex items-center min-w-0">
                            <input
                              type="text"
                              value={row.completed}
                              onChange={e => handleCellChange(row.id, 'completed', e.target.value)}
                              onFocus={() => setFocusedCell({ rowId: row.id, colIdx: 1 })}
                              onPaste={e => handleDirectCellPaste(e, row.id, 1)}
                              placeholder={isCompleted ? 'Completed' : isInProgress ? 'In Progress...' : '-'}
                              className={`w-full bg-transparent text-xs font-medium focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#ED7D31] rounded px-1 truncate ${
                                isCompleted ? 'text-emerald-900 font-bold' : 'text-slate-500'
                              }`}
                              title={isCompleted ? `Completed on ${row.completed}` : 'Completion Date (automatic when distributed is entered)'}
                            />
                          </div>

                          {/* Move from In Progress back to Start */}
                          {isInProgress && (
                            <button
                              type="button"
                              onClick={() => handleMoveToStart(row.id)}
                              className="px-1.5 py-0.5 bg-amber-200/90 hover:bg-amber-300 text-amber-950 border border-amber-400 rounded text-[9.5px] font-bold shadow-2xs flex items-center gap-0.5 cursor-pointer transition-all shrink-0"
                              title="Move from In Progress back to Start (resets distributed values, keeps allocations)"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>To Start</span>
                            </button>
                          )}

                          {/* Completed checkmark and reset to start button */}
                          {isCompleted && (
                            <div className="flex items-center gap-1 shrink-0">
                              <span
                                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-600 text-white"
                                title={`Completed automatically on ${row.completed}`}
                              >
                                <Check className="w-2.5 h-2.5 stroke-[3]" />
                              </span>
                              <button
                                type="button"
                                onClick={() => handleMoveToStart(row.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-emerald-200 rounded text-slate-500 hover:text-slate-800 transition-opacity cursor-pointer"
                                title="Move back to Start"
                              >
                                <RotateCcw className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* ===================================================== */}
                      {/* COL C: FACILITY (FROZEN)                             */}
                      {/* ===================================================== */}
                      <td
                        onMouseEnter={(e) => handleCellCommentMouseEnter(e, row, 'facility')}
                        onMouseLeave={handleCellCommentMouseLeave}
                        className={`sticky left-[280px] z-20 ${stickyCellBg} border-r-2 border-black p-0 w-[230px] min-w-[230px] relative group/facility`}
                      >
                        <div className="flex items-center justify-between h-full px-2.5 py-1.5 gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <input
                              type="text"
                              value={row.facility}
                              onChange={e => handleCellChange(row.id, 'facility', e.target.value)}
                              onFocus={() => setFocusedCell({ rowId: row.id, colIdx: 2 })}
                              onPaste={e => handleDirectCellPaste(e, row.id, 2)}
                              placeholder="Facility name..."
                              className={`w-full bg-transparent text-xs font-bold focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#ED7D31] rounded px-1 truncate ${
                                isCompleted ? 'text-emerald-950 font-black' : isInProgress ? 'text-amber-950 font-black' : 'text-slate-900'
                              }`}
                            />
                          </div>

                          {/* Facility Comment Indicator / Quick Add Button */}
                          <div className="flex items-center gap-1 shrink-0">
                            {row.comment ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenCommentEditor(row.id, row.facility, 'facility', row.comment);
                                }}
                                className="p-1 rounded-md bg-amber-100 hover:bg-amber-200 text-[#C55A11] border border-amber-300 transition-all cursor-pointer shadow-2xs"
                                title={`Facility Comment: "${row.comment}". Click to edit.`}
                              >
                                <MessageSquare className="w-3 h-3 fill-amber-500/20" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenCommentEditor(row.id, row.facility, 'facility', '');
                                }}
                                className="opacity-0 group-hover/facility:opacity-100 p-1 rounded-md bg-slate-100 hover:bg-amber-100 text-slate-400 hover:text-amber-800 transition-all cursor-pointer"
                                title="Add comment to facility"
                              >
                                <MessageSquare className="w-3 h-3" />
                              </button>
                            )}

                            {row.facility && onFacilitySelectedForOrder && (
                              <button
                                type="button"
                                onClick={() => handleSelectFacilityForOrder(row)}
                                className={`text-[10px] font-bold hover:underline whitespace-nowrap ml-0.5 shrink-0 cursor-pointer ${
                                  isCompleted
                                    ? 'text-emerald-700'
                                    : isInProgress
                                    ? 'text-amber-800 font-black'
                                    : 'text-[#5C2D91] opacity-0 group-hover:opacity-100'
                                }`}
                                title={
                                  isCompleted
                                    ? 'Review facility orders in Order Checker'
                                    : isInProgress
                                    ? 'Audit facility orders in Order Checker (In Progress)'
                                    : 'Start facility order: auto-sets start date & opens Order Checker'
                                }
                              >
                                {isCompleted ? 'View \u2192' : isInProgress ? 'Audit \u2192' : 'Start \u2192'}
                              </button>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* ===================================================== */}
                      {/* COLS D:BO VACCINE PRODUCT SECTIONS                   */}
                      {/* ===================================================== */}
                      {products.map((pName, pIdx) => {
                        const vData = row.vaccines[pName] || {};
                        const carry = vData.carryOver !== undefined ? vData.carryOver : '';
                        const alloc = vData.allocation !== undefined ? vData.allocation : '';
                        const dist = vData.distributed !== undefined ? vData.distributed : '';
                        const bal = vData.balance !== undefined ? vData.balance : '';

                        const isNegativeBalance = typeof bal === 'number' && bal < 0;
                        const vaccineComment =
                          row.vaccineComments?.[pName]?.trim() ||
                          vData.comment?.trim() ||
                          '';

                        return (
                          <React.Fragment key={pName}>
                            {/* Carry-over (Col 1 of group) */}
                            <td
                              onMouseEnter={(e) => handleCellCommentMouseEnter(e, row, pName)}
                              onMouseLeave={handleCellCommentMouseLeave}
                              className="border-r border-slate-300 p-0 text-right w-[82px] min-w-[82px]"
                            >
                              <input
                                type="text"
                                inputMode="numeric"
                                value={carry}
                                onChange={e =>
                                  handleCellChange(row.id, { vaccine: pName, subCol: 'carryOver' }, e.target.value)
                                }
                                onFocus={() => setFocusedCell({ rowId: row.id, colIdx: 3 + pIdx * 4 + 0 })}
                                onPaste={e => handleDirectCellPaste(e, row.id, 3 + pIdx * 4 + 0)}
                                placeholder=""
                                className="w-full bg-transparent text-right text-xs px-2 py-1.5 text-slate-800 font-medium focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#ED7D31]"
                              />
                            </td>

                            {/* Allocation (Col 2 of group) with Excel-style comment corner tag */}
                            <td
                              onMouseEnter={(e) => handleCellCommentMouseEnter(e, row, pName)}
                              onMouseLeave={handleCellCommentMouseLeave}
                              className="border-r border-slate-300 p-0 text-right w-[82px] min-w-[82px] relative group/allocCell"
                            >
                              {/* Classic Spreadsheet Red Triangle Marker when comment exists */}
                              {vaccineComment && (
                                <span
                                  className="absolute top-0 right-0 w-0 h-0 border-t-[8px] border-r-[8px] border-t-red-600 border-r-transparent pointer-events-none z-10"
                                  title={`${pName} comment: "${vaccineComment}"`}
                                />
                              )}

                              <div className="relative flex items-center">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={alloc}
                                  onChange={e =>
                                    handleCellChange(row.id, { vaccine: pName, subCol: 'allocation' }, e.target.value)
                                  }
                                  onFocus={() => setFocusedCell({ rowId: row.id, colIdx: 3 + pIdx * 4 + 1 })}
                                  onPaste={e => handleDirectCellPaste(e, row.id, 3 + pIdx * 4 + 1)}
                                  placeholder=""
                                  className="w-full bg-transparent text-right text-xs px-2 py-1.5 text-slate-900 font-bold focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#ED7D31]"
                                />

                                {/* Quick Add / Edit Comment Button on hover */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenCommentEditor(row.id, row.facility, pName, vaccineComment);
                                  }}
                                  className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/allocCell:opacity-100 p-0.5 rounded text-slate-400 hover:text-amber-800 bg-white/80 hover:bg-amber-100 shadow-2xs transition-opacity cursor-pointer z-10"
                                  title={vaccineComment ? `Edit comment for ${pName}` : `Add comment for ${pName}`}
                                >
                                  <MessageSquare className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </td>

                            {/* Distributed (Col 3 of group) */}
                            <td
                              onMouseEnter={(e) => handleCellCommentMouseEnter(e, row, pName)}
                              onMouseLeave={handleCellCommentMouseLeave}
                              className="border-r border-slate-300 p-0 text-right w-[82px] min-w-[82px]"
                            >
                              <input
                                type="text"
                                inputMode="numeric"
                                value={dist}
                                onChange={e =>
                                  handleCellChange(row.id, { vaccine: pName, subCol: 'distributed' }, e.target.value)
                                }
                                onFocus={() => setFocusedCell({ rowId: row.id, colIdx: 3 + pIdx * 4 + 2 })}
                                onPaste={e => handleDirectCellPaste(e, row.id, 3 + pIdx * 4 + 2)}
                                placeholder=""
                                className="w-full bg-transparent text-right text-xs px-2 py-1.5 text-slate-700 font-medium focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#ED7D31]"
                              />
                            </td>

                            {/* Balance (Col 4 of group) - Auto-Calculated Formula: Carry + Alloc - Dist */}
                            <td
                              onMouseEnter={(e) => handleCellCommentMouseEnter(e, row, pName)}
                              onMouseLeave={handleCellCommentMouseLeave}
                              className={`border-r border-black p-0 text-right w-[82px] min-w-[82px] ${
                                isNegativeBalance ? 'bg-red-100/90' : ''
                              }`}
                              title={`${pName} Balance: ${bal !== '' ? bal : 'Blank'}`}
                            >
                              <div
                                className={`w-full text-right text-xs px-2 py-1.5 font-black ${
                                  isNegativeBalance
                                    ? 'text-red-700 font-black'
                                    : bal !== ''
                                    ? 'text-emerald-800'
                                    : 'text-slate-300'
                                }`}
                              >
                                {bal !== '' ? bal : ''}
                              </div>
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Table Footer: Summary & Column Totals */}
            <tfoot className="sticky bottom-0 z-30 bg-[#FFF2CC] border-t-2 border-black font-sans text-xs font-black">
              <tr>
                <td className="sticky left-0 z-30 bg-[#FFF2CC] border-r border-black py-2.5 px-2 text-center text-slate-900 w-[140px] min-w-[140px]">
                  TOTALS
                </td>
                <td className="sticky left-[140px] z-30 bg-[#FFF2CC] border-r border-black py-2.5 px-2 text-center text-slate-600 w-[140px] min-w-[140px]">
                  {facilityStats.completedCount}/{facilityStats.total} Done
                </td>
                <td className="sticky left-[280px] z-30 bg-[#FFF2CC] border-r-2 border-black py-2.5 px-3 text-left text-slate-900 w-[230px] min-w-[230px]">
                  Cohort Summary
                </td>

                {/* Subcolumn Totals */}
                {products.map(pName => {
                  const t = totals[pName] || { carry: 0, alloc: 0, dist: 0, bal: 0 };
                  const isNegative = t.bal < 0;

                  return (
                    <React.Fragment key={pName}>
                      <td className="border-r border-slate-400 py-2 px-2 text-right text-slate-700">
                        {t.carry > 0 ? t.carry.toLocaleString() : '-'}
                      </td>
                      <td className="border-r border-slate-400 py-2 px-2 text-right text-slate-950 font-black">
                        {t.alloc > 0 ? t.alloc.toLocaleString() : '-'}
                      </td>
                      <td className="border-r border-slate-400 py-2 px-2 text-right text-slate-700">
                        {t.dist > 0 ? t.dist.toLocaleString() : '-'}
                      </td>
                      <td
                        className={`border-r border-black py-2 px-2 text-right font-black ${
                          isNegative ? 'text-red-700 bg-red-100' : 'text-[#C55A11]'
                        }`}
                      >
                        {t.bal.toLocaleString()}
                      </td>
                    </React.Fragment>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Footer Notes & Legend */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-[#FFF8E7] border-2 border-amber-500"></span>
            <span className="font-semibold text-amber-900">In Progress (Warm Amber + Start Date)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-[#EAF8F0] border-2 border-emerald-600"></span>
            <span className="font-semibold text-emerald-950">Completed (Green + Completion Date)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300"></span>
            <span>Negative Balance Alert (&lt; 0)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-[#C55A11] bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200">
              Formula: Balance = Carry-over + Allocation - Distributed
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span>Freeze Panes Active: Cols A (Start), B (Done), C (Facility)</span>
          &bull;
          <span>67 Columns Total</span>
        </div>
      </div>

      {/* Modal: Add Product Group */}
      {showAddColumnModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-md w-full shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 text-[#C55A11] flex items-center justify-center">
                <Columns className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">Add Product Group</h3>
                <p className="text-xs text-slate-500">
                  Creates a new 4-column section (Carry-over, Allocation, Distributed, Balance)
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Product / Vaccine Name:</label>
              <input
                type="text"
                value={newColumnName}
                onChange={e => setNewColumnName(e.target.value)}
                placeholder="e.g. Hepatitis B, Malaria RTSS, Soloshot 0.1ml"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#ED7D31] focus:bg-white"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setNewColumnName('');
                  setShowAddColumnModal(false);
                }}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddProductGroup}
                className="px-4 py-2 bg-[#ED7D31] hover:bg-[#C55A11] text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer"
              >
                Add 4-Column Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add District */}
      {showAddDistrictModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">Add New District Sheet</h3>
                <p className="text-xs text-slate-500">
                  Creates an identical 67-column allocation sheet for this district
                </p>
              </div>
            </div>

            <form onSubmit={handleAddDistrict} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">District Name:</label>
                <input
                  type="text"
                  value={newDistrictName}
                  onChange={e => setNewDistrictName(e.target.value)}
                  placeholder="e.g. East Mamprusi, Chereponi, Bunkpurugu"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Reporting Cycle / Month:</label>
                <input
                  type="text"
                  value={newDistrictMonth}
                  onChange={e => setNewDistrictMonth(e.target.value)}
                  placeholder="e.g. September 2026"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Starting Rows Template:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewDistrictTemplate('sample')}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      newDistrictTemplate === 'sample'
                        ? 'border-emerald-500 bg-emerald-50/70 text-emerald-900'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <div className="text-xs font-bold">Standard 5 Facilities</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Prefills sample facilities &amp; quotas</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewDistrictTemplate('blank')}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      newDistrictTemplate === 'blank'
                        ? 'border-emerald-500 bg-emerald-50/70 text-emerald-900'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <div className="text-xs font-bold">Blank Sheet</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">5 blank entry rows ready for typing</div>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddDistrictModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newDistrictName.trim() || loading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Create District Sheet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Rename District */}
      {showRenameDistrictModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 text-[#C55A11] flex items-center justify-center">
                <Pencil className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">Rename District</h3>
                <p className="text-xs text-slate-500">
                  Updates district name in the blueprint and syncs with Vaccine Checker
                </p>
              </div>
            </div>

            <form onSubmit={handleRenameDistrict} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">New District Name:</label>
                <input
                  type="text"
                  value={renameDistrictValue}
                  onChange={e => setRenameDistrictValue(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#ED7D31] focus:bg-white"
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRenameDistrictModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!renameDistrictValue.trim()}
                  className="px-4 py-2 bg-[#ED7D31] hover:bg-[#C55A11] text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  Save Name
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add New Allocation Month */}
      {showAddMonthModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-amber-100 text-[#C55A11] flex items-center justify-center shrink-0 shadow-xs">
                <Calendar className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-base sm:text-lg font-black text-slate-900">
                  Add Allocation Month
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Create a new monthly allocation cycle for <span className="font-bold text-[#C55A11]">{district}</span> or across all districts.
                </p>
              </div>
            </div>

            <form onSubmit={handleAddMonth} className="space-y-4">
              {/* Month Name Input & Quick Suggestions */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  New Allocation Month &amp; Year:
                </label>
                <input
                  type="text"
                  value={newMonthName}
                  onChange={e => setNewMonthName(e.target.value)}
                  placeholder="e.g. October 2026, November 2026"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#ED7D31] focus:bg-white"
                  autoFocus
                  required
                />

                {/* Quick month selection chips */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[10px] font-bold text-slate-400">Suggestions:</span>
                  {[
                    getSuggestedNextMonth(month),
                    getSuggestedNextMonth(getSuggestedNextMonth(month)),
                    'November 2026',
                    'December 2026',
                    'January 2027'
                  ]
                    .filter((v, i, a) => a.indexOf(v) === i && v !== month)
                    .slice(0, 4)
                    .map(mSug => (
                      <button
                        key={mSug}
                        type="button"
                        onClick={() => setNewMonthName(mSug)}
                        className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-all cursor-pointer ${
                          newMonthName === mSug
                            ? 'bg-amber-100 border-amber-300 text-[#C55A11] font-bold'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {mSug}
                      </button>
                    ))}
                </div>
              </div>

              {/* Scope Options: Single District vs All Districts */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Apply Scope:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMonthScope('current')}
                    className={`p-3 rounded-2xl border text-left cursor-pointer transition-all ${
                      monthScope === 'current'
                        ? 'border-[#ED7D31] bg-orange-50/70 text-slate-900 ring-2 ring-[#ED7D31]/20'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600'
                    }`}
                  >
                    <div className="text-xs font-black text-[#C55A11]">This District Only</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Creates new month for "{district}" ({rows.filter(r => r.facility?.trim()).length} facilities)
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMonthScope('all')}
                    className={`p-3 rounded-2xl border text-left cursor-pointer transition-all ${
                      monthScope === 'all'
                        ? 'border-[#5C2D91] bg-purple-50/70 text-slate-900 ring-2 ring-[#5C2D91]/20'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600'
                    }`}
                  >
                    <div className="text-xs font-black text-[#5C2D91]">All {uniqueDistrictNames.length} Districts</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Rolls out new month across every registered district sheet
                    </div>
                  </button>
                </div>
              </div>

              {/* Stock Rollover & Facility Continuity Options */}
              <div className="space-y-2 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#ED7D31]" />
                  <span>Automated Stock Continuity (Carry-Over)</span>
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={carryOverEndingBalances}
                    onChange={e => setCarryOverEndingBalances(e.target.checked)}
                    className="mt-0.5 rounded text-[#ED7D31] focus:ring-[#ED7D31]"
                  />
                  <div>
                    <span className="font-bold text-slate-900">Carry over ending balances as starting stock</span>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                      Each facility's remaining balance at the end of <span className="font-bold">{month}</span> will automatically become its starting Carry-Over stock for <span className="font-bold">{newMonthName || 'the new month'}</span>. Allocation and Distributed values reset to 0.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-700 select-none pt-1 border-t border-slate-200/60">
                  <input
                    type="checkbox"
                    checked={copyFacilitiesForNewMonth}
                    onChange={e => setCopyFacilitiesForNewMonth(e.target.checked)}
                    className="mt-0.5 rounded text-[#ED7D31] focus:ring-[#ED7D31]"
                  />
                  <div>
                    <span className="font-bold text-slate-900">Retain facility roster &amp; sub-districts</span>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                      Preserves all {rows.filter(r => r.facility?.trim()).length} facilities and their designated sub-districts in the new allocation sheet.
                    </p>
                  </div>
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddMonthModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newMonthName.trim() || loading}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-[#ED7D31] hover:from-amber-600 hover:to-[#C55A11] text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md cursor-pointer disabled:opacity-50 flex items-center gap-1.5 transition-all"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{loading ? 'Creating...' : `Create ${newMonthName ? `"${newMonthName}"` : 'Month'} Allocation`}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Rename Month */}
      {showRenameMonthModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-[#C55A11] flex items-center justify-center">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">Rename Allocation Month</h3>
                <p className="text-xs text-slate-500">
                  Updates reporting month for <span className="font-bold text-[#C55A11]">{district}</span>
                </p>
              </div>
            </div>

            <form onSubmit={handleRenameMonth} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Month Name:</label>
                <input
                  type="text"
                  value={renameMonthValue}
                  onChange={e => setRenameMonthValue(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#ED7D31] focus:bg-white"
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRenameMonthModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!renameMonthValue.trim()}
                  className="px-4 py-2 bg-[#ED7D31] hover:bg-[#C55A11] text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  Save Month
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Clear Blueprint Data */}
      {showClearModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0 shadow-xs">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-base sm:text-lg font-black text-slate-900">
                  Clear Allocation Blueprint Data
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Choose whether to clear data in the active district sheet or across all district sheets.
                </p>
              </div>
            </div>

            {/* Warning Callout */}
            <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold">Caution: Destructive Action</div>
                <div className="text-[11px] text-rose-700 leading-relaxed">
                  This will erase all recorded facilities, carry-over, allocations, and distributed amounts in the selected scope, resetting them to blank template rows. Changes will sync immediately to the live Vaccine Checker and Dashboard.
                </div>
              </div>
            </div>

            {/* Current Sheet Overview */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between text-slate-600">
                <span>Active District Sheet:</span>
                <span className="font-black text-[#C55A11]">{district}</span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Active Facilities Count:</span>
                <span className="font-bold text-slate-900">
                  {rows.filter(r => r.facility && r.facility.trim()).length} facilities
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Total Districts Configured:</span>
                <span className="font-bold text-slate-900">{districts.length} districts</span>
              </div>
            </div>

            {/* Clear Scope Selection Options */}
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-slate-700 block">Select Clear Scope:</label>

              {/* Option 1: Clear Active District Only */}
              <button
                type="button"
                disabled={isClearing}
                onClick={() => handleClearBlueprintData('current')}
                className="w-full p-3.5 bg-white hover:bg-orange-50/40 border border-slate-200 hover:border-orange-300 rounded-2xl text-left flex items-start gap-3 transition-all cursor-pointer group shadow-2xs"
              >
                <div className="w-8 h-8 rounded-xl bg-orange-100 text-[#C55A11] flex items-center justify-center shrink-0 mt-0.5">
                  <MapPin className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-slate-900 group-hover:text-[#C55A11] flex items-center justify-between">
                    <span>Clear Active Sheet: "{district}"</span>
                    <span className="text-[10px] bg-orange-100 text-[#C55A11] px-2 py-0.5 rounded-full font-bold">
                      Current District
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Resets all facility rows in "{district}" to 5 blank rows ready for fresh paste or upload. Other districts will remain untouched.
                  </p>
                </div>
              </button>

              {/* Option 2: Clear All Districts */}
              <button
                type="button"
                disabled={isClearing}
                onClick={() => handleClearBlueprintData('all')}
                className="w-full p-3.5 bg-rose-50/40 hover:bg-rose-50 border border-rose-200 hover:border-rose-400 rounded-2xl text-left flex items-start gap-3 transition-all cursor-pointer group shadow-2xs"
              >
                <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0 mt-0.5">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-rose-900 group-hover:text-rose-700 flex items-center justify-between">
                    <span>Clear All Districts ({districts.length} Sheets)</span>
                    <span className="text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-black">
                      Entire Blueprint
                    </span>
                  </div>
                  <p className="text-[11px] text-rose-700/80 mt-0.5">
                    Wipes all facility allocation quotas across every district sheet in the blueprint, resetting the entire database to blank state.
                  </p>
                </div>
              </button>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-[11px] text-slate-400 font-medium">
                {isClearing ? 'Clearing and synchronizing...' : 'No undo available'}
              </span>

              <button
                type="button"
                disabled={isClearing}
                onClick={() => setShowClearModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* FLOATING HOVER COMMENT TOOLTIP                                            */}
      {/* Displays when hovering over a facility or any vaccine allocated to it    */}
      {/* ========================================================================= */}
      {hoveredCommentInfo && (
        <div
          style={{
            position: 'fixed',
            top: `${hoveredCommentInfo.y}px`,
            left: `${hoveredCommentInfo.x}px`,
            zIndex: 9999,
            width: '320px',
            pointerEvents: 'auto',
          }}
          onMouseEnter={() => {
            if (commentHoverTimeoutRef.current) {
              clearTimeout(commentHoverTimeoutRef.current);
            }
          }}
          onMouseLeave={handleCellCommentMouseLeave}
          className="bg-slate-950/95 text-white p-3.5 rounded-2xl shadow-2xl border border-amber-400/40 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Tooltip Header */}
          <div className="flex items-start justify-between gap-2 mb-2 pb-2 border-b border-slate-800">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  <MessageSquare className="w-3 h-3 text-amber-400" />
                  {hoveredCommentInfo.vaccineName ? `${hoveredCommentInfo.vaccineName} Allocation` : 'Facility Logistics'}
                </span>
                <span className="text-[10px] text-slate-400 font-semibold truncate">
                  {district} &bull; {month}
                </span>
              </div>
              <h4 className="text-xs font-bold text-slate-100 truncate mt-1">
                {hoveredCommentInfo.facility}
              </h4>
            </div>

            <button
              type="button"
              onClick={() => {
                handleOpenCommentEditor(
                  hoveredCommentInfo.rowId,
                  hoveredCommentInfo.facility,
                  hoveredCommentInfo.targetType,
                  hoveredCommentInfo.comment
                );
              }}
              className="p-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-white transition-colors cursor-pointer shrink-0"
              title="Edit this comment"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>

          {/* Stats if Vaccine */}
          {hoveredCommentInfo.stats && (
            <div className="text-[10px] font-medium text-amber-200/90 bg-amber-950/40 border border-amber-500/20 rounded-lg px-2 py-1 mb-2">
              {hoveredCommentInfo.stats}
            </div>
          )}

          {/* Comment Body */}
          <p className="text-xs text-slate-200 leading-relaxed font-sans whitespace-pre-wrap">
            "{hoveredCommentInfo.comment}"
          </p>

          {/* Tooltip Footer hint */}
          <div className="mt-2.5 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[9px] text-slate-400">
            <span>Hover active &bull; Click pencil to edit</span>
            <span className="text-amber-400 font-bold">Vaccine Blueprint Note</span>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* COMMENT SECTION DRAWER (SLIDE-OVER)                                      */}
      {/* ========================================================================= */}
      {showCommentsDrawer && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-amber-500/10 to-orange-500/10">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-[#ED7D31] text-white flex items-center justify-center shadow-xs">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">Allocation Comment Section</h3>
                  <p className="text-xs text-slate-500">
                    {district} &bull; {month} ({allComments.length} {allComments.length === 1 ? 'note' : 'notes'})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCommentsDrawer(false)}
                className="p-1.5 rounded-xl hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                title="Close Comments Drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Controls: Search & Category Filters */}
            <div className="p-3.5 border-b border-slate-100 bg-slate-50/70 space-y-2.5">
              {/* Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={commentsSearch}
                  onChange={e => setCommentsSearch(e.target.value)}
                  placeholder="Search comments or facility..."
                  className="w-full pl-8.5 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ED7D31] shadow-2xs"
                />
                {commentsSearch && (
                  <button
                    type="button"
                    onClick={() => setCommentsSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Filter Pills & Add Button */}
              <div className="flex items-center justify-between gap-1.5 flex-wrap">
                <div className="inline-flex rounded-lg bg-slate-200/80 p-0.5 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setCommentsFilter('all')}
                    className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                      commentsFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All ({allComments.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommentsFilter('facility')}
                    className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                      commentsFilter === 'facility' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Facility ({allComments.filter(c => c.targetType === 'facility').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommentsFilter('vaccine')}
                    className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                      commentsFilter === 'vaccine' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Vaccines ({allComments.filter(c => c.targetType !== 'facility').length})
                  </button>
                </div>

                {/* Quick Add Comment button */}
                <button
                  type="button"
                  onClick={() => {
                    const firstRow = rows.find(r => r.facility?.trim()) || rows[0];
                    if (firstRow) {
                      handleOpenCommentEditor(firstRow.id, firstRow.facility || 'Facility', 'facility', '');
                    }
                  }}
                  className="px-2.5 py-1 bg-[#ED7D31] hover:bg-[#C55A11] text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shadow-2xs transition-all cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>New Note</span>
                </button>
              </div>
            </div>

            {/* Comment List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(() => {
                const filtered = allComments.filter(c => {
                  if (commentsFilter === 'facility' && c.targetType !== 'facility') return false;
                  if (commentsFilter === 'vaccine' && c.targetType === 'facility') return false;
                  if (commentsSearch.trim()) {
                    const q = commentsSearch.toLowerCase();
                    return (
                      c.facility.toLowerCase().includes(q) ||
                      c.comment.toLowerCase().includes(q) ||
                      c.targetLabel.toLowerCase().includes(q) ||
                      (c.subDistrict && c.subDistrict.toLowerCase().includes(q))
                    );
                  }
                  return true;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-12 text-slate-400">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
                        <MessageSquare className="w-6 h-6" />
                      </div>
                      <p className="text-xs font-bold text-slate-700">No comments found</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {commentsSearch ? 'Try a different search keyword' : 'Hover on any facility or vaccine cell in the table to view comments, or click "+ New Note"'}
                      </p>
                    </div>
                  );
                }

                return filtered.map(item => (
                  <div
                    key={item.id}
                    className="p-3.5 bg-slate-50 hover:bg-amber-50/40 border border-slate-200 hover:border-amber-300 rounded-2xl transition-all shadow-2xs group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                              item.targetType === 'facility'
                                ? 'bg-purple-100 text-purple-900 border border-purple-200'
                                : 'bg-amber-100 text-amber-900 border border-amber-200'
                            }`}
                          >
                            {item.targetLabel}
                          </span>
                          {item.subDistrict && (
                            <span className="text-[10px] text-slate-500 font-medium">
                              &bull; {item.subDistrict}
                            </span>
                          )}
                        </div>
                        <h4 className="text-xs font-bold text-slate-900 mt-1 truncate">
                          {item.facility}
                        </h4>
                      </div>

                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => {
                            handleOpenCommentEditor(item.rowId, item.facility, item.targetType, item.comment);
                          }}
                          className="p-1 rounded-lg hover:bg-amber-200 text-slate-600 hover:text-amber-900 transition-colors cursor-pointer"
                          title="Edit comment"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(item.rowId, item.targetType)}
                          className="p-1 rounded-lg hover:bg-rose-100 text-slate-400 hover:text-rose-700 transition-colors cursor-pointer"
                          title="Delete comment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-700 mt-2 leading-relaxed bg-white border border-slate-200/80 rounded-xl p-2.5 whitespace-pre-wrap">
                      {item.comment}
                    </p>

                    {item.updatedAt && (
                      <div className="text-[9px] text-slate-400 mt-1.5 text-right">
                        Updated {new Date(item.updatedAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>

            {/* Drawer Footer */}
            <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500">
              <span>All notes persist automatically to Firestore</span>
              <button
                type="button"
                onClick={() => setShowCommentsDrawer(false)}
                className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-bold cursor-pointer transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT COMMENT                                                 */}
      {/* ========================================================================= */}
      {showEditCommentModal && commentModalData && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 text-[#C55A11] flex items-center justify-center shadow-xs">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {commentModalData.text ? 'Edit Allocation Comment' : 'Add Allocation Comment'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {district} &bull; {month}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowEditCommentModal(false);
                  setCommentModalData(null);
                }}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Facility Picker */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Facility:</label>
                <select
                  value={commentModalData.rowId}
                  onChange={e => {
                    const targetRow = rows.find(r => r.id === e.target.value);
                    if (targetRow) {
                      setCommentModalData({
                        ...commentModalData,
                        rowId: targetRow.id,
                        facilityName: targetRow.facility || 'Facility'
                      });
                    }
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#ED7D31]"
                >
                  {rows.filter(r => r.facility?.trim()).map(r => (
                    <option key={r.id} value={r.id}>
                      {r.facility} {r.subDistrict ? `(${r.subDistrict})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Selector: Facility level or specific Vaccine */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Comment Target:</label>
                <select
                  value={commentModalData.targetType}
                  onChange={e => {
                    const newTarget = e.target.value;
                    const targetRow = rows.find(r => r.id === commentModalData.rowId);
                    let existingComment = '';
                    if (targetRow) {
                      if (newTarget === 'facility') {
                        existingComment = targetRow.comment || '';
                      } else {
                        existingComment =
                          targetRow.vaccineComments?.[newTarget] ||
                          targetRow.vaccines?.[newTarget]?.comment ||
                          '';
                      }
                    }
                    setCommentModalData({
                      ...commentModalData,
                      targetType: newTarget,
                      text: existingComment
                    });
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#ED7D31]"
                >
                  <option value="facility">General Facility Logistics Note</option>
                  <optgroup label="Specific Vaccine Allocations">
                    {products.map(pName => (
                      <option key={pName} value={pName}>
                        {pName} Allocation Note
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Comment Textarea */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>Comment / Allocation Note:</span>
                  <span className="text-[10px] text-slate-400">Displays on hover</span>
                </label>
                <textarea
                  value={commentModalData.text}
                  onChange={e => setCommentModalData({ ...commentModalData, text: e.target.value })}
                  placeholder="e.g. Emergency top-up approved by Regional EPI officer; or cold chain backup note..."
                  rows={4}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#ED7D31] focus:bg-white resize-none"
                  autoFocus
                />
              </div>

              {/* Quick Presets */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Quick Presets:</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    'Emergency top-up approved (+20 vials)',
                    'Cold chain capacity limited to 150 doses',
                    'Outreach session scheduled for next week',
                    'Stock verified against ledger by In-Charge',
                    'Surplus returned to district cold room'
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCommentModalData({ ...commentModalData, text: preset })}
                      className="text-[10px] px-2 py-1 bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-900 border border-slate-200 rounded-lg cursor-pointer transition-colors"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              {commentModalData.text ? (
                <button
                  type="button"
                  onClick={() => {
                    handleDeleteComment(commentModalData.rowId, commentModalData.targetType);
                  }}
                  className="text-xs font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
                >
                  Delete Comment
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditCommentModal(false);
                    setCommentModalData(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleSaveComment(commentModalData.rowId, commentModalData.targetType, commentModalData.text);
                  }}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-[#ED7D31] hover:from-amber-600 hover:to-[#C55A11] text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md cursor-pointer flex items-center gap-1.5 transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Comment</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ===================================================================== */}
      {/* COPY-PASTE FROM EXCEL MODAL                                           */}
      {/* ===================================================================== */}
      {showPasteExcelModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shadow-2xs">
                  <ClipboardPaste className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Copy & Paste from Excel</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Paste data copied from your spreadsheet — all columns and formulas align in-line automatically.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPasteExcelModal(false);
                  setPastedExcelText('');
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* Clipboard Action Bar */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="font-bold text-slate-800 flex items-center gap-1.5">
                  <span>Excel Clipboard Data (TSV / Tab-Separated):</span>
                </label>
                <div className="flex items-center gap-2">
                  {typeof navigator !== 'undefined' && navigator.clipboard && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          if (text) {
                            setPastedExcelText(text);
                          }
                        } catch {
                          // Clipboard read permissions may be restricted in some browsers
                        }
                      }}
                      className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5" />
                      <span>Paste from Clipboard</span>
                    </button>
                  )}
                  {pastedExcelText && (
                    <button
                      type="button"
                      onClick={() => setPastedExcelText('')}
                      className="px-2 py-1 text-slate-500 hover:text-rose-600 font-bold transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Paste Textarea */}
              <textarea
                value={pastedExcelText}
                onChange={e => setPastedExcelText(e.target.value)}
                placeholder={"Click here and press Ctrl+V (or Cmd+V) to paste rows copied directly from Excel...\n\nExample format:\n2025-01-05\t2025-01-10\tDistrict Hospital\t100\t500\t450\t150...\nOR simply:\nDistrict Hospital\t100\t500\t450..."}
                rows={5}
                className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white resize-y"
                autoFocus
              />

              {/* Paste Settings Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                {/* Alignment Mode */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Column Alignment:
                  </label>
                  <select
                    value={pasteAlignmentMode}
                    onChange={e => setPasteAlignmentMode(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                  >
                    <option value="auto">Auto-Detect Format</option>
                    <option value="from_start">Full Row: Col A Start Date &rarr; Col B Completed &rarr; Col C Facility</option>
                    <option value="from_facility">From Facility: Col C Facility Name + 16 Vaccines</option>
                    <option value="alloc_only">Facility Name + Allocations Only (1 Col per Vaccine)</option>
                  </select>
                </div>

                {/* Destination */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Table Destination:
                  </label>
                  <select
                    value={pasteDestination}
                    onChange={e => setPasteDestination(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                  >
                    <option value="replace">Replace Current Table Rows</option>
                    <option value="append">Append Below Existing Rows</option>
                  </select>
                </div>

                {/* Skip Header Checkbox */}
                <div className="flex items-center sm:pt-5">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={pasteSkipHeader}
                      onChange={e => setPasteSkipHeader(e.target.checked)}
                      className="rounded accent-emerald-600 cursor-pointer w-4 h-4"
                    />
                    <span>First row is header (skip it)</span>
                  </label>
                </div>
              </div>

              {/* Preview Section */}
              {pastedExcelText.trim() ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800">
                      Live Parsed Preview ({parsedPreview.detectedRowCount} rows detected):
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      {parsedPreview.detectedAlignment}
                    </span>
                  </div>

                  {parsedPreview.rows.length > 0 ? (
                    <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-52 bg-white shadow-2xs">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-[#ED7D31] text-white font-bold sticky top-0">
                          <tr>
                            <th className="py-1.5 px-2 border-r border-orange-400 text-center w-8">#</th>
                            <th className="py-1.5 px-2.5 border-r border-orange-400">Facility Name</th>
                            <th className="py-1.5 px-2 border-r border-orange-400 text-center">Start Date</th>
                            <th className="py-1.5 px-2 border-r border-orange-400 text-center">Completed Date</th>
                            {products.slice(0, 4).map(p => (
                              <th key={p} className="py-1.5 px-2 border-r border-orange-400 text-center">
                                {p} Alloc
                              </th>
                            ))}
                            {products.length > 4 && (
                              <th className="py-1.5 px-2 text-center text-[10px]">
                                +{products.length - 4} more
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 font-medium">
                          {parsedPreview.rows.slice(0, 6).map((r, idx) => (
                            <tr key={r.id || idx} className="hover:bg-slate-50">
                              <td className="py-1.5 px-2 text-center text-slate-400 font-bold border-r border-slate-200">
                                {idx + 1}
                              </td>
                              <td className="py-1.5 px-2.5 font-bold text-slate-900 border-r border-slate-200">
                                {r.facility || <span className="text-slate-400 italic font-normal">[Blank Facility]</span>}
                              </td>
                              <td className="py-1.5 px-2 text-center text-slate-600 border-r border-slate-200">
                                {r.processing || '-'}
                              </td>
                              <td className="py-1.5 px-2 text-center text-slate-600 border-r border-slate-200">
                                {r.completed || '-'}
                              </td>
                              {products.slice(0, 4).map(p => (
                                <td key={p} className="py-1.5 px-2 text-right font-bold text-slate-800 border-r border-slate-200">
                                  {r.vaccines?.[p]?.allocation !== '' && r.vaccines?.[p]?.allocation !== undefined
                                    ? r.vaccines[p].allocation
                                    : '-'}
                                </td>
                              ))}
                              {products.length > 4 && (
                                <td className="py-1.5 px-2 text-center text-slate-400 text-[10px]">
                                  &bull;&bull;&bull;
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {parsedPreview.rows.length > 6 && (
                        <div className="p-2 text-center text-[11px] text-slate-500 bg-slate-50 border-t border-slate-200 font-medium">
                          ... and {parsedPreview.rows.length - 6} more rows ready to be applied in-line.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-center font-semibold">
                      Could not parse rows from the pasted text. Please verify the clipboard contents.
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-slate-600">
                  <p className="font-bold text-slate-800 mb-2">How to copy and paste in-line from Excel:</p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-600 text-[11px]">
                    <li>Open your Excel workbook (e.g. sample.xlsx) and highlight the cells or rows you need.</li>
                    <li>Press <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-bold">Ctrl + C</kbd> (or Cmd+C on Mac) to copy.</li>
                    <li>Paste into the box above, or directly click any cell on the main table and press <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-bold">Ctrl + V</kbd>.</li>
                  </ol>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
              <div className="text-[11px] text-slate-500 hidden sm:block">
                💡 <span className="font-semibold">Direct shortcut:</span> You can also press <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-bold">Ctrl + V</kbd> right on any table cell to paste in-line.
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasteExcelModal(false);
                    setPastedExcelText('');
                  }}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyPastedExcelData}
                  disabled={parsedPreview.rows.length === 0}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs ${
                    parsedPreview.rows.length > 0
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer hover:shadow-md'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <ClipboardPaste className="w-4 h-4" />
                  <span>
                    Apply {parsedPreview.rows.length > 0 ? `${parsedPreview.rows.length} Rows` : 'Data'} In-Line
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* CLEAR COLUMN MODAL                                                    */}
      {/* ===================================================================== */}
      {showClearColumnModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-amber-50 to-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 shadow-2xs">
                  <Eraser className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Clear Column Data</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Reset values in a specific column or product group across all rows.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowClearColumnModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4 text-xs">
              {/* Scope Selection Tabs */}
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setSelectedClearTargetType('vaccine')}
                  className={`py-1.5 text-center font-bold rounded-lg transition-all cursor-pointer ${
                    selectedClearTargetType === 'vaccine'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Vaccine Column
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedClearTargetType('base')}
                  className={`py-1.5 text-center font-bold rounded-lg transition-all cursor-pointer ${
                    selectedClearTargetType === 'base'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Facility / Dates
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedClearTargetType('bulk')}
                  className={`py-1.5 text-center font-bold rounded-lg transition-all cursor-pointer ${
                    selectedClearTargetType === 'bulk'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Bulk Column
                </button>
              </div>

              {/* Vaccine Column Options */}
              {selectedClearTargetType === 'vaccine' && (
                <div className="space-y-3.5 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                      Select Vaccine Product:
                    </label>
                    <select
                      value={selectedClearVaccine}
                      onChange={e => setSelectedClearVaccine(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#ED7D31] cursor-pointer"
                    >
                      {products.map(p => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                      Subcolumn to Clear:
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'all', label: 'Entire Vaccine Group (All 4 Subcols)' },
                        { id: 'distributed', label: 'Distributed Column Only' },
                        { id: 'allocation', label: 'Allocation Column Only' },
                        { id: 'carryOver', label: 'Carry-over Column Only' }
                      ].map(sub => (
                        <label
                          key={sub.id}
                          className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                            selectedClearSubCol === sub.id
                              ? 'bg-amber-50 border-amber-400 text-amber-950 font-bold'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 font-medium'
                          }`}
                        >
                          <input
                            type="radio"
                            name="clear_subcol"
                            value={sub.id}
                            checked={selectedClearSubCol === sub.id}
                            onChange={() => setSelectedClearSubCol(sub.id as any)}
                            className="mt-0.5 accent-amber-600"
                          />
                          <span className="text-[11px] leading-snug">{sub.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Base Column Options */}
              {selectedClearTargetType === 'base' && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Select Standard Column:
                  </label>
                  <div className="space-y-2">
                    {[
                      {
                        id: 'facility',
                        label: 'Col C: Facility Names',
                        desc: 'Clears facility names across all rows in the active sheet.'
                      },
                      {
                        id: 'processing',
                        label: 'Col A: Start Dates',
                        desc: 'Clears start dates across all rows in the active sheet.'
                      },
                      {
                        id: 'completed',
                        label: 'Col B: Completed Dates',
                        desc: 'Clears completed dates across all rows in the active sheet.'
                      }
                    ].map(col => (
                      <label
                        key={col.id}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                          selectedClearBaseCol === col.id
                            ? 'bg-amber-50 border-amber-400 text-amber-950 font-bold'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <input
                          type="radio"
                          name="clear_base"
                          value={col.id}
                          checked={selectedClearBaseCol === col.id}
                          onChange={() => setSelectedClearBaseCol(col.id as any)}
                          className="mt-0.5 accent-amber-600"
                        />
                        <div>
                          <div className="text-xs font-bold">{col.label}</div>
                          <div className="text-[11px] font-normal text-slate-500 mt-0.5">{col.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Bulk Column Across All Vaccines Options */}
              {selectedClearTargetType === 'bulk' && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Select Bulk Operation:
                  </label>
                  <div className="space-y-2">
                    {[
                      {
                        id: 'all_distributed',
                        label: 'Clear All Distributed Columns Across All Vaccines',
                        desc: 'Clears distributed quantities across all 16 vaccines, returning facilities to pending/start.'
                      },
                      {
                        id: 'all_allocation',
                        label: 'Clear All Allocation Columns Across All Vaccines',
                        desc: 'Clears planned allocation numbers across all 16 vaccines.'
                      },
                      {
                        id: 'all_carry',
                        label: 'Clear All Carry-Over Columns Across All Vaccines',
                        desc: 'Clears previous period carry-over balances across all 16 vaccines.'
                      }
                    ].map(b => (
                      <label
                        key={b.id}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                          selectedClearBulkCol === b.id
                            ? 'bg-amber-50 border-amber-400 text-amber-950 font-bold'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <input
                          type="radio"
                          name="clear_bulk"
                          value={b.id}
                          checked={selectedClearBulkCol === b.id}
                          onChange={() => setSelectedClearBulkCol(b.id as any)}
                          className="mt-0.5 accent-amber-600"
                        />
                        <div>
                          <div className="text-xs font-bold">{b.label}</div>
                          <div className="text-[11px] font-normal text-slate-500 mt-0.5">{b.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] flex items-start gap-2">
                <span className="font-bold text-amber-700">Notice:</span>
                <span>
                  This operation resets the selected column data across all {rows.length} rows in the active "{district} - {month}" sheet.
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClearColumnModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedClearTargetType === 'vaccine') {
                    handleClearColumn({
                      vaccine: selectedClearVaccine,
                      subCol: selectedClearSubCol
                    });
                  } else if (selectedClearTargetType === 'base') {
                    handleClearColumn(selectedClearBaseCol);
                  } else if (selectedClearTargetType === 'bulk') {
                    handleClearColumn(selectedClearBulkCol);
                  }
                  setShowClearColumnModal(false);
                }}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md cursor-pointer flex items-center gap-1.5 transition-all"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>Confirm & Clear Column</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
