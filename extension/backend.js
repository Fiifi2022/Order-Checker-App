export function normalizeBackendUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Enter your OrderCheck backend URL and click Save.');
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
  const parent = options.signal;
  const cancel = () => controller.abort();
  parent?.addEventListener('abort', cancel, { once: true });
  if (parent?.aborted) cancel();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    let data;
    try { data = await response.json(); }
    catch {
      const error = new Error(`The backend returned a non-JSON response (HTTP ${response.status}). Check the service URL and server logs.`);
      error.status = response.status; throw error;
    }
    if (!response.ok) {
      const fallback = { 400: 'Invalid request. Check the order and facility.', 401: 'Sign in to continue.', 403: 'Your account cannot perform this action.', 404: 'The endpoint or record was not found. Check the backend version and selected facility.', 409: 'The order or allocation changed. Review before retrying.', 500: 'Backend error. Check the server logs.' };
      const error = new Error(typeof data.error === 'string' ? data.error : data.error?.message || fallback[response.status] || `Server returned ${response.status}.`);
      error.status = response.status;
      error.code = data.code;
      error.confirmationRequired = data.confirmationRequired === true;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The backend took too long to respond. Check that the OrderCheck server is running, then try again.');
    if (error instanceof TypeError) throw new Error('Network connection failed. Check the backend URL and connectivity, then retry the same order.');
    throw error;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
  }
}
