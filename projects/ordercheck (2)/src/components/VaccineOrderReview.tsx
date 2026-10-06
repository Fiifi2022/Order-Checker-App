import React, { useState, useId } from 'react';
import {
  Building2,
  Syringe,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  ArrowLeft,
  Edit3,
  Plus,
  Trash2,
  ShieldCheck,
  Check,
  RefreshCw,
  Package,
  Layers,
  X,
  Save,
  Info
} from 'lucide-react';
import { FacilityAllocationRecord, OrderItemDraft, VaccineValidationResult } from '../types';

interface VaccineOrderReviewProps {
  selectedFacility: FacilityAllocationRecord | null;
  orderItems: OrderItemDraft[];
  setOrderItems: React.Dispatch<React.SetStateAction<OrderItemDraft[]>>;
  validationResult: VaccineValidationResult | null;
  validating: boolean;
  onBackToStep: (stepIndex: number) => void;
  onConfirmOrder: () => void;
  onUpdateFacilityName: (facilityId: string, updates: { facilityName: string; district?: string; subDistrict?: string }) => Promise<boolean>;
  onAddProductToFacility: (facilityId: string, product: { vaccineName: string; original?: number; carryOver?: number; topUp?: number; dosesPerVial?: number; unit?: 'vials' | 'doses' }) => Promise<boolean>;
  unitDisplayMode: 'vials' | 'doses' | 'both';
  setUnitDisplayMode: (m: 'vials' | 'doses' | 'both') => void;
  orderSource: 'whatsapp' | 'fs_only';
  onRevalidate: () => void;
}

const COMPANION_PRODUCTS = new Set([
  'BCG DILUENT',
  'YELLOW FEVER DILUENT',
  'MR DILUENT',
  'MEN A DILUENT',
  'OPV DROPPER',
  'ROTA DROPPER',
  'ROTAVIRUS DROPPER'
]);

function isCompanionProduct(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, ' ').toUpperCase();
  return COMPANION_PRODUCTS.has(normalized) || /\b(DILUENT|DROPPER)\b/.test(normalized);
}

const COMMON_ANTIGENS = [
  { name: 'BCG', dosesPerVial: 20 },
  { name: 'OPV', dosesPerVial: 20 },
  { name: 'Penta', dosesPerVial: 10 },
  { name: 'PCV', dosesPerVial: 4 },
  { name: 'Rota', dosesPerVial: 1 },
  { name: 'MR', dosesPerVial: 10 },
  { name: 'Yellow Fever', dosesPerVial: 10 },
  { name: 'Men A', dosesPerVial: 10 },
  { name: 'HPV', dosesPerVial: 2 },
  { name: 'IPV', dosesPerVial: 10 },
  { name: 'Td', dosesPerVial: 10 },
  { name: 'COVID-19', dosesPerVial: 6 },
  { name: 'Malaria (Mosquirix)', dosesPerVial: 2 },
  { name: 'Rotarix', dosesPerVial: 1 },
  { name: 'Typhoid Conjugate', dosesPerVial: 5 }
];

