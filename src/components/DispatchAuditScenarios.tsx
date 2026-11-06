import {useState} from 'react';
import {dispatchAuditScenarios, type DispatchAuditScenario} from '../data/dispatchAuditScenarios';

export default function DispatchAuditScenarios({onSelect}: {onSelect: (scenario: DispatchAuditScenario) => void}) {
  const [category, setCategory] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const categories = [...new Set(dispatchAuditScenarios.map(scenario => scenario.category))];
  const visible = dispatchAuditScenarios.filter(scenario => category === 'all' || scenario.category === category);
  const selected = dispatchAuditScenarios.find(scenario => scenario.id === selectedId);
  return (
    <section aria-labelledby="dispatch-scenarios-heading" className="bg-purple-50/50 border border-purple-100 rounded-2xl p-4 space-y-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="dispatch-scenarios-heading" className="text-[10px] font-bold text-purple-600 tracking-wider uppercase">Interactive Dispatch Audit Scenarios</h2>
          <p className="text-xs font-semibold text-[#3B1A5E]">Examples from Scenarios fot Testing.pdf. Demo checks are labeled and excluded from KPI totals.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-purple-900">
          Category
          <select value={category} onChange={event => setCategory(event.target.value)} className="max-w-full rounded-lg border border-purple-200 bg-white px-3 py-2">
            <option value="all">All categories ({dispatchAuditScenarios.length})</option>
            {categories.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {visible.map(scenario => <button key={scenario.id} type="button" aria-pressed={selectedId === scenario.id}
          onClick={() => {setSelectedId(scenario.id); onSelect(scenario);}}
          className={`text-left rounded-xl border p-3 transition cursor-pointer ${selectedId === scenario.id ? 'bg-purple-100 border-purple-400' : 'bg-white border-purple-100 hover:bg-purple-50'}`}>
          <span className="block text-[10px] text-purple-600">{scenario.category}</span>
          <span className="block text-xs font-bold text-[#3B1A5E] mt-1">{scenario.title}</span>
        </button>)}
      </div>
      {selected && <p role="status" className="text-xs text-slate-600">{selected.description} Source: PDF {selected.sourcePages.length === 1 ? 'page' : 'pages'} {selected.sourcePages.join(', ')}.</p>}
    </section>
  );
}
