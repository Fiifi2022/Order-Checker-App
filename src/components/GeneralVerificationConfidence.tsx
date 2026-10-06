import type { GeneralAuditCheckSummary } from '../utils/generalAuditTypes';

export default function GeneralVerificationConfidence({ summary, pendingOrderLimits = 0 }: {
  summary: GeneralAuditCheckSummary;
  pendingOrderLimits?: number;
}) {
  const matched = summary.confidence === 100 && summary.discrepancyCount === 0 && pendingOrderLimits === 0;
  const label = summary.discrepancyCount > 0 ? 'DISCREPANCY DETECTED' : matched ? 'SYSTEM MATCH' : 'REVIEW REQUIRED';
  const color = matched ? '#22C55E' : summary.confidence >= 75 ? '#F59E0B' : '#EF4444';
  const textColor = matched ? 'text-green-600' : summary.confidence >= 75 ? 'text-amber-600' : 'text-red-600';
  return <div className="bg-white p-5 rounded-2xl border border-purple-100 shadow-sm flex flex-col items-center text-center">
    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Verification Confidence</span>
    <div className="relative flex items-center justify-center my-4" title={`${summary.passedChecks} of ${summary.totalChecks} checks passed`}>
      <svg className="w-32 h-32 transform -rotate-90" role="img" aria-label={`${summary.confidence}% ${label}`}>
        <circle cx="64" cy="64" r="52" stroke="#F3E8FF" strokeWidth="8" fill="transparent" />
        <circle cx="64" cy="64" r="52" stroke={color} strokeWidth="8" fill="transparent"
          strokeDasharray={2 * Math.PI * 52} strokeDashoffset={2 * Math.PI * 52 * (1 - summary.confidence / 100)}
          strokeLinecap="round" className="transition-all duration-1000 ease-out" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-black ${textColor}`}>{summary.confidence}%</span>
        <span className={`text-[9px] font-mono tracking-wide uppercase ${textColor}`}>{label}</span>
      </div>
    </div>
    <p className="text-xs text-slate-500 leading-relaxed max-w-[200px]">
      Comparison of the entered facility name, orderer name, products, and quantities.
    </p>
  </div>;
}
