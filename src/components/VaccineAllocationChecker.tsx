/**
 * Vaccine Allocation Validation & Checker Component
 * Implements Steps 1 - 9 of the CCA Vaccine Workflow:
 * Facility Selection -> View Allocation -> Order Source -> Parse & Scan -> Cross Validation -> Green Light / Errors -> Review & Atomic Confirm
 */

import React, { useState, useEffect } from 'react';
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
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FacilityAllocation, VaccineValidationResult, VaccineValidationItem, VaccineAllocationItem } from '../types';

interface VaccineAllocationCheckerProps {
  onNavigateToTracker?: () => void;
  onNavigateToHistory?: () => void;
}

export default function VaccineAllocationChecker({
  onNavigateToTracker,
  onNavigateToHistory
}: VaccineAllocationCheckerProps) {
  // Facilities state
  const [facilities, setFacilities] = useState<FacilityAllocation[]>([]);
  const [loadingFacilities, setLoadingFacilities] = useState(false);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string>('');
  const [facilitySearch, setFacilitySearch] = useState('');
  const [isFacilityDropdownOpen, setIsFacilityDropdownOpen] = useState(false);

  // Workflow states
  const [orderSource, setOrderSource] = useState<'whatsapp' | 'fs_only'>('whatsapp');
  const [whatsappMessage, setWhatsappMessage] = useState('');
  const [fulfillmentConfirmation, setFulfillmentConfirmation] = useState('');
  const [ccaName, setCcaName] = useState('CCA Advocate');

  // Validation result states
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<VaccineValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Confirmation states
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmationSuccess, setConfirmationSuccess] = useState<any | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);

  // Fetch facilities on load
  const fetchFacilities = async () => {
    setLoadingFacilities(true);
    try {
      const res = await fetch('/api/vaccine/allocations');
      if (res.ok) {
        const data = await res.json();
        setFacilities(data);
        if (data.length > 0 && !selectedFacilityId) {
          setSelectedFacilityId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load facilities:', err);
    } finally {
      setLoadingFacilities(false);
    }
  };

  useEffect(() => {
    fetchFacilities();
  }, []);

  const selectedFacility = facilities.find(f => f.id === selectedFacilityId);

  // Perform Validation
  const handleValidate = async () => {
    if (!selectedFacilityId) {
      setValidationError('Please select a facility first.');
      return;
    }
    setValidating(true);
    setValidationError(null);
    setValidationResult(null);
    setConfirmationSuccess(null);
    setConfirmationError(null);

    try {
      const res = await fetch('/api/vaccine/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityId: selectedFacilityId,
          orderSource,
          whatsappMessage,
          fulfillmentConfirmation
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to validate order');
      }

      const data: VaccineValidationResult = await res.json();
      setValidationResult(data);
    } catch (err: any) {
      setValidationError(err.message || 'Validation service communication failure.');
    } finally {
      setValidating(false);
    }
  };

  // Confirm Order & Update Allocation (Atomic Multi-CCA Safe)
  const handleConfirmOrder = async () => {
    if (!validationResult || !validationResult.isValid) return;
    setConfirming(true);
    setConfirmationError(null);

    try {
      const orderItems = validationResult.items
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
          rawOrderText: whatsappMessage,
          rawFsText: fulfillmentConfirmation
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Allocation update failed.');
      }

      setConfirmationSuccess(data.transaction);
      setShowReviewModal(false);
      // Refresh local facilities to show updated remaining allocation
      await fetchFacilities();
    } catch (err: any) {
      setConfirmationError(err.message || 'Failed to confirm transaction.');
    } finally {
      setConfirming(false);
    }
  };

  const filteredFacilities = facilities.filter(f =>
    f.facilityName.toLowerCase().includes(facilitySearch.toLowerCase()) ||
    (f.district && f.district.toLowerCase().includes(facilitySearch.toLowerCase())) ||
    (f.subDistrict && f.subDistrict.toLowerCase().includes(facilitySearch.toLowerCase())) ||
    (f.nest && f.nest.toLowerCase().includes(facilitySearch.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Operational Empty State when allocations have been cleared for a new cycle */}
      {facilities.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-10 text-center max-w-xl mx-auto flex flex-col items-center">
          <div className="w-16 h-16 rounded-3xl bg-purple-50 text-[#5C2D91] flex items-center justify-center mb-4 shadow-2xs">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider mb-2">
            Operational Mode Ready
          </span>
          <h3 className="text-lg font-black text-slate-900 tracking-tight mb-2">
            No Active Allocations Loaded
          </h3>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            Previous allocations have been cleared to pave the way for your new cycle. To begin validating and fulfilling live health facility orders, please upload the new DCO vaccine allocation workbook in the Allocation Tracker.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigateToTracker?.()}
              className="bg-[#5C2D91] hover:bg-[#482372] text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all shadow cursor-pointer flex items-center gap-2"
            >
              <Layers className="w-4 h-4" />
              Open Allocation Tracker &amp; Upload Sheet
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
          <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#5C2D91]/10 flex items-center justify-center text-[#5C2D91]">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">
                    Vaccine Allocation Validation &amp; Checker
                  </h2>
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Live Operational Mode
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  DCO Allocation &rarr; Customer Request &rarr; FS Entry &rarr; Validation &rarr; Allocation Update
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => onNavigateToTracker?.()}
                className="text-xs font-bold text-[#5C2D91] hover:text-[#482372] bg-purple-50 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="View or upload allocations in Tracker"
              >
                <Layers className="w-3.5 h-3.5" />
                Allocation Tracker
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
          {/* STEP 1: Searchable Facility Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-[#5C2D91] text-white text-[11px] font-black flex items-center justify-center">1</span>
                Select Facility
              </label>
              {selectedFacility && (
                <span className="text-xs text-slate-500">
                  District: <strong className="text-slate-800">{selectedFacility.district}</strong>
                  {selectedFacility.subDistrict && (
                    <> &bull; Sub-District: <strong className="text-indigo-700 font-bold">{selectedFacility.subDistrict}</strong></>
                  )}
                  {" "}| Cycle: <strong className="text-slate-800">{selectedFacility.cycle}</strong>
                </span>
              )}
            </div>

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
                    <div className="font-bold text-slate-900 text-sm">
                      {selectedFacility ? selectedFacility.facilityName : 'Select a facility...'}
                    </div>
                    {selectedFacility && (
                      <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                        <span>{selectedFacility.nest} &bull; {selectedFacility.district}</span>
                        {selectedFacility.subDistrict && (
                          <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-indigo-200">
                            {selectedFacility.subDistrict}
                          </span>
                        )}
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
                        placeholder="Search facility name, sub-district, district, or nest..."
                        value={facilitySearch}
                        onChange={e => setFacilitySearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:border-[#5C2D91]"
                        autoFocus
                      />
                    </div>
                  </div>

                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
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

          {/* STEP 2: Immediately Display Facility's Vaccine Allocation */}
          {selectedFacility && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#5C2D91] text-white text-[11px] font-black flex items-center justify-center">2</span>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Current Vaccine Allocation &bull; {selectedFacility.facilityName}
                  </h4>
                </div>
                <span className="text-xs text-slate-500 font-medium">
                  Cycle: {selectedFacility.cycle}
                </span>
              </div>

              {/* Allocation Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                      <th className="py-2.5 px-3">Vaccine / Product</th>
                      <th className="py-2.5 px-3 text-right">Original Allocated</th>
                      <th className="py-2.5 px-3 text-right">Adjustments</th>
                      <th className="py-2.5 px-3 text-right">Previously Taken</th>
                      <th className="py-2.5 px-3 text-right font-bold text-slate-900">Remaining Balance</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 font-medium">
                    {(Object.entries(selectedFacility.vaccines) as [string, VaccineAllocationItem][]).map(([vaccineName, alloc]) => {
                      const totalAlloc = alloc.original + (alloc.adjustment || 0);
                      const isExhausted = alloc.remaining <= 0;
                      const isLow = alloc.remaining > 0 && (alloc.remaining <= 5 || alloc.remaining / totalAlloc <= 0.2);

                      return (
                        <tr key={vaccineName} className="hover:bg-white/60 transition-colors">
                          <td className="py-2.5 px-3 font-bold text-slate-900 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-[#5C2D91]"></span>
                            {vaccineName}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600">{alloc.original}</td>
                          <td className="py-2.5 px-3 text-right text-slate-600">
                            {alloc.adjustment ? (
                              <span className={alloc.adjustment > 0 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                {alloc.adjustment > 0 ? `+${alloc.adjustment}` : alloc.adjustment}
                              </span>
                            ) : (
                              '0'
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600">{alloc.taken}</td>
                          <td className="py-2.5 px-3 text-right font-black text-sm">
                            <span className={isExhausted ? 'text-rose-600' : (isLow ? 'text-amber-600' : 'text-emerald-700')}>
                              {alloc.remaining}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {isExhausted ? (
                              <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                <XCircle className="w-3 h-3" /> Exhausted
                              </span>
                            ) : isLow ? (
                              <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3" /> Low
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                <CheckCircle2 className="w-3 h-3" /> Available
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
          )}

          {/* STEP 3: Order Source Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-[#5C2D91] text-white text-[11px] font-black flex items-center justify-center">3</span>
              Order Source
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOrderSource('whatsapp')}
                className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-all text-left cursor-pointer ${
                  orderSource === 'whatsapp'
                    ? 'border-[#5C2D91] bg-purple-50/50 shadow-sm ring-1 ring-[#5C2D91]'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  orderSource === 'whatsapp' ? 'bg-[#5C2D91] text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">1. WhatsApp Request</div>
                  <div className="text-[11px] text-slate-500">
                    Compares WhatsApp ↔ FS Entry ↔ Remaining Allocation
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setOrderSource('fs_only')}
                className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-all text-left cursor-pointer ${
                  orderSource === 'fs_only'
                    ? 'border-[#5C2D91] bg-purple-50/50 shadow-sm ring-1 ring-[#5C2D91]'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  orderSource === 'fs_only' ? 'bg-[#5C2D91] text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">2. No WhatsApp / FS Confirmation</div>
                  <div className="text-[11px] text-slate-500">
                    Compares FS Confirmation Entry ↔ Remaining Allocation
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* STEP 4 & 5: Paste / Enter Order & FS Logs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* WhatsApp input (Only required if orderSource === 'whatsapp') */}
            {orderSource === 'whatsapp' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-[#5C2D91] text-white text-[11px] font-black flex items-center justify-center">4</span>
                    Customer WhatsApp Order
                  </label>
                  <span className="text-[11px] text-slate-400">e.g. BCG - 20, OPV - 30</span>
                </div>
                <textarea
                  value={whatsappMessage}
                  onChange={e => setWhatsappMessage(e.target.value)}
                  placeholder="Paste WhatsApp customer message here...&#10;e.g.&#10;BCG - 20&#10;OPV - 30&#10;Penta - 10"
                  className="w-full h-36 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-mono text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] transition-all resize-none"
                />
              </div>
            ) : (
              <div className="h-36 p-4 bg-slate-50 border border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-center text-slate-400">
                <Info className="w-6 h-6 mb-1 text-slate-400" />
                <div className="text-xs font-bold text-slate-700">No WhatsApp Message Required</div>
                <div className="text-[11px] text-slate-500 max-w-xs mt-1">
                  Validating directly from the Fulfilment System (FS) confirmation message against the facility allocation.
                </div>
              </div>
            )}

            {/* FS Confirmation Entry */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-[#5C2D91] text-white text-[11px] font-black flex items-center justify-center">5</span>
                  Fulfillment System (FS) Confirmation
                </label>
                <span className="text-[11px] text-slate-400">FS packing log / dispatch list</span>
              </div>
              <textarea
                value={fulfillmentConfirmation}
                onChange={e => setFulfillmentConfirmation(e.target.value)}
                placeholder="Paste FS confirmation message or order confirmation...&#10;e.g.&#10;Facility: Karaga District Hospital&#10;BCG - 20&#10;OPV - 30"
                className="w-full h-36 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-mono text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] transition-all resize-none"
              />
            </div>
          </div>

          {/* Validation Action Button */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Full cross-check on facility, vaccines, quantities, and remaining limits</span>
            </div>

            <button
              type="button"
              onClick={handleValidate}
              disabled={validating || !selectedFacilityId}
              className="w-full sm:w-auto bg-[#5C2D91] hover:bg-[#482372] disabled:bg-slate-300 text-white font-bold text-sm px-6 py-3 rounded-2xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              {validating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Validating Allocations...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  Validate Vaccine Order
                </>
              )}
            </button>
          </div>

          {/* General Communication / Validation Error */}
          {validationError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-800 text-xs">
              <XCircle className="w-5 h-5 flex-shrink-0 text-rose-600" />
              <span>{validationError}</span>
            </div>
          )}

          {/* STEP 6 & 7: VALIDATION RESULTS SCREEN */}
          {validationResult && (
            <div className="space-y-4 pt-4 border-t border-slate-200 animate-in fade-in duration-200">
              {/* Overall Status Banner (Section 9) */}
              {validationResult.isValid ? (
                <div className="p-5 bg-emerald-500 text-white rounded-2xl shadow-md flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-7 h-7" />
                    </div>
                    <div>
                      <div className="text-base font-black tracking-wide uppercase flex items-center gap-2">
                        <span>🟢 GREEN LIGHT – ORDER VALIDATED</span>
                      </div>
                      <div className="text-xs text-emerald-100 font-medium mt-0.5">
                        All vaccine products and quantities have been successfully verified against the DCO allocation.
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowReviewModal(true)}
                    className="bg-white text-emerald-800 hover:bg-emerald-50 text-xs font-black px-5 py-2.5 rounded-xl shadow transition-all flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
                  >
                    Review &amp; Confirm Update
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="p-5 bg-rose-600 text-white rounded-2xl shadow-md flex items-start gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <XCircle className="w-7 h-7" />
                  </div>
                  <div className="space-y-2 flex-1">
                    <div className="text-base font-black tracking-wide uppercase">
                      <span>🔴 DO NOT PROCESS</span>
                      <span className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded-md ml-2">
                        {validationResult.errors.length} error{validationResult.errors.length > 1 ? 's' : ''} found
                      </span>
                    </div>
                    <p className="text-xs text-rose-100 font-medium">
                      One or more critical allocation discrepancies were detected. Do NOT dispatch until resolved.
                    </p>

                    {/* Exact highlighted errors list */}
                    <div className="space-y-1.5 pt-1">
                      {validationResult.errors.map((err, idx) => (
                        <div key={idx} className="bg-white/10 rounded-xl p-2.5 text-xs font-semibold flex items-start gap-2 text-rose-50 border border-white/15">
                          <span className="font-mono text-rose-300 font-bold">&bull;</span>
                          <span>{err}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Duplicate Order Warning if detected (Section 13) */}
              {validationResult.duplicateWarning && (
                <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3 text-amber-900 text-xs shadow-sm">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <div className="font-bold text-amber-950 uppercase tracking-wider text-[11px]">
                      ⚠️ Duplicate Order Protection Warning
                    </div>
                    <div className="mt-0.5">{validationResult.duplicateWarning.message}</div>
                  </div>
                </div>
              )}

              {/* Comparison Matrix Table (Section 9) */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <h5 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#5C2D91]" />
                    Product &amp; Allocation Comparison Matrix
                  </h5>
                  <span className="text-[11px] text-slate-500">
                    Source: <strong className="text-slate-800">{orderSource === 'whatsapp' ? 'WhatsApp ↔ FS ↔ Allocation' : 'FS Confirmation ↔ Allocation'}</strong>
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-semibold text-[11px] uppercase tracking-wider">
                        <th className="py-2.5 px-3">Vaccine</th>
                        <th className="py-2.5 px-3 text-right">Original Allocation</th>
                        <th className="py-2.5 px-3 text-right">Previously Taken</th>
                        <th className="py-2.5 px-3 text-right font-bold text-slate-800">Remaining Before</th>
                        <th className="py-2.5 px-3 text-right font-bold text-purple-900">
                          {orderSource === 'whatsapp' ? 'Requested / FS' : 'FS Order'}
                        </th>
                        <th className="py-2.5 px-3 text-right font-bold text-slate-900">Remaining After</th>
                        <th className="py-2.5 px-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {validationResult.items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-4 text-center text-slate-400 text-xs">
                            No vaccine items found in the provided messages.
                          </td>
                        </tr>
                      ) : (
                        validationResult.items.map((item: VaccineValidationItem, i: number) => {
                          const isError = item.status !== 'valid';
                          return (
                            <tr key={i} className={isError ? 'bg-rose-50/60' : 'hover:bg-slate-50/50'}>
                              <td className="py-3 px-3 font-bold text-slate-900">
                                <div>{item.vaccine}</div>
                                {item.errorDetail && (
                                  <div className="text-[10px] text-rose-600 font-semibold mt-0.5">
                                    {item.errorDetail}
                                  </div>
                                )}
                                {item.warningDetail && (
                                  <div className="text-[10px] text-amber-600 font-semibold mt-0.5">
                                    {item.warningDetail}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3 text-right text-slate-600">{item.originalAllocation}</td>
                              <td className="py-3 px-3 text-right text-slate-600">{item.previouslyTaken}</td>
                              <td className="py-3 px-3 text-right font-bold text-slate-800">{item.remainingBefore}</td>
                              <td className="py-3 px-3 text-right font-black text-purple-900">
                                {orderSource === 'whatsapp' ? (
                                  <span>{item.requestedQty} / {item.fsQty}</span>
                                ) : (
                                  <span>{item.fsQty}</span>
                                )}
                              </td>
                              <td className="py-3 px-3 text-right font-black">
                                <span className={item.remainingAfter < 0 ? 'text-rose-600' : 'text-emerald-700'}>
                                  {item.remainingAfter}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-center">
                                {item.status === 'valid' ? (
                                  <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                    <CheckCircle2 className="w-3 h-3" /> Valid
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                    <XCircle className="w-3 h-3" /> Discrepancy
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
            </div>
          )}

          {/* Success Notification after confirmed order */}
          {confirmationSuccess && (
            <div className="p-5 bg-emerald-50 border border-emerald-300 rounded-2xl shadow-sm flex items-start gap-3 animate-in fade-in duration-200">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <div className="text-sm font-black text-emerald-950 flex items-center justify-between">
                  <span>Order Confirmed &amp; Allocation Updated Successfully!</span>
                  <span className="font-mono text-xs text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded">
                    ID: {confirmationSuccess.id}
                  </span>
                </div>
                <p className="text-xs text-emerald-800">
                  Transaction has been recorded into the immutable audit trail and deducted from <strong>{confirmationSuccess.facilityName}</strong>.
                </p>
                <div className="pt-2 flex flex-wrap gap-2">
                  <button
                    onClick={onNavigateToHistory}
                    className="text-xs font-bold text-emerald-900 bg-emerald-200/70 hover:bg-emerald-200 px-3 py-1 rounded-xl transition-all cursor-pointer"
                  >
                    View in Transaction History &rarr;
                  </button>
                  <button
                    onClick={onNavigateToTracker}
                    className="text-xs font-bold text-emerald-900 bg-emerald-200/70 hover:bg-emerald-200 px-3 py-1 rounded-xl transition-all cursor-pointer"
                  >
                    View Updated Allocation Tracker &rarr;
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* STEP 10: REVIEW & CONFIRM MODAL OVERLAY (Section 10 & 11) */}
      <AnimatePresence>
        {showReviewModal && validationResult && selectedFacility && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-xl w-full overflow-hidden"
            >
              <div className="p-6 bg-gradient-to-r from-purple-900 to-[#5C2D91] text-white flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black tracking-tight">Review &amp; Confirm Allocation Update</h3>
                  <p className="text-xs text-purple-200">
                    Step 8 &amp; 9: Final authorization before live inventory deduction
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
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Allocation Period</span>
                    <strong className="text-slate-800 text-sm">{selectedFacility.cycle}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Authorized CCA</span>
                    <strong className="text-slate-800">{ccaName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Order Source</span>
                    <strong className="text-slate-800">{orderSource === 'whatsapp' ? 'WhatsApp Request' : 'FS Confirmation'}</strong>
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
                          <th className="py-2 px-3 text-right">Previous</th>
                          <th className="py-2 px-3 text-right">Current Order</th>
                          <th className="py-2 px-3 text-right font-black text-slate-900">New Remaining</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {validationResult.items
                          .filter(it => (it.fsQty || it.requestedQty) > 0)
                          .map((it, idx) => (
                            <tr key={idx}>
                              <td className="py-2.5 px-3 font-bold text-slate-900">{it.vaccine}</td>
                              <td className="py-2.5 px-3 text-right text-slate-500">{it.originalAllocation}</td>
                              <td className="py-2.5 px-3 text-right text-slate-500">{it.previouslyTaken}</td>
                              <td className="py-2.5 px-3 text-right font-black text-purple-900">{it.fsQty || it.requestedQty}</td>
                              <td className="py-2.5 px-3 text-right font-black text-emerald-700">{it.remainingAfter}</td>
                            </tr>
                          ))}
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
                    <strong>Multi-CCA Atomic Protection:</strong> The system locks and re-verifies live balances on the authoritative backend. Original DCO allocation of <strong>50</strong> remains permanently immutable.
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
                  disabled={confirming}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-black text-xs uppercase tracking-wider px-6 py-3 rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                >
                  {confirming ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Updating Tracker...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Confirm &amp; Update Allocation
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