export const VaccineOrderReview: React.FC<VaccineOrderReviewProps> = ({
  selectedFacility,
  orderItems,
  setOrderItems,
  validationResult,
  validating,
  onBackToStep,
  onConfirmOrder,
  onUpdateFacilityName,
  onAddProductToFacility,
  unitDisplayMode,
  setUnitDisplayMode,
  orderSource,
  onRevalidate
}) => {
  const reviewFacilityNameId = useId();
  const reviewSubDistrictId = useId();
  const reviewDistrictId = useId();
  const reviewProductNameId = useId();
  const reviewProductQtyId = useId();
  const reviewPackagingId = useId();
  const reviewInitialAllocId = useId();

  // Facility Edit Modal State
  const [showEditFacilityModal, setShowEditFacilityModal] = useState(false);
  const [tempFacilityName, setTempFacilityName] = useState('');
  const [tempDistrict, setTempDistrict] = useState('');
  const [tempSubDistrict, setTempSubDistrict] = useState('');
  const [savingFacility, setSavingFacility] = useState(false);
  const [facilityFeedback, setFacilityFeedback] = useState<string | null>(null);

  // Add Product Modal State
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductQty, setNewProductQty] = useState<number>(10);
  const [newProductUnit, setNewProductUnit] = useState<'vials' | 'doses'>('vials');
  const [newProductDpv, setNewProductDpv] = useState<number>(10);
  const [addPermanentToFacility, setAddPermanentToFacility] = useState(true);
  const [initialFacilityAllocation, setInitialFacilityAllocation] = useState<number>(50);
  const [addingProduct, setAddingProduct] = useState(false);

  const openFacilityEdit = () => {
    if (!selectedFacility) return;
    setTempFacilityName(selectedFacility.facilityName || '');
    setTempDistrict(selectedFacility.district || '');
    setTempSubDistrict(selectedFacility.subDistrict || '');
    setFacilityFeedback(null);
    setShowEditFacilityModal(true);
  };

  const handleSaveFacility = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFacility || !tempFacilityName.trim()) return;
    setSavingFacility(true);
    try {
      const ok = await onUpdateFacilityName(selectedFacility.id, {
        facilityName: tempFacilityName.trim(),
        district: tempDistrict.trim(),
        subDistrict: tempSubDistrict.trim()
      });
      if (ok) {
        setFacilityFeedback('Facility name updated successfully');
        setTimeout(() => {
          setShowEditFacilityModal(false);
          setFacilityFeedback(null);
        }, 800);
      }
    } finally {
      setSavingFacility(false);
    }
  };

  const handleAddNewProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim()) return;
    setAddingProduct(true);
    try {
      const prodName = newProductName.trim();
      if (addPermanentToFacility && selectedFacility) {
        await onAddProductToFacility(selectedFacility.id, {
          vaccineName: prodName,
          original: initialFacilityAllocation,
          dosesPerVial: newProductDpv,
          unit: newProductUnit
        });
      }

      const newItem: OrderItemDraft = {
        id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        vaccine: prodName,
        quantity: newProductQty,
        unit: newProductUnit,
        dosesPerVial: newProductDpv
      };

      setOrderItems(prev => [...prev, newItem]);
      setShowAddProductModal(false);
      setNewProductName('');
      setNewProductQty(10);
      onRevalidate();
    } finally {
      setAddingProduct(false);
    }
  };

  const removeItem = (idxToRemove: number) => {
    setOrderItems(prev => prev.filter((_, idx) => idx !== idxToRemove));
    setTimeout(() => onRevalidate(), 50);
  };

  // Check overall order status
  const hasErrors = validationResult && !validationResult.isValid;

  return (
    <div id="vaccine-order-review-container" className="space-y-6 animate-in fade-in duration-200">
      {/* 1. FACILITY SUMMARY BANNER WITH EDIT BUTTON */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#5C2D91] text-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-black text-slate-900 tracking-tight">
                {selectedFacility ? selectedFacility.facilityName : 'Unknown Facility'}
              </h3>
              {selectedFacility && (
                <button
                  type="button"
                  onClick={openFacilityEdit}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-purple-50 text-[#5C2D91] border border-purple-200 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer"
                  title="Edit Facility Name or Metadata"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>Edit Facility Name</span>
                </button>
              )}
            </div>
            {selectedFacility && (
              <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                <span>District: <strong className="text-slate-700 font-semibold">{selectedFacility.district || 'Unassigned'}</strong></span>
                <span>•</span>
                <span>Sub-District: <strong className="text-slate-700 font-semibold">{selectedFacility.subDistrict || 'General'}</strong></span>
                <span>•</span>
                <span>Sheet Tab: <strong className="text-slate-700 font-semibold">{selectedFacility.tabName || selectedFacility.cycle || 'Allocation Tracker'}</strong></span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
          {/* Unit mode switcher */}
          <div className="flex items-center bg-white border border-slate-200 p-0.5 rounded-xl text-[11px] font-bold">
            <button
              type="button"
              onClick={() => setUnitDisplayMode('vials')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                unitDisplayMode === 'vials' ? 'bg-[#5C2D91] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Vials
            </button>
            <button
              type="button"
              onClick={() => setUnitDisplayMode('doses')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                unitDisplayMode === 'doses' ? 'bg-[#5C2D91] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Doses
            </button>
            <button
              type="button"
              onClick={() => setUnitDisplayMode('both')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                unitDisplayMode === 'both' ? 'bg-[#5C2D91] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Both
            </button>
          </div>

          <button
            type="button"
            onClick={() => onBackToStep(0)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Edit One by One</span>
          </button>
        </div>
      </div>

      {/* 2. LIVE AUDIT VERDICT BANNER (GREEN LIGHT / RED LIGHT) */}
      {validationResult && (
        <div>
          {validationResult.isValid ? (
            <div className="p-5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-3xl shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0 shadow-inner">
                  <CheckCircle2 className="w-7 h-7 text-white" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-black tracking-wide uppercase">
                    🟢 GREEN LIGHT: All {orderItems.length} Products Verified
                  </div>
                  <p className="text-xs text-emerald-100 font-medium max-w-xl">
                    Every vaccine requested is allocated to <strong>{selectedFacility?.facilityName}</strong>, all quantities are strictly within remaining balance, and packaging is verified.
                  </p>
                </div>
              </div>

              <button
                type="button"
                id="review-confirm-tracker-btn"
                onClick={onConfirmOrder}
                className="bg-white text-emerald-800 hover:bg-emerald-50 text-xs font-black px-6 py-3 rounded-2xl shadow-md transition-all flex items-center gap-2 cursor-pointer uppercase tracking-wider whitespace-nowrap self-stretch md:self-auto justify-center"
              >
                <Check className="w-4 h-4 text-emerald-600" />
                <span>Confirm &amp; Update Vaccine Tracker</span>
              </button>
            </div>
          ) : (
            <div className="p-5 bg-gradient-to-r from-rose-600 to-red-700 text-white rounded-3xl shadow-lg space-y-3">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0 shadow-inner">
                  <XCircle className="w-7 h-7 text-white" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-base font-black tracking-wide uppercase">
                    🔴 DO NOT PROCESS: {validationResult.errors.length} {validationResult.errors.length === 1 ? 'Discrepancy' : 'Discrepancies'} Found
                  </div>
                  <p className="text-xs text-rose-100 font-medium">
                    Please correct the discrepancies below by clicking &quot;Edit&quot; on the affected vaccine row before dispatching.
                  </p>
                </div>
              </div>

              {/* Error messages list */}
              <div className="grid grid-cols-1 gap-1.5 pt-1">
                {validationResult.errors.map((err, idx) => (
                  <div key={idx} className="bg-white/10 rounded-xl p-2.5 text-xs font-semibold flex items-center gap-2 text-white border border-white/20">
                    <XCircle className="w-4 h-4 flex-shrink-0 text-white" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. REVIEW DATA MATRIX TABLE (ALL PRODUCTS) */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden space-y-0">
        <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Syringe className="w-4 h-4 text-[#5C2D91]" />
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Vaccine Order Review &amp; Allocation Reconciliation ({orderItems.length} Products)
            </h4>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
            <button
              type="button"
              id="review-add-vaccine-btn"
              onClick={() => setShowAddProductModal(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#5C2D91] hover:bg-[#482372] text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Vaccine / Product</span>
            </button>

            <button
              type="button"
              onClick={onRevalidate}
              disabled={validating}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${validating ? 'animate-spin' : ''}`} />
              <span>Re-Audit</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100/90 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">#</th>
                <th className="py-3 px-4">Vaccine Product</th>
                <th className="py-3 px-4 text-right">Order Qty</th>
                <th className="py-3 px-4 text-right">Available Before</th>
                <th className="py-3 px-4 text-right">Projected Balance</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {orderItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    <p className="text-xs">No vaccines added to draft order yet.</p>
                  </td>
                </tr>
              ) : (
                orderItems.map((item, idx) => {
                const matchedValidation = validationResult?.items.find(
                  v => v.vaccine.toLowerCase() === item.vaccine.toLowerCase()
                );
                const alloc = selectedFacility?.vaccines[item.vaccine];
                const dpv = alloc?.dosesPerVial || item.dosesPerVial || 10;

                let orderVials = item.quantity || 0;
                let orderDoses = orderVials * dpv;
                if (item.unit === 'doses') {
                  orderDoses = item.quantity || 0;
                  orderVials = Math.ceil(orderDoses / dpv);
                }

                const isUnallocatedCompanion = !alloc && isCompanionProduct(item.vaccine);
                const remBeforeVials = alloc ? alloc.remaining : 0;
                const remBeforeDoses = alloc?.remainingDoses !== undefined ? alloc.remainingDoses : remBeforeVials * dpv;
                const remAfterVials = isUnallocatedCompanion ? 0 : remBeforeVials - orderVials;
                const remAfterDoses = isUnallocatedCompanion ? 0 : remBeforeDoses - orderDoses;

                const isExcess = (!alloc && !isUnallocatedCompanion) || remAfterVials < 0;
                const isExhausted = alloc && remBeforeVials <= 0 && orderVials > 0;
                const isNotAllocated = !alloc && !isUnallocatedCompanion;

                return (
                  <tr key={item.id || idx} className="hover:bg-purple-50/30 transition-colors">
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-black text-slate-900 text-xs">
                        {item.vaccine}
                      </div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        Packaging: {dpv} doses/vial
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-black text-purple-900">
                      <div>{orderVials} vials</div>
                      <div className="text-[10px] text-purple-700 font-normal">
                        ({orderDoses.toLocaleString()} doses)
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right text-slate-600">
                      <div>{remBeforeVials} vials</div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        ({remBeforeDoses.toLocaleString()} doses)
                      </div>
                    </td>
                    <td className={`py-3 px-4 text-right font-bold ${remAfterVials < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                      <div>{remAfterVials} vials</div>
                      <div className={`text-[10px] font-normal ${remAfterVials < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                        ({remAfterDoses.toLocaleString()} doses)
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {isNotAllocated ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                          <AlertCircle className="w-3 h-3" />
                          Unallocated
                        </span>
                      ) : isExhausted ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold">
                          <AlertTriangle className="w-3 h-3" />
                          Exhausted
                        </span>
                      ) : isExcess ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold">
                          <XCircle className="w-3 h-3" />
                          Over-Allocation
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          <CheckCircle2 className="w-3 h-3" />
                          Within Quota
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onBackToStep(idx)}
                          className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-[#5C2D91] rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                          title="Edit this vaccine item"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>

        {/* Action Bottom Bar */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onBackToStep(0)}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>&larr; Back to Step-by-Step Edit</span>
          </button>

          <button
            type="button"
            id="review-bottom-confirm-btn"
            onClick={onConfirmOrder}
            disabled={validating || hasErrors}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#5C2D91] hover:bg-[#482372] disabled:bg-slate-300 text-white text-xs font-black uppercase tracking-wider transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
          >
            <Check className="w-4 h-4" />
            <span>Confirm &amp; Update Vaccine Tracker</span>
          </button>
        </div>
      </div>

      {/* 4. MODAL: EDIT FACILITY NAME */}
      {showEditFacilityModal && selectedFacility && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="p-5 bg-gradient-to-r from-purple-900 to-[#5C2D91] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-5 h-5" />
                <h3 className="text-base font-black tracking-tight">Edit Facility Information</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowEditFacilityModal(false)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveFacility} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor={reviewFacilityNameId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Facility Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  id={reviewFacilityNameId}
                  required
                  value={tempFacilityName}
                  onChange={e => setTempFacilityName(e.target.value)}
                  placeholder="e.g. Konkoma SDA Clinic"
                  className="w-full text-sm font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-purple-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor={reviewSubDistrictId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Sub-District
                  </label>
                  <input
                    type="text"
                    id={reviewSubDistrictId}
                    value={tempSubDistrict}
                    onChange={e => setTempSubDistrict(e.target.value)}
                    placeholder="e.g. Konkoma"
                    className="w-full text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:border-[#5C2D91]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={reviewDistrictId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    District
                  </label>
                  <input
                    type="text"
                    id={reviewDistrictId}
                    value={tempDistrict}
                    onChange={e => setTempDistrict(e.target.value)}
                    placeholder="e.g. Sekyere South"
                    className="w-full text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:border-[#5C2D91]"
                  />
                </div>
              </div>

              {facilityFeedback && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>{facilityFeedback}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditFacilityModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFacility}
                  className="px-5 py-2 bg-[#5C2D91] hover:bg-[#482372] text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {savingFacility ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Facility Name</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. MODAL: ADD VACCINE / NEW PRODUCT */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="p-5 bg-gradient-to-r from-purple-900 to-[#5C2D91] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Plus className="w-5 h-5" />
                <h3 className="text-base font-black tracking-tight">Add Vaccine / New Product</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddProductModal(false)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddNewProductSubmit} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor={reviewProductNameId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Vaccine / Product Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  id={reviewProductNameId}
                  required
                  value={newProductName}
                  onChange={e => {
                    const name = e.target.value;
                    setNewProductName(name);
                    const match = COMMON_ANTIGENS.find(c => c.name.toLowerCase() === name.toLowerCase());
                    if (match) {
                      setNewProductDpv(match.dosesPerVial);
                    }
                  }}
                  placeholder="e.g. Malaria (Mosquirix), Rotarix, COVID-19"
                  className="w-full text-sm font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 outline-none focus:border-[#5C2D91]"
                />

                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Popular:</span>
                  {['Malaria (Mosquirix)', 'Rotarix', 'COVID-19', 'Typhoid', 'HPV'].map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setNewProductName(s);
                        const match = COMMON_ANTIGENS.find(c => c.name.toLowerCase() === s.toLowerCase());
                        if (match) setNewProductDpv(match.dosesPerVial);
                      }}
                      className="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-purple-100 text-slate-700 hover:text-[#5C2D91] rounded-md font-semibold transition-all cursor-pointer"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor={reviewProductQtyId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Order Quantity
                  </label>
                  <input
                    type="number"
                    id={reviewProductQtyId}
                    min="1"
                    value={newProductQty}
                    onChange={e => setNewProductQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full text-xs font-bold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:border-[#5C2D91]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor={reviewPackagingId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Packaging (Doses/Vial)
                  </label>
                  <input
                    type="number"
                    id={reviewPackagingId}
                    min="1"
                    value={newProductDpv}
                    onChange={e => setNewProductDpv(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full text-xs font-bold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:border-[#5C2D91]"
                  />
                </div>
              </div>

              {selectedFacility && (
                <div className="p-3 bg-purple-50/70 border border-purple-200/80 rounded-2xl space-y-2.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addPermanentToFacility}
                      onChange={e => setAddPermanentToFacility(e.target.checked)}
                      className="w-4 h-4 text-[#5C2D91] rounded-md accent-[#5C2D91] cursor-pointer"
                    />
                    <span className="text-xs font-bold text-purple-950">
                      Register product on facility&apos;s allocation sheet
                    </span>
                  </label>

                  {addPermanentToFacility && (
                    <div className="pl-6 space-y-1">
                      <label htmlFor={reviewInitialAllocId} className="text-[11px] font-semibold text-purple-900 block">
                        Initial Authorized Facility Allocation (Vials):
                      </label>
                      <input
                        type="number"
                        id={reviewInitialAllocId}
                        min="0"
                        value={initialFacilityAllocation}
                        onChange={e => setInitialFacilityAllocation(Math.max(0, parseInt(e.target.value, 10) || 0))}
                        className="w-32 text-xs font-bold text-slate-800 bg-white border border-purple-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-[#5C2D91]"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddProductModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingProduct || !newProductName.trim()}
                  className="px-5 py-2 bg-[#5C2D91] hover:bg-[#482372] text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {addingProduct ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add to Order</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
