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

export async function backendRequest(baseUrl, endpoint, options = {}) {
  const token = await getToken();
  try {
    return await fetchJson(`${baseUrl}${endpoint}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    }, endpoint === '/api/verify' ? 180000 : 90000);
  } catch (error) {
    if (error.status === 401) await signOut();
    throw error;
  }
}
