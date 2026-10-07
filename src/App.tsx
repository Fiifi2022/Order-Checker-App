import { logoutUser } from './firebase';
import { authFetch } from './utils/authFetch';
import GeneralScreenshotInput, { type GeneralScreenshotHandle } from './components/GeneralScreenshotInput';
import GeneralMonitoring from './components/GeneralMonitoring';
import { GeneralOrderLimitPrompt, GeneralProductName } from './components/GeneralFulfillmentSummary';
import { createGeneralAuditRun, completeGeneralAuditRun, isCurrentGeneralAuditRun, type GeneralAuditRun } from './utils/generalAuditRun';
import { applyGeneralOrderLimitDecision, buildGeneralAuditCheckSummary, type runGeneralAuditor } from './utils/generalAuditor';
import GeneralVerificationConfidence from './components/GeneralVerificationConfidence';
import GeneralDiscrepancySubtitle from './components/GeneralDiscrepancySubtitle';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import GeneralAuditDetails from './components/GeneralAuditDetails';
import type { GeneralAuditDetails as GeneralAuditDetailsPayload } from './utils/generalAuditTypes';
import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  ClipboardCheck, 
  Play, 
  AlertCircle, 
  CheckCircle, 
  Info, 
  Phone, 
  MapPin, 
  User, 
  Sparkles, 
  RefreshCw, 
  ArrowRight,
  ShieldCheck,
  HelpCircle,
  History,
  TrendingUp,
  ListFilter,
  CheckSquare,
  Save,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingDown,
  Activity,
  PlusCircle,
  Check,
  LogOut,
  Lock,
  Send,
  Clock,
  Timer,
  Image,
  Upload,
  Trash,
  Download,
  Calendar,
  Wrench,
  FileSpreadsheet,
  Users,
  UserCheck,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OrderCheckResult, AuditRecord, AuditAnalytics, VerificationItem, UserRoleRecord, UserRegistration } from './types';
import Troubleshooter from './components/Troubleshooter';
import VaccineAllocationChecker from './components/VaccineAllocationChecker';
import VaccineDashboard from './components/VaccineDashboard';
import KpiDashboard from './components/KpiDashboard';
import VaccineAllocationBlueprint from './components/VaccineAllocationBlueprint';
import SystemAuditLogView from './components/SystemAuditLogView';
import RoleManagementModal, { ROLE_DEFINITIONS } from './components/RoleManagementModal';
import GeminiStatus from './components/GeminiStatus';

