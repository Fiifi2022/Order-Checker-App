const styles: Record<string, string> = {
  Vaccine: 'bg-teal-50 text-teal-800 border-teal-200',
  'Vaccine Companion': 'bg-cyan-50 text-cyan-800 border-cyan-200',
  'Medical Product': 'bg-blue-50 text-blue-800 border-blue-200',
  'Blood Product': 'bg-rose-50 text-rose-800 border-rose-200',
  Consumable: 'bg-amber-50 text-amber-800 border-amber-200',
  'Diagnostic Product': 'bg-violet-50 text-violet-800 border-violet-200',
};

export default function GeneralProductCategoryBadge({ category }: { category?: string }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles[category || ''] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
    {category || 'Other Product'}
  </span>;
}
