import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '../utils/authFetch';
import type { CatalogProduct } from '../../shared/productCatalog';
import { productReceivingHints } from '../utils/productReceivingHints';

export default function ProductReceivingHints({ text, scope }: { text: string; scope: CatalogProduct['scope'] }) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let request: AbortController | undefined;
    const load = async () => {
      request?.abort(); const controller = new AbortController(); request = controller;
      try {
        const response = await authFetch('/api/products', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Catalog unavailable');
        const data = await response.json();
        if (!controller.signal.aborted) { setProducts(data.products); setUnavailable(false); }
      } catch { if (!controller.signal.aborted) { setProducts([]); setUnavailable(true); } }
    };
    void load();
    window.addEventListener('product-catalog-updated', load);
    window.addEventListener('focus', load);
    return () => { request?.abort(); window.removeEventListener('product-catalog-updated', load); window.removeEventListener('focus', load); };
  }, []);
  const hints = useMemo(() => productReceivingHints(text, scope, products), [text, scope, products]);
  if (!text.trim()) return null;
  if (unavailable) return <p role="status" className="text-xs text-amber-800">Product receiving reminders unavailable. Reload to retry.</p>;
  if (!hints.length) return null;
  return <aside aria-label="Product receiving reminders" role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 space-y-3">
    <p className="font-semibold">Fulfillment System reminders</p>
    {hints.map(product => <div key={product.id}>
      <p className="font-semibold">{product.displayName || product.name}</p>
      {product.fulfillmentSystemName && <p>System name: {product.fulfillmentSystemName}</p>}
      {product.receivingDetails && <p className="whitespace-pre-wrap">{product.receivingDetails}</p>}
    </div>)}
  </aside>;
}
