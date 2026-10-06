import React, { useState, useMemo } from 'react';
import {
  Search,
  PlusCircle,
  FileSpreadsheet,
  Building2,
  CheckCircle2,
  AlertTriangle,
  XCircle
} from 'lucide-react';
import { FacilityAllocation, VaccineAllocationItem, getVaccineDosesPerVial } from '../types';

interface VaccinePositionPanelProps {
  selectedFacility?: FacilityAllocation;
  unitDisplayMode: 'both' | 'vials' | 'doses';
  setUnitDisplayMode: (mode: 'both' | 'vials' | 'doses') => void;
  onOpenTopUp: (initialVaccine?: string) => void;
  onNavigateToBlueprint?: () => void;
}

export const VaccinePositionPanel: React.FC<VaccinePositionPanelProps> = ({
  selectedFacility,
  unitDisplayMode,
  setUnitDisplayMode,
  onOpenTopUp,
  onNavigateToBlueprint
}) => {
  const [vaccineSearch, setVaccineSearch] = useState('');
  const [viewDensity, setViewDensity] = useState<'compact' | 'detailed'>('compact');

  // Filtered vaccine entries for the table
  const vaccineEntries = useMemo(() => {
    if (!selectedFacility?.vaccines) return [];
    const entries = Object.entries(selectedFacility.vaccines) as [string, VaccineAllocationItem][];
    if (!vaccineSearch.trim()) return entries;
    const q = vaccineSearch.toLowerCase().trim();
    return entries.filter(([name]) => name.toLowerCase().includes(q));
  }, [selectedFacility, vaccineSearch]);

  // Stock summary statistics
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

  return (
    <div className="bg-white border border-purple-100 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3 flex flex-col">
      {/* Panel Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#5C2D91] text-white text-[11px] font-black flex items-center justify-center flex-shrink-0">
            2
          </span>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5 flex-wrap">
              <span>Current Vaccine Position</span>
              {selectedFacility && (
                <span className="text-[11px] font-semibold text-[#5C2D91] bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                  {selectedFacility.facilityName}
                </span>
              )}
            </h4>
            {selectedFacility && (
              <p className="text-[10px] text-slate-500 font-medium">
                Cycle: <strong className="text-slate-700">{selectedFacility.cycle}</strong> &bull; Worksheet: <strong className="text-slate-700">{selectedFacility.tabName || 'Default'}</strong>
              </p>
            )}
          </div>
        </div>

        {selectedFacility && (
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            {/* View Density Mode (Compact vs Detailed) */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setViewDensity('compact')}
                className={`px-2 py-1 rounded cursor-pointer transition-all ${
                  viewDensity === 'compact'
                    ? 'bg-white text-[#5C2D91] shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Compact reference view optimized for side-by-side auditing"
              >
                Compact
              </button>
              <button
                type="button"
                onClick={() => setViewDensity('detailed')}
                className={`px-2 py-1 rounded cursor-pointer transition-all ${
                  viewDensity === 'detailed'
                    ? 'bg-white text-[#5C2D91] shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Full breakdown with carry-over, original, top-up, and distribution arithmetic history"
              >
                Full Breakdown
              </button>
            </div>

            {/* Unit display selector */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setUnitDisplayMode('both')}
                className={`px-2 py-1 rounded cursor-pointer transition-all ${
                  unitDisplayMode === 'both' ? 'bg-[#5C2D91] text-white font-black shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Display stock in both Vials and Doses"
              >
                Vials &amp; Doses
              </button>
              <button
                type="button"
                onClick={() => setUnitDisplayMode('vials')}
                className={`px-2 py-1 rounded cursor-pointer transition-all ${
                  unitDisplayMode === 'vials' ? 'bg-[#5C2D91] text-white font-black shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Display stock in Vials"
              >
                Vials
              </button>
              <button
                type="button"
                onClick={() => setUnitDisplayMode('doses')}
                className={`px-2 py-1 rounded cursor-pointer transition-all ${
                  unitDisplayMode === 'doses' ? 'bg-[#5C2D91] text-white font-black shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Display stock in Doses"
              >
                Doses
              </button>
            </div>

            {/* Action buttons */}
            <button
              type="button"
              onClick={() => {
                const firstVac = Object.keys(selectedFacility.vaccines)[0] || 'BCG';
                onOpenTopUp(firstVac);
              }}
              className="bg-purple-50 hover:bg-purple-100 text-[#5C2D91] border border-purple-200 text-[10.5px] font-bold px-2 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              title="Add or update unrelieved top-up"
            >
              <PlusCircle className="w-3 h-3" />
              <span>Top-Up</span>
            </button>

            {onNavigateToBlueprint && (
              <button
                type="button"
                onClick={onNavigateToBlueprint}
                className="bg-orange-50 hover:bg-orange-100 text-[#C55A11] text-[10.5px] font-bold px-2 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer border border-orange-200"
                title="Edit in 67-column Allocation Blueprint"
              >
                <FileSpreadsheet className="w-3 h-3 text-[#ED7D31]" />
                <span>Blueprint</span>
              </button>
            )}
          </div>
        )}
      </div>

      {selectedFacility ? (
        <>
          {/* Quick Antigen Search & Status Metric Badges */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <div className="relative flex-1 min-w-[150px] max-w-xs">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={vaccineSearch}
                onChange={e => setVaccineSearch(e.target.value)}
                placeholder="Filter antigens (e.g. BCG, OPV)..."
                className="w-full pl-8 pr-7 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-800 placeholder-slate-400 outline-none focus:border-[#5C2D91] focus:ring-1 focus:ring-[#5C2D91] transition-all"
              />
              {vaccineSearch && (
                <button
                  type="button"
                  onClick={() => setVaccineSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer text-[10px] font-bold"
                >
                  &times;
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600">
              <span className="bg-slate-100 px-2 py-0.5 rounded-md text-slate-700">
                <strong>{vaccineStats.total}</strong> Antigens
              </span>
              <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <strong>{vaccineStats.healthy}</strong> Avail
              </span>
              {vaccineStats.low > 0 && (
                <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  <strong>{vaccineStats.low}</strong> Low
                </span>
              )}
              {vaccineStats.exhausted > 0 && (
                <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-md border border-rose-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  <strong>{vaccineStats.exhausted}</strong> Out
                </span>
              )}
            </div>
          </div>

          {/* Allocation Table */}
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto border border-slate-200/90 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                {viewDensity === 'compact' ? (
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px] sticky top-0 bg-slate-100/95 backdrop-blur-xs z-10 shadow-2xs">
                    <th className="py-2 px-3">Vaccine / Product</th>
                    <th className="py-2 px-2 text-right">Total Quota</th>
                    <th className="py-2 px-2 text-right">Distributed</th>
                    <th className="py-2 px-3 text-right font-black text-slate-900">
                      {unitDisplayMode === 'both' ? 'Remaining Balance' : unitDisplayMode === 'vials' ? 'Rem (Vials)' : 'Rem (Doses)'}
                    </th>
                    <th className="py-2 px-2 text-center">Status</th>
                  </tr>
                ) : (
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px] sticky top-0 bg-slate-100/95 backdrop-blur-xs z-10 shadow-2xs">
                    <th className="py-2 px-3">Vaccine / Product</th>
                    <th className="py-2 px-2 text-right">Carry Over</th>
                    <th className="py-2 px-2 text-right">Original Alloc</th>
                    <th className="py-2 px-2 text-right">Top-Up</th>
                    <th className="py-2 px-2 text-right">Distributed</th>
                    <th className="py-2 px-3 text-right font-black text-slate-900">
                      {unitDisplayMode === 'both' ? 'Remaining Balance' : unitDisplayMode === 'vials' ? 'Rem (Vials)' : 'Rem (Doses)'}
                    </th>
                    <th className="py-2 px-2 text-center">Status</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {vaccineEntries.length === 0 ? (
                  <tr>
                    <td colSpan={viewDensity === 'compact' ? 5 : 7} className="text-center py-8 text-slate-400 text-xs">
                      {vaccineSearch ? `No vaccines matching "${vaccineSearch}"` : 'No vaccines registered for this facility.'}
                    </td>
                  </tr>
                ) : (
                  vaccineEntries.map(([vaccineName, alloc]) => {
                    const dosesPerVial = alloc.dosesPerVial || getVaccineDosesPerVial(vaccineName);
                    const carryOverVal = alloc.carryOver || 0;
                    const carryOverDoses = alloc.carryOverDoses !== undefined ? alloc.carryOverDoses : carryOverVal * dosesPerVial;

                    const origVal = alloc.original;
                    const origDoses = alloc.originalDoses !== undefined ? alloc.originalDoses : origVal * dosesPerVial;

                    const topUpVal = alloc.topUp || 0;
                    const topUpDoses = alloc.topUpDoses !== undefined ? alloc.topUpDoses : topUpVal * dosesPerVial;

                    const totalAuthorized = carryOverVal + origVal + topUpVal + (alloc.adjustment || 0);
                    const totalAuthDoses = totalAuthorized * dosesPerVial;

                    const takenVal = alloc.taken;
                    const takenDoses = alloc.takenDoses !== undefined ? alloc.takenDoses : takenVal * dosesPerVial;

                    const remVal = alloc.remaining;
                    const remDoses = alloc.remainingDoses !== undefined ? alloc.remainingDoses : remVal * dosesPerVial;

                    const isExhausted = alloc.remaining <= 0;
                    const isLow = alloc.remaining > 0 && (alloc.remaining <= 5 || alloc.remaining / (totalAuthorized || 1) <= 0.2);

                    if (viewDensity === 'compact') {
                      return (
                        <tr key={vaccineName} className="hover:bg-purple-50/40 transition-colors">
                          <td className="py-2 px-3 font-bold text-slate-900">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isExhausted ? 'bg-rose-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                              <span className="truncate">{vaccineName}</span>
                            </div>
                            <span className="text-[9.5px] text-slate-400 font-normal block pl-3.5">
                              {dosesPerVial} doses/vial
                            </span>
                          </td>
                          {/* Total Quota */}
                          <td className="py-2 px-2 text-right text-slate-700">
                            {unitDisplayMode === 'both' ? (
                              <div className="leading-tight">
                                <span className="font-semibold">{totalAuthorized}</span>
                                <span className="text-[9.5px] text-slate-400 block font-normal">({totalAuthDoses.toLocaleString()} d)</span>
                              </div>
                            ) : unitDisplayMode === 'vials' ? (
                              <span className="font-semibold">{totalAuthorized}</span>
                            ) : (
                              <span className="font-semibold">{totalAuthDoses.toLocaleString()}</span>
                            )}
                          </td>
                          {/* Distributed */}
                          <td className="py-2 px-2 text-right text-slate-600 font-mono">
                            {unitDisplayMode === 'both' ? (
                              <div className="leading-tight">
                                <span>{takenVal}</span>
                                <span className="text-[9.5px] text-slate-400 block font-normal">({takenDoses.toLocaleString()} d)</span>
                              </div>
                            ) : unitDisplayMode === 'vials' ? (
                              <span>{takenVal}</span>
                            ) : (
                              <span>{takenDoses.toLocaleString()}</span>
                            )}
                          </td>
                          {/* Remaining Balance */}
                          <td className="py-2 px-3 text-right font-black">
                            {unitDisplayMode === 'both' ? (
                              <div className="leading-tight">
                                <span className={`text-xs ${isExhausted ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-700'}`}>
                                  {remVal} <span className="text-[9px] uppercase font-bold">v</span>
                                </span>
                                <span className={`text-[9.5px] block font-semibold ${isExhausted ? 'text-rose-400' : isLow ? 'text-amber-500' : 'text-emerald-600'}`}>
                                  ({remDoses.toLocaleString()} d)
                                </span>
                              </div>
                            ) : unitDisplayMode === 'vials' ? (
                              <span className={`text-xs ${isExhausted ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-700'}`}>
                                {remVal} v
                              </span>
                            ) : (
                              <span className={`text-xs ${isExhausted ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-700'}`}>
                                {remDoses.toLocaleString()} d
                              </span>
                            )}
                          </td>
                          {/* Status Badge */}
                          <td className="py-2 px-2 text-center">
                            {isExhausted ? (
                              <span className="inline-flex items-center gap-0.5 bg-rose-100 text-rose-800 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                <XCircle className="w-2.5 h-2.5" /> Out
                              </span>
                            ) : isLow ? (
                              <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-800 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                <AlertTriangle className="w-2.5 h-2.5" /> Low
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 bg-emerald-100 text-emerald-800 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                <CheckCircle2 className="w-2.5 h-2.5" /> OK
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    }

                    // Detailed View with all 7 columns
                    return (
                      <tr key={vaccineName} className="hover:bg-purple-50/40 transition-colors">
                        <td className="py-2 px-3 font-bold text-slate-900">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isExhausted ? 'bg-rose-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                            <span className="truncate">{vaccineName}</span>
                          </div>
                          <span className="text-[9.5px] text-slate-400 font-normal block pl-3.5">
                            {dosesPerVial} doses/vial
                          </span>
                        </td>
                        {/* Carry Over */}
                        <td className="py-2 px-2 text-right text-slate-600">
                          {unitDisplayMode === 'both' ? (
                            <div className="leading-tight">
                              <span>{carryOverVal}</span>
                              <span className="text-[9.5px] text-slate-400 block font-normal">({carryOverDoses.toLocaleString()} d)</span>
                            </div>
                          ) : unitDisplayMode === 'vials' ? (
                            <span>{carryOverVal}</span>
                          ) : (
                            <span>{carryOverDoses.toLocaleString()}</span>
                          )}
                        </td>
                        {/* Original Alloc */}
                        <td className="py-2 px-2 text-right text-slate-600">
                          {unitDisplayMode === 'both' ? (
                            <div className="leading-tight">
                              <span>{origVal}</span>
                              <span className="text-[9.5px] text-slate-400 block font-normal">({origDoses.toLocaleString()} d)</span>
                            </div>
                          ) : unitDisplayMode === 'vials' ? (
                            <span>{origVal}</span>
                          ) : (
                            <span>{origDoses.toLocaleString()}</span>
                          )}
                        </td>
                        {/* Top-Up */}
                        <td className="py-2 px-2 text-right text-purple-700 font-medium">
                          {topUpVal > 0 ? (
                            unitDisplayMode === 'both' ? (
                              <div className="leading-tight">
                                <span>+{topUpVal}</span>
                                <span className="text-[9.5px] text-purple-400 block font-normal">(+{topUpDoses.toLocaleString()} d)</span>
                              </div>
                            ) : unitDisplayMode === 'vials' ? (
                              <span>+{topUpVal}</span>
                            ) : (
                              <span>+{topUpDoses.toLocaleString()}</span>
                            )
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        {/* Distributed (with arithmetic history string if available) */}
                        <td className="py-2 px-2 text-right text-slate-600 font-mono">
                          {unitDisplayMode === 'both' ? (
                            <div className="leading-tight">
                              <span>{takenVal}</span>
                              <span className="text-[9.5px] text-slate-400 block font-normal">({takenDoses.toLocaleString()} d)</span>
                              {alloc.distributionHistory && alloc.distributionHistory.length > 1 && (
                                <span className="text-[9px] text-purple-700 block font-sans" title={alloc.distributionHistory.join(' + ')}>
                                  {alloc.distributionHistory.join(' + ')}
                                </span>
                              )}
                            </div>
                          ) : unitDisplayMode === 'vials' ? (
                            <div>
                              <span>{takenVal}</span>
                              {alloc.distributionHistory && alloc.distributionHistory.length > 1 && (
                                <span className="text-[9px] text-purple-700 block font-sans" title={alloc.distributionHistory.join(' + ')}>
                                  {alloc.distributionHistory.join(' + ')}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span>{takenDoses.toLocaleString()}</span>
                          )}
                        </td>
                        {/* Remaining Balance */}
                        <td className="py-2 px-3 text-right font-black">
                          {unitDisplayMode === 'both' ? (
                            <div className="leading-tight">
                              <span className={`text-xs ${isExhausted ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-700'}`}>
                                {remVal} <span className="text-[9px] uppercase font-bold">v</span>
                              </span>
                              <span className={`text-[9.5px] block font-semibold ${isExhausted ? 'text-rose-400' : isLow ? 'text-amber-500' : 'text-emerald-600'}`}>
                                ({remDoses.toLocaleString()} d)
                              </span>
                            </div>
                          ) : unitDisplayMode === 'vials' ? (
                            <span className={`text-xs ${isExhausted ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-700'}`}>
                              {remVal} v
                            </span>
                          ) : (
                            <span className={`text-xs ${isExhausted ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-700'}`}>
                              {remDoses.toLocaleString()} d
                            </span>
                          )}
                        </td>
                        {/* Status */}
                        <td className="py-2 px-2 text-center">
                          {isExhausted ? (
                            <span className="inline-flex items-center gap-0.5 bg-rose-100 text-rose-800 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                              <XCircle className="w-2.5 h-2.5" /> Out
                            </span>
                          ) : isLow ? (
                            <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-800 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                              <AlertTriangle className="w-2.5 h-2.5" /> Low
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 bg-emerald-100 text-emerald-800 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                              <CheckCircle2 className="w-2.5 h-2.5" /> OK
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
        </>
      ) : (
        <div className="h-64 border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-center p-6 text-slate-400">
          <Building2 className="w-8 h-8 mb-2 text-slate-300" />
          <div className="text-xs font-bold text-slate-600">No Facility Selected</div>
          <div className="text-[11px] text-slate-400 max-w-xs mt-1">
            Choose a facility from the dropdown in Step 1 above to load live stock balances, remaining quotas, and historical distributions.
          </div>
        </div>
      )}
    </div>
  );
};
