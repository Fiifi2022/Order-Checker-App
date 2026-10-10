export function normalizeBackendUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Enter your Render backend URL and click Save.');
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Use HTTPS for your backend, or HTTP for localhost.');
  }
  if (url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) {
    throw new Error('Use the service base URL without a path, query, or credentials.');
  }
  return url.origin;
}

export async function fetchJson(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('The backend returned a non-JSON response. Check the service URL and Render logs.'); }
    if (!response.ok) {
      const error = new Error(typeof data.error === 'string' ? data.error : data.error?.message || `Server returned ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The backend took too long to respond. Wait for Render to start, then try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
