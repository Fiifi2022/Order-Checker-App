import ProductReceivingHints from './ProductReceivingHints';
import { authFetch } from '../utils/authFetch';
import React, { useEffect, useRef, useState } from 'react';
import VaccineScreenshotInput from './VaccineScreenshotInput';
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
  ShieldCheck,
  ClipboardCheck,
  ScanText,
  Timer,
  Zap
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
  const [inputMode, setInputMode] = useState<'text' | 'screenshot'>('text');
  const [elapsed, setElapsed] = useState(0);
  const [speedChecking, setSpeedChecking] = useState(false);
  const [speedResult, setSpeedResult] = useState<{ seconds: string; status: string } | null>(null);
  const [speedError, setSpeedError] = useState('');
  const speedRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; speedRequest.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!validating) return;
    const start = performance.now();
    setElapsed(0);
    const interval = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 100);
    return () => window.clearInterval(interval);
  }, [validating]);

  const checkSpeed = async () => {
    if (speedRequest.current) return;
    const controller = new AbortController();
    speedRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    setSpeedChecking(true);
    setSpeedResult(null);
    setSpeedError('');
    try {
      const response = await authFetch('/api/speedtest', { signal: controller.signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success || !Number.isFinite(data.durationMs)) throw new Error('Benchmark unavailable');
      if (mounted.current) setSpeedResult({ seconds: (data.durationMs / 1000).toFixed(2), status: data.status });
    } catch {
      if (mounted.current) setSpeedError('Speed check unavailable. You can continue using the checker.');
    } finally {
      window.clearTimeout(timeout);
      speedRequest.current = null;
      if (mounted.current) setSpeedChecking(false);
    }
  };

  return (
    <div className="bg-white border border-purple-100 rounded-2xl p-4 sm:p-5 shadow-sm space-y-5 flex flex-col">
      {/* Header with Clear Action */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#5C2D91] text-white text-[11px] font-black flex items-center justify-center flex-shrink-0">
            3
          </span>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Order Verification Workstation
            </h4>
            <p className="text-[10px] text-slate-500 font-medium">
              Compare incoming quantities with the facility allocation above
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
            <span className="truncate">WhatsApp + Fulfilment</span>
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
            <span className="truncate">Fulfilment Only</span>
          </button>
        </div>
      </div>

      {/* Quick 1-Click Audit Presets Toolbar */}
      <fieldset disabled={!selectedFacilityName || validating} className="bg-purple-50/50 border border-purple-100 rounded-xl p-2.5 space-y-1.5 disabled:opacity-50">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-bold text-purple-950 uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#5C2D91]" />
            {orderSource === 'fs_only' ? 'Quick FS Test Presets' : 'Quick Test Presets'} ({selectedFacilityName || 'Select a facility'}):
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
              <span>Perfect Match</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('excess')}
              className="bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test order exceeding remaining allocation"
            >
              <XCircle className="w-3 h-3 text-rose-600" />
              <span>Over Allocation</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('exhausted')}
              className="bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test ordering vaccine with 0 remaining balance"
            >
              <AlertTriangle className="w-3 h-3 text-rose-600" />
              <span>Exhausted Balance</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('mismatch')}
              className="bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test quantity mismatch between WhatsApp and FS"
            >
              <AlertCircle className="w-3 h-3 text-amber-600" />
              <span>Quantity Mismatch</span>
            </button>
            <button
              type="button"
              onClick={() => onLoadScenario('missing_unexpected')}
              className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-300 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Test missing or unexpected antigens"
            >
              <Info className="w-3 h-3 text-indigo-600" />
              <span>Missing / Extra Cargo</span>
            </button>
          </div>
        )}
      </fieldset>

      {/* Raw Text Log Inputs */}
      <div className={orderSource === 'whatsapp' ? 'grid grid-cols-1 md:grid-cols-2 gap-5' : 'space-y-3'}>
        {orderSource === 'whatsapp' ? (
          <>
            <div className="space-y-3 rounded-2xl border border-purple-100 p-4">
              <div className="flex items-center justify-between">
                <label htmlFor="vaccine-whatsapp-text" className="text-xs font-semibold text-slate-800 flex items-center gap-2">
                  <MessageSquare className="w-7 h-7 rounded-lg bg-[#25D366]/15 p-1.5 text-emerald-700" />
                  WhatsApp Customer Request
                </label>
              </div>
              <div className="inline-flex rounded-lg bg-purple-50 p-1 text-[11px] font-semibold">
                <button type="button" aria-pressed={inputMode === 'text'} onClick={() => setInputMode('text')} className={`rounded-md px-3 py-1.5 ${inputMode === 'text' ? 'bg-white text-[#5C2D91] shadow-sm' : 'text-slate-500'}`}>Paste Message Text</button>
                <button type="button" aria-pressed={inputMode === 'screenshot'} onClick={() => setInputMode('screenshot')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${inputMode === 'screenshot' ? 'bg-white text-[#5C2D91] shadow-sm' : 'text-slate-500'}`}><ScanText className="h-3 w-3" />Scan Screenshot</button>
              </div>
              {inputMode === 'screenshot' && <VaccineScreenshotInput inputText={whatsappMessage} onText={setWhatsappMessage} />}
              <textarea
                id="vaccine-whatsapp-text"
                value={whatsappMessage}
                onChange={e => setWhatsappMessage(e.target.value)}
                placeholder="Paste WhatsApp customer message here...&#10;e.g.&#10;Please dispatch for Konkoma SDA Clinic:&#10;BCG - 10&#10;OPV - 20&#10;Penta - 15"
                className="w-full min-h-52 p-4 bg-purple-50/25 border border-purple-100 rounded-xl text-xs leading-relaxed font-mono text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] transition-all resize-y"
              />
              <ProductReceivingHints scope="vaccine" text={whatsappMessage} />
              <p className="text-[11px] text-slate-500">Include the facility, vaccine names, quantities, and units. Review any scanned text before confirming.</p>
            </div>

            <div className="space-y-3 rounded-2xl border border-purple-100 p-4 flex flex-col">
              <div className="flex items-center justify-between">
                <label htmlFor="vaccine-fs-text" className="text-xs font-semibold text-slate-800 flex items-center gap-2">
                  <ClipboardCheck className="w-7 h-7 rounded-lg bg-purple-50 p-1.5 text-[#5C2D91]" />
                  Fulfilment Confirmation
                </label>
              </div>
              <span className="text-[10px] tracking-wider font-semibold text-purple-700 py-2">OFFLINE TERMINAL LOG</span>
              <textarea
                id="vaccine-fs-text"
                value={fulfillmentConfirmation}
                onChange={e => setFulfillmentConfirmation(e.target.value)}
                placeholder="Paste FS confirmation message...&#10;e.g.&#10;Facility: Konkoma SDA Clinic&#10;BCG: 10&#10;OPV: 20&#10;Penta: 15"
                className="w-full min-h-52 flex-1 p-4 bg-purple-50/25 border border-purple-100 rounded-xl text-xs leading-relaxed font-mono text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] transition-all resize-y"
              />
              <ProductReceivingHints scope="vaccine" text={fulfillmentConfirmation} />
              <p className="text-[11px] text-slate-500">Paste the packed manifest, including diluents and droppers. Quantities are checked against the request and allocation.</p>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="vaccine-fs-only-text" className="text-[10.5px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1">
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
              id="vaccine-fs-only-text"
              value={fulfillmentConfirmation}
              onChange={e => setFulfillmentConfirmation(e.target.value)}
              placeholder="Paste FS confirmation message...&#10;e.g.&#10;Facility: Walewale District Hospital&#10;BCG: 10&#10;BCG Diluent: 10&#10;OPV: 20&#10;OPV Dropper: 20&#10;Penta: 15"
              className="w-full h-56 p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] transition-all resize-none shadow-inner"
            />

            <ProductReceivingHints scope="vaccine" text={fulfillmentConfirmation} />
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
      <div className="pt-4 border-t border-purple-100 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch gap-3">
        <button
          type="button"
          onClick={onValidate}
          disabled={validating || (!selectedFacilityId && !detectedFacilityId)}
          className="flex-1 bg-[#5C2D91] hover:bg-[#3B1A5E] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-sm py-3.5 px-4 rounded-xl transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2 cursor-pointer"
        >
          {validating ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Auditing Order Logs... ({elapsed.toFixed(1)}s)</span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4" />
              <span>
                {orderSource === 'fs_only'
                  ? 'Audit Fulfilment & Update Blueprint'
                  : 'Audit Vaccines & Update Blueprint'}
              </span>
            </>
          )}
        </button>
        <button type="button" onClick={() => void checkSpeed()} disabled={speedChecking} className="inline-flex items-center justify-center gap-2 rounded-xl border border-purple-200 px-4 py-3 text-xs font-semibold text-[#5C2D91] hover:bg-purple-50 disabled:opacity-60">
          {speedChecking ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {speedChecking ? 'Checking Speed...' : 'Check Speed'}
        </button>
        </div>
        {speedResult && <p role="status" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${speedResult.status === 'Excellent' ? 'bg-emerald-50 text-emerald-700' : speedResult.status === 'Good' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-800'}`}><Timer className="h-3.5 w-3.5" />{speedResult.seconds}s · {speedResult.status}</p>}
        {speedError && <p role="status" className="text-xs text-amber-800">{speedError}</p>}
        <div className="text-[10px] text-slate-500 text-center flex items-center justify-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-600" />
          <span>Exhaustive checks: Facility mismatch, over-allocation, exhausted balance, missing diluents/droppers.</span>
        </div>
      </div>
    </div>
  );
};
