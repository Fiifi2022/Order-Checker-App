import { authFetch } from '../utils/authFetch';
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { createPortal } from 'react-dom';
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
  Eraser,
  History
} from 'lucide-react';
import { blueprintColumnKey, visibleBlueprintColumns, deleteBlueprintColumnData } from '../utils/blueprintColumns';
import { safeFetchJson } from '../utils/api';
import { UserRoleRecord } from '../types';
import { getAllocationFacilityStatus, getAllocationStatus, getAllocationCellStyle, getExcelBaseFormatting, isAllocationWorksheet } from '../utils/allocationProgress';
import { getBlueprintProgressStatus } from '../utils/blueprintProgress';
import { parseBlueprintFile, parseBlueprintPaste, parseClipboardTsv, stripBlueprintHeaderRows } from '../utils/blueprintPaste';

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
  dhdTopUpTotal?: number;
}

export interface FacilityBlueprintRow {
  id: string;
  processing: string;
  completed: string;
  facility: string;
  deliverySite?: string;
  subDistrict?: string;
  comment?: string;
  commentUpdatedAt?: string;
  vaccineComments?: {
    [vaccineKey: string]: string;
  };
  boldCells?: string[];
  baseFormatting?: Record<string, React.CSSProperties>;
  vaccines: {
    [vaccineKey: string]: VaccineSectionData;
  };
}

export interface DhdInventoryEntryUi {
  id: string;
  requestId: string;
  type: 'top_up' | 'stock_adjustment';
  timestamp: string;
  district: string;
  cycle?: string;
  facility?: string;
  vaccine: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  distributedAfter?: number;
  user: string;
  note?: string;
}

export interface BlueprintCellMerge {
  id: string;
  rowIds: string[];
  startCol: number;
  endCol: number;
}

export interface DistrictSheetData {
  id: string;
  district: string;
  month: string;
  sheetName?: string;
  worksheetRole?: 'allocation' | 'other';
  updatedAt?: string;
  products?: string[];
  rows: FacilityBlueprintRow[];
  cellMerges?: BlueprintCellMerge[];
  headerLabels?: string[];
  hiddenRowIds?: string[];
  deletedColumnKeys?: string[];
  mergeHeaders?: boolean;
  freezeRows?: number;
  freezeColumns?: number;
}

const DEFAULT_BLUEPRINT_HEADER_LABELS = [
  'Col A', 'Col B', 'Col C', 'Col D', 'Col E',
  'Start Date', 'Completed Date', 'Facility', 'Sub-district', 'Delivery Site',
  'Started / In-Prog', 'Completed Date', 'Facility Name', 'Sub-district', 'Delivery Site',
  'Start Date', 'Completed', 'Facility', 'Sub-district', 'Delivery Site'
];

interface VaccineAllocationBlueprintProps {
  preferredSheetId?: string;
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
  productList: string[] = DEFAULT_BLUEPRINT_PRODUCTS,
  allocationWorksheet = false
): boolean {
  return (allocationWorksheet ? getAllocationFacilityStatus : getBlueprintProgressStatus)(row, productList) === 'completed';
}

export function isFacilityInProgress(
  row: FacilityBlueprintRow,
  productList: string[] = DEFAULT_BLUEPRINT_PRODUCTS,
  allocationWorksheet = false
): boolean {
  return (allocationWorksheet ? getAllocationFacilityStatus : getBlueprintProgressStatus)(row, productList) === 'in_progress';
}

export function isFacilityPending(
  row: FacilityBlueprintRow,
  productList: string[] = DEFAULT_BLUEPRINT_PRODUCTS,
  allocationWorksheet = false
): boolean {
  return (allocationWorksheet ? getAllocationFacilityStatus : getBlueprintProgressStatus)(row, productList) === 'pending';
}

function normalizeFacilityProgress(
  row: FacilityBlueprintRow,
  productList: string[],
  today: string
): FacilityBlueprintRow {
  // Loading and rendering do not write progress dates. Confirmed distribution
  // records its dates on the server; colours are derived separately from quantities.
  return row;
}

function normalizeBlueprintRowsProgress(
  rows: FacilityBlueprintRow[],
  productList: string[],
  today = new Date().toISOString().slice(0, 10)
): FacilityBlueprintRow[] {
  return rows.map(row => normalizeFacilityProgress(row, productList, today));
}

