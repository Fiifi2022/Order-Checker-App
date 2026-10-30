import React, {useEffect, useId, useRef, useState} from 'react';
import {Check, ChevronDown} from 'lucide-react';

type Sheet = {id: string; district: string; month: string; sheetName?: string};

export default function BlueprintMonthTabs({sheets, activeSheetId, onSelect}: {
  sheets: Sheet[];
  activeSheetId: string;
  onSelect: (id: string) => void;
}) {
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const id = useId();
  const months = new Map<string, Sheet[]>();
  for (const sheet of sheets) {
    const month = sheet.month.trim() || 'Month not specified';
    months.set(month, [...(months.get(month) || []), sheet]);
  }

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpenMonth(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  return <div ref={container} aria-label="Allocation Blueprint worksheets" className="relative z-20 flex min-w-0 flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-2 pt-2" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpenMonth(null);
  }} onKeyDown={event => {
    if (event.key === 'Escape') {
      const trigger = container.current?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]');
      setOpenMonth(null);
      trigger?.focus();
    }
  }}>
    {[...months].map(([month, districts], index) => {
      const active = districts.find(sheet => sheet.id === activeSheetId);
      const expanded = openMonth === month;
      const panelId = `${id}-month-${index}`;
      return <div key={month} className="relative min-w-0">
        <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpenMonth(expanded ? null : month)} className={`flex max-w-full items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 text-xs transition-colors ${active ? 'border-slate-300 bg-white font-bold text-[#C55A11]' : 'border-transparent text-slate-600 hover:bg-white hover:text-slate-900'}`}>
          <span>{month}</span><ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {expanded && <div id={panelId} role="group" aria-label={`Districts for ${month}`} className="absolute left-0 top-full z-30 max-h-72 w-64 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-b-lg border border-slate-200 bg-white p-1 shadow-lg">
          {districts.map(sheet => <button key={sheet.id} type="button" aria-current={sheet.id === activeSheetId ? 'page' : undefined} onClick={() => {onSelect(sheet.id); setOpenMonth(null);}} className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-orange-50 focus-visible:bg-orange-50 ${sheet.id === activeSheetId ? 'font-semibold text-[#C55A11]' : 'text-slate-700'}`}>
            <span className="min-w-0 flex-1 break-words">{sheet.district || sheet.sheetName || 'Unnamed district'}{districts.filter(other => other.district === sheet.district).length > 1 && <span className="block text-xs text-slate-500">{sheet.sheetName || sheet.id}</span>}</span>
            {sheet.id === activeSheetId && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
          </button>)}
        </div>}
      </div>;
    })}
  </div>;
}
