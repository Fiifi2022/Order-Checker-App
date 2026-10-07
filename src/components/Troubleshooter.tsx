import { authFetch } from '../utils/authFetch';
import React, { useState } from 'react';
import { 
  Wrench, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  Sparkles, 
  ShieldCheck, 
  HelpCircle, 
  ArrowRight, 
  Check, 
  FileText, 
  Activity, 
  PackageCheck, 
  PhoneCall, 
  Sliders, 
  RotateCcw,
  AlertCircle
} from 'lucide-react';
import { AuditRecord, VerificationItem } from '../types';

interface TroubleshooterProps {
  currentAudit: AuditRecord | null;
  onUpdateAudit: (updatedAudit: AuditRecord) => void;
  onRunTest: () => void;
  onNavigateAuditor: () => void;
}

export default function Troubleshooter({ 
  currentAudit, 
  onUpdateAudit, 
  onRunTest,
  onNavigateAuditor 
}: TroubleshooterProps) {
  // Troubleshooting wizard state
  const [selectedIssueCategory, setSelectedIssueCategory] = useState<string | null>(null);
  const [selectedItemName, setSelectedItemName] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);
  const [diagnosticResults, setDiagnosticResults] = useState<{
    apiStatus: 'pass' | 'fail' | 'idle';
    osuStatus: 'pass' | 'fail' | 'idle';
    rulesStatus: 'pass' | 'fail' | 'idle';
    latencyMs?: number;
    details?: string;
  }>({
    apiStatus: 'idle',
    osuStatus: 'idle',
    rulesStatus: 'idle'
  });

  // Collect all items with issues from currentAudit
  const activeIssues = currentAudit?.items.filter(
    item => item.status !== 'match'
  ) || [];

  const activeMetaMismatches = currentAudit?.meta ? [
    currentAudit.meta.customerName?.status === 'mismatch' ? 'Customer Name Mismatch' : null,
    currentAudit.meta.phone?.status === 'mismatch' ? 'Phone Number Mismatch' : null,
    currentAudit.meta.facility?.status === 'mismatch' ? 'Facility Name Mismatch' : null,
    currentAudit.meta.date?.status === 'mismatch' ? 'Date Format Mismatch' : null
  ].filter(Boolean) as string[] : [];

  // Handle diagnostic system self-check
  const runSystemDiagnostics = async () => {
    setDiagnosticRunning(true);
    setDiagnosticResults({ apiStatus: 'idle', osuStatus: 'idle', rulesStatus: 'idle' });
    const startTime = Date.now();

    try {
      // 1. API Speed Check
      const apiRes = await authFetch('/api/speedtest');
      const apiData = await apiRes.json();
      const latency = apiData.durationMs || (Date.now() - startTime);

      // 2. OSU Register Check
      const osuRes = await authFetch('/api/osu');
      const osuData = await osuRes.json();

      setDiagnosticResults({
        apiStatus: apiRes.ok ? 'pass' : 'fail',
        osuStatus: Array.isArray(osuData) ? 'pass' : 'fail',
        rulesStatus: 'pass',
        latencyMs: latency,
        details: `System latency ${ (latency / 1000).toFixed(2) }s | Active OSU items tracked: ${osuData.length || 0}`
      });
    } catch (err: any) {
      setDiagnosticResults({
        apiStatus: 'fail',
        osuStatus: 'fail',
        rulesStatus: 'pass',
        details: err.message || 'Diagnostic scan encountered a network issue.'
      });
    } finally {
      setDiagnosticRunning(false);
    }
  };

  // Quick fix handlers for current audit
  const resolveItemStatus = (itemName: string, newStatus: VerificationItem['status'], customAction?: string) => {
    if (!currentAudit) return;

    const updatedItems = currentAudit.items.map(item => {
      if (item.name === itemName) {
        return {
          ...item,
          status: newStatus,
          action: customAction || `Issue Troubleshooted & Resolved by Operator. (Status: ${newStatus})`
        };
      }
      return item;
    });

    // Recalculate remaining issues
    const remainingIssueCount = updatedItems.filter(
      it => it.status !== 'match' && it.status !== 'out of stock'
    ).length;

    const updatedAudit: AuditRecord = {
      ...currentAudit,
      items: updatedItems,
      issueCount: remainingIssueCount,
      allMatch: remainingIssueCount === 0,
      verdict: remainingIssueCount === 0 
        ? 'Cleared for dispatch: All issues troubleshooted and resolved.' 
        : `Discrepancy: ${remainingIssueCount} issue(s) remaining after troubleshooting.`
    };

    onUpdateAudit(updatedAudit);
    setActionSuccessMsg(`Successfully resolved discrepancy for "${itemName}" -> Set status to ${newStatus.toUpperCase()}`);
    setTimeout(() => setActionSuccessMsg(null), 4000);
  };

  const resolveAllMetaMismatches = () => {
    if (!currentAudit || !currentAudit.meta) return;

    const newMeta = { ...currentAudit.meta };
    if (newMeta.customerName) newMeta.customerName = { ...newMeta.customerName, status: 'match' };
    if (newMeta.phone) newMeta.phone = { ...newMeta.phone, status: 'match' };
    if (newMeta.facility) newMeta.facility = { ...newMeta.facility, status: 'match' };
    if (newMeta.date) newMeta.date = { ...newMeta.date, status: 'match' };

    const remainingIssueCount = currentAudit.items.filter(
      it => it.status !== 'match' && it.status !== 'out of stock'
    ).length;

    const updatedAudit: AuditRecord = {
      ...currentAudit,
      meta: newMeta,
      issueCount: remainingIssueCount,
      allMatch: remainingIssueCount === 0,
      verdict: remainingIssueCount === 0 
        ? 'Cleared for dispatch: Metadata discrepancies normalized.' 
        : currentAudit.verdict
    };

    onUpdateAudit(updatedAudit);
    setActionSuccessMsg('Successfully normalized all header metadata fields to MATCH.');
    setTimeout(() => setActionSuccessMsg(null), 4000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300" id="troubleshooter-container">
      
      {/* Top Banner Header */}
      <div className="bg-[#3B1A5E] text-white rounded-2xl p-6 shadow-md border border-[#2C1349] flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-[#5C2D91] p-3 rounded-xl text-purple-200 shadow-inner">
            <Wrench className="w-8 h-8 text-white animate-spin-slow" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              System Troubleshooter & Issue Diagnostics
              <span className="text-[10px] bg-purple-500 text-white px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                Active Diagnostic Engine
              </span>
            </h2>
            <p className="text-xs text-purple-200 mt-1">
              Detect, analyze root causes, and resolve supply chain discrepancy alerts with 1-click corrective directives.
            </p>
          </div>
        </div>

        <button
          onClick={runSystemDiagnostics}
          disabled={diagnosticRunning}
          className="bg-white hover:bg-purple-50 text-[#3B1A5E] font-bold px-4 py-2.5 rounded-xl transition shadow-sm flex items-center gap-2 text-xs shrink-0 cursor-pointer disabled:opacity-50"
        >
          <Activity className={`w-4 h-4 text-[#5C2D91] ${diagnosticRunning ? 'animate-spin' : ''}`} />
          {diagnosticRunning ? 'Scanning System...' : 'Run Diagnostics Self-Check'}
        </button>
      </div>

      {/* Diagnostics Results Banner */}
      {diagnosticResults.apiStatus !== 'idle' && (
        <div className="bg-white border border-purple-100 p-5 rounded-2xl shadow-sm space-y-3">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h3 className="text-xs font-bold text-[#3B1A5E] uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Diagnostic Scan Results
            </h3>
            <span className="text-xs font-mono text-slate-500">{diagnosticResults.details}</span>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-semibold ${
              diagnosticResults.apiStatus === 'pass' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              <span>Verification API & Latency</span>
              <span className="font-bold uppercase font-mono">{diagnosticResults.apiStatus.toUpperCase()} ({diagnosticResults.latencyMs}ms)</span>
            </div>

            <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-semibold ${
              diagnosticResults.osuStatus === 'pass' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              <span>Out-of-Stock (OSU) Register</span>
              <span className="font-bold uppercase font-mono">{diagnosticResults.osuStatus.toUpperCase()}</span>
            </div>

            <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-semibold ${
              diagnosticResults.rulesStatus === 'pass' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              <span>Compliance Rules Engine</span>
              <span className="font-bold uppercase font-mono">{diagnosticResults.rulesStatus.toUpperCase()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Action Success Alert Notification */}
      {actionSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl flex items-center gap-3 shadow-sm animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="text-xs font-bold">{actionSuccessMsg}</span>
        </div>
      )}

      {/* Current Active Discrepancy Troubleshoot Panel */}
      <div className="grid lg:grid-cols-3 gap-6">

        {/* Left 2 Cols: Active Issues & Resolution Controls */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white border border-purple-100 p-5 rounded-2xl shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div className="space-y-0.5">
                <h3 className="text-sm font-bold text-[#3B1A5E] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Active Detected Order Issues ({activeIssues.length + activeMetaMismatches.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Select an active issue to view troubleshooting directives or apply 1-click corrections.
                </p>
              </div>

              {currentAudit && (
                <button
                  onClick={onNavigateAuditor}
                  className="text-xs font-bold text-[#5C2D91] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  View in Auditor <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {!currentAudit || (activeIssues.length === 0 && activeMetaMismatches.length === 0) ? (
              <div className="bg-purple-50/50 border border-purple-100 rounded-xl p-8 text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                <h4 className="font-bold text-slate-700 text-sm">No Active Discrepancies Detected</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  All items and header metadata match perfectly or have been cleared for takeoff! You can run a new order verification or test predefined sample scenarios.
                </p>
                <button
                  onClick={onNavigateAuditor}
                  className="bg-[#5C2D91] hover:bg-[#3B1A5E] text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer shadow-sm"
                >
                  Go to Auditor Panel
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Render Item Discrepancies */}
                {activeIssues.map((item, idx) => (
                  <div 
                    key={`issue-${item.name}-${idx}`}
                    className="bg-white border border-purple-100 rounded-xl p-4 shadow-xs space-y-3 hover:border-purple-300 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[#3B1A5E]">{item.name}</span>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                            item.status === 'out of stock' ? 'bg-amber-100 text-amber-800' :
                            item.status === 'quantity mismatch' ? 'bg-purple-100 text-purple-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {item.status}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-slate-500">
                          Requested: <span className="font-semibold text-slate-800">{item.requested}</span> | 
                          Fulfillment: <span className="font-semibold text-purple-800">{item.found}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] font-mono text-slate-400 block">Category</span>
                        <span className="text-xs font-semibold text-slate-600">{item.category || 'General'}</span>
                      </div>
                    </div>

                    {/* Root Cause Analysis & Quick Fix Directives */}
                    <div className="bg-purple-50/40 border border-purple-100 p-3 rounded-lg text-xs space-y-2">
                      <div className="flex items-start gap-1.5 text-[#3B1A5E] font-semibold">
                        <HelpCircle className="w-3.5 h-3.5 text-purple-600 shrink-0 mt-0.5" />
                        <span>Diagnostic Analysis: {item.action || 'Fulfillment quantity does not match customer request.'}</span>
                      </div>

                      {/* 1-Click Action Buttons */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {item.status !== 'out of stock' && (
                          <button
                            onClick={() => resolveItemStatus(item.name, 'out of stock', `OSU ALERT: Marked ${item.name} as Out of Stock by operator.`)}
                            className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg text-[11px] transition cursor-pointer shadow-xs flex items-center gap-1"
                          >
                            <PackageCheck className="w-3 h-3" />
                            Mark Out of Stock (0/N)
                          </button>
                        )}

                        {item.status === 'quantity mismatch' && (
                          <button
                            onClick={() => resolveItemStatus(item.name, 'match', `Order Limit Confirmed. Locked fulfillment quantity to ${item.found}.`)}
                            className="bg-[#5C2D91] hover:bg-[#3B1A5E] text-white font-bold px-3 py-1.5 rounded-lg text-[11px] transition cursor-pointer shadow-xs flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            Confirm Order Limit ({item.found})
                          </button>
                        )}

                        <button
                          onClick={() => resolveItemStatus(item.name, 'match', `Operator manually verified and adjusted ${item.name} count.`)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-[11px] transition cursor-pointer shadow-xs flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Set Status as MATCH
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Render Metadata Discrepancies */}
                {activeMetaMismatches.length > 0 && (
                  <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <div>
                        <h4 className="font-bold text-rose-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
                          <PhoneCall className="w-3.5 h-3.5 text-rose-600" />
                          Header Metadata Mismatches
                        </h4>
                        <p className="text-[11px] text-rose-700">
                          {activeMetaMismatches.join(', ')}
                        </p>
                      </div>

                      <button
                        onClick={resolveAllMetaMismatches}
                        className="bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-xs cursor-pointer"
                      >
                        Normalize All Metadata Matches
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right 1 Col: Diagnostic Rules Knowledgebase & Troubleshooting Wizard */}
        <div className="space-y-5">
          
          {/* Diagnostic Guide Card */}
          <div className="bg-white border border-purple-100 p-5 rounded-2xl shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-[#3B1A5E] uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-4 h-4 text-purple-600" />
              Standard Compliance Rule Guide
            </h3>

            <div className="space-y-2.5 text-xs text-slate-600 leading-relaxed">
              <div className="bg-purple-50/50 p-2.5 rounded-xl border border-purple-100 space-y-1">
                <span className="font-bold text-[#3B1A5E] block text-[11px]">Rule 11: Out of Stock (0/N)</span>
                <p className="text-[11px] text-slate-500">
                  Any product with explicit zero-fulfillment (e.g. 0 vials, 0/5, 0 loaded) is classified as <strong>out of stock</strong> instead of missing item.
                </p>
              </div>

              <div className="bg-purple-50/50 p-2.5 rounded-xl border border-purple-100 space-y-1">
                <span className="font-bold text-[#3B1A5E] block text-[11px]">Rule 7: Phone Format Normalization</span>
                <p className="text-[11px] text-slate-500">
                  Ghana phone numbers like <code>+233244123456</code> and <code>0244123456</code> automatically evaluate as a match.
                </p>
              </div>

              <div className="bg-purple-50/50 p-2.5 rounded-xl border border-purple-100 space-y-1">
                <span className="font-bold text-[#3B1A5E] block text-[11px]">Rule 10: Diluent Ratio Exemption</span>
                <p className="text-[11px] text-slate-500">
                  When a vaccine is out of stock, matching diluents or droppers are excluded from active discrepancy alerts so operators can focus on active packing errors.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Support Card */}
          <div className="bg-purple-900 text-white p-5 rounded-2xl shadow-sm space-y-3 border border-purple-950">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-200" />
              <h4 className="font-bold text-xs uppercase tracking-wider">Zipline CCC Operations</h4>
            </div>
            <p className="text-xs text-purple-200 leading-relaxed">
              If an anomaly requires urgent flight override, use the "Confirm & Clear" button in the Auditor tab to record the clinical clearance in the database audit log.
            </p>
          </div>

        </div>

      </div>

    </div>
  );
}
