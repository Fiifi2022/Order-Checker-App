import { useState } from 'react';
import type { CatalogProduct } from '../../shared/productCatalog';
import type { CatalogHealthReport } from '../../shared/catalogHealth';

export default function CatalogHealthPanel({report,products,canEdit,onEdit,onAliases}:{
  report:CatalogHealthReport;products:CatalogProduct[];canEdit:boolean;onEdit:(product:CatalogProduct)=>void;onAliases:()=>void;
}) {
  const [query,setQuery]=useState(''),[severity,setSeverity]=useState('all');
  const issues=report.issues.filter(issue=>(severity==='all'||issue.severity===severity) &&
    [issue.title,...issue.labels,...products.filter(product=>issue.productIds.includes(product.id)).map(product=>product.name)].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <section aria-label="Catalogue health check" className="border border-purple-200 rounded-xl p-4 mb-4 space-y-3">
    <h3 className="font-bold text-purple-900">Catalogue health check</h3>
    <p className="text-sm">{report.productCount} products · {report.errorCount} conflicts or errors · {report.warningCount} items to review · {report.pendingAliasCount} pending aliases</p>
    <p className="text-xs text-slate-600">Findings describe catalogue data, not order discrepancies. Verify ownership before changing aliases. Different clinical products remain separate.</p>
    <div className="flex flex-wrap gap-2"><input aria-label="Search catalogue health findings" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search finding, product or alias" className="border rounded-lg p-2 text-sm flex-1 min-w-40"/>
      <select aria-label="Catalogue health severity" value={severity} onChange={event=>setSeverity(event.target.value)} className="border rounded-lg p-2 text-sm"><option value="all">All findings</option><option value="error">Conflicts and errors</option><option value="warning">Review items</option></select>
      <button type="button" onClick={onAliases} className="border rounded-lg p-2 text-sm">Review alias approvals</button>
    </div>
    <div className="max-h-80 overflow-y-auto space-y-2">{issues.map(issue=><article key={issue.id} className={`border rounded-lg p-3 text-sm space-y-2 ${issue.severity==='error'?'border-red-200 bg-red-50':'border-amber-200 bg-amber-50'}`}>
      <h4 className="font-semibold">{issue.title}</h4>
      {!!issue.labels.length&&<p className="break-words">Wording: {issue.labels.join(' · ')}</p>}
      <p>{issue.explanation}</p>
      <ul className="space-y-1">{products.filter(product=>issue.productIds.includes(product.id)).map((product,index)=><li key={`${product.id}:${index}`} className="flex flex-wrap gap-2 items-center">
        <span>{product.displayName || product.name} · {product.scope==='general'?'General Auditor':'Vaccine Checker'}</span>
        <button type="button" onClick={()=>onEdit(product)} disabled={issue.code==='duplicate_id'} className="underline text-purple-900 disabled:opacity-50">{canEdit?'Review product':'View product'}</button>
      </li>)}</ul>
    </article>)}{!issues.length&&<p className="text-sm text-slate-600">{report.issues.length?'No findings match this filter.':'No catalogue conflicts found by these checks.'}</p>}</div>
  </section>;
}
