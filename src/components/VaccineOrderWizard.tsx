import React, { useState, useId } from 'react';
import {
  Building2,
  Syringe,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Edit3,
  Plus,
  Trash2,
  Package,
  Layers,
  Check,
  X,
  Save,
  Info,
  ShieldCheck,
  RefreshCw,
  FileText
} from 'lucide-react';
import { FacilityAllocationRecord, OrderItemDraft, VaccineValidationResult } from '../types';

interface VaccineOrderWizardProps {
  selectedFacility: FacilityAllocationRecord | null;
  allFacilities: FacilityAllocationRecord[];
  orderItems: OrderItemDraft[];
  setOrderItems: React.Dispatch<React.SetStateAction<OrderItemDraft[]>>;
  currentStepIndex: number;
  setCurrentStepIndex: React.Dispatch<React.SetStateAction<number>>;
  unitDisplayMode: 'vials' | 'doses' | 'both';
  setUnitDisplayMode: (m: 'vials' | 'doses' | 'both') => void;
  onProceedToReview: () => void;
  onUpdateFacilityName: (facilityId: string, updates: { facilityName: string; district?: string; subDistrict?: string }) => Promise<boolean>;
  onAddProductToFacility: (facilityId: string, product: { vaccineName: string; original?: number; carryOver?: number; topUp?: number; dosesPerVial?: number; unit?: 'vials' | 'doses' }) => Promise<boolean>;
  onSelectFacility: (facilityId: string) => void;
  orderSource: 'whatsapp' | 'fs_only';
  setOrderSource: (src: 'whatsapp' | 'fs_only') => void;
  validationResult: VaccineValidationResult | null;
  validating: boolean;
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
  { name: 'Typhoid Conjugate', dosesPerVial: 5 },
  { name: 'Rabies', dosesPerVial: 1 }
];

