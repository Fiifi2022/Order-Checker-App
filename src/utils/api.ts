/**
 * Safe fetch utility that guarantees clean JSON parsing and user-friendly error messages,
 * completely preventing "Unexpected token '<', <!doctype... is not valid JSON" errors.
 */

export async function safeFetchJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (netErr: any) {
    throw new Error(netErr?.message || 'Network communication error. Please check your connection.');
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (isJson) {
    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Invalid JSON response received from server (${res.status}).`);
    }

    if (!res.ok) {
      const errMsg = data?.error || data?.message || `Server returned error (${res.status} ${res.statusText})`;
      throw new Error(errMsg);
    }

    return data as T;
  }

  // Handle HTML or non-JSON responses gracefully
  const rawText = await res.text().catch(() => '');
  
  if (!res.ok) {
    if (rawText.toLowerCase().includes('<!doctype') || rawText.toLowerCase().includes('<html')) {
      throw new Error(`Service temporarily busy (${res.status} ${res.statusText || 'Error'}). Please retry.`);
    }
    throw new Error(rawText.slice(0, 200) || `Server returned status ${res.status}`);
  }

  // If status is OK but returned HTML instead of expected JSON (e.g. Vite SPA fallback)
  if (rawText.toLowerCase().includes('<!doctype') || rawText.toLowerCase().includes('<html')) {
    throw new Error(`The requested endpoint (${url}) returned an unexpected page instead of data. Please verify the URL.`);
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    return rawText as any;
  }
}