export default function VaccineAllocationBlueprint({
  preferredSheetId,
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
  const [cellMerges, setCellMerges] = useState<BlueprintCellMerge[]>([]);
  const [headerLabels, setHeaderLabels] = useState<string[]>([...DEFAULT_BLUEPRINT_HEADER_LABELS]);
  const [activeHeaderCell, setActiveHeaderCell] = useState<{ row: number; col: number } | null>(null);
  const [deletedColumnKeys, setDeletedColumnKeys] = useState<string[]>([]);
  const deletedColumnKeysRef = useRef<string[]>([]);
  const updateDeletedColumns = (keys: string[]) => { deletedColumnKeysRef.current = keys; setDeletedColumnKeys(keys); };
  const visibleColumns = visibleBlueprintColumns(products, deletedColumnKeys);
  const isColumnDeleted = (index: number) => deletedColumnKeys.includes(blueprintColumnKey(index, products));
  const getSheetColumnLetter = (index: number) => getExcelColumnLetter(visibleColumns.indexOf(index));
  const [hiddenRowIds, setHiddenRowIds] = useState<string[]>([]);
  const [mergeHeaders, setMergeHeaders] = useState(true);
  const [freezeRows, setFreezeRows] = useState(0);
  const [freezeColumns, setFreezeColumns] = useState(0);
  const [freezeColumnInput, setFreezeColumnInput] = useState('0');
  const [freezeRowOffsets, setFreezeRowOffsets] = useState<Record<number, number>>({});
  const [freezeMenu, setFreezeMenu] = useState<{ x: number; y: number; kind: 'main' | 'row' | 'column'; index?: number; rowIds?: string[]; columnIndexes?: number[] } | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [allCellsHighlighted, setAllCellsHighlighted] = useState(false);
  const [lastSelectedRowId, setLastSelectedRowId] = useState<string | null>(null);

  // Column highlighting and multi-selection state
  const [selectedColumnNames, setSelectedColumnNames] = useState<Set<string>>(new Set());
  const [lastSelectedColumnName, setLastSelectedColumnName] = useState<string | null>(null);
  const [isMouseDownOnColHeader, setIsMouseDownOnColHeader] = useState(false);
  const [isMouseDownOnRowHeader, setIsMouseDownOnRowHeader] = useState(false);

  // Active cell editing state for seamless Excel / Google Sheets like experience
  const [activeCell, setActiveCell] = useState<{ rowId: string; colKey: string } | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ rowId: string; colIdx: number } | null>(null);
  const [selectedCellRange, setSelectedCellRange] = useState<{ anchorRowId: string; anchorColIdx: number; focusRowId: string; focusColIdx: number } | null>(null);
  const [pendingCellMove, setPendingCellMove] = useState<{ values: string[][]; bolds: boolean[][]; sourceRowIds: string[]; sourceCol: number; height: number; width: number } | null>(null);
  const pendingCellMoveRef = useRef<typeof pendingCellMove>(null);
  const clearPendingCellMove = () => { pendingCellMoveRef.current = null; setPendingCellMove(null); };
  const preserveCellRangeRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const undoStackRef = useRef<Array<{ rows: FacilityBlueprintRow[]; products: string[]; deletedColumnKeys: string[]; cellMerges: BlueprintCellMerge[] }>>([]);
  const redoStackRef = useRef<Array<{ rows: FacilityBlueprintRow[]; products: string[]; deletedColumnKeys: string[]; cellMerges: BlueprintCellMerge[] }>>([]);
  const historySnapshotRef = useRef<{ rows: FacilityBlueprintRow[]; products: string[]; deletedColumnKeys: string[]; cellMerges: BlueprintCellMerge[] } | null>(null);
  const restoringHistoryRef = useRef(false);
  const historyResetPendingRef = useRef(true);
  const historyCellGroupRef = useRef<{ key: string; at: number } | null>(null);
  const gridInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const cellEditOriginalRef = useRef<{ key: string; value: string } | null>(null);
  const isDraggingGridRangeRef = useRef(false);
  const draggedRowIdsRef = useRef<string[]>([]);
  const draggedProductRef = useRef<string | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const blueprintTableRef = useRef<HTMLTableElement | null>(null);
  const [gridScrollMetrics, setGridScrollMetrics] = useState({ clientWidth: 0, scrollWidth: 0, scrollLeft: 0, clientHeight: 0, scrollHeight: 0, scrollTop: 0 });

  const syncGridScrollMetrics = () => {
    const element = gridScrollRef.current;
    if (!element) return;
    setGridScrollMetrics({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop
    });
  };

  useEffect(() => {
    const element = gridScrollRef.current;
    if (!element) return;
    syncGridScrollMetrics();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncGridScrollMetrics);
    observer?.observe(element);
    if (element.firstElementChild instanceof HTMLElement) observer?.observe(element.firstElementChild);
    window.addEventListener('resize', syncGridScrollMetrics);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncGridScrollMetrics);
    };
  }, [rows.length, products.length, deletedColumnKeys]);

  // Undo history for deleted rows/columns
  const [deletedHistory, setDeletedHistory] = useState<{
    rows: FacilityBlueprintRow[];
    products: string[];
    description: string;
    deletedColumnKeys?: string[];
    cellMerges?: BlueprintCellMerge[];
  } | null>(null);

  // UI / Filter / Search states
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [activeBlueprintMenu, setActiveBlueprintMenu] = useState<string | null>(null);
  const blueprintControlsRef = useRef<HTMLElement | null>(null);
  const [formulaBarVisible, setFormulaBarVisible] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showBlueprintHelp, setShowBlueprintHelp] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'in_progress' | 'pending' | 'discrepancy'>('all');
  const [sortField, setSortField] = useState<'default' | 'facility' | 'processing'>('default');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    if (!activeBlueprintMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!blueprintControlsRef.current?.contains(event.target as Node)) setActiveBlueprintMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveBlueprintMenu(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [activeBlueprintMenu]);

  // Multi-District State
  const [districts, setDistricts] = useState<DistrictSheetData[]>([]);
  const [activeDistrictId, setActiveDistrictId] = useState<string>('west_mamprusi');
  const allocationWorksheet = isAllocationWorksheet(districts.find(sheet => sheet.id === activeDistrictId));
  const getSheetProgressStatus = allocationWorksheet ? getAllocationFacilityStatus : getBlueprintProgressStatus;
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
  const productInsertIndexRef = useRef<number | null>(null);
  const [productGroupWidths, setProductGroupWidths] = useState<Record<string, number>>({});
  const resizeProductRef = useRef<{ name: string; startX: number; startWidth: number } | null>(null);
  const [newColumnName, setNewColumnName] = useState('');
  const [editingProductNameFor, setEditingProductNameFor] = useState<string | null>(null);
  const [productNameDraft, setProductNameDraft] = useState('');
  const productRenameCanceledRef = useRef(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showClearColumnModal, setShowClearColumnModal] = useState(false);
  const [showDhdStockModal, setShowDhdStockModal] = useState(false);
  const [dhdStocks, setDhdStocks] = useState<Record<string, number>>({});
  const [dhdStockDraft, setDhdStockDraft] = useState<Record<string, string>>({});
  const [dhdHistory, setDhdHistory] = useState<DhdInventoryEntryUi[]>([]);
  const [dhdStockLoading, setDhdStockLoading] = useState(false);
  const [dhdStockSaving, setDhdStockSaving] = useState(false);
  const [dhdStockError, setDhdStockError] = useState<string | null>(null);
  const pendingDhdTopUpRef = useRef<{ key: string; rowId: string; vaccine: string; distributedAfter: number } | null>(null);
  const [selectedClearVaccine, setSelectedClearVaccine] = useState<string>('BCG');
  const [selectedClearSubCol, setSelectedClearSubCol] = useState<'all' | 'carryOver' | 'allocation' | 'distributed'>('all');
  const [selectedClearTargetType, setSelectedClearTargetType] = useState<'vaccine' | 'base' | 'bulk'>('vaccine');
  const [selectedClearBaseCol, setSelectedClearBaseCol] = useState<'facility' | 'subDistrict' | 'deliverySite' | 'processing' | 'completed'>('facility');
  const [selectedClearBulkCol, setSelectedClearBulkCol] = useState<'all_distributed' | 'all_allocation' | 'all_carry'>('all_distributed');
  const [isClearing, setIsClearing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [blueprintLoadError, setBlueprintLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

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

  useEffect(() => {
    let current = true;
    setDhdStockLoading(true);
    setDhdStockError(null);
    safeFetchJson<{ inventory: { stocks?: Record<string, number>; history?: DhdInventoryEntryUi[] } }>('/api/vaccine/dhd-inventory?district=' + encodeURIComponent(district))
      .then(data => {
        if (!current) return;
        setDhdStocks(data.inventory?.stocks || {});
        setDhdHistory(data.inventory?.history || []);
      })
      .catch(err => {
        if (!current) return;
        setDhdStockError(err instanceof Error ? err.message : 'Could not load DHD stock.');
      })
      .finally(() => { if (current) setDhdStockLoading(false); });
    return () => { current = false; };
  }, [district]);

  const loadBlueprintFromServer = async () => {
    setLoading(true);
    try {
      const data = await safeFetchJson<any>('/api/vaccine/blueprint-districts');
      if (data && Array.isArray(data.districts) && data.districts.length > 0) {
        setBlueprintLoadError(null);
        historyResetPendingRef.current = true;
        setDistricts(data.districts);
        const activeId = data.districts.some((sheet: DistrictSheetData) => sheet.id === preferredSheetId) ? preferredSheetId! : data.activeDistrictId || data.districts[0].id;
        setActiveDistrictId(activeId);
        const activeSheet = data.districts.find((d: DistrictSheetData) => d.id === activeId) || data.districts[0];
        setDistrict(activeSheet.district || 'West Mamprusi');
        setMonth(activeSheet.month || 'September 2026');
        setProducts(Array.isArray(activeSheet.products) ? activeSheet.products : [...DEFAULT_BLUEPRINT_PRODUCTS]);
        const sheetProducts = Array.isArray(activeSheet.products) ? activeSheet.products : [...DEFAULT_BLUEPRINT_PRODUCTS];
        setRows(normalizeBlueprintRowsProgress(activeSheet.rows || [], sheetProducts));
        setCellMerges(activeSheet.cellMerges || []);
        setHeaderLabels(activeSheet.headerLabels?.length === 20 ? activeSheet.headerLabels : [...DEFAULT_BLUEPRINT_HEADER_LABELS]);
        setActiveHeaderCell(null);
        updateDeletedColumns(activeSheet.deletedColumnKeys || []);
        setHiddenRowIds(activeSheet.hiddenRowIds || []);
        setMergeHeaders(activeSheet.mergeHeaders !== false);
        setFreezeRows(Math.max(0, Number(activeSheet.freezeRows) || 0));
        setFreezeColumns(Math.max(0, Number(activeSheet.freezeColumns) || 0));
        return;
      }
      setBlueprintLoadError(null);
      initializeDefaultRows();
    } catch (err) {
      const message = 'Could not load your saved Blueprint. Your data has not been cleared. Please retry.';
      setBlueprintLoadError(message);
      setSaveStatus(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchDistrict = (targetId: string) => {
    const target = districts.find(d => d.id === targetId);
    if (!target) return;
    historyResetPendingRef.current = true;
    setActiveDistrictId(targetId);
    setDistrict(target.district);
    setMonth(target.month);
    setProducts(Array.isArray(target.products) ? target.products : [...DEFAULT_BLUEPRINT_PRODUCTS]);
    setRows(normalizeBlueprintRowsProgress(target.rows || [], Array.isArray(target.products) ? target.products : [...DEFAULT_BLUEPRINT_PRODUCTS]));
    setCellMerges(target.cellMerges || []);
    setHeaderLabels(target.headerLabels?.length === 20 ? target.headerLabels : [...DEFAULT_BLUEPRINT_HEADER_LABELS]);
    setActiveHeaderCell(null);
    updateDeletedColumns(target.deletedColumnKeys || []);
    setHiddenRowIds(target.hiddenRowIds || []);
    setMergeHeaders(target.mergeHeaders !== false);
    setFreezeRows(Math.max(0, Number(target.freezeRows) || 0));
    setFreezeColumns(Math.max(0, Number(target.freezeColumns) || 0));
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
        setCellMerges(newlyCreated.cellMerges || []);
        setHeaderLabels(newlyCreated.headerLabels?.length === 20 ? newlyCreated.headerLabels : [...DEFAULT_BLUEPRINT_HEADER_LABELS]);
        setActiveHeaderCell(null);
        updateDeletedColumns(newlyCreated.deletedColumnKeys || []);
        setHiddenRowIds(newlyCreated.hiddenRowIds || []);
        setMergeHeaders(newlyCreated.mergeHeaders !== false);
        setFreezeRows(Math.max(0, Number(newlyCreated.freezeRows) || 0));
        setFreezeColumns(Math.max(0, Number(newlyCreated.freezeColumns) || 0));
        setShowAddDistrictModal(false);
        setNewDistrictName('');
        setSyncStatus(`Created sheet for "${newlyCreated.district}" with Sub-district, Delivery Site, and vaccine allocation columns & synced to Vaccine Checker!`);
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
      setSaveStatus('At least one district sheet must remain.');
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }
    const target = districts.find(d => d.id === distId);
    const name = target?.district || 'this district';

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
          setRows(normalizeBlueprintRowsProgress(nextActive.rows || [], Array.isArray(nextActive.products) ? nextActive.products : [...DEFAULT_BLUEPRINT_PRODUCTS]));
          setCellMerges(nextActive.cellMerges || []);
          setHeaderLabels(nextActive.headerLabels?.length === 20 ? nextActive.headerLabels : [...DEFAULT_BLUEPRINT_HEADER_LABELS]);
          setActiveHeaderCell(null);
          updateDeletedColumns(nextActive.deletedColumnKeys || []);
          setHiddenRowIds(nextActive.hiddenRowIds || []);
        setMergeHeaders(nextActive.mergeHeaders !== false);
          setFreezeRows(Math.max(0, Number(nextActive.freezeRows) || 0));
          setFreezeColumns(Math.max(0, Number(nextActive.freezeColumns) || 0));
        }
        setSyncStatus(`Deleted "${name}" and refreshed Vaccine Checker.`);
        setTimeout(() => setSyncStatus(null), 3500);
      }
    } catch (err) {
      console.error('Failed to delete district sheet:', err);
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
          setProducts(Array.isArray(data.district.products) ? data.district.products : [...DEFAULT_BLUEPRINT_PRODUCTS]);
          setRows(normalizeBlueprintRowsProgress(data.district.rows || [], Array.isArray(data.district.products) ? data.district.products : [...DEFAULT_BLUEPRINT_PRODUCTS]));
          setCellMerges(data.district.cellMerges || []);
          setHeaderLabels(data.district.headerLabels?.length === 20 ? data.district.headerLabels : [...DEFAULT_BLUEPRINT_HEADER_LABELS]);
          setActiveHeaderCell(null);
          updateDeletedColumns(data.district.deletedColumnKeys || []);
          setHiddenRowIds(data.district.hiddenRowIds || []);
        setMergeHeaders(data.district.mergeHeaders !== false);
          setFreezeRows(Math.max(0, Number(data.district.freezeRows) || 0));
          setFreezeColumns(Math.max(0, Number(data.district.freezeColumns) || 0));
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
      setSaveStatus(`Cannot delete the only allocation month for "${district}".`);
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }
    const target = districts.find(d => d.id === sheetId);
    const mName = target?.month || month;

    setLoading(true);
    try {
      const res = await authFetch(`/api/vaccine/blueprint-districts/${sheetId}`, {
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
          setRows(normalizeBlueprintRowsProgress(nextActive.rows || [], Array.isArray(nextActive.products) ? nextActive.products : [...DEFAULT_BLUEPRINT_PRODUCTS]));
          setCellMerges(nextActive.cellMerges || []);
          setHeaderLabels(nextActive.headerLabels?.length === 20 ? nextActive.headerLabels : [...DEFAULT_BLUEPRINT_HEADER_LABELS]);
          setActiveHeaderCell(null);
          updateDeletedColumns(nextActive.deletedColumnKeys || []);
          setHiddenRowIds(nextActive.hiddenRowIds || []);
        setMergeHeaders(nextActive.mergeHeaders !== false);
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
      const res = await authFetch('/api/vaccine/blueprint-districts/clear', {
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

        const blankRows: FacilityBlueprintRow[] = Array.from({ length: 20 }, (_, idx) => ({
          id: `bp_${activeDistrictId}_${idx + 1}`,
          processing: '',
          completed: '',
          facility: '',
          deliverySite: '',
          subDistrict: '',
          vaccines: {}
        }));

        if (scope === 'all') {
          setRows(blankRows);
          setSyncStatus('All allocation data across all blueprint districts cleared & synced!');
        } else {
          const updatedTarget = data.district || (data.districts && data.districts.find((d: any) => d.id === activeDistrictId));
          if (updatedTarget && Array.isArray(updatedTarget.rows)) {
            setRows(normalizeBlueprintRowsProgress(updatedTarget.rows, Array.isArray(updatedTarget.products) ? updatedTarget.products : [...DEFAULT_BLUEPRINT_PRODUCTS]));
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
        setSaveStatus('Failed to clear blueprint data. Please try again.');
        setTimeout(() => setSaveStatus(null), 3500);
      }
    } catch (err) {
      console.error('Error clearing blueprint data:', err);
      setSaveStatus('Network error while clearing blueprint data.');
      setTimeout(() => setSaveStatus(null), 3500);
    } finally {
      setIsClearing(false);
    }
  };

  const initializeDefaultRows = () => {
    historyResetPendingRef.current = true;
    setFreezeRows(0);
    setFreezeColumns(0);
    const initialRows: FacilityBlueprintRow[] = [];
    // Clean blank entry rows ready to receive new allocations
    for (let i = 1; i <= 20; i++) {
      initialRows.push({
        id: `bp_${i}`,
        processing: '',
        completed: '',
        facility: '',
        deliverySite: '',
        subDistrict: '',
        vaccines: {}
      });
    }

    setRows(initialRows);
    setCellMerges([]);
    setHeaderLabels([...DEFAULT_BLUEPRINT_HEADER_LABELS]);
    setActiveHeaderCell(null);
    updateDeletedColumns([]);
    setHiddenRowIds([]);
  };

  const getGridColumnLeft = (colIdx: number) => {
    const baseWidths = [140, 140, 230, 160, 200];
    return visibleColumns.filter(index => index < colIdx).reduce((sum, index) => {
      if (index < 5) return sum + baseWidths[index];
      const product = products[Math.floor((index - 5) / 4)];
      return sum + Math.max(50, (productGroupWidths[product] ?? 328) / 4);
    }, 0);
  };

  const getFreezeCellStyle = (colIdx: number, rowFrozen = false): React.CSSProperties => {
    const visibleIndex = visibleColumns.indexOf(colIdx);
    const columnFrozen = visibleIndex >= 0 && visibleIndex < freezeColumns;
    const atFrozenColumnEdge = columnFrozen && visibleIndex === freezeColumns - 1;
    return {
      display: isColumnDeleted(colIdx) ? 'none' : undefined,
      position: columnFrozen ? 'sticky' : 'static',
      left: columnFrozen ? `${getGridColumnLeft(colIdx)}px` : 'auto',
      zIndex: rowFrozen && columnFrozen ? 50 : rowFrozen ? 40 : columnFrozen ? 30 : 'auto',
      borderRight: atFrozenColumnEdge ? '2px solid #64748b' : undefined
    };
  };

  const openFreezeMenu = (event: React.MouseEvent, kind: 'main' | 'row' | 'column', index?: number, columnGroup?: number[]) => {
    event.preventDefault();
    event.stopPropagation();
    setFreezeColumnInput(String(freezeColumns));
    const row = kind === 'row' && index !== undefined && index >= 5 ? filteredAndSortedRows[index - 5] : undefined;
    const rowIds = row ? selectedRowIds.has(row.id) ? Array.from(selectedRowIds) : [row.id] : [];
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-grid-cell-col]');
    const columnIndex = kind === 'column' ? index : cell ? Number(cell.dataset.gridCellCol) : undefined;
    const columnIndexes = columnIndex !== undefined && Number.isInteger(columnIndex) ? getColumnDeletionTargets(columnIndex, columnGroup) : [];
    setFreezeMenu({ x: event.clientX, y: event.clientY, kind, index, rowIds, columnIndexes });
  };

  const getCurrentSheetRow = () => {
    if (!focusedCell) return null;
    const dataRowIndex = filteredAndSortedRows.findIndex(row => row.id === focusedCell.rowId);
    return dataRowIndex < 0 ? null : dataRowIndex + 5; // Four header rows precede facility row 5.
  };

  const persistFreezeSettings = async (nextRows: number, nextColumns: number) => {
    const safeRows = Math.max(0, Math.min(4 + filteredAndSortedRows.length, Math.floor(nextRows)));
    const safeColumns = Math.max(0, Math.min(visibleColumns.length, Math.floor(nextColumns)));
    setFreezeRows(safeRows);
    setFreezeColumns(safeColumns);
    setFreezeMenu(null);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await persistBlueprintToServer(rows, products, district, month, cellMerges, safeRows, safeColumns);
  };

  const getFocusedCellInfo = () => {
    if (activeHeaderCell) {
      const index = (activeHeaderCell.row - 1) * 5 + activeHeaderCell.col;
      return {
        reference: `${getSheetColumnLetter(activeHeaderCell.col)}${activeHeaderCell.row}`,
        value: headerLabels[index] ?? '',
        headerCell: activeHeaderCell,
        readOnly: false
      };
    }
    if (!focusedCell) return null;
    const row = rows.find(item => item.id === focusedCell.rowId);
    const visibleIndex = filteredAndSortedRows.findIndex(item => item.id === focusedCell.rowId);
    if (!row || visibleIndex < 0) return null;
    const colIdx = focusedCell.colIdx;
    if (colIdx < 5) {
      const fields = ['processing', 'completed', 'facility', 'subDistrict', 'deliverySite'] as const;
      const field = fields[colIdx];
      return { reference: `${getSheetColumnLetter(colIdx)}${visibleIndex + 5}`, value: String(row[field] ?? ''), rowId: row.id, field, readOnly: false };
    }
    const productIndex = Math.floor((colIdx - 5) / 4);
    const subcolumn = (colIdx - 5) % 4;
    const product = products[productIndex];
    if (!product) return null;
    const subfields = ['carryOver', 'allocation', 'distributed'] as const;
    if (subcolumn === 3) {
      return { reference: `${getSheetColumnLetter(colIdx)}${visibleIndex + 5}`, value: String(row.vaccines[product]?.balance ?? ''), rowId: row.id, field: null, product, readOnly: true };
    }
    const field = { vaccine: product, subCol: subfields[subcolumn] };
    return { reference: `${getSheetColumnLetter(colIdx)}${visibleIndex + 5}`, value: String(row.vaccines[product]?.[field.subCol] ?? ''), rowId: row.id, field, readOnly: false };
  };
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistBlueprintToServer = async (
    currentRows: FacilityBlueprintRow[],
    currentProducts: string[],
    currentDistrict: string,
    currentMonth: string,
    currentMerges = cellMerges,
    currentFreezeRows = freezeRows,
    currentFreezeColumns = freezeColumns,
    currentHeaderLabels = headerLabels,
    currentHiddenRowIds = hiddenRowIds,
    currentMergeHeaders = mergeHeaders,
    currentDeletedColumnKeys = deletedColumnKeysRef.current
  ): Promise<boolean> => {
    const updatedSheet: DistrictSheetData = {
      ...districts.find(sheet => sheet.id === activeDistrictId),
      worksheetRole: isAllocationWorksheet(districts.find(sheet => sheet.id === activeDistrictId)) ? 'allocation' : 'other',
      id: activeDistrictId,
      district: currentDistrict,
      month: currentMonth,
      products: currentProducts,
      rows: deleteBlueprintColumnData(currentRows, currentProducts, Array.from({ length: 5 + currentProducts.length * 4 }, (_, index) => index).filter(index => currentDeletedColumnKeys.includes(blueprintColumnKey(index, currentProducts)))),
      cellMerges: currentMerges,
      headerLabels: currentHeaderLabels,
      hiddenRowIds: currentHiddenRowIds,
      deletedColumnKeys: currentDeletedColumnKeys,
      mergeHeaders: currentMergeHeaders,
      freezeRows: currentFreezeRows,
      freezeColumns: currentFreezeColumns,
      updatedAt: new Date().toISOString()
    };
    const editsToFlush = [...pendingEditsRef.current];
    pendingEditsRef.current = [];
    try {
      const data = await safeFetchJson<{ districts?: DistrictSheetData[] }>('/api/vaccine/blueprint-districts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ district: updatedSheet, activeId: activeDistrictId, user: currentUser, cellEdits: editsToFlush })
      });
      if (data && Array.isArray(data.districts)) setDistricts(data.districts);
      setHasUnsavedChanges(false);
      setSaveStatus('Saved successfully');
      setTimeout(() => setSaveStatus(null), 2500);
      return true;
    } catch (err) {
      pendingEditsRef.current = [...editsToFlush, ...pendingEditsRef.current];
      const message = err instanceof Error ? err.message : 'Check your connection and try again.';
      setHasUnsavedChanges(true);
      setSaveStatus(`Save failed: ${message}`);
      return false;
    }
  };

  // Auto-save through the existing Blueprint API, with a manual flush available in the toolbar.
  const debouncedSaveBlueprint = (
    currentRows = rows,
    currentProducts = products,
    currentDistrict = district,
    currentMonth = month,
    currentMerges = cellMerges,
    currentHeaderLabels = headerLabels,
    currentHiddenRowIds = hiddenRowIds,
    currentMergeHeaders = mergeHeaders,
    currentDeletedColumnKeys = deletedColumnKeysRef.current
  ) => {
    setHasUnsavedChanges(true);
    setSaveStatus('Saving...');
    setDistricts(prev => prev.map(d => d.id === activeDistrictId
      ? { ...d, district: currentDistrict, month: currentMonth, products: currentProducts, rows: currentRows, cellMerges: currentMerges, headerLabels: currentHeaderLabels, hiddenRowIds: currentHiddenRowIds, deletedColumnKeys: currentDeletedColumnKeys, mergeHeaders: currentMergeHeaders, updatedAt: new Date().toISOString() }
      : d));
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persistBlueprintToServer(currentRows, currentProducts, currentDistrict, currentMonth, currentMerges, freezeRows, freezeColumns, currentHeaderLabels, currentHiddenRowIds, currentMergeHeaders, currentDeletedColumnKeys);
    }, 500);
  };

  const saveBlueprintToServer = debouncedSaveBlueprint;
  const handleHeaderLabelChange = (row: number, col: number, value: string) => {
    const index = (row - 1) * 5 + col;
    const nextLabels = [...headerLabels];
    nextLabels[index] = value;
    setHeaderLabels(nextLabels);
    saveBlueprintToServer(rows, products, district, month, cellMerges, nextLabels);
  };
  const handleHideSelectedRows = () => {
    if (!selectedRowIds.size) return;
    const nextHidden = Array.from(new Set([...hiddenRowIds, ...Array.from(selectedRowIds)]));
    setHiddenRowIds(nextHidden);
    setSelectedRowIds(new Set());
    saveBlueprintToServer(rows, products, district, month, cellMerges, headerLabels, nextHidden);
    setSaveStatus(`Hid ${nextHidden.length - hiddenRowIds.length} row${nextHidden.length - hiddenRowIds.length === 1 ? '' : 's'}; their data is preserved.`);
  };
  const handleUnhideAllRows = () => {
    if (!hiddenRowIds.length) return;
    setHiddenRowIds([]);
    saveBlueprintToServer(rows, products, district, month, cellMerges, headerLabels, []);
    setSaveStatus('All hidden rows are visible again.');
  };
  const handleSetHeaderMerges = (enabled: boolean) => {
    setMergeHeaders(enabled);
    saveBlueprintToServer(rows, products, district, month, cellMerges, headerLabels, hiddenRowIds, enabled);
    setSaveStatus(enabled ? 'Header cells merged.' : 'Header cells unmerged.');
  };
  const headerLabelInput = (row: number, col: number, fallback: string, className = '') => {
    const index = (row - 1) * 5 + col;
    return (
      <div className="flex min-w-0 items-center gap-1">
      <input
        aria-label={`Header cell ${getSheetColumnLetter(col)}${row}`}
        value={row === 1 && /^Col [A-Z]+$/.test(headerLabels[index] ?? fallback) ? `Col ${getSheetColumnLetter(col)}` : headerLabels[index] ?? fallback}
        onFocus={() => {
          setActiveHeaderCell({ row, col });
          setFocusedCell(null);
          if (!isDraggingGridRangeRef.current && !preserveCellRangeRef.current) setSelectedCellRange(null);
        }}
        onChange={event => handleHeaderLabelChange(row, col, event.target.value)}
        onKeyDown={event => event.stopPropagation()}
        className={`w-full min-w-0 bg-transparent text-inherit text-center font-inherit uppercase outline-none ${className}`}
        title={`Edit ${getSheetColumnLetter(col)}${row}`}
      />
      </div>
    );
  };
  const handleSaveChanges = async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaveStatus('Saving...');
    await persistBlueprintToServer(rows, products, district, month, cellMerges);
  };

  const liveSheetRef = useRef({ activeDistrictId, hasUnsavedChanges, rows, districts });
  liveSheetRef.current = { activeDistrictId, hasUnsavedChanges, rows, districts };
  useEffect(() => {
    if (loading || hasUnsavedChanges) return;
    let canceled = false;
    let fetching = false;
    const refreshSavedAllocation = async () => {
      if (fetching || document.hidden) return;
      fetching = true;
      try {
        const data = await safeFetchJson<{ districts?: DistrictSheetData[] }>('/api/vaccine/blueprint-districts');
        const current = liveSheetRef.current;
        if (canceled || current.activeDistrictId !== activeDistrictId || current.hasUnsavedChanges || saveTimerRef.current) return;
        const incoming = data.districts?.find(sheet => sheet.id === activeDistrictId);
        const saved = current.districts.find(sheet => sheet.id === activeDistrictId);
        if (!incoming || incoming.updatedAt === saved?.updatedAt) return;
        const nextProducts = incoming.products || [...DEFAULT_BLUEPRINT_PRODUCTS];
        historyResetPendingRef.current = true;
        setDistricts(data.districts!);
        setProducts(nextProducts);
        setRows(normalizeBlueprintRowsProgress(incoming.rows || [], nextProducts));
      } catch {
        // Retain the visible sheet during a temporary connection failure.
      } finally { fetching = false; }
    };
    const timer = setInterval(refreshSavedAllocation, 3000);
    window.addEventListener('focus', refreshSavedAllocation);
    void refreshSavedAllocation();
    return () => { canceled = true; clearInterval(timer); window.removeEventListener('focus', refreshSavedAllocation); };
  }, [activeDistrictId, hasUnsavedChanges, loading]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges]);

  // Evaluate numeric input from spreadsheet cells, supporting direct numbers, expressions (e.g. 20+10, =15+5), and incremental additions (+10)
  const evaluateCellNumericInput = (raw: string, currentVal?: number | string): number | null => {
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

  const requestDhdTopUp = async (rowId: string, vaccine: string, quantity: number, distributedAfter: number) => {
    const row = rows.find(item => item.id === rowId);
    if (!row) return;
    const available = Number(dhdStocks[vaccine]) || 0;
    if (available < quantity) {
      setSaveStatus('DHD stock has ' + available + ' ' + vaccine + '; ' + quantity + ' is required for ' + row.facility + '. Update the stock count first.');
      setDhdStockDraft(Object.fromEntries(products.map(product => [product, String(dhdStocks[product] ?? '')])));
      setShowDhdStockModal(true);
      return;
    }
    const confirmed = window.confirm(
      row.facility + ' has exceeded its ' + vaccine + ' allocation by ' + quantity +
      '. Deduct ' + quantity + ' ' + vaccine + ' from ' + district +
      ' DHD stock and add it to this facility?\n\nDHD stock: ' + available + ' → ' +
      (available - quantity) + '\nFacility distributed total: ' + distributedAfter
    );
    if (!confirmed) {
      setSaveStatus('Top-up canceled. The distributed quantity was not changed.');
      return;
    }
    const currentPending = pendingDhdTopUpRef.current;
    const key = currentPending && currentPending.rowId === rowId && currentPending.vaccine === vaccine && currentPending.distributedAfter === distributedAfter
      ? currentPending.key
      : (globalThis.crypto?.randomUUID?.() || 'dhd_' + Date.now() + '_' + Math.random().toString(36).slice(2));
    pendingDhdTopUpRef.current = { key, rowId, vaccine, distributedAfter };
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaveStatus('Confirming DHD stock deduction...');
    try {
      const result = await safeFetchJson<{ inventory: { stocks: Record<string, number>; history: DhdInventoryEntryUi[] }; districtSheet: DistrictSheetData; districts: DistrictSheetData[] }>('/api/vaccine/blueprint-districts/' + encodeURIComponent(activeDistrictId) + '/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId, vaccine, quantity, distributedAfter, requestId: key, user: currentUser })
      });
      const sheet = result.districtSheet;
      const sheetProducts = Array.isArray(sheet.products) ? sheet.products : products;
      const nextRows = normalizeBlueprintRowsProgress(sheet.rows || [], sheetProducts);
      setRows(nextRows);
      setProducts(sheetProducts);
      setDistricts(result.districts || []);
      setDhdStocks(result.inventory.stocks || {});
      setDhdHistory(result.inventory.history || []);
      setHasUnsavedChanges(false);
      pendingDhdTopUpRef.current = null;
      setSaveStatus('DHD stock deducted: ' + row.facility + ' received ' + quantity + ' ' + vaccine + '.');
      setTimeout(() => setSaveStatus(null), 5000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not complete the DHD top-up.';
      setSaveStatus('DHD top-up failed: ' + message);
    }
  };

  const saveDhdStocks = async () => {
    const parsed: Record<string, number> = {};
    for (const product of products) {
      const raw = dhdStockDraft[product] ?? '';
      const value = raw.trim() === '' ? 0 : Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(value) || value < 0) {
        setDhdStockError('Enter a valid non-negative DHD stock quantity for ' + product + '.');
        return;
      }
      parsed[product] = value;
    }
    setDhdStockSaving(true);
    setDhdStockError(null);
    try {
      const requestId = globalThis.crypto?.randomUUID?.() || 'dhd_stock_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const result = await safeFetchJson<{ inventory: { stocks: Record<string, number>; history: DhdInventoryEntryUi[] } }>('/api/vaccine/dhd-inventory/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ district, stocks: parsed, requestId, user: currentUser })
      });
      setDhdStocks(result.inventory.stocks || {});
      setDhdHistory(result.inventory.history || []);
      setShowDhdStockModal(false);
      setSaveStatus('DHD stock counts saved.');
      setTimeout(() => setSaveStatus(null), 3500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save DHD stock.';
      setDhdStockError(message);
    } finally {
      setDhdStockSaving(false);
    }
  };

  // Direct cell update handler
  const handleCellChange = (
    rowId: string,
    field: 'processing' | 'completed' | 'facility' | 'deliverySite' | 'subDistrict' | { vaccine: string; subCol: 'carryOver' | 'allocation' | 'distributed' },
    value: string
  ) => {
    if (typeof field !== 'string' && value.trim() !== '') {
      const source = rows.find(row => row.id === rowId)?.vaccines[field.vaccine]?.[field.subCol];
      const evaluated = evaluateCellNumericInput(value, typeof source === 'number' ? source : '');
      if (evaluated === null) {
        setSaveStatus('Invalid quantity. Enter a number or a simple arithmetic expression.');
        return;
      }
      if (field.subCol === 'distributed') {
        const row = rows.find(item => item.id === rowId);
        const current = row?.vaccines[field.vaccine] || {};
        const authorized = (Number(current.carryOver) || 0) + (Number(current.allocation) || 0);
        const overage = evaluated - authorized;
        if (row && overage > 0) {
          void requestDhdTopUp(rowId, field.vaccine, overage, evaluated);
          return;
        }
      }
    }
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
  const parseTsv = (tsvText: string): string[][] => parseClipboardTsv(tsvText);

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
    const isFacilityAndSitePlusAllocations =
      startColIdx === 2 && values.length === 2 + productList.length;
    const isFullDatesAndSitePlusAllocations =
      startColIdx === 0 && values.length === 4 + productList.length;
    const isFullDatesSubDistrictAndSitePlusAllocations =
      startColIdx === 0 && values.length === 5 + productList.length;
    const isFacilitySubDistrictAndSitePlusAllocations =
      startColIdx === 2 && values.length === 3 + productList.length;

    // Pattern C: 1 facility column + 3 subcols per vaccine (49 cols) pasted at Col C (idx 2)
    const isFacilityPlus3PerVaccine =
      startColIdx === 2 && values.length === 1 + productList.length * 3;

    // Pattern D: 3 columns + 3 subcols per vaccine (51 cols) pasted at Col A (idx 0)
    const isFullPlus3PerVaccine =
      startColIdx === 0 && values.length === 3 + productList.length * 3;
    const isFacilityAndSitePlus3PerVaccine =
      startColIdx === 2 && values.length === 2 + productList.length * 3;
    const isFullDatesAndSitePlus3PerVaccine =
      startColIdx === 0 && values.length === 4 + productList.length * 3;
    const isFullDatesSubDistrictAndSitePlus3PerVaccine =
      startColIdx === 0 && values.length === 5 + productList.length * 3;
    const isFacilitySubDistrictAndSitePlus3PerVaccine =
      startColIdx === 2 && values.length === 3 + productList.length * 3;

    if (!deletedColumnKeys.length && (isFacilityPlusAllocations)) {
      const facName = values[0];
      if (facName) updatedRow.facility = facName;
      productList.forEach((pName, pIdx) => {
        const valStr = values[1 + pIdx]?.trim() || '';
        const numVal = valStr !== '' && !isNaN(Number(valStr.replace(/,/g, ''))) ? Number(valStr.replace(/,/g, '')) : '';
        const prev = updatedRow.vaccines[pName] || {};
        const vData: VaccineSectionData = {
          carryOver: prev.carryOver || '',
          allocation: numVal,
          distributed: prev.distributed || '',
          balance: computeBalance(prev.carryOver, numVal, prev.distributed)
        };
        updatedRow.vaccines[pName] = vData;
      });
    } else if (!deletedColumnKeys.length && (isFullDatesPlusAllocations)) {
      if (values[0]) updatedRow.processing = values[0];
      if (values[1]) updatedRow.completed = values[1];
      if (values[2]) updatedRow.facility = values[2];
      productList.forEach((pName, pIdx) => {
        const valStr = values[3 + pIdx]?.trim() || '';
        const numVal = valStr !== '' && !isNaN(Number(valStr.replace(/,/g, ''))) ? Number(valStr.replace(/,/g, '')) : '';
        const prev = updatedRow.vaccines[pName] || {};
        const vData: VaccineSectionData = {
          carryOver: prev.carryOver || '',
          allocation: numVal,
          distributed: prev.distributed || '',
          balance: computeBalance(prev.carryOver, numVal, prev.distributed)
        };
        updatedRow.vaccines[pName] = vData;
      });
    } else if (!deletedColumnKeys.length && (isFullDatesSubDistrictAndSitePlusAllocations || isFacilitySubDistrictAndSitePlusAllocations)) {
      const full = isFullDatesSubDistrictAndSitePlusAllocations;
      const prefix = full ? 5 : 3;
      if (full) {
        updatedRow.processing = values[0] || '';
        updatedRow.completed = values[1] || '';
        updatedRow.facility = values[2] || '';
        updatedRow.subDistrict = values[3] || '';
        updatedRow.deliverySite = values[4] || '';
      } else {
        updatedRow.facility = values[0] || '';
        updatedRow.subDistrict = values[1] || '';
        updatedRow.deliverySite = values[2] || '';
      }
      productList.forEach((pName, pIdx) => {
        const raw = values[prefix + pIdx]?.trim() || '';
        const allocation = raw && Number.isFinite(Number(raw.replace(/,/g, ''))) ? Number(raw.replace(/,/g, '')) : '';
        const previous = updatedRow.vaccines[pName] || {};
        updatedRow.vaccines[pName] = { carryOver: previous.carryOver || '', allocation, distributed: previous.distributed || '', balance: computeBalance(previous.carryOver, allocation, previous.distributed) };
      });
    } else if (!deletedColumnKeys.length && (isFacilityAndSitePlusAllocations || isFullDatesAndSitePlusAllocations)) {
      const prefix = isFullDatesAndSitePlusAllocations ? 4 : 2;
      if (prefix === 4) {
        if (values[0]) updatedRow.processing = values[0];
        if (values[1]) updatedRow.completed = values[1];
        if (values[2]) updatedRow.facility = values[2];
      } else if (values[0]) {
        updatedRow.facility = values[0];
      }
      updatedRow.deliverySite = values[prefix - 1] || '';
      productList.forEach((pName, pIdx) => {
        const valStr = values[prefix + pIdx]?.trim() || '';
        const numVal = valStr !== '' && !isNaN(Number(valStr.replace(/,/g, ''))) ? Number(valStr.replace(/,/g, '')) : '';
        const prev = updatedRow.vaccines[pName] || {};
        updatedRow.vaccines[pName] = {
          carryOver: prev.carryOver || '',
          allocation: numVal,
          distributed: prev.distributed || '',
          balance: computeBalance(prev.carryOver, numVal, prev.distributed)
        };
      });
    } else if (!deletedColumnKeys.length && (isFullDatesSubDistrictAndSitePlus3PerVaccine || isFacilitySubDistrictAndSitePlus3PerVaccine)) {
      const full = isFullDatesSubDistrictAndSitePlus3PerVaccine;
      const prefix = full ? 5 : 3;
      if (full) {
        updatedRow.processing = values[0] || '';
        updatedRow.completed = values[1] || '';
        updatedRow.facility = values[2] || '';
        updatedRow.subDistrict = values[3] || '';
        updatedRow.deliverySite = values[4] || '';
      } else {
        updatedRow.facility = values[0] || '';
        updatedRow.subDistrict = values[1] || '';
        updatedRow.deliverySite = values[2] || '';
      }
      productList.forEach((pName, pIdx) => {
        const quantities = [0, 1, 2].map(offset => {
          const raw = values[prefix + pIdx * 3 + offset]?.trim().replace(/,/g, '') || '';
          return raw && Number.isFinite(Number(raw)) ? Number(raw) : '';
        });
        updatedRow.vaccines[pName] = { carryOver: quantities[0], allocation: quantities[1], distributed: quantities[2], balance: computeBalance(quantities[0], quantities[1], quantities[2]) };
      });
    } else if (!deletedColumnKeys.length && (isFacilityAndSitePlus3PerVaccine || isFullDatesAndSitePlus3PerVaccine)) {
      const prefix = isFullDatesAndSitePlus3PerVaccine ? 4 : 2;
      if (prefix === 4) {
        if (values[0]) updatedRow.processing = values[0];
        if (values[1]) updatedRow.completed = values[1];
        if (values[2]) updatedRow.facility = values[2];
      } else if (values[0]) {
        updatedRow.facility = values[0];
      }
      updatedRow.deliverySite = values[prefix - 1] || '';
      productList.forEach((pName, pIdx) => {
        const cStr = values[prefix + pIdx * 3]?.trim() || '';
        const aStr = values[prefix + pIdx * 3 + 1]?.trim() || '';
        const dStr = values[prefix + pIdx * 3 + 2]?.trim() || '';
        const cNum = cStr !== '' && !isNaN(Number(cStr.replace(/,/g, ''))) ? Number(cStr.replace(/,/g, '')) : '';
        const aNum = aStr !== '' && !isNaN(Number(aStr.replace(/,/g, ''))) ? Number(aStr.replace(/,/g, '')) : '';
        const dNum = dStr !== '' && !isNaN(Number(dStr.replace(/,/g, ''))) ? Number(dStr.replace(/,/g, '')) : '';
        updatedRow.vaccines[pName] = { carryOver: cNum, allocation: aNum, distributed: dNum, balance: computeBalance(cNum, aNum, dNum) };
      });
    } else if (!deletedColumnKeys.length && (isFacilityPlus3PerVaccine)) {
      if (values[0]) updatedRow.facility = values[0];
      productList.forEach((pName, pIdx) => {
        const cStr = values[1 + pIdx * 3]?.trim() || '';
        const aStr = values[1 + pIdx * 3 + 1]?.trim() || '';
        const dStr = values[1 + pIdx * 3 + 2]?.trim() || '';
        const cNum = cStr !== '' && !isNaN(Number(cStr.replace(/,/g, ''))) ? Number(cStr.replace(/,/g, '')) : '';
        const aNum = aStr !== '' && !isNaN(Number(aStr.replace(/,/g, ''))) ? Number(aStr.replace(/,/g, '')) : '';
        const dNum = dStr !== '' && !isNaN(Number(dStr.replace(/,/g, ''))) ? Number(dStr.replace(/,/g, '')) : '';
        updatedRow.vaccines[pName] = {
          carryOver: cNum,
          allocation: aNum,
          distributed: dNum,
          balance: computeBalance(cNum, aNum, dNum)
        };
      });
    } else if (!deletedColumnKeys.length && (isFullPlus3PerVaccine)) {
      if (values[0]) updatedRow.processing = values[0];
      if (values[1]) updatedRow.completed = values[1];
      if (values[2]) updatedRow.facility = values[2];
      productList.forEach((pName, pIdx) => {
        const cStr = values[3 + pIdx * 3]?.trim() || '';
        const aStr = values[3 + pIdx * 3 + 1]?.trim() || '';
        const dStr = values[3 + pIdx * 3 + 2]?.trim() || '';
        const cNum = cStr !== '' && !isNaN(Number(cStr.replace(/,/g, ''))) ? Number(cStr.replace(/,/g, '')) : '';
        const aNum = aStr !== '' && !isNaN(Number(aStr.replace(/,/g, ''))) ? Number(aStr.replace(/,/g, '')) : '';
        const dNum = dStr !== '' && !isNaN(Number(dStr.replace(/,/g, ''))) ? Number(dStr.replace(/,/g, '')) : '';
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
        const colIdx = deletedColumnKeys.length ? visibleColumns[visibleColumns.indexOf(startColIdx) + offset] : startColIdx + offset;
        const val = rawVal.trim();

        if (colIdx === 0) {
          updatedRow.processing = val;
        } else if (colIdx === 1) {
          updatedRow.completed = val;
        } else if (colIdx === 2) {
          updatedRow.facility = val;
        } else if (colIdx === 3) {
          updatedRow.subDistrict = val;
        } else if (colIdx === 4) {
          updatedRow.deliverySite = val;
        } else if (colIdx >= 5) {
          const vaccineColOffset = colIdx - 5;
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
            if (val !== '' && !isNaN(Number(val.replace(/,/g, '')))) {
              numVal = Number(val.replace(/,/g, ''));
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

  const applyHeaderMappedPaste = (sourceRows: string[][], startRowId: string): boolean => {
    const normalize = (value: string) => value.toLowerCase().replace(/\b(vaccines?|vials?)\b/g, '').replace(/[^a-z0-9]+/g, '').trim();
    const aliases: Record<string, string> = { bopv: 'opv', oralpolio: 'opv', oralpoliovaccine: 'opv', measlesrubella: 'mr', yellowfever: 'yf', rotavirus: 'rota', meningococcal: 'mena' };
    const canonical = (value: string) => aliases[normalize(value)] || normalize(value);
    const headerIndex = sourceRows.slice(0, 8).findIndex(row => row.some(cell => ['facility', 'facilityname'].includes(normalize(cell))) && row.filter(Boolean).length > 1);
    if (headerIndex < 0) return false;
    const header = sourceRows[headerIndex];
    const facilityCol = header.findIndex(cell => ['facility', 'facilityname'].includes(normalize(cell)));
    if (facilityCol < 0) return false;
    const mappings: Array<{ index: number; field: 'processing' | 'completed' | 'facility' | 'deliverySite' | 'subDistrict' | 'comment' | 'carryOver' | 'allocation' | 'distributed' | 'balance'; product?: string }> = [];
    header.forEach((cell, index) => {
      const label = normalize(cell);
      if (index === facilityCol) { mappings.push({ index, field: 'facility' }); return; }
      if (['processing', 'processingdate', 'startdate', 'started'].includes(label)) { mappings.push({ index, field: 'processing' }); return; }
      if (['completed', 'completeddate', 'completiondate'].includes(label)) { mappings.push({ index, field: 'completed' }); return; }
      if (['deliverysite', 'deliverypoint'].includes(label)) { mappings.push({ index, field: 'deliverySite' }); return; }
      if (['subdistrict', 'subcounty'].includes(label)) { mappings.push({ index, field: 'subDistrict' }); return; }
      if (['note', 'notes', 'comment', 'comments'].includes(label)) { mappings.push({ index, field: 'comment' }); return; }
      const suffix = cell.match(/\b(carry[- ]?over|allocation|distributed|balance)\s*$/i)?.[1] || '';
      const productLabel = suffix ? cell.replace(/\b(carry[- ]?over|allocation|distributed|balance)\s*$/i, '').trim() : cell;
      const product = products.find(name => canonical(name) === canonical(productLabel));
      if (product) {
        const quantityField = !suffix ? 'allocation' : canonical(suffix) === 'carryover' ? 'carryOver' : canonical(suffix) as 'allocation' | 'distributed' | 'balance';
        mappings.push({ index, product, field: quantityField });
      }
    });
    const productMappings = mappings.filter(mapping => mapping.product);
    if (!productMappings.length) return false;
    const unknownHeaders = header.map((cell, index) => ({ cell, index })).filter(({ cell, index }) => cell && index !== facilityCol && !mappings.some(mapping => mapping.index === index));
    if (unknownHeaders.length) {
      setSaveStatus(`Paste canceled: unrecognized column “${unknownHeaders[0].cell}”. Rename it to a Blueprint field or product.`);
      return true;
    }
    const dataRows = sourceRows.slice(headerIndex + 1);
    if (!dataRows.some(row => row.some(Boolean))) {
      setSaveStatus('Paste canceled: the header row has no data beneath it.');
      return true;
    }
    const startIndex = Math.max(0, rows.findIndex(row => row.id === startRowId));
    const updated = [...rows];
    const importedEdits: Array<Record<string, unknown>> = [];
    const today = new Date().toISOString().slice(0, 10);
    for (let offset = 0; offset < dataRows.length; offset++) {
      const cells = dataRows[offset];
      if (!cells.some(Boolean)) continue;
      const targetIndex = startIndex + offset;
      const current = updated[targetIndex] || makeBlankBlueprintRow(`bp_paste_${Date.now()}_${offset}`);
      const vaccines = Object.fromEntries(Object.entries(current.vaccines || {}).map(([name, value]) => [name, value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {}])) as FacilityBlueprintRow['vaccines'];
      const next: FacilityBlueprintRow = { ...current, vaccines };
      for (const mapping of mappings) {
        const raw = cells[mapping.index] ?? '';
        if (mapping.field === 'facility' || mapping.field === 'processing' || mapping.field === 'completed' || mapping.field === 'deliverySite' || mapping.field === 'subDistrict' || mapping.field === 'comment') {
          const key = mapping.field;
          const oldValue = String(next[key] ?? '');
          if (oldValue !== raw) importedEdits.push({ facility: next.facility || raw, field: key, oldValue, newValue: raw, district, month, timestamp: new Date().toISOString() });
          next[key] = raw;
        } else if (mapping.product) {
          if (mapping.field === 'balance') continue; // Balance is always recalculated from editable quantities.
          const value = raw.trim().replace(/,/g, '').replace(/^\((.*)\)$/, '-$1');
          const number = value === '' ? '' : Number(value);
          if (value !== '' && !Number.isFinite(number)) {
            setSaveStatus(`Paste canceled: “${raw}” in row ${headerIndex + offset + 2} is not a valid quantity. Nothing was changed.`);
            return true;
          }
          const prior = vaccines[mapping.product] || {};
          const oldValue = prior[mapping.field] ?? '';
          if (oldValue !== number) importedEdits.push({ facility: next.facility || 'Facility Row', field: mapping.field, product: mapping.product, oldValue, newValue: number, district, month, timestamp: new Date().toISOString() });
          vaccines[mapping.product] = { ...prior, [mapping.field]: number };
        }
      }
      for (const mapping of productMappings) {
        const prior = vaccines[mapping.product!];
        if (prior) prior.balance = computeBalance(prior.carryOver, prior.allocation, prior.distributed);
      }
      if (!next.facility.trim() && productMappings.some(mapping => Boolean(cells[mapping.index]?.trim()))) {
        setSaveStatus(`Paste canceled: data on row ${headerIndex + offset + 2} has no facility name. Nothing was changed.`);
        return true;
      }
      updated[targetIndex] = normalizeFacilityProgress(next, products, today);
    }
    pendingEditsRef.current.push(...importedEdits);
    setRows(updated);
    saveBlueprintToServer(updated, products, district, month);
    setSaveStatus(`Pasted ${dataRows.filter(row => row.some(Boolean)).length} rows by matching spreadsheet headers.`);
    return true;
  };

  // In-line paste handler for table inputs: pastes Excel / Google Sheets blocks seamlessly across rows and columns
  const handleDirectCellPasteRaw = (pasteData: string, startRowId: string, colIdx: number) => {
    if (!pasteData || (!pasteData.includes('\t') && !pasteData.includes('\n'))) {
      return;
    }

    const tsvRows = parseTsv(pasteData);
    if (tsvRows.length === 0) return;
    if (applyHeaderMappedPaste(tsvRows, startRowId)) return;

    // Drop the complete multi-row Blueprint header, not just the first row.
    const effectiveRows = stripBlueprintHeaderRows(tsvRows);
    if (effectiveRows.length === 0) return;

    if (effectiveRows.length !== tsvRows.length) {
      const parsed = parseBlueprintPaste(pasteData, products, 'auto');
      if (parsed.errors.length) {
        setSaveStatus(parsed.errors[0]);
        return;
      }
      setRows(prevRows => {
        const startIndex = Math.max(0, prevRows.findIndex(row => row.id === startRowId));
        const nextRows = [...prevRows];
        parsed.rows.forEach((pasteRow, offset) => {
          const targetIndex = startIndex + offset;
          const existing = nextRows[targetIndex];
          const isFullRow = parsed.detectedAlignment.startsWith('Full row');
          nextRows[targetIndex] = existing
            ? { ...existing, ...pasteRow, id: existing.id, processing: isFullRow ? pasteRow.processing : existing.processing, completed: isFullRow ? pasteRow.completed : existing.completed }
            : pasteRow;
        });
        saveBlueprintToServer(nextRows, products, district, month);
        setSaveStatus(`Pasted ${parsed.rows.length} rows using matched headers`);
        setTimeout(() => setSaveStatus(null), 3500);
        return nextRows;
      });
      return;
    }

    const pasteColumns = visibleColumns.slice(visibleColumns.indexOf(colIdx));
    const totalColumns = pasteColumns.length;
    for (let rowIndex = 0; rowIndex < effectiveRows.length; rowIndex++) {
      const row = effectiveRows[rowIndex];
      if (row.length > totalColumns) {
        setSaveStatus(`Paste canceled: row ${rowIndex + 1} extends past the last Blueprint column.`);
        return;
      }
      for (let offset = 0; offset < row.length; offset++) {
        const targetColumn = pasteColumns[offset];
        if (targetColumn < 5) continue;
        const vaccineSubcolumn = (targetColumn - 5) % 4;
        const raw = row[offset].trim().replace(/,/g, '').replace(/^\((.*)\)$/, '-$1');
        if (vaccineSubcolumn !== 3 && raw && raw !== '-' && raw !== '—' && !Number.isFinite(Number(raw))) {
          setSaveStatus(`Paste canceled: “${row[offset]}” is not a valid quantity. Nothing was changed.`);
          return;
        }
      }
    }

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

  // Record completion only after every allocated vaccine has a zero balance.
  const handleCompleteFacility = async (rowId: string, customCompleteDate?: string) => {
    const todayStr = customCompleteDate || new Date().toISOString().slice(0, 10);
    const target = rows.find(r => r.id === rowId);
    if (!target || getSheetProgressStatus(target, products) !== 'completed') return;

    const updated = rows.map(r => r.id === rowId
      ? normalizeFacilityProgress({ ...r, completed: todayStr }, products, todayStr)
      : r
    );
    setRows(updated);
    saveBlueprintToServer(updated, products, district, month);

    try {
      await authFetch('/api/vaccine/blueprint/complete-facility', {
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
          deliverySite: '',
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
          deliverySite: '',
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
      | 'subDistrict'
      | 'deliverySite'
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
          } else if (columnType === 'subDistrict') {
            newRow.subDistrict = '';
          } else if (columnType === 'deliverySite') {
            newRow.deliverySite = '';
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
    const headerCols = ['Start Date', 'Completed Date', 'Facility', 'Sub-district', 'Delivery Site'];
    products.forEach(p => {
      headerCols.push(`${p} Carry-over`, `${p} Allocation`, `${p} Distributed`, `${p} Balance`);
    });

    const lines = [headerCols.join('\t')];

    targetRows.forEach(r => {
      const rowCols = [
        r.processing || '',
        r.completed || '',
        r.facility || '',
        r.subDistrict || '',
        r.deliverySite || ''
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
        setSaveStatus('Failed to copy to clipboard.');
        setTimeout(() => setSaveStatus(null), 3500);
      });
    }
  };

  // Selecting a facility for audit does not change its data-entry progress.
  const handleSelectFacilityForOrder = (row: FacilityBlueprintRow) => {
    if (onFacilitySelectedForOrder) {
      onFacilitySelectedForOrder(row.id);
    }
  };

  // Add a new facility row with all editable product cells ready.
  const handleAddRow = () => {
    const newRow = makeBlankBlueprintRow(`bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const updated = [...rows, newRow];
    setRows(updated);
    saveBlueprintToServer(updated, products, district, month);
    return newRow.id;
  };

  const handleAddMultipleBlankRows = (count = 5) => {
    const newRows = Array.from({ length: count }, (_, index) => makeBlankBlueprintRow(`bp_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 5)}`));
    const updated = [...rows, ...newRows];
    setRows(updated);
    saveBlueprintToServer(updated, products, district, month);
  };

  const makeBlankBlueprintRow = (id: string): FacilityBlueprintRow => ({
    id, processing: '', completed: '', facility: '', deliverySite: '', subDistrict: '',
    vaccines: Object.fromEntries(products.map(product => [product, { carryOver: '', allocation: '', distributed: '', balance: '' }]))
  });

  const getRowActionAnchor = () => focusedCell?.rowId || (selectedRowIds.size === 1 ? Array.from(selectedRowIds)[0] : null);

  const handleInsertRow = (position: 'above' | 'below') => {
    const anchorId = getRowActionAnchor();
    const index = rows.findIndex(row => row.id === anchorId);
    if (index < 0) {
      setSaveStatus('Select a row or cell first.');
      return;
    }
    const newRow = makeBlankBlueprintRow(`bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const updated = [...rows];
    updated.splice(index + (position === 'below' ? 1 : 0), 0, newRow);
    setRows(updated);
    saveBlueprintToServer(updated, products, district, month);
    window.setTimeout(() => focusGridCell(newRow.id, 2), 0);
  };

  const handleDuplicateRow = () => {
    const anchorId = getRowActionAnchor();
    const index = rows.findIndex(row => row.id === anchorId);
    if (index < 0) {
      setSaveStatus('Select a row or cell first.');
      return;
    }
    const source = rows[index];
    const clonedVaccines: FacilityBlueprintRow['vaccines'] = {};
    (Object.entries(source.vaccines || {}) as Array<[string, VaccineSectionData]>).forEach(([key, value]) => { clonedVaccines[key] = { ...value }; });
    const duplicate: FacilityBlueprintRow = {
      ...source,
      id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      vaccines: clonedVaccines,
      vaccineComments: source.vaccineComments ? { ...source.vaccineComments } : undefined
    };
    const updated = [...rows];
    updated.splice(index + 1, 0, duplicate);
    setRows(updated);
    saveBlueprintToServer(updated, products, district, month);
    window.setTimeout(() => focusGridCell(duplicate.id, 2), 0);
  };

  const handleMoveRow = (direction: -1 | 1) => {
    const anchorId = getRowActionAnchor();
    const index = rows.findIndex(row => row.id === anchorId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return;
    const updated = [...rows];
    [updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]];
    setRows(updated);
    saveBlueprintToServer(updated, products, district, month);
  };

  // Delete specific row with instant undo support
  const handleDeleteRow = (rowId: string) => {
    const targetRow = rows.find(r => r.id === rowId);
    const facilityLabel = targetRow?.facility ? `"${targetRow.facility}"` : 'this row';
    setDeletedHistory({
      rows: [...rows],
      products: [...products],
      deletedColumnKeys: [...deletedColumnKeys],
      description: `Deleted ${facilityLabel}`
    });
    const updated = rows.filter(r => r.id !== rowId);
    setRows(updated);
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
    saveBlueprintToServer(updated, products, district, month);
    setSaveStatus(`Deleted ${facilityLabel}`);
    setTimeout(() => setSaveStatus(null), 3500);
  };

  // Toggle or range-select row highlighting (Shift-click supported)
  const handleToggleRowSelect = (rowId: string, e?: React.MouseEvent | React.ChangeEvent) => {
    setAllCellsHighlighted(false);
    const isShift = (e as React.MouseEvent)?.shiftKey;
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (isShift && lastSelectedRowId && rows.some(r => r.id === lastSelectedRowId)) {
        const lastIdx = rows.findIndex(r => r.id === lastSelectedRowId);
        const currentIdx = rows.findIndex(r => r.id === rowId);
        if (lastIdx !== -1 && currentIdx !== -1) {
          const start = Math.min(lastIdx, currentIdx);
          const end = Math.max(lastIdx, currentIdx);
          for (let i = start; i <= end; i++) {
            next.add(rows[i].id);
          }
          return next;
        }
      }
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
    setLastSelectedRowId(rowId);
  };

  // Toggle or range-select column highlighting (Shift-click supported)
  const handleToggleColumnSelect = (colName: string, e?: React.MouseEvent) => {
    setAllCellsHighlighted(false);
    const isShift = e?.shiftKey;
    setSelectedColumnNames(prev => {
      const next = new Set(prev);
      if (isShift && lastSelectedColumnName && products.includes(lastSelectedColumnName)) {
        const lastIdx = products.indexOf(lastSelectedColumnName);
        const currentIdx = products.indexOf(colName);
        if (lastIdx !== -1 && currentIdx !== -1) {
          const start = Math.min(lastIdx, currentIdx);
          const end = Math.max(lastIdx, currentIdx);
          for (let i = start; i <= end; i++) {
            next.add(products[i]);
          }
          return next;
        }
      }
      if (next.has(colName)) {
        next.delete(colName);
      } else {
        next.add(colName);
      }
      return next;
    });
    setLastSelectedColumnName(colName);
  };

  // Select all or deselect all rows
  const handleSelectAllRows = () => {
    setAllCellsHighlighted(false);
    if (selectedRowIds.size === rows.length) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(rows.map(r => r.id)));
    }
  };

  const isAllSheetColumnsHighlighted = () => {
    if (selectedColumnNames.size !== products.length || !selectedCellRange || filteredAndSortedRows.length === 0) return false;
    const anchorRow = filteredAndSortedRows.findIndex(row => row.id === selectedCellRange.anchorRowId);
    const focusRow = filteredAndSortedRows.findIndex(row => row.id === selectedCellRange.focusRowId);
    return Math.min(selectedCellRange.anchorColIdx, selectedCellRange.focusColIdx) === 0
      && Math.max(selectedCellRange.anchorColIdx, selectedCellRange.focusColIdx) === 4 + products.length * 4
      && Math.min(anchorRow, focusRow) === 0
      && Math.max(anchorRow, focusRow) === filteredAndSortedRows.length - 1;
  };

  // Select all or deselect all columns across frozen fields and vaccine groups.
  const handleSelectAllColumns = () => {
    setAllCellsHighlighted(false);
    if (isAllSheetColumnsHighlighted()) {
      setSelectedColumnNames(new Set());
      setSelectedCellRange(null);
      return;
    }
    setSelectedRowIds(new Set());
    setSelectedColumnNames(new Set(products));
    if (filteredAndSortedRows.length > 0) {
      setSelectedCellRange({
        anchorRowId: filteredAndSortedRows[0].id,
        anchorColIdx: 0,
        focusRowId: filteredAndSortedRows[filteredAndSortedRows.length - 1].id,
        focusColIdx: 4 + products.length * 4,
      });
    }
  };

  // Highlight every editable cell in the blueprint body, including the fixed
  // facility/date fields and all vaccine allocation fields.
  const handleSelectAllCells = () => {
    setAllCellsHighlighted(current => !current);
    // Keep this visual action separate from row/column selection, which also
    // enables bulk deletion controls.
    setSelectedRowIds(new Set());
    setSelectedColumnNames(new Set());
    setSelectedCellRange(null);
  };

  // Restore last deleted rows or columns
  const handleUndoDeleted = () => {
    if (!deletedHistory) return;
    const restoredRows = deletedHistory.rows;
    const restoredProducts = deletedHistory.products;
    setRows(restoredRows);
    setProducts(restoredProducts);
    updateDeletedColumns(deletedHistory.deletedColumnKeys || []);
    if (deletedHistory.cellMerges) setCellMerges(deletedHistory.cellMerges);
    saveBlueprintToServer(restoredRows, restoredProducts, district, month, deletedHistory.cellMerges || cellMerges);
    setSaveStatus(`Restored: ${deletedHistory.description}`);
    setDeletedHistory(null);
    setTimeout(() => setSaveStatus(null), 3500);
  };

  // Delete highlighted rows instantly with undo support
  const handleDeleteSelectedRows = (rowIds = selectedRowIds) => {
    if (rowIds.size === 0) return;
    const count = rowIds.size;
    // Save state for instant undo
    setDeletedHistory({
      rows: [...rows],
      products: [...products],
      deletedColumnKeys: [...deletedColumnKeys],
      description: `Deleted ${count} highlighted facility row(s)`
    });

    const updated = rows.filter(r => !rowIds.has(r.id));
    setRows(updated);
    setSelectedRowIds(new Set());
    setLastSelectedRowId(null);
    saveBlueprintToServer(updated, products, district, month);
    setSaveStatus(`Deleted ${count} highlighted row(s)`);
    setTimeout(() => setSaveStatus(null), 3500);
  };

  const handleDeleteGridColumns = (indexes: number[]) => {
    const columns = indexes.filter(index => visibleColumns.includes(index));
    if (!columns.length) return;
    setDeletedHistory({ rows: [...rows], products: [...products], deletedColumnKeys: [...deletedColumnKeys], cellMerges: [...cellMerges], description: `Deleted ${columns.length} column(s)` });
    const nextKeys = [...new Set([...deletedColumnKeys, ...columns.map(index => blueprintColumnKey(index, products))])];
    const nextRows = deleteBlueprintColumnData(rows, products, columns);
    updateDeletedColumns(nextKeys);
    setRows(nextRows);
    setSelectedCellRange(null);
    setFocusedCell(null);
    setActiveHeaderCell(null);
    setCellMerges([]);
    setSelectedColumnNames(new Set());
    setAllCellsHighlighted(false);
    setFreezeMenu(null);
    clearPendingCellMove();
    saveBlueprintToServer(nextRows, products, district, month, []);
    setSaveStatus(`Deleted ${columns.length} column(s)`);
  };
  const getColumnDeletionTargets = (index: number, columnGroup?: number[]) => {
    if (allCellsHighlighted || isAllSheetColumnsHighlighted()) return visibleColumns;
    const selectedProducts = visibleColumns.filter(col => col >= 5 && selectedColumnNames.has(products[Math.floor((col - 5) / 4)]));
    if (selectedProducts.includes(index)) return selectedProducts;
    const bounds = getCellRangeBounds();
    if (bounds && index >= bounds.firstCol && index <= bounds.lastCol) {
      return visibleColumns.filter(col => col >= bounds.firstCol && col <= bounds.lastCol);
    }
    return columnGroup || [index];
  };

  // Delete highlighted columns instantly with undo support
  const handleDeleteSelectedColumns = () => {
    if (selectedColumnNames.size === 0) return;
    const names: string[] = Array.from(selectedColumnNames);
    const count = names.length;
    const namesList = names.join(', ');
    // Save state for instant undo
    setDeletedHistory({
      rows: [...rows],
      products: [...products],
      deletedColumnKeys: [...deletedColumnKeys],
      description: `Deleted ${count} column(s): ${namesList}`
    });

    const updatedProducts = products.filter(p => !selectedColumnNames.has(p));
    const updatedRows = rows.map(r => {
      if (!r.vaccines) return r;
      let modified = false;
      const newVaccines = { ...r.vaccines };
      let newComments = r.vaccineComments ? { ...r.vaccineComments } : undefined;
      names.forEach((col: string) => {
        if (newVaccines[col]) {
          delete newVaccines[col];
          modified = true;
        }
        if (newComments && newComments[col]) {
          delete newComments[col];
          modified = true;
        }
      });
      if (!modified) return r;
      return {
        ...r,
        vaccines: newVaccines,
        vaccineComments: newComments
      };
    });

    setProducts(updatedProducts);
    setRows(updatedRows);
    setSelectedColumnNames(new Set());
    setLastSelectedColumnName(null);
    saveBlueprintToServer(updatedRows, updatedProducts, district, month);
    setSaveStatus(`Deleted ${count} column(s): ${namesList}`);
    setTimeout(() => setSaveStatus(null), 3500);
  };

  // Delete both highlighted rows and columns simultaneously
  const handleDeleteBothSelected = () => {
    if (selectedRowIds.size === 0 && selectedColumnNames.size === 0) return;
    const rowCount = selectedRowIds.size;
    const colNames: string[] = Array.from(selectedColumnNames);
    const colCount = colNames.length;
    setDeletedHistory({
      rows: [...rows],
      products: [...products],
      deletedColumnKeys: [...deletedColumnKeys],
      description: `Deleted ${rowCount} row(s) and ${colCount} column(s)`
    });

    const updatedProducts = products.filter(p => !selectedColumnNames.has(p));
    const updatedRows = rows
      .filter(r => !selectedRowIds.has(r.id))
      .map(r => {
        if (!r.vaccines) return r;
        let modified = false;
        const newVaccines = { ...r.vaccines };
        let newComments = r.vaccineComments ? { ...r.vaccineComments } : undefined;
        colNames.forEach((col: string) => {
          if (newVaccines[col]) {
            delete newVaccines[col];
            modified = true;
          }
          if (newComments && newComments[col]) {
            delete newComments[col];
            modified = true;
          }
        });
        if (!modified) return r;
        return {
          ...r,
          vaccines: newVaccines,
          vaccineComments: newComments
        };
      });

    setRows(updatedRows);
    setProducts(updatedProducts);
    setSelectedRowIds(new Set());
    setLastSelectedRowId(null);
    setSelectedColumnNames(new Set());
    setLastSelectedColumnName(null);
    saveBlueprintToServer(updatedRows, updatedProducts, district, month);
    setSaveStatus(`Deleted ${rowCount} row(s) & ${colCount} column(s)`);
    setTimeout(() => setSaveStatus(null), 3500);
  };

  // Clear highlighted columns
  const handleClearSelectedColumns = () => {
    if (selectedColumnNames.size === 0) return;
    const names: string[] = Array.from(selectedColumnNames);
    setDeletedHistory({
      rows: [...rows],
      products: [...products],
      deletedColumnKeys: [...deletedColumnKeys],
      description: `Cleared values in ${names.length} column(s)`
    });
    const updatedRows = rows.map(r => {
      if (!r.vaccines) return r;
      const newVaccines = { ...r.vaccines };
      names.forEach((col: string) => {
        if (newVaccines[col]) {
          newVaccines[col] = { carryOver: 0, allocation: 0, distributed: 0, balance: 0 };
        }
      });
      return { ...r, vaccines: newVaccines };
    });
    setRows(updatedRows);
    saveBlueprintToServer(updatedRows, products, district, month);
    setSaveStatus(`Cleared data in ${names.length} column(s)`);
    setTimeout(() => setSaveStatus(null), 3000);
  };

  // Global mouseup to release drag-highlighting
  useEffect(() => {
    const handleMouseUp = () => {
      isDraggingGridRangeRef.current = false;
      preserveCellRangeRef.current = false;
      setIsMouseDownOnColHeader(false);
      setIsMouseDownOnRowHeader(false);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => {
    const handleResize = (event: MouseEvent) => {
      const resize = resizeProductRef.current;
      if (!resize) return;
      const width = Math.max(240, Math.min(720, resize.startWidth + event.clientX - resize.startX));
      setProductGroupWidths(previous => ({ ...previous, [resize.name]: width }));
    };
    const finishResize = () => { resizeProductRef.current = null; };
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', finishResize);
    return () => {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', finishResize);
    };
  }, []);

  // Keyboard shortcut listener: Delete or Backspace removes highlighted items
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Do not delete rows/columns if user is typing inside an editable text box
      const isTextInput =
        target &&
        ((target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (isTextInput) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedRowIds.size > 0 && selectedColumnNames.size > 0) {
          e.preventDefault();
          handleDeleteBothSelected();
        } else if (selectedColumnNames.size > 0 && selectedRowIds.size === 0) {
          e.preventDefault();
          handleDeleteSelectedColumns();
        } else if (selectedRowIds.size > 0 && selectedColumnNames.size === 0) {
          e.preventDefault();
          handleDeleteSelectedRows();
        }
      } else if (e.key === 'Escape') {
        setAllCellsHighlighted(false);
        setSelectedRowIds(new Set());
        setSelectedColumnNames(new Set());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRowIds, selectedColumnNames, products, rows, district, month]);

  const handleMoveProductGroup = (name: string, direction: -1 | 1) => {
    const index = products.indexOf(name);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= products.length) return;
    const updatedProducts = [...products];
    [updatedProducts[index], updatedProducts[nextIndex]] = [updatedProducts[nextIndex], updatedProducts[index]];
    setProducts(updatedProducts);
    saveBlueprintToServer(rows, updatedProducts, district, month);
    setSaveStatus(`Moved ${name} ${direction < 0 ? 'left' : 'right'}`);
  };

  // Add a new vaccine/product group (4 subcolumns: Carry-over, Allocation, Distributed, Balance)
  const handleAddProductGroup = () => {
    const trimmed = newColumnName.trim();
    if (!trimmed) return;
    if (products.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      setSaveStatus(`Product "${trimmed}" already exists in the blueprint.`);
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }
    const updatedProducts = [...products];
    const insertAt = productInsertIndexRef.current;
    updatedProducts.splice(insertAt === null ? updatedProducts.length : Math.max(0, Math.min(insertAt, updatedProducts.length)), 0, trimmed);
    productInsertIndexRef.current = null;
    updateDeletedColumns(deletedColumnKeys.filter(key => !key.startsWith(`vaccine:${trimmed}:`)));
    setProducts(updatedProducts);
    setNewColumnName('');
    setShowAddColumnModal(false);
    saveBlueprintToServer(rows, updatedProducts, district, month);
    setSaveStatus(`Added column "${trimmed}"`);
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const handleRenameProductGroup = (oldName: string, requestedName: string) => {
    const newName = requestedName.trim();
    setEditingProductNameFor(null);
    if (!newName || newName === oldName) return;
    if (products.some(name => name !== oldName && name.toLowerCase() === newName.toLowerCase())) {
      setSaveStatus(`Product "${newName}" already exists in the blueprint.`);
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }

    setDeletedHistory({ rows: [...rows], products: [...products], deletedColumnKeys: [...deletedColumnKeys], description: `Renamed "${oldName}" to "${newName}"` });
    const updatedProducts = products.map(name => name === oldName ? newName : name);
    const updatedRows = rows.map(row => {
      const vaccines = { ...row.vaccines };
      if (Object.prototype.hasOwnProperty.call(vaccines, oldName)) {
        vaccines[newName] = vaccines[oldName];
        delete vaccines[oldName];
      }
      const vaccineComments = row.vaccineComments ? { ...row.vaccineComments } : undefined;
      if (vaccineComments && Object.prototype.hasOwnProperty.call(vaccineComments, oldName)) {
        vaccineComments[newName] = vaccineComments[oldName];
        delete vaccineComments[oldName];
      }
      return { ...row, vaccines, vaccineComments };
    });

    updateDeletedColumns(deletedColumnKeys.map(key => key.startsWith(`vaccine:${oldName}:`) ? `vaccine:${newName}:${key.slice(`vaccine:${oldName}:`.length)}` : key));
    setProducts(updatedProducts);
    setRows(updatedRows);
    setSelectedColumnNames(previous => {
      const next = new Set(previous);
      if (next.delete(oldName)) next.add(newName);
      return next;
    });
    setLastSelectedColumnName(previous => previous === oldName ? newName : previous);
    saveBlueprintToServer(updatedRows, updatedProducts, district, month);
    setSaveStatus(`Renamed column "${oldName}" to "${newName}"`);
    setTimeout(() => setSaveStatus(null), 3000);
  };

  // Delete a product group (single column)
  const handleDeleteProductGroup = (vaccineName: string) => {
    if (!vaccineName) return;
    setDeletedHistory({
      rows: [...rows],
      products: [...products],
      deletedColumnKeys: [...deletedColumnKeys],
      description: `Deleted column group "${vaccineName}"`
    });
    const updatedProducts = products.filter(p => p !== vaccineName);
    // Clean up row data for this deleted column so orphaned properties don't linger
    const updatedRows = rows.map(r => {
      if (!r.vaccines || !r.vaccines[vaccineName]) return r;
      const newVaccines = { ...r.vaccines };
      delete newVaccines[vaccineName];
      let newComments = r.vaccineComments;
      if (newComments && newComments[vaccineName]) {
        newComments = { ...newComments };
        delete newComments[vaccineName];
      }
      return {
        ...r,
        vaccines: newVaccines,
        vaccineComments: newComments
      };
    });
    setProducts(updatedProducts);
    setRows(updatedRows);
    setSelectedColumnNames(prev => {
      const next = new Set(prev);
      next.delete(vaccineName);
      return next;
    });
    saveBlueprintToServer(updatedRows, updatedProducts, district, month);
    setSaveStatus(`Removed column "${vaccineName}"`);
    setTimeout(() => setSaveStatus(null), 3000);
  };

  // Sync Blueprint to the Order Checker & Master Allocation Engine
  const handleSyncToOrderChecker = async () => {
    setLoading(true);
    setSyncStatus('Synchronizing all districts with Order Checker...');
    try {
      const res = await authFetch('/api/vaccine/blueprint-districts/sync', {
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
    const exportSheets = [...districts.filter(sheet => sheet.id !== activeDistrictId), {
      id: activeDistrictId, district, month, sheetName: districts.find(sheet => sheet.id === activeDistrictId)?.sheetName, products, rows, cellMerges, freezeRows, freezeColumns, mergeHeaders, deletedColumnKeys, headerLabels
    }];

    exportSheets.forEach((sheet, sheetIndex) => {
    const district = sheet.district;
    const month = sheet.month;
    const products = Array.isArray(sheet.products) ? sheet.products : [...DEFAULT_BLUEPRINT_PRODUCTS];
    const rows = sheet.rows || [];
    const savedHeaderLabels = sheet.headerLabels?.length === 20 ? sheet.headerLabels : DEFAULT_BLUEPRINT_HEADER_LABELS;

    // Row 1: District & Month Title centered across vaccine columns
    // Row 2: Processing, Completed, Facility, VACCINES
    // Row 3: Grouped vaccine headers (BCG, OPV, ...)
    // Row 4: Carry-over, Allocation, Distributed, Balance
    const sheetData: any[][] = [];

    // ROW 1:
    const row1: any[] = savedHeaderLabels.slice(0, 5);
    row1.push(`${district} ${month}`);
    for (let i = 6; i < 5 + products.length * 4; i++) {
      row1.push('');
    }
    sheetData.push(row1);

    // ROW 2:
    const row2: any[] = [...savedHeaderLabels.slice(5, 10), '                                                               VACCINES'];
    for (let i = 6; i < 5 + products.length * 4; i++) {
      row2.push('');
    }
    sheetData.push(row2);

    // ROW 3:
    const row3: any[] = savedHeaderLabels.slice(10, 15);
    products.forEach(p => {
      row3.push(p);
      row3.push('');
      row3.push('');
      row3.push('');
    });
    sheetData.push(row3);

    // ROW 4:
    const row4: any[] = savedHeaderLabels.slice(15, 20);
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
        r.facility || '',
        r.subDistrict || '',
        r.deliverySite || ''
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

    const exportColumns = visibleBlueprintColumns(products, sheet.deletedColumnKeys || []);
    const ws = XLSX.utils.aoa_to_sheet(sheetData.map(row => exportColumns.map(index => row[index] ?? '')));

    // Define Merges for visual blueprint:
    // Row 1: Merge D1 to BO1
    // Row 2: Merge D2 to BO2
    // Row 3: For each vaccine, merge 4 columns
    const totalCols = 5 + products.length * 4;
    const merges: XLSX.Range[] = [
      // Row 1: Title
      { s: { r: 0, c: 5 }, e: { r: 0, c: totalCols - 1 } },
      // Row 2: VACCINES
      { s: { r: 1, c: 5 }, e: { r: 1, c: totalCols - 1 } }
    ];

    // Row 3: Vaccine groups (4 columns each)
    products.forEach((_, idx) => {
      const startCol = 5 + idx * 4;
      merges.push({
        s: { r: 2, c: startCol },
        e: { r: 2, c: startCol + 3 }
      });
    });

    ws['!merges'] = sheet.mergeHeaders === false ? [] : merges.flatMap(merge => {
      const columns = exportColumns.filter(index => index >= merge.s.c && index <= merge.e.c);
      if (columns.length < 2) return [];
      return [{ s: { r: merge.s.r, c: exportColumns.indexOf(columns[0]) }, e: { r: merge.e.r, c: exportColumns.indexOf(columns[columns.length - 1]) } }];
    });

    // Set column widths
    const colWidths: any[] = [
      { wch: 14 }, // Col A: Processing
      { wch: 14 }, // Col B: Completed
      { wch: 28 }, // Col C: Facility
      { wch: 20 }, // Col D: Sub-district
      { wch: 24 }  // Col E: Delivery Site
    ];
    for (let i = 5; i < totalCols; i++) {
      colWidths.push({ wch: 12 });
    }
    ws['!cols'] = exportColumns.map(index => colWidths[index]);

    const baseName = `${district} ${month}`.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
    let sheetName = baseName.slice(0, 31) || `Allocation ${sheetIndex + 1}`;
    let suffix = 2;
    while (wb.SheetNames.some(existing => existing.toLowerCase() === sheetName.toLowerCase())) {
      const ending = ` ${suffix++}`;
      sheetName = `${baseName.slice(0, 31 - ending.length)}${ending}`;
    }
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
    XLSX.writeFile(wb, `Allocation_Blueprint_${month.replace(/\s+/g, '_')}.xlsx`);
  };

  // Import Excel/CSV only after the complete sheet has passed strict validation.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSaveStatus(`Reading ${file.name}…`);
    try {
      const bytes = await file.arrayBuffer();
      const workbook = XLSX.read(bytes, { type: 'array', cellDates: true, cellStyles: true, raw: false });
      const sheetResults = workbook.SheetNames.flatMap(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) return [];
        const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, defval: '', raw: false, blankrows: true });
        return [{ sheetName, parsed: parseBlueprintFile(values) }];
      });
      const nonEmptySheets = sheetResults.filter(result => {
        const source = workbook.Sheets[result.sheetName];
        return source && XLSX.utils.sheet_to_json<unknown[]>(source, { header: 1, range: 0, defval: '', raw: false }).some(row => row.some(cell => String(cell ?? '').trim()));
      });
      const validSheets = nonEmptySheets.filter(result => result.parsed.rows.length && !result.parsed.errors.length);

      if (!validSheets.length) {
        const issue = nonEmptySheets.flatMap(result => result.parsed.errors)
          .find(message => message !== 'The selected file has no data.' && !message.startsWith('Could not find the Blueprint headings.'));
        setSaveStatus(issue || 'No complete Blueprint table was found. Check the headings and quantities; the current sheet was not changed.');
        setTimeout(() => setSaveStatus(null), 5500);
        return;
      }

      const importedIds = new Set<string>();
      const importedSheets: DistrictSheetData[] = validSheets.map(({ sheetName, parsed }, index) => {
        const parsedDistrict = parsed.district || (validSheets.length === 1 ? district : sheetName);
        const parsedMonth = parsed.month || month;
        const existing = districts.find(item => item.district.toLowerCase() === parsedDistrict.toLowerCase() && item.month.toLowerCase() === parsedMonth.toLowerCase());
        const slug = `${parsedDistrict}_${parsedMonth}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `imported_sheet_${index + 1}`;
        let id = existing?.id || (validSheets.length === 1 ? activeDistrictId : slug);
        let collision = 2;
        while (importedIds.has(id) || (!existing && id !== activeDistrictId && districts.some(item => item.id === id))) id = `${slug}_${collision++}`;
        importedIds.add(id);
        const parsedProducts = parsed.products;
        const sourceSheet = workbook.Sheets[sheetName];
        const importedRows = normalizeBlueprintRowsProgress(parsed.rows.map((row, rowIndex) => {
          const baseFormatting: Record<string, React.CSSProperties> = {};
          parsed.sourceColumnIndexes?.forEach((sourceCol, colIndex) => {
            const sourceRow = parsed.sourceRowIndexes?.[rowIndex];
            if (sourceCol === null || sourceRow === undefined) return;
            const cell = sourceSheet[XLSX.utils.encode_cell({ r: sourceRow, c: sourceCol })];
            const style = getExcelBaseFormatting(cell?.s);
            if (Object.keys(style).length) baseFormatting[blueprintColumnKey(colIndex, parsedProducts)] = style;
          });
          return { ...row, baseFormatting };
        }) as FacilityBlueprintRow[], parsedProducts);
        return {
          id,
          district: parsedDistrict,
          month: parsedMonth,
          sheetName,
          worksheetRole: /^allocation(?:\s+sheet)?$/i.test(sheetName.trim()) ? 'allocation' : 'other',
          products: parsedProducts,
          rows: importedRows,
          cellMerges: [],
          headerLabels: [...DEFAULT_BLUEPRINT_HEADER_LABELS],
          hiddenRowIds: [],
          mergeHeaders: true,
          freezeRows: 0,
          freezeColumns: 0,
          updatedAt: new Date().toISOString()
        };
      });
      // Apply all valid worksheets together so an invalid file never partially replaces the current workbook.
      const allSheets = [
        ...districts.filter(item => !importedSheets.some(incoming => incoming.id === item.id)),
        ...importedSheets
      ];
      const selectedSheet = importedSheets[0];
      historyResetPendingRef.current = true;
      setDistricts(allSheets);
      setActiveDistrictId(selectedSheet.id);
      setDistrict(selectedSheet.district);
      setMonth(selectedSheet.month);
      setProducts(selectedSheet.products || [...DEFAULT_BLUEPRINT_PRODUCTS]);
      setRows(selectedSheet.rows);
      setCellMerges([]);
      setHeaderLabels([...DEFAULT_BLUEPRINT_HEADER_LABELS]);
      setActiveHeaderCell(null);
      updateDeletedColumns([]);
      setHiddenRowIds([]);
      setMergeHeaders(true);
      setFreezeRows(0);
      setFreezeColumns(0);
      setHasUnsavedChanges(true);
      setSaveStatus('Saving imported worksheets…');
      void safeFetchJson<{ districts?: DistrictSheetData[] }>('/api/vaccine/blueprint-districts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ districts: importedSheets, activeId: selectedSheet.id, user: currentUser })
      }).then(data => {
        if (data && Array.isArray(data.districts)) setDistricts(data.districts);
        setHasUnsavedChanges(false);
        setSaveStatus(`Imported ${importedSheets.length} worksheet${importedSheets.length === 1 ? '' : 's'} from ${file.name}${validSheets.length < nonEmptySheets.length ? `; skipped ${nonEmptySheets.length - validSheets.length} unsupported sheet${nonEmptySheets.length - validSheets.length === 1 ? '' : 's'}` : ''}.`);
      }).catch(err => {
        setHasUnsavedChanges(true);
        setSaveStatus(`Import could not be saved: ${err instanceof Error ? err.message : 'Check your connection and try again.'}`);
      });
      setTimeout(() => setSaveStatus(null), 4500);
    } catch (uploadErr) {
      console.error('Failed to parse spreadsheet:', uploadErr);
      setSaveStatus('Could not read this file. Save it as .xlsx or .csv and try again; the current sheet was not changed.');
      setTimeout(() => setSaveStatus(null), 5000);
    }
  };

  // Filter & Sort Logic
  useEffect(() => {
    const liveRowIds = new Set(rows.map(row => row.id));
    setCellMerges(current => current.filter(merge => merge.rowIds.length > 0 && merge.rowIds.every(id => liveRowIds.has(id))));
  }, [rows]);

  const filteredAndSortedRows = useMemo(() => {
    let result = rows.filter(row => !hiddenRowIds.includes(row.id));

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        r =>
          r.facility.toLowerCase().includes(q) ||
          (r.deliverySite || '').toLowerCase().includes(q) ||
          r.processing.toLowerCase().includes(q) ||
          r.completed.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(r => {
        if (statusFilter === 'completed') {
          return isFacilityCompleted(r, products, allocationWorksheet);
        }
        if (statusFilter === 'in_progress') {
          return isFacilityInProgress(r, products, allocationWorksheet);
        }
        if (statusFilter === 'pending') {
          return isFacilityPending(r, products, allocationWorksheet);
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
  }, [rows, hiddenRowIds, searchQuery, statusFilter, sortField, sortAsc, products, allocationWorksheet]);


  useLayoutEffect(() => {
    const table = blueprintTableRef.current;
    if (!table) return;
    const sheetRows = Array.from(table.querySelectorAll('thead tr, tbody tr')) as HTMLTableRowElement[];
    const measureOffsets = () => {
      let top = 0;
      const offsets: Record<number, number> = {};
      sheetRows.forEach((row, index) => {
        offsets[index + 1] = top;
        top += row.getBoundingClientRect().height;
      });
      setFreezeRowOffsets(previous => {
        const keys = Object.keys(offsets);
        if (keys.length === Object.keys(previous).length && keys.every(key => previous[Number(key)] === offsets[Number(key)])) return previous;
        return offsets;
      });
    };
    measureOffsets();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureOffsets);
    sheetRows.forEach(row => observer?.observe(row));
    window.addEventListener('resize', measureOffsets);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureOffsets);
    };
  }, [filteredAndSortedRows, products.length, freezeRows, productGroupWidths, district, month]);

  useEffect(() => {
    historyResetPendingRef.current = true;
    undoStackRef.current = [];
    redoStackRef.current = [];
    historySnapshotRef.current = { rows, products, deletedColumnKeys, cellMerges };
    historyCellGroupRef.current = null;
    setHistoryVersion(version => version + 1);
  }, [activeDistrictId, district, month]);

  useEffect(() => {
    const previous = historySnapshotRef.current;
    if (historyResetPendingRef.current) {
      historyResetPendingRef.current = false;
      historySnapshotRef.current = { rows, products, deletedColumnKeys, cellMerges };
      historyCellGroupRef.current = null;
      setHistoryVersion(version => version + 1);
      return;
    }
    if (restoringHistoryRef.current) {
      restoringHistoryRef.current = false;
      historySnapshotRef.current = { rows, products, deletedColumnKeys, cellMerges };
      setHistoryVersion(version => version + 1);
      return;
    }
    if (!previous) {
      historySnapshotRef.current = { rows, products, deletedColumnKeys, cellMerges };
      return;
    }
    if (previous.rows === rows && previous.products === products && previous.deletedColumnKeys === deletedColumnKeys && previous.cellMerges === cellMerges) return;

    const now = Date.now();
    const groupKey = focusedCell ? `${focusedCell.rowId}:${focusedCell.colIdx}` : '';
    const lastGroup = historyCellGroupRef.current;
    const isSameTypingSession = Boolean(groupKey && lastGroup?.key === groupKey && now - lastGroup.at < 900);
    if (!isSameTypingSession) {
      undoStackRef.current.push(previous);
      if (undoStackRef.current.length > 60) undoStackRef.current.shift();
    }
    historyCellGroupRef.current = groupKey ? { key: groupKey, at: now } : null;
    redoStackRef.current = [];
    historySnapshotRef.current = { rows, products, deletedColumnKeys, cellMerges };
    setHistoryVersion(version => version + 1);
  }, [rows, products, deletedColumnKeys, cellMerges, focusedCell]);

  const handleUndo = () => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push({ rows, products, deletedColumnKeys, cellMerges });
    restoringHistoryRef.current = true;
    historySnapshotRef.current = previous;
    setRows(previous.rows);
    setProducts(previous.products);
    updateDeletedColumns(previous.deletedColumnKeys);
    setCellMerges(previous.cellMerges);
    setSelectedRowIds(new Set());
    setSelectedColumnNames(new Set());
    saveBlueprintToServer(previous.rows, previous.products, district, month, previous.cellMerges);
    setSaveStatus('Undo applied');
    setHistoryVersion(version => version + 1);
  };

  const handleRedo = () => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push({ rows, products, deletedColumnKeys, cellMerges });
    restoringHistoryRef.current = true;
    historySnapshotRef.current = next;
    setRows(next.rows);
    setProducts(next.products);
    updateDeletedColumns(next.deletedColumnKeys);
    setCellMerges(next.cellMerges);
    saveBlueprintToServer(next.rows, next.products, district, month, next.cellMerges);
    setSaveStatus('Redo applied');
    setHistoryVersion(version => version + 1);
  };

  const gridCellKey = (rowId: string, colIdx: number) => `${rowId}::${colIdx}`;
  const gridStyleKey = (colIdx: number) => blueprintColumnKey(colIdx, products);
  const isGridCellBold = (rowId: string, colIdx: number) => Boolean(rows.find(row => row.id === rowId)?.boldCells?.includes(gridStyleKey(colIdx)));
  const registerGridCell = (rowId: string, colIdx: number) => (input: HTMLInputElement | null) => {
    const key = gridCellKey(rowId, colIdx);
    if (input) gridInputRefs.current.set(key, input);
    else gridInputRefs.current.delete(key);
  };
  const focusGridCell = (rowId: string, colIdx: number, extendRange = false) => {
    const input = gridInputRefs.current.get(gridCellKey(rowId, colIdx));
    if (!input) return;
    setFocusedCell({ rowId, colIdx });
    preserveCellRangeRef.current = extendRange;
    input.focus();
    if (!extendRange) input.select();
  };
  const reorderProductGroup = (event: React.DragEvent, targetProduct: string) => {
    event.preventDefault();
    const sourceProduct = draggedProductRef.current;
    draggedProductRef.current = null;
    if (!sourceProduct || sourceProduct === targetProduct) return;
    const moving = selectedColumnNames.has(sourceProduct) && selectedColumnNames.size > 1
      ? products.filter(product => selectedColumnNames.has(product))
      : [sourceProduct];
    if (moving.includes(targetProduct)) return;
    const remaining = products.filter(product => !moving.includes(product));
    const insertAt = remaining.indexOf(targetProduct);
    if (insertAt < 0) return;
    const nextProducts = [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)];
    setProducts(nextProducts);
    setSelectedCellRange(null);
    saveBlueprintToServer(rows, nextProducts, district, month);
    setSaveStatus(moving.length > 1 ? `Moved ${moving.length} highlighted vaccine groups before ${targetProduct}.` : `Moved ${sourceProduct} before ${targetProduct}.`);
  };

  const canReorderFacilityRows = !searchQuery.trim() && statusFilter === 'all' && sortField === 'default';
  const reorderFacilityRow = (event: React.DragEvent, targetRowId: string) => {
    event.preventDefault();
    if (!canReorderFacilityRows) {
      setSaveStatus('Clear search, status filters, and sorting before moving rows.');
      return;
    }
    const sourceRowIds = draggedRowIdsRef.current;
    draggedRowIdsRef.current = [];
    if (sourceRowIds.length === 0 || sourceRowIds.includes(targetRowId)) return;
    const moving = rows.filter(row => sourceRowIds.includes(row.id));
    const remaining = rows.filter(row => !sourceRowIds.includes(row.id));
    const insertAt = remaining.findIndex(row => row.id === targetRowId);
    if (moving.length === 0 || insertAt < 0) return;
    const nextRows = [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)];
    setRows(nextRows);
    setSelectedCellRange(null);
    saveBlueprintToServer(nextRows, products, district, month);
    setSaveStatus(moving.length > 1 ? `Moved ${moving.length} highlighted facility rows.` : 'Facility row moved.');
  };

  const handleGridCellFocus = (rowId: string, colIdx: number) => {
    setActiveHeaderCell(null);
    setFocusedCell({ rowId, colIdx });
    const row = rows.find(item => item.id === rowId);
    if (row) cellEditOriginalRef.current = { key: gridCellKey(rowId, colIdx), value: readGridCell(row, colIdx) };
    if (preserveCellRangeRef.current) {
      preserveCellRangeRef.current = false;
    } else {
      setSelectedCellRange({ anchorRowId: rowId, anchorColIdx: colIdx, focusRowId: rowId, focusColIdx: colIdx });
    }
  };
  const getCellRangeBounds = () => {
    if (!selectedCellRange) return null;
    const firstRow = filteredAndSortedRows.findIndex(row => row.id === selectedCellRange.anchorRowId);
    const lastRow = filteredAndSortedRows.findIndex(row => row.id === selectedCellRange.focusRowId);
    if (firstRow < 0 || lastRow < 0) return null;
    return { firstRow: Math.min(firstRow, lastRow), lastRow: Math.max(firstRow, lastRow), firstCol: Math.min(selectedCellRange.anchorColIdx, selectedCellRange.focusColIdx), lastCol: Math.max(selectedCellRange.anchorColIdx, selectedCellRange.focusColIdx) };
  };
  const isGridCellInRange = (rowId: string, colIdx: number) => {
    const bounds = getCellRangeBounds();
    // A single focused cell stays visually unchanged; highlight explicit ranges.
    if (bounds && bounds.firstRow === bounds.lastRow && bounds.firstCol === bounds.lastCol) return false;
    const rowIndex = filteredAndSortedRows.findIndex(row => row.id === rowId);
    return Boolean(bounds && rowIndex >= bounds.firstRow && rowIndex <= bounds.lastRow && colIdx >= bounds.firstCol && colIdx <= bounds.lastCol);
  };
  const getGridCellRangeHighlightStyle = (rowId: string, colIdx: number): React.CSSProperties =>
    getAllocationCellStyle(rows.find(row => row.id === rowId)?.baseFormatting?.[blueprintColumnKey(colIdx, products)], undefined, isGridCellInRange(rowId, colIdx));
  const handleGridColumnHeaderMouseDown = (event: React.MouseEvent<HTMLElement>, colIdx: number) => {
    if (event.button !== 0) { if (event.button === 2) preserveCellRangeRef.current = true; return; }
    if ((event.target as HTMLElement).closest('button') || filteredAndSortedRows.length === 0) return;
    const firstRowId = filteredAndSortedRows[0].id;
    isDraggingGridRangeRef.current = true;
    preserveCellRangeRef.current = true;
    setSelectedCellRange({ anchorRowId: firstRowId, anchorColIdx: colIdx, focusRowId: firstRowId, focusColIdx: colIdx });
  };
  const handleSelectGridColumn = (colIdx: number, event?: React.MouseEvent) => {
    if (filteredAndSortedRows.length === 0) return;
    const firstRowId = filteredAndSortedRows[0].id;
    const lastRowId = filteredAndSortedRows[filteredAndSortedRows.length - 1].id;
    if (event?.shiftKey && selectedCellRange) {
      setSelectedCellRange({ anchorRowId: selectedCellRange.anchorRowId, anchorColIdx: selectedCellRange.anchorColIdx, focusRowId: lastRowId, focusColIdx: colIdx });
    } else {
      setSelectedCellRange({ anchorRowId: firstRowId, anchorColIdx: colIdx, focusRowId: lastRowId, focusColIdx: colIdx });
    }
    setAllCellsHighlighted(false);
    setSelectedRowIds(new Set());
    setSelectedColumnNames(new Set());
  };
  const getSelectedBoldTargets = () => {
    const targets = new Map<string, Set<number>>();
    const add = (rowId: string, colIdx: number) => {
      if (isColumnDeleted(colIdx)) return;
      if (!targets.has(rowId)) targets.set(rowId, new Set());
      targets.get(rowId)!.add(colIdx);
    };
    const bounds = getCellRangeBounds();
    if (allCellsHighlighted) {
      rows.forEach(row => { for (let col = 0; col < 5 + products.length * 4; col++) add(row.id, col); });
    } else if (bounds) {
      filteredAndSortedRows.slice(bounds.firstRow, bounds.lastRow + 1).forEach(row => {
        for (let col = bounds.firstCol; col <= bounds.lastCol; col++) add(row.id, col);
      });
    } else if (selectedRowIds.size > 0) {
      rows.filter(row => selectedRowIds.has(row.id)).forEach(row => { for (let col = 0; col < 5 + products.length * 4; col++) add(row.id, col); });
    } else if (selectedColumnNames.size > 0) {
      rows.forEach(row => products.forEach((product, productIndex) => {
        if (selectedColumnNames.has(product)) for (let subcolumn = 0; subcolumn < 4; subcolumn++) add(row.id, 5 + productIndex * 4 + subcolumn);
      }));
    } else if (focusedCell) {
      add(focusedCell.rowId, focusedCell.colIdx);
    }
    return Array.from(targets, ([rowId, columns]) => ({ rowId, columns: Array.from(columns) }));
  };
  const selectedBoldTargets = getSelectedBoldTargets();
  const isSelectedBold = selectedBoldTargets.length > 0 && selectedBoldTargets.every(({ rowId, columns }) => {
    const row = rows.find(item => item.id === rowId);
    return Boolean(row && columns.every(col => row.boldCells?.includes(gridStyleKey(col))));
  });
  const toggleSelectedCellsBold = () => {
    if (selectedBoldTargets.length === 0) return;
    const makeBold = !isSelectedBold;
    const columnsByRow = new Map(selectedBoldTargets.map(target => [target.rowId, new Set(target.columns.map(gridStyleKey))]));
    const updatedRows = rows.map(row => {
      const keys = columnsByRow.get(row.id);
      if (!keys) return row;
      const next = new Set(row.boldCells || []);
      keys.forEach(key => makeBold ? next.add(key) : next.delete(key));
      return { ...row, boldCells: Array.from(next) };
    });
    setRows(updatedRows);
    saveBlueprintToServer(updatedRows, products, district, month);
    setSaveStatus(makeBold ? 'Bold formatting applied.' : 'Bold formatting removed.');
  };

  const getMergeRender = (rowIdx: number, colIdx: number) => {
    for (const merge of cellMerges) {
      if (merge.startCol > 3 || merge.endCol > 3 || merge.startCol > merge.endCol) continue;
      const visibleIndexes = merge.rowIds.map(id => filteredAndSortedRows.findIndex(row => row.id === id));
      if (visibleIndexes.some(index => index < 0) || visibleIndexes.some((index, offset) => offset > 0 && index !== visibleIndexes[offset - 1] + 1)) continue;
      const mergeTop = visibleIndexes[0];
      const mergeBottom = visibleIndexes[visibleIndexes.length - 1];
      if (rowIdx < mergeTop || rowIdx > mergeBottom || colIdx < merge.startCol || colIdx > merge.endCol) continue;
      if (rowIdx !== mergeTop || colIdx !== merge.startCol) return { hidden: true as const };
      return { hidden: false as const, rowSpan: visibleIndexes.length, colSpan: merge.endCol - merge.startCol + 1 };
    }
    return null;
  };
  const handleMergeSelectedCells = () => {
    const bounds = getCellRangeBounds();
    if (!bounds || bounds.lastCol > 3 || (bounds.firstRow === bounds.lastRow && bounds.firstCol === bounds.lastCol)) return;
    const rowIds = filteredAndSortedRows.slice(bounds.firstRow, bounds.lastRow + 1).map(row => row.id);
    const nextMerges = cellMerges.filter(merge => {
      const rowsOverlap = merge.rowIds.some(id => rowIds.includes(id));
      const columnsOverlap = merge.startCol <= bounds.lastCol && merge.endCol >= bounds.firstCol;
      return !(rowsOverlap && columnsOverlap);
    });
    nextMerges.push({ id: `merge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, rowIds, startCol: bounds.firstCol, endCol: bounds.lastCol });
    setCellMerges(nextMerges);
    saveBlueprintToServer(rows, products, district, month, nextMerges);
  };
  const handleUnmergeSelectedCells = () => {
    const bounds = getCellRangeBounds();
    if (!bounds) return;
    const selectedIds = new Set(filteredAndSortedRows.slice(bounds.firstRow, bounds.lastRow + 1).map(row => row.id));
    const nextMerges = cellMerges.filter(merge => !(merge.rowIds.some(id => selectedIds.has(id)) && merge.startCol <= bounds.lastCol && merge.endCol >= bounds.firstCol));
    if (nextMerges.length === cellMerges.length) return;
    setCellMerges(nextMerges);
    saveBlueprintToServer(rows, products, district, month, nextMerges);
  };
  const beginMovingSelectedCells = (startingCell?: { rowId: string; colIdx: number }) => {
    let bounds = getCellRangeBounds();
    if (startingCell) {
      const startRow = filteredAndSortedRows.findIndex(row => row.id === startingCell.rowId);
      const includesStart = Boolean(bounds && startRow >= bounds.firstRow && startRow <= bounds.lastRow && startingCell.colIdx >= bounds.firstCol && startingCell.colIdx <= bounds.lastCol);
      if (!includesStart && startRow >= 0) bounds = { firstRow: startRow, lastRow: startRow, firstCol: startingCell.colIdx, lastCol: startingCell.colIdx };
    }
    if (!bounds) return;
    const sourceRows = filteredAndSortedRows.slice(bounds.firstRow, bounds.lastRow + 1);
    const values = sourceRows.map(row => visibleColumns.filter(col => col >= bounds.firstCol && col <= bounds.lastCol).map(col => readGridCell(row, col)));
    const bolds = sourceRows.map(row => visibleColumns.filter(col => col >= bounds.firstCol && col <= bounds.lastCol).map(col => isGridCellBold(row.id, col)));
    const move = { values, bolds, sourceRowIds: sourceRows.map(row => row.id), sourceCol: bounds.firstCol, height: values.length, width: values[0]?.length || 0 };
    pendingCellMoveRef.current = move;
    setPendingCellMove(move);
    setSaveStatus('Move ready. Click the top-left destination cell.');
  };

  const finishMovingSelectedCells = (targetRowId: string, targetCol: number) => {
    const move = pendingCellMoveRef.current || pendingCellMove;
    if (!move) return;
    const targetRowIndex = filteredAndSortedRows.findIndex(row => row.id === targetRowId);
    if (targetRowIndex < 0 || targetRowIndex + move.height > filteredAndSortedRows.length) {
      setSaveStatus('Move canceled: the destination range extends past the visible rows.');
      clearPendingCellMove();
      return;
    }
    const sourceColumns = visibleColumns.slice(visibleColumns.indexOf(move.sourceCol), visibleColumns.indexOf(move.sourceCol) + move.width);
    const targetColumns = visibleColumns.slice(visibleColumns.indexOf(targetCol), visibleColumns.indexOf(targetCol) + move.width);
    if (targetCol < 0 || targetColumns.length < move.width) {
      setSaveStatus('Move canceled: the destination range extends past the last column.');
      clearPendingCellMove();
      return;
    }

    const sourceRows = move.sourceRowIds.map(id => filteredAndSortedRows.find(row => row.id === id)).filter((row): row is FacilityBlueprintRow => Boolean(row));
    const sourceRowIndex = filteredAndSortedRows.findIndex(row => row.id === move.sourceRowIds[0]);
    if (sourceRows.length !== move.height || sourceRowIndex < 0) {
      setSaveStatus('Move canceled: the source cells are no longer visible. Select the cells again and retry.');
      clearPendingCellMove();
      return;
    }
    if (sourceRowIndex === targetRowIndex && move.sourceCol === targetCol) {
      setSaveStatus('Move canceled: choose a different destination.');
      clearPendingCellMove();
      return;
    }
    const targetRows = filteredAndSortedRows.slice(targetRowIndex, targetRowIndex + move.height);
    const hasMergeOverlap = cellMerges.some(merge => {
      const sourceOverlap = merge.rowIds.some(id => move.sourceRowIds.includes(id)) && merge.startCol <= move.sourceCol + move.width - 1 && merge.endCol >= move.sourceCol;
      const targetIds = new Set(targetRows.map(row => row.id));
      const targetOverlap = merge.rowIds.some(id => targetIds.has(id)) && merge.startCol <= targetCol + move.width - 1 && merge.endCol >= targetCol;
      return sourceOverlap || targetOverlap;
    });
    if (hasMergeOverlap) {
      setSaveStatus('Move canceled: unmerge the source or destination cells first.');
      clearPendingCellMove();
      return;
    }

    const fieldKind = (col: number) => {
      if (col === 0 || col === 1) return 'date';
      if (col >= 2 && col <= 4) return 'text';
      if (col >= 5) {
        const subcolumn = (col - 5) % 4;
        return subcolumn === 3 ? 'balance' : `quantity_${subcolumn}`;
      }
      return 'invalid';
    };
    for (let rowOffset = 0; rowOffset < move.height; rowOffset++) {
      for (let colOffset = 0; colOffset < move.width; colOffset++) {
        const sourceKind = fieldKind(sourceColumns[colOffset]);
        const targetKind = fieldKind(targetColumns[colOffset]);
        if (sourceKind === 'balance' || targetKind === 'balance' || sourceKind === 'invalid' || targetKind === 'invalid') {
          setSaveStatus('Move canceled: calculated Balance cells cannot be moved.');
          clearPendingCellMove();
          return;
        }
      }
    }

    const nextRows = rows.map(row => ({ ...row, boldCells: [...(row.boldCells || [])], vaccines: { ...(row.vaccines || {}) } }));
    const rowById = new Map<string, FacilityBlueprintRow>(nextRows.map(row => [row.id, row]));
    const edits: Array<Record<string, unknown>> = [];
    const today = new Date().toISOString().slice(0, 10);
    let movedVaccineQuantity = false;
    const setValue = (row: FacilityBlueprintRow, col: number, value: string) => {
      if (col < 5) {
        const field = (['processing', 'completed', 'facility', 'subDistrict', 'deliverySite'] as const)[col];
        const oldValue = String(row[field] || '');
        if (oldValue !== value) edits.push({ facility: row.facility || value, field, oldValue, newValue: value, district, month, timestamp: new Date().toISOString() });
        row[field] = value;
        return;
      }
      const productIndex = Math.floor((col - 5) / 4);
      const subcolumn = (col - 5) % 4;
      const product = products[productIndex];
      if (!product || subcolumn === 3) return;
      const quantityField = (['carryOver', 'allocation', 'distributed'] as const)[subcolumn];
      const prior = row.vaccines[product] || {};
      const numericValue = value.trim() === '' || value.trim() === '-' || value.trim() === '—' ? '' : evaluateCellNumericInput(value, typeof prior[quantityField] === 'number' ? prior[quantityField] : '');
      if (numericValue === null) throw new Error(`“${value}” is not a valid quantity for this column.`);
      movedVaccineQuantity = true;
      const oldValue = prior[quantityField] ?? '';
      if (oldValue !== numericValue) edits.push({ facility: row.facility || 'Facility Row', field: quantityField, product, oldValue, newValue: numericValue, district, month, timestamp: new Date().toISOString() });
      row.vaccines[product] = { ...prior, [quantityField]: numericValue, balance: computeBalance(quantityField === 'carryOver' ? numericValue : prior.carryOver, quantityField === 'allocation' ? numericValue : prior.allocation, quantityField === 'distributed' ? numericValue : prior.distributed) };
    };

    try {
      // Clear the source range first, then write its saved values at the destination.
      for (let rowOffset = 0; rowOffset < move.height; rowOffset++) {
        const source = rowById.get(sourceRows[rowOffset]?.id);
        if (!source) throw new Error('The source rows changed. Select the cells again and retry.');
        for (let colOffset = 0; colOffset < move.width; colOffset++) setValue(source, sourceColumns[colOffset], '');
      }
      for (let rowOffset = 0; rowOffset < move.height; rowOffset++) {
        const destination = rowById.get(targetRows[rowOffset]?.id);
        if (!destination) throw new Error('The destination rows changed. Select a new destination.');
        for (let colOffset = 0; colOffset < move.width; colOffset++) setValue(destination, targetColumns[colOffset], move.values[rowOffset][colOffset]);
      }
      // Clear source styles before applying destination styles so overlapping moves
      // behave like a cut/paste and do not erase a style just moved into place.
      for (let rowOffset = 0; rowOffset < move.height; rowOffset++) {
        const source = rowById.get(sourceRows[rowOffset].id);
        if (source) {
          const sourceKeys = new Set(Array.from({ length: move.width }, (_, colOffset) => gridStyleKey(sourceColumns[colOffset])));
          source.boldCells = (source.boldCells || []).filter(key => !sourceKeys.has(key));
        }
      }
      for (let rowOffset = 0; rowOffset < move.height; rowOffset++) {
        const destination = rowById.get(targetRows[rowOffset].id);
        if (!destination) continue;
        for (let colOffset = 0; colOffset < move.width; colOffset++) {
          const targetKey = gridStyleKey(targetColumns[colOffset]);
          if (move.bolds[rowOffset]?.[colOffset]) destination.boldCells = Array.from(new Set([...(destination.boldCells || []), targetKey]));
          else destination.boldCells = (destination.boldCells || []).filter(key => key !== targetKey);
        }
      }
      // Do not let a move silently create an over-allocation that would require a DHD stock transaction.
      for (let rowOffset = 0; rowOffset < move.height; rowOffset++) {
        for (let colOffset = 0; colOffset < move.width; colOffset++) {
          const col = targetColumns[colOffset];
          if (fieldKind(col) !== 'quantity_2') continue;
          const product = products[Math.floor((col - 5) / 4)];
          const destination = rowById.get(targetRows[rowOffset].id);
          const v = destination?.vaccines[product] || {};
          if (typeof v.distributed === 'number' && v.distributed > (Number(v.carryOver) || 0) + (Number(v.allocation) || 0)) throw new Error(`Moving this distributed quantity would exceed ${destination?.facility || 'the destination facility'} allocation. Use the normal distribution edit to confirm any DHD top-up.`);
        }
      }
    } catch (error) {
      setSaveStatus(error instanceof Error ? `Move canceled: ${error.message}` : 'Move canceled.');
      clearPendingCellMove();
      return;
    }

    const touchedRows = new Set([...move.sourceRowIds, ...targetRows.map(row => row.id)]);
    const normalizedRows = nextRows.map(row => movedVaccineQuantity && touchedRows.has(row.id) ? normalizeFacilityProgress(row, products, today) : row);
    pendingEditsRef.current.push(...edits);
    setRows(normalizedRows);
    saveBlueprintToServer(normalizedRows, products, district, month);
    setSelectedCellRange({ anchorRowId: targetRows[0].id, anchorColIdx: targetCol, focusRowId: targetRows[move.height - 1].id, focusColIdx: targetColumns[move.width - 1] });
    clearPendingCellMove();
    setSaveStatus(`Moved ${move.height * move.width} cells.`);
  };

  const handleGridCellMouseDown = (event: React.MouseEvent<HTMLElement>, rowId: string, colIdx: number) => {
    if (event.button !== 0) { if (event.button === 2) preserveCellRangeRef.current = true; return; }
    if ((event.target as HTMLElement).closest('button')) return;
    if (pendingCellMove) {
      event.preventDefault();
      event.stopPropagation();
      finishMovingSelectedCells(rowId, colIdx);
      return;
    }
    if (event.altKey) {
      // Alt-drag from a cell moves the selected cell range; ordinary dragging
      // always starts or extends a highlight, including from the active cell.
      preserveCellRangeRef.current = true;
      return;
    }
    isDraggingGridRangeRef.current = true;
    preserveCellRangeRef.current = true;
    if (event.shiftKey && selectedCellRange) {
      setSelectedCellRange(previous => previous ? { ...previous, focusRowId: rowId, focusColIdx: colIdx } : previous);
    } else {
      setSelectedCellRange({ anchorRowId: rowId, anchorColIdx: colIdx, focusRowId: rowId, focusColIdx: colIdx });
    }
  };
  const handleGridCellMouseEnter = (rowId: string, colIdx: number) => {
    if (!isDraggingGridRangeRef.current) return;
    setSelectedCellRange(previous => previous
      ? { ...previous, focusRowId: rowId, focusColIdx: colIdx }
      : { anchorRowId: rowId, anchorColIdx: colIdx, focusRowId: rowId, focusColIdx: colIdx });
  };
  const updateGridCell = (rowId: string, colIdx: number, value: string) => {
    if (colIdx === 0) handleCellChange(rowId, 'processing', value);
    else if (colIdx === 1) handleCellChange(rowId, 'completed', value);
    else if (colIdx === 2) handleCellChange(rowId, 'facility', value);
    else if (colIdx === 3) handleCellChange(rowId, 'subDistrict', value);
    else if (colIdx === 4) handleCellChange(rowId, 'deliverySite', value);
    else {
      const product = products[Math.floor((colIdx - 5) / 4)];
      const subcolumn = (colIdx - 5) % 4;
      if (product && subcolumn < 3) handleCellChange(rowId, { vaccine: product, subCol: (['carryOver', 'allocation', 'distributed'] as const)[subcolumn] }, value);
    }
  };
  const readGridCell = (row: FacilityBlueprintRow, colIdx: number): string => {
    if (colIdx === 0) return row.processing || '';
    if (colIdx === 1) return row.completed || '';
    if (colIdx === 2) return row.facility || '';
    if (colIdx === 3) return row.subDistrict || '';
    if (colIdx === 4) return row.deliverySite || '';
    const productIndex = Math.floor((colIdx - 5) / 4);
    const subcolumn = (colIdx - 5) % 4;
    const value = row.vaccines[products[productIndex]];
    if (!value) return '';
    return String([value.carryOver, value.allocation, value.distributed, value.balance][subcolumn] ?? '');
  };
  const clearGridRange = (bounds: { firstRow: number; lastRow: number; firstCol: number; lastCol: number }) => {
    const selectedIds = new Set(filteredAndSortedRows.slice(bounds.firstRow, bounds.lastRow + 1).map(row => row.id));
    const edits: Array<Record<string, unknown>> = [];
    const updated = rows.map(row => {
      if (!selectedIds.has(row.id)) return row;
      const next: FacilityBlueprintRow = { ...row, vaccines: { ...row.vaccines } };
      for (let col = bounds.firstCol; col <= bounds.lastCol; col++) {
        if (isColumnDeleted(col)) continue;
        if (col < 5) {
          const field = (['processing', 'completed', 'facility', 'subDistrict', 'deliverySite'] as const)[col];
          const oldValue = next[field] || '';
          if (oldValue) {
            edits.push({ facility: next.facility, field, oldValue, newValue: '', district, month, timestamp: new Date().toISOString() });
            next[field] = '';
          }
          continue;
        }
        const productIndex = Math.floor((col - 5) / 4);
        const subcolumn = (col - 5) % 4;
        if (subcolumn === 3) continue; // Balance is calculated, never cleared directly.
        const product = products[productIndex];
        if (!product) continue;
        const field = (['carryOver', 'allocation', 'distributed'] as const)[subcolumn];
        const prior = next.vaccines[product] || {};
        const oldValue = prior[field] ?? '';
        if (oldValue !== '') edits.push({ facility: next.facility, field, product, oldValue, newValue: '', district, month, timestamp: new Date().toISOString() });
        next.vaccines[product] = { ...prior, [field]: '', balance: computeBalance(field === 'carryOver' ? '' : prior.carryOver, field === 'allocation' ? '' : prior.allocation, field === 'distributed' ? '' : prior.distributed) };
      }
      return normalizeFacilityProgress(next, products, new Date().toISOString().slice(0, 10));
    });
    pendingEditsRef.current.push(...edits);
    setRows(updated);
    saveBlueprintToServer(updated, products, district, month);
    setSaveStatus('Selected cells cleared');
  };

  const handleGridCellKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, rowId: string, colIdx: number) => {
    const command = event.ctrlKey || event.metaKey;
    const rangeBounds = getCellRangeBounds();
    if ((event.key === 'Delete' || event.key === 'Backspace') && rangeBounds && (rangeBounds.firstRow !== rangeBounds.lastRow || rangeBounds.firstCol !== rangeBounds.lastCol)) {
      event.preventDefault();
      clearGridRange(rangeBounds);
      return;
    }
    if (command && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleSelectedCellsBold();
      return;
    }
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) handleRedo(); else handleUndo();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      handleRedo();
      return;
    }
    if (event.key === 'Escape') {
      const original = cellEditOriginalRef.current;
      if (original?.key === gridCellKey(rowId, colIdx)) {
        event.preventDefault();
        updateGridCell(rowId, colIdx, original.value);
        event.currentTarget.blur();
      }
      return;
    }
    if (command && (event.key.toLowerCase() === 'c' || event.key.toLowerCase() === 'x')) {
      const input = event.currentTarget;
      const bounds = getCellRangeBounds();
      if (bounds && (bounds.firstRow !== bounds.lastRow || bounds.firstCol !== bounds.lastCol)) {
        const tsv = filteredAndSortedRows.slice(bounds.firstRow, bounds.lastRow + 1).map(row =>
          visibleColumns.filter(col => col >= bounds.firstCol && col <= bounds.lastCol).map(col => readGridCell(row, col)).join('\t')
        ).join('\n');
        event.preventDefault();
        if (!navigator.clipboard) {
          setSaveStatus('Clipboard access is unavailable in this browser.');
          return;
        }
        void navigator.clipboard.writeText(tsv).then(() => setSaveStatus(event.key.toLowerCase() === 'x' ? 'Selected cells cut' : 'Selected cells copied'));
        if (event.key.toLowerCase() === 'x') clearGridRange(bounds);
        return;
      }
      if (input.selectionStart !== input.selectionEnd) {
        if (event.key.toLowerCase() === 'c') return;
        // Native cut updates the controlled input and is saved through the normal edit path.
        return;
      }
      const row = rows.find(item => item.id === rowId);
      if (!row) return;
      event.preventDefault();
      const copiedValue = readGridCell(row, colIdx);
      if (navigator.clipboard) {
        void navigator.clipboard.writeText(copiedValue).then(() => setSaveStatus(event.key.toLowerCase() === 'x' ? 'Cell cut' : 'Cell copied'))
          .catch(() => setSaveStatus('Clipboard access failed.'));
      } else {
        setSaveStatus('Clipboard access is unavailable in this browser.');
      }
      if (event.key.toLowerCase() === 'x') updateGridCell(rowId, colIdx, '');
      return;
    }
    const navKeys = ['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!navKeys.includes(event.key)) return;
    const input = event.currentTarget;
    if (event.key === 'ArrowLeft' && !event.shiftKey && input.selectionStart !== input.selectionEnd) return;
    if (event.key === 'ArrowRight' && !event.shiftKey && input.selectionStart !== input.selectionEnd) return;
    if (event.key === 'ArrowLeft' && input.selectionStart !== 0 && input.selectionStart === input.selectionEnd) return;
    if (event.key === 'ArrowRight' && input.selectionEnd !== input.value.length && input.selectionStart === input.selectionEnd) return;

    const rowIndex = filteredAndSortedRows.findIndex(row => row.id === rowId);
    if (rowIndex < 0) return;
    const editableColumns = Array.from({ length: 5 + products.length * 4 }, (_, index) => index)
      .filter(index => !isColumnDeleted(index) && (index < 5 || (index - 5) % 4 !== 3));
    const columnIndex = editableColumns.indexOf(colIdx);
    if (columnIndex < 0) return;
    let nextRow = rowIndex;
    let nextColumn = columnIndex;
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      nextRow += event.shiftKey || event.key === 'ArrowUp' ? -1 : 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextColumn += event.key === 'ArrowLeft' || event.shiftKey ? -1 : 1;
      if (nextColumn >= editableColumns.length) { nextColumn = 0; nextRow += 1; }
      if (nextColumn < 0) { nextColumn = editableColumns.length - 1; nextRow -= 1; }
    } else {
      nextColumn += event.shiftKey ? -1 : 1;
      if (nextColumn >= editableColumns.length) { nextColumn = 0; nextRow += 1; }
      if (nextColumn < 0) { nextColumn = editableColumns.length - 1; nextRow -= 1; }
    }
    if (nextRow < 0) return;
    event.preventDefault();
    if (nextRow >= filteredAndSortedRows.length) {
      const newRowId = handleAddRow();
      window.setTimeout(() => focusGridCell(newRowId, editableColumns[nextColumn]), 0);
      return;
    }
    const nextRowId = filteredAndSortedRows[nextRow].id;
    if (event.shiftKey && event.key.startsWith('Arrow')) {
      const anchorRowId = selectedCellRange?.anchorRowId || rowId;
      const anchorColIdx = selectedCellRange?.anchorColIdx ?? colIdx;
      setSelectedCellRange({ anchorRowId, anchorColIdx, focusRowId: nextRowId, focusColIdx: editableColumns[nextColumn] });
      focusGridCell(nextRowId, editableColumns[nextColumn], true);
    } else {
      setSelectedCellRange({ anchorRowId: nextRowId, anchorColIdx: editableColumns[nextColumn], focusRowId: nextRowId, focusColIdx: editableColumns[nextColumn] });
      focusGridCell(nextRowId, editableColumns[nextColumn]);
    }
  };

  // Overall facility stats for quick status summary
  const facilityStats = useMemo(() => {
    let completedCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;
    const namedRows = rows.filter(r => r.facility && r.facility.trim().length > 0);
    namedRows.forEach(r => {
      if (isFacilityCompleted(r, products, allocationWorksheet)) completedCount++;
      else if (isFacilityInProgress(r, products, allocationWorksheet)) inProgressCount++;
      else if (isFacilityPending(r, products, allocationWorksheet)) pendingCount++;
    });
    const total = namedRows.length;
    const completionRate = total > 0 ? Math.round((completedCount / total) * 100) : 0;
    return { completedCount, inProgressCount, pendingCount, total, completionRate };
  }, [rows, products, allocationWorksheet]);

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

  // Four facility/date columns plus four columns per product.
  const totalColumnCount = visibleColumns.length;
  const visibleVaccineColumnCount = visibleColumns.filter(index => index >= 5).length;
  const visibleProductColumns = (index: number) => visibleColumns.filter(col => col >= 5 + index * 4 && col < 9 + index * 4);
  const lastColLetter = totalColumnCount ? getExcelColumnLetter(totalColumnCount - 1) : '';

  const isTopDownGridColumnSelected = (colIdx: number) => {
    const bounds = getCellRangeBounds();
    const extendsDownFromTop = Boolean(bounds && bounds.firstRow === 0 && (bounds.lastRow > 0 || filteredAndSortedRows.length === 1));
    return Boolean(extendsDownFromTop && bounds && colIdx >= bounds.firstCol && colIdx <= bounds.lastCol);
  };
  const getBlueprintHeaderCellStyle = (colIdx: number, rowFrozen: boolean): React.CSSProperties => ({
    ...getFreezeCellStyle(colIdx, rowFrozen),
    backgroundColor: isTopDownGridColumnSelected(colIdx) ? 'rgba(56, 189, 248, 0.72)' : undefined
  });
  const focusedCellInfo = getFocusedCellInfo();
  const renderBlueprintMenuItem = (label: string, action: (event: React.MouseEvent<HTMLButtonElement>) => void, disabled = false) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={event => { action(event); setActiveBlueprintMenu(null); }}
      className="block min-h-10 w-full rounded-md px-4 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-45"
    >{label}</button>
  );
  const selectAllBlueprintCells = () => {
    setAllCellsHighlighted(true);
    setSelectedRowIds(new Set(rows.map(row => row.id)));
    setSelectedColumnNames(new Set(products));
  };
  const printBlueprint = () => window.print();

  if (blueprintLoadError && districts.length === 0) {
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-3">
      <p className="text-sm text-red-800">{blueprintLoadError}</p>
      <button type="button" onClick={() => void loadBlueprintFromServer()} disabled={loading} className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? 'Loading…' : 'Retry loading Blueprint'}</button>
    </div>;
  }

  return (
    <div id="allocation-blueprint-print-root" className="flex flex-col gap-4 w-full bg-white rounded-3xl border border-slate-200 shadow-md p-4 sm:p-6 text-slate-800 antialiased">
      <style>{`@media print { body * { visibility: hidden !important; } #allocation-blueprint-print-root, #allocation-blueprint-print-root * { visibility: visible !important; } #allocation-blueprint-print-root { position: absolute; inset: 0; width: 100%; padding: 0; border: 0; box-shadow: none; } #allocation-blueprint-grid-scroll { max-height: none !important; overflow: visible !important; } }`}</style>
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
              Drag across cells to highlight a range, then use Bold or Ctrl+B to format it. Edit cells directly; paste Excel ranges with Ctrl+V. Use Tab to move across cells and Enter to move down. Balances and totals calculate automatically.
            </p>
          </div>
        </div>


      </div>

      <section ref={blueprintControlsRef} aria-label="Allocation Blueprint spreadsheet controls" className="sticky top-0 z-50 rounded-xl border-2 border-slate-300 bg-white shadow-md print:hidden">
        <div role="menubar" aria-label="Spreadsheet menus" className="relative z-10 flex min-h-12 flex-wrap items-center gap-1.5 overflow-visible border-b border-slate-200 bg-slate-50 px-3 py-1.5">
          {['File', 'Edit', 'View', 'Insert', 'Format', 'Data', 'Tools', 'Help'].map(menu => (
            <div className="relative shrink-0" key={menu}>
              <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={activeBlueprintMenu === menu} onClick={() => setActiveBlueprintMenu(current => current === menu ? null : menu)} className={`min-h-10 rounded-md px-3.5 py-2 text-sm font-semibold ${activeBlueprintMenu === menu ? 'bg-orange-100 text-[#9A4310]' : 'text-slate-800 hover:bg-slate-200'}`}>{menu}</button>
              {activeBlueprintMenu === menu && (
                <div role="menu" className="absolute left-0 top-full z-[90] mt-1 min-w-56 rounded-lg border border-slate-300 bg-white p-1.5 shadow-xl">
                  {menu === 'File' && <>
                    {renderBlueprintMenuItem('Upload Excel or CSV…', () => fileInputRef.current?.click())}
                    {renderBlueprintMenuItem('Download as Excel', () => handleExportExcel())}
                    {renderBlueprintMenuItem('Save changes', () => void handleSaveChanges(), !hasUnsavedChanges)}
                    {renderBlueprintMenuItem('Print current Blueprint', () => printBlueprint())}
                    {renderBlueprintMenuItem('New allocation sheet…', () => { setNewMonthName(getSuggestedNextMonth(month)); setMonthScope('current'); setShowAddMonthModal(true); })}
                  </>}
                  {menu === 'Edit' && <>
                    {renderBlueprintMenuItem('Undo', () => handleUndo(), undoStackRef.current.length === 0)}
                    {renderBlueprintMenuItem('Redo', () => handleRedo(), redoStackRef.current.length === 0)}
                    {renderBlueprintMenuItem('Select all cells', () => selectAllBlueprintCells())}
                  </>}
                  {menu === 'View' && <>
                    {renderBlueprintMenuItem(formulaBarVisible ? 'Hide formula bar' : 'Show formula bar', () => setFormulaBarVisible(visible => !visible))}
                    {renderBlueprintMenuItem('Freeze rows and columns…', event => openFreezeMenu(event, 'main'))}
                    <div className="my-1 border-t border-slate-100" />
                    {[50, 75, 90, 100, 125, 150, 200].map(level => renderBlueprintMenuItem(`Zoom ${level}%`, () => setZoomLevel(level)))}
                  </>}
                  {menu === 'Insert' && <>
                    {renderBlueprintMenuItem('Row above', () => handleInsertRow('above'), !getRowActionAnchor())}
                    {renderBlueprintMenuItem('Row below', () => handleInsertRow('below'), !getRowActionAnchor())}
                    {renderBlueprintMenuItem('New allocation sheet…', () => { setNewMonthName(getSuggestedNextMonth(month)); setMonthScope('current'); setShowAddMonthModal(true); })}
                  </>}
                  {menu === 'Format' && <>
                    {renderBlueprintMenuItem(isSelectedBold ? 'Remove bold' : 'Bold', () => toggleSelectedCellsBold(), selectedBoldTargets.length === 0)}
                    {renderBlueprintMenuItem('Merge selected cells', () => handleMergeSelectedCells(), !getCellRangeBounds() || (getCellRangeBounds()?.lastCol ?? 99) > 3)}
                    {renderBlueprintMenuItem('Unmerge selected cells', () => handleUnmergeSelectedCells(), cellMerges.length === 0)}
                    {renderBlueprintMenuItem(mergeHeaders ? 'Unmerge header cells' : 'Merge header cells', () => handleSetHeaderMerges(!mergeHeaders))}
                  </>}
                  {menu === 'Data' && <>
                    {renderBlueprintMenuItem('Sort facilities A–Z', () => { setSortField('facility'); setSortAsc(true); })}
                    {renderBlueprintMenuItem('Sort facilities Z–A', () => { setSortField('facility'); setSortAsc(false); })}
                    {renderBlueprintMenuItem('Find in sheet', () => searchInputRef.current?.focus())}
                  </>}
                  {menu === 'Tools' && <>
                    {renderBlueprintMenuItem('Sync to Order Checker', () => void handleSyncToOrderChecker(), loading)}
                    {renderBlueprintMenuItem('DHD stock and top-ups', () => { setDhdStockDraft(Object.fromEntries(products.map(product => [product, String(dhdStocks[product] ?? '')]))); setDhdStockError(null); setShowDhdStockModal(true); })}
                    {renderBlueprintMenuItem('Clear Blueprint data…', () => setShowClearModal(true))}
                    {onNavigateToChecker && renderBlueprintMenuItem('Compare orders in Checker', () => onNavigateToChecker())}
                  </>}
                  {menu === 'Help' && <>
                    {renderBlueprintMenuItem('Keyboard shortcuts and controls', () => setShowBlueprintHelp(true))}
                    {renderBlueprintMenuItem('About Allocation Blueprint', () => setSaveStatus('Allocation Blueprint manages vaccine facility allocations and automatically calculated balances.'))}
                  </>}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex min-h-14 items-center gap-2 overflow-x-auto border-b border-slate-200 px-3 py-2">
          <button type="button" onClick={handleUndo} disabled={undoStackRef.current.length === 0} title="Undo" className="min-h-10 min-w-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-base font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-45">↶</button>
          <button type="button" onClick={handleRedo} disabled={redoStackRef.current.length === 0} title="Redo" className="min-h-10 min-w-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-base font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-45">↷</button>
          <button type="button" onClick={printBlueprint} title="Print current Blueprint" className="min-h-10 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100">Print</button>
          <span className="mx-1 h-5 border-l border-slate-200" />
          <label className="sr-only" htmlFor="blueprint-zoom">Zoom</label>
          <select id="blueprint-zoom" value={zoomLevel} onChange={event => setZoomLevel(Number(event.target.value))} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800" aria-label="Spreadsheet zoom">
            {[50, 75, 90, 100, 125, 150, 200].map(level => <option key={level} value={level}>{level}%</option>)}
          </select>
          <button type="button" onClick={toggleSelectedCellsBold} disabled={selectedBoldTargets.length === 0} aria-pressed={isSelectedBold} title="Toggle bold on the selected cells" className={`min-h-10 min-w-10 rounded-md border px-3 py-2 text-sm font-black disabled:opacity-45 ${isSelectedBold ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-100'}`}>B</button>
          <button type="button" onClick={handleMergeSelectedCells} disabled={!getCellRangeBounds() || (getCellRangeBounds()?.lastCol ?? 99) > 3} title="Merge selected cells in columns A–D" className="min-h-10 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-45">Merge</button>
          <button type="button" onClick={handleUnmergeSelectedCells} disabled={cellMerges.length === 0} title="Unmerge selected cells" className="min-h-10 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-45">Unmerge</button>
          <button type="button" onClick={() => searchInputRef.current?.focus()} title="Find in sheet" className="min-h-10 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100">Find</button>
          {mergeHeaders ? <button type="button" onClick={() => handleSetHeaderMerges(false)} className="min-h-10 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100">Unmerge headers</button> : <button type="button" onClick={() => handleSetHeaderMerges(true)} className="min-h-10 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100">Merge headers</button>}
          <button type="button" onClick={event => openFreezeMenu(event, 'main')} className="min-h-10 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100">Freeze</button>
          <button type="button" onClick={() => setFormulaBarVisible(visible => !visible)} className="min-h-10 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100">fx</button>
          <button type="button" onClick={() => void handleSaveChanges()} disabled={!hasUnsavedChanges} title="Save changes" className="min-h-10 whitespace-nowrap rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-45">Save</button>
          <button type="button" onClick={() => fileInputRef.current?.click()} title="Upload Excel or CSV" className="min-h-10 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100">Upload</button>
          <button type="button" onClick={handleExportExcel} title="Download as Excel" className="min-h-10 whitespace-nowrap rounded-md bg-[#ED7D31] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#C55A11]">Download</button>
        </div>
        {formulaBarVisible && <div className="flex min-h-12 min-w-0 items-center gap-2 px-3 py-2">
          <span className="min-w-14 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-center text-sm font-semibold text-slate-800">{focusedCellInfo?.reference || ''}</span>
          <span className="px-1 text-sm italic text-slate-400">fx</span>
          <input
            aria-label="Selected cell formula or value"
            value={focusedCellInfo?.value || ''}
            onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); }}
            readOnly={!focusedCellInfo || focusedCellInfo.readOnly}
            onChange={event => {
              if (focusedCellInfo && !focusedCellInfo.readOnly && 'headerCell' in focusedCellInfo && focusedCellInfo.headerCell) handleHeaderLabelChange(focusedCellInfo.headerCell.row, focusedCellInfo.headerCell.col, event.target.value);
              else if (focusedCellInfo && !focusedCellInfo.readOnly && focusedCellInfo.field) handleCellChange(focusedCellInfo.rowId, focusedCellInfo.field, event.target.value);
            }}
            placeholder="Select a cell"
            className="min-h-9 min-w-0 flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-sky-500"
          />
        </div>}
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls,.csv" className="hidden" aria-label="Upload a Blueprint workbook" />
      </section>

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

            {saveStatus && (() => {
              const isError = /^(Save failed:|Invalid |Could not |Failed |Network |No complete |This workbook|Paste canceled:|The product )/i.test(saveStatus);
              return (
                <span className={`text-[11px] font-bold ${isError ? 'text-red-700 bg-red-50 border-red-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'} border px-2 py-1 rounded-lg flex items-center gap-1`} role={isError ? 'alert' : 'status'}>
                  {isError ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                  <span>{saveStatus}</span>
                </span>
              );
            })()}

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
              ref={searchInputRef}
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

        {/* Row & Column Add / Export Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleAddRow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Facility Row</span>
          </button>
          <button type="button" disabled={!getRowActionAnchor()} onClick={() => handleInsertRow('above')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 disabled:cursor-not-allowed" title="Insert a blank row above the selected row">Insert Above</button>
          <button type="button" disabled={!getRowActionAnchor()} onClick={() => handleInsertRow('below')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 disabled:cursor-not-allowed" title="Insert a blank row below the selected row">Insert Below</button>
          <button type="button" disabled={!getRowActionAnchor()} onClick={handleDuplicateRow} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 disabled:cursor-not-allowed" title="Duplicate the selected row">Duplicate Row</button>
          <button type="button" disabled={!getRowActionAnchor()} onClick={() => handleMoveRow(-1)} className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 disabled:cursor-not-allowed" title="Move selected row up">↑ Row</button>
          <button type="button" disabled={!getRowActionAnchor()} onClick={() => handleMoveRow(1)} className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 disabled:cursor-not-allowed" title="Move selected row down">↓ Row</button>

          <button
            type="button"
            onClick={() => handleAddMultipleBlankRows(5)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer border border-slate-300"
            title="Add 5 empty rows matching the blank rows in sample.xlsx"
          >
            <Plus className="w-3 h-3" />
            <span>+5 Blank Rows</span>
          </button>

          <div className="h-4 w-px bg-slate-300 mx-1 hidden sm:block" />

          <button
            type="button"
            onClick={() => setShowAddColumnModal(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-orange-100 hover:bg-orange-200 text-[#C55A11] text-xs font-bold rounded-xl transition-all cursor-pointer border border-orange-300"
            title="Add a vaccine or product column group with Carry-over, Allocation, Distributed, and Balance fields"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Add Column</span>
          </button>
          {selectedColumnNames.size === 1 && (() => {
            const selectedProduct: string = products.find(product => selectedColumnNames.has(product)) || '';
            const index = products.indexOf(selectedProduct);
            return <>
              <button type="button" onClick={() => { productInsertIndexRef.current = index; setShowAddColumnModal(true); }} className="px-2 py-1.5 bg-orange-50 hover:bg-orange-100 text-[#C55A11] text-xs font-bold rounded-xl border border-orange-200" title={`Insert a product column before ${selectedProduct}`}>Insert Left</button>
              <button type="button" onClick={() => { productInsertIndexRef.current = index + 1; setShowAddColumnModal(true); }} className="px-2 py-1.5 bg-orange-50 hover:bg-orange-100 text-[#C55A11] text-xs font-bold rounded-xl border border-orange-200" title={`Insert a product column after ${selectedProduct}`}>Insert Right</button>
              <button type="button" disabled={index <= 0} onClick={() => handleMoveProductGroup(selectedProduct, -1)} className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-300" title="Move selected product group left">← Column</button>
              <button type="button" disabled={index < 0 || index >= products.length - 1} onClick={() => handleMoveProductGroup(selectedProduct, 1)} className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-300" title="Move selected product group right">→ Column</button>
            </>;
          })()}

          <button
            type="button"
            onClick={handleSelectAllCells}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed text-sky-800 text-xs font-bold rounded-xl transition-all cursor-pointer border border-sky-300"
            title={rows.length === 0 ? 'Add a facility row before highlighting cells' : 'Highlight or clear every cell in the blueprint'}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{allCellsHighlighted ? 'Clear Cell Highlights' : 'Highlight All Cells'}</span>
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

          <span className="text-[10px] text-slate-500 max-w-36">Facility/date columns are required by allocation and order checks.</span>

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
        </div>
      </div>

      {/* Undo Notification Banner for Quick Restores */}
      {deletedHistory && (
        <div className="bg-slate-900/95 backdrop-blur text-white border border-slate-700 px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between flex-wrap gap-3 text-xs animate-in fade-in slide-in-from-top-2 z-50">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="font-bold text-slate-100">{deletedHistory.description}</span>
            <span className="text-slate-400 hidden sm:inline">• Blueprint saved</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUndoDeleted}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 active:scale-95 text-slate-950 font-black rounded-xl transition-all cursor-pointer shadow-md hover:scale-105"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Undo Delete</span>
            </button>
            <button
              type="button"
              onClick={() => setDeletedHistory(null)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Multi-Selection & Highlighting Action Banner (Excel / Google Sheets style) */}
      {(selectedRowIds.size > 0 || selectedColumnNames.size > 0) && (
        <div className="bg-sky-50 border-2 border-sky-300 rounded-2xl p-3 px-4 flex items-center justify-between flex-wrap gap-3 shadow-md animate-in fade-in slide-in-from-top-1 select-none">
          <div className="flex items-center gap-3 flex-wrap">
            {selectedRowIds.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-sky-200 text-sky-950 font-black text-xs rounded-lg">
                  <span className="w-2 h-2 rounded-full bg-sky-600 animate-pulse"></span>
                  {selectedRowIds.size} Row{selectedRowIds.size > 1 ? 's' : ''} Highlighted
                </span>
                <button
                  type="button"
                  onClick={handleClearSelectedRows}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold rounded-xl transition-all cursor-pointer border border-amber-300"
                  title="Clear data in highlighted rows without deleting them"
                >
                  <Eraser className="w-3 h-3 text-amber-700" />
                  <span>Clear Rows</span>
                </button>
                <button
                  type="button"
                  onClick={handleHideSelectedRows}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer border border-slate-300"
                  title="Hide selected rows without deleting their data"
                >
                  Hide Rows
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRowIds(new Set());
                    setLastSelectedRowId(null);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 font-semibold cursor-pointer underline ml-1"
                >
                  Deselect Rows
                </button>
              </div>
            )}

            {selectedRowIds.size > 0 && selectedColumnNames.size > 0 && (
              <div className="h-6 w-px bg-sky-300 hidden sm:block" />
            )}

            {selectedColumnNames.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-100 text-blue-950 font-black text-xs rounded-lg">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                  {selectedColumnNames.size} Column{selectedColumnNames.size > 1 ? 's' : ''} Highlighted:
                  <span className="font-bold text-blue-800 ml-1 truncate max-w-xs">
                    {Array.from(selectedColumnNames).join(', ')}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={handleClearSelectedColumns}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold rounded-xl transition-all cursor-pointer border border-amber-300"
                  title="Clear data in highlighted columns"
                >
                  <Eraser className="w-3 h-3 text-amber-700" />
                  <span>Clear Columns</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedColumnNames(new Set());
                    setLastSelectedColumnName(null);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 font-semibold cursor-pointer underline ml-1"
                >
                  Deselect Columns
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setSelectedRowIds(new Set());
                setLastSelectedRowId(null);
                setSelectedColumnNames(new Set());
                setLastSelectedColumnName(null);
              }}
              className="text-xs text-slate-600 hover:text-slate-900 font-bold cursor-pointer underline ml-1"
            >
              Deselect All
            </button>
          </div>

          <div className="text-[11px] text-slate-500 font-medium hidden md:block">
            Tip: Press <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-slate-700">Delete</kbd> or <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-slate-700">Backspace</kbd> to delete highlighted rows/columns
          </div>
        </div>
      )}

      {/* 
        =============================================================================
        ALLOCATION BLUEPRINT TABLE
        Row 1: Centered District + Month Title across vaccines
        Row 2: Processing, Completed, Facility, Sub-district, Delivery Site, VACCINES
        Row 3: Grouped vaccine headers (BCG, OPV, MR, PENTA, ...) 4 cols each
        Row 4: Carry-over, Allocation, Distributed, Balance
        Freeze panes are controlled by the Allocation Blueprint Freeze menu.
        =============================================================================
      */}
      <div className="relative border border-black rounded-2xl overflow-hidden shadow-inner bg-white">
        <div className="hidden">
          <button type="button" onClick={event => openFreezeMenu(event, 'main')} aria-haspopup="menu" aria-expanded={freezeMenu?.kind === 'main'} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 shadow-sm hover:bg-slate-100">Freeze ▾</button>
          <span className="text-[11px] text-slate-500">Rows frozen: {freezeRows} · Columns frozen: {freezeColumns}</span>
          {hiddenRowIds.length > 0 && <button type="button" onClick={handleUnhideAllRows} className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-900 hover:bg-amber-100">Unhide all ({hiddenRowIds.length})</button>}
          <div className="flex min-w-[260px] flex-1 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 shadow-sm" aria-label="Cell value bar">
            <span className="min-w-9 text-center text-[11px] font-bold text-slate-600">{focusedCellInfo?.reference || ''}</span>
            <span className="border-l border-slate-200 pl-2 text-xs italic text-slate-400">fx</span>
            <input
              aria-label="Selected cell value"
              value={focusedCellInfo?.value || ''}
              onKeyDown={event => event.stopPropagation()}
              readOnly={!focusedCellInfo || focusedCellInfo.readOnly}
              onChange={event => {
                if (focusedCellInfo && !focusedCellInfo.readOnly && 'headerCell' in focusedCellInfo && focusedCellInfo.headerCell) {
                  handleHeaderLabelChange(focusedCellInfo.headerCell.row, focusedCellInfo.headerCell.col, event.target.value);
                } else if (focusedCellInfo && !focusedCellInfo.readOnly && focusedCellInfo.field) {
                  handleCellChange(focusedCellInfo.rowId, focusedCellInfo.field, event.target.value);
                }
              }}
              placeholder={focusedCellInfo ? '' : 'Select a cell'}
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 outline-none read-only:text-slate-500"
            />
          </div>
          {freezeMenu && createPortal((
            <>
              <button type="button" className="fixed inset-0 z-[70] cursor-default" aria-label="Close Freeze menu" onClick={() => setFreezeMenu(null)} />
              <div role="menu" className="fixed z-[80] min-w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl" style={{ left: Math.max(8, Math.min(freezeMenu.x, window.innerWidth - 240)), top: Math.max(8, Math.min(freezeMenu.y, window.innerHeight - 300)) }} onClick={event => event.stopPropagation()}>
                {freezeMenu.kind !== 'column' && <div className="px-2.5 pb-1 pt-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Freeze Rows</div>}
                {freezeMenu.kind === 'main' && <>
                  <button role="menuitem" type="button" onClick={() => void persistFreezeSettings(0, freezeColumns)} className="freeze-menu-item">No rows</button>
                  <button role="menuitem" type="button" onClick={() => void persistFreezeSettings(1, freezeColumns)} className="freeze-menu-item">1 row</button>
                  <button role="menuitem" type="button" onClick={() => void persistFreezeSettings(2, freezeColumns)} className="freeze-menu-item">2 rows</button>
                  <button role="menuitem" type="button" disabled={!getCurrentSheetRow()} onClick={() => { const row = getCurrentSheetRow(); if (row) void persistFreezeSettings(row, freezeColumns); }} className="freeze-menu-item disabled:opacity-40">Up to current row{getCurrentSheetRow() ? ` (${getCurrentSheetRow()})` : ''}</button>
                  <div className="my-1 border-t border-slate-100" />
                </>}
                {freezeMenu.kind === 'row' && <>
                  {!!freezeMenu.rowIds?.length && <button role="menuitem" type="button" onClick={() => { handleDeleteSelectedRows(new Set(freezeMenu.rowIds)); setFreezeMenu(null); }} className="freeze-menu-item">{freezeMenu.rowIds.length > 1 ? `Delete selected rows (${freezeMenu.rowIds.length})` : 'Delete row'}</button>}
                  {!!freezeMenu.columnIndexes?.length && <button role="menuitem" type="button" onClick={() => handleDeleteGridColumns(freezeMenu.columnIndexes || [])} className="freeze-menu-item">{freezeMenu.columnIndexes.length > 1 ? `Delete selected columns (${freezeMenu.columnIndexes.length})` : `Delete column ${getSheetColumnLetter(freezeMenu.columnIndexes[0])}`}</button>}
                  <button role="menuitem" type="button" disabled={!freezeMenu.index} onClick={() => void persistFreezeSettings(freezeMenu.index || 0, freezeColumns)} className="freeze-menu-item disabled:opacity-40">Freeze up to row {freezeMenu.index}</button>
                  <button role="menuitem" type="button" onClick={() => void persistFreezeSettings(0, freezeColumns)} className="freeze-menu-item">Unfreeze rows</button>
                  <div className="my-1 border-t border-slate-100" />
                </>}
                {freezeMenu.kind !== 'row' && <div className="px-2.5 pb-1 pt-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Freeze Columns</div>}
                {freezeMenu.kind === 'main' && <>
                  <button role="menuitem" type="button" onClick={() => void persistFreezeSettings(freezeRows, 0)} className="freeze-menu-item">No columns</button>
                  <button role="menuitem" type="button" onClick={() => void persistFreezeSettings(freezeRows, 1)} className="freeze-menu-item">1 column</button>
                  <button role="menuitem" type="button" onClick={() => void persistFreezeSettings(freezeRows, 2)} className="freeze-menu-item">2 columns</button>
                  <button role="menuitem" type="button" disabled={focusedCell === null && activeHeaderCell === null} onClick={() => {
                    const currentColumn = focusedCell?.colIdx ?? activeHeaderCell?.col;
                    if (currentColumn !== undefined) void persistFreezeSettings(freezeRows, visibleColumns.indexOf(currentColumn) + 1);
                  }} className="freeze-menu-item disabled:opacity-40">Up to current column{focusedCell ? ` (${getSheetColumnLetter(focusedCell.colIdx)})` : activeHeaderCell ? ` (${getSheetColumnLetter(activeHeaderCell.col)})` : ''}</button>
                  <div className="my-1 border-t border-slate-200" />
                  <label htmlFor="freeze-column-count" className="block px-2.5 pb-1 pt-1 text-[11px] font-semibold text-slate-600">Freeze first N columns</label>
                  <div className="flex items-center gap-1.5 px-2 pb-1.5">
                    <input id="freeze-column-count" type="number" min={0} max={totalColumnCount} step={1} value={freezeColumnInput} onChange={event => setFreezeColumnInput(event.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-900" aria-label={`Number of columns to freeze, from 0 to ${totalColumnCount}`} />
                    <button type="button" disabled={!Number.isInteger(Number(freezeColumnInput)) || Number(freezeColumnInput) < 0 || Number(freezeColumnInput) > totalColumnCount} onClick={() => void persistFreezeSettings(freezeRows, Number(freezeColumnInput))} className="rounded-md bg-orange-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-40">Apply</button>
                  </div>
                </>}
                {freezeMenu.kind === 'column' && <>
                  <button role="menuitem" type="button" onClick={() => handleDeleteGridColumns(freezeMenu.columnIndexes || [])} className="freeze-menu-item">{(freezeMenu.columnIndexes?.length || 0) > 1 ? `Delete selected columns (${freezeMenu.columnIndexes?.length})` : `Delete column ${freezeMenu.index !== undefined ? getSheetColumnLetter(freezeMenu.index) : ''}`}</button>
                  <button role="menuitem" type="button" disabled={freezeMenu.index === undefined} onClick={() => freezeMenu.index !== undefined && void persistFreezeSettings(freezeRows, visibleColumns.indexOf(freezeMenu.index) + 1)} className="freeze-menu-item disabled:opacity-40">Freeze up to column {freezeMenu.index !== undefined ? getSheetColumnLetter(freezeMenu.index) : ''}</button>
                  <button role="menuitem" type="button" onClick={() => void persistFreezeSettings(freezeRows, 0)} className="freeze-menu-item">Unfreeze columns</button>
                </>}
              </div>
            </>
          ), document.body)}
        </div>
        <style>{`.allocation-blueprint-scroll::-webkit-scrollbar { display: none; } .allocation-blueprint-scroll { scrollbar-width: none; -ms-overflow-style: none; } .freeze-menu-item { display:block; width:100%; border-radius:.5rem; padding:.45rem .65rem; text-align:left; font-size:11px; font-weight:600; color:#334155; } .freeze-menu-item:hover:not(:disabled) { background:#f1f5f9; }`}</style>
        <div role="tablist" aria-label="Allocation Blueprint worksheets" className="flex min-w-0 gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 pt-2">
          {districts.map(sheet => (
            <button
              key={sheet.id}
              type="button"
              role="tab"
              aria-selected={sheet.id === activeDistrictId}
              onClick={() => handleSwitchDistrict(sheet.id)}
              className={`max-w-[220px] shrink-0 truncate rounded-t-lg border border-b-0 px-3 py-2 text-xs transition-colors ${sheet.id === activeDistrictId ? 'border-slate-300 bg-white font-bold text-[#C55A11]' : 'border-transparent text-slate-600 hover:bg-white hover:text-slate-900'}`}
              title={`${sheet.district} · ${sheet.month}`}
            >
              {sheet.sheetName || `${sheet.district} · ${sheet.month}`}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-stretch">
          <div
            id="allocation-blueprint-grid-scroll"
            ref={gridScrollRef}
            onScroll={syncGridScrollMetrics}
            className="allocation-blueprint-scroll min-w-0 flex-1 overflow-auto max-h-[680px]"
          >
            <style>{`[data-blueprint-bold="true"], [data-blueprint-bold="true"] input { font-weight: 700 !important; }`}</style>
            <table ref={blueprintTableRef} style={{ zoom: zoomLevel / 100 }} className="w-full text-left border-collapse select-text text-xs">
            {/* Table Header Section */}
            <thead className="font-sans">
              {/* ========================================================= */}
              {/* ROW 1: DISTRICT & MONTH TITLE BANNER                     */}
              {/* ========================================================= */}
              <tr data-sheet-row-index={1} onContextMenu={event => openFreezeMenu(event, 'row', 1)} style={freezeRows >= 1 ? { position: 'sticky', top: `${freezeRowOffsets[1] ?? 0}px`, zIndex: 40, boxShadow: freezeRows === 1 ? 'inset 0 -2px 0 #64748b' : undefined } : undefined} className="bg-[#ED7D31] text-white border-b border-black">
                {/* Date and facility columns frozen in Row 1 */}
                <th
                  className="sticky left-0 z-40 bg-[#ED7D31] border-r border-black py-2.5 px-2 text-center w-[140px] min-w-[140px] text-[10px] font-bold text-orange-100"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 0)} style={getBlueprintHeaderCellStyle(0, freezeRows >= 1)} onContextMenu={event => openFreezeMenu(event, 'column', 0)}>
                  {headerLabelInput(1, 0, 'Col A')}
                </th>
                <th
                  className="sticky left-[140px] z-40 bg-[#ED7D31] border-r border-black py-2.5 px-2 text-center w-[140px] min-w-[140px] text-[10px] font-bold text-orange-100"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 1)} style={getBlueprintHeaderCellStyle(1, freezeRows >= 1)} onContextMenu={event => openFreezeMenu(event, 'column', 1)}>
                  {headerLabelInput(1, 1, 'Col B')}
                </th>
                <th
                  className="sticky left-[280px] z-40 bg-[#ED7D31] border-r-2 border-black py-2.5 px-3 text-center w-[230px] min-w-[230px] text-[10px] font-bold text-orange-100"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 2)} style={getBlueprintHeaderCellStyle(2, freezeRows >= 1)} onContextMenu={event => openFreezeMenu(event, 'column', 2)}>
                  {headerLabelInput(1, 2, 'Col C')}
                </th>

                <th className="sticky left-[510px] z-40 bg-[#ED7D31] border-r border-black py-2.5 px-2 text-center w-[160px] min-w-[160px] text-[10px] font-bold text-orange-100" scope="col" onMouseDown={event => handleGridColumnHeaderMouseDown(event, 3)} style={getBlueprintHeaderCellStyle(3, freezeRows >= 1)} onContextMenu={event => openFreezeMenu(event, 'column', 3)}>{headerLabelInput(1, 3, 'Col D')}</th>
                <th
                  className="sticky left-[670px] z-40 bg-[#ED7D31] border-r-2 border-black py-2.5 px-2 text-center w-[200px] min-w-[200px] text-[10px] font-bold text-orange-100"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 4)} style={getBlueprintHeaderCellStyle(4, freezeRows >= 1)} onContextMenu={event => openFreezeMenu(event, 'column', 4)}>
                  {headerLabelInput(1, 4, 'Col E')}
                </th>

                {/* Merged Title across all vaccine columns (starting in Col F) */}
                <th
                  colSpan={mergeHeaders ? Math.max(1, visibleVaccineColumnCount) : 1} style={{ display: visibleVaccineColumnCount ? undefined : 'none' }}
                  className="bg-[#ED7D31] text-white py-2.5 px-4 text-center font-black tracking-widest text-sm sm:text-base uppercase border-r border-black"
                  scope="col"
                >
                  {district} {month}
                </th>
                {!mergeHeaders && Array.from({ length: Math.max(0, visibleVaccineColumnCount - 1) }, (_, index) => <th key={`title-unmerged-${index}`} className="bg-[#ED7D31] border-r border-black" />)}
              </tr>

              {/* ========================================================= */}
              {/* ROW 2: PROCESSING, COMPLETED, FACILITY, VACCINES          */}
              {/* ========================================================= */}
              <tr data-sheet-row-index={2} onContextMenu={event => openFreezeMenu(event, 'row', 2)} style={freezeRows >= 2 ? { position: 'sticky', top: `${freezeRowOffsets[2] ?? 0}px`, zIndex: 40, boxShadow: freezeRows === 2 ? 'inset 0 -2px 0 #64748b' : undefined } : undefined} className="bg-[#F8CBAD] text-slate-900 border-b border-black text-xs font-black uppercase tracking-wider">
                {/* Col A: Processing / Start Date */}
                <th
                  className="sticky left-0 z-40 bg-[#ED7D31] text-white border-r border-black py-2.5 px-2 text-center w-[140px] min-w-[140px]"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 0)} style={getBlueprintHeaderCellStyle(0, freezeRows >= 2)} onContextMenu={event => openFreezeMenu(event, 'column', 0)}>
                  {headerLabelInput(2, 0, 'Start Date')}
                </th>

                {/* Col B: Completed Date */}
                <th
                  className="sticky left-[140px] z-40 bg-[#ED7D31] text-white border-r border-black py-2.5 px-2 text-center w-[140px] min-w-[140px]"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 1)} style={getBlueprintHeaderCellStyle(1, freezeRows >= 2)} onContextMenu={event => openFreezeMenu(event, 'column', 1)}>
                  {headerLabelInput(2, 1, 'Completed Date')}
                </th>

                {/* Col C: Facility */}
                <th
                  className="sticky left-[280px] z-40 bg-[#ED7D31] text-white border-r-2 border-black py-2.5 px-3 text-center w-[230px] min-w-[230px]"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 2)} style={getBlueprintHeaderCellStyle(2, freezeRows >= 2)} onContextMenu={event => openFreezeMenu(event, 'column', 2)}>
                  {headerLabelInput(2, 2, 'Facility')}
                </th>

                <th className="sticky left-[510px] z-40 bg-[#ED7D31] text-white border-r border-black py-2.5 px-2 text-center w-[160px] min-w-[160px]" scope="col" onMouseDown={event => handleGridColumnHeaderMouseDown(event, 3)} style={getBlueprintHeaderCellStyle(3, freezeRows >= 2)} onContextMenu={event => openFreezeMenu(event, 'column', 3)}>{headerLabelInput(2, 3, 'Sub-district')}</th>
                <th
                  className="sticky left-[670px] z-40 bg-[#ED7D31] text-white border-r-2 border-black py-2.5 px-2 text-center w-[200px] min-w-[200px]"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 4)} style={getBlueprintHeaderCellStyle(4, freezeRows >= 2)} onContextMenu={event => openFreezeMenu(event, 'column', 4)}>
                  {headerLabelInput(2, 4, 'Delivery Site')}
                </th>

                {/* Merged VACCINES header spanning all vaccine columns */}
                <th
                  colSpan={mergeHeaders ? Math.max(1, visibleVaccineColumnCount) : 1} style={{ display: visibleVaccineColumnCount ? undefined : 'none' }}
                  className="bg-[#F8CBAD] text-slate-950 py-2 px-4 text-center font-black text-xs tracking-widest border-r border-black"
                  scope="col"
                >
                  <div className="flex items-center justify-center gap-2.5">
                    <span>VACCINES</span>
                    <button
                      type="button"
                      onClick={handleSelectAllColumns}
                      className="text-[10px] px-2 py-0.5 rounded bg-orange-200 hover:bg-orange-300 text-slate-900 font-extrabold transition-colors cursor-pointer border border-orange-400/50 select-none"
                      title={isAllSheetColumnsHighlighted() ? 'Deselect all columns, including the frozen fields' : 'Highlight every sheet column, including the frozen fields'}
                    >
                      {isAllSheetColumnsHighlighted() ? 'Deselect All Sheet Columns' : 'Highlight All Sheet Columns'}
                    </button>
                  </div>
                </th>
                {!mergeHeaders && Array.from({ length: Math.max(0, visibleVaccineColumnCount - 1) }, (_, index) => <th key={`vaccines-unmerged-${index}`} className="bg-[#F8CBAD] border-r border-black" />)}
              </tr>

              {/* ========================================================= */}
              {/* ROW 3: GROUPED VACCINE HEADERS (4 COLUMNS EACH)           */}
              {/* ========================================================= */}
              <tr data-sheet-row-index={3} onContextMenu={event => openFreezeMenu(event, 'row', 3)} style={freezeRows >= 3 ? { position: 'sticky', top: `${freezeRowOffsets[3] ?? 0}px`, zIndex: 40, boxShadow: freezeRows === 3 ? 'inset 0 -2px 0 #64748b' : undefined } : undefined} className="bg-[#FCE4D6] text-slate-900 border-b border-black text-[11px] font-black text-center">
                {/* Frozen column placeholders */}
                <th
                  className="sticky left-0 z-40 bg-[#FFF2CC] border-r border-black py-1.5 px-2 text-[10px] text-slate-600 font-bold"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 0)} style={getBlueprintHeaderCellStyle(0, freezeRows >= 3)} onContextMenu={event => openFreezeMenu(event, 'column', 0)}>
                  {headerLabelInput(3, 0, 'Started / In-Prog')}
                </th>
                <th
                  className="sticky left-[140px] z-40 bg-[#FFF2CC] border-r border-black py-1.5 px-2 text-[10px] text-slate-600 font-bold"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 1)} style={getBlueprintHeaderCellStyle(1, freezeRows >= 3)} onContextMenu={event => openFreezeMenu(event, 'column', 1)}>
                  {headerLabelInput(3, 1, 'Completed Date')}
                </th>
                <th
                  className="sticky left-[280px] z-40 bg-[#FFF2CC] border-r-2 border-black py-1.5 px-3 text-[10px] text-slate-600 font-bold"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 2)} style={getBlueprintHeaderCellStyle(2, freezeRows >= 3)} onContextMenu={event => openFreezeMenu(event, 'column', 2)}>
                  {headerLabelInput(3, 2, 'Facility Name')}
                </th>

                <th className="sticky left-[510px] z-40 bg-[#FFF2CC] border-r border-black py-1.5 px-2 text-[10px] text-slate-600 font-bold w-[160px] min-w-[160px]" scope="col" onMouseDown={event => handleGridColumnHeaderMouseDown(event, 3)} style={getBlueprintHeaderCellStyle(3, freezeRows >= 3)} onContextMenu={event => openFreezeMenu(event, 'column', 3)}>{headerLabelInput(3, 3, 'Sub-district')}</th>
                <th
                  className="sticky left-[670px] z-40 bg-[#FFF2CC] border-r-2 border-black py-1.5 px-2 text-[10px] text-slate-600 font-bold"
                  scope="col"
                 onMouseDown={event => handleGridColumnHeaderMouseDown(event, 4)} style={getBlueprintHeaderCellStyle(4, freezeRows >= 3)} onContextMenu={event => openFreezeMenu(event, 'column', 4)}>
                  {headerLabelInput(3, 4, 'Delivery Site')}
                </th>

                {/* 4 columns for each product */}
                {products.map((pName, pIdx) => {
                  const startColLetter = getSheetColumnLetter(visibleProductColumns(pIdx)[0]);
                  const endColLetter = getSheetColumnLetter(visibleProductColumns(pIdx).at(-1)!);
                  const isColSelected = allCellsHighlighted || selectedColumnNames.has(pName);

                  return (
                    <React.Fragment key={pName}>
                    <th
                      colSpan={mergeHeaders ? Math.max(1, visibleProductColumns(pIdx).length) : 1}
                      style={{ width: Math.max(50, (productGroupWidths[pName] ?? 328) / 4) * visibleProductColumns(pIdx).length, minWidth: Math.max(50, (productGroupWidths[pName] ?? 328) / 4) * visibleProductColumns(pIdx).length, ...getFreezeCellStyle(visibleProductColumns(pIdx).every(index => visibleColumns.indexOf(index) < freezeColumns) ? 5 + pIdx * 4 : Number.MAX_SAFE_INTEGER, freezeRows >= 3), display: visibleProductColumns(pIdx).length ? undefined : 'none' }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => reorderProductGroup(e, pName)}
                      onContextMenu={event => openFreezeMenu(event, 'column', visibleProductColumns(pIdx)[0], visibleProductColumns(pIdx))}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        const targetTag = target.tagName;
                        if (targetTag !== 'BUTTON' && targetTag !== 'INPUT' && !target.closest('[data-reorder-handle]')) {
                          handleToggleColumnSelect(pName, e);
                        }
                      }}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        const target = e.target as HTMLElement;
                        const targetTag = target.tagName;
                        if (targetTag !== 'BUTTON' && targetTag !== 'INPUT' && !target.closest('[data-reorder-handle]')) {
                          setIsMouseDownOnColHeader(true);
                        }
                      }}
                      onMouseEnter={() => {
                        if (isMouseDownOnColHeader) {
                          setSelectedColumnNames(prev => new Set(prev).add(pName));
                        }
                      }}
                      className={`${
                        isColSelected
                          ? 'bg-blue-600 text-white border-blue-700 ring-2 ring-blue-400 z-10 shadow-sm'
                          : 'bg-[#F8CBAD] hover:bg-[#f5c1a3] text-slate-950'
                      } py-1.5 px-2 border-r border-black font-black uppercase text-center relative group cursor-pointer transition-colors select-none`}
                      scope="col"
                      title={`Click or drag to highlight column "${pName}" (${startColLetter}:${endColLetter}). Shift-click for range selection.`}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={isColSelected}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleColumnSelect(pName, e);
                          }}
                          onChange={() => {}}
                          className="accent-blue-600 rounded cursor-pointer w-3.5 h-3.5"
                          title="Select / highlight this column group (Shift-click for range)"
                        />
                        {editingProductNameFor === pName ? (
                          <input
                            type="text"
                            value={productNameDraft}
                            onChange={e => setProductNameDraft(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            onBlur={() => {
                              if (productRenameCanceledRef.current) {
                                productRenameCanceledRef.current = false;
                                setEditingProductNameFor(null);
                              } else {
                                handleRenameProductGroup(pName, productNameDraft);
                              }
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') {
                                productRenameCanceledRef.current = true;
                                e.currentTarget.blur();
                              }
                            }}
                            className="w-24 sm:w-32 px-1 py-0.5 bg-white text-slate-900 text-xs font-bold rounded border border-orange-300 focus:outline-none focus:ring-1 focus:ring-orange-500"
                            aria-label={`Rename ${pName} product column`}
                            autoFocus
                          />
                        ) : (
                          <>
                            <span
                              data-reorder-handle
                              draggable
                              onClick={e => e.stopPropagation()}
                              onDragEnd={() => { draggedProductRef.current = null; }}
                              onDragStart={e => {
                                draggedProductRef.current = pName;
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', pName);
                              }}
                              className="cursor-grab active:cursor-grabbing px-0.5 text-slate-500 hover:text-slate-900"
                              title={`Drag to move ${pName} vaccine columns`}
                              aria-label={`Drag to move ${pName} vaccine columns`}
                            >⠿</span>
                            <span className="font-extrabold">{pName}</span>
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                productRenameCanceledRef.current = false;
                                setProductNameDraft(pName);
                                setEditingProductNameFor(pName);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-500 hover:text-slate-900 hover:bg-white/70 transition-opacity cursor-pointer"
                              title={`Rename product column "${pName}"`}
                              aria-label={`Rename product column ${pName}`}
                            >
                              <Pencil className="w-2.5 h-2.5" />
                            </button>
                          </>
                        )}
                        <span className={`text-[9px] font-normal ${isColSelected ? 'text-blue-100' : 'text-slate-600'}`}>
                          ({startColLetter}:{endColLetter})
                        </span>
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-orange-500/60"
                          title={`Drag to resize ${pName} columns`}
                          onClick={e => e.stopPropagation()}
                          onMouseDown={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            resizeProductRef.current = { name: pName, startX: e.clientX, startWidth: productGroupWidths[pName] ?? 328 };
                          }}
                        />
                        {/* Option to clear entire product column group */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClearColumn({ vaccine: pName, subCol: 'all' });
                          }}
                          className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity cursor-pointer ml-0.5 ${
                            isColSelected ? 'text-blue-100 hover:text-white hover:bg-blue-700' : 'text-slate-500 hover:text-amber-700 hover:bg-amber-100/80'
                          }`}
                          title={`Clear all data in ${pName} across all rows`}
                        >
                          <Eraser className="w-2.5 h-2.5" />
                        </button>
                        
                      </div>
                    </th>
                    {!mergeHeaders && Array.from({ length: Math.max(0, visibleProductColumns(pIdx).length - 1) }, (_, index) => <th key={`${pName}-unmerged-${index}`} className="bg-[#F8CBAD] border-r border-black" />)}
                    </React.Fragment>
                  );
                })}
              </tr>

              {/* ========================================================= */}
              {/* ROW 4: SUBCOLUMNS (Carry-over, Allocation, Dist, Balance)   */}
              {/* ========================================================= */}
              <tr data-sheet-row-index={4} onContextMenu={event => openFreezeMenu(event, 'row', 4)} style={freezeRows >= 4 ? { position: 'sticky', top: `${freezeRowOffsets[4] ?? 0}px`, zIndex: 40, boxShadow: freezeRows === 4 ? 'inset 0 -2px 0 #64748b' : undefined } : undefined} className="bg-[#FFF2CC] text-slate-900 border-b-2 border-black text-[10.5px] font-black text-center uppercase tracking-tight">
                {/* Frozen column headers */}
                <th
                  className="sticky left-0 z-40 bg-[#FFF2CC] border-r border-black py-2 px-2 text-center w-[140px] min-w-[140px] group/colH select-none cursor-pointer"
                  onClick={e => { if (!(e.target as HTMLElement).closest('button,input')) handleSelectGridColumn(0, e); }} onMouseDown={e => handleGridColumnHeaderMouseDown(e, 0)} style={getBlueprintHeaderCellStyle(0, freezeRows >= 4)} onContextMenu={event => openFreezeMenu(event, 'column', 0)}
                  scope="col"
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selectedRowIds.size === rows.length}
                      onChange={handleSelectAllRows}
                      className="accent-[#ED7D31] rounded shrink-0 cursor-pointer w-3.5 h-3.5"
                      title={selectedRowIds.size === rows.length ? 'Deselect all rows' : 'Highlight all rows'}
                    />
                    {headerLabelInput(4, 0, 'Start Date')}
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
                  className="sticky left-[140px] z-40 bg-[#FFF2CC] border-r border-black py-2 px-2 text-center w-[140px] min-w-[140px] group/colH cursor-pointer"
                  onClick={e => { if (!(e.target as HTMLElement).closest('button,input')) handleSelectGridColumn(1, e); }} onMouseDown={e => handleGridColumnHeaderMouseDown(e, 1)} style={getBlueprintHeaderCellStyle(1, freezeRows >= 4)} onContextMenu={event => openFreezeMenu(event, 'column', 1)}
                  scope="col"
                >
                  <div className="flex items-center justify-center gap-1">
                    {headerLabelInput(4, 1, 'Completed')}
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
                  className="sticky left-[280px] z-40 bg-[#FFF2CC] border-r-2 border-black py-2 px-3 text-left w-[230px] min-w-[230px] group/colH cursor-pointer"
                  onClick={e => { if (!(e.target as HTMLElement).closest('button,input')) handleSelectGridColumn(2, e); }} onMouseDown={e => handleGridColumnHeaderMouseDown(e, 2)} style={getBlueprintHeaderCellStyle(2, freezeRows >= 4)} onContextMenu={event => openFreezeMenu(event, 'column', 2)}
                  scope="col"
                >
                  <div className="flex items-center justify-between">
                    {headerLabelInput(4, 2, 'Facility Name')}
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

                <th onClick={e => handleSelectGridColumn(3, e)} onMouseDown={e => handleGridColumnHeaderMouseDown(e, 3)} onContextMenu={event => openFreezeMenu(event, 'column', 3)} style={getBlueprintHeaderCellStyle(3, freezeRows >= 4)} className="sticky left-[510px] z-40 bg-[#FFF2CC] border-r border-black py-2 px-2 text-left w-[160px] min-w-[160px] cursor-pointer" title="Click to highlight this full frozen column; drag a highlighted cell to move its values">{headerLabelInput(4, 3, 'Sub-district')}</th>
                <th
                  className="sticky left-[670px] z-40 bg-[#FFF2CC] border-r-2 border-black py-2 px-2 text-left w-[200px] min-w-[200px] group/colH cursor-pointer"
                  onClick={e => { if (!(e.target as HTMLElement).closest('button,input')) handleSelectGridColumn(4, e); }} onMouseDown={e => handleGridColumnHeaderMouseDown(e, 4)} style={getBlueprintHeaderCellStyle(4, freezeRows >= 4)} onContextMenu={event => openFreezeMenu(event, 'column', 4)}
                  scope="col"
                >
                  <div className="flex items-center justify-between">
                    {headerLabelInput(4, 4, 'Delivery Site')}
                    <button
                      type="button"
                      onClick={() => handleClearColumn('deliverySite')}
                      className="opacity-0 group-hover/colH:opacity-100 text-slate-400 hover:text-rose-600 transition-opacity cursor-pointer p-0.5 rounded"
                      title="Clear Delivery Sites across all rows"
                    >
                      <Eraser className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </th>

                {/* Subcolumns for each vaccine: Carry-over, Allocation, Distributed, Balance */}
                {products.map((pName, pIdx) => {
                  const isColSelected = allCellsHighlighted || selectedColumnNames.has(pName);
                  const subcolumnWidth = Math.max(50, (productGroupWidths[pName] ?? 328) / 4);
                  const subHeaderBg = isColSelected
                    ? 'bg-sky-200 text-sky-950 font-black border-sky-400'
                    : 'bg-[#FFF2CC] text-slate-800 border-slate-400';
                  const balHeaderBg = isColSelected
                    ? 'bg-sky-300 text-sky-950 font-black border-sky-400'
                    : 'bg-[#FCE4D6] text-[#C55A11] font-black';

                  const handleSubColClick = (e: React.MouseEvent) => {
                    const targetTag = (e.target as HTMLElement).tagName;
                    if (targetTag !== 'BUTTON' && targetTag !== 'INPUT') {
                      handleToggleColumnSelect(pName, e);
                    }
                  };

                  return (
                    <React.Fragment key={pName}>
                      <th
                        onContextMenu={event => openFreezeMenu(event, 'column', 5 + pIdx * 4 + 0)} onClick={handleSubColClick} onMouseDown={event => handleGridColumnHeaderMouseDown(event, 5 + pIdx * 4 + 0)}
                        className={`${subHeaderBg} border-r py-2 px-1 text-center w-[82px] min-w-[82px] group/subCol transition-colors cursor-pointer select-none`}
                        style={ { width: subcolumnWidth, minWidth: subcolumnWidth, ...getFreezeCellStyle(5 + pIdx * 4 + 0, freezeRows >= 4), backgroundColor: isTopDownGridColumnSelected(5 + pIdx * 4 + 0) ? 'rgba(56, 189, 248, 0.72)' : undefined } }
                        scope="col"
                        title={`Click to highlight column group "${pName}". Shift-click for range.`}
                      >
                        <div className="flex items-center justify-center gap-0.5">
                          <span>Carry-over</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClearColumn({ vaccine: pName, subCol: 'carryOver' });
                            }}
                            className="opacity-0 group-hover/subCol:opacity-100 text-slate-400 hover:text-rose-600 cursor-pointer p-0.5 transition-opacity"
                            title={`Clear ${pName} Carry-over across all rows`}
                          >
                            <Eraser className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </th>
                      <th
                        onContextMenu={event => openFreezeMenu(event, 'column', 5 + pIdx * 4 + 1)} onClick={handleSubColClick} onMouseDown={event => handleGridColumnHeaderMouseDown(event, 5 + pIdx * 4 + 1)}
                        className={`${subHeaderBg} border-r py-2 px-1 text-center w-[82px] min-w-[82px] group/subCol transition-colors cursor-pointer select-none`}
                        style={ { width: subcolumnWidth, minWidth: subcolumnWidth, ...getFreezeCellStyle(5 + pIdx * 4 + 1, freezeRows >= 4), backgroundColor: isTopDownGridColumnSelected(5 + pIdx * 4 + 1) ? 'rgba(56, 189, 248, 0.72)' : undefined } }
                        scope="col"
                        title={`Click to highlight column group "${pName}". Shift-click for range.`}
                      >
                        <div className="flex items-center justify-center gap-0.5">
                          <span>Allocation</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClearColumn({ vaccine: pName, subCol: 'allocation' });
                            }}
                            className="opacity-0 group-hover/subCol:opacity-100 text-slate-400 hover:text-rose-600 cursor-pointer p-0.5 transition-opacity"
                            title={`Clear ${pName} Allocation across all rows`}
                          >
                            <Eraser className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </th>
                      <th
                        onContextMenu={event => openFreezeMenu(event, 'column', 5 + pIdx * 4 + 2)} onClick={handleSubColClick} onMouseDown={event => handleGridColumnHeaderMouseDown(event, 5 + pIdx * 4 + 2)}
                        className={`${subHeaderBg} border-r py-2 px-1 text-center w-[82px] min-w-[82px] group/subCol transition-colors cursor-pointer select-none`}
                        style={ { width: subcolumnWidth, minWidth: subcolumnWidth, ...getFreezeCellStyle(5 + pIdx * 4 + 2, freezeRows >= 4), backgroundColor: isTopDownGridColumnSelected(5 + pIdx * 4 + 2) ? 'rgba(56, 189, 248, 0.72)' : undefined } }
                        scope="col"
                        title={`Click to highlight column group "${pName}". Shift-click for range.`}
                      >
                        <div className="flex items-center justify-center gap-0.5">
                          <span>Distributed</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClearColumn({ vaccine: pName, subCol: 'distributed' });
                            }}
                            className="opacity-0 group-hover/subCol:opacity-100 text-slate-400 hover:text-rose-600 cursor-pointer p-0.5 transition-opacity"
                            title={`Clear ${pName} Distributed across all rows`}
                          >
                            <Eraser className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </th>
                      <th
                        onContextMenu={event => openFreezeMenu(event, 'column', 5 + pIdx * 4 + 3)} onClick={handleSubColClick} onMouseDown={event => handleGridColumnHeaderMouseDown(event, 5 + pIdx * 4 + 3)}
                        className={`${balHeaderBg} border-r border-black py-2 px-2 text-center w-[82px] min-w-[82px] transition-colors cursor-pointer select-none`}
                        style={{ width: subcolumnWidth, minWidth: subcolumnWidth, ...getFreezeCellStyle(5 + pIdx * 4 + 3, freezeRows >= 4), backgroundColor: isTopDownGridColumnSelected(5 + pIdx * 4 + 3) ? 'rgba(56, 189, 248, 0.72)' : undefined }}
                        scope="col"
                        title={`Click to highlight column group "${pName}". Shift-click for range. Balance = Carry-over + Allocation - Distributed`}
                      >
                        Balance
                      </th>
                    </React.Fragment>
                  );
                })}
              </tr>
            </thead>

            {/* Table Body: Facility Rows */}
            <tbody
              className="divide-y divide-black font-sans text-xs"
              onDragStartCapture={event => {
                const eventTarget = event.target as HTMLElement;
                if (isDraggingGridRangeRef.current || eventTarget.closest('[data-reorder-handle]')) {
                  // Preserve mouse-drag range highlighting. A selected range can be
                  // moved by dragging from inside it after the highlight is complete.
                  if (isDraggingGridRangeRef.current) event.preventDefault();
                  return;
                }
                const cell = eventTarget.closest<HTMLElement>('[data-grid-cell-row][data-grid-cell-col]');
                if (!cell) return;
                const rowId = cell.dataset.gridCellRow;
                const colIdx = Number(cell.dataset.gridCellCol);
                if (!rowId || !Number.isInteger(colIdx)) return;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-blueprint-cell-move', '1');
                beginMovingSelectedCells({ rowId, colIdx });
              }}
            >
              {filteredAndSortedRows.length === 0 ? (
                <tr>
                  <td colSpan={totalColumnCount} className="py-12 text-center text-slate-400">
                    <p className="text-sm font-bold text-slate-600 mb-1">No rows found</p>
                    <p className="text-xs">Click "Add Facility Row" or "+5 Blank Rows" to start entering data.</p>
                  </td>
                </tr>
              ) : (
                filteredAndSortedRows.map((row, rowIdx) => {
                  const isSelected = allCellsHighlighted || selectedRowIds.has(row.id);
                  const progressStatus = getSheetProgressStatus(row, products);
                  const isCompleted = progressStatus === 'completed';
                  const isInProgress = progressStatus === 'in_progress';
                  const isPending = progressStatus === 'pending';
                  const mergeA = getMergeRender(rowIdx, 0);
                  const mergeB = getMergeRender(rowIdx, 1);
                  const mergeC = getMergeRender(rowIdx, 2);
                  const mergeD = getMergeRender(rowIdx, 3);

                  // Progress belongs to each vaccine block, never the facility row.
                  const rowBg = allocationWorksheet ? 'bg-white' : isCompleted ? 'bg-[#DCFCE7] hover:bg-[#BBF7D0]' : isInProgress ? 'bg-[#FEF08A] hover:bg-[#FDE047]' : 'bg-white hover:bg-white';
                  const stickyCellBg = allocationWorksheet ? 'bg-white' : isCompleted ? 'bg-[#DCFCE7]' : isInProgress ? 'bg-[#FEF08A]' : 'bg-white';
                  const rowBorderClass = allocationWorksheet ? 'border-b border-black border-l-4 border-l-transparent' : isCompleted ? 'border-b border-emerald-300 border-l-4 border-l-emerald-600' : isInProgress ? 'border-b border-yellow-300 border-l-4 border-l-amber-500' : 'border-b border-black border-l-4 border-l-transparent';
                  const rowNumber = rows.findIndex(source => source.id === row.id) + 5;

                  return (
                    <tr
                      key={row.id}
                      data-progress-status={progressStatus}
                      data-sheet-row-index={rowNumber}
                      onContextMenu={event => { setFocusedCell({ rowId: row.id, colIdx: focusedCell?.colIdx ?? 0 }); openFreezeMenu(event, 'row', rowNumber); }}
                      style={freezeRows >= rowNumber ? { position: 'sticky', top: `${freezeRowOffsets[rowNumber] ?? 0}px`, zIndex: 40, boxShadow: freezeRows === rowNumber ? 'inset 0 -2px 0 #64748b' : undefined } : undefined}
                      onDragOver={e => { e.preventDefault(); if (Array.from(e.dataTransfer.types).includes('application/x-blueprint-cell-move')) e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={e => {
                        if (pendingCellMove || Array.from(e.dataTransfer.types).includes('application/x-blueprint-cell-move')) {
                          e.preventDefault();
                          const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-grid-cell-row][data-grid-cell-col]');
                          const destinationRowId = target?.dataset.gridCellRow;
                          const destinationCol = Number(target?.dataset.gridCellCol);
                          if (destinationRowId && Number.isInteger(destinationCol)) finishMovingSelectedCells(destinationRowId, destinationCol);
                          else { clearPendingCellMove(); setSaveStatus('Move canceled: drop on a sheet cell.'); }
                          return;
                        }
                        reorderFacilityRow(e, row.id);
                      }}
                      className={`${rowBg} ${rowBorderClass} ${isSelected ? 'ring-1 ring-inset ring-sky-400 font-semibold' : ''} transition-colors group`}
                    >
                      {/* ===================================================== */}
                      {/* COL A: START DATE / PROCESSING (FROZEN)              */}
                      {/* ===================================================== */}
                      {!mergeA?.hidden && (<td draggable data-grid-cell-row={row.id} data-grid-cell-col={0} data-blueprint-bold={isGridCellBold(row.id, 0) ? 'true' : undefined} rowSpan={mergeA?.rowSpan || 1} colSpan={mergeA?.colSpan || 1}
                        style={{ ...getFreezeCellStyle(0, freezeRows >= rowNumber), ...getGridCellRangeHighlightStyle(row.id, 0) }} className={`sticky left-0 z-20 ${stickyCellBg} border-r border-black p-0 w-[140px] min-w-[140px] select-none ${isGridCellInRange(row.id, 0) ? 'ring-2 ring-inset ring-sky-400 bg-sky-100/80' : ''}`}
                        onClick={(e) => {
                          const tag = (e.target as HTMLElement).tagName;
                          if (tag !== 'INPUT' && tag !== 'BUTTON') {
                            handleToggleRowSelect(row.id, e);
                          }
                        }}
                        onMouseDown={(e) => {
                          const tag = (e.target as HTMLElement).tagName;
                          if (tag !== 'INPUT' && tag !== 'BUTTON') {
                            setIsMouseDownOnRowHeader(true);
                          }
                        }}
                        onMouseEnter={() => {
                          if (isMouseDownOnRowHeader) {
                            setSelectedRowIds(prev => new Set(prev).add(row.id));
                          }
                        }}
                      >
                        <div className="flex items-center h-full px-2 py-1.5 gap-1 relative">
                          <span className="w-4 shrink-0 text-right text-[9px] font-semibold text-slate-400" onContextMenu={event => { setFocusedCell({ rowId: row.id, colIdx: focusedCell?.colIdx ?? 0 }); openFreezeMenu(event, 'row', rowNumber); }}>{rowNumber}</span>
                          <span
                            data-reorder-handle
                            draggable={canReorderFacilityRows}
                            onClick={e => e.stopPropagation()}
                            onDragEnd={() => { draggedRowIdsRef.current = []; }}
                            onDragStart={e => {
                              if (!canReorderFacilityRows) return;
                              draggedRowIdsRef.current = selectedRowIds.has(row.id) && selectedRowIds.size > 1
                                ? rows.filter(selected => selectedRowIds.has(selected.id)).map(selected => selected.id)
                                : [row.id];
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', row.id);
                            }}
                            className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 text-sm leading-none"
                            title={canReorderFacilityRows ? `Drag to move row ${rowIdx + 1}` : 'Clear search, filters, and sorting before moving rows'}
                            aria-label={`Drag to move row ${rowIdx + 1}`}
                          >⠿</span>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleRowSelect(row.id, e);
                            }}
                            onChange={() => {}}
                            className="mr-0.5 accent-sky-600 rounded shrink-0 cursor-pointer w-3.5 h-3.5"
                            title="Highlight row (Shift-click for range selection)"
                          />
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleRowSelect(row.id, e);
                            }}
                            className="text-[10px] text-slate-400 font-mono w-4 shrink-0 text-right mr-1 cursor-pointer hover:text-slate-800"
                            title="Click to highlight row (Shift-click for range selection)"
                          >
                            {rowIdx + 1}
                          </span>
                          <div className="flex-1 flex items-center min-w-0">
                            <input
                              type="text"
                              value={row.processing}
                              onChange={e => handleCellChange(row.id, 'processing', e.target.value)}
                              onFocus={() => handleGridCellFocus(row.id, 0)}
                              ref={registerGridCell(row.id, 0)}
                              onMouseDown={e => handleGridCellMouseDown(e, row.id, 0)}
                                  onMouseEnter={() => handleGridCellMouseEnter(row.id, 0)}
                              style={{ backgroundColor: isGridCellInRange(row.id, 0) ? 'rgba(56, 189, 248, 0.58)' : undefined }}
                              onKeyDown={e => handleGridCellKeyDown(e, row.id, 0)}
                              onPaste={e => handleDirectCellPaste(e, row.id, 0)}
                              placeholder="YYYY-MM-DD"
                              className={`w-full bg-transparent text-xs font-semibold focus:outline-none rounded px-1 truncate ${
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
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-amber-600 rounded transition-opacity cursor-pointer shrink-0"
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
                      </td>)}

                      {/* ===================================================== */}
                      {/* COL B: COMPLETED DATE (FROZEN)                       */}
                      {/* ===================================================== */}
                      {!mergeB?.hidden && (<td draggable data-grid-cell-row={row.id} data-grid-cell-col={1} data-blueprint-bold={isGridCellBold(row.id, 1) ? 'true' : undefined} rowSpan={mergeB?.rowSpan || 1} colSpan={mergeB?.colSpan || 1}
                        style={{ ...getFreezeCellStyle(1, freezeRows >= rowNumber), ...getGridCellRangeHighlightStyle(row.id, 1) }} className={`sticky left-[140px] z-20 ${stickyCellBg} border-r border-black p-0 w-[140px] min-w-[140px] ${isGridCellInRange(row.id, 1) ? 'ring-2 ring-inset ring-sky-400 bg-sky-100/80' : ''}`}
                      >
                        <div className="flex items-center h-full px-2 py-1.5 gap-1">
                          <div className="flex-1 flex items-center min-w-0">
                            <input
                              type="text"
                              value={row.completed}
                              onChange={e => handleCellChange(row.id, 'completed', e.target.value)}
                              onFocus={() => handleGridCellFocus(row.id, 1)}
                              ref={registerGridCell(row.id, 1)}
                              onMouseDown={e => handleGridCellMouseDown(e, row.id, 1)}
                                  onMouseEnter={() => handleGridCellMouseEnter(row.id, 1)}
                              style={{ backgroundColor: isGridCellInRange(row.id, 1) ? 'rgba(56, 189, 248, 0.58)' : undefined }}
                              onKeyDown={e => handleGridCellKeyDown(e, row.id, 1)}
                              onPaste={e => handleDirectCellPaste(e, row.id, 1)}
                              placeholder={isCompleted ? 'Completed' : isInProgress ? 'In Progress...' : '-'}
                              className={`w-full bg-transparent text-xs font-medium focus:outline-none rounded px-1 truncate ${
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
                      </td>)}

                      {/* ===================================================== */}
                      {/* COL C: FACILITY (FROZEN)                             */}
                      {/* ===================================================== */}
                      {!mergeC?.hidden && (<td draggable data-grid-cell-row={row.id} data-grid-cell-col={2} data-blueprint-bold={isGridCellBold(row.id, 2) ? 'true' : undefined} rowSpan={mergeC?.rowSpan || 1} colSpan={mergeC?.colSpan || 1}
                        onMouseEnter={(e) => handleCellCommentMouseEnter(e, row, 'facility')}
                        onMouseLeave={handleCellCommentMouseLeave}
                        style={{ ...getFreezeCellStyle(2, freezeRows >= rowNumber), ...getGridCellRangeHighlightStyle(row.id, 2) }}
                        className={`sticky left-[280px] z-20 ${stickyCellBg} border-r-2 border-black p-0 w-[230px] min-w-[230px] relative group/facility ${isGridCellInRange(row.id, 2) ? 'ring-2 ring-inset ring-sky-400 bg-sky-100/80' : ''}`}
                      >
                        <div className="flex items-center justify-between h-full px-2.5 py-1.5 gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <input
                              type="text"
                              value={row.facility}
                              onChange={e => handleCellChange(row.id, 'facility', e.target.value)}
                              onFocus={() => handleGridCellFocus(row.id, 2)}
                              ref={registerGridCell(row.id, 2)}
                              onMouseDown={e => handleGridCellMouseDown(e, row.id, 2)}
                                  onMouseEnter={() => handleGridCellMouseEnter(row.id, 2)}
                              style={{ backgroundColor: isGridCellInRange(row.id, 2) ? 'rgba(56, 189, 248, 0.58)' : undefined }}
                              onKeyDown={e => handleGridCellKeyDown(e, row.id, 2)}
                              onPaste={e => handleDirectCellPaste(e, row.id, 2)}
                              placeholder="Facility name..."
                              className={`w-full bg-transparent text-xs font-bold focus:outline-none rounded px-1 truncate ${
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
                      </td>)}

                      {!mergeD?.hidden && (<td draggable data-grid-cell-row={row.id} data-grid-cell-col={3} data-blueprint-bold={isGridCellBold(row.id, 3) ? 'true' : undefined} rowSpan={mergeD?.rowSpan || 1} colSpan={mergeD?.colSpan || 1} style={{ ...getFreezeCellStyle(3, freezeRows >= rowNumber), ...getGridCellRangeHighlightStyle(row.id, 3) }} className={`sticky left-[510px] z-20 ${stickyCellBg} border-r border-black p-0 w-[160px] min-w-[160px] ${isGridCellInRange(row.id, 3) ? 'ring-2 ring-inset ring-sky-400 bg-sky-100/80' : ''}`}>
                        <div className="flex items-center h-full px-2 py-1.5">
                          <input type="text" value={row.subDistrict || ''} onChange={e => handleCellChange(row.id, 'subDistrict', e.target.value)} onFocus={() => handleGridCellFocus(row.id, 3)} ref={registerGridCell(row.id, 3)} onMouseDown={e => handleGridCellMouseDown(e, row.id, 3)} onMouseEnter={() => handleGridCellMouseEnter(row.id, 3)} style={{ backgroundColor: isGridCellInRange(row.id, 3) ? 'rgba(56, 189, 248, 0.58)' : undefined }} onKeyDown={e => handleGridCellKeyDown(e, row.id, 3)} onPaste={e => handleDirectCellPaste(e, row.id, 3)} placeholder="Sub-district..." className="w-full bg-transparent text-xs font-medium focus:outline-none rounded px-1 truncate text-slate-800" title="Sub-district for this facility" />
                        </div>
                      </td>)}
                      <td draggable data-grid-cell-row={row.id} data-grid-cell-col={4} data-blueprint-bold={isGridCellBold(row.id, 4) ? 'true' : undefined}
                        style={{ ...getFreezeCellStyle(4, freezeRows >= rowNumber), ...getGridCellRangeHighlightStyle(row.id, 4) }} className={`sticky left-[670px] z-20 ${stickyCellBg} border-r-2 border-black p-0 w-[200px] min-w-[200px] ${isGridCellInRange(row.id, 4) ? 'ring-2 ring-inset ring-sky-400 bg-sky-100/80' : ''}`}
                      >
                        <div className="flex items-center h-full px-2 py-1.5 gap-1">
                          <span data-reorder-handle draggable={canReorderFacilityRows} onClick={e => e.stopPropagation()} onDragEnd={() => { draggedRowIdsRef.current = []; }} onDragStart={e => { if (!canReorderFacilityRows) return; draggedRowIdsRef.current = selectedRowIds.has(row.id) && selectedRowIds.size > 1 ? rows.filter(selected => selectedRowIds.has(selected.id)).map(selected => selected.id) : [row.id]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.id); }} className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 text-sm leading-none" title={`Drag to move row ${rowIdx + 1}`} aria-label={`Drag to move row ${rowIdx + 1}`}>⠿</span>
                          <input
                            type="text"
                            value={row.deliverySite || ''}
                            onChange={e => handleCellChange(row.id, 'deliverySite', e.target.value)}
                            onFocus={() => handleGridCellFocus(row.id, 4)}
                              ref={registerGridCell(row.id, 4)}
                              onMouseDown={e => handleGridCellMouseDown(e, row.id, 4)}
                                  onMouseEnter={() => handleGridCellMouseEnter(row.id, 4)}
                              style={{ backgroundColor: isGridCellInRange(row.id, 4) ? 'rgba(56, 189, 248, 0.58)' : undefined }}
                              onKeyDown={e => handleGridCellKeyDown(e, row.id, 4)}
                            onPaste={e => handleDirectCellPaste(e, row.id, 4)}
                            placeholder="Delivery site..."
                            className="w-full bg-transparent text-xs font-medium focus:outline-none rounded px-1 truncate text-slate-800"
                            title="Delivery site for this facility"
                          />
                        </div>
                      </td>

                      {/* ===================================================== */}
                      {/* COLS E onward: VACCINE PRODUCT SECTIONS              */}
                      {/* ===================================================== */}
                      {products.map((pName, pIdx) => {
                        const vData = row.vaccines[pName] || {};
                        const carry = vData.carryOver !== undefined ? vData.carryOver : '';
                        const alloc = vData.allocation !== undefined ? vData.allocation : '';
                        const dist = vData.distributed !== undefined ? vData.distributed : '';
                        const bal = computeBalance(vData.carryOver, vData.allocation, vData.distributed);
                        const vaccineStatus = allocationWorksheet ? getAllocationStatus(vData) : undefined;
                        const cellStyle = (colIdx: number) => getAllocationCellStyle(row.baseFormatting?.[blueprintColumnKey(colIdx, products)], vaccineStatus, isGridCellInRange(row.id, colIdx) || (focusedCell?.rowId === row.id && focusedCell.colIdx === colIdx) || allCellsHighlighted || selectedColumnNames.has(pName) || isSelected);

                        const isNegativeBalance = typeof bal === 'number' && bal < 0;
                        const vaccineComment =
                          row.vaccineComments?.[pName]?.trim() ||
                          vData.comment?.trim() ||
                          '';

                        const isColSelected = allCellsHighlighted || selectedColumnNames.has(pName);
                        const cellHighlight = isColSelected || isSelected
                          ? 'ring-1 ring-inset ring-sky-300'
                          : '';

                        return (
                          <React.Fragment key={pName}>
                            {/* Carry-over (Col 1 of group) */}
                            <td draggable data-allocation-status={vaccineStatus} data-grid-cell-row={row.id} data-grid-cell-col={5 + pIdx * 4} data-blueprint-bold={isGridCellBold(row.id, 5 + pIdx * 4) ? 'true' : undefined}
                              onMouseEnter={(e) => handleCellCommentMouseEnter(e, row, pName)}
                              onMouseLeave={handleCellCommentMouseLeave}
                              className={`border-r border-slate-300 p-0 text-right w-[82px] min-w-[82px] transition-colors ${cellHighlight} ${isGridCellInRange(row.id, 5 + pIdx * 4) ? 'ring-2 ring-inset ring-sky-400' : ''}`}
                              style={{ width: Math.max(50, (productGroupWidths[pName] ?? 328) / 4), minWidth: Math.max(50, (productGroupWidths[pName] ?? 328) / 4), ...getFreezeCellStyle(5 + pIdx * 4), ...cellStyle(5 + pIdx * 4) }}
                            >
                              <input
                                type="text"
                                inputMode="numeric"
                                value={carry}
                                onChange={e =>
                                  handleCellChange(row.id, { vaccine: pName, subCol: 'carryOver' }, e.target.value)
                                }
                                onFocus={() => handleGridCellFocus(row.id, 5 + pIdx * 4 + 0)}
                              ref={registerGridCell(row.id, 5 + pIdx * 4 + 0)}
                                  onMouseDown={e => handleGridCellMouseDown(e, row.id, 5 + pIdx * 4 + 0)}
                                  onMouseEnter={() => handleGridCellMouseEnter(row.id, 5 + pIdx * 4 + 0)}
                                  style={{ backgroundColor: 'transparent' }}
                              onKeyDown={e => handleGridCellKeyDown(e, row.id, 5 + pIdx * 4 + 0)}
                                onPaste={e => handleDirectCellPaste(e, row.id, 5 + pIdx * 4 + 0)}
                                placeholder=""
                                className="w-full bg-transparent text-right text-xs px-2 py-1.5 text-slate-800 font-medium focus:outline-none"
                              />
                            </td>

                            {/* Allocation (Col 2 of group) with Excel-style comment corner tag */}
                            <td draggable data-allocation-status={vaccineStatus} data-grid-cell-row={row.id} data-grid-cell-col={5 + pIdx * 4 + 1} data-blueprint-bold={isGridCellBold(row.id, 5 + pIdx * 4 + 1) ? 'true' : undefined}
                              onMouseEnter={(e) => handleCellCommentMouseEnter(e, row, pName)}
                              onMouseLeave={handleCellCommentMouseLeave}
                              className={`border-r border-slate-300 p-0 text-right w-[82px] min-w-[82px] relative group/allocCell transition-colors ${cellHighlight} ${isGridCellInRange(row.id, 5 + pIdx * 4 + 1) ? 'ring-2 ring-inset ring-sky-400' : ''}`}
                              style={{ width: Math.max(50, (productGroupWidths[pName] ?? 328) / 4), minWidth: Math.max(50, (productGroupWidths[pName] ?? 328) / 4), ...getFreezeCellStyle(5 + pIdx * 4 + 1, freezeRows >= rowNumber), ...cellStyle(5 + pIdx * 4 + 1) }}
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
                                  onFocus={() => handleGridCellFocus(row.id, 5 + pIdx * 4 + 1)}
                              ref={registerGridCell(row.id, 5 + pIdx * 4 + 1)}
                                  onMouseDown={e => handleGridCellMouseDown(e, row.id, 5 + pIdx * 4 + 1)}
                                  onMouseEnter={() => handleGridCellMouseEnter(row.id, 5 + pIdx * 4 + 1)}
                                  style={{ backgroundColor: 'transparent' }}
                              onKeyDown={e => handleGridCellKeyDown(e, row.id, 5 + pIdx * 4 + 1)}
                                  onPaste={e => handleDirectCellPaste(e, row.id, 5 + pIdx * 4 + 1)}
                                  placeholder=""
                                  className="w-full bg-transparent text-right text-xs px-2 py-1.5 text-slate-900 font-bold focus:outline-none"
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
                            <td draggable data-allocation-status={vaccineStatus} data-grid-cell-row={row.id} data-grid-cell-col={5 + pIdx * 4 + 2} data-blueprint-bold={isGridCellBold(row.id, 5 + pIdx * 4 + 2) ? 'true' : undefined}
                              onMouseEnter={(e) => handleCellCommentMouseEnter(e, row, pName)}
                              onMouseLeave={handleCellCommentMouseLeave}
                              className={`border-r border-slate-300 p-0 text-right w-[82px] min-w-[82px] transition-colors ${cellHighlight} ${isGridCellInRange(row.id, 5 + pIdx * 4 + 2) ? 'ring-2 ring-inset ring-sky-400' : ''}`}
                              style={{ width: Math.max(50, (productGroupWidths[pName] ?? 328) / 4), minWidth: Math.max(50, (productGroupWidths[pName] ?? 328) / 4), ...getFreezeCellStyle(5 + pIdx * 4 + 2, freezeRows >= rowNumber), ...cellStyle(5 + pIdx * 4 + 2) }}
                            >
                              <input
                                type="text"
                                inputMode="numeric"
                                value={dist}
                                onChange={e =>
                                  handleCellChange(row.id, { vaccine: pName, subCol: 'distributed' }, e.target.value)
                                }
                                onFocus={() => handleGridCellFocus(row.id, 5 + pIdx * 4 + 2)}
                              ref={registerGridCell(row.id, 5 + pIdx * 4 + 2)}
                                  onMouseDown={e => handleGridCellMouseDown(e, row.id, 5 + pIdx * 4 + 2)}
                                  onMouseEnter={() => handleGridCellMouseEnter(row.id, 5 + pIdx * 4 + 2)}
                                  style={{ backgroundColor: 'transparent' }}
                              onKeyDown={e => handleGridCellKeyDown(e, row.id, 5 + pIdx * 4 + 2)}
                                onPaste={e => handleDirectCellPaste(e, row.id, 5 + pIdx * 4 + 2)}
                                placeholder=""
                                className="w-full bg-transparent text-right text-xs px-2 py-1.5 text-slate-700 font-medium focus:outline-none"
                              />
                            </td>

                            {/* Balance (Col 4 of group) - Auto-Calculated Formula: Carry + Alloc - Dist */}
                            <td draggable={false} data-allocation-status={vaccineStatus} data-grid-cell-row={row.id} data-grid-cell-col={5 + pIdx * 4 + 3} data-blueprint-bold={isGridCellBold(row.id, 5 + pIdx * 4 + 3) ? 'true' : undefined}
                              onMouseEnter={(e) => { handleCellCommentMouseEnter(e, row, pName); handleGridCellMouseEnter(row.id, 5 + pIdx * 4 + 3); }}
                              onMouseLeave={handleCellCommentMouseLeave}
                              className={`border-r border-black p-0 text-right w-[82px] min-w-[82px] transition-colors ${
                                isNegativeBalance ? 'bg-red-100/90' : cellHighlight
                              } ${isGridCellInRange(row.id, 5 + pIdx * 4 + 3) ? 'ring-2 ring-inset ring-sky-400' : ''}`}
                              style={{ width: Math.max(50, (productGroupWidths[pName] ?? 328) / 4), minWidth: Math.max(50, (productGroupWidths[pName] ?? 328) / 4), ...getFreezeCellStyle(5 + pIdx * 4 + 3, freezeRows >= rowNumber), ...cellStyle(5 + pIdx * 4 + 3) }}
                              title={`${pName} Balance: ${bal !== '' ? bal : 'Blank'}`}
                              onMouseDown={e => handleGridCellMouseDown(e, row.id, 5 + pIdx * 4 + 3)}
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
            <tfoot className="bg-[#FFF2CC] border-t-2 border-black font-sans text-xs font-black">
              <tr>
                <td style={getFreezeCellStyle(0)} className="sticky left-0 z-30 bg-[#FFF2CC] border-r border-black py-2.5 px-2 text-center text-slate-900 w-[140px] min-w-[140px]">
                  TOTALS
                </td>
                <td style={getFreezeCellStyle(1)} className="sticky left-[140px] z-30 bg-[#FFF2CC] border-r border-black py-2.5 px-2 text-center text-slate-600 w-[140px] min-w-[140px]">
                  {facilityStats.completedCount}/{facilityStats.total} Done
                </td>
                <td style={getFreezeCellStyle(2)} className="sticky left-[280px] z-30 bg-[#FFF2CC] border-r-2 border-black py-2.5 px-3 text-left text-slate-900 w-[230px] min-w-[230px]">
                  Cohort Summary
                </td>
                <td style={getFreezeCellStyle(3)} className="sticky left-[510px] z-30 bg-[#FFF2CC] border-r border-black py-2.5 px-2 text-left text-slate-500 w-[160px] min-w-[160px]">Sub-districts</td>
                <td style={getFreezeCellStyle(4)} className="sticky left-[670px] z-30 bg-[#FFF2CC] border-r-2 border-black py-2.5 px-2 text-left text-slate-500 w-[200px] min-w-[200px]">
                  Delivery sites
                </td>

                {/* Subcolumn Totals */}
                {products.map((pName, pIdx) => {
                  const t = totals[pName] || { carry: 0, alloc: 0, dist: 0, bal: 0 };
                  const isNegative = t.bal < 0;

                  return (
                    <React.Fragment key={pName}>
                      <td style={getFreezeCellStyle(5 + pIdx * 4 + 0)} className="border-r border-slate-400 py-2 px-2 text-right text-slate-700">
                        {t.carry > 0 ? t.carry.toLocaleString() : '-'}
                      </td>
                      <td style={getFreezeCellStyle(5 + pIdx * 4 + 1)} className="border-r border-slate-400 py-2 px-2 text-right text-slate-950 font-black">
                        {t.alloc > 0 ? t.alloc.toLocaleString() : '-'}
                      </td>
                      <td style={getFreezeCellStyle(5 + pIdx * 4 + 2)} className="border-r border-slate-400 py-2 px-2 text-right text-slate-700">
                        {t.dist > 0 ? t.dist.toLocaleString() : '-'}
                      </td>
                      <td
                        style={{ ...getFreezeCellStyle(5 + pIdx * 4 + 3) }}
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
          {(() => {
            const trackHeight = gridScrollMetrics.clientHeight || 680;
            const verticalThumbHeight = gridScrollMetrics.scrollHeight > 0
              ? Math.max(28, trackHeight * gridScrollMetrics.clientHeight / gridScrollMetrics.scrollHeight)
              : trackHeight;
            const verticalThumbTravel = Math.max(0, trackHeight - verticalThumbHeight);
            const verticalMaxScroll = Math.max(0, gridScrollMetrics.scrollHeight - gridScrollMetrics.clientHeight);
            const verticalThumbTop = verticalMaxScroll > 0 ? verticalThumbTravel * gridScrollMetrics.scrollTop / verticalMaxScroll : 0;
            return (
              <div
                role="scrollbar"
                aria-label="Scroll Blueprint vertically"
                aria-controls="allocation-blueprint-grid-scroll"
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={verticalMaxScroll}
                aria-valuenow={Math.min(gridScrollMetrics.scrollTop, verticalMaxScroll)}
                tabIndex={0}
                onKeyDown={event => {
                  const element = gridScrollRef.current;
                  if (!element) return;
                  if (event.key === 'ArrowDown') element.scrollTop += 48;
                  else if (event.key === 'ArrowUp') element.scrollTop -= 48;
                  else if (event.key === 'PageDown') element.scrollTop += element.clientHeight;
                  else if (event.key === 'PageUp') element.scrollTop -= element.clientHeight;
                  else if (event.key === 'Home') element.scrollTop = 0;
                  else if (event.key === 'End') element.scrollTop = element.scrollHeight;
                  else return;
                  event.preventDefault();
                }}
                onPointerDown={event => {
                  const element = gridScrollRef.current;
                  if (!element || verticalMaxScroll === 0) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  element.scrollTop = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * verticalMaxScroll;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                  const element = gridScrollRef.current;
                  if (!element || event.buttons !== 1 || verticalMaxScroll === 0) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  element.scrollTop = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * verticalMaxScroll;
                }}
                className="relative w-4 shrink-0 touch-none cursor-pointer border-l border-slate-300 bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500"
                style={{ height: trackHeight }}
              >
                <span className="pointer-events-none absolute left-[3px] right-[3px] rounded-full bg-slate-500 hover:bg-orange-600" style={{ top: verticalThumbTop, height: verticalThumbHeight }} />
              </div>
            );
          })()}
        </div>
        {(() => {
          const trackWidth = gridScrollMetrics.clientWidth || 320;
          const horizontalThumbWidth = gridScrollMetrics.scrollWidth > 0
            ? Math.max(28, trackWidth * gridScrollMetrics.clientWidth / gridScrollMetrics.scrollWidth)
            : trackWidth;
          const horizontalThumbTravel = Math.max(0, trackWidth - horizontalThumbWidth);
          const horizontalMaxScroll = Math.max(0, gridScrollMetrics.scrollWidth - gridScrollMetrics.clientWidth);
          const horizontalThumbLeft = horizontalMaxScroll > 0 ? horizontalThumbTravel * gridScrollMetrics.scrollLeft / horizontalMaxScroll : 0;
          return (
            <div className="flex h-4 border-t border-slate-300 bg-slate-100">
              <div
                role="scrollbar"
                aria-label="Scroll Blueprint horizontally"
                aria-controls="allocation-blueprint-grid-scroll"
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={horizontalMaxScroll}
                aria-valuenow={Math.min(gridScrollMetrics.scrollLeft, horizontalMaxScroll)}
                tabIndex={0}
                onKeyDown={event => {
                  const element = gridScrollRef.current;
                  if (!element) return;
                  if (event.key === 'ArrowRight') element.scrollLeft += 48;
                  else if (event.key === 'ArrowLeft') element.scrollLeft -= 48;
                  else if (event.key === 'PageDown') element.scrollLeft += element.clientWidth;
                  else if (event.key === 'PageUp') element.scrollLeft -= element.clientWidth;
                  else if (event.key === 'Home') element.scrollLeft = 0;
                  else if (event.key === 'End') element.scrollLeft = element.scrollWidth;
                  else return;
                  event.preventDefault();
                }}
                onPointerDown={event => {
                  const element = gridScrollRef.current;
                  if (!element || horizontalMaxScroll === 0) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  element.scrollLeft = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * horizontalMaxScroll;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                  const element = gridScrollRef.current;
                  if (!element || event.buttons !== 1 || horizontalMaxScroll === 0) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  element.scrollLeft = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * horizontalMaxScroll;
                }}
                className="relative min-w-0 flex-1 touch-none cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500"
              >
                <span className="pointer-events-none absolute top-[3px] bottom-[3px] rounded-full bg-slate-500 hover:bg-orange-600" style={{ left: horizontalThumbLeft, width: horizontalThumbWidth }} />
              </div>
              <div aria-hidden="true" className="w-4 shrink-0 border-l border-slate-300" />
            </div>
          );
        })()}
      </div>

      {/* Footer Notes & Legend */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-[#FEF08A] border-2 border-amber-500"></span>
            <span className="font-semibold text-amber-900">{allocationWorksheet ? 'Yellow: Vaccine Distribution In Progress' : 'Yellow: Data Entry / Updating'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-[#DCFCE7] border-2 border-emerald-600"></span>
            <span className="font-semibold text-emerald-950">{allocationWorksheet ? 'Green: Full Available Vaccine Quantity Distributed' : 'Green: All Entered Balances Are 0'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-white border border-slate-300"></span>
            <span>{allocationWorksheet ? 'Original Fill: Not Started / Unused' : 'White: Facility Has Not Started'}</span>
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
          <span>Freeze Panes Active: Cols A-E (Start, Done, Facility, Sub-district, Delivery Site)</span>
          &bull;
          <span>{totalColumnCount} Columns Total</span>
        </div>
      </div>

      {/* Modal: Add Column */}
      {showAddColumnModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-md w-full shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 text-[#C55A11] flex items-center justify-center">
                <Columns className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">Add Column</h3>
                <p className="text-xs text-slate-500">
                  Adds a vaccine or product with four allocation fields: Carry-over, Allocation, Distributed, and Balance.
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
                  productInsertIndexRef.current = null;
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
                Add Column
              </button>
            </div>
          </div>
        </div>
      )}

      {showBlueprintHelp && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="blueprint-help-title"><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"><h3 id="blueprint-help-title" className="text-base font-bold text-slate-900">Allocation Blueprint controls</h3><p className="mt-2 text-sm text-slate-600">Select cells by dragging across the grid or from a column header down the sheet. Regular dragging extends highlights; Alt-drag moves selected cells. Use arrow keys to navigate, Tab to move across cells, Enter to move down, Ctrl/Cmd+C/V to copy and paste, Ctrl/Cmd+Z/Y to undo and redo, and the Freeze menu to keep rows or columns visible.</p><button type="button" onClick={() => setShowBlueprintHelp(false)} className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Close</button></div></div>}

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
                  Creates an identical allocation sheet for this district
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
                        id: 'subDistrict',
                        label: 'Col D: Sub-districts',
                        desc: 'Clears sub-district names across all rows in the active sheet.'
                      },
                      {
                        id: 'deliverySite',
                        label: 'Col E: Delivery Sites',
                        desc: 'Clears delivery site names across all rows in the active sheet.'
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

      {showDhdStockModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-amber-50 px-4 py-3 sm:px-6">
              <div>
                <h3 className="text-base font-black text-slate-900">DHD Stock &amp; Facility Top-ups</h3>
                <p className="mt-1 text-xs text-slate-600">
                  {district} stock is shared across this district’s allocation cycles. Quantities use the same units as the Blueprint.
                </p>
              </div>
              <button type="button" onClick={() => setShowDhdStockModal(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-900" aria-label="Close DHD stock manager">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 sm:p-6">
              {dhdStockLoading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">Loading DHD stock…</div>
              ) : (
                <>
                  <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                    When a facility’s distributed total goes above its carry-over plus allocation, the Blueprint asks before deducting the overage from this DHD stock. The facility allocation and DHD ledger update together.
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[560px] border-collapse text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="px-3 py-2 font-bold">Vaccine / product</th>
                          <th className="px-3 py-2 text-right font-bold">Available in DHD</th>
                          <th className="px-3 py-2 text-right font-bold">Set DHD stock count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.map(product => (
                          <tr key={product} className="border-t border-slate-200">
                            <td className="px-3 py-2 font-semibold text-slate-800">{product}</td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums">{(Number(dhdStocks[product]) || 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                inputMode="decimal"
                                value={dhdStockDraft[product] ?? ''}
                                onChange={event => setDhdStockDraft(previous => ({ ...previous, [product]: event.target.value }))}
                                className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-right font-semibold focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                                aria-label={'Set DHD stock for ' + product}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {dhdStockError && <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{dhdStockError}</div>}
                  <div className="mt-7">
                    <h4 className="mb-2 text-sm font-black text-slate-900">Top-up and stock count history</h4>
                    {dhdHistory.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500">No DHD stock counts or facility top-ups have been recorded for this district.</p>
                    ) : (
                      <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
                        <table className="w-full min-w-[700px] border-collapse text-left text-xs">
                          <thead className="sticky top-0 bg-slate-100 text-slate-700">
                            <tr>
                              <th className="px-3 py-2 font-bold">Date</th>
                              <th className="px-3 py-2 font-bold">Facility / entry</th>
                              <th className="px-3 py-2 font-bold">Product</th>
                              <th className="px-3 py-2 text-right font-bold">Quantity</th>
                              <th className="px-3 py-2 text-right font-bold">DHD balance</th>
                              <th className="px-3 py-2 font-bold">Recorded by</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...dhdHistory].reverse().slice(0, 100).map(entry => (
                              <tr key={entry.id} className="border-t border-slate-200">
                                <td className="whitespace-nowrap px-3 py-2">{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}</td>
                                <td className="px-3 py-2 font-semibold">{entry.facility || entry.note || 'DHD stock count'}</td>
                                <td className="px-3 py-2">{entry.vaccine}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{entry.type === 'top_up' ? '+' : ''}{entry.quantity.toLocaleString()}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{entry.stockBefore.toLocaleString()} → {entry.stockAfter.toLocaleString()}</td>
                                <td className="px-3 py-2">{entry.user || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
              <p className="text-[11px] text-slate-500">Changing stock counts is recorded in the district DHD ledger.</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowDhdStockModal(false)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Close</button>
                <button type="button" onClick={() => void saveDhdStocks()} disabled={dhdStockLoading || dhdStockSaving} className="rounded-xl bg-amber-700 px-4 py-2 text-xs font-bold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {dhdStockSaving ? 'Saving…' : 'Save DHD stock counts'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* End of modals */}
    </div>
  );
}