export default function App({ authenticatedUser }: { authenticatedUser: UserRoleRecord }) {
  // Navigation tabs - Supports both existing Order Checker & new Vaccine Allocation Module
  const [activeTab, setActiveTab] = useState<
    'vaccine_blueprint' | 'vaccine_checker' | 'vaccine_dashboard' | 'kpi_dashboard' | 'auditor' | 'extension' | 'history' | 'troubleshooter'
  >('vaccine_blueprint');

  const [checkerBlueprintSheetId, setCheckerBlueprintSheetId] = useState<string>();

  // Audit Ledger / History states
  const [auditsHistory, setAuditsHistory] = useState<AuditRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await authFetch('/api/audits');
      if (res.ok) {
        const data = await res.json();
        setAuditsHistory(data);
      } else {
        setHistoryError('Failed to load audit logs from the database.');
      }
    } catch (err) {
      console.error('Failed to load audit history:', err);
      setHistoryError('Network error while retrieving audit logs.');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
    // Track module navigation in app usage analytics
    authFetch('/api/activity/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: activeTab === 'vaccine_blueprint' ? 'vaccine_blueprint' : activeTab === 'vaccine_checker' ? 'vaccine_checker' : activeTab === 'vaccine_dashboard' ? 'vaccine_dashboard' : activeTab === 'auditor' ? 'general_auditor' : 'app_system',
        actionType: 'page_view',
        title: `Navigation: ${activeTab.replace(/_/g, ' ').toUpperCase()}`,
        summary: `Navigated to ${activeTab.replace(/_/g, ' ')} view.`
      })
    }).catch(() => {});
  }, [activeTab]);

  // Team Roles & Access Control (RBAC) state
  const [registrations, setRegistrations] = useState<UserRegistration[]>([]);
  const [roles, setRoles] = useState<UserRoleRecord[]>([authenticatedUser]);
  const [activeUser, setActiveUser] = useState<UserRoleRecord | null>(authenticatedUser);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [loadingRoles, setLoadingRoles] = useState(false);

  const fetchRoles = async () => {
    setLoadingRoles(true);
    try {
      const res = await authFetch('/api/roles');
      if (res.ok) {
        const data = await res.json();
        if (data.roles && Array.isArray(data.roles)) {
          setRoles(data.roles);
          setRegistrations(data.registrations || []);
          if (data.activeUser) {
            setActiveUser(data.activeUser);
          } else if (data.activeRoleId) {
            const found = data.roles.find((r: any) => r.id === data.activeRoleId);
            if (found) setActiveUser(found);
          }
        }
      }
    } catch (err) {
      console.warn('Could not fetch roles from server:', err);
    } finally {
      setLoadingRoles(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  useEffect(() => { if (isRoleModalOpen) void fetchRoles(); }, [isRoleModalOpen]);

  // Simulated out of stock (OSU) list
  const [osuList, setOsuList] = useState<string[]>([]);
  const [newOsuItem, setNewOsuItem] = useState('');
  const [osuLoading, setOsuLoading] = useState(false);

  // Core input fields
  const [whatsappMessage, setWhatsappMessage] = useState('');
  const [fulfillmentConfirmation, setFulfillmentConfirmation] = useState('');
  
  const [generalImageReset, setGeneralImageReset] = useState(0);
  const [generalServiceWarning, setGeneralServiceWarning] = useState('');
  // These guards belong only to the General Auditor inputs and requests.
  const generalAuditRevision = useRef(0);
  const generalAuditRequest = useRef<AbortController | null>(null);
  const customerImage = useRef<GeneralScreenshotHandle>(null);
  const fulfillmentImage = useRef<GeneralScreenshotHandle>(null);
  const currentGeneralInputs = useRef({ whatsappMessage, fulfillmentConfirmation });
  currentGeneralInputs.current = { whatsappMessage, fulfillmentConfirmation };


  // Fetch registered OSU items
  const fetchOsuList = async () => {
    setOsuLoading(true);
    try {
      const res = await authFetch('/api/osu');
      if (res.ok) {
        const data = await res.json();
        setOsuList(data);
      }
    } catch (err) {
      console.error('Failed to load active out of stock register:', err);
    } finally {
      setOsuLoading(false);
    }
  };

  // Add OSU item
  const addOsuItem = async () => {
    if (!newOsuItem.trim()) return;
    try {
      const res = await authFetch('/api/osu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: newOsuItem.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        setOsuList(data);
        setNewOsuItem('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete OSU item
  const removeOsuItem = async (item: string) => {
    try {
      const res = await authFetch('/api/osu', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item })
      });
      if (res.ok) {
        const data = await res.json();
        setOsuList(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch logistics data on initialization
  useEffect(() => {
    fetchOsuList();
  }, []);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const source = (event.target as HTMLElement)?.closest?.('[data-general-source]')?.getAttribute('data-general-source');
      if (!source) return;
      const file = Array.from(event.clipboardData?.items || []).find(item => item.type.startsWith('image/'))?.getAsFile();
      if (file) { event.preventDefault(); (source === 'fulfillment' ? fulfillmentImage : customerImage).current?.acceptFile(file); }
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, []);

  
  // Loading states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationTime, setVerificationTime] = useState<number | null>(null);
  
  // Speed test state variables
  const [speedLoading, setSpeedLoading] = useState(false);
  const [speedResult, setSpeedResult] = useState<{ durationMs: number; status: string; success: boolean; error?: string } | null>(null);

  const runSpeedTest = async () => {
    setSpeedLoading(true);
    setSpeedResult(null);
    const startTime = Date.now();
    try {
      const res = await authFetch('/api/speedtest');
      if (res.ok) {
        const data = await res.json();
        setSpeedResult({
          durationMs: data.durationMs,
          status: data.status,
          success: true
        });
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }
    } catch (err: any) {
      console.error(err);
      setSpeedResult({
        durationMs: Date.now() - startTime,
        status: 'Error',
        success: false,
        error: err.message || 'Connection failed'
      });
    } finally {
      setSpeedLoading(false);
    }
  };
  
  // Active verify results (the client receives full AuditRecord back from server)
  const [result, setResult] = useState<AuditRecord | null>(null);
  const generalDetails = (result as (AuditRecord & { generalAudit?: GeneralAuditDetailsPayload }) | null)?.generalAudit;

  // Order limit validation flows
  const [lastConfirmedItemName, setLastConfirmedItemName] = useState<string | null>(null);
  const [promptedItems, setPromptedItems] = useState<string[]>([]);

  const handleDeclineOrderLimit = (targetItem: VerificationItem) => {
    setPromptedItems(prev => [...prev, targetItem.name]);
  };

  const confirmOrderLimit = (targetItem: VerificationItem) => {
    if (!result) return;

    const updatedItems = result.items.map(item => {
      if (item.name === targetItem.name) {
        return {
          ...item,
          status: 'match' as const, // Resolve status as match since limit is confirmed
          action: `Order Limit Confirmed. Limit of ${item.found} units locked and applied successfully.`,
        };
      }
      return item;
    });

    const anyRemainingIssues = updatedItems.some(it => it.status !== 'match' && it.status !== 'out of stock');
    const issueCount = updatedItems.filter(it => it.status !== 'match' && it.status !== 'out of stock').length;

    const updatedResult: AuditRecord = {
      ...result,
      items: updatedItems,
      allMatch: !anyRemainingIssues,
      issueCount: issueCount,
      verdict: !anyRemainingIssues ? 'PASS: Perfect Match Verified (Order Limit Applied)' : result.verdict
    };

    setResult(updatedResult);
    setLastConfirmedItemName(targetItem.name);
    
    // Also add to prompted list so we don't prompt again
    setPromptedItems(prev => [...prev, targetItem.name]);

    setTimeout(() => {
      setLastConfirmedItemName(null);
    }, 5000);
  };

  // Resolution panel controls
  const [selectedAuditForResolution, setSelectedAuditForResolution] = useState<AuditRecord | null>(null);
  const [resolutionActionNotes, setResolutionActionNotes] = useState('');
  const [submittingResolution, setSubmittingResolution] = useState(false);

  const [isDemoAudit, setIsDemoAudit] = useState(false);

  const invalidateGeneralAudit = () => {
    generalAuditRevision.current++;
    generalAuditRequest.current?.abort();
    setResult(null);
    setPromptedItems([]);
    setLastConfirmedItemName(null);
    setError(null);
    setGeneralServiceWarning('');
    setVerificationTime(null);
    setLoading(false);
  };
  useEffect(() => {
    invalidateGeneralAudit();
  }, [whatsappMessage, fulfillmentConfirmation]);
  useEffect(() => () => {
    generalAuditRequest.current?.abort();
  }, []);


  const handleCustomChange = (type: 'whatsapp' | 'fulfillment', value: string) => {
    invalidateGeneralAudit();
    setIsDemoAudit(false);
    if (type === 'whatsapp') {
      currentGeneralInputs.current = { ...currentGeneralInputs.current, whatsappMessage: value };
      setWhatsappMessage(value);
    } else {
      currentGeneralInputs.current = { ...currentGeneralInputs.current, fulfillmentConfirmation: value };
      setFulfillmentConfirmation(value);
    }
  };

  // Quick helper to auto-populate test cases
  const applySampleData = (caseType: 'perfect' | 'discrepancy_qty' | 'discrepancy_extra' | 'vaccine_diluent_mismatch' | 'vaccine_dropper_mismatch') => {
    invalidateGeneralAudit();
    setGeneralImageReset(value => value + 1);
    setIsDemoAudit(true);
    if (caseType === 'perfect') {
      setWhatsappMessage(`Name: Kwame Mensah\nPhone: 0244123456\nFacility: St. Jude's Clinic\nHey Zipline, please dispatch:\n- 20 units of ACT 20/120mg\n- 5 cards of ORS\nThank you!`);
      setFulfillmentConfirmation(`RECIPIENT: Kwame Mensah\nCONTACT: +233244123456\nFACILITY: St. Jude's\nREADY FOR FLIGHT:\n- Coartem 20/120mg: 20 units\n- ORT: 5 cards\nREADY FOR LAUNCH BUFFER.`);
    } else if (caseType === 'discrepancy_qty') {
      setWhatsappMessage(`Requester: Dr. Abigail Larbi\nFacility: Kade Health Center\nRef Phone: 0559876543\nMedical inventory order request:\n- 10 cards of PCM 500mg\n- 5 packs of Malaria RDT\n- 20 vials of Saline water`);
      setFulfillmentConfirmation(`CUSTOMER: Abigail Larbi\nFACILITY: Kade Health Center (Logistics branch)\nCONTACT: +233559876543\nSUPPLIES PROVISIONED:\n- Paracetamol 500mg: 5 cards\n- Saline IV Fluids: 20 vials`);
    } else if (caseType === 'discrepancy_extra') {
      setWhatsappMessage(`Good morning, this is Nurse Beatrice from Begoro Hospital (phone 0201112223).\nWe urgently need:\n- 50 doses of AL\n- 10 packs of ORS`);
      setFulfillmentConfirmation(`FULFILMENT SYSTEM LOG:\nHospital: Begoro Hospital\nAuthorized Contact: Nurse Evelyn\nPhone: 0201112223\nFlight cargo manifest:\n- Coartem (AL): 50 doses\n- ORT: 10 packs\n- Malaria RDT: 2 packs`);
    } else if (caseType === 'vaccine_diluent_mismatch') {
      setWhatsappMessage(`Sender: Nurse Mary\nClinic: Legon Clinic\nPhone: 0244998877\nVaccine stock required:\n- 10 vials of Yellow Fever vaccine\n- 10 Diluents for Yellow Fever`);
      setFulfillmentConfirmation(`OFFLINE FULFILLMENT ENTRY:\nRecipient: Mary\nFacility: Legon Clinic\nPhone: +233244998877\nDispatched itemization:\n- YFV Vaccine: 10 vials\n- Yellow Fever Diluents: 5 vials`);
    } else if (caseType === 'vaccine_dropper_mismatch') {
      setWhatsappMessage(`Sender: Dr. Kwasi\nHospital: Kumasi Hospital\nPhone: 0205566778\nVaccine order list:\n- 15 vials of OPV vaccine\n- 15 Droppers`);
      setFulfillmentConfirmation(`SYSTEM CONFIRMATION:\nCustomer: Dr. Kwasi\nFacility: Kumasi Hospital\nPhone: 0205566778\nManifest Prepared:\n- OPV Polio vaccine: 15 vials\n(NO droppers of any kind were loaded)`);
    }
  };

  const verifyOrder = () => runGeneralVerification();

  const answerGeneralOrderLimit = (key: string, answer: boolean) => {
    if (!result || !generalDetails || loading || !generalDetails.products.some(product => product.key === key && product.orderLimitEligible)) return;
    if (result.whatsappMessage !== currentGeneralInputs.current.whatsappMessage || result.fulfillmentConfirmation !== currentGeneralInputs.current.fulfillmentConfirmation) return;
    const confirmed = applyGeneralOrderLimitDecision(result as unknown as ReturnType<typeof runGeneralAuditor>, key, answer);
    void runGeneralVerification({ ...generalDetails.orderLimitDecisions, [key]: answer }, result.id,
      { ...result, ...confirmed } as unknown as AuditRecord);
  };

  const runGeneralVerification = async (orderLimitDecisions: Record<string, boolean> = {}, existingCheckId?: string, immediateResult?: AuditRecord) => {
    const previousResult = immediateResult ? result : null;
    const inputs = { whatsappMessage: currentGeneralInputs.current.whatsappMessage, fulfillmentConfirmation: currentGeneralInputs.current.fulfillmentConfirmation };
    if (!inputs.whatsappMessage.trim() || !inputs.fulfillmentConfirmation.trim()) {
      setError('Please provide text for both WhatsApp Message and Fulfillment Confirmation.');
      return;
    }

    invalidateGeneralAudit();
    const revision = generalAuditRevision.current;
    const controller = new AbortController();
    generalAuditRequest.current = controller;
    let run: GeneralAuditRun;
    const isCurrent = () => !!run && isCurrentGeneralAuditRun(run, currentGeneralInputs.current, generalAuditRevision.current, controller.signal);
    setLoading(true);
    setError(null);
    setResult(immediateResult ?? null);
    setPromptedItems([]);
    setVerificationTime(0);

    const startTime = Date.now();
    const interval = setInterval(() => {
      if (!isCurrent()) return;
      const elapsed = Number(((Date.now() - startTime) / 1000).toFixed(1));
      setVerificationTime(elapsed);
    }, 100);

    try {
      let liveOsu: string[] = [];
      try { const response = await authFetch('/api/osu', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) }); if (!response.ok) throw new Error(); liveOsu = await response.json(); } catch { if (!controller.signal.aborted) setGeneralServiceWarning('OSU register unavailable. Confirmation quantities still determine stock status.'); }
      if (controller.signal.aborted || revision !== generalAuditRevision.current) return;
      run = createGeneralAuditRun(inputs, revision, orderLimitDecisions, { osuItems: liveOsu }, true);
      const response = await authFetch('/api/verify', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...run.inputs,
          auditScope: 'general_auditor',
          checkSource: 'order_checker_app',
          checkId: existingCheckId || `AUD-${crypto.randomUUID()}`,
          generalOrderLimitDecisions: { ...orderLimitDecisions },
          actor: activeUser ? { id: activeUser.id, name: activeUser.name, district: activeUser.district } : undefined,
          isDemo: isDemoAudit
        }),
      });

      clearInterval(interval);

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || `Server returned error status ${response.status}`);
      }

      const json = await response.json();
      if (!isCurrent()) return;
      setResult(completeGeneralAuditRun(run, json) as unknown as AuditRecord);
      if (json.generalStorageWarning) setGeneralServiceWarning(previous => [previous, json.generalStorageWarning].filter(Boolean).join(' '));
      
      const finalTime = Number(((Date.now() - startTime) / 1000).toFixed(2));
      setVerificationTime(finalTime);
      setLoading(false);
    } catch (err: any) {
      clearInterval(interval);
      if (controller.signal.aborted || revision !== generalAuditRevision.current) return;
      if (immediateResult) setResult(previousResult);
      console.error(err);
      setError(err.message || 'An unexpected error occurred while communicating with the audit service.');
      setLoading(false);
    } finally {
      clearInterval(interval);
      if (generalAuditRequest.current === controller) generalAuditRequest.current = null;
    }
  };

  // Dispatch discrepancy resolution logic
  const submitResolution = async () => {
    if (!selectedAuditForResolution) return;
    if (!resolutionActionNotes.trim()) {
      alert('Please specify the clinical corrections or resolution notes taken before launching.');
      return;
    }

    const resolutionRevision = generalAuditRevision.current;
    setSubmittingResolution(true);
    
    try {
      const res = await authFetch(`/api/audits/${selectedAuditForResolution.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'resolved',
          resolutionNotes: resolutionActionNotes
        })
      });

      if (!res.ok) {
        throw new Error('Failed to update audit log status on the server.');
      }

      const updatedResult = await res.json();
      
      if ((selectedAuditForResolution as AuditRecord & { generalAudit?: GeneralAuditDetailsPayload }).generalAudit) {
        if (resolutionRevision === generalAuditRevision.current && selectedAuditForResolution.whatsappMessage === currentGeneralInputs.current.whatsappMessage && selectedAuditForResolution.fulfillmentConfirmation === currentGeneralInputs.current.fulfillmentConfirmation) setResult(updatedResult);
        setError('Resolution recorded. Update the confirmation and re-run the audit before dispatch.');
        fetchHistory(); setSelectedAuditForResolution(null); setResolutionActionNotes(''); return;
      }
      // Clear all discrepancy-related input fields immediately upon successful resolution
      setWhatsappMessage('');
      setFulfillmentConfirmation('');
      setGeneralImageReset(value => value + 1);
    
      setResult(updatedResult);
      fetchHistory(); // Refresh audit history
      setSelectedAuditForResolution(null);
      setResolutionActionNotes('');
    } catch (err: any) {
      alert(err.message || 'An error occurred while saving discrepancy clearance.');
    } finally {
      setSubmittingResolution(false);
    }
  };

  // Confirm perfect match logs and clean up visual inputs so operator can run the next dispatch immediately
  const handleLogApprovedDispatch = () => {
    setWhatsappMessage('');
    setFulfillmentConfirmation('');
    setGeneralImageReset(value => value + 1);
    setResult(null);
  };



  const getStatusColor = (status: string) => {
    switch (status) {
      case 'order limit applied':
      case 'match':
        return {
          bg: 'bg-green-100 text-green-800 border-green-200',
          dot: 'bg-green-500',
          border: 'border-green-200',
          leftBorder: 'border-l-green-500'
        };
      case 'pending order limit':
      case 'quantity mismatch':
        return {
          bg: 'bg-amber-100 text-amber-800 border-amber-200',
          dot: 'bg-amber-500',
          border: 'border-amber-200',
          leftBorder: 'border-l-amber-500'
        };
      case 'missing item':
        return {
          bg: 'bg-rose-100 text-rose-800 border-rose-200',
          dot: 'bg-rose-500',
          border: 'border-rose-200',
          leftBorder: 'border-l-rose-500'
        };
      case 'out of stock':
        return {
          bg: 'bg-slate-100 text-slate-700 border-slate-200',
          dot: 'bg-slate-400',
          border: 'border-slate-200',
          leftBorder: 'border-l-slate-400'
        };
      case 'extra item':
        return {
          bg: 'bg-purple-100 text-purple-800 border-purple-200',
          dot: 'bg-purple-500',
          border: 'border-purple-200',
          leftBorder: 'border-l-purple-500'
        };
      default:
        return {
          bg: 'bg-slate-100 text-slate-800 border-slate-200',
          dot: 'bg-slate-500',
          border: 'border-slate-200',
          leftBorder: 'border-l-slate-400'
        };
    }
  };

  const getCategoryBadgeStyle = (category?: string) => {
    switch (category?.toLowerCase() || '') {
      case 'vaccine':
        return {
          bg: 'bg-teal-50 text-teal-700 border-teal-100',
          label: 'Vaccine'
        };
      case 'medical product':
      case 'medical_product':
      case 'drug':
      case 'medical':
        return {
          bg: 'bg-blue-50 text-blue-700 border-blue-100',
          label: 'Medical Product'
        };
      case 'blood product':
      case 'blood_product':
      case 'blood':
        return {
          bg: 'bg-rose-50 text-rose-700 border-rose-100',
          label: 'Blood Product'
        };
      case 'consumable':
      case 'consumables':
        return {
          bg: 'bg-amber-50 text-amber-700 border-amber-100',
          label: 'Consumable'
        };
      default:
        const norm = (category || '').toLowerCase();
        if (norm.includes('vaccine')) return { bg: 'bg-teal-50 text-teal-700 border-teal-100', label: 'Vaccine' };
        if (norm.includes('blood')) return { bg: 'bg-rose-50 text-rose-700 border-rose-100', label: 'Blood Product' };
        if (norm.includes('consum')) return { bg: 'bg-amber-50 text-amber-700 border-amber-100', label: 'Consumable' };
        if (norm.includes('product') || norm.includes('drug') || norm.includes('medicine') || norm.includes('tablet') || norm.includes('vial')) {
          return { bg: 'bg-blue-50 text-blue-700 border-blue-100', label: 'Medical Product' };
        }
        return {
          bg: 'bg-slate-50 text-slate-600 border-slate-100',
          label: category || 'Unclassified'
        };
    }
  };

  const getConfidenceLevelColor = (score: number) => {
    if (score >= 95) return 'text-green-600';
    if (score >= 80) return 'text-amber-600';
    return 'text-rose-600';
  };

  // No registration or sign-in block required - runs directly once opened

  return (
    <div className="min-h-screen bg-[#FDFBFF] font-sans text-slate-800 antialiased flex flex-col">
      
      {/* Upper Corporate Navigation Header */}
      <header className="bg-[#3B1A5E] text-white py-4 px-6 shadow-md border-b border-[#2C1349] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-[#5C2D91] p-2.5 rounded-xl text-white shadow-inner flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-purple-100 animate-pulse" />
            </div>
            <div>
              <h1 id="app-title" className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                OrderCheck 
                <span className="text-[10px] bg-purple-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">COMPLIANCE</span>
              </h1>
              <p className="text-xs text-purple-200 font-mono">Zipline Ghana Customer Care Discrepancy Auditing Portal</p>
            </div>
          </div>
          
          {/* Operator Profile Badge & Role Manager */}
          <div className="flex items-center gap-2 sm:gap-3">
            <GeminiStatus />
            <div 
              onClick={() => { if (activeUser?.role === 'admin') setIsRoleModalOpen(true); }}
              className="flex items-center gap-2.5 bg-[#2C1349] hover:bg-[#39185e] p-1.5 sm:p-2 px-3 sm:px-4 rounded-2xl border border-purple-900/80 text-xs shadow-inner cursor-pointer transition-all"
              title="Click to manage team roles and permissions"
            >
              <div className="text-right">
                <span className="block font-black text-white text-xs leading-tight">
                  {activeUser?.name || 'Mary Alhassan'}
                </span>
                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                  <span className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded ${
                    activeUser?.role === 'admin' ? 'bg-amber-400 text-slate-900' :
                    (activeUser?.role === 'warehouse' || activeUser?.role === 'dco') ? 'bg-emerald-400 text-slate-900' :
                    activeUser?.role === 'cca' ? 'bg-blue-300 text-slate-900' : 'bg-slate-300 text-slate-900'
                  }`}>
                    {ROLE_DEFINITIONS[activeUser?.role || 'admin']?.title || activeUser?.role || 'Admin'}
                  </span>
                  <span className="text-[10px] text-purple-300 hidden md:inline truncate max-w-[120px]">
                    {activeUser?.nest || activeUser?.district || 'All Districts'}
                  </span>
                </div>
              </div>
              
              <div className={`text-white p-1.5 rounded-xl flex items-center justify-center w-8 h-8 font-black text-sm shadow border border-white/20 shrink-0 ${
                activeUser?.role === 'admin' ? 'bg-amber-500' :
                (activeUser?.role === 'warehouse' || activeUser?.role === 'dco') ? 'bg-emerald-600' :
                activeUser?.role === 'cca' ? 'bg-blue-600' : 'bg-slate-700'
              }`}>
                {activeUser?.name?.charAt(0) || 'M'}
              </div>
            </div>

            <button type="button" onClick={() => { void logoutUser().catch(() => window.alert('Could not sign out. Please retry.')); }} title="Sign out" className="inline-flex items-center gap-2 p-2 text-white rounded-xl hover:bg-white/10"><LogOut size={16} /><span className="hidden sm:inline text-xs">Sign out</span></button>
            {/* Manage Roles Button */}
            {activeUser?.role === 'admin' && <button
              type="button"
              onClick={() => { if (activeUser?.role === 'admin') setIsRoleModalOpen(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-xs"
              title="Account administration and team roles"
            >
              <Users className="w-3.5 h-3.5 text-purple-200" />
              <span className="hidden sm:inline">Administration</span>
              <span className="text-[10px] bg-purple-400/40 text-purple-100 px-1.5 py-0.2 rounded-full font-black">
                {roles.length}
              </span>
            </button>}
          </div>
        </div>
      </header>

      {/* Tab bar Navigation */}
      <div className="bg-white border-b border-purple-100 sticky top-[68px] z-30 shadow-sm overflow-x-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-2 sm:gap-4 min-w-max">
          {/* Vaccine Allocation Blueprint (sample.xlsx 67-Column Grid) */}
          <button
            onClick={() => setActiveTab('vaccine_blueprint')}
            className={`py-4 px-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'vaccine_blueprint'
                ? 'border-[#ED7D31] text-[#C55A11]'
                : 'border-transparent text-slate-500 hover:text-[#ED7D31]'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-[#ED7D31]" />
            <span>Allocation Blueprint</span>
            <span className="text-[10px] bg-orange-100 text-[#C55A11] px-1.5 py-0.5 rounded font-black border border-orange-200">67-COL</span>
          </button>

          {/* Vaccine Allocation Validation Module Tabs */}
          <button
            onClick={() => setActiveTab('vaccine_checker')}
            className={`py-4 px-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'vaccine_checker'
                ? 'border-[#5C2D91] text-[#5C2D91]'
                : 'border-transparent text-slate-500 hover:text-[#5C2D91]'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Vaccine Checker</span>
            <span className="text-[10px] bg-purple-100 text-[#5C2D91] px-1.5 py-0.5 rounded font-black">MODULE</span>
          </button>

          <button
            onClick={() => setActiveTab('vaccine_dashboard')}
            className={`py-4 px-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'vaccine_dashboard'
                ? 'border-[#5C2D91] text-[#5C2D91]'
                : 'border-transparent text-slate-500 hover:text-[#5C2D91]'
            }`}
          >
            <Activity className="w-4 h-4" />
            Vaccine Dashboard
          </button>

          <button onClick={() => setActiveTab('kpi_dashboard')} className={`py-4 px-3 text-xs md:text-sm font-bold border-b-2 transition-all ${activeTab === 'kpi_dashboard' ? 'border-[#5C2D91] text-[#5C2D91]' : 'border-transparent text-slate-500 hover:text-[#5C2D91]'}`}>
            <Activity className="mr-2 inline h-4 w-4" />KPI Dashboard
          </button>

          {/* Divider */}
          <div className="h-6 w-px bg-slate-200 self-center my-auto"></div>

          {/* General Order Checker Tabs */}
          <button
            onClick={() => setActiveTab('auditor')}
            className={`py-4 px-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'auditor'
                ? 'border-[#5C2D91] text-[#5C2D91]'
                : 'border-transparent text-slate-500 hover:text-[#5C2D91]'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            General Auditor
          </button>
          
          <button
            onClick={() => setActiveTab('extension')}
            className={`py-4 px-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'extension'
                ? 'border-[#5C2D91] text-[#5C2D91]'
                : 'border-transparent text-slate-500 hover:text-[#5C2D91]'
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            Companion Chrome Extension
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`py-4 px-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'history'
                ? 'border-[#5C2D91] text-[#5C2D91]'
                : 'border-transparent text-slate-500 hover:text-[#5C2D91]'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Audit & Activity Log</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          </button>

          <button
            onClick={() => setActiveTab('troubleshooter')}
            className={`py-4 px-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'troubleshooter'
                ? 'border-[#5C2D91] text-[#5C2D91]'
                : 'border-transparent text-slate-500 hover:text-[#5C2D91]'
            }`}
          >
            <Wrench className="w-4 h-4 text-amber-500" />
            Troubleshooter & Diagnostics
            {result && !result.allMatch && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
            )}
          </button>

          {/* Team Roles & Access Control modal trigger */}
          {activeUser?.role === 'admin' && <button
            onClick={() => { if (activeUser?.role === 'admin') setIsRoleModalOpen(true); }}
            className="py-4 px-3 text-xs md:text-sm font-bold border-b-2 border-transparent text-purple-700 hover:text-purple-900 transition-all flex items-center gap-2 cursor-pointer ml-auto"
          >
            <Users className="w-4 h-4 text-purple-700" />
            <span>Administration</span>
            <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded-full font-black border border-purple-200">
              {roles.length}
            </span>
          </button>}
        </div>
      </div>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6" id="main-content">
        
        {/* EXACT 67-COLUMN VACCINE ALLOCATION BLUEPRINT (sample.xlsx) */}
        {activeTab === 'vaccine_blueprint' && (
          <div className="animate-in fade-in duration-300">
            <VaccineAllocationBlueprint
              preferredSheetId={checkerBlueprintSheetId}
              currentUser={activeUser}
              onFacilitySelectedForOrder={(facilityId) => {
                setActiveTab('vaccine_checker');
              }}
              onNavigateToChecker={() => {
                setActiveTab('vaccine_checker');
              }}
              onNavigateToAuditLog={() => {
                setActiveTab('history');
              }}
            />
          </div>
        )}

        {/* VACCINE ALLOCATION CHECKER VIEW */}
        {activeTab === 'vaccine_checker' && (
          <div className="animate-in fade-in duration-300">
            <VaccineAllocationChecker
              onBlueprintSheetSelected={setCheckerBlueprintSheetId}
              onNavigateToBlueprint={() => setActiveTab('vaccine_blueprint')}
              onNavigateToTracker={() => setActiveTab('vaccine_dashboard')}
              onNavigateToHistory={() => setActiveTab('history')}
              currentUser={activeUser}
            />
          </div>
        )}

        {/* VACCINE ALLOCATION DASHBOARD VIEW */}
        {activeTab === 'vaccine_dashboard' && (
          <div className="animate-in fade-in duration-300">
            <VaccineDashboard
              onSelectFacilityForAudit={(facilityId) => {
                setActiveTab('vaccine_checker');
              }}
              onNavigateToBlueprint={() => {
                setActiveTab('vaccine_blueprint');
              }}
              onNavigateToChecker={() => {
                setActiveTab('vaccine_checker');
              }}
            />
          </div>
        )}

        {activeTab === 'kpi_dashboard' && <div className="animate-in fade-in duration-300"><KpiDashboard /></div>}

        {/* COMPLIANCE AUDITOR ACTIVE TAB VIEW */}
        {activeTab === 'auditor' && (
          <div className="space-y-6 animate-in fade-in duration-300">

            <p className="text-sm text-slate-600">
              Compares facility name, name of orderer, products, and quantities between the current WhatsApp Message (Customer Request) and Fulfilment Confirmation (System Entry). Stock shortages, confirmed Order Limits, and approved packaging conversions are valid. Genuine product, quantity, or identity errors require correction.
            </p>

            {/* Presets Row */}
            <div className="bg-purple-50/50 border border-purple-100 rounded-2xl p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 shadow-sm">
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-purple-600 tracking-wider uppercase block">Interactive Dispatch Audit Scenarios</span>
                <span className="text-xs font-semibold text-[#3B1A5E] block">Select a demo scenario to compare the two example inputs. Demo checks are labeled and excluded from KPI totals:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applySampleData('perfect')}
                  className="px-3 py-1.5 bg-white border border-green-200 hover:bg-green-50 text-green-700 text-[11px] font-bold rounded-xl transition cursor-pointer"
                >
                  🟢 Perfect Order Match
                </button>
                <button
                  type="button"
                  onClick={() => applySampleData('discrepancy_qty')}
                  className="px-3 py-1.5 bg-white border border-amber-200 hover:bg-amber-50 text-amber-800 text-[11px] font-bold rounded-xl transition cursor-pointer"
                >
                  🟡 Quantity Mismatch (PCM)
                </button>
                <button
                  type="button"
                  onClick={() => applySampleData('discrepancy_extra')}
                  className="px-3 py-1.5 bg-white border border-purple-200 hover:bg-purple-50 text-purple-700 text-[11px] font-bold rounded-xl transition cursor-pointer"
                >
                  🟣 Extra Cargo Manifest
                </button>
                <button
                  type="button"
                  onClick={() => applySampleData('vaccine_diluent_mismatch')}
                  className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 text-[#991B1B] text-[11px] font-bold rounded-xl transition cursor-pointer"
                >
                  🔴 Diluent Presence Mismatch
                </button>
                <button
                  type="button"
                  onClick={() => applySampleData('vaccine_dropper_mismatch')}
                  className="px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 text-[#991B1B] text-[11px] font-bold rounded-xl transition cursor-pointer"
                >
                  🔴 Dropper Count Mismatch
                </button>
              </div>
            </div>

            <GeneralMonitoring />
            {generalServiceWarning && <p role="status" className="text-xs text-amber-800">{generalServiceWarning}</p>}
            {/* Inputs Layout */}
            <div id="editor-grid" className="grid md:grid-cols-2 gap-6">
              
              {/* Customer Input Column */}
              <div data-general-source="customer" className="bg-white rounded-2xl p-5 border border-purple-100 shadow-sm flex flex-col gap-4">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <label htmlFor="whatsapp-input" className="flex items-center gap-2 text-sm font-bold text-[#3B1A5E]">
                    <div className="bg-[#25D366] text-white p-1.5 rounded-lg flex items-center justify-center">
                      <MessageSquare size={16} fill="white" className="text-[#25D366]" />
                    </div>
                    WhatsApp Message (Customer Request)
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono tracking-wider">FROM REGIONAL CLINIC</span>
                </div>

                <GeneralScreenshotInput ref={customerImage} label="Customer Request" resetKey={generalImageReset} inputsKey={JSON.stringify([whatsappMessage, fulfillmentConfirmation])} onInvalidate={invalidateGeneralAudit} onText={text => handleCustomChange('whatsapp', text)} />

                {/* Render normal text input mode or as parsed result visualization */}
                <div className="relative flex-1 flex flex-col gap-1.5">
                  <textarea
                    id="whatsapp-input"
                    className="w-full h-56 max-h-80 p-4 rounded-xl border border-purple-100 focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] bg-purple-50/25 font-mono text-xs sm:text-sm text-slate-700 leading-relaxed outline-none transition-all shadow-inner"
                    placeholder="Name of Orderer: Kwame Mensah&#10;Facility: St. Jude's Clinic&#10;ACT 20/120mg - 20 units"
                    value={whatsappMessage}
                    onChange={(e) => handleCustomChange('whatsapp', e.target.value)}
                  />
                </div>

                <div className="text-[11px] text-slate-400 bg-slate-50 p-2 rounded-lg border border-slate-100 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div>
                  <span>Supports Ghana abbreviation aliases like <span className="font-semibold text-slate-600">PCM</span>, <span className="font-semibold text-slate-600">AL</span>, and <span className="font-semibold text-slate-600">ORS</span>.</span>
                </div>
              </div>

              {/* Fulfillment Input Column */}
              <div data-general-source="fulfillment" className="bg-white rounded-2xl p-5 border border-purple-100 shadow-sm flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <label htmlFor="fulfillment-input" className="flex items-center gap-2 text-sm font-bold text-[#3B1A5E]">
                      <div className="bg-[#5C2D91] text-white p-1.5 rounded-lg flex items-center justify-center">
                        <ClipboardCheck size={16} className="text-purple-100" />
                      </div>
                      Fulfilment Confirmation (System Entry)
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono tracking-wider">OFFLINE TERMINAL LOG</span>
                  </div>
                  
                  <GeneralScreenshotInput ref={fulfillmentImage} label="Fulfillment Confirmation" resetKey={generalImageReset} inputsKey={JSON.stringify([whatsappMessage, fulfillmentConfirmation])} onInvalidate={invalidateGeneralAudit} onText={text => handleCustomChange('fulfillment', text)} />
                  <div className="relative flex-1">
                    <textarea
                      id="fulfillment-input"
                      className="w-full h-56 max-h-80 p-4 rounded-xl border border-purple-100 focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] bg-purple-50/25 font-mono text-xs sm:text-sm text-slate-700 leading-relaxed outline-none transition-all shadow-inner"
                      placeholder="Name of Orderer: Kwame Mensah&#10;Facility: St. Jude's Clinic&#10;ACT 20/120mg [20/20]"
                      value={fulfillmentConfirmation}
                      onChange={(e) => handleCustomChange('fulfillment', e.target.value)}
                    />
                  </div>
                  <div className="text-[11px] text-slate-400 bg-slate-50 p-2 rounded-lg border border-slate-100 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div>
                    <span>Compares entered products and quantities with the customer request.</span>
                  </div>
                </div>

              </div>

              {/* Big Trigger Call-to-Action Button */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={verifyOrder}
                  disabled={loading}
                  id="verify-button"
                  className={`flex-1 bg-[#5C2D91] hover:bg-[#3B1A5E] text-white font-bold py-4 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-3 disabled:opacity-50 text-base cursor-pointer ${
                    loading ? 'animate-pulse' : ''
                  }`}
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Auditing Order Logs... {verificationTime !== null && verificationTime > 0 ? `(${verificationTime.toFixed(1)}s)` : ''}
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-white" />
                      Run Order Verification Audit
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={runSpeedTest}
                  disabled={speedLoading}
                  id="check-speed-button"
                  className="bg-white hover:bg-slate-50 border border-slate-200 hover:border-[#5C2D91] text-slate-700 font-semibold px-5 py-4 rounded-xl shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer shrink-0"
                >
                  <Timer className={`w-4 h-4 text-indigo-600 ${speedLoading ? 'animate-spin' : ''}`} />
                  {speedLoading ? 'Testing API...' : 'Check Speed'}
                </button>
              </div>

              {/* Speed Test results visual badge */}
              {speedResult && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3.5 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border ${
                    speedResult.success 
                      ? 'bg-indigo-50/50 border-indigo-100 text-indigo-900' 
                      : 'bg-red-50 border-red-100 text-red-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 relative">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${speedResult.success ? 'bg-indigo-400' : 'bg-red-400'}`}></span>
                      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${speedResult.success ? 'bg-indigo-500' : 'bg-red-500'}`}></span>
                    </span>
                    <span className="font-semibold text-slate-700">Verification Engine Latency:</span>
                  </div>
                  <div className="flex items-center gap-3 justify-between sm:justify-end">
                    {speedResult.success ? (
                      <>
                        <span className="font-mono bg-indigo-100 text-indigo-900 px-2 py-0.5 rounded-md font-bold text-[11px]">
                          {(speedResult.durationMs / 1000).toFixed(2)}s
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          speedResult.status === 'Excellent' 
                            ? 'bg-emerald-600 text-white' 
                            : (speedResult.status === 'Good' ? 'bg-indigo-600 text-white' : 'bg-amber-600 text-white')
                        }`}>
                          {speedResult.status}
                        </span>
                      </>
                    ) : (
                      <span className="text-red-600 font-semibold text-[11px]">{speedResult.error}</span>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Global Error Banner */}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-start gap-3 shadow-sm animate-in fade-in duration-300">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="font-bold text-sm">Audit System Alert</h4>
                    <p className="text-xs text-red-700 mt-0.5">{error}</p>
                  </div>
                </div>
              )}

              {/* Live Verification Results Render */}
              <AnimatePresence mode="wait">
                {result && (
                  <motion.div
                    key="results-panel"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.4 }}
                    className="space-y-6"
                    id="results-panel"
                  >
                    
                    {/* Top Banner Verdict Alert */}
                    <div className={`p-5 rounded-2xl border-l-8 border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm bg-white ${
                      result.allMatch 
                        ? 'border-green-200 border-l-green-600' 
                        : generalDetails?.pendingOrderLimitCount && result.issueCount === 0 ? 'border-amber-200 border-l-amber-500' : 'border-rose-200 border-l-rose-500'
                    }`}>
                      <div className="flex items-start gap-4">
                        <div className={`p-2.5 rounded-full shrink-0 flex items-center justify-center ${
                          result.allMatch ? 'bg-green-100 text-green-700' : generalDetails?.pendingOrderLimitCount && result.issueCount === 0 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-700'
                        }`}>
                          {result.allMatch ? <CheckCircle className="w-7 h-7" /> : <AlertCircle className="w-7 h-7" />}
                        </div>
                        <div>
                          <h3 className="font-black text-[#3B1A5E] text-lg leading-tight md:text-xl flex items-center gap-2 flex-wrap">
                            {generalDetails?.finalStatus || result.verdict}
                            <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-mono font-medium">Session Log</span>
                            {verificationTime !== null && (
                              <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded font-mono font-semibold flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {verificationTime}s
                              </span>
                            )}
                          </h3>
                          {generalDetails && result.issueCount > 0 ? <GeneralDiscrepancySubtitle discrepancies={generalDetails.discrepancies} /> : (
                          <p className="text-xs text-slate-500 mt-1 sm:mt-0">
                            {generalDetails?.message || (result.allMatch
                              ? 'Confirmed — No discrepancy. Stock availability and any confirmed order limits are recorded below.'
                              : generalDetails?.pendingOrderLimitCount && result.issueCount === 0
                                ? 'Answer the Order Limit question for each reduced quantity before confirming.'
                                : `Identified ${result.issueCount} genuine discrepanc${result.issueCount === 1 ? 'y' : 'ies'}.`
                            )}
                          </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex items-center gap-3 flex-wrap sm:flex-nowrap">
                        <span className={`text-[10px] font-mono px-3 py-1.5 rounded-full font-bold shadow-sm uppercase ${
                          result.allMatch ? 'bg-green-100 text-green-805' : 'bg-red-100 text-red-800'
                        }`}>
                          {result.allMatch ? 'CONFIRMED' : generalDetails?.pendingOrderLimitCount ? 'AWAITING VALIDATION' : 'DISCREPANCY DETECTED'}
                        </span>
                        {result.allMatch ? (
                          <button
                            type="button"
                            onClick={handleLogApprovedDispatch}
                            disabled={Boolean(generalDetails) && loading}
                            className="bg-[#25D366] hover:bg-[#20ba59] text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-md cursor-pointer flex items-center gap-1 w-full sm:w-auto justify-center disabled:opacity-50"
                          >
                            <CheckSquare className="w-4 h-4" />
                            Confirm & Clear
                          </button>
                        ) : generalDetails?.pendingOrderLimitCount ? (
                          <span className="text-xs font-semibold text-amber-800">Order Limit answers required</span>
                        ) : (
                          <div className="flex gap-2 w-full sm:w-auto">
                            <button
                              type="button"
                              onClick={() => setActiveTab('troubleshooter')}
                              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3 py-2 rounded-xl transition-all shadow cursor-pointer flex items-center gap-1.5 justify-center flex-1 sm:flex-initial"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                              Troubleshoot Issue
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAuditForResolution(result);
                                setResolutionActionNotes('');
                              }}
                              className="bg-[#5C2D91] hover:bg-[#3B1A5E] text-white text-xs font-bold px-3 py-2 rounded-xl transition-all shadow cursor-pointer flex-1 sm:flex-initial"
                            >
                              Resolve Log
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Three Column Details Grid */}
                    <div className="grid lg:grid-cols-3 gap-6">

                      {/* Left side detailed Supply Check Table (Stretches 2 cols) */}
                      <div className="lg:col-span-2 space-y-4">
                        <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-purple-100/80 shadow-sm">
                          <span className="text-xs font-bold text-[#3B1A5E]/70 uppercase tracking-widest flex items-center gap-2">
                            <span className="w-2.5 h-2.5 bg-[#5C2D91] rounded-full"></span>
                            Inventory Cross-Examination
                          </span>
                          <span className="text-xs text-[#5C2D91] font-mono font-medium">
                            Items Analysed: {result.items.length}
                          </span>
                        </div>

                        <div className="space-y-3">
                          {result.items.map((item, idx) => {
                            const colors = getStatusColor(item.status);
                            const generalProduct = generalDetails?.products.find(product => product.name === item.name);
                            return (
                              <div 
                                key={`item-${item.name}-${idx}`} 
                                className={`bg-white border ${colors.border} ${colors.leftBorder} border-l-4 rounded-xl p-4 shadow-sm flex flex-col gap-3.5 transition-all hover:shadow`}
                              >
                                {/* Upper row with details and compliance state */}
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 w-full">
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="font-bold text-[#3B1A5E] text-base leading-none">{generalDetails ? <GeneralProductName name={item.name} /> : item.name}</h4>
                                      {item.category && (
                                        <span className={`text-[9px] uppercase font-mono font-bold tracking-wider px-2 py-0.5 rounded-full border ${getCategoryBadgeStyle(item.category).bg}`}>
                                          {getCategoryBadgeStyle(item.category).label}
                                        </span>
                                      )}
                                      <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${colors.bg}`}>
                                        {generalProduct && item.status === 'missing item' ? 'missing product' : generalProduct && item.status === 'extra item' ? 'extra product' : item.status}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-slate-500 font-mono mt-1 pt-0.5">
                                      <div>
                                        <span className="text-slate-400">WhatsApp Request: </span>
                                        <span className="text-slate-800 font-semibold">{item.requested}</span>
                                      </div>
                                      <div className="w-1.5 h-1.5 rounded-full bg-slate-200"></div>
                                      <div>
                                        <span className="text-slate-400">Fulfillment Match: </span>
                                        <span className="text-[#3B1A5E] font-semibold">{item.found}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {generalDetails && (item.status === 'quantity mismatch' || generalProduct?.fulfillmentStatus === 'order limit applied') && (
                                    <p className={`text-xs ${generalProduct?.fulfillmentStatus === 'order limit applied' ? 'text-green-800' : 'text-amber-800'}`}>Difference: {generalProduct?.difference} {generalProduct?.conversion?.unit || generalProduct?.requestedUnit}</p>
                                  )}

                                  {/* Compliance Action Block */}
                                  {item.action && (!generalDetails || item.action !== 'None') && (
                                    <div className="bg-[#F9F5FF] p-2.5 rounded-xl border border-purple-100 flex items-start gap-2 max-w-sm w-full mt-2 sm:mt-0 transition-all">
                                      <div className="p-1 rounded bg-[#5C2D91]/10 text-[#5C2D91] mt-0.5 shrink-0">
                                        <HelpCircle className="w-3.5 h-3.5 animate-pulse" />
                                      </div>
                                      <div className="text-left w-full">
                                        <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center justify-between tracking-wider w-full">
                                          {generalProduct && (item.status === 'out of stock' || item.status === 'order limit applied') ? 'Operational Status' : 'Compliance Correction Action'}
                                        </span>
                                        <span className="text-xs font-semibold text-[#5C2D91] leading-tight block mt-0.5">
                                          {item.action}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {generalProduct?.orderLimitEligible && <GeneralOrderLimitPrompt product={generalProduct} onDecision={answerGeneralOrderLimit} disabled={loading} />}

                                {/* Inline Order Limit Validation Panel (Directly Under Product Detail!) */}
                                {!generalDetails && item.status === 'quantity mismatch' && !promptedItems.includes(item.name) && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="bg-[#FFFDF5] p-3.5 rounded-xl border-2 border-amber-300 relative overflow-hidden text-left w-full"
                                  >
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                      <div className="space-y-1 max-w-md">
                                        <div className="flex items-center gap-1.5 text-xs font-black text-[#3B1A5E]">
                                          <AlertTriangle className="w-4 h-4 text-amber-600 animate-pulse" />
                                          <span>Order Limit Verification Required</span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-normal">
                                          Is this product subject to an <strong>order limit of {item.found} units</strong> instead of a dispatch discrepancy?
                                        </p>
                                      </div>
                                      
                                      <div className="flex gap-2 w-full sm:w-auto shrink-0 pt-1 sm:pt-0">
                                        <button
                                          type="button"
                                          onClick={() => handleDeclineOrderLimit(item)}
                                          className="flex-1 sm:flex-initial bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 py-1.5 px-3.5 rounded-lg text-xs font-bold transition cursor-pointer"
                                        >
                                          No, Discrepancy
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => confirmOrderLimit(item)}
                                          className="flex-1 sm:flex-initial bg-[#5C2D91] hover:bg-[#3B1A5E] text-white py-1.5 px-3.5 rounded-lg text-xs font-bold transition cursor-pointer shadow-sm text-center"
                                        >
                                          Yes, Apply Limit
                                        </button>
                                      </div>
                                    </div>
                                  </motion.div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right side verification stats & AI Insights */}
                      <div className="space-y-6">

                        {/* Confidence Score Gauge */}
                        {generalDetails ? <GeneralVerificationConfidence
                          summary={generalDetails.auditSummary ?? buildGeneralAuditCheckSummary(result.items, generalDetails.facility, generalDetails.orderer, generalDetails.phone, result.issueCount)}
                          pendingOrderLimits={generalDetails.pendingOrderLimitCount}
                        /> : (
                        <div className="bg-white p-5 rounded-2xl border border-purple-100 shadow-sm flex flex-col items-center text-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Verification Confidence</span>
                          
                          {/* Circle SVG Meter */}
                          <div className="relative flex items-center justify-center my-4">
                            <svg className="w-32 h-32 transform -rotate-90">
                              <circle
                                cx="64"
                                cy="64"
                                r="52"
                                stroke="#F3E8FF"
                                strokeWidth="8"
                                fill="transparent"
                              />
                              <circle
                                cx="64"
                                cy="64"
                                r="52"
                                stroke={result.confidence >= 90 ? '#22C55E' : result.confidence >= 75 ? '#F59E0B' : '#EF4444'}
                                strokeWidth="8"
                                fill="transparent"
                                strokeDasharray={2 * Math.PI * 52}
                                strokeDashoffset={2 * Math.PI * 52 * (1 - result.confidence / 100)}
                                strokeLinecap="round"
                                className="transition-all duration-1000 ease-out"
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className={`text-3xl font-black ${getConfidenceLevelColor(result.confidence)}`}>
                                {result.confidence}%
                              </span>
                              <span className="text-[9px] font-mono tracking-wide text-slate-400 uppercase">SYSTEM MATCH</span>
                            </div>
                          </div>

                          <p className="text-xs text-slate-500 leading-relaxed max-w-[200px]">
                            Comparison of the entered facility name, orderer name, products, and quantities.
                          </p>
                        </div>
                        )}

                        {generalDetails && <GeneralAuditDetails details={generalDetails} />}

                        {/* AI Insights and notes */}
                        <div className="bg-[#3B1A5E] text-white p-5 rounded-2xl shadow-md border border-[#2C1349] relative overflow-hidden">
                          <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-10 bg-purple-200 w-24 h-24 rounded-full"></div>
                          
                          <h4 className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-widest mb-3 relative z-10">
                            <Sparkles className="w-4 h-4 text-purple-300 animate-pulse" />
                            Current Audit Discrepancy Summary
                          </h4>

                          <ul className="text-xs space-y-2.5 opacity-90 leading-relaxed font-sans relative z-10">
                            {result.insights.length === 0 && <li>{generalDetails?.pendingOrderLimitCount ? 'Order Limit validation is pending; no quantity discrepancy has been declared for those products.' : 'No discrepancy in the current inputs.'}</li>}
                            {result.insights.map((note, idx) => (
                              <li key={`insight-${idx}`} className="flex gap-2.5 items-start">
                                <ArrowRight className="w-3.5 h-3.5 text-purple-300 shrink-0 mt-0.5" />
                                <span>{note}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                      </div>

                    </div>

                  </motion.div>
                )}
              </AnimatePresence>
          </div>
        )}


        {/* CHROME COMPANION EXTENSION TERMINAL DOWNLOAD VIEW */}
        {activeTab === 'extension' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-2xl p-6 border border-purple-100 shadow-sm space-y-6 animate-in fade-in duration-300"
          >
            <div className="border-b border-purple-50 pb-4">
              <h2 className="text-lg font-extrabold text-[#3B1A5E] flex items-center gap-2">
                <PlusCircle className="text-indigo-500 w-5 h-5 animate-pulse" />
                OrderCheck Chrome Extension Companion
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Optimize your workflow! Install our custom packed extension to scan active messages straight from your WhatsApp Web screen contents and sync them with system entries.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              
              {/* Left Column (Main instructions & Download Card) */}
              <div className="md:col-span-2 space-y-6">
                
                {/* Visual Download Card */}
                <div className="bg-[#3B1A5E] text-white p-6 rounded-2xl border border-[#2C1349] relative overflow-hidden flex flex-col sm:flex-row justify-between items-center gap-6 shadow-md shadow-purple-900/10">
                  <div className="absolute right-0 top-0 translate-x-6 -translate-y-6 opacity-10 bg-purple-200 w-32 h-32 rounded-full"></div>
                  <div className="space-y-1 text-center sm:text-left">
                    <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-purple-300">PRE-CONFIGURED PLUG-IN PACKAGE</span>
                    <h3 className="text-lg font-bold text-white">Pre-packaged Compliance Extension</h3>
                    <p className="text-xs text-purple-100 select-none pb-0.5">
                      Guaranteed zero manual server URI mappings. It connects automatically to this portal API.
                    </p>
                  </div>
                  <a
                    href="/api/download-extension"
                    className="bg-white text-[#3B1A5E] hover:bg-[#F3E8FF] px-5 py-3 rounded-xl font-bold shadow transition-transform hover:-translate-y-0.5 whitespace-nowrap text-xs cursor-pointer shrink-0 z-10 flex items-center gap-2"
                  >
                    <Download className="w-4 h-4 text-[#5C2D91]" />
                    Download Packed ZIP
                  </a>
                </div>

                {/* Direct Instruction Steps */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-[#3B1A5E] uppercase tracking-wider flex items-center gap-1.5">
                    <CheckSquare className="w-4 h-4 text-purple-600" />
                    How to Install in 2 Minutes:
                  </h3>
                  <div className="divide-y divide-purple-50 text-xs text-slate-600 font-sans leading-relaxed border border-purple-50 rounded-xl bg-slate-50/40 p-4 space-y-2">
                    <p className="pb-2"><b>1. Download:</b> Click the download button to grab your unique pre-assembled ZIP packet.</p>
                    <p className="py-2"><b>2. Unzip:</b> Extract the ZIP folder contents to a directory on your desk.</p>
                    <p className="py-2"><b>3. Extensions Dashboard:</b> Open Google Chrome and enter <code>chrome://extensions/</code> as the URL.</p>
                    <p className="py-2"><b>4. Developer Switch:</b> In the top-right corner, check the <b>"Developer mode"</b> toggle switch.</p>
                    <p className="pt-2"><b>5. Unpacked Upload:</b> Click the <b>"Load unpacked"</b> button in the top-left, and pick the extracted folder containing <code>manifest.json</code>.</p>
                  </div>
                </div>

              </div>

              {/* Right Column (Code highlight representation) */}
              <div className="space-y-4">
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                  <h3 className="font-bold text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                    Extension Source Core Map
                  </h3>
                  
                  <div className="bg-slate-900 text-slate-300 font-mono text-[9px] p-3 rounded-lg overflow-x-auto leading-relaxed max-h-56">
                    <pre>{`{
  "manifest_version": 3,
  "name": "OrderCheck Companion",
  "version": "1.2.0",
  "permissions": [
    "activeTab",
    "scripting",
    "storage"
  ],
  "content_scripts": [
    {
      "matches": [
        "http://*/*",
        "https://*/*"
      ],
      "js": ["content.js"]
    }
  ]
}`}</pre>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-2 block text-center italic">
                    Synchronized automatically with portal endpoints.
                  </span>
                </div>
              </div>

            </div>
          </motion.div>
        )}

        {/* SYSTEM ACTIVITY & AUDIT LOG VIEW */}
        {activeTab === 'history' && (
          <div className="animate-in fade-in duration-300">
            <SystemAuditLogView
              currentUser={activeUser}
              onNavigateToBlueprint={() => setActiveTab('vaccine_blueprint')}
              onNavigateToChecker={() => setActiveTab('vaccine_checker')}
            />
          </div>
        )}

        {/* TROUBLESHOOTER & SYSTEM DIAGNOSTICS ACTIVE TAB VIEW */}
        {activeTab === 'troubleshooter' && (
          <Troubleshooter 
            currentAudit={result}
            onUpdateAudit={(updatedAudit) => setResult(updatedAudit)}
            onRunTest={verifyOrder}
            onNavigateAuditor={() => setActiveTab('auditor')}
          />
        )}

      </main>

      {/* RESOLUTION WORKFLOW DRAW PANEL / MODAL OVERLAY */}
      <AnimatePresence>
        {selectedAuditForResolution && (
          <motion.div
            key="resolution-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#2C1349]/70 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl border border-purple-100 max-w-lg w-full overflow-hidden flex flex-col"
            >
              <div className="bg-[#3B1A5E] text-white p-5 flex justify-between items-center">
                <div>
                  <span className="text-[9px] bg-purple-500 px-2 py-0.5 rounded font-mono font-bold">{selectedAuditForResolution.id}</span>
                  <h3 className="font-extrabold text-base mt-1">Discrepancy Dispatch Clearance</h3>
                </div>
                <button 
                  onClick={() => setSelectedAuditForResolution(null)} 
                  className="text-purple-200 hover:text-white transition cursor-pointer font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4 text-xs overflow-y-auto max-h-[70vh]">
                <div className="bg-[#F9F5FF] p-3 rounded-xl border border-purple-100 leading-relaxed text-slate-600 text-xs">
                  <span className="font-bold text-[#3B1A5E] block mb-1">AI Flagged Issue:</span>
                  {selectedAuditForResolution.verdict}
                </div>

                <div className="space-y-1">
                  <span className="font-bold text-[#3B1A5E]">Unmatched Items Status:</span>
                  <div className="divide-y divide-purple-50 font-mono text-[11px] bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    {selectedAuditForResolution.items.filter(it => (selectedAuditForResolution as AuditRecord & { generalAudit?: GeneralAuditDetailsPayload }).generalAudit ? (it as VerificationItem & { fulfillment?: { fulfillmentStatus: string } }).fulfillment?.fulfillmentStatus === 'discrepancy' : it.status !== 'match' && it.status !== 'out of stock').map((it, idx) => (
                      <div key={`unmatched-${it.name}-${idx}`} className="py-1.5 flex flex-wrap justify-between items-center gap-1">
                        <div className="flex items-center gap-1.5">
                          {it.category && (
                            <span className="text-[8px] font-mono leading-none font-bold uppercase bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                              {it.category}
                            </span>
                          )}
                          <span className="text-slate-500 font-bold">{it.name}:</span>
                        </div>
                        <span className="text-rose-700 font-bold text-right">{it.action || it.status}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {(selectedAuditForResolution as AuditRecord & { generalAudit?: GeneralAuditDetailsPayload }).generalAudit && <GeneralAuditDetails details={(selectedAuditForResolution as AuditRecord & { generalAudit: GeneralAuditDetailsPayload }).generalAudit} />}

                {/* Resolution Notes Input */}
                <div className="space-y-1">
                  <label htmlFor="resolution-notes-input" className="font-bold text-[#3B1A5E] block">
                    Correction Action & Logs:
                  </label>
                  <textarea
                    id="resolution-notes-input"
                    rows={4}
                    value={resolutionActionNotes}
                    onChange={(e) => setResolutionActionNotes(e.target.value)}
                    className="w-full p-3 rounded-xl border border-purple-100 focus:ring-1 focus:ring-[#5C2D91] focus:border-[#5C2D91] outline-none text-slate-700 leading-relaxed font-sans"
                    placeholder="e.g. Corrected paracetamol cards from 5 to 10 in fulfillment terminal. Re-packed with RDT kits and authorized flight launched."
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-50 border-t border-purple-50 flex gap-2 justify-end">
                <button
                  onClick={() => setSelectedAuditForResolution(null)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={submitResolution}
                  disabled={submittingResolution}
                  className="px-5 py-2 bg-[#5C2D91] hover:bg-[#3B1A5E] text-white font-bold rounded-xl shadow cursor-pointer transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {submittingResolution ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Saving Clearance...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Approve & Log Clearance
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}



        {/* Confirmation banner message toast */}
        {lastConfirmedItemName && (
          <motion.div
            key="confirm-item-toast"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white font-bold p-4 rounded-xl shadow-2xl border border-emerald-500 flex items-center gap-2.5"
          >
            <CheckCircle className="w-5 h-5 shrink-0" />
            <span className="text-xs">
              Order limit verified and applied for <strong className="underline">{lastConfirmedItemName}</strong>!
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Corporate Zipline Footer */}
      <footer className="bg-white border-t border-purple-100 py-6 px-6 mt-12 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <p>© 2026 Zipline. Internal validation tool for Zipline Ghana Customer Care teams. Designed solely to correct mismatches and discrepancies (Not affiliated with GHS/MOH).</p>
          <div className="flex gap-4">
            <span className="hover:text-[#5C2D91] transition-colors cursor-pointer">Security Protocol 32</span>
            <span>•</span>
            <span className="hover:text-[#5C2D91] transition-colors cursor-pointer">Discrepancy Control Mode</span>
          </div>
        </div>
      </footer>

      {/* Team Roles & Access Control (RBAC) Management Modal */}
      <RoleManagementModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        roles={roles}
        registrations={registrations}
        activeUser={activeUser}
        onRoleAddedOrUpdated={(updatedRoles, newActive) => {
          setRoles(updatedRoles);
          void fetchRoles();
          if (newActive) setActiveUser(newActive);
        }}
      />

    </div>
  );
}
