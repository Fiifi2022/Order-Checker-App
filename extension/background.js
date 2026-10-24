// extension/fs-origins.js
function fsOrigins(config, manifest) {
  const patterns = manifest?.content_scripts?.filter((script) => script.js?.includes("fs-content.js")).flatMap((script) => script.matches || []) || [];
  const configured = Array.isArray(config.fsOrigins) ? config.fsOrigins : config.fsOrigin ? [config.fsOrigin] : [];
  const candidates = patterns.length ? patterns : configured;
  return [...new Set(candidates.flatMap((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.hostname.includes("*") && !url.username && !url.password ? [url.origin] : [];
    } catch {
      return [];
    }
  }))];
}

// extension/background-entry.js
import { extensionConfig as extensionConfig2 } from "./config.js";

// extension/auth.js
import { extensionConfig } from "./config.js";

// extension/backend.js
async function fetchJson(url, options = {}, timeoutMs = 9e4) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const parent = options.signal;
  const cancel = () => controller.abort();
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted) cancel();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    let data;
    try {
      data = await response.json();
    } catch {
      const error = new Error(`The backend returned a non-JSON response (HTTP ${response.status}). Check the service URL and server logs.`);
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const fallback = { 400: "Invalid request. Check the order and facility.", 401: "Sign in to continue.", 403: "Your account cannot perform this action.", 404: "The endpoint or record was not found. Check the backend version and selected facility.", 409: "The order or allocation changed. Review before retrying.", 500: "Backend error. Check the server logs." };
      const error = new Error(typeof data.error === "string" ? data.error : data.error?.message || fallback[response.status] || `Server returned ${response.status}.`);
      error.status = response.status;
      error.code = data.code;
      error.confirmationRequired = data.confirmationRequired === true;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The backend took too long to respond. Check that the OrderCheck server is running, then try again.");
    if (error instanceof TypeError) throw new Error("Network connection failed. Check the backend URL and connectivity, then retry the same order.");
    throw error;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
  }
}

