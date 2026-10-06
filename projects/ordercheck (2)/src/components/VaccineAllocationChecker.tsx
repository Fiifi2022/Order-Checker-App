/**
 * Vaccine Allocation Validation & Checker Component
 * 
 * Implements the complete "Excel as Audit Reference" workflow:
 * Upload/Read Sheet -> Select Facility & Worksheet -> Display Current Vaccine Position
 * -> Order Cross-Auditing (WhatsApp vs FS vs Allocation)
 * -> High-Contrast Visual Feedback (🟢 GREEN LIGHT / 🔴 DO NOT PROCESS)
 * -> Review & Atomic Multi-CCA Confirm -> Auto-Update Vaccine Tracker
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  RefreshCw,
  Search,
  Building2,
  FileText,
  MessageSquare,
  ArrowRight,
  Sparkles,
  Lock,
  Clock,
  Layers,
  Info,
  ChevronDown,
  PlusCircle,
  History,
  Check,
  FileSpreadsheet,
  AlertCircle,
  ExternalLink,
  Syringe,
  MapPin
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FacilityAllocation,
  VaccineValidationResult,
  VaccineValidationItem,
  VaccineAllocationItem,
  VaccineAuditLogRecord,
  getVaccineDosesPerVial
} from '../types';

import { UserRoleRecord } from '../types';
import { VaccinePositionPanel } from './VaccinePositionPanel';
import { OrderSourcePanel } from './OrderSourcePanel';

function matchVaccineCanonical(name: string): string {
  const clean = name.toLowerCase().trim().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
  const hasDiluent = /\bdiluent\b/.test(clean);
  const hasDropper = /\bdropper\b/.test(clean);

  if (hasDiluent) {
    if (clean.includes('bcg') || clean.includes('bacille calmette guerin')) return 'BCG Diluent';
    if (clean.includes('mr') || clean.includes('measles')) return 'MR Diluent';
    if (clean.includes('yellow fever') || clean.includes('yf')) return 'Yellow Fever Diluent';
    if (clean.includes('men a') || clean.includes('mena') || clean.includes('meningitis a')) return 'Men A Diluent';
  }
  if (hasDropper) {
    if (clean.includes('opv') || clean.includes('oral polio') || clean.includes('polio')) return 'OPV Dropper';
    if (clean.includes('rota') || clean.includes('rotavirus')) return 'Rota Dropper';
  }

  if (clean.includes('bcg') || clean.includes('bacille calmette guerin')) return 'BCG';
  if (clean.includes('ipv') || clean.includes('inactivated polio')) return 'IPV';
  if (clean.includes('oral polio') || clean.includes('opv') || clean.includes('polio')) return 'OPV';
  if (clean.includes('penta') || clean.includes('pentavalent')) return 'Penta';
  if ((clean === 'mr' || clean.includes('measles') || clean.includes('rubella')) && !hasDiluent) return 'MR';
  if (clean.includes('rota') || clean.includes('rotavirus')) return 'Rota';
  if (clean.includes('pcv') || clean.includes('pneumococcal')) return 'PCV';
  if (clean.includes('yellow fever') || clean === 'yf') return 'Yellow Fever';
  if (clean.includes('men a') || clean.includes('mena') || clean.includes('meningitis a')) return 'Men A';
  if (clean.includes('hpv') || clean.includes('human papillomavirus')) return 'HPV';
  if (clean === 'dt' || clean === 'td' || clean === 'tt' || clean.includes('tetanus') || clean.includes('diphtheria')) return 'DT';
  if (clean.includes('r21') || clean.includes('malaria')) return 'R21';
  if (clean.includes('soloshot 0.05')) return 'Soloshot 0.05ml';
  if (clean.includes('soloshot 0.5')) return 'Soloshot 0.5ml';
  if (clean.includes('syringe') && clean.includes('2ml')) return 'Syringe and needle 2ml';
  if (clean.includes('syringe') && clean.includes('5ml')) return 'Syringe and needle 5ml';
  return name.trim();
}

const COMPANION_PRODUCTS = new Set([
  'BCG Diluent',
  'Yellow Fever Diluent',
  'MR Diluent',
  'Men A Diluent',
  'OPV Dropper',
  'Rota Dropper'
]);

type FsProductType = 'PRIMARY_VACCINE' | 'DILUENT' | 'DROPPER' | 'ACCESSORY';

function getFsProductType(name: string): FsProductType {
  const canonical = matchVaccineCanonical(name);
  if (!COMPANION_PRODUCTS.has(canonical)) return 'PRIMARY_VACCINE';
  return /diluent/i.test(canonical) ? 'DILUENT' : 'DROPPER';
}

interface VaccineAllocationCheckerProps {
  onNavigateToBlueprint?: () => void;
  onNavigateToTracker?: () => void;
  onNavigateToHistory?: () => void;
  currentUser?: UserRoleRecord | null;
}

export default function VaccineAllocationChecker({
  onNavigateToBlueprint,
  onNavigateToTracker,
  onNavigateToHistory,
  currentUser
}: VaccineAllocationCheckerProps) {
  // Facilities state
  const [facilities, setFacilities] = useState<FacilityAllocation[]>([]);
  const [loadingFacilities, setLoadingFacilities] = useState(false);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string>('');
  const [facilitySearch, setFacilitySearch] = useState('');
  const [selectedWorksheetFilter, setSelectedWorksheetFilter] = useState<string>('all');
  const [selectedDistrictFilter, setSelectedDistrictFilter] = useState<string>('all');
  const [isFacilityDropdownOpen, setIsFacilityDropdownOpen] = useState(false);

  // Workflow inputs
  const [orderSource, setOrderSource] = useState<'whatsapp' | 'fs_only'>('whatsapp');
  const [whatsappMessage, setWhatsappMessage] = useState('');
  const [fulfillmentConfirmation, setFulfillmentConfirmation] = useState('');
  const [ccaName, setCcaName] = useState(currentUser?.name || 'CCA Advocate');

  useEffect(() => {
    if (currentUser?.name) {
      setCcaName(currentUser.name);
    }
  }, [currentUser?.name]);

  // Validation result states
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<VaccineValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isStaleValidation, setIsStaleValidation] = useState(false);

  // Debounced auto-audit on text edit
  const isInitialMount = useRef(true);
  const debounceTimerRef = useRef<any>(null);

  // Confirmation states
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmationSuccess, setConfirmationSuccess] = useState<any | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);

  // Unrelieved Top-Up Modal State
  const [topUpModalOpen, setTopUpModalOpen] = useState(false);
  const [topUpVaccine, setTopUpVaccine] = useState('');
  const [topUpQty, setTopUpQty] = useState('');
  const [topUpUnit, setTopUpUnit] = useState<'vials' | 'doses'>('vials');
  const [savingTopUp, setSavingTopUp] = useState(false);

  // Unit display switcher: 'both' | 'vials' | 'doses'
  const [unitDisplayMode, setUnitDisplayMode] = useState<'both' | 'vials' | 'doses'>('both');

  // Cross-Auditing Matrix Filter: 'all' | 'discrepancies' | 'ordered'
  const [auditMatrixFilter, setAuditMatrixFilter] = useState<'all' | 'discrepancies' | 'ordered'>('all');

  // Table search & view density state for Current Vaccine Position
  const [vaccineTableSearch, setVaccineTableSearch] = useState('');
  const [positionViewMode, setPositionViewMode] = useState<'compact' | 'detailed'>('compact');

  // Audit Logs Drawer / Modal State
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [auditLogs, setAuditLogs] = useState<VaccineAuditLogRecord[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);

  // Fetch facilities
  const fetchFacilities = async (resetSelection = false) => {
    setLoadingFacilities(true);
    try {
      const res = await fetch('/api/vaccine/allocations');
      if (res.ok) {
        const data: FacilityAllocation[] = await res.json();
        setFacilities(data);
        if (data.length > 0 && (resetSelection || !data.some(f => f.id === selectedFacilityId))) {
          // Default to Konkoma SDA Clinic if present, else first facility
          const konkoma = data.find(f => f.facilityName.toLowerCase().includes('konkoma'));
          setSelectedFacilityId(konkoma ? konkoma.id : data[0].id);
        } else if (data.length === 0) {
          setSelectedFacilityId('');
        }
      }
    } catch (err) {
      console.error('Failed to load facilities:', err);
    } finally {
      setLoadingFacilities(false);
    }
  };

  // Fetch audit logs
  const fetchAuditLogs = async () => {
    setLoadingAuditLogs(true);
    try {
      const res = await fetch('/api/vaccine/audit-logs');
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  useEffect(() => {
    fetchFacilities();
  }, []);

  const selectedFacility = facilities.find(f => f.id === selectedFacilityId);

  // Extract distinct districts for filtering
  const distinctDistricts = useMemo(() => {
    const dists = new Set<string>();
    facilities.forEach(f => {
      if (f.district) dists.add(f.district);
    });
    return Array.from(dists);
  }, [facilities]);

  // Extract distinct worksheet tab names for filtering
  const distinctWorksheets = useMemo(() => {
    const tabs = new Set<string>();
    facilities.forEach(f => {
      if (f.tabName) tabs.add(f.tabName);
    });
    return Array.from(tabs);
  }, [facilities]);

  // Filter facilities based on search, district, and worksheet
  const filteredFacilities = useMemo(() => {
    return facilities.filter(f => {
      const matchesSearch =
        f.facilityName.toLowerCase().includes(facilitySearch.toLowerCase()) ||
        (f.district && f.district.toLowerCase().includes(facilitySearch.toLowerCase())) ||
        (f.subDistrict && f.subDistrict.toLowerCase().includes(facilitySearch.toLowerCase())) ||
        (f.tabName && f.tabName.toLowerCase().includes(facilitySearch.toLowerCase()));

      const matchesDistrict =
        selectedDistrictFilter === 'all' || f.district === selectedDistrictFilter;

      const matchesWorksheet =
        selectedWorksheetFilter === 'all' || f.tabName === selectedWorksheetFilter;

      return matchesSearch && matchesDistrict && matchesWorksheet;
    });
  }, [facilities, facilitySearch, selectedDistrictFilter, selectedWorksheetFilter]);

  // Filtered vaccine entries for Current Vaccine Position table
  const vaccineEntries = useMemo(() => {
    if (!selectedFacility?.vaccines) return [];
    const entries = Object.entries(selectedFacility.vaccines) as [string, VaccineAllocationItem][];
    if (!vaccineTableSearch.trim()) return entries;
    const q = vaccineTableSearch.toLowerCase().trim();
    return entries.filter(([name]) => name.toLowerCase().includes(q));
  }, [selectedFacility, vaccineTableSearch]);

  // Real-time stock statistics for Current Vaccine Position
  const vaccineStats = useMemo(() => {
    if (!selectedFacility?.vaccines) return { total: 0, healthy: 0, low: 0, exhausted: 0 };
    let total = 0;
    let healthy = 0;
    let low = 0;
    let exhausted = 0;
    Object.values(selectedFacility.vaccines).forEach((alloc: VaccineAllocationItem) => {
      total++;
      const totalAuth = (alloc.carryOver || 0) + alloc.original + (alloc.topUp || 0) + (alloc.adjustment || 0);
      if (alloc.remaining <= 0) {
        exhausted++;
      } else if (alloc.remaining <= 5 || alloc.remaining / (totalAuth || 1) <= 0.2) {
        low++;
      } else {
        healthy++;
      }
    });
    return { total, healthy, low, exhausted };
  }, [selectedFacility]);

  // Real-time FS extraction & comparison against Allocation Blueprint
  const fsAudit = useMemo(() => {
    if (orderSource !== 'fs_only' || !fulfillmentConfirmation.trim()) {
      return null;
    }

    const text = fulfillmentConfirmation;

    // 1. Extract facility candidate from FS text
    let detectedName: string | null = null;
    let matchedFacility: FacilityAllocation | undefined = undefined;

    // Check label match (e.g. 'Facility: ...', 'Hospital: ...', etc.)
    const labelMatch = text.match(/(?:facility|hospital|clinic|health\s*cent(?:er|re)|chps|polyclinic|dispensary|delivered\s*to|ordering\s*facility|destination|location|site|recipient|to|for)\s*[:=–—]\s*([^\n\r,]+)/i);
    if (labelMatch) {
      const candidate = labelMatch[1].trim().replace(/^['"]|['"]$/g, '').replace(/[-–—.,]+$/, '').trim();
      if (candidate.length > 2) {
        detectedName = candidate;
        matchedFacility = facilities.find(f =>
          f.facilityName.toLowerCase().trim() === candidate.toLowerCase().trim() ||
          f.facilityName.toLowerCase().includes(candidate.toLowerCase()) ||
          candidate.toLowerCase().includes(f.facilityName.toLowerCase())
        );
      }
    }

    // Check against all known facilities
    if (!matchedFacility) {
      const lowerText = text.toLowerCase();
      for (const f of facilities) {
        if (lowerText.includes(f.facilityName.toLowerCase())) {
          detectedName = f.facilityName;
          matchedFacility = f;
          break;
        }
      }
    }

    // Line scanner
    if (!matchedFacility) {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4);
      for (const line of lines) {
        if (/(?:hospital|clinic|health\s*cent(?:er|re)|chps|polyclinic)/i.test(line)) {
          const cleaned = line.replace(/^(?:order\s*for|dispatch\s*to|delivery\s*to|to|facility)\s*[:=–—]?\s*/i, '').trim();
          if (cleaned.length > 3) {
            detectedName = cleaned;
            matchedFacility = facilities.find(f =>
              f.facilityName.toLowerCase().trim() === cleaned.toLowerCase().trim() ||
              f.facilityName.toLowerCase().includes(cleaned.toLowerCase()) ||
              cleaned.toLowerCase().includes(f.facilityName.toLowerCase())
            );
            if (matchedFacility) break;
          }
        }
      }
    }

    const currentSelected = facilities.find(f => f.id === selectedFacilityId);
    const hasFacilityMismatch = Boolean(
      detectedName &&
      currentSelected &&
      matchedFacility &&
      matchedFacility.id !== currentSelected.id
    );

    const isUnknownFacility = Boolean(detectedName && !matchedFacility);
    const targetFacility = currentSelected || matchedFacility;

    // Parse items from FS confirmation
    const lines = text.split('\n');
    const parsedItems: { name: string; canonical: string; productType: FsProductType; qty: number }[] = [];
    for (const rawLine of lines) {
      let trimmed = rawLine.trim();
      if (!trimmed) continue;
      // Normalize numbers with commas
      trimmed = trimmed.replace(/(\d),(\d{3})/g, '$1$2');
      // Strip leading list numbering (e.g. "1. ", "• ") without stripping quantity if number comes first
      trimmed = trimmed.replace(/^[\s•\-\*\>#]*\d+[\.\)\-–]\s*/, '').replace(/^[\s•\-\*\>#]+/, '').trim();
      if (/^(?:facility|hospital|clinic|district|order|phone|contact|date|delivered|received|status|dr|cca|to|for|recipient)\s*[:=]/i.test(trimmed)) continue;

      let name = '';
      let itemQty = 0;

      const bracketQuantity = trimmed.match(/^(.+?)\s*\[\s*(\d[\d,]*)\s*(?:\/\s*\d[\d,]*\s*)?\]\s*[.!]?$/);
      if (bracketQuantity) {
        name = bracketQuantity[1].trim();
        itemQty = parseInt(bracketQuantity[2].replace(/,/g, ''), 10);
      } else if (/^\d/.test(trimmed)) {
        const m = trimmed.match(/^(\d[\d,]*)\s*(?:vials?|doses?|packs?|boxes?|pieces?|pcs?|units?|drops?|x|X)?\s*[-:=–—=]?\s*([A-Za-z][A-Za-z0-9\s\-–\(\)\/]*)/i);
        if (m) {
          itemQty = parseInt(m[1].replace(/,/g, ''), 10);
          name = m[2].trim();
        }
      } else {
        const m = trimmed.match(/^([A-Za-z0-9\s\-–\(\)\/]+?)(?:[-:=–—xX=]|\s{2,}|\t|\s*\()\s*(\d[\d,]*)\s*(?:vials?|doses?|packs?|boxes?|pieces?|pcs?|units?|drops?|\))?(?:[^\d\n]*)$/i);
        if (m) {
          name = m[1].trim();
          itemQty = parseInt(m[2].replace(/,/g, ''), 10);
        } else {
          const mC = trimmed.match(/^([A-Za-z0-9\s/]+?)\s+(\d[\d,]*)(?:\s*(?:vials?|doses?|packs?|boxes?|pieces?|pcs?|units?|drops?))?(?:[^\d\n]*)$/i);
          if (mC) {
            name = mC[1].trim();
            itemQty = parseInt(mC[2].replace(/,/g, ''), 10);
          }
        }
      }

      if (name && !isNaN(itemQty) && itemQty >= 0) {
        const canonical = matchVaccineCanonical(name);
        parsedItems.push({
          name,
          canonical,
          productType: getFsProductType(canonical),
          qty: itemQty
        });
      }
    }

    // Live discrepancies against target facility's Allocation Blueprint
    const discrepancies: string[] = [];

    if (hasFacilityMismatch) {
      discrepancies.push(`Facility Mismatch: FS specifies "${detectedName}", but active Blueprint is "${currentSelected?.facilityName}".`);
    } else if (isUnknownFacility) {
      discrepancies.push(`Unknown Facility: "${detectedName}" does not exist in the Allocation Blueprint.`);
    }

    if (targetFacility?.vaccines && !hasFacilityMismatch && !isUnknownFacility) {
      for (const item of parsedItems) {
        if (item.productType !== 'PRIMARY_VACCINE') {
          // Companion products are validated against their vaccine relationship,
          // never as independent blueprint allocations.
          continue;
        }

        const canonical = item.canonical;
        const vKey = Object.keys(targetFacility.vaccines).find(k => {
          if (k.toLowerCase() === item.name.toLowerCase()) return true;
          if (k.toLowerCase() === canonical.toLowerCase()) return true;
          if (matchVaccineCanonical(k).toLowerCase() === canonical.toLowerCase()) return true;
          return false;
        });

        if (!vKey) {
          discrepancies.push(`Not in Blueprint: "${item.name}" has no allocation record for ${targetFacility.facilityName}.`);
        } else {
          const alloc = targetFacility.vaccines[vKey];
          const dpv = alloc.dosesPerVial || getVaccineDosesPerVial(vKey);
          if (alloc.remaining <= 0) {
            discrepancies.push(`🔴 ALLOCATION EXHAUSTED: "${vKey}" has 0 vials remaining in Blueprint (FS order: ${item.qty} vials).`);
          } else if (item.qty > alloc.remaining) {
            const excessVials = item.qty - alloc.remaining;
            const excessDoses = excessVials * dpv;
            discrepancies.push(`🔴 ALLOCATION EXCEEDED: "${vKey}" – FS order (${item.qty} vials) exceeds available balance (${alloc.remaining} vials). Excess: ${excessVials} vials (${excessDoses} doses).`);
          }
        }
      }
    }

    return {
      detectedName,
      matchedFacility,
      currentSelected,
      hasFacilityMismatch,
      isUnknownFacility,
      targetFacility,
      parsedItems,
      discrepancies
    };
  }, [orderSource, fulfillmentConfirmation, facilities, selectedFacilityId]);

  // Debounced live re-audit when message text changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const hasText = orderSource === 'fs_only'
      ? Boolean(fulfillmentConfirmation.trim())
      : Boolean(whatsappMessage.trim() || fulfillmentConfirmation.trim());

    if (!hasText) {
      setValidationResult(null);
      setIsStaleValidation(false);
      return;
    }

    // Mark previous validation result as stale so user sees immediate feedback
    if (validationResult) {
      setIsStaleValidation(true);
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      handleValidate();
    }, 400);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [fulfillmentConfirmation, whatsappMessage, orderSource, selectedFacilityId]);

  // Auto-bind facility when typed/pasted in FS Only mode if none selected
  useEffect(() => {
    if (orderSource === 'fs_only' && !selectedFacilityId && fsAudit?.matchedFacility) {
      setSelectedFacilityId(fsAudit.matchedFacility.id);
    }
  }, [orderSource, selectedFacilityId, fsAudit?.matchedFacility]);

  // Preset scenarios for 1-click audit demonstrations
  const loadScenario = (scenarioKey: any) => {
    const konkoma = facilities.find(f => f.facilityName.toLowerCase().includes('konkoma'));
    if (konkoma && selectedFacilityId !== konkoma.id) {
      setSelectedFacilityId(konkoma.id);
    }

    setValidationError(null);
    setValidationResult(null);
    setConfirmationSuccess(null);

    // FS Only Scenarios
    if (scenarioKey === 'fs_valid') {
      setOrderSource('fs_only');
      setWhatsappMessage('');
      setFulfillmentConfirmation('Facility: Konkoma SDA Clinic\nBCG: 10\nBCG Diluent: 10\nOPV: 20\nOPV Dropper: 20\nPenta: 15\nStatus: Verified');
      return;
    }
    if (scenarioKey === 'fs_facility_mismatch') {
      setOrderSource('fs_only');
      setWhatsappMessage('');
      // Set FS to a different facility than Konkoma (e.g. Kparigu Health Centre)
      setFulfillmentConfirmation('Facility: Kparigu Health Centre\nBCG: 10\nBCG Diluent: 10\nOPV: 20\nOPV Dropper: 20\nPenta: 15\nStatus: Pending');
      return;
    }
    if (scenarioKey === 'fs_excess') {
      setOrderSource('fs_only');
      setWhatsappMessage('');
      setFulfillmentConfirmation('Facility: Konkoma SDA Clinic\nBCG: 150\nBCG Diluent: 150\nOPV: 200\nOPV Dropper: 200\nStatus: Ready');
      return;
    }
    if (scenarioKey === 'fs_exhausted') {
      setOrderSource('fs_only');
      setWhatsappMessage('');
      setFulfillmentConfirmation('Facility: Konkoma SDA Clinic\nMR: 10\nMR Diluent: 10\nStatus: Queued');
      return;
    }
    if (scenarioKey === 'fs_missing_diluent') {
      setOrderSource('fs_only');
      setWhatsappMessage('');
      setFulfillmentConfirmation('Facility: Konkoma SDA Clinic\nBCG: 20\nOPV: 20\nStatus: Draft');
      return;
    }

    // Standard WhatsApp Scenarios
    setOrderSource('whatsapp');

    switch (scenarioKey) {
      case 'valid':
        // Perfect match within quota
        setWhatsappMessage('Good day dispatch,\nPlease dispatch vaccines for Konkoma SDA Clinic:\nBCG - 10\nOPV - 20\nPenta - 15\nThank you.');
        setFulfillmentConfirmation('Facility: Konkoma SDA Clinic\nOrder Verified:\nBCG - 10\nOPV - 20\nPenta - 15\nStatus: Packed & Awaiting Confirmation');
        break;

      case 'excess':
        // Allocation Exceeded (Over-allocation)
        setWhatsappMessage('Good day, urgent order for Konkoma SDA Clinic:\nBCG: 100\nRoutine monthly stock');
        setFulfillmentConfirmation('Facility: Konkoma SDA Clinic\nDispatch Confirmation:\nBCG - 100\nDestination: Konkoma Drop');
        break;

      case 'exhausted':
        // Allocation Exhausted (MR has 0 remaining)
        setWhatsappMessage('Order for Konkoma SDA Clinic:\nMR: 5\nChild immunization outreach');
        setFulfillmentConfirmation('Facility: Konkoma SDA Clinic\nOrder Packing:\nMR - 5\nStandard cooler packaging');
        break;

      case 'mismatch':
        // Quantity Mismatch between WhatsApp and FS
        setWhatsappMessage('Order for Konkoma SDA Clinic:\nBCG: 10\nOPV: 10');
        setFulfillmentConfirmation('Facility: Konkoma SDA Clinic\nPacking Slip:\nBCG: 100\nOPV: 10');
        break;

      case 'missing_unexpected':
        // Missing Rota, Unexpected HPV
        setWhatsappMessage('Konkoma SDA Clinic request:\nRota: 10\nPenta: 10');
        setFulfillmentConfirmation('Facility: Konkoma SDA Clinic\nItems Loaded:\nPenta: 10\nHPV: 5');
        break;
    }
  };

  // Facility Metadata Update Handler
  const handleUpdateFacilityName = async (facilityId: string, updates: { facilityName: string; district?: string; subDistrict?: string }): Promise<boolean> => {
    try {
      const res = await fetch(`/api/vaccine/facilities/${facilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.facility) {
          setFacilities(prev => prev.map(f => f.id === facilityId ? { ...f, ...data.facility } : f));
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to update facility details:', err);
      return false;
    }
  };

  // Add Product / Vaccine To Facility Allocation Handler
  const handleAddProductToFacility = async (
    facilityId: string,
    product: { vaccineName: string; original?: number; carryOver?: number; topUp?: number; dosesPerVial?: number; unit?: 'vials' | 'doses' }
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/vaccine/facilities/${facilityId}/vaccines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.facility) {
          setFacilities(prev => prev.map(f => f.id === facilityId ? { ...f, ...data.facility } : f));
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to add product to facility:', err);
      return false;
    }
  };

  // Perform Validation
  const handleValidate = async (): Promise<VaccineValidationResult | null> => {
    let effectiveFacilityId = selectedFacilityId;
    if (!effectiveFacilityId && orderSource === 'fs_only' && fsAudit?.matchedFacility) {
      effectiveFacilityId = fsAudit.matchedFacility.id;
      setSelectedFacilityId(effectiveFacilityId);
    }
    if (!effectiveFacilityId && orderSource === 'fs_only') {
      // Allow 'auto' if user has entered facility in the message text
      effectiveFacilityId = 'auto';
    }
    if (!effectiveFacilityId) {
      setValidationError('Please select a facility or include "Facility: <Name>" in your FS message.');
      return null;
    }
    if (orderSource === 'whatsapp' && !whatsappMessage.trim() && !fulfillmentConfirmation.trim()) {
      setValidationError('Please paste the Customer WhatsApp Order or Fulfillment System (FS) Confirmation.');
      return null;
    }
    if (orderSource === 'fs_only' && !fulfillmentConfirmation.trim()) {
      setValidationError('Please paste the Fulfillment System (FS) Confirmation.');
      return null;
    }
    setValidating(true);
    setValidationError(null);
    setIsStaleValidation(false);
    setValidationResult(null);
    setConfirmationSuccess(null);
    setConfirmationError(null);

    try {
      const res = await fetch('/api/vaccine/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityId: effectiveFacilityId,
          orderSource,
          whatsappMessage: whatsappMessage.trim(),
          fulfillmentConfirmation: fulfillmentConfirmation.trim()
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to validate order');
      }

      const data: VaccineValidationResult = await res.json();
      setValidationResult(data);
      return data;
    } catch (err: any) {
      setValidationError(err.message || 'Validation service communication failure.');
      return null;
    } finally {
      setValidating(false);
    }
  };

  // Confirm Order & Update Allocation (Atomic Multi-CCA Safe)
  const handleConfirmOrder = async () => {
    if (!validationResult || !validationResult.isValid || isStaleValidation || confirming) return;
    const approvedAuditId = validationResult.auditLogId;
    setConfirming(true);
    setConfirmationError(null);

    try {
      const freshAudit = await handleValidate();
      if (!freshAudit?.isValid) {
        setShowReviewModal(false);
        return;
      }
      const orderItems = freshAudit.items
        .filter(it => (it.fsQty || it.requestedQty) > 0)
        .map(it => ({
          vaccine: it.vaccine,
          currentOrder: it.fsQty || it.requestedQty
        }));

      const res = await fetch('/api/vaccine/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityId: selectedFacilityId,
          orderSource,
          items: orderItems,
          ccaUser: ccaName,
          orderId: approvedAuditId,
          rawOrderText: whatsappMessage,
          rawFsText: fulfillmentConfirmation
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Allocation update failed.');
      }

      if (data.updatedFacility) {
        setFacilities(prev => prev.map(f => f.id === data.updatedFacility.id ? data.updatedFacility : f));
      }

      setConfirmationSuccess(data.transaction);
      setShowReviewModal(false);

      // Start the next audit from the checker defaults after the confirmed order is saved.
      setOrderSource('whatsapp');
      setWhatsappMessage('');
      setFulfillmentConfirmation('');
      setValidationResult(null);
      setValidationError(null);
      setIsStaleValidation(false);
      setConfirmationError(null);
      setFacilitySearch('');
      setSelectedWorksheetFilter('all');
      setSelectedDistrictFilter('all');
      setIsFacilityDropdownOpen(false);
      setAuditMatrixFilter('all');
      setVaccineTableSearch('');
      setUnitDisplayMode('both');

      // Refresh allocations and return the facility selector to its default choice.
      await fetchFacilities(true);
    } catch (err: any) {
      setConfirmationError(err.message || 'Failed to confirm transaction.');
    } finally {
      setConfirming(false);
    }
  };

  // Handle Unrelieved Top-Up submission
  const handleSaveTopUp = async () => {
    if (!selectedFacilityId || !topUpVaccine || isNaN(Number(topUpQty))) {
      return;
    }
    setSavingTopUp(true);
    try {
      const res = await fetch(`/api/vaccine/allocations/${selectedFacilityId}/topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaccine: topUpVaccine,
          topUp: Number(topUpQty),
          unit: topUpUnit,
          user: ccaName
        })
      });

      if (res.ok) {
        setTopUpModalOpen(false);
        setTopUpQty('');
        setTopUpUnit('vials');
        await fetchFacilities();
      }
    } catch (err) {
      console.error('Failed to save top-up:', err);
    } finally {
      setSavingTopUp(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Operational Empty State when allocations have been cleared for a new cycle */}
      {facilities.length === 0 && !loadingFacilities ? (
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-10 text-center max-w-xl mx-auto flex flex-col items-center">
          <div className="w-16 h-16 rounded-3xl bg-orange-50 text-[#ED7D31] flex items-center justify-center mb-4 shadow-2xs">
            <FileSpreadsheet className="w-8 h-8" />
          </div>
          <span className="bg-orange-100 text-[#C55A11] text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider mb-2 border border-orange-200">
            67-Column Blueprint Active
          </span>
          <h3 className="text-lg font-black text-slate-900 tracking-tight mb-2">
            No Active Allocations Loaded
          </h3>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed max-w-md text-center">
            Vaccines, allocations, carry-over, and distributed quantities are written directly in the 67-column <strong>Allocation Blueprint</strong>. Incoming facility orders are compared against these blueprint balances to detect discrepancies.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => (onNavigateToBlueprint || onNavigateToTracker)?.()}
              className="bg-[#ED7D31] hover:bg-[#C55A11] text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all shadow cursor-pointer flex items-center gap-2"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Open Allocation Blueprint
            </button>
            <button
              onClick={async () => {
                await fetchFacilities();
              }}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-4 py-2.5 rounded-xl transition-all border border-slate-200 cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              Refresh Facilities
            </button>
          </div>
        </div>
      ) : (
        /* Main Operational Validation Card */
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
          {/* Card Header */}
          <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-50 via-purple-50/20 to-white">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#5C2D91]/10 flex items-center justify-center text-[#5C2D91] shadow-2xs">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">
                    Vaccine Allocation Auditing &amp; Verification
                  </h2>
                  <span className="bg-orange-50 text-[#C55A11] border border-orange-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#ED7D31] animate-pulse"></span>
                    Blueprint Source Active (67-Col)
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  Authoritative Allocation Blueprint (sample.xlsx) ↔ WhatsApp Order ↔ Fulfillment System Confirmation
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  fetchAuditLogs();
                  setShowAuditLogs(true);
                }}
                className="text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="View recent audit logs"
              >
                <History className="w-3.5 h-3.5 text-slate-500" />
                Audit Logs
              </button>

              <button
                type="button"
                onClick={() => (onNavigateToBlueprint || onNavigateToTracker)?.()}
                className="text-xs font-bold text-[#C55A11] hover:text-[#9C430B] bg-orange-50 hover:bg-orange-100 border border-orange-200 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="View or edit vaccines and quantities in Blueprint"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#ED7D31]" />
                Allocation Blueprint
              </button>

              <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">CCA:</span>
                <input
                  type="text"
                  value={ccaName}
                  onChange={e => setCcaName(e.target.value)}
                  className="text-xs font-semibold text-slate-800 bg-transparent outline-none w-28"
                  placeholder="Your Name"
                />
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {facilities.length === 0 ? (
              <div className="bg-slate-50 border-2 border-dashed border-orange-200 rounded-3xl p-10 text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-orange-100 text-[#ED7D31] mx-auto flex items-center justify-center shadow-xs">
                  <FileSpreadsheet className="w-8 h-8" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-black text-slate-900">No Facilities Loaded</h3>
                  <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                    Vaccines and quantities are written in the <strong>Allocation Blueprint</strong>. Open the Blueprint to define facility quotas and cross-check incoming orders for discrepancies.
                  </p>
                </div>
                {(onNavigateToBlueprint || onNavigateToTracker) && (
                  <button
                    type="button"
                    onClick={onNavigateToBlueprint || onNavigateToTracker}
                    className="inline-flex items-center gap-2 bg-[#ED7D31] hover:bg-[#C55A11] text-white text-xs font-bold px-6 py-3 rounded-2xl shadow-md transition-all cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Go to Allocation Blueprint &rarr;</span>
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* STEP 1: Searchable Facility & Worksheet Selection (Requirement #8) */}
                <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-[#5C2D91] text-white text-[11px] font-black flex items-center justify-center">1</span>
                  Select Facility &amp; Worksheet Tab
                </label>
                {selectedFacility && (
                  <span className="text-xs text-slate-500">
                    Worksheet: <strong className="text-purple-900 font-bold">{selectedFacility.tabName || 'Main Allocation'}</strong>
                    {" "}&bull; District: <strong className="text-slate-800">{selectedFacility.district}</strong>
                    {selectedFacility.subDistrict && (
                      <> &bull; Sub-District: <strong className="text-indigo-700 font-bold">{selectedFacility.subDistrict}</strong></>
                    )}
                  </span>
                )}
              </div>

              {/* District & Worksheet Filter Tabs */}
              {(distinctDistricts.length > 1 || distinctWorksheets.length > 1) && (
                <div className="space-y-2 pb-1 text-xs">
                  {distinctDistricts.length > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      <span className="text-[11px] font-bold text-[#C55A11] uppercase tracking-wider mr-1 flex items-center gap-1 whitespace-nowrap">
                        <MapPin className="w-3 h-3 text-[#ED7D31]" />
                        District:
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedDistrictFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                          selectedDistrictFilter === 'all'
                            ? 'bg-[#ED7D31] text-white shadow-2xs font-bold'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        All Districts ({distinctDistricts.length})
                      </button>
                      {distinctDistricts.map(dist => (
                        <button
                          key={dist}
                          type="button"
                          onClick={() => setSelectedDistrictFilter(dist)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            selectedDistrictFilter === dist
                              ? 'bg-[#ED7D31] text-white shadow-2xs font-bold'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {dist}
                        </button>
                      ))}
                    </div>
                  )}

                  {distinctWorksheets.length > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1 whitespace-nowrap">Worksheet:</span>
                      <button
                        type="button"
                        onClick={() => setSelectedWorksheetFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                          selectedWorksheetFilter === 'all'
                            ? 'bg-[#5C2D91] text-white shadow-2xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        All Sheets ({facilities.length})
                      </button>
                      {distinctWorksheets.map(tab => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setSelectedWorksheetFilter(tab)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            selectedWorksheetFilter === tab
                              ? 'bg-[#5C2D91] text-white shadow-2xs'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Custom Searchable Facility Picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsFacilityDropdownOpen(!isFacilityDropdownOpen)}
                  className="w-full flex items-center justify-between bg-slate-50 hover:bg-slate-100/80 border border-slate-200 hover:border-slate-300 rounded-2xl px-4 py-3 text-left transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3 truncate">
                    <Building2 className="w-5 h-5 text-[#5C2D91] flex-shrink-0" />
                    <div>
                      <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        {selectedFacility ? selectedFacility.facilityName : 'Select a facility...'}
                        {selectedFacility?.tabName && (
                          <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded border border-purple-200">
                            {selectedFacility.tabName}
                          </span>
                        )}
                      </div>
                      {selectedFacility && (
                        <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span>{selectedFacility.nest} &bull; {selectedFacility.district}</span>
                          {selectedFacility.subDistrict && (
                            <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded text-[10px] font-semibold border border-indigo-200">
                              {selectedFacility.subDistrict}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 font-mono">
                            ({Object.keys(selectedFacility.vaccines).length} configured antigens)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isFacilityDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isFacilityDropdownOpen && (
                  <div className="absolute z-30 top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                    <div className="p-2 border-b border-slate-100 bg-slate-50/70">
                      <div className="relative">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          placeholder="Search facility name, sub-district, district, or sheet tab..."
                          value={facilitySearch}
                          onChange={e => setFacilitySearch(e.target.value)}
                          className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:border-[#5C2D91]"
                          autoFocus
                        />
                      </div>
                    </div>

                    <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                      {filteredFacilities.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400">
                          No facilities found matching &quot;{facilitySearch}&quot;
                        </div>
                      ) : (
                        filteredFacilities.map(f => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => {
                              setSelectedFacilityId(f.id);
                              setIsFacilityDropdownOpen(false);
                              setValidationResult(null);
                            }}
                            className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-purple-50/50 transition-colors cursor-pointer ${
                              selectedFacilityId === f.id ? 'bg-purple-50 font-bold text-[#5C2D91]' : 'text-slate-700'
                            }`}
                          >
                            <div>
                              <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                                {f.facilityName}
                                {f.tabName && (
                                  <span className="bg-purple-50 text-purple-700 text-[10px] font-medium px-1.5 py-0.2 rounded border border-purple-100">
                                    {f.tabName}
                                  </span>
                                )}
                                {f.subDistrict && (
                                  <span className="bg-indigo-50 text-indigo-700 text-[10px] font-medium px-1.5 py-0.2 rounded border border-indigo-100">
                                    {f.subDistrict}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500">{f.nest} &bull; {f.district}</div>
                            </div>
                            {selectedFacilityId === f.id && (
                              <CheckCircle2 className="w-4 h-4 text-[#5C2D91]" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ========================================================================= */}
            {/* SIDE-BY-SIDE AUDIT WORKSPACE: CURRENT VACCINE POSITION ↔ ORDER SOURCE     */}
            {/* ========================================================================= */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* LEFT PANE: STEP 2 - Current Vaccine Position (lg:col-span-7) */}
              <div className="lg:col-span-7">
                <VaccinePositionPanel
                  selectedFacility={selectedFacility}
                  unitDisplayMode={unitDisplayMode}
                  setUnitDisplayMode={setUnitDisplayMode}
                  onOpenTopUp={(firstVac) => {
                    setTopUpVaccine(firstVac || "BCG");
                    setTopUpQty("");
                    setTopUpUnit("vials");
                    setTopUpModalOpen(true);
                  }}
                  onNavigateToBlueprint={onNavigateToBlueprint || onNavigateToTracker}
                />
              </div>

              {/* RIGHT PANE: STEP 3, 4, 5 - Order Source & Audit Input (lg:col-span-5) */}
              <div className="lg:col-span-5">
                <OrderSourcePanel
                  orderSource={orderSource}
                  setOrderSource={setOrderSource}
                  whatsappMessage={whatsappMessage}
                  setWhatsappMessage={setWhatsappMessage}
                  fulfillmentConfirmation={fulfillmentConfirmation}
                  setFulfillmentConfirmation={setFulfillmentConfirmation}
                  onLoadScenario={loadScenario}
                  onClear={() => {
                    setWhatsappMessage("");
                    setFulfillmentConfirmation("");
                    setValidationResult(null);
                    setValidationError(null);
                  }}
                  onValidate={handleValidate}
                  validating={validating}
                  selectedFacilityId={selectedFacilityId}
                  selectedFacilityName={selectedFacility?.facilityName}
                  detectedFacilityName={fsAudit?.detectedName}
                  detectedFacilityId={fsAudit?.matchedFacility?.id}
                  facilityMismatch={fsAudit?.hasFacilityMismatch}
                  onSwitchToDetectedFacility={() => {
                    if (fsAudit?.matchedFacility) {
                      setSelectedFacilityId(fsAudit.matchedFacility.id);
                    }
                  }}
                  liveBlueprintDiscrepancies={fsAudit?.discrepancies}
                  parsedItemsCount={fsAudit?.parsedItems?.length || 0}
                  hasContent={Boolean(whatsappMessage || fulfillmentConfirmation || validationResult)}
                />
              </div>
            </div>

            {/* General Communication / Validation Error */}
            {validationError && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-800 text-xs">
                <XCircle className="w-5 h-5 flex-shrink-0 text-rose-600" />
                <span>{validationError}</span>
              </div>
            )}

            {/* STEP 6 & 7: AUDIT RESULTS SCREEN (GREEN LIGHT / RED LIGHT) (Requirements #11-#17) */}
            {validationResult && (
              <div className="space-y-5 pt-4 border-t border-slate-200 animate-in fade-in duration-200">
                {/* Visual Feedback Banners */}
                {isStaleValidation ? (
                  <div className="p-5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-3xl shadow-lg flex items-center justify-between gap-4 animate-pulse">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="w-6 h-6 text-white animate-spin flex-shrink-0" />
                      <div>
                        <div className="text-sm font-black uppercase tracking-wide">
                          ⚠️ Order Confirmation Text Changed — Live Re-Auditing Against Blueprint...
                        </div>
                        <div className="text-xs text-amber-100">
                          Re-evaluating new quantities against Allocation Blueprint quota in real-time.
                        </div>
                      </div>
                    </div>
                  </div>
                ) : validationResult.isValid ? (
                  /* 🟢 GREEN LIGHT BANNER (Requirement #16) */
                  <div className="p-6 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-3xl shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0 shadow-inner">
                        <CheckCircle2 className="w-9 h-9 text-white" />
                      </div>
                      <div className="space-y-1">
                        <div className="text-lg font-black tracking-wide uppercase flex items-center gap-2">
                          <span>🟢 GREEN LIGHT: Order fully verified against allocation sheet.</span>
                        </div>
                        <p className="text-xs text-emerald-50 font-medium max-w-xl">
                          All customer requested products match FS products, all quantities match, no unexpected products exist, all products are allocated to <strong>{validationResult.facilitySelected}</strong>, and all quantities are strictly within remaining allocation.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowReviewModal(true)}
                      className="bg-white text-emerald-800 hover:bg-emerald-50 text-xs font-black px-6 py-3 rounded-2xl shadow-md transition-all flex items-center gap-2 cursor-pointer uppercase tracking-wider whitespace-nowrap self-stretch md:self-auto justify-center"
                    >
                      <Check className="w-4 h-4 text-emerald-600" />
                      Confirm &amp; Update Allocation Blueprint
                    </button>
                  </div>
                ) : (
                  /* 🔴 RED LIGHT / DO NOT PROCESS BANNER (Requirement #17) */
                  <div className="p-6 bg-gradient-to-r from-rose-600 to-red-700 text-white rounded-3xl shadow-lg space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0 shadow-inner">
                        <XCircle className="w-9 h-9 text-white" />
                      </div>
                      <div className="space-y-1 flex-1">
                        <div className="text-lg font-black tracking-wide uppercase flex items-center gap-2">
                          <span>🔴 DO NOT PROCESS: {validationResult.errors.length} {validationResult.errors.length === 1 ? 'discrepancy' : 'discrepancies'} found.</span>
                        </div>
                        <p className="text-xs text-rose-100 font-medium">
                          Correct the discrepancies below with the health facility or Fulfillment System before dispatching.
                        </p>
                      </div>
                    </div>

                    {/* Detailed Categorized Errors List (Requirements #11, #12, #13, #14, #15) */}
                    <div className="grid grid-cols-1 gap-2 pt-1">
                      {validationResult.errors.map((err, idx) => (
                        <div
                          key={idx}
                          className="bg-white/10 hover:bg-white/15 rounded-xl p-3 text-xs font-semibold flex items-start gap-2.5 text-white border border-white/20"
                        >
                          <span className="font-mono text-rose-200 font-bold text-sm leading-none mt-0.5">&bull;</span>
                          <span className="leading-relaxed">{err}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Duplicate Order Warning if detected (Requirement #18) */}
                {validationResult.duplicateWarning && (
                  <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3 text-amber-900 text-xs shadow-sm">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600 mt-0.5" />
                    <div>
                      <div className="font-bold text-amber-950 uppercase tracking-wider text-[11px]">
                        ⚠️ Duplicate Distribution Protection Alert
                      </div>
                      <div className="mt-0.5">{validationResult.duplicateWarning.message}</div>
                    </div>
                  </div>
                )}

                {/* Updated Remaining Balance Preview Table (Requirement #16) */}
                {validationResult.isValid && (
                  <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-black uppercase tracking-wider text-emerald-900 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Updated Remaining Balance Preview
                      </h5>
                      <span className="text-[11px] text-emerald-700 font-medium">
                        Will be committed upon CCA confirmation
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-emerald-200 text-emerald-800 font-bold uppercase tracking-wider text-[11px]">
                            <th className="py-2 px-3">Vaccine</th>
                            <th className="py-2 px-3 text-right">Previous Remaining</th>
                            <th className="py-2 px-3 text-right font-black text-purple-900">Current Order</th>
                            <th className="py-2 px-3 text-right font-black text-emerald-900">New Remaining</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-emerald-100 font-medium">
                          {validationResult.items
                            .filter(it => (it.fsQty || it.requestedQty) > 0)
                            .map((it, idx) => {
                              const dpv = it.dosesPerVial || getVaccineDosesPerVial(it.vaccine);
                              const remBeforeDoses = it.remainingBeforeDoses !== undefined ? it.remainingBeforeDoses : it.remainingBefore * dpv;
                              const orderQty = it.fsQty || it.requestedQty;
                              const orderDoses = it.fsDoses || it.requestedDoses || orderQty * dpv;
                              const remAfterDoses = it.remainingAfterDoses !== undefined ? it.remainingAfterDoses : it.remainingAfter * dpv;

                              return (
                                <tr key={idx} className="hover:bg-white/40">
                                  <td className="py-2 px-3 font-bold text-slate-900">
                                    {it.vaccine}
                                    <span className="text-[10px] text-slate-400 font-normal block">({dpv} doses/vial)</span>
                                  </td>
                                  <td className="py-2 px-3 text-right text-slate-600">
                                    <div className="leading-tight">
                                      <span className="font-semibold">{it.remainingBefore} vials</span>
                                      <span className="text-[10px] text-slate-400 block font-normal">({remBeforeDoses.toLocaleString()} doses)</span>
                                    </div>
                                  </td>
                                  <td className="py-2 px-3 text-right font-black text-purple-900">
                                    <div className="leading-tight">
                                      <span>{orderQty} vials</span>
                                      <span className="text-[10px] text-purple-700 block font-normal">({orderDoses.toLocaleString()} doses)</span>
                                    </div>
                                  </td>
                                  <td className="py-2 px-3 text-right font-black text-emerald-700 text-sm">
                                    <div className="leading-tight">
                                      <span>{it.remainingAfter} vials</span>
                                      <span className="text-[10px] text-emerald-600 block font-normal">({remAfterDoses.toLocaleString()} doses)</span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Comprehensive Auditing Comparison Matrix */}
                {(() => {
                  const allItems = validationResult.items || [];
                  const discrepancyItems = allItems.filter(it => it.status !== 'valid' && it.status !== 'not_in_order');
                  const orderedItems = allItems.filter(it => (it.fsQty > 0 || it.requestedQty > 0));

                  const displayItems =
                    auditMatrixFilter === 'discrepancies'
                      ? discrepancyItems
                      : auditMatrixFilter === 'ordered'
                      ? orderedItems
                      : allItems;

                  return (
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm space-y-0">
                      {/* Matrix Header & Filter Tabs */}
                      <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <h5 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                            <Layers className="w-4 h-4 text-[#5C2D91]" />
                            Cross-Auditing Product Matrix (Blueprint ↔ FS Confirmation)
                          </h5>
                          <p className="text-[11px] text-slate-500">
                            Active Facility: <strong className="text-slate-800">{validationResult.facilitySelected}</strong> &bull; {discrepancyItems.length === 0 ? <span className="text-emerald-700 font-bold">No Discrepancies Found</span> : <span className="text-rose-700 font-bold">{discrepancyItems.length} Discrepancy(ies) Pinpointed</span>}
                          </p>
                        </div>

                        {/* Filter Tabs */}
                        <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-xl self-start md:self-auto">
                          <button
                            type="button"
                            onClick={() => setAuditMatrixFilter('all')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                              auditMatrixFilter === 'all'
                                ? 'bg-white text-slate-900 shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            All Blueprint Vaccines ({allItems.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setAuditMatrixFilter('discrepancies')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              auditMatrixFilter === 'discrepancies'
                                ? 'bg-white text-rose-700 shadow-2xs'
                                : discrepancyItems.length > 0
                                ? 'text-rose-700 hover:text-rose-800'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {discrepancyItems.length > 0 && <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse"></span>}
                            <span>Discrepancies Only ({discrepancyItems.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAuditMatrixFilter('ordered')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                              auditMatrixFilter === 'ordered'
                                ? 'bg-white text-[#5C2D91] shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            Ordered in FS ({orderedItems.length})
                          </button>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-semibold text-[11px] uppercase tracking-wider">
                              <th className="py-2.5 px-3">Vaccine</th>
                              <th className="py-2.5 px-3 text-right">Blueprint Total</th>
                              <th className="py-2.5 px-3 text-right">Prev Distributed</th>
                              <th className="py-2.5 px-3 text-right font-bold text-slate-800">Available Quota</th>
                              <th className="py-2.5 px-3 text-right font-bold text-purple-900">
                                {orderSource === 'whatsapp' ? 'Req / FS Qty' : 'FS Order'}
                              </th>
                              <th className="py-2.5 px-3 text-right font-bold text-slate-900">Remaining After</th>
                              <th className="py-2.5 px-3 text-center">Audit Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium">
                            {displayItems.length === 0 ? (
                              <tr>
                                <td colSpan={7} className="py-6 text-center text-slate-400 text-xs">
                                  {auditMatrixFilter === 'discrepancies'
                                    ? '🟢 No discrepancies found! All evaluated items are aligned with the Allocation Blueprint.'
                                    : 'No vaccine items match the selected filter.'}
                                </td>
                              </tr>
                            ) : (
                              displayItems.map((item: VaccineValidationItem, i: number) => {
                                const isUnordered = item.status === 'not_in_order';
                                const isError = item.status !== 'valid' && !isUnordered;
                                const dpv = item.dosesPerVial || getVaccineDosesPerVial(item.vaccine);
                                const origDoses = item.originalAllocationDoses !== undefined ? item.originalAllocationDoses : item.originalAllocation * dpv;
                                const prevDoses = item.previouslyTakenDoses !== undefined ? item.previouslyTakenDoses : item.previouslyTaken * dpv;
                                const remBeforeDoses = item.remainingBeforeDoses !== undefined ? item.remainingBeforeDoses : item.remainingBefore * dpv;
                                const reqDoses = item.requestedDoses !== undefined ? item.requestedDoses : item.requestedQty * dpv;
                                const fsDoses = item.fsDoses !== undefined ? item.fsDoses : item.fsQty * dpv;
                                const remAfterDoses = item.remainingAfterDoses !== undefined ? item.remainingAfterDoses : item.remainingAfter * dpv;

                                return (
                                  <tr
                                    key={i}
                                    className={`transition-colors ${
                                      isError
                                        ? 'bg-rose-50/70 hover:bg-rose-50 border-l-4 border-l-rose-500'
                                        : isUnordered
                                        ? 'hover:bg-slate-50/50 opacity-80'
                                        : 'hover:bg-emerald-50/40'
                                    }`}
                                  >
                                    <td className="py-3 px-3 font-bold text-slate-900">
                                      <div className="flex items-center gap-2">
                                        <span
                                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                            isError
                                              ? 'bg-rose-500 animate-pulse'
                                              : isUnordered
                                              ? 'bg-slate-300'
                                              : 'bg-emerald-500'
                                          }`}
                                        ></span>
                                        <span className={isError ? 'text-rose-950 font-black' : ''}>{item.vaccine}</span>
                                      </div>
                                      <span className="text-[10px] text-slate-400 font-normal block pl-4">
                                        {dpv} doses/vial
                                      </span>
                                      {item.errorDetail && (
                                        <div className="text-[10.5px] text-rose-700 font-bold mt-1 pl-4 flex items-start gap-1">
                                          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5 text-rose-600" />
                                          <span>{item.errorDetail}</span>
                                        </div>
                                      )}
                                      {item.warningDetail && (
                                        <div className="text-[10.5px] text-amber-700 font-semibold mt-1 pl-4 flex items-start gap-1">
                                          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5 text-amber-600" />
                                          <span>{item.warningDetail}</span>
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-3 px-3 text-right text-slate-600">
                                      <div className="leading-tight">
                                        <span>{item.originalAllocation}</span>
                                        <span className="text-[10px] text-slate-400 block font-normal">({origDoses} d)</span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 text-right text-slate-600 font-mono">
                                      <div className="leading-tight">
                                        <span>{item.takenHistory ? `${item.previouslyTaken} (${item.takenHistory})` : item.previouslyTaken}</span>
                                        <span className="text-[10px] text-slate-400 block font-normal">({prevDoses} d)</span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 text-right font-bold text-slate-800">
                                      <div className="leading-tight">
                                        <span className={item.remainingBefore <= 0 ? 'text-rose-600 font-black' : 'text-slate-900'}>
                                          {item.remainingBefore} vials
                                        </span>
                                        <span className={`text-[10px] block font-normal ${item.remainingBefore <= 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                                          ({remBeforeDoses.toLocaleString()} doses)
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 text-right font-black text-purple-900">
                                      <div className="leading-tight">
                                        {orderSource === 'whatsapp' ? (
                                          <span className={item.requestedQty !== item.fsQty ? 'text-rose-600 font-black' : ''}>
                                            {item.requestedQty} / {item.fsQty} vials
                                          </span>
                                        ) : (
                                          <span className={isUnordered ? 'text-slate-400 font-medium' : isError ? 'text-rose-700 font-black' : 'text-purple-900'}>
                                            {item.fsQty} vials
                                          </span>
                                        )}
                                        <span className={`text-[10px] block font-normal ${isUnordered ? 'text-slate-400' : 'text-purple-700'}`}>
                                          {orderSource === 'whatsapp' && item.requestedQty !== item.fsQty
                                            ? `(${reqDoses} / ${fsDoses} doses)`
                                            : `(${fsDoses} doses)`}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 text-right font-black">
                                      <div className="leading-tight">
                                        {isUnordered ? (
                                          <span className="text-slate-500 font-medium">
                                            {item.remainingAfter} vials
                                          </span>
                                        ) : (
                                          <span className={item.remainingAfter < 0 ? 'text-rose-600 font-black' : 'text-emerald-700'}>
                                            {item.remainingAfter} vials
                                          </span>
                                        )}
                                        <span className={`text-[10px] block font-normal ${isUnordered ? 'text-slate-400' : item.remainingAfter < 0 ? 'text-rose-400' : 'text-emerald-600'}`}>
                                          {isUnordered ? '(Balance Preserved)' : `(${remAfterDoses.toLocaleString()} doses)`}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 text-center">
                                      {item.status === 'valid' ? (
                                        <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-2xs">
                                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Verified Aligned
                                        </span>
                                      ) : isUnordered ? (
                                        <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 text-[10px] font-medium px-2 py-0.5 rounded-full">
                                          ⚪ Not In Order
                                        </span>
                                      ) : item.isExcess ? (
                                        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-900 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-2xs border border-rose-200">
                                          <XCircle className="w-3 h-3 text-rose-600" /> Over-Allocated
                                        </span>
                                      ) : item.isExhausted ? (
                                        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-900 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-2xs border border-rose-200">
                                          <AlertTriangle className="w-3 h-3 text-rose-600" /> 0 Balance Exhausted
                                        </span>
                                      ) : item.isNotAllocated ? (
                                        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-900 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-2xs border border-rose-200">
                                          <XCircle className="w-3 h-3 text-rose-600" /> Not In Blueprint
                                        </span>
                                      ) : item.status === 'missing_diluent_dropper' ? (
                                        <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-900 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-2xs border border-amber-200">
                                          <AlertCircle className="w-3 h-3 text-amber-600" /> Missing Pairing
                                        </span>
                                      ) : item.isMissing ? (
                                        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                          <XCircle className="w-3 h-3" /> Missing
                                        </span>
                                      ) : item.isUnexpected ? (
                                        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                          <XCircle className="w-3 h-3" /> Unexpected
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                          <XCircle className="w-3 h-3" /> Mismatch
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Success Notification after confirmed order (Requirement #19) */}
            {confirmationSuccess && (
              <div className="p-5 bg-emerald-50 border border-emerald-300 rounded-2xl shadow-sm flex items-start gap-3 animate-in fade-in duration-200">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <div className="text-sm font-black text-emerald-950 flex items-center justify-between">
                    <span>Order Confirmed &amp; Allocation Blueprint Updated Successfully!</span>
                    <span className="font-mono text-xs text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded">
                      ID: {confirmationSuccess.id}
                    </span>
                  </div>
                  <p className="text-xs text-emerald-800">
                    The distribution quantities have been deducted from <strong>{confirmationSuccess.facilityName}</strong> in the Blueprint, added to distributed totals with arithmetic history, and permanently recorded in the immutable audit trail.
                  </p>
                  {confirmationSuccess.items && confirmationSuccess.items.length > 0 && (
                    <div className="mt-2.5 bg-white/90 rounded-xl p-3 border border-emerald-200 space-y-1.5">
                      <div className="text-[10.5px] font-bold text-emerald-950 uppercase tracking-wider flex items-center justify-between">
                        <span>Confirmed Deductions:</span>
                        <span className="text-[9.5px] font-mono text-emerald-700">Deduction = Entered Order</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {confirmationSuccess.items.map((it, idx) => (
                          <div key={idx} className="bg-emerald-50/70 border border-emerald-200/80 rounded-lg p-2 flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-900">{it.vaccine}</span>
                            <div className="text-right">
                              <span className="font-black text-rose-700 font-mono">-{it.currentOrder} v</span>
                              <span className="text-[10px] text-slate-500 block">
                                rem: <strong className="text-emerald-800 font-bold">{it.remainingAfter} v</strong>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="pt-2 flex flex-wrap gap-2">
                    <button
                      onClick={onNavigateToBlueprint || onNavigateToTracker}
                      className="text-xs font-bold text-orange-950 bg-orange-100 hover:bg-orange-200 px-3 py-1 rounded-xl transition-all cursor-pointer flex items-center gap-1 border border-orange-200"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-[#ED7D31]" />
                      View Updated Allocation Blueprint &rarr;
                    </button>
                    <button
                      onClick={onNavigateToHistory}
                      className="text-xs font-bold text-emerald-900 bg-emerald-200/70 hover:bg-emerald-200 px-3 py-1 rounded-xl transition-all cursor-pointer flex items-center gap-1"
                    >
                      <History className="w-3.5 h-3.5" />
                      View in Transaction History &rarr;
                    </button>
                  </div>
                </div>
              </div>
            )}
            </>
          )}
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL OVERLAY (Requirements #18, #19, #20) */}
      <AnimatePresence>
        {showReviewModal && validationResult && selectedFacility && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-xl w-full overflow-hidden"
            >
              <div className="p-6 bg-gradient-to-r from-orange-950 via-[#C55A11] to-[#ED7D31] text-white flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black tracking-tight">Review &amp; Confirm Allocation Blueprint Update</h3>
                  <p className="text-xs text-orange-100">
                    Final CCA authorization: Deducts from available balance in 67-col Blueprint and records distribution
                  </p>
                </div>
                <button
                  onClick={() => setShowReviewModal(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                {/* Meta details */}
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-2xl text-xs border border-slate-200">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Facility</span>
                    <strong className="text-slate-800 text-sm">{selectedFacility.facilityName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Allocation Sheet / Tab</span>
                    <strong className="text-slate-800 text-sm">{selectedFacility.tabName || selectedFacility.cycle}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Authorized CCA</span>
                    <strong className="text-slate-800">{ccaName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Order Source</span>
                    <strong className="text-slate-800">{orderSource === 'whatsapp' ? 'WhatsApp Order' : 'FS Confirmation'}</strong>
                  </div>
                </div>

                {/* Items to Deduct */}
                <div>
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    Confirmed Vaccine Deductions
                  </h5>
                  <div className="border border-slate-200 rounded-2xl overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100 text-slate-500 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="py-2 px-3">Vaccine</th>
                          <th className="py-2 px-3 text-right">Original</th>
                          <th className="py-2 px-3 text-right">Previously Taken</th>
                          <th className="py-2 px-3 text-right font-black text-purple-900">Current Order</th>
                          <th className="py-2 px-3 text-right font-black text-slate-900">New Remaining</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {validationResult.items
                          .filter(it => (it.fsQty || it.requestedQty) > 0)
                          .map((it, idx) => {
                            const dpv = it.dosesPerVial || getVaccineDosesPerVial(it.vaccine);
                            const origDoses = it.originalAllocationDoses !== undefined ? it.originalAllocationDoses : it.originalAllocation * dpv;
                            const prevDoses = it.previouslyTakenDoses !== undefined ? it.previouslyTakenDoses : it.previouslyTaken * dpv;
                            const orderQty = it.fsQty || it.requestedQty;
                            const orderDoses = it.fsDoses || it.requestedDoses || orderQty * dpv;
                            const remAfterDoses = it.remainingAfterDoses !== undefined ? it.remainingAfterDoses : it.remainingAfter * dpv;

                            return (
                              <tr key={idx}>
                                <td className="py-2.5 px-3 font-bold text-slate-900">
                                  {it.vaccine}
                                  <span className="text-[10px] text-slate-400 font-normal block">({dpv} doses/vial)</span>
                                </td>
                                <td className="py-2.5 px-3 text-right text-slate-500">
                                  <div className="leading-tight">
                                    <span>{it.originalAllocation}</span>
                                    <span className="text-[10px] text-slate-400 block font-normal">({origDoses} d)</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right text-slate-500 font-mono">
                                  <div className="leading-tight">
                                    <span>{it.takenHistory ? `${it.previouslyTaken} (${it.takenHistory})` : it.previouslyTaken}</span>
                                    <span className="text-[10px] text-slate-400 block font-normal">({prevDoses} d)</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-black text-purple-900">
                                  <div className="leading-tight">
                                    <span>{orderQty} vials</span>
                                    <span className="text-[10px] text-purple-700 block font-normal">({orderDoses.toLocaleString()} doses)</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-black text-emerald-700">
                                  <div className="leading-tight">
                                    <span>{it.remainingAfter} vials</span>
                                    <span className="text-[10px] text-emerald-600 block font-normal">({remAfterDoses.toLocaleString()} doses)</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Concurrency Error Display */}
                {confirmationError && (
                  <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                    <span>{confirmationError}</span>
                  </div>
                )}

                <div className="p-3 bg-purple-50 rounded-xl text-purple-900 text-[11px] leading-relaxed flex items-start gap-2">
                  <Lock className="w-4 h-4 text-[#5C2D91] flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Authoritative Protection:</strong> Original sheet allocation remains permanently immutable. Remaining balance is atomically checked and locked before applying the deduction.
                  </span>
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowReviewModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleConfirmOrder}
                  disabled={confirming || isStaleValidation || !validationResult?.isValid}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-black text-xs uppercase tracking-wider px-6 py-3 rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                >
                  {confirming ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Updating Blueprint...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Confirm &amp; Update Allocation Blueprint
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* UNRELIEVED TOP-UP MODAL */}
      <AnimatePresence>
        {topUpModalOpen && selectedFacility && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden"
            >
              <div className="p-5 bg-[#5C2D91] text-white flex items-center justify-between">
                <div>
                  <h4 className="text-base font-black">Add / Edit Unrelieved Top-Up</h4>
                  <p className="text-xs text-purple-200">Facility: {selectedFacility.facilityName}</p>
                </div>
                <button
                  onClick={() => setTopUpModalOpen(false)}
                  className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Vaccine</label>
                  <select
                    value={topUpVaccine}
                    onChange={e => setTopUpVaccine(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:border-[#5C2D91]"
                  >
                    {Object.keys(selectedFacility.vaccines).map(vac => (
                      <option key={vac} value={vac}>{vac}</option>
                    ))}
                  </select>
                </div>

                {/* Unit Switcher: Vials vs Doses */}
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">
                    Input Unit
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setTopUpUnit('vials')}
                      className={`py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        topUpUnit === 'vials'
                          ? 'bg-white text-[#5C2D91] shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Vials
                    </button>
                    <button
                      type="button"
                      onClick={() => setTopUpUnit('doses')}
                      className={`py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        topUpUnit === 'doses'
                          ? 'bg-white text-[#5C2D91] shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Doses
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Unrelieved Top-Up Quantity ({topUpUnit === 'vials' ? 'Vials' : 'Doses'})
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder={topUpUnit === 'vials' ? 'e.g. 20' : 'e.g. 400'}
                    value={topUpQty}
                    onChange={e => setTopUpQty(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:border-[#5C2D91]"
                  />
                  
                  {/* Live Conversion Display */}
                  {topUpQty && !isNaN(Number(topUpQty)) && Number(topUpQty) > 0 && (
                    <div className="mt-2 p-2.5 bg-purple-50 rounded-xl border border-purple-200/80 text-xs text-purple-900 flex items-center justify-between">
                      <span className="font-medium">Calculated Equivalent:</span>
                      {(() => {
                        const dpv = selectedFacility.vaccines[topUpVaccine]?.dosesPerVial || getVaccineDosesPerVial(topUpVaccine);
                        const val = Number(topUpQty);
                        if (topUpUnit === 'vials') {
                          return (
                            <strong className="text-sm font-black text-[#5C2D91]">
                              {(val * dpv).toLocaleString()} doses <span className="text-[10px] text-purple-600 font-normal">({dpv} doses/vial)</span>
                            </strong>
                          );
                        } else {
                          const convertedVials = Math.ceil(val / dpv);
                          return (
                            <strong className="text-sm font-black text-[#5C2D91]">
                              {convertedVials} vials <span className="text-[10px] text-purple-600 font-normal">({dpv} doses/vial)</span>
                            </strong>
                          );
                        }
                      })()}
                    </div>
                  )}

                  <p className="text-[11px] text-slate-400 mt-2">
                    This quantity will be added to the authorized allocation and counted in both vials and doses in the facility available remaining balance.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTopUpModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveTopUp}
                  disabled={savingTopUp || !topUpQty}
                  className="bg-[#5C2D91] hover:bg-[#482372] disabled:bg-slate-300 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {savingTopUp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save Top-Up
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AUDIT LOGS MODAL / DRAWER */}
      <AnimatePresence>
        {showAuditLogs && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-3xl w-full overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-5 bg-gradient-to-r from-slate-900 to-[#3B1A5E] text-white flex items-center justify-between">
                <div>
                  <h4 className="text-base font-black flex items-center gap-2">
                    <History className="w-5 h-5 text-purple-300" />
                    Vaccine Order Auditing History
                  </h4>
                  <p className="text-xs text-purple-200">
                    Comprehensive log of all order validation attempts against the allocation sheets
                  </p>
                </div>
                <button
                  onClick={() => setShowAuditLogs(false)}
                  className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex-1 divide-y divide-slate-100 space-y-3">
                {loadingAuditLogs ? (
                  <div className="p-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Loading audit records...
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    No order audits performed yet in this session. Run an audit above to generate logs.
                  </div>
                ) : (
                  auditLogs.map(log => (
                    <div key={log.id} className="pt-3 first:pt-0 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            log.auditResult === 'GREEN_LIGHT'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-rose-100 text-rose-800 border border-rose-200'
                          }`}>
                            {log.auditResult === 'GREEN_LIGHT' ? '🟢 GREEN LIGHT' : '🔴 DO NOT PROCESS'}
                          </span>
                          <strong className="text-slate-900 text-xs">{log.facilityName}</strong>
                          {log.subDistrict && (
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded">
                              {log.subDistrict}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                          {log.confirmed ? (
                            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[10px] font-bold border border-emerald-200">
                              Confirmed into Blueprint
                            </span>
                          ) : (
                            <span className="text-slate-500 bg-slate-100 px-2 py-0.5 rounded text-[10px]">
                              Audit Only
                            </span>
                          )}
                        </div>
                      </div>

                      {log.errorsDetected && log.errorsDetected.length > 0 && (
                        <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-2.5 text-xs text-rose-800 space-y-1">
                          {log.errorsDetected.map((e, idx) => (
                            <div key={idx} className="flex items-start gap-1.5 font-medium">
                              <span className="text-rose-500 font-bold">&bull;</span>
                              <span>{e}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="text-[11px] text-slate-500 flex items-center gap-3">
                        <span>Auditor: <strong>{log.ccaUser}</strong></span>
                        <span>Source: <strong>{log.orderSource}</strong></span>
                        <span>Items checked: <strong>{log.productsChecked.length}</strong></span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch('/api/vaccine/audit-logs/clear', { method: 'POST' });
                      setAuditLogs([]);
                    }}
                    className="text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
                  >
                    Clear Logs
                  </button>
                  {onNavigateToHistory && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAuditLogs(false);
                        onNavigateToHistory();
                      }}
                      className="text-xs font-bold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1"
                    >
                      <History className="w-3.5 h-3.5 text-purple-600" />
                      <span>Full Audit & Activity Trail &rarr;</span>
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowAuditLogs(false)}
                  className="bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold px-4 py-2 rounded-xl transition-all cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
