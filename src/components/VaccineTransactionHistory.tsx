/**
 * Vaccine Transaction History & Audit Trail Component
 * Implements Section 12 & 13:
 * - Immutable historical ledger of all confirmed vaccine deductions
 * - Details: Facility, Vaccine, Quantity, Date/Time, CCA Advocate, Cycle, Order Source, TX ID
 * - Filters by Facility, Vaccine, and Order Source
 * - Export audit trail to Excel / CSV
 */

import React, { useState, useEffect } from 'react';
import {
  History,
  Search,
  Filter,
  Download,
  Calendar,
  Building2,
  Lock,
  RefreshCw,
  FileSpreadsheet,
  AlertCircle,
  Clock,
  ShieldCheck
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { AllocationTransaction } from '../types';

export default function VaccineTransactionHistory() {
  const [transactions, setTransactions] = useState<AllocationTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [facilityFilter, setFacilityFilter] = useState('all');
  const [vaccineFilter, setVaccineFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vaccine/transactions');
      if (res.ok) {
        const data = await res.json();
        setTransactions(data);
      }
    } catch (err) {
      console.error('Failed to load vaccine transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  const facilities = Array.from(new Set(transactions.map(t => t.facilityName).filter(Boolean)));
  const allVaccines = Array.from(
    new Set(transactions.flatMap(t => t.items.map(i => i.vaccine)).filter(Boolean))
  );

  const filtered = transactions.filter(tx => {
    const matchesSearch = tx.id.toLowerCase().includes(search.toLowerCase()) ||
      tx.facilityName.toLowerCase().includes(search.toLowerCase()) ||
      (tx.subDistrict && tx.subDistrict.toLowerCase().includes(search.toLowerCase())) ||
      (tx.district && tx.district.toLowerCase().includes(search.toLowerCase())) ||
      tx.ccaUser.toLowerCase().includes(search.toLowerCase()) ||
      tx.items.some(i => i.vaccine.toLowerCase().includes(search.toLowerCase()));

    const matchesFacility = facilityFilter === 'all' || tx.facilityName === facilityFilter;
    const matchesSource = sourceFilter === 'all' || tx.source === sourceFilter;
    const matchesVaccine = vaccineFilter === 'all' || tx.items.some(i => i.vaccine === vaccineFilter);

    return matchesSearch && matchesFacility && matchesSource && matchesVaccine;
  });

  const exportToExcel = () => {
    const rows = filtered.flatMap(tx =>
      tx.items.map(it => ({
        'Transaction ID': tx.id,
        'Date & Time': new Date(tx.timestamp).toLocaleString(),
        'Facility': tx.facilityName,
        'District': tx.district || 'General',
        'Sub-District': tx.subDistrict || '',
        'Nest': tx.nest || 'Northern Nest',
        'Cycle': tx.cycle,
        'Order Source': tx.source === 'whatsapp' ? 'WhatsApp Request' : 'FS Confirmation Only',
        'Vaccine': it.vaccine,
        'Previous Taken': it.previousTaken,
        'Deducted Quantity': it.currentOrder,
        'Remaining Balance After': it.remainingAfter,
        'CCA Advocate': tx.ccaUser
      }))
    );

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vaccine Audit Trail');
    XLSX.writeFile(wb, `Vaccine_Transactions_Audit_${Date.now()}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-[#5C2D91] text-white text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Section 12
              </span>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">
                Vaccine Allocation Audit Trail &amp; Ledger
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Immutable chain of custody for all confirmed vaccine deductions across Ghana facilities.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchTransactions}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-slate-200"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={exportToExcel}
              disabled={filtered.length === 0}
              className="bg-[#5C2D91] hover:bg-[#482372] disabled:bg-slate-300 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Export Audit Trail
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="pt-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search TX ID, facility, CCA..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-[#5C2D91]"
            />
          </div>

          <select
            value={facilityFilter}
            onChange={e => setFacilityFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-xl font-medium outline-none text-slate-700"
          >
            <option value="all">All Facilities</option>
            {facilities.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          <select
            value={vaccineFilter}
            onChange={e => setVaccineFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-xl font-medium outline-none text-slate-700"
          >
            <option value="all">All Vaccines</option>
            {allVaccines.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-xl font-medium outline-none text-slate-700"
          >
            <option value="all">All Order Sources</option>
            <option value="whatsapp">WhatsApp Order</option>
            <option value="fs_only">FS Confirmation Only</option>
          </select>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs">
          <div className="font-bold text-slate-700 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-[#5C2D91]" />
            Immutable Confirmed Transactions ({filtered.length})
          </div>
          <span className="text-slate-400">Deletion disabled by system governance</span>
        </div>

        <div className="divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-xs">
              No vaccine transactions recorded yet. Confirm orders in the Vaccine Allocation Checker to populate this ledger.
            </div>
          ) : (
            filtered.map(tx => (
              <div key={tx.id} className="p-5 hover:bg-slate-50/50 transition-colors space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#5C2D91] bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200/50">
                      {tx.id}
                    </span>
                    <span className="font-bold text-slate-900 text-sm">{tx.facilityName}</span>
                    {tx.subDistrict && (
                      <span className="text-[10px] text-indigo-700 font-semibold bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                        {tx.subDistrict}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded-full">
                      {tx.cycle}
                    </span>
                  </div>

                  <div className="text-xs text-slate-500 flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      {new Date(tx.timestamp).toLocaleString()}
                    </span>
                    <span className="font-semibold text-slate-700">CCA: {tx.ccaUser}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      tx.source === 'whatsapp' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {tx.source === 'whatsapp' ? 'WhatsApp' : 'FS Only'}
                    </span>
                  </div>
                </div>

                {/* Sub-items table */}
                <div className="bg-slate-50 border border-slate-200/70 rounded-2xl p-3">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-400 font-bold uppercase text-[10px] border-b border-slate-200/60">
                        <th className="py-1 px-2">Vaccine</th>
                        <th className="py-1 px-2 text-right">Previously Taken</th>
                        <th className="py-1 px-2 text-right font-bold text-purple-900">Current Order Deducted</th>
                        <th className="py-1 px-2 text-right font-black text-emerald-700">Remaining Balance After</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {tx.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 px-2 font-bold text-slate-900">{it.vaccine}</td>
                          <td className="py-1.5 px-2 text-right text-slate-500">{it.previousTaken}</td>
                          <td className="py-1.5 px-2 text-right font-black text-purple-900">-{it.currentOrder}</td>
                          <td className="py-1.5 px-2 text-right font-black text-emerald-700">{it.remainingAfter}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