// extension/auth.js
async function signOut() {
  await chrome.storage.session.remove("authSession");
  await chrome.storage.local?.remove("persistedAuth");
}
async function getToken() {
  const { authSession } = await chrome.storage.session.get("authSession");
  if (!authSession) throw new Error("Sign in with your approved portal account first.");
  if (authSession.expiresAt > Date.now() + 6e4) return authSession.idToken;
  try {
    const data = await fetchJson(`https://securetoken.googleapis.com/v1/token?key=${extensionConfig.firebaseApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: authSession.refreshToken }).toString()
    }, 3e4);
    const refreshed = {
      ...authSession,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Number(data.expires_in) * 1e3
    };
    await chrome.storage.session.set({ authSession: refreshed });
    const { persistedAuth } = await chrome.storage.local?.get("persistedAuth") || {};
    if (persistedAuth) await chrome.storage.local.set({ persistedAuth: refreshed });
    return data.id_token;
  } catch (error) {
    if (error.status === 400 || error.status === 401) await signOut();
    throw error;
  }
}
async function backendRequest(baseUrl, endpoint, options = {}, timeoutMs) {
  const audit = ["/api/verify", "/api/vaccine/validate"].includes(endpoint);
  const configured = Number(extensionConfig.auditTimeoutMs);
  const auditLimit = Number.isFinite(configured) && configured >= 4e3 && configured <= 6e4 ? configured : 2e4;
  const limit = timeoutMs ?? (audit ? auditLimit : 9e4);
  const started = Date.now();
  let tokenTimer;
  let cancelToken;
  const cancelled = new Promise((_, reject) => {
    cancelToken = () => reject(new Error("Audit cancelled."));
  });
  if (audit) options.signal?.addEventListener("abort", cancelToken, { once: true });
  if (audit && options.signal?.aborted) cancelToken();
  try {
    const token = audit ? await Promise.race([getToken(), cancelled, new Promise((_, reject) => {
      tokenTimer = setTimeout(() => reject(new Error("The audit could not be completed within the available processing time. Please retry.")), limit);
    })]) : await getToken();
    clearTimeout(tokenTimer);
    return await fetchJson(`${baseUrl}${endpoint}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` }
    }, audit ? Math.max(1, limit - (Date.now() - started)) : limit);
  } catch (error) {
    if (error.status === 401) await signOut();
    throw error;
  } finally {
    clearTimeout(tokenTimer);
    options.signal?.removeEventListener("abort", cancelToken);
  }
}

// extension/fs-state.js
function cleanSelection(raw) {
  const str = (v) => typeof v === "string" ? v.trim().slice(0, 160) : "";
  const product = (p) => ({ id: str(p?.id), name: str(p?.name), quantity: str(p?.quantity) });
  return {
    facility: { id: str(raw?.facility?.id), name: str(raw?.facility?.name), district: str(raw?.facility?.district), region: str(raw?.facility?.region) },
    draft: raw?.draft?.name ? product(raw.draft) : null,
    order: Array.isArray(raw?.order) ? raw.order.slice(0, 100).map(product).filter((p) => p.name) : [],
    ...raw?.script ? { script: { orderKey: str(raw.script.orderKey), text: typeof raw.script.text === "string" ? raw.script.text : null } } : {}
  };
}
function selectionProducts(selection) {
  return [...selection.order, ...selection.draft ? [selection.draft] : []];
}

// extension/fs-messaging.js
function withTimeout(task, milliseconds = 18e3, message = "FS connection timed out. Check the extension service worker and reconnect.") {
  let timer;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(message), { code: "FS_TIMEOUT" })), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}
function respondAsync(respond, task) {
  void withTimeout(task).catch((error) => ({ error: error?.message || String(error), code: error?.code || "FS_MESSAGE_FAILED" })).then((result) => {
    try {
      respond(result);
    } catch {
    }
  });
  return true;
}
async function sendFsMessage(chromeApi, tabId, message, timeoutMs = 18e3) {
  try {
    const result = await withTimeout(() => chromeApi.tabs.sendMessage(tabId, message, { frameId: 0 }), timeoutMs);
    if (!result) throw new Error("The FS content script returned no response.");
    return result;
  } catch (cause) {
    const error = new Error(`FS content script unavailable: ${cause?.message || String(cause)}. Refresh the FS tab after reloading OrderCheck, then reconnect.`);
    error.code = cause?.code || "FS_CONTENT_UNAVAILABLE";
    throw error;
  }
}

// extension/background-entry.js
var versions = /* @__PURE__ */ new Map();
var writes = /* @__PURE__ */ new Map();
function enqueueWrite(tabId, task) {
  const pending = (writes.get(tabId) || Promise.resolve()).catch(() => {
  }).then(task);
  writes.set(tabId, pending);
  const cleanup = () => {
    if (writes.get(tabId) === pending) writes.delete(tabId);
  };
  void pending.then(cleanup, cleanup);
  return pending;
}
var persist = (tabId, state, version) => enqueueWrite(tabId, async () => {
  if (versions.get(tabId) !== version) return false;
  await chrome.storage.session.set({ [`fsContext:${tabId}`]: state });
  return versions.get(tabId) === version;
});
var allowedOrigins = fsOrigins(extensionConfig2, chrome.runtime.getManifest?.());
var allowed = (sender) => {
  try {
    return sender.tab?.id !== void 0 && allowedOrigins.includes(new URL(sender.url || sender.tab.url).origin);
  } catch {
    return false;
  }
};
async function update(tabId, selection, manualFacilityId, refresh = false) {
  const version = (versions.get(tabId) || 0) + 1;
  versions.set(tabId, version);
  const key = `fsContext:${tabId}`;
  const prior = (await chrome.storage.session.get(key))[key];
  if (versions.get(tabId) !== version) return { stale: true };
  if (manualFacilityId === void 0) manualFacilityId = JSON.stringify(prior?.selection?.facility) === JSON.stringify(selection.facility) ? prior?.manualFacilityId || "" : "";
  const identity = (s) => JSON.stringify([s.facility, selectionProducts(s).map((p) => [p.name, p.id])]);
  if (!refresh && prior?.allocation?.status === "matched" && prior.manualFacilityId === manualFacilityId && identity(prior.selection) === identity(selection)) {
    const allocation = { ...prior.allocation, products: prior.allocation.products.map((p, i) => ({ ...p, quantity: selectionProducts(selection)[i].quantity })) };
    const state2 = { ...prior, selection, allocation };
    if (versions.get(tabId) !== version) return { stale: true };
    return await persist(tabId, state2, version) ? state2 : { stale: true };
  }
  const state = { tabId, selection, manualFacilityId, loading: true, allocation: null };
  if (!await persist(tabId, state, version)) return { stale: true };
  try {
    const { customBackendUrl } = await chrome.storage.local.get("customBackendUrl");
    const base = customBackendUrl || extensionConfig2.backendUrl;
    const allocation = selection.facility.name || selection.facility.id ? await withTimeout(() => backendRequest(base, "/api/vaccine/companion/context?selection=" + encodeURIComponent(JSON.stringify({ facility: selection.facility, products: selectionProducts(selection), manualFacilityId })), {}, 1e4), 12e3, "Backend unreachable: allocation lookup timed out. Check the localhost OrderCheck server and sign-in session.") : { status: "no_facility", products: [] };
    if (versions.get(tabId) !== version) return { stale: true };
    Object.assign(state, { allocation, loading: false });
  } catch (error) {
    if (versions.get(tabId) !== version) return { stale: true };
    const message = error?.message || String(error);
    Object.assign(state, { loading: false, error: message, code: error?.status === 401 || /sign in|approved portal account/i.test(message) ? "AUTH_REQUIRED" : error?.status === 403 ? "PERMISSION_DENIED" : "BACKEND_UNREACHABLE" });
  }
  if (!await persist(tabId, state, version)) return { stale: true };
  void sendFsMessage(chrome, tabId, { type: "FS_ALLOCATION", state }).catch((error) => console.warn("FS allocation delivery failed:", error.message));
  return state;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "FS_OPEN_PANEL") {
    if (!allowed(sender)) return false;
    chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => respond({ ok: true }), (error) => respond({ error: error.message }));
    return true;
  }
  if (!["FS_SELECTION", "FS_REFRESH_ALL", "FS_MANUAL"].includes(message?.type)) return false;
  return respondAsync(respond, async () => {
    if (message.type === "FS_SELECTION" && allowed(sender)) {
      const selection = cleanSelection(message.selection);
      const key = `fsContext:${sender.tab.id}`;
      if (message.diagnostics?.formFound === false) {
        const version = (versions.get(sender.tab.id) || 0) + 1;
        versions.set(sender.tab.id, version);
        const state = {
          tabId: sender.tab.id,
          selection,
          loading: false,
          allocation: null,
          error: "FS Add New Order controls were not detected. Open Add New Order. If it is already open, the FS form adapter needs inspection."
        };
        return await persist(sender.tab.id, state, version) ? state : { stale: true };
      }
      return update(sender.tab.id, selection, void 0, message.refresh === true);
    }
    if (message.type === "FS_SELECTION") return { error: "This FS origin is not enabled in the installed extension. Reload or install the current extension package." };
    if (message.type === "FS_REFRESH_ALL" && sender.url?.startsWith(chrome.runtime.getURL(""))) {
      const saved = await chrome.storage.session.get(null);
      const deliveries = await Promise.allSettled(Object.entries(saved).filter(([key]) => key.startsWith("fsContext:")).map(([, state]) => sendFsMessage(chrome, state.tabId, { type: "FS_REFRESH" })));
      return { success: deliveries.every((result) => result.status === "fulfilled"), errors: deliveries.filter((result) => result.status === "rejected").map((result) => result.reason.message) };
    }
    if (message.type === "FS_MANUAL" && sender.url?.startsWith(chrome.runtime.getURL(""))) {
      const key = `fsContext:${message.tabId}`;
      const tab = await chrome.tabs.get(message.tabId);
      if (!allowed({ tab, url: tab.url })) return { error: "The selected tab left FS. Reconnect to the current FS tab." };
      const saved = await chrome.storage.session.get(key);
      return saved[key] ? update(message.tabId, saved[key].selection, message.facilityId) : { error: "No active FS selection. Reconnect to FS." };
    }
    return { error: "FS message sender is not authorized." };
  });
});
var clearTab = (tabId) => {
  versions.set(tabId, (versions.get(tabId) || 0) + 1);
  void enqueueWrite(tabId, () => chrome.storage.session.remove(`fsContext:${tabId}`)).catch((error) => console.warn("FS state cleanup failed:", error.message));
};
chrome.tabs.onRemoved.addListener(clearTab);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" || info.url && !allowed({ tab: { id: tabId }, url: info.url })) clearTab(tabId);
});
chrome.storage.onChanged.addListener((changes, area) => {
  const auth = changes.authSession;
  const accountChanged = auth && (!auth.oldValue || !auth.newValue || auth.oldValue.email !== auth.newValue.email);
  if (area === "session" && accountChanged || area === "local" && changes.customBackendUrl) {
    void chrome.storage.session.get(null).then(async (saved) => {
      for (const [key, state] of Object.entries(saved)) if (key.startsWith("fsContext:")) {
        versions.set(state.tabId, (versions.get(state.tabId) || 0) + 1);
        await enqueueWrite(state.tabId, () => chrome.storage.session.remove(key));
        void sendFsMessage(chrome, state.tabId, { type: "FS_REFRESH" }).catch((error) => console.warn("FS session refresh failed:", error.message));
      }
    }).catch((error) => console.warn("FS session invalidation failed:", error.message));
  }
});
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch((error) => console.warn("Side panel behavior failed:", error.message));