export const VaccineOrderWizard: React.FC<VaccineOrderWizardProps> = ({
  selectedFacility,
  allFacilities,
  orderItems,
  setOrderItems,
  currentStepIndex,
  setCurrentStepIndex,
  unitDisplayMode,
  setUnitDisplayMode,
  onProceedToReview,
  onUpdateFacilityName,
  onAddProductToFacility,
  onSelectFacility,
  orderSource,
  setOrderSource,
  validationResult,
  validating
}) => {
  const facilitySelectId = useId();
  const editFacilityNameId = useId();
  const editSubDistrictId = useId();
  const editDistrictId = useId();
  const newProductNameId = useId();
  const newProductQuantityId = useId();
  const newProductPackagingId = useId();
  const newProductAllocId = useId();

  // Modal States
  const [showEditFacilityModal, setShowEditFacilityModal] = useState(false);
  const [tempFacilityName, setTempFacilityName] = useState('');
  const [tempDistrict, setTempDistrict] = useState('');
  const [tempSubDistrict, setTempSubDistrict] = useState('');
  const [savingFacility, setSavingFacility] = useState(false);
  const [facilityFeedback, setFacilityFeedback] = useState<string | null>(null);

  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductQty, setNewProductQty] = useState<number>(10);
  const [newProductUnit, setNewProductUnit] = useState<'vials' | 'doses'>('vials');
  const [newProductDpv, setNewProductDpv] = useState<number>(10);
  const [addPermanentToFacility, setAddPermanentToFacility] = useState(true);
  const [initialFacilityAllocation, setInitialFacilityAllocation] = useState<number>(50);
  const [addingProduct, setAddingProduct] = useState(false);

  // Safe active item fallback
  const activeIndex = Math.min(Math.max(0, currentStepIndex), Math.max(0, orderItems.length - 1));
  const currentItem: OrderItemDraft | undefined = orderItems[activeIndex];

  // Helper to open edit facility modal with current details
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

  // Update current item fields
  const updateCurrentItem = (updates: Partial<OrderItemDraft>) => {
    setOrderItems(prev => {
      const next = [...prev];
      if (!next[activeIndex]) return prev;
      next[activeIndex] = { ...next[activeIndex], ...updates };
      return next;
    });
  };

  // Adjust quantity with delta
  const adjustQuantity = (delta: number) => {
    if (!currentItem) return;
    const nextQty = Math.max(0, (currentItem.quantity || 0) + delta);
    updateCurrentItem({ quantity: nextQty });
  };

  // Handle adding new product
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
      setCurrentStepIndex(orderItems.length); // Jump to new item
      setShowAddProductModal(false);
      setNewProductName('');
      setNewProductQty(10);
    } finally {
      setAddingProduct(false);
    }
  };

  // Remove item from order
  const handleRemoveCurrentItem = () => {
    if (orderItems.length <= 1) {
      // Just clear/reset the item instead of having 0 items
      updateCurrentItem({ vaccine: 'BCG', quantity: 0 });
      return;
    }
    setOrderItems(prev => prev.filter((_, idx) => idx !== activeIndex));
    if (activeIndex >= orderItems.length - 1) {
      setCurrentStepIndex(Math.max(0, activeIndex - 1));
    }
  };

  // Calculate live allocation details for the current active item at the facility
  const getActiveAllocationStats = () => {
    if (!selectedFacility || !currentItem) {
      return {
        existsInFacility: false,
        totalAllocated: 0,
        totalAllocatedDoses: 0,
        taken: 0,
        takenDoses: 0,
        remainingBefore: 0,
        remainingBeforeDoses: 0,
        remainingAfter: 0,
        remainingAfterDoses: 0,
        dosesPerVial: currentItem?.dosesPerVial || 10,
        status: 'unknown'
      };
    }

    const vacKey = Object.keys(selectedFacility.vaccines).find(
      k => k.toLowerCase() === currentItem.vaccine.toLowerCase()
    );
    const alloc = vacKey ? selectedFacility.vaccines[vacKey] : undefined;
    const dpv = alloc?.dosesPerVial || currentItem.dosesPerVial || 10;

    let orderVials = currentItem.quantity || 0;
    let orderDoses = orderVials * dpv;
    if (currentItem.unit === 'doses') {
      orderDoses = currentItem.quantity || 0;
      orderVials = Math.ceil(orderDoses / dpv);
    }

    if (!alloc) {
      return {
        existsInFacility: false,
        totalAllocated: 0,
        totalAllocatedDoses: 0,
        taken: 0,
        takenDoses: 0,
        remainingBefore: 0,
        remainingBeforeDoses: 0,
        remainingAfter: -orderVials,
        remainingAfterDoses: -orderDoses,
        dosesPerVial: dpv,
        status: 'not_allocated'
      };
    }

    const totalAlloc = (alloc.carryOver || 0) + alloc.original + (alloc.topUp || 0) + (alloc.adjustment || 0);
    const totalAllocDoses = totalAlloc * dpv;
    const taken = alloc.taken || 0;
    const takenDoses = alloc.takenDoses !== undefined ? alloc.takenDoses : taken * dpv;
    const remBefore = alloc.remaining || 0;
    const remBeforeDoses = alloc.remainingDoses !== undefined ? alloc.remainingDoses : remBefore * dpv;
    const remAfter = remBefore - orderVials;
    const remAfterDoses = remBeforeDoses - orderDoses;

    let status: 'valid' | 'excess' | 'exhausted' = 'valid';
    if (remBefore <= 0 && orderVials > 0) {
      status = 'exhausted';
    } else if (remAfter < 0) {
      status = 'excess';
    }

    return {
      existsInFacility: true,
      totalAllocated: totalAlloc,
      totalAllocatedDoses: totalAllocDoses,
      taken,
      takenDoses,
      remainingBefore: remBefore,
      remainingBeforeDoses: remBeforeDoses,
      remainingAfter: remAfter,
      remainingAfterDoses: remAfterDoses,
      dosesPerVial: dpv,
      status
    };
  };

  const allocStats = getActiveAllocationStats();
  const isLastVaccine = activeIndex === orderItems.length - 1;

  // Available vaccines for facility
  const facilityVaccineNames = selectedFacility
    ? Object.keys(selectedFacility.vaccines)
    : COMMON_ANTIGENS.map(a => a.name);

  return (
    <div id="vaccine-wizard-container" className="space-y-5">
      {/* 1. FACILITY HEADER WITH DIRECT EDIT BUTTON */}
      <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#5C2D91] text-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-black text-slate-900 tracking-tight">
                {selectedFacility ? selectedFacility.facilityName : 'Select a Health Facility'}
              </h3>
              {selectedFacility && (
                <button
                  type="button"
                  id="edit-facility-name-btn"
                  onClick={openFacilityEdit}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-purple-50 text-[#5C2D91] hover:text-[#482372] border border-purple-200 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer"
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

        {/* Change Facility Dropdown Selector */}
        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
          <label htmlFor={facilitySelectId} className="text-xs text-slate-500 font-medium whitespace-nowrap">Switch:</label>
          <select
            id={facilitySelectId}
            value={selectedFacility?.id || ''}
            onChange={e => onSelectFacility(e.target.value)}
            className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] cursor-pointer"
          >
            <option value="" disabled>-- Select Facility --</option>
            {allFacilities.map(f => (
              <option key={f.id} value={f.id}>
                {f.facilityName} ({f.subDistrict || f.district || 'Warehouse'})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 2. SEQUENTIAL WIZARD PROGRESS TRACKER ("One Vaccine at a Time") */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#5C2D91] text-white text-xs font-black flex items-center justify-center">
              {orderItems.length > 0 ? activeIndex + 1 : 0}
            </span>
            <div className="text-xs font-black uppercase tracking-wider text-slate-800">
              {orderItems.length > 0
                ? `Vaccine Verification ${activeIndex + 1} of ${orderItems.length}`
                : 'Vaccine Verification (No Items Drafted)'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Unit display switch */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-[11px] font-bold">
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

            {/* Quick Add Product Button */}
            <button
              type="button"
              id="add-new-product-btn"
              onClick={() => setShowAddProductModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-[#5C2D91] border border-purple-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Vaccine / Product</span>
            </button>
          </div>
        </div>

        {/* Interactive Step Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {orderItems.map((item, idx) => {
            const isCurrent = idx === activeIndex;
            const isCompleted = idx < activeIndex;
            return (
              <button
                key={item.id || idx}
                type="button"
                onClick={() => setCurrentStepIndex(idx)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer border ${
                  isCurrent
                    ? 'bg-[#5C2D91] text-white border-[#5C2D91] shadow-xs ring-2 ring-purple-200'
                    : isCompleted
                    ? 'bg-purple-50 text-purple-900 border-purple-200 hover:bg-purple-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {isCompleted ? (
                  <Check className="w-3 h-3 text-emerald-600 font-bold" />
                ) : (
                  <span className="text-[10px] opacity-75">{idx + 1}.</span>
                )}
                <span>{item.vaccine || `Vaccine ${idx + 1}`}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${isCurrent ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-700'}`}>
                  {item.quantity} {item.unit || 'vials'}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={onProceedToReview}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all cursor-pointer whitespace-nowrap ml-auto"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#5C2D91]" />
            <span>Final Review &rarr;</span>
          </button>
        </div>
      </div>

      {/* 3. ACTIVE VACCINE FOCUSED CARD (ONE VACCINE AT A TIME) */}
      {orderItems.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-purple-200 rounded-3xl p-10 text-center space-y-4 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-purple-100 text-[#5C2D91] mx-auto flex items-center justify-center shadow-2xs">
            <Syringe className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-black text-slate-900">No Vaccines in Draft Order</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Add a vaccine to begin step-by-step verification against the facility allocation, or switch to Raw Text mode.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddProductModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#5C2D91] hover:bg-[#482372] text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Vaccine / Product</span>
          </button>
        </div>
      ) : currentItem ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-md space-y-6">
          {/* Card Header & Selector */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="space-y-1">
              <div className="text-xs font-black uppercase tracking-wider text-purple-700 flex items-center gap-1.5">
                <Syringe className="w-4 h-4 text-[#5C2D91]" />
                <span>Single Item Focus • Step {activeIndex + 1}</span>
              </div>
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                <span>{currentItem.vaccine}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-purple-100 text-[#5C2D91]">
                  {allocStats.dosesPerVial} doses / vial
                </span>
              </h2>
            </div>

            {/* Quick Vaccine Selector Dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Edit Vaccine:</span>
              <select
                value={currentItem.vaccine}
                onChange={e => {
                  const selectedName = e.target.value;
                  const matchedCommon = COMMON_ANTIGENS.find(c => c.name.toLowerCase() === selectedName.toLowerCase());
                  const alloc = selectedFacility?.vaccines[selectedName];
                  const dpv = alloc?.dosesPerVial || matchedCommon?.dosesPerVial || 10;
                  updateCurrentItem({ vaccine: selectedName, dosesPerVial: dpv });
                }}
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] cursor-pointer"
              >
                {facilityVaccineNames.map(vName => (
                  <option key={vName} value={vName}>{vName}</option>
                ))}
                {!facilityVaccineNames.includes(currentItem.vaccine) && (
                  <option value={currentItem.vaccine}>{currentItem.vaccine} (Custom Product)</option>
                )}
              </select>

              <button
                type="button"
                onClick={() => setShowAddProductModal(true)}
                className="p-2 bg-purple-50 hover:bg-purple-100 text-[#5C2D91] border border-purple-200 rounded-xl transition-all cursor-pointer"
                title="Add new product to catalog or order"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* QUANTITY & UNIT EDITORS */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            {/* Left: Interactive Quantity Stepper */}
            <div className="md:col-span-6 space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
                <span>Dispatch Quantity</span>
                <span className="text-slate-400 font-normal text-[11px]">Specify order amount</span>
              </label>

              {/* Unit Toggle and Input */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="0"
                    value={currentItem.quantity === 0 ? '' : currentItem.quantity}
                    onChange={e => {
                      const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0);
                      updateCurrentItem({ quantity: val });
                    }}
                    placeholder="0"
                    className="w-full text-2xl font-black text-slate-900 bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-purple-100 transition-all"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => updateCurrentItem({ unit: 'vials' })}
                      className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                        currentItem.unit === 'vials' ? 'bg-[#5C2D91] text-white' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      Vials
                    </button>
                    <button
                      type="button"
                      onClick={() => updateCurrentItem({ unit: 'doses' })}
                      className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                        currentItem.unit === 'doses' ? 'bg-[#5C2D91] text-white' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      Doses
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Steppers (-10, -5, -1, +1, +5, +10) */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase font-bold text-slate-400 mr-1">Quick Steps:</span>
                <button
                  type="button"
                  onClick={() => adjustQuantity(-10)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition-all cursor-pointer"
                >
                  -10
                </button>
                <button
                  type="button"
                  onClick={() => adjustQuantity(-5)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition-all cursor-pointer"
                >
                  -5
                </button>
                <button
                  type="button"
                  onClick={() => adjustQuantity(-1)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition-all cursor-pointer"
                >
                  -1
                </button>
                <button
                  type="button"
                  onClick={() => adjustQuantity(1)}
                  className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-[#5C2D91] font-bold rounded-lg text-xs transition-all cursor-pointer"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => adjustQuantity(5)}
                  className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-[#5C2D91] font-bold rounded-lg text-xs transition-all cursor-pointer"
                >
                  +5
                </button>
                <button
                  type="button"
                  onClick={() => adjustQuantity(10)}
                  className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-[#5C2D91] font-bold rounded-lg text-xs transition-all cursor-pointer"
                >
                  +10
                </button>
              </div>

              {/* Converted Equivalent Indicator */}
              <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5 pt-1">
                <Package className="w-3.5 h-3.5 text-purple-600" />
                <span>Equivalent: </span>
                <strong className="text-slate-800 font-bold">
                  {currentItem.unit === 'doses'
                    ? `${Math.ceil((currentItem.quantity || 0) / allocStats.dosesPerVial)} vials required`
                    : `${((currentItem.quantity || 0) * allocStats.dosesPerVial).toLocaleString()} total doses`}
                </strong>
              </div>
            </div>

            {/* Right: Live Position at Facility */}
            <div className="md:col-span-6 bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  {selectedFacility?.facilityName || 'Facility'} Balance
                </span>
                {allocStats.status === 'valid' && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    Within Quota
                  </span>
                )}
                {allocStats.status === 'excess' && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-rose-600" />
                    Over-Allocation
                  </span>
                )}
                {allocStats.status === 'exhausted' && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-rose-600" />
                    Allocation Exhausted
                  </span>
                )}
                {allocStats.status === 'not_allocated' && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-600" />
                    Not in Allocation Sheet
                  </span>
                )}
              </div>

              {/* Grid of metrics */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Quota</span>
                  <strong className="text-slate-800 text-sm">{allocStats.totalAllocated} vials</strong>
                  <span className="text-[10px] text-slate-400 block font-normal">({allocStats.totalAllocatedDoses} doses)</span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Previously Taken</span>
                  <strong className="text-slate-800 text-sm">{allocStats.taken} vials</strong>
                  <span className="text-[10px] text-slate-400 block font-normal">({allocStats.takenDoses} doses)</span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Remaining Available</span>
                  <strong className="text-purple-900 text-sm font-black">{allocStats.remainingBefore} vials</strong>
                  <span className="text-[10px] text-purple-700 block font-normal">({allocStats.remainingBeforeDoses} doses)</span>
                </div>
                <div className={`p-2.5 rounded-xl border ${allocStats.remainingAfter < 0 ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
                  <span className="block text-[10px] uppercase font-bold opacity-75">Projected Remaining</span>
                  <strong className="text-sm font-black">{allocStats.remainingAfter} vials</strong>
                  <span className="text-[10px] block font-normal opacity-75">({allocStats.remainingAfterDoses} doses)</span>
                </div>
              </div>

              {/* Status explanation */}
              {allocStats.status === 'excess' && (
                <div className="p-2.5 bg-rose-100/70 rounded-xl text-rose-900 text-[11px] font-semibold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <span>
                    Current order of {currentItem.quantity} vials exceeds remaining balance of {allocStats.remainingBefore} vials by {Math.abs(allocStats.remainingAfter)} vials!
                  </span>
                </div>
              )}
              {allocStats.status === 'exhausted' && (
                <div className="p-2.5 bg-rose-100/70 rounded-xl text-rose-900 text-[11px] font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <span>
                    Facility has 0 balance remaining for {currentItem.vaccine}. Top-up required before dispatch.
                  </span>
                </div>
              )}
              {allocStats.status === 'not_allocated' && (
                <div className="p-2.5 bg-amber-100/70 rounded-xl text-amber-900 text-[11px] font-semibold flex items-start gap-2">
                  <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <span>
                    {currentItem.vaccine} is not currently registered on this facility&apos;s allocation sheet. Click &quot;Add Vaccine / Product&quot; to set an allocation.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* STEP FOOTER CONTROLS: PREVIOUS, REMOVE, CONTINUE */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-2 self-stretch sm:self-auto">
              <button
                type="button"
                onClick={() => setCurrentStepIndex(prev => Math.max(0, prev - 1))}
                disabled={activeIndex === 0}
                className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-700 text-xs font-bold transition-all cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Previous Vaccine</span>
              </button>

              <button
                type="button"
                onClick={handleRemoveCurrentItem}
                className="px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-rose-50 text-rose-600 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                title="Remove this vaccine from current order"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Remove</span>
              </button>
            </div>

            <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
              {/* Add next product button */}
              <button
                type="button"
                onClick={() => setShowAddProductModal(true)}
                className="px-4 py-2.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-[#5C2D91] text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add Another Vaccine</span>
              </button>

              {/* PRIMARY ACTION: CONTINUE TO NEXT OR CONTINUE TO REVIEW */}
              {isLastVaccine ? (
                <button
                  type="button"
                  id="wizard-continue-to-review-btn"
                  onClick={onProceedToReview}
                  disabled={validating}
                  className="bg-[#5C2D91] hover:bg-[#482372] disabled:bg-slate-300 text-white font-black text-xs uppercase tracking-wider px-6 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer"
                >
                  {validating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Auditing Allocation...</span>
                    </>
                  ) : (
                    <>
                      <span>Continue to Review</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  id="wizard-continue-btn"
                  onClick={() => setCurrentStepIndex(prev => Math.min(orderItems.length - 1, prev + 1))}
                  className="bg-[#5C2D91] hover:bg-[#482372] text-white font-bold text-xs uppercase tracking-wider px-6 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer"
                >
                  <span>Continue</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
                <label htmlFor={editFacilityNameId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Facility Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  id={editFacilityNameId}
                  required
                  value={tempFacilityName}
                  onChange={e => setTempFacilityName(e.target.value)}
                  placeholder="e.g. Konkoma SDA Clinic"
                  className="w-full text-sm font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-purple-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor={editSubDistrictId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Sub-District
                  </label>
                  <input
                    type="text"
                    id={editSubDistrictId}
                    value={tempSubDistrict}
                    onChange={e => setTempSubDistrict(e.target.value)}
                    placeholder="e.g. Konkoma"
                    className="w-full text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:border-[#5C2D91]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={editDistrictId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    District
                  </label>
                  <input
                    type="text"
                    id={editDistrictId}
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
                <label htmlFor={newProductNameId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Vaccine / Product Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  id={newProductNameId}
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

                {/* Quick suggestions */}
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
                  <label htmlFor={newProductQuantityId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Order Quantity
                  </label>
                  <input
                    type="number"
                    id={newProductQuantityId}
                    min="1"
                    value={newProductQty}
                    onChange={e => setNewProductQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full text-xs font-bold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:border-[#5C2D91]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor={newProductPackagingId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Packaging (Doses/Vial)
                  </label>
                  <input
                    type="number"
                    id={newProductPackagingId}
                    min="1"
                    value={newProductDpv}
                    onChange={e => setNewProductDpv(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full text-xs font-bold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:border-[#5C2D91]"
                  />
                </div>
              </div>

              {/* Permanent allocation checkbox */}
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
                      <label htmlFor={newProductAllocId} className="text-[11px] font-semibold text-purple-900 block">
                        Initial Authorized Facility Allocation (Vials):
                      </label>
                      <input
                        type="number"
                        id={newProductAllocId}
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
                      <span>Add to Order Queue</span>
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
