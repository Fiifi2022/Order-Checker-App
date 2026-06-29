/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  RefreshCw, 
  ChevronRight,
  ClipboardList,
  HelpCircle,
  CheckSquare,
  Save,
  AlertTriangle,
  Zap,
  Brain,
  PlusCircle,
  Clock,
  Image,
  Upload,
  Trash,
  Download,
  Calendar,
  Package
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OrderCheckResult, AuditRecord, AuditAnalytics, VerificationItem } from './types';

export default function App() {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'auditor' | 'extension'>('auditor');

  // WhatsApp input modes: 'text' represents raw typing, 'screenshot' represents visual scan
  const [whatsappInputMode, setWhatsappInputMode] = useState<'text' | 'screenshot'>('text');

  // Simulated out of stock (OSU) list
  const [osuList, setOsuList] = useState<string[]>([]);
  const [newOsuItem, setNewOsuItem] = useState('');
  const [osuLoading, setOsuLoading] = useState(false);

  // Core input fields
  const [whatsappMessage, setWhatsappMessage] = useState('');
  const [fulfillmentConfirmation, setFulfillmentConfirmation] = useState('');
  
  // Screenshot upload & analysis states
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanAlert, setScanAlert] = useState<string | null>(null);
  const [scanSuccessMsg, setScanSuccessMsg] = useState<string | null>(null);

  // Fetch registered OSU items
  const fetchOsuList = async () => {
    setOsuLoading(true);
    try {
      const res = await fetch('/api/osu');
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
      const res = await fetch('/api/osu', {
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
      const res = await fetch('/api/osu', {
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

  // Process manual or dropped files
  const processScreenshotFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file (PNG, JPG, WEBP) as a screenshot.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setScreenshot(reader.result);
        setScanSuccessMsg('Screenshot attached! Click "Scan Screenshot" below to automatically transcribe and populate the text field.');
        setScanAlert(null);
        setError(null);
      }
    };
    reader.onerror = () => {
      setError('Failed to read visual screenshot file.');
    };
    reader.readAsDataURL(file);
  };

  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processScreenshotFile(file);
  };

  const clearScreenshot = () => {
    setScreenshot(null);
    setScanAlert(null);
    setScanSuccessMsg(null);
  };

  // Fetch logistics data on initialization
  useEffect(() => {
    fetchOsuList();
  }, []);

  // Listen to keyboard clipboard pastes (Ctrl+V / Cmd+V) to seamlessly capture WhatsApp screenshots
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            processScreenshotFile(file);
            // Switch tab/mode to screenshot if they paste an image!
            setWhatsappInputMode('screenshot');
            setActiveTab('auditor');
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Trigger Gemini Vision transcription on the server
  const scanScreenshot = async () => {
    if (!screenshot) return;
    setIsScanning(true);
    setScanAlert(null);
    setScanSuccessMsg(null);
    setError(null);

    try {
      const response = await fetch('/api/scan-screenshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageBase64: screenshot,
          mimeType: screenshot.split(';')[0].split(':')[1] || 'image/png',
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Server was unable to transcribe. Status: ${response.status}`);
      }

      const data = await response.json();
      if (data.text) {
        setWhatsappMessage(data.text);
        setScanSuccessMsg('Successfully scanned screenshot! Extracted order data is loaded into the text field below.');
        setWhatsappInputMode('text'); // Switch automatically so they see and can edit the extracted text!
      } else {
        setScanAlert('No readable text could be detected inside this image. Please ensure the screenshot is high resolution and readable.');
      }
    } catch (err: any) {
      console.error(err);
      setScanAlert(err.message || 'An error occurred while calling the Gemini scanner.');
    } finally {
      setIsScanning(false);
    }
  };
  
  // Loading states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationTime, setVerificationTime] = useState<number | null>(null);

  // Verification engine mode: 'fast' = text engine (< 200ms), 'ai' = Gemini (~60s)
  const [verificationMode, setVerificationMode] = useState<'fast' | 'ai'>('fast');
  
  // Active verify results (the client receives full AuditRecord back from server)
  const [result, setResult] = useState<AuditRecord | null>(null);

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

  const handleCustomChange = (type: 'whatsapp' | 'fulfillment', value: string) => {
    if (type === 'whatsapp') {
      setWhatsappMessage(value);
    } else {
      setFulfillmentConfirmation(value);
    }
  };

  // Quick helper to auto-populate test cases
  const applySampleData = (caseType: 'perfect' | 'discrepancy_qty' | 'discrepancy_extra' | 'vaccine_diluent_mismatch' | 'vaccine_dropper_mismatch') => {
    setError(null);
    setResult(null);
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

  const verifyOrder = async () => {
    if (!whatsappMessage.trim() || !fulfillmentConfirmation.trim()) {
      setError('Please provide text for both WhatsApp Message and Fulfillment Confirmation.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setPromptedItems([]);
    setVerificationTime(0);

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Number(((Date.now() - startTime) / 1000).toFixed(1));
      setVerificationTime(elapsed);
    }, 100);

    try {
      const endpoint = verificationMode === 'fast' ? '/api/verify-fast' : '/api/verify';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          whatsappMessage,
          fulfillmentConfirmation,
        }),
      });

      clearInterval(interval);

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || `Server returned error status ${response.status}`);
      }

      const json = await response.json();
      setResult(json);
      
      const finalTime = Number(((Date.now() - startTime) / 1000).toFixed(2));
      setVerificationTime(finalTime);
      setLoading(false);
    } catch (err: any) {
      clearInterval(interval);
      console.error(err);
      setError(err.message || 'An unexpected error occurred while communicating with the AI verification engine.');
      setLoading(false);
    }
  };

  // Dispatch discrepancy resolution logic
  const submitResolution = async () => {
    if (!selectedAuditForResolution) return;
    if (!resolutionActionNotes.trim()) {
      alert('Please specify the clinical corrections or resolution notes taken before launching.');
      return;
    }

    setSubmittingResolution(true);
    
    // Clear all discrepancy-related input fields immediately upon successful resolution
    setWhatsappMessage('');
    setFulfillmentConfirmation('');
    setScreenshot(null);
    setScanSuccessMsg(null);
    setScanAlert(null);

    const updatedResult: AuditRecord = {
      ...selectedAuditForResolution,
      status: 'resolved',
      resolutionNotes: resolutionActionNotes,
      resolvedAt: new Date().toISOString()
    };
    setResult(updatedResult);
    setSelectedAuditForResolution(null);
    setResolutionActionNotes('');
    setSubmittingResolution(false);
  };

  // Confirm perfect match logs and clean up visual inputs so operator can run the next dispatch immediately
  const handleLogApprovedDispatch = () => {
    setWhatsappMessage('');
    setFulfillmentConfirmation('');
    setScreenshot(null);
    setScanSuccessMsg(null);
    setScanAlert(null);
    setResult(null);
  };



  const getStatusColor = (status: string) => {
    switch (status) {
      case 'match':
        return {
          bg: 'bg-green-100 text-green-800 border-green-200',
          dot: 'bg-green-500',
          border: 'border-green-200',
          leftBorder: 'border-l-green-500'
        };
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
          bg: 'bg-rose-200 text-rose-950 border-rose-300 animate-pulse',
          dot: 'bg-rose-600',
          border: 'border-rose-300',
          leftBorder: 'border-l-rose-600'
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
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased flex flex-col">
      
      {/* Header */}
      <header className="bg-slate-900 text-white py-3.5 px-6 border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-slate-700 p-2 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-slate-200" />
            </div>
            <div>
              <h1 id="app-title" className="text-base font-bold tracking-tight text-white">
                OrderCheck
              </h1>
              <p className="text-[11px] text-slate-400">Zipline Ghana — Dispatch Discrepancy Auditing</p>
            </div>
          </div>
          
          {/* Operator Badge */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center font-bold text-xs text-slate-200">
              G
            </div>
            <span className="text-xs text-slate-300 font-medium">Ghana CCC team</span>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-slate-200 sticky top-[61px] z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1">
          <button
            onClick={() => setActiveTab('auditor')}
            className={`py-3.5 px-4 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'auditor'
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            Compliance Auditor
          </button>
          
          <button
            onClick={() => setActiveTab('extension')}
            className={`py-3.5 px-4 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'extension'
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            Chrome Extension
          </button>
        </div>
      </div>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6" id="main-content">
        
        {/* COMPLIANCE AUDITOR ACTIVE TAB VIEW */}
        {activeTab === 'auditor' && (
          <div className="space-y-5 animate-in fade-in duration-200">

            {/* Presets Row */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-slate-700 block">Test scenarios</span>
                <span className="text-xs text-slate-500 block">Load a sample order to verify discrepancy detection:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applySampleData('perfect')}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded-lg transition cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                  Perfect Match
                </button>
                <button
                  type="button"
                  onClick={() => applySampleData('discrepancy_qty')}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded-lg transition cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span>
                  Qty Mismatch
                </button>
                <button
                  type="button"
                  onClick={() => applySampleData('discrepancy_extra')}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded-lg transition cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0"></span>
                  Extra Item
                </button>
                <button
                  type="button"
                  onClick={() => applySampleData('vaccine_diluent_mismatch')}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded-lg transition cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
                  Diluent Missing
                </button>
                <button
                  type="button"
                  onClick={() => applySampleData('vaccine_dropper_mismatch')}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded-lg transition cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
                  Dropper Missing
                </button>
              </div>
            </div>

            {/* Inputs Layout */}
            <div id="editor-grid" className="grid md:grid-cols-2 gap-5">
              
              {/* Customer Input Column */}
              <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-4">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <label htmlFor="whatsapp-input" className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <MessageSquare size={15} className="text-slate-400" />
                    WhatsApp Order Message
                  </label>
                </div>

                {/* Input mode toggle */}
                <div className="flex bg-slate-100 p-1 rounded-lg gap-1">
                  <button
                    type="button"
                    onClick={() => setWhatsappInputMode('text')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      whatsappInputMode === 'text'
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Paste Text
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhatsappInputMode('screenshot')}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      whatsappInputMode === 'screenshot'
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Image className="w-3.5 h-3.5" />
                    Scan Screenshot
                  </button>
                </div>

                {/* Screenshot interface */}
                {whatsappInputMode === 'screenshot' && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                        <Image className="w-3.5 h-3.5 text-slate-400" />
                        Scan WhatsApp Screenshot
                      </span>
                      {screenshot && (
                        <button 
                          onClick={clearScreenshot}
                          className="text-[11px] text-rose-500 hover:text-rose-700 font-medium flex items-center gap-1 transition-all cursor-pointer"
                        >
                          <Trash className="w-3 h-3" />
                          Remove
                        </button>
                      )}
                    </div>

                    {!screenshot ? (
                      <label className="border border-dashed border-slate-300 hover:border-slate-400 bg-white rounded-lg p-4 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all">
                        <input 
                          type="file" 
                          className="hidden" 
                          accept="image/*" 
                          onChange={handleScreenshotUpload} 
                        />
                        <Upload className="w-5 h-5 text-slate-400 mb-0.5" />
                        <span className="text-xs font-medium text-slate-600">Click or drag screenshot here</span>
                        <span className="text-[11px] text-slate-400">Supports clipboard pasting (Ctrl+V)</span>
                      </label>
                    ) : (
                      <div className="flex gap-3 items-center bg-white p-2.5 rounded-lg border border-slate-200">
                        <img 
                          src={screenshot} 
                          alt="WhatsApp Order Screenshot" 
                          className="w-14 h-14 object-cover rounded-lg border border-slate-200 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-slate-500 truncate">WhatsApp_screenshot.png</p>
                          <button
                            onClick={scanScreenshot}
                            disabled={isScanning}
                            className="mt-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                          >
                            {isScanning ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Scanning...
                              </>
                            ) : (
                              <>
                                <Image className="w-3 h-3" />
                                Scan Screenshot
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {scanAlert && (
                      <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 p-2 rounded-lg flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                        <span>{scanAlert}</span>
                      </div>
                    )}
                    {scanSuccessMsg && !scanAlert && (
                      <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 p-2 rounded-lg flex items-start gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{scanSuccessMsg}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="relative flex-1 flex flex-col gap-1.5">
                  <textarea
                    id="whatsapp-input"
                    className="w-full h-56 max-h-80 p-3.5 rounded-lg border border-slate-200 focus:border-slate-400 focus:ring-1 focus:ring-slate-300 bg-white font-mono text-xs sm:text-sm text-slate-700 placeholder:text-slate-400 leading-relaxed outline-none transition-all"
                    placeholder="e.g. Kwame Mensah&#10;Phone: 0244123456&#10;Please dispatch 20 units of ACT tabs..."
                    value={whatsappMessage}
                    onChange={(e) => handleCustomChange('whatsapp', e.target.value)}
                  />
                </div>

                <div className="text-[11px] text-slate-500 flex items-center gap-2">
                  <span>Supports Ghana abbreviation aliases like <span className="font-semibold text-slate-600">PCM</span>, <span className="font-semibold text-slate-600">AL</span>, and <span className="font-semibold text-slate-600">ORS</span>.</span>
                </div>
              </div>

              {/* Fulfillment Input Column */}
              <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <label htmlFor="fulfillment-input" className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <ClipboardCheck size={15} className="text-slate-400" />
                    Fulfillment Confirmation
                  </label>
                </div>
                  
                <div className="relative flex-1">
                  <textarea
                    id="fulfillment-input"
                    className="w-full h-56 max-h-80 p-3.5 rounded-lg border border-slate-200 focus:border-slate-400 focus:ring-1 focus:ring-slate-300 bg-white font-mono text-xs sm:text-sm text-slate-700 placeholder:text-slate-400 leading-relaxed outline-none transition-all"
                    placeholder="e.g. FULFILMENT RECIPIENT: Kwame Mensah&#10;Supplies prepared: Coartem - 20 units..."
                    value={fulfillmentConfirmation}
                    onChange={(e) => handleCustomChange('fulfillment', e.target.value)}
                  />
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-2">
                  <span>Automatically maps standardized generic names before comparison.</span>
                </div>
              </div>

              </div>

              {/* Engine Mode Toggle + Verify Button */}
              <div className="space-y-3">
                {/* Mode selector */}
                <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                  <button
                    id="mode-fast"
                    onClick={() => setVerificationMode('fast')}
                    disabled={loading}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-semibold transition-all cursor-pointer ${
                      verificationMode === 'fast'
                        ? 'bg-slate-800 text-white shadow-md'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <Zap className="w-4 h-4" />
                    Fast Check
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                      verificationMode === 'fast' ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-500'
                    }`}>{'< 1s'}</span>
                  </button>
                  <button
                    id="mode-ai"
                    onClick={() => setVerificationMode('ai')}
                    disabled={loading}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-semibold transition-all cursor-pointer ${
                      verificationMode === 'ai'
                        ? 'bg-slate-800 text-white shadow-md'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <Brain className="w-4 h-4" />
                    AI Deep Check
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                      verificationMode === 'ai' ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-500'
                    }`}>~60s</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 text-center">
                  {verificationMode === 'fast'
                    ? 'Fast mode uses rule-based text analysis — instant results, ideal for standard orders.'
                    : 'AI mode uses Gemini for complex or ambiguous orders — thorough but slower.'}
                </p>

                {/* Verify Button */}
                <div className="flex justify-end pt-2">
                  <button
                    onClick={verifyOrder}
                    disabled={loading}
                    id="verify-button"
                    className="bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 px-8 rounded-lg transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 text-sm cursor-pointer shadow-sm hover:shadow"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        {verificationMode === 'fast' ? 'Analysing...' : 'Auditing order...'}
                        {verificationTime !== null && verificationTime > 0 ? ` (${verificationTime.toFixed(1)}s)` : ''}
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-white" />
                        Run Verification
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Error Banner */}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-3.5 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">Verification Error</p>
                    <p className="text-xs text-red-600 mt-0.5">{error}</p>
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
                    
                    {/* Verdict Card */}
                    <div className={`p-5 rounded-xl border-l-4 border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white ${
                      result.allMatch 
                        ? 'border-slate-200 border-l-emerald-500' 
                        : 'border-slate-200 border-l-red-500'
                    }`}>
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg shrink-0 flex items-center justify-center ${
                          result.allMatch ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                        }`}>
                          {result.allMatch ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-800 text-base leading-tight flex items-center gap-2 flex-wrap">
                            {result.verdict}
                            {(result as any).engine === 'text' ? (
                              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">Fast</span>
                            ) : (
                              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">AI</span>
                            )}
                            {verificationTime !== null && (
                              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {verificationTime}s
                              </span>
                            )}
                          </h3>
                          <p className="text-xs text-slate-500 mt-1">
                            {result.allMatch 
                              ? 'All parameters verified — order is clear to dispatch.'
                              : `${result.issueCount} issue${result.issueCount > 1 ? 's' : ''} found — review before dispatch.`
                            }
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <span className={`text-[11px] font-semibold px-3 py-1.5 rounded-full ${
                          result.allMatch ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {result.allMatch ? 'Approved' : 'On Hold'}
                        </span>
                        {result.allMatch ? (
                          <button
                            type="button"
                            onClick={handleLogApprovedDispatch}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 w-full sm:w-auto justify-center"
                          >
                            <CheckSquare className="w-3.5 h-3.5" />
                            Confirm & Clear
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAuditForResolution(result);
                              setResolutionActionNotes('');
                            }}
                            className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-all cursor-pointer w-full sm:w-auto"
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Three Column Details Grid */}
                    <div className="grid lg:grid-cols-3 gap-5">

                      {/* Left side — item table */}
                      <div className="lg:col-span-2 space-y-3">
                        <div className="flex justify-between items-center bg-white px-4 py-3 rounded-lg border border-slate-200">
                          <span className="text-xs font-semibold text-slate-600">
                            Item Comparison
                          </span>
                          <span className="text-xs text-slate-400">
                            {result.items.length} item{result.items.length !== 1 ? 's' : ''}
                          </span>
                        </div>

                        <div className="space-y-2">
                          {result.items.map((item, idx) => {
                            const colors = getStatusColor(item.status);
                            return (
                              <div 
                                key={`item-${item.name}-${idx}`} 
                                className={`bg-white border ${colors.border} ${colors.leftBorder} border-l-4 rounded-lg p-4 flex flex-col gap-3 transition-all`}
                              >
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 w-full">
                                  <div className="space-y-1.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="font-semibold text-slate-800 text-sm leading-none">{item.name}</h4>
                                      {item.category && (
                                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${getCategoryBadgeStyle(item.category).bg}`}>
                                          {getCategoryBadgeStyle(item.category).label}
                                        </span>
                                      )}
                                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${colors.bg}`}>
                                        {item.status}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                                      <span className="text-slate-400">Requested: <span className="text-slate-700 font-medium">{item.requested}</span></span>
                                      <span className="text-slate-300">·</span>
                                      <span className="text-slate-400">Found: <span className="text-slate-700 font-medium">{item.found}</span></span>
                                    </div>
                                  </div>

                                  {item.action && (
                                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-start gap-2 max-w-sm w-full">
                                      <HelpCircle className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                                      <span className="text-xs text-slate-600 leading-snug">{item.action}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Order Limit Prompt */}
                                {item.status === 'quantity mismatch' && !promptedItems.includes(item.name) && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="bg-amber-50 p-3.5 rounded-lg border border-amber-200 text-left w-full"
                                  >
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                      <div className="space-y-1 max-w-md">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                          <span>Order Limit Verification</span>
                                        </div>
                                        <p className="text-[11px] text-slate-600 leading-normal">
                                          Is this subject to an <strong>order limit of {item.found} units</strong> rather than a packing error?
                                        </p>
                                      </div>
                                      
                                      <div className="flex gap-2 w-full sm:w-auto shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => handleDeclineOrderLimit(item)}
                                          className="flex-1 sm:flex-initial bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 py-1.5 px-3 rounded-lg text-xs font-medium transition cursor-pointer"
                                        >
                                          No, Discrepancy
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => confirmOrderLimit(item)}
                                          className="flex-1 sm:flex-initial bg-slate-800 hover:bg-slate-700 text-white py-1.5 px-3 rounded-lg text-xs font-medium transition cursor-pointer"
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

                      {/* Right side — stats & insights */}
                      <div className="space-y-4">

                        {/* Confidence Score */}
                        <div className="bg-white p-5 rounded-lg border border-slate-200 flex flex-col items-center text-center">
                          <span className="text-xs font-medium text-slate-500 mb-4">Confidence Score</span>
                          
                          <div className="relative flex items-center justify-center">
                            <svg className="w-28 h-28 transform -rotate-90">
                              <circle
                                cx="56"
                                cy="56"
                                r="46"
                                stroke="#e2e8f0"
                                strokeWidth="7"
                                fill="transparent"
                              />
                              <circle
                                cx="56"
                                cy="56"
                                r="46"
                                stroke={result.confidence >= 90 ? '#10b981' : result.confidence >= 75 ? '#f59e0b' : '#ef4444'}
                                strokeWidth="7"
                                fill="transparent"
                                strokeDasharray={2 * Math.PI * 46}
                                strokeDashoffset={2 * Math.PI * 46 * (1 - result.confidence / 100)}
                                strokeLinecap="round"
                                className="transition-all duration-700 ease-out"
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className={`text-2xl font-bold ${getConfidenceLevelColor(result.confidence)}`}>
                                {result.confidence}%
                              </span>
                              <span className="text-[10px] text-slate-400">match</span>
                            </div>
                          </div>

                          <p className="text-xs text-slate-400 leading-relaxed mt-3 max-w-[180px]">
                            Cross-checked from items, phone numbers, and facility names.
                          </p>
                        </div>

                        {/* Metadata checks */}
                        <div className="bg-white p-5 rounded-lg border border-slate-200 space-y-4">
                          <h4 className="text-xs font-semibold text-slate-600">Header Fields</h4>

                          <div className="space-y-4">
                            <div className="text-[10px] font-medium text-slate-400 uppercase px-2 py-1 bg-slate-50 rounded border border-slate-100 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Required
                            </div>

                            {/* Date Row */}
                            {result.meta.date && (
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between items-center">
                                  <span className="text-slate-600 font-semibold flex items-center gap-2">
                                    <Calendar size={13} className="text-slate-400" /> Date
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded-full font-bold uppercase text-[9px] border ${
                                    result.meta.date.status === 'match' 
                                      ? 'bg-green-100 text-green-800 border-green-200' 
                                      : 'bg-red-100 text-red-800 border-red-200'
                                  }`}>
                                    {result.meta.date.status.toUpperCase()}
                                  </span>
                                </div>
                                <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 flex flex-col gap-0.5 text-[11px] font-mono">
                                  <div className="flex justify-between"><span className="text-slate-400">WhatsApp:</span> <span className="text-slate-700 font-medium">{result.meta.date.whatsappValue || '(none)'}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-400">System:</span> <span className="text-slate-700 font-medium">{result.meta.date.fulfillmentValue || '(none)'}</span></div>
                                </div>
                              </div>
                            )}

                            {/* Customer Name Row */}
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-600 font-semibold flex items-center gap-2">
                                <User size={13} className="text-slate-400" /> Name of Orderer
                              </span>
                              <span className={`px-1.5 py-0.5 rounded-full font-bold uppercase text-[9px] border ${
                                result.meta.customerName.status === 'match' 
                                  ? 'bg-green-100 text-green-800 border-green-200' 
                                  : 'bg-red-10 border-red-200 text-red-800'
                              }`}>
                                {result.meta.customerName.status.toUpperCase()}
                              </span>
                            </div>
                            <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 flex flex-col gap-0.5 text-[11px] font-mono">
                              <div className="flex justify-between"><span className="text-slate-400">WhatsApp:</span> <span className="text-slate-700 font-medium">{result.meta.customerName.whatsappValue || '(none)'}</span></div>
                              <div className="flex justify-between"><span className="text-slate-400">System:</span> <span className="text-slate-700 font-medium">{result.meta.customerName.fulfillmentValue || '(none)'}</span></div>
                            </div>
                          </div>

                          {/* Phone Number Row */}
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-600 font-semibold flex items-center gap-2">
                                <Phone size={13} className="text-slate-400" /> Contact Phone
                              </span>
                              <span className={`px-1.5 py-0.5 rounded-full font-bold uppercase text-[9px] border ${
                                result.meta.phone.status === 'match' 
                                  ? 'bg-green-100 text-green-800 border-green-200' 
                                  : 'bg-red-100 text-red-800 border-red-200'
                              }`}>
                                {result.meta.phone.status.toUpperCase()}
                              </span>
                            </div>
                            <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 flex flex-col gap-0.5 text-[11px] font-mono">
                              <div className="flex justify-between"><span className="text-slate-400">WhatsApp:</span> <span className="text-slate-700 font-medium">{result.meta.phone.whatsappValue || '(none)'}</span></div>
                              <div className="flex justify-between"><span className="text-slate-400">System:</span> <span className="text-slate-700 font-medium">{result.meta.phone.fulfillmentValue || '(none)'}</span></div>
                            </div>
                          </div>

                          {/* Facility Name Row */}
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-600 font-semibold flex items-center gap-2">
                                <MapPin size={13} className="text-slate-400" /> Name of Health Facility
                              </span>
                              <span className={`px-1.5 py-0.5 rounded-full font-bold uppercase text-[9px] border ${
                                result.meta.facility.status === 'match' 
                                  ? 'bg-green-100 text-green-800 border-green-200' 
                                  : 'bg-amber-100 text-amber-800 border-amber-200'
                              }`}>
                                {result.meta.facility.status.toUpperCase()}
                              </span>
                            </div>
                            <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 flex flex-col gap-0.5 text-[11px] font-mono">
                              <div className="flex justify-between"><span className="text-slate-400">WhatsApp:</span> <span className="text-slate-700 font-medium">{result.meta.facility.whatsappValue || '(none)'}</span></div>
                              <div className="flex justify-between"><span className="text-slate-400">System:</span> <span className="text-slate-700 font-medium">{result.meta.facility.fulfillmentValue || '(none)'}</span></div>
                            </div>
                          </div>

                          {/* Close compulsory block's outer space-y-4 */}
                          </div>

                          {/* Optional metadata */}
                          <div className="space-y-4 pt-4 border-t border-slate-100">
                            <div className="text-[10px] font-medium text-slate-400 uppercase px-2 py-1 bg-slate-50 rounded border border-slate-100 flex justify-between items-center">
                              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span> Optional</span>
                              <span className="text-[10px] text-emerald-600 font-medium">Omission OK</span>
                            </div>

                            {/* Drop Area Row */}
                            {result.meta.dropArea && (result.meta.dropArea.whatsappValue !== 'N/A' || result.meta.dropArea.fulfillmentValue !== 'N/A') && (
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between items-center">
                                  <span className="text-slate-600 font-semibold flex items-center gap-2">
                                    <MapPin size={13} className="text-slate-400" /> Delivery / Drop area
                                  </span>
                                  <span className="bg-green-50 text-green-600 border border-green-100 px-1.5 py-0.5 rounded-full font-bold uppercase text-[9px]">
                                    MATCH
                                  </span>
                                </div>
                                <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 flex flex-col gap-0.5 text-[11px] font-mono">
                                  <div className="flex justify-between"><span className="text-slate-400">WhatsApp:</span> <span className="text-slate-700 font-medium">{result.meta.dropArea.whatsappValue || '(none)'}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-400">System:</span> <span className="text-slate-700 font-medium">{result.meta.dropArea.fulfillmentValue || '(none)'}</span></div>
                                </div>
                              </div>
                            )}

                            {/* District Row */}
                            {result.meta.district && (result.meta.district.whatsappValue !== 'N/A' || result.meta.district.fulfillmentValue !== 'N/A') && (
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between items-center">
                                  <span className="text-slate-600 font-semibold flex items-center gap-2">
                                    <MapPin size={13} className="text-slate-400" /> District
                                  </span>
                                  <span className="bg-green-50 text-green-600 border border-green-100 px-1.5 py-0.5 rounded-full font-bold uppercase text-[9px]">
                                    MATCH
                                  </span>
                                </div>
                                <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 flex flex-col gap-0.5 text-[11px] font-mono">
                                  <div className="flex justify-between"><span className="text-slate-400">WhatsApp:</span> <span className="text-slate-700 font-medium">{result.meta.district.whatsappValue || '(none)'}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-700 font-medium">{result.meta.district.fulfillmentValue || '(none)'}</span></div>
                                </div>
                              </div>
                            )}

                            {/* Preferred time for Delivery Row */}
                            {result.meta.deliveryTime && (result.meta.deliveryTime.whatsappValue !== 'N/A' || result.meta.deliveryTime.fulfillmentValue !== 'N/A') && (
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between items-center">
                                  <span className="text-slate-600 font-semibold flex items-center gap-2">
                                    <Clock size={13} className="text-slate-400" /> Preferred time for Delivery
                                  </span>
                                  <span className="bg-green-50 text-green-600 border border-green-100 px-1.5 py-0.5 rounded-full font-bold uppercase text-[9px]">
                                    MATCH
                                  </span>
                                </div>
                                <div className="bg-slate-50/50 p-2 rounded-lg border border-slate-100 flex flex-col gap-0.5 text-[11px] font-mono">
                                  <div className="flex justify-between"><span className="text-slate-400">WhatsApp:</span> <span className="text-slate-700 font-medium">{result.meta.deliveryTime.whatsappValue || '(none)'}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-700 font-medium">{result.meta.deliveryTime.fulfillmentValue || '(none)'}</span></div>
                                </div>
                              </div>
                            )}
                          </div>

                        </div>

                        {/* Insights */}
                        <div className="bg-slate-800 text-slate-100 p-5 rounded-lg">
                          <h4 className="text-xs font-semibold text-slate-300 mb-3">Audit Notes</h4>

                          <ul className="text-xs space-y-2.5 leading-relaxed">
                            {result.insights.map((note, idx) => (
                              <li key={`insight-${idx}`} className="flex gap-2.5 items-start">
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                                <span className="text-slate-300">{note}</span>
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


        {/* CHROME EXTENSION TAB */}
        {activeTab === 'extension' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-white rounded-xl p-6 border border-slate-200 space-y-6"
          >
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <PlusCircle className="text-slate-400 w-4 h-4" />
                Chrome Extension Companion
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Install the companion extension to capture WhatsApp Web orders directly and verify them without leaving your browser.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              
              <div className="md:col-span-2 space-y-5">
                
                {/* Download Card */}
                <div className="bg-slate-800 text-white p-5 rounded-xl flex flex-col sm:flex-row justify-between items-center gap-4">
                  <div className="space-y-1 text-center sm:text-left">
                    <span className="text-[10px] uppercase font-mono text-slate-400 tracking-wider block">Pre-configured package</span>
                    <h3 className="text-base font-semibold text-white">OrderCheck Extension</h3>
                    <p className="text-xs text-slate-400">
                      Connects automatically to this portal — no manual configuration required.
                    </p>
                  </div>
                  <a
                    href="/api/download-extension"
                    className="bg-white text-slate-800 hover:bg-slate-100 px-5 py-2.5 rounded-lg font-semibold text-xs cursor-pointer shrink-0 flex items-center gap-2 transition"
                  >
                    <Download className="w-4 h-4" />
                    Download ZIP
                  </a>
                </div>

                {/* Install Steps */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-slate-700">Installation steps</h3>
                  <div className="divide-y divide-slate-100 text-xs text-slate-600 leading-relaxed border border-slate-200 rounded-lg bg-slate-50 p-4 space-y-2">
                    <p className="pb-2"><b>1. Download:</b> Click the button above to get the extension ZIP.</p>
                    <p className="py-2"><b>2. Unzip:</b> Extract the folder to a local directory.</p>
                    <p className="py-2"><b>3. Open Chrome:</b> Navigate to <code>chrome://extensions/</code>.</p>
                    <p className="py-2"><b>4. Enable Dev Mode:</b> Toggle "Developer mode" in the top right.</p>
                    <p className="pt-2"><b>5. Load Extension:</b> Click "Load unpacked" and select the extracted folder.</p>
                  </div>
                </div>

              </div>

              <div className="space-y-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <h3 className="font-semibold text-xs text-slate-500 mb-2 flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    manifest.json
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
                </div>
              </div>

            </div>
          </motion.div>
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
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col"
            >
              <div className="bg-slate-800 text-white p-5 flex justify-between items-center">
                <div>
                  <span className="text-[10px] text-slate-400 font-mono">{selectedAuditForResolution.id}</span>
                  <h3 className="font-semibold text-base mt-0.5">Discrepancy Resolution</h3>
                </div>
                <button 
                  onClick={() => setSelectedAuditForResolution(null)} 
                  className="text-slate-400 hover:text-white transition cursor-pointer text-lg leading-none"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4 text-xs overflow-y-auto max-h-[70vh]">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed text-slate-600 text-xs">
                  <span className="font-semibold text-slate-700 block mb-1">Flagged Issue:</span>
                  {selectedAuditForResolution.verdict}
                </div>

                <div className="space-y-1">
                  <span className="font-semibold text-slate-700">Unmatched Items:</span>
                  <div className="divide-y divide-slate-100 font-mono text-[11px] bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    {selectedAuditForResolution.items.filter(it => it.status !== 'match' && it.status !== 'out of stock').map((it, idx) => (
                      <div key={`unmatched-${it.name}-${idx}`} className="py-1.5 flex flex-wrap justify-between items-center gap-1">
                        <div className="flex items-center gap-1.5">
                          {it.category && (
                            <span className="text-[10px] font-medium uppercase bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                              {it.category}
                            </span>
                          )}
                          <span className="text-slate-600 font-medium">{it.name}:</span>
                        </div>
                        <span className="text-red-600 font-medium text-right">{it.action || it.status}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="resolution-notes-input" className="font-semibold text-slate-700 block">
                    Correction Notes:
                  </label>
                  <textarea
                    id="resolution-notes-input"
                    rows={4}
                    value={resolutionActionNotes}
                    onChange={(e) => setResolutionActionNotes(e.target.value)}
                    className="w-full p-3 rounded-lg border border-slate-200 focus:ring-1 focus:ring-slate-400 focus:border-slate-400 outline-none text-slate-700 leading-relaxed font-sans text-xs"
                    placeholder="e.g. Corrected paracetamol cards from 5 to 10. Re-packed with RDT kits and authorized dispatch."
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-2 justify-end">
                <button
                  onClick={() => setSelectedAuditForResolution(null)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-lg font-medium text-slate-600 hover:bg-slate-50 cursor-pointer text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={submitResolution}
                  disabled={submittingResolution}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg cursor-pointer transition flex items-center gap-1.5 disabled:opacity-50 text-sm"
                >
                  {submittingResolution ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      Approve & Log
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
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-6 right-6 z-50 bg-slate-800 text-white font-medium p-4 rounded-xl shadow-xl flex items-center gap-2.5"
          >
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs">
              Order limit applied for <strong>{lastConfirmedItemName}</strong>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-5 px-6 mt-8 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
          <p>© 2026 Zipline. Internal dispatch discrepancy auditing — Zipline Ghana Customer Care.</p>
          <div className="flex gap-4">
            <span>Security Protocol 32</span>
            <span>·</span>
            <span>Discrepancy Control</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
