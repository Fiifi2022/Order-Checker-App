import React from 'react';
import {
  MessageSquare,
  FileText,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Info,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';

interface OrderSourcePanelProps {
  orderSource: 'whatsapp' | 'fs_only';
  setOrderSource: (source: 'whatsapp' | 'fs_only') => void;
  whatsappMessage: string;
  setWhatsappMessage: (msg: string) => void;
  fulfillmentConfirmation: string;
  setFulfillmentConfirmation: (msg: string) => void;
  onLoadScenario: (scenarioKey: any) => void;
  onClear: () => void;
  onValidate: () => void;
  validating: boolean;
  selectedFacilityId: string;
  selectedFacilityName?: string;
  detectedFacilityName?: string | null;
  detectedFacilityId?: string | null;
  facilityMismatch?: boolean;
  onSwitchToDetectedFacility?: () => void;
  liveBlueprintDiscrepancies?: string[];
  parsedItemsCount?: number;
  hasContent: boolean;
}

export const OrderSourcePanel: React.FC<OrderSourcePanelProps> = ({
  orderSource,
  setOrderSource,
  whatsappMessage,
  setWhatsappMessage,
  fulfillmentConfirmation,
  setFulfillmentConfirmation,
  onLoadScenario,
  onClear,
  onValidate,
  validating,
  selectedFacilityId,
  selectedFacilityName,
  detectedFacilityName,
  detectedFacilityId,
  facilityMismatch,
  onSwitchToDetectedFacility,
  liveBlueprintDiscrepancies = [],
  parsedItemsCount = 0,
  hasContent
}) => {
  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-3 flex flex-col">
      {/* Header with Clear Action */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#5C2D91] text-white text-[11px] font-black flex items-center justify-center flex-shrink-0">
            3
          </span>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Order Source &amp; Audit Input
            </h4>
            <p className="text-[10px] text-slate-500 font-medium">
              Reference live quotas on the left to verify incoming quantities
            </p>
          </div>
        </div>

        {hasContent && (
          <button
            type="button"
            id="clear-raw-logs-btn"
            onClick={onClear}
            className="px-2.5 py-1 bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-200 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
            title="Clear text inputs"
          >
            <RefreshCw className="w-3 h-3 text-slate-400 group-hover:text-rose-600" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Order Source Segmented Switcher */}
      <div className="space-y-1.5">
        <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1">
          <span>Select Audit Workflow:</span>
        </label>
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setOrderSource('whatsapp')}
            className={`py-2 px-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              orderSource === 'whatsapp'
                ? 'bg-white text-[#5C2D91] shadow-2xs ring-1 ring-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">1. WhatsApp Order</span>
          </button>
          <button
            type="button"
            onClick={() => setOrderSource('fs_only')}
            className={`py-2 px-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              orderSource === 'fs_only'
                ? 'bg-white text-[#5C2D91] shadow-2xs ring-1 ring-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">2. FS Only</span>
          </button>
        </div>
      </div>

      {/* Quick 1-Click Audit Presets Toolbar */}
      <div className="bg-purple-50/50 border border-purple-100 rounded-xl p-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-bold text-purple-950 uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#5C2D91]" />
            {orderSource === 'fs_only' ? 'Quick FS Test Presets:' : 'Quick Test Presets (Konkoma):'}
          </span>
          <span className="text-[9.5px] text-purple-700 font-medium">1-Click Auto Fill</span>
        </div>

        {orderSource === 'fs_only' ? (
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => onLoadScenario('fs_valid')}
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test valid FS confirmation matching Blueprint"
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>🟢 Valid FS</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('fs_facility_mismatch')}
              className="bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test FS specifying different facility than selected Blueprint"
            >
              <AlertCircle className="w-3 h-3 text-rose-600" />
              <span>🔴 Facility Mismatch</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('fs_excess')}
              className="bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test FS exceeding Blueprint allocation balance"
            >
              <XCircle className="w-3 h-3 text-rose-600" />
              <span>🔴 Over-Alloc</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('fs_exhausted')}
              className="bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test FS ordering product with 0 Blueprint balance"
            >
              <AlertTriangle className="w-3 h-3 text-rose-600" />
              <span>🔴 Exhausted (0)</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('fs_missing_diluent')}
              className="bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test FS missing required diluent/dropper"
            >
              <Info className="w-3 h-3 text-amber-600" />
              <span>🔴 Missing Diluent</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => onLoadScenario('valid')}
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test valid order within allocation"
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>🟢 Green</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('excess')}
              className="bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test order exceeding remaining allocation"
            >
              <XCircle className="w-3 h-3 text-rose-600" />
              <span>🔴 Over-Alloc</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('exhausted')}
              className="bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test ordering vaccine with 0 remaining balance"
            >
              <AlertTriangle className="w-3 h-3 text-rose-600" />
              <span>🔴 Exhausted</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('mismatch')}
              className="bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test quantity mismatch between WhatsApp and FS"
            >
              <AlertCircle className="w-3 h-3 text-amber-600" />
              <span>🔴 Mismatch</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('missing_unexpected')}
              className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test missing or unexpected antigens"
            >
              <Info className="w-3 h-3 text-indigo-600" />
              <span>🔴 Missing/Extra</span>
            </button>
          </div>
        )}
      </div>

      {/* Raw Text Log Inputs */}
      <div className="space-y-3">
        {orderSource === 'whatsapp' ? (
          <>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-[#5C2D91] text-white text-[9.5px] font-black flex items-center justify-center">
                    4
                  </span>
                  Customer WhatsApp Order
                </label>
                <span className="text-[10px] text-slate-400 font-mono">BCG: 10, OPV: 20</span>
              </div>
              <textarea
                value={whatsappMessage}
                onChange={e => setWhatsappMessage(e.target.value)}
                placeholder="Paste WhatsApp customer message here...&#10;e.g.&#10;Please dispatch for Konkoma SDA Clinic:&#10;BCG - 10&#10;OPV - 20&#10;Penta - 15"
                className="w-full h-32 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] transition-all resize-none shadow-inner"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-[#5C2D91] text-white text-[9.5px] font-black flex items-center justify-center">
                    5
                  </span>
                  Fulfillment System (FS) Confirmation
                </label>
                <span className="text-[10px] text-slate-400 font-mono">FS dispatch draft</span>
              </div>
              <textarea
                value={fulfillmentConfirmation}
                onChange={e => setFulfillmentConfirmation(e.target.value)}
                placeholder="Paste FS confirmation message...&#10;e.g.&#10;Facility: Konkoma SDA Clinic&#10;BCG: 10&#10;OPV: 20&#10;Penta: 15"
                className="w-full h-32 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] transition-all resize-none shadow-inner"
              />
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1">
                <span className="w-4 h-4 rounded-full bg-[#5C2D91] text-white text-[9.5px] font-black flex items-center justify-center">
                  4
                </span>
                Fulfillment System (FS) Confirmation
              </label>
              <span className="text-[10px] text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100">
                Direct Blueprint Cross-Audit
              </span>
            </div>

            <textarea
              value={fulfillmentConfirmation}
              onChange={e => setFulfillmentConfirmation(e.target.value)}
              placeholder="Paste FS confirmation message...&#10;e.g.&#10;Facility: Walewale District Hospital&#10;BCG: 10&#10;BCG Diluent: 10&#10;OPV: 20&#10;OPV Dropper: 20&#10;Penta: 15"
              className="w-full h-56 p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] transition-all resize-none shadow-inner"
            />

            {/* Live Facility Recognition & Blueprint Discrepancy Status */}
            {fulfillmentConfirmation.trim() && (
              <div className="space-y-2">
                {/* Facility Discrepancy Alert */}
                {facilityMismatch && detectedFacilityName && (
                  <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-900 flex flex-col gap-1.5">
                    <div className="flex items-start gap-2 font-bold">
                      <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                      <span>Facility Discrepancy Detected</span>
                    </div>
                    <p className="text-[11px] text-rose-800 pl-6">
                      FS message specifies <strong className="text-rose-950 underline">{detectedFacilityName}</strong>, but the Allocation Blueprint on the left is set to <strong className="text-rose-950 underline">{selectedFacilityName || 'None'}</strong>.
                    </p>
                    {onSwitchToDetectedFacility && (
                      <button
                        type="button"
                        onClick={onSwitchToDetectedFacility}
                        className="self-start ml-6 mt-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                      >
                        Switch Blueprint to {detectedFacilityName}
                      </button>
                    )}
                  </div>
                )}

                {/* Facility Matching Confirmation */}
                {!facilityMismatch && detectedFacilityName && (
                  <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-900 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      <span>Facility in FS: <strong>{detectedFacilityName}</strong> (Aligned with Blueprint)</span>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-700 font-semibold">
                      {parsedItemsCount} items parsed
                    </span>
                  </div>
                )}

                {/* Real-time Blueprint Discrepancy Quick Preview */}
                {liveBlueprintDiscrepancies.length > 0 ? (
                  <div className="p-3 bg-rose-50 border-2 border-rose-300 rounded-xl text-xs text-rose-950 space-y-2 shadow-sm">
                    <div className="flex items-center gap-1.5 font-black text-rose-900 text-[11px] uppercase tracking-wider">
                      <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 animate-bounce" />
                      <span>{liveBlueprintDiscrepancies.length} Discrepancy(ies) against Blueprint Allocation:</span>
                    </div>
                    <ul className="space-y-1 text-[11px] pl-2 text-rose-900 font-medium">
                      {liveBlueprintDiscrepancies.map((d, i) => (
                        <li key={i} className="flex items-start gap-1.5 leading-tight">
                          <span className="text-rose-500 font-black">•</span>
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="p-2.5 bg-purple-50/70 border border-purple-100 rounded-xl text-[10.5px] text-purple-900 flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 text-[#5C2D91] flex-shrink-0 mt-0.5" />
                    <span>Auditing FS Confirmation directly against the facility's live allocation limits on the left. Click below to run the comprehensive audit.</span>
                  </div>
                )}
              </div>
            )}

            {!fulfillmentConfirmation.trim() && (
              <div className="p-2.5 bg-purple-50/70 border border-purple-100 rounded-xl text-[10.5px] text-purple-900 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 text-[#5C2D91] flex-shrink-0 mt-0.5" />
                <span>Auditing FS Confirmation directly against the facility's live allocation limits on the left. Include "Facility: &lt;Name&gt;" or select a facility from the blueprint.</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Audit Action Button */}
      <div className="pt-2 border-t border-slate-100 space-y-2">
        <button
          type="button"
          onClick={onValidate}
          disabled={validating || (!selectedFacilityId && !detectedFacilityId)}
          className="w-full bg-[#5C2D91] hover:bg-[#482372] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-xs py-3 px-4 rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 cursor-pointer"
        >
          {validating ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Auditing FS Order Against Allocation Blueprint...</span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4" />
              <span>
                {orderSource === 'fs_only'
                  ? 'Audit FS Confirmation Against Allocation Blueprint'
                  : 'Audit Order Against Allocation'}
              </span>
            </>
          )}
        </button>
        <div className="text-[10px] text-slate-500 text-center flex items-center justify-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-600" />
          <span>Exhaustive checks: Facility mismatch, over-allocation, exhausted balance, missing diluents/droppers.</span>
        </div>
      </div>
    </div>
  );
};
