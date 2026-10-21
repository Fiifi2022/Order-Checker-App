import { auth } from '../firebase';
import { authFetch } from './authFetch';
import type { CatalogProduct } from '../../shared/productCatalog';

// Two order panels (and StrictMode's concurrent mount effects) share one read.
// No completed catalogue is cached and a different account never joins a read.
const pending = new WeakMap<object, Promise<CatalogProduct[]>>();
export function readProductHintCatalog(): Promise<CatalogProduct[]> {
  const account = auth.currentUser;
  if (!account) return Promise.reject(new Error('Sign in to load receiving reminders.'));
  let request = pending.get(account);
  if (!request) {
    request = authFetch('/api/products', { cache: 'no-store' }).then(async response => {
      if (!response.ok || auth.currentUser !== account) throw new Error('Catalog unavailable');
      const data = await response.json();
      if (auth.currentUser !== account) throw new Error('Account changed');
      return data.products as CatalogProduct[];
    }).finally(() => pending.delete(account));
    pending.set(account, request);
  }
  return request;
}
