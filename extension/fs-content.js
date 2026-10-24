(() => {
  // extension/fs-script.js
  function createFsScriptReader() {
    let orderRoot, orderId, generation = 0, previous, blocked;
    const hidden = (el) => el?.hidden || el?.getAttribute("aria-hidden") === "true" || el?.style?.display === "none" || el?.style?.visibility === "hidden";
    const visible = (el) => {
      for (let node = el; node; node = node.parentElement) {
        if (hidden(node)) return false;
        const style = node.ownerDocument.defaultView?.getComputedStyle?.(node);
        if (style?.display === "none" || style?.visibility === "hidden") return false;
      }
      return true;
    };
    function textOf(el) {
      if (hidden(el)) return "";
      if (el.ownerDocument.defaultView?.getComputedStyle && typeof el.innerText === "string") return el.innerText;
      const walk = (node) => {
        if (node.nodeType === 3) return node.nodeValue;
        if (node.nodeType !== 1 || hidden(node)) return "";
        if (node.tagName === "BR") return "\n";
        const text = [...node.childNodes].map(walk).join("");
        return ["P", "DIV", "LI"].includes(node.tagName) && node !== el ? text + "\n" : text;
      };
      return walk(el);
    }
    function candidate(scope) {
      const buttons = [...scope.querySelectorAll('button[aria-label="Edit script"]')].filter(visible);
      if (buttons.length !== 1) return null;
      const button = buttons[0];
      for (let action = button, depth = 0; action && action !== scope && scope.contains(action) && depth < 4; action = action.parentElement, depth++) {
        const value = action.previousElementSibling;
        if (value?.tagName !== "DIV" || !value.id || !visible(value)) continue;
        if (value.matches('[role="combobox"],[role="button"],[role="heading"]')) continue;
        if (value.querySelector('button,input,select,textarea,h1,h2,h3,h4,h5,h6,[role="heading"],[role="button"]')) continue;
        return value;
      }
      return null;
    }
    return {
      reset() {
        generation++;
        blocked = previous;
      },
      read(root) {
        let scope = root?.closest('form,[role="dialog"],main') || root;
        if (root && !scope.querySelector('button[aria-label="Edit script"]')) {
          for (let parent = scope.parentElement; parent && parent !== root.ownerDocument.body && parent !== root.ownerDocument.documentElement; parent = parent.parentElement) {
            const named = [...parent.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].some((el) => el.textContent.trim().toLowerCase() === "package & script");
            if (named && parent.querySelector('button[aria-label="Edit script"]')) {
              scope = parent;
              break;
            }
          }
        }
        const nextId = scope?.getAttribute("data-order-id") || "";
        if (scope !== orderRoot) {
          orderRoot = scope;
          orderId = nextId;
          generation++;
          blocked = null;
        } else if (nextId !== orderId) {
          orderId = nextId;
          generation++;
          blocked = previous;
        }
        if (!scope) {
          previous = null;
          return { orderKey: String(generation), text: null };
        }
        const headings = [...scope.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter((el) => el.textContent.trim().toLowerCase() === "package & script");
        let value = null;
        if (headings.length === 1) {
          for (let section = headings[0].parentElement; section && scope.contains(section); section = section.parentElement) {
            value = candidate(section);
            if (section.querySelector('button[aria-label="Edit script"]') || section === scope) break;
          }
        } else if (!headings.length) value = candidate(scope);
        const text = value ? textOf(value) : null;
        previous = value ? { node: value, text } : null;
        if (blocked && value === blocked.node && text === blocked.text) return { orderKey: String(generation), text: null };
        blocked = null;
        return { orderKey: String(generation), text };
      }
    };
  }

  // extension/fs-adapter.js
  function createFsAdapter(doc) {
    const scripts = createFsScriptReader();
    let cachedRoot;
    const labels = { Facility: ["facility", "health facility", "select facility", "selected facility"], District: ["district"], Region: ["region"], Product: ["product", "product name", "select product", "select a product", "search products", "search product"], Quantity: ["quantity", "qty", "requested quantity", "requested qty"] };
    const key = (value) => String(value || "").replace(/\s+/g, " ").trim().replace(/[\s*:]+$/, "").toLowerCase();
    const matches = (value, field) => labels[field].includes(key(value));
    const widgets = 'input:not([type="hidden"]),select,[role="combobox"],[role="spinbutton"],button[aria-haspopup="listbox"],button[aria-haspopup="true"],[role="button"][aria-haspopup="listbox"]';
    function captionValue(scope, field) {
      if (!scope) return "";
      const marked = scope.querySelector(`[data-ordercheck-${field.toLowerCase()}]`);
      if (marked) return marked.textContent.trim();
      for (const label of scope.querySelectorAll("label,dt,span,p,div")) {
        if (label.closest('table,[role="table"],[role="grid"], [role="listbox"]') || !matches(label.textContent, field) || label.querySelector(widgets)) continue;
        if ([...label.children].some((child) => matches(child.textContent, field))) continue;
        const value = label.nextElementSibling;
        if (!value || value.matches(widgets) || value.querySelector(widgets) || value.querySelector('label,dt,[role="option"]')) continue;
        const text = value.textContent.trim();
        if (text && text.length <= 160 && !Object.keys(labels).some((name) => matches(text, name))) return text;
      }
      return "";
    }
    function nearbyWidget(label, scope) {
      for (let container = label.parentElement, depth = 0; container && scope.contains(container) && depth < 2; container = container.parentElement, depth++) {
        const candidates = [...container.querySelectorAll(widgets)].filter((el) => !el.matches(":disabled"));
        if (candidates.length === 1) {
          const otherLabels = [...container.querySelectorAll("label,span,p")].filter((el) => el !== label && !el.contains(label) && !label.contains(el) && !el.closest(widgets));
          if (otherLabels.some((el) => Object.keys(labels).some((field) => matches(el.textContent, field)) && key(el.textContent) !== key(label.textContent))) return null;
          return candidates[0];
        }
        if (candidates.length > 1) return null;
      }
      return null;
    }
    function labelledWidget(label, scope) {
      const id = label.htmlFor || label.getAttribute("for");
      const target = id && doc.getElementById(id);
      if (target && scope.contains(target)) return target.matches(widgets) ? target : target.querySelector(widgets) || target;
      if (label.id) {
        const linked = [...scope.querySelectorAll(widgets)].find((el) => (el.getAttribute("aria-labelledby") || "").split(/\s+/).includes(label.id));
        if (linked) return linked;
      }
      return label.querySelector(widgets) || nearbyWidget(label, scope);
    }
    function control(scope, field) {
      if (!scope) return null;
      const marked = scope.querySelector(`[data-ordercheck-field="${field.toLowerCase()}"]`);
      if (marked) return marked;
      for (const el of scope.querySelectorAll(widgets)) {
        const name = key(el.getAttribute("name")).replace(/[_-]/g, " ");
        if (matches(el.getAttribute("aria-label"), field) || matches(name, field)) return el;
        if (matches(el.getAttribute("placeholder"), field)) return el;
        const labelIds = (el.getAttribute("aria-labelledby") || "").split(/\s+/);
        if (labelIds.some((id) => {
          const label = id && doc.getElementById(id);
          return label && matches(label.textContent, field);
        })) return el;
      }
      for (const label of scope.querySelectorAll("label")) {
        if (!matches(label.textContent, field)) continue;
        const target = labelledWidget(label, scope);
        if (target) return target;
      }
      for (const label of scope.querySelectorAll("span,p,div")) {
        if (label.closest(widgets) || !matches(label.textContent, field)) continue;
        if (label.querySelector(widgets) || [...label.children].some((child) => matches(child.textContent, field))) continue;
        const target = nearbyWidget(label, scope);
        if (target) return target;
      }
      return null;
    }
    const facilityPresent = (scope) => control(scope, "Facility") || captionValue(scope, "Facility");
    const complete = (scope) => facilityPresent(scope) && (control(scope, "Product") || table(scope) || captionValue(scope, "District") && captionValue(scope, "Region") || [...scope.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],legend')].some((heading) => ["add new order", "new order", "requested products"].includes(key(heading.textContent))));
    function root() {
      if (cachedRoot?.isConnected && complete(cachedRoot)) return cachedRoot;
      const marked = doc.querySelector('[data-ordercheck-order-form], [data-testid="add-order-form"], [data-testid="new-order-form"]');
      if (marked && facilityPresent(marked)) return cachedRoot = marked;
      const semantic = [...doc.querySelectorAll('form,[role="dialog"],main')].find(complete);
      if (semantic) return cachedRoot = semantic;
      const facility = control(doc, "Facility");
      for (let scope = facility?.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
        if (complete(scope)) return cachedRoot = scope;
      }
      for (const label of doc.querySelectorAll("label,dt,span,p,div")) {
        if (!matches(label.textContent, "Facility") || label.closest('table,[role="listbox"]')) continue;
        for (let scope = label.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
          if (complete(scope)) return cachedRoot = scope;
        }
      }
      return cachedRoot = null;
    }
    function selected(el) {
      if (!el) return { name: "", id: "" };
      const option = el.tagName === "SELECT" ? el.selectedOptions?.[0] || el.querySelector("option:checked") : el.querySelector('[aria-selected="true"],[data-selected-value],[class*="singleValue"],[class*="single-value"]');
      let rendered = option;
      const readonly = el.readOnly || el.hasAttribute("readonly");
      const valueOnly = readonly || el.getAttribute("aria-autocomplete") === "none";
      if (!rendered && el.tagName === "INPUT" && !valueOnly) {
        for (let scope = el.parentElement, depth = 0; scope && depth < 4; scope = scope.parentElement, depth++) {
          if (scope.querySelectorAll(widgets).length > 1) break;
          rendered = scope.querySelector('[class*="singleValue"],[class*="single-value"],[data-selected-value]');
          if (rendered || scope.querySelector("label")) break;
        }
      }
      const name = el.dataset.selectedName || rendered?.dataset.name || rendered?.textContent?.trim() || (el.tagName === "INPUT" ? valueOnly ? el.value : "" : el.textContent?.trim()) || "";
      return {
        name: /^(select|choose)\b/i.test(name) ? "" : name,
        id: el.dataset.selectedId || rendered?.dataset.id || (el.tagName === "SELECT" ? el.value : "") || ""
      };
    }
    function table(scope) {
      return scope?.querySelector('[data-ordercheck-requested-products],[data-testid="requested-products"],table[aria-label="Requested Products"]') || [...scope?.querySelectorAll('table,[role="table"],[role="grid"]') || []].find((t) => {
        const headers = [...t.querySelectorAll('th,[role="columnheader"]')];
        return headers.some((h) => matches(h.textContent, "Product")) && headers.some((h) => matches(h.textContent, "Quantity"));
      });
    }
    function read() {
      const scope = root();
      if (!scope) return { facility: {}, draft: null, order: [], script: scripts.read(null) };
      const facilityEl = control(scope, "Facility"), productEl = control(scope, "Product"), quantityEl = control(scope, "Quantity");
      const facilitySelection = selected(facilityEl);
      const metadata = (field, attribute) => facilityEl?.dataset[attribute] || (control(scope, field) ? selected(control(scope, field)).name : "") || captionValue(scope, field);
      const facility = { ...facilitySelection, name: facilitySelection.name || captionValue(scope, "Facility"), district: metadata("District", "district"), region: metadata("Region", "region") };
      const product = selected(productEl), requested = table(scope);
      const headers = [...requested?.querySelectorAll('th,[role="columnheader"]') || []];
      const productIndex = headers.findIndex((h) => matches(h.textContent, "Product")), quantityIndex = headers.findIndex((h) => matches(h.textContent, "Quantity"));
      const order = requested ? [...requested.querySelectorAll('tbody tr,[data-ordercheck-product-row],[role="row"]')].map((row) => {
        const cells = [...row.querySelectorAll('td,[role="cell"],[role="gridcell"]')];
        if (!row.dataset.productName && cells.length === 1 && (Number(cells[0].getAttribute("colspan")) > 1 || /^no requested products\.?$/.test(key(cells[0].textContent)))) return null;
        const productCell = row.querySelector("[data-product-name]") || cells[productIndex];
        const qtyCell = row.querySelector("[data-quantity]") || cells[quantityIndex];
        return { name: row.dataset.productName || productCell?.textContent?.trim() || "", id: row.dataset.productId || "", quantity: row.dataset.quantity || qtyCell?.querySelector("input")?.value || qtyCell?.textContent?.trim() || "" };
      }).filter((p) => p?.name) : [];
      return { facility, draft: product.name ? { ...product, quantity: quantityEl?.value || "" } : null, order, script: scripts.read(scope) };
    }
    return {
      read,
      root,
      resetOrder: () => scripts.reset(),
      isNewOrder: (target) => {
        const button = target?.closest('button,[role="button"]');
        return !!button && ["add order", "add new order", "new order"].includes(key(button.textContent));
      },
      anchor: () => {
        const scope = root();
        return control(scope, "Quantity") || control(scope, "Product");
      },
      diagnostics: () => {
        const scope = root();
        return { formFound: !!scope, facilityControl: !!facilityPresent(scope || doc), productControl: !!control(scope || doc, "Product"), quantityControl: !!control(scope || doc, "Quantity"), tableFound: !!table(scope) };
      },
      isAdd: (target) => {
        const scope = root(), button = target?.closest('button,[role="button"]');
        return !!(scope && button && scope.contains(button) && key(button.textContent) === "add");
      }
    };
  }

  // extension/fs-state.js
  function quantityStatus(quantity, balance, committed = 0) {
    if (quantity === "" || quantity === null || quantity === void 0) return "Enter a requested quantity.";
    const n = Number(quantity);
    if (!Number.isSafeInteger(n) || n <= 0) return "Invalid quantity. Enter a positive whole number.";
    if (!Number.isFinite(balance) || balance < 0) return "Allocation balance unavailable.";
    const available = Math.max(0, balance - committed);
    return n <= available ? "Within available allocation." : `Requested quantity exceeds allocation. Available: ${available}.`;
  }
  function confirmedAddition(before, after, draft) {
    if (!draft?.name || !Number.isSafeInteger(Number(draft.quantity)) || Number(draft.quantity) <= 0) return false;
    const same = (p) => draft.id && p.id ? p.id === draft.id : p.name === draft.name;
    const total = (rows) => rows.filter(same).reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
    return total(after) - total(before) === Number(draft.quantity);
  }
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
  var FS_BRIDGE_VERSION = "1.5.14";

  // extension/fs-content-entry.js
  {
    let render = function() {
      if (!host.isConnected) document.documentElement.append(host);
      const draft = selection?.draft;
      if (!draft || suppressed === JSON.stringify([selection.facility, draft])) {
        host.style.display = "none";
        return;
      }
      host.style.display = "block";
      const data = response?.allocation, product = data?.products?.[selection.order.length];
      if (product?.status === "untracked") {
        host.style.display = "none";
        return;
      }
      shadow.querySelector("strong").textContent = `${product?.canonical || draft.name} \u2014 Available: ${Number.isFinite(product?.balance) ? product.balance : "unavailable"}`;
      const committed = data?.products?.slice(0, selection.order.length).filter((p) => (p.allocationKey || p.canonical) === (product?.allocationKey || product?.canonical)).reduce((n, p) => n + (Number(p.quantity) || 0), 0) || 0;
      shadow.querySelector("small").textContent = response?.error || data?.message || product?.message || (product ? quantityStatus(draft.quantity, product.balance, committed) : "Loading current allocation\u2026");
      position();
    }, dispose = function() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      revision++;
      document.removeEventListener("input", schedule, true);
      document.removeEventListener("change", change, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      try {
        chrome.runtime.onMessage.removeListener?.(listener);
      } catch (error) {
        console.warn("FS listener context expired:", error.message);
      }
      host.remove();
      if (globalThis.__ordercheckFsBridge === bridge) delete globalThis.__ordercheckFsBridge;
    };
    try {
      globalThis.__ordercheckFsBridge?.dispose?.();
    } catch (error) {
      console.warn("Previous FS bridge cleanup failed:", error.message);
    }
    document.getElementById("ordercheck-allocation")?.remove();
    const adapter = createFsAdapter(document);
    let lastDraftIdentity = "", last = "", selection = null, pending = null, suppressed = "", response = null, timer, revision = 0, disposed = false;
    const host = document.createElement("div");
    host.id = "ordercheck-allocation";
    host.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;display:none";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = '<style>:host{font:12px system-ui}div{max-width:260px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#f8fafc;color:#0f172a;box-shadow:0 2px 6px #0002;overflow-wrap:anywhere}small{display:block;margin-top:3px}</style><div role="status" aria-live="polite"><strong></strong><small></small></div>';
    const position = () => {
      const anchor = adapter.anchor();
      if (!anchor || host.style.display === "none") return;
      const rect = anchor.getBoundingClientRect(), width = host.offsetWidth || 280, height = host.offsetHeight || 90;
      const controls = [...adapter.root().querySelectorAll('input,select,button,[role="combobox"],[role="alert"],[aria-live]')].map((el) => el.getBoundingClientRect());
      const points = [[rect.right + 10, rect.top], [rect.left - width - 10, rect.top], [rect.left, rect.bottom + 10], [rect.left, rect.top - height - 10]];
      for (let y = 8; y + height < innerHeight; y += height + 8) points.push([innerWidth - width - 8, y], [8, y]);
      const point = points.find(([x, y]) => x >= 8 && y >= 8 && x + width <= innerWidth - 8 && y + height <= innerHeight - 8 && !controls.some((r) => x < r.right + 4 && x + width > r.left - 4 && y < r.bottom + 4 && y + height > r.top - 4));
      if (point) {
        host.style.left = `${point[0]}px`;
        host.style.top = `${point[1]}px`;
      } else {
        host.style.left = "8px";
        host.style.top = "8px";
      }
    };
    async function scan(force = false) {
      if (disposed) return { error: "FS bridge was replaced. Reconnect to FS." };
      let next = cleanSelection(adapter.read());
      if (pending && JSON.stringify(next.facility) === JSON.stringify(pending.facility) && confirmedAddition(pending.order, next.order, pending.draft)) {
        suppressed = JSON.stringify([next.facility, next.draft]);
        pending = null;
      }
      if (pending && !next.draft && JSON.stringify(next.facility) === JSON.stringify(pending.facility)) next.draft = pending.draft;
      if (pending && next.draft?.name !== pending.draft?.name) pending = null;
      if (selection && JSON.stringify(selection.facility) !== JSON.stringify(next.facility)) {
        pending = null;
        suppressed = "";
      }
      const draftIdentity = JSON.stringify([next.draft?.name, next.draft?.id]);
      if (lastDraftIdentity && lastDraftIdentity !== draftIdentity) suppressed = "";
      lastDraftIdentity = draftIdentity;
      if (suppressed === JSON.stringify([next.facility, next.draft])) next.draft = null;
      const key = JSON.stringify(next);
      if (!force && key === last) {
        render();
        return response;
      }
      const requestRevision = ++revision;
      last = key;
      selection = next;
      response = null;
      render();
      try {
        const result = await withTimeout(() => chrome.runtime.sendMessage({ type: "FS_SELECTION", selection: next, refresh: force, diagnostics: adapter.diagnostics() }));
        if (!result) throw new Error("FS service worker returned no response.");
        if (key !== last || requestRevision !== revision || result.stale) return { stale: true };
        response = result;
        render();
      } catch (error) {
        if (/Extension context invalidated/i.test(error.message)) dispose();
        if (key === last && requestRevision === revision) {
          response = { selection: next, error: `FS service worker unavailable: ${error.message}. Reload OrderCheck and refresh the FS tab.`, code: "FS_WORKER_UNAVAILABLE" };
          render();
        }
      }
      return response;
    }
    const safeScan = () => {
      void scan().catch((error) => console.warn("FS snapshot failed:", error.message));
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(safeScan, 100);
    };
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.target !== host && !host.contains(m.target))) schedule();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const change = () => {
      clearTimeout(timer);
      safeScan();
    };
    const click = (event) => {
      if (adapter.isNewOrder(event.target)) {
        try {
          void chrome.runtime.sendMessage({ type: "FS_OPEN_PANEL" }).catch(() => {
          });
        } catch {
        }
        adapter.resetOrder();
        pending = null;
        suppressed = "";
        change();
      }
      if (adapter.isAdd(event.target)) {
        pending = cleanSelection(adapter.read());
      }
      schedule();
    };
    document.addEventListener("input", schedule, true);
    document.addEventListener("change", change, true);
    document.addEventListener("click", click, true);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    const listener = (message, sender, respond) => {
      if (message?.type === "FS_REFRESH") return respondAsync(respond, () => scan(true));
      if (!["FS_DIAGNOSTICS", "FS_ALLOCATION"].includes(message?.type)) return false;
      try {
        if (message.type === "FS_DIAGNOSTICS") respond({ ...adapter.diagnostics(), selection: cleanSelection(adapter.read()), bridgeVersion: FS_BRIDGE_VERSION });
        else {
          if (JSON.stringify(message.state?.selection) === last) {
            response = message.state;
            render();
          }
          respond({ success: true });
        }
      } catch (error) {
        respond({ error: error.message, code: "FS_DOM_ERROR" });
      }
      return false;
    };
    const bridge = { version: FS_BRIDGE_VERSION, dispose };
    globalThis.__ordercheckFsBridge = bridge;
    chrome.runtime.onMessage.addListener(listener);
    safeScan();
  }
})();
