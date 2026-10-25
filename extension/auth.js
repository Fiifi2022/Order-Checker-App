import { extensionConfig } from './config.js';
import { fetchJson } from './backend.js';

// Session storage survives closing the popup and is unavailable to content scripts.
// Neither the password nor any server credentials are stored in the extension.
export async function signOut() {
  await chrome.storage.session.remove('authSession');
}

export async function signIn(email, password) {
  const data = await fetchJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${extensionConfig.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }, 30000);
  await chrome.storage.session.set({ authSession: {
    idToken: data.idToken, refreshToken: data.refreshToken, email: data.email,
    expiresAt: Date.now() + Number(data.expiresIn) * 1000,
  } });
}

export async function getToken() {
  const { authSession } = await chrome.storage.session.get('authSession');
  if (!authSession) throw new Error('Sign in with your approved portal account first.');
  if (authSession.expiresAt > Date.now() + 60000) return authSession.idToken;
  try {
    const data = await fetchJson(`https://securetoken.googleapis.com/v1/token?key=${extensionConfig.firebaseApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: authSession.refreshToken }).toString(),
    }, 30000);
    await chrome.storage.session.set({ authSession: {
      ...authSession, idToken: data.id_token, refreshToken: data.refresh_token,
      expiresAt: Date.now() + Number(data.expires_in) * 1000,
    } });
    return data.id_token;
  } catch (error) {
    if (error.status === 400 || error.status === 401) await signOut();
    throw error;
  }
}

export async function backendRequest(baseUrl, endpoint, options = {}, timeoutMs) {
  const audit = ['/api/verify', '/api/vaccine/validate'].includes(endpoint);
  const configured = Number(extensionConfig.auditTimeoutMs);
  const auditLimit = Number.isFinite(configured) && configured >= 4000 && configured <= 60000 ? configured : 20000;
  const limit = timeoutMs ?? (audit ? auditLimit : 90000);
  const started = Date.now();
  let tokenTimer;
  let cancelToken;
  const cancelled = new Promise((_, reject) => { cancelToken = () => reject(new Error('Audit cancelled.')); });
  if (audit) options.signal?.addEventListener('abort', cancelToken, { once: true });
  if (audit && options.signal?.aborted) cancelToken();
  try {
    const token = audit ? await Promise.race([getToken(), cancelled, new Promise((_, reject) => {
      tokenTimer = setTimeout(() => reject(new Error('The audit could not be completed within the available processing time. Please retry.')), limit);
    })]) : await getToken();
    clearTimeout(tokenTimer);
    return await fetchJson(`${baseUrl}${endpoint}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    }, audit ? Math.max(1, limit - (Date.now() - started)) : limit);
  } catch (error) {
    if (error.status === 401) await signOut();
    throw error;
  } finally {
    clearTimeout(tokenTimer);
    options.signal?.removeEventListener('abort', cancelToken);
  }
}
