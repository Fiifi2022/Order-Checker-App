(() => {
  // extension/inline-allocation.js
  function createInlineAllocation(adapter, doc) {
    doc.getElementById("ordercheck-allocation")?.remove();
    doc.getElementById("order-checker-vaccine-allocation")?.remove();
    const host = doc.createElement("div");
    host.id = "order-checker-vaccine-allocation";
    host.style.cssText = "display:none;flex:0 0 auto;align-self:flex-end;max-width:160px";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
    :host{font:12px system-ui;box-sizing:border-box}div{box-sizing:border-box;min-height:38px;display:flex;align-items:center;padding:6px 9px;border:1px solid #bbf7d0;border-radius:6px;background:#f0fdf4;color:#166534;line-height:1.3;overflow-wrap:anywhere}
    div[data-tone="low"]{background:#fffbeb;border-color:#fde68a;color:#92400e}
    div[data-tone="danger"]{background:#fef2f2;border-color:#fecaca;color:#991b1b}
    div[data-tone="unavailable"]{background:#f8fafc;border-color:#cbd5e1;color:#475569}
    @media(max-width:700px){div{padding:5px 6px;font-size:11px}}
    </style><div role="status" aria-live="polite" data-tone="unavailable"><strong></strong></div>`;
    let row, group, priorRowClass, priorGroupClass;
    const restore = () => {
      if (row && !priorRowClass && row.classList.contains("ordercheck-allocation-row")) row.classList.remove("ordercheck-allocation-row");
      if (group && !priorGroupClass && group.classList.contains("ordercheck-allocation-product")) group.classList.remove("ordercheck-allocation-product");
      row = group = null;
    };
    const style = doc.createElement("style");
    style.textContent = ".ordercheck-allocation-row{display:flex!important;flex-wrap:wrap;align-items:flex-end;column-gap:8px}.ordercheck-allocation-product{flex:1 1 240px!important;min-width:200px}";
    (doc.head || doc.documentElement).append(style);
    function mount(visible) {
      const placement = adapter.productPlacement();
      if (!placement) {
        restore();
        host.style.display = "none";
        return false;
      }
      if (row !== placement.row || group !== placement.group) {
        restore();
        ({ row, group } = placement);
        priorRowClass = row.classList.contains("ordercheck-allocation-row");
        priorGroupClass = group.classList.contains("ordercheck-allocation-product");
      }
      if (visible && !row.querySelector('table,[role="table"],section')) {
        if (!row.classList.contains("ordercheck-allocation-row")) row.classList.add("ordercheck-allocation-row");
        if (!group.classList.contains("ordercheck-allocation-product")) group.classList.add("ordercheck-allocation-product");
      }
      if (host.previousElementSibling !== group) row.insertBefore(host, group.nextSibling);
      return true;
    }
    function render(selection, response) {
      const draft = selection?.draft;
      const data = response?.allocation, product = data?.products?.[selection?.order?.length || 0];
      const visible = !!draft && product?.isVaccine !== false && product?.status !== "untracked";
      if (!visible) restore();
      if (!mount(visible)) return;
      if (!visible) {
        host.style.display = "none";
        return;
      }
      host.style.display = "block";
      const badge = shadow.querySelector("div"), text = shadow.querySelector("strong");
      const balance = product?.balance;
      let label = "Checking allocation\u2026", tone = "unavailable";
      let status = response?.error ? "Allocation temporarily unavailable. " + response.error : data?.message || product?.message || "Unable to verify allocation.";
      if (response?.error || data && data.status !== "matched") label = data?.status === "not_found" ? "Facility not found" : data?.status === "no_facility" ? "Facility not detected" : data?.status === "ambiguous" ? "Unable to verify allocation" : "Allocation unavailable";
      if (!response?.error && data?.status === "matched" && Number.isFinite(balance) && balance >= 0) {
        label = `Available: ${balance}`;
        const requested = Number(draft.quantity), threshold = response?.displaySettings?.lowThreshold ?? 10;
        const excess = Number.isFinite(requested) && requested > balance ? requested - balance : 0;
        tone = balance === 0 || excess > 0 ? "danger" : balance <= threshold ? "low" : "available";
        status = excess > 0 ? `Requested quantity exceeds available allocation by ${excess}.` : balance === 0 ? "Allocation exhausted." : "Sufficient allocation.";
      }
      const title = [
        status,
        `Facility: ${data?.facility?.facilityName || selection.facility.name}`,
        `Vaccine: ${product?.canonical || draft.name}`,
        ...[["Allocated", product?.allocated], ["Distributed", product?.distributed], ["Carryover", product?.carryOver], ["Remaining allocation", balance], ["Last checked", data?.refreshedAt], ["Last updated", product?.updatedAt]].filter(([, v]) => v !== null && v !== void 0).map(([k, v]) => `${k}: ${v}`)
      ].join("\n");
      if (text.textContent !== label) text.textContent = label;
      if (badge.dataset.tone !== tone) badge.dataset.tone = tone;
      if (host.title !== title) host.title = title;
      const aria = `${label}. ${status}`;
      if (badge.getAttribute("aria-label") !== aria) badge.setAttribute("aria-label", aria);
    }
    return { host, render, dispose() {
      restore();
      host.remove();
      style.remove();
    } };
  }

  // extension/fs-activation.js
  function createFsActivation(doc, version, inspect = () => ({})) {
    const host = doc.createElement("div");
    host.id = "ordercheck-active-status";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = ":host{position:fixed;top:16px;right:16px;z-index:2147483647;max-width:calc(100vw - 32px);font:14px/1.5 system-ui;color:#142b26}section{background:#fff;border:2px solid #178362;border-radius:12px;box-shadow:0 4px 20px #0003;padding:14px 40px 14px 16px;width:300px;max-width:calc(100vw - 90px)}strong{display:block;color:#12674d}p{margin:4px 0;overflow-wrap:anywhere}button{position:absolute;right:10px;top:8px;border:0;background:transparent;font:24px system-ui;cursor:pointer;color:#142b26}";
    const box = doc.createElement("section");
    box.setAttribute("role", "status");
    const title = doc.createElement("strong");
    title.textContent = `OrderCheck active \xB7 v${version}`;
    const facility = doc.createElement("p"), connection = doc.createElement("p");
    const details = doc.createElement("details"), summary = doc.createElement("summary"), report = doc.createElement("textarea");
    summary.textContent = "Detection details";
    report.readOnly = true;
    report.setAttribute("aria-label", "OrderCheck detection details");
    report.style.cssText = "box-sizing:border-box;width:100%;height:150px;font:12px monospace;margin-top:8px";
    details.append(summary, report);
    summary.addEventListener("click", () => {
      report.value = JSON.stringify({ version, ...inspect() }, null, 2);
    });
    const close = doc.createElement("button");
    close.type = "button";
    close.textContent = "\xD7";
    close.setAttribute("aria-label", "Dismiss OrderCheck status");
    close.addEventListener("click", () => host.remove());
    box.append(title, facility, connection, details, close);
    shadow.append(style, box);
    (doc.body || doc.documentElement).append(host);
    const set = (el, value) => {
      if (el.textContent !== value) el.textContent = value;
    };
    return {
      host,
      render(selection, response) {
        set(facility, selection?.facility?.name ? `Facility: ${selection.facility.name}` : "Waiting for facility selection in FS");
        set(connection, response?.error || (!response ? "Connecting to allocation service\u2026" : response.allocation?.status === "matched" ? "Connected \xB7 Blueprint facility found" : response.allocation?.message || (selection?.facility?.name ? "FS selection detected \xB7 Waiting for allocation lookup" : "Facility selection not detected \xB7 Open Detection details")));
      },
      dispose() {
        host.remove();
      }
    };
  }

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
    const widgets = 'input:not([type="hidden"]):not(.d-none):not([hidden]),select,[role="combobox"],[role="spinbutton"],button[aria-haspopup="listbox"],button[aria-haspopup="true"],[role="button"][aria-haspopup="listbox"]';
    const selectedValues = '[class*="singleValue"],[class*="single-value"],[data-selected-value]';
    function confirmedValues(scope) {
      return [...scope.querySelectorAll(`${selectedValues},.notranslate`)].filter((value) => {
        if (value.closest('.d-none,[hidden],[role="listbox"],[role="option"],[aria-live]')) return false;
        if (value.matches(selectedValues)) return true;
        return !!value.parentElement?.querySelector('input[id^="react-select-"]') && !!value.parentElement?.closest('[class*="-control"]') && !value.querySelector("input");
      });
    }
    const visibleWidgets = (scope) => [...scope.querySelectorAll(widgets)].filter((el) => !el.closest(".d-none,[hidden]") && !el.matches(":disabled"));
    function captionValue(scope, field) {
      if (!scope) return "";
      const marked = scope.querySelector(`[data-ordercheck-${field.toLowerCase()}]`);
      if (marked) return marked.textContent.trim();
      for (const label of scope.querySelectorAll("strong,b")) {
        if (!matches(label.textContent, field) || label.closest('table,[role="listbox"]')) continue;
        const fragments = [];
        for (let node = label.nextSibling; node; node = node.nextSibling) {
          if (node.nodeType === 1 && (node.matches("strong,b,label") || node.matches(widgets) || node.querySelector(widgets))) break;
          fragments.push(node.textContent || "");
        }
        const text = fragments.join("").trim();
        if (text && text.length <= 160) return text;
      }
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
        const conflictingLabel = [...container.querySelectorAll("label")].some((other) => other !== label && Object.keys(labels).some((field) => matches(other.textContent, field)) && key(other.textContent) !== key(label.textContent));
        if (!conflictingLabel) {
          const values = confirmedValues(container);
          if (values.length === 1) return values[0];
        }
        const available = visibleWidgets(container);
        const candidates = available.filter((el) => !available.some((other) => other !== el && el.contains(other)));
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
      if (target && scope.contains(target) && !target.closest(".d-none,[hidden]") && target.type !== "hidden") return target.matches(widgets) ? target : target.querySelector(widgets) || target;
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
      for (const el of visibleWidgets(scope)) {
        const name = key(el.getAttribute("name")).replace(/[_-]/g, " ");
        if (matches(el.getAttribute("aria-label"), field) || matches(name, field) || field === "Product" && name === "sku") return el;
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
      const pageProduct = control(doc, "Product");
      const suitable = (scope) => complete(scope) && (!pageProduct || scope.contains(pageProduct));
      if (cachedRoot?.isConnected && suitable(cachedRoot)) return cachedRoot;
      const marked = doc.querySelector('[data-ordercheck-order-form], [data-testid="add-order-form"], [data-testid="new-order-form"]');
      if (marked && facilityPresent(marked) && (!pageProduct || marked.contains(pageProduct))) return cachedRoot = marked;
      const semantic = [...doc.querySelectorAll('form,[role="dialog"],main')].find(suitable);
      if (semantic) return cachedRoot = semantic;
      const facility = control(doc, "Facility");
      for (let scope = facility?.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
        if (suitable(scope)) return cachedRoot = scope;
      }
      for (const label of doc.querySelectorAll("label,dt,span,p,div")) {
        if (!matches(label.textContent, "Facility") || label.closest('table,[role="listbox"]')) continue;
        for (let scope = label.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
          if (suitable(scope)) return cachedRoot = scope;
        }
      }
      const product = pageProduct, quantity = control(doc, "Quantity");
      for (let scope = product?.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
        if (quantity && scope.contains(quantity) && [...scope.querySelectorAll('button,[role="button"]')].some((button) => key(button.textContent) === "add")) return scope;
      }
      return cachedRoot = null;
    }
    function selected(el) {
      if (!el) return { name: "", id: "" };
      const option = el.matches(selectedValues) || el.matches(".notranslate") && confirmedValues(el.parentElement).includes(el) ? el : el.tagName === "SELECT" ? el.selectedOptions?.[0] || el.querySelector("option:checked") : confirmedValues(el)[0];
      let rendered = option;
      const readonly = el.readOnly || el.hasAttribute("readonly");
      const valueOnly = readonly || el.getAttribute("aria-autocomplete") === "none";
      if (!rendered && el.tagName === "INPUT") {
        for (let scope = el.parentElement, depth = 0; scope && depth < 4; scope = scope.parentElement, depth++) {
          if (visibleWidgets(scope).filter((widget) => widget !== el && !widget.contains(el)).length) break;
          rendered = confirmedValues(scope)[0];
          if (rendered || scope.querySelector("label")) break;
        }
      }
      const field = el.closest(".form-group") || el.parentElement;
      const hidden = field?.querySelector('input[name="sku"],input[name="facility"],input[name="facilityId"]');
      if (!rendered && el.tagName === "INPUT" && hidden !== el && hidden?.value) {
        let branch = el;
        for (let scope = el.parentElement, depth = 0; scope && field?.contains(scope) && depth < 4; branch = scope, scope = scope.parentElement, depth++) {
          if (scope.closest('[role="listbox"]')) break;
          const values = [...scope.children].filter((peer) => peer !== branch && !peer.matches('label,input,button,[aria-live],[aria-hidden="true"],[role="option"],.invalid-feedback,.d-none,[hidden],[class*="placeholder"],[class*="a11yText"]') && !peer.querySelector('input,button,[role="option"],[aria-live]') && peer.textContent.trim() && !/^(select|choose)\b/i.test(peer.textContent.trim()));
          if (values.length === 1) {
            rendered = values[0];
            break;
          }
          if (values.length > 1 || scope === field) break;
        }
      }
      const name = el.dataset.selectedName || rendered?.dataset.name || rendered?.textContent?.trim() || (el.tagName === "INPUT" ? valueOnly ? el.value : "" : el.textContent?.trim()) || "";
      return {
        name: /^(select|choose)\b/i.test(name) ? "" : name,
        id: el.dataset.selectedId || rendered?.dataset.id || hidden?.value || (el.tagName === "SELECT" ? el.value : "") || ""
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
      const facilityEl = control(scope, "Facility") || control(doc, "Facility");
      let facilityScope = !facilityEl || scope?.contains(facilityEl) ? scope : null;
      if (!facilityScope && facilityEl) {
        facilityScope = facilityEl.closest(".form-group") || facilityEl.parentElement;
        for (let parent = facilityScope; parent && parent !== doc.documentElement; parent = parent.parentElement) {
          if (captionValue(parent, "District") || captionValue(parent, "Region")) {
            facilityScope = parent;
            break;
          }
        }
      }
      const productEl = control(scope, "Product"), quantityEl = control(scope, "Quantity");
      const facilitySelection = selected(facilityEl);
      const metadata = (field, attribute) => facilityEl?.dataset[attribute] || (control(facilityScope, field) ? selected(control(facilityScope, field)).name : "") || captionValue(facilityScope, field);
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
    function productPlacement() {
      const scope = root(), product = control(scope, "Product"), quantity = control(scope, "Quantity");
      if (!product || !quantity) return null;
      const inputGroup = product.closest(".input-group"), field = inputGroup?.closest(".form-group");
      if (inputGroup && field && [...field.querySelectorAll("label")].some((label) => matches(label.textContent, "Product")) && !inputGroup.contains(quantity) && field.parentElement?.contains(quantity)) {
        let select = product;
        while (select.parentElement && select.parentElement !== inputGroup) select = select.parentElement;
        if (select.parentElement === inputGroup && !inputGroup.querySelector("table")) return { group: select, row: inputGroup };
      }
      let group = product;
      for (let parent = group.parentElement; parent && parent !== scope && !parent.contains(quantity); parent = parent.parentElement) group = parent;
      const row = group.parentElement;
      if (!row?.contains(quantity) || row === doc.body || row === doc.documentElement || row.querySelector('table,[role="table"],section') || row.contains(control(scope, "Facility"))) return null;
      return { group, row };
    }
    function inspect() {
      const describe = (el) => el ? { tag: el.tagName, id: el.id, class: String(el.className || "").slice(0, 200), name: el.getAttribute("name"), type: el.getAttribute("type") } : null;
      const scope = root();
      return {
        scope: describe(scope),
        fields: ["Facility", "Product", "Quantity"].map((field) => {
          const globalControl = control(doc, field), scopedControl = control(scope, field);
          return {
            field,
            globalControl: describe(globalControl),
            scopedControl: describe(scopedControl),
            selected: field !== "Quantity" ? selected(globalControl).name.slice(0, 160) : void 0,
            labels: [...doc.querySelectorAll("label,span,p,div")].filter((el) => matches(el.textContent, field) && !el.querySelector(widgets)).slice(0, 6).map((label) => ({
              label: describe(label),
              ancestors: [label.parentElement, label.parentElement?.parentElement, label.parentElement?.parentElement?.parentElement].map(describe)
            }))
          };
        }),
        frameCount: doc.querySelectorAll("iframe").length
      };
    }
    return {
      read,
      root,
      productPlacement,
      resetOrder: () => scripts.reset(),
      isNewOrder: (target) => {
        const button = target?.closest('button,[role="button"]');
        return !!button && ["add order", "add new order", "new order"].includes(key(button.textContent));
      },
      anchor: () => {
        const scope = root();
        return control(scope, "Quantity") || control(scope, "Product");
      },
      inspect,
      diagnostics: () => {
        const scope = root();
        return { formFound: !!scope || !!control(doc, "Facility"), facilityControl: !!facilityPresent(scope) || !!facilityPresent(doc), productControl: !!control(scope || doc, "Product"), quantityControl: !!control(scope || doc, "Quantity"), tableFound: !!table(scope) };
      },
      isAdd: (target) => {
        const scope = root(), button = target?.closest('button,[role="button"]');
        return !!(scope && button && scope.contains(button) && key(button.textContent) === "add");
      }
    };
  }

  // extension/fs-state.js
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
  var FS_BRIDGE_VERSION = "2.3.21";

  // extension/fs-content-entry.js
  {
    let render = function() {
      indicator.render(selection, response);
      activation.render(selection, response);
    }, refreshLater = function() {
      clearTimeout(refreshTimer);
      if (disposed) return;
      const interval = response?.displaySettings?.refreshMs || 3e4;
      refreshTimer = setTimeout(() => {
        if (selection?.draft && document.visibilityState !== "hidden" && !inFlight) void scan(true).catch((error) => console.warn("FS refresh failed:", error.message));
        else refreshLater();
      }, interval);
      refreshTimer?.unref?.();
    }, dispose = function() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      clearTimeout(refreshTimer);
      observer.disconnect();
      revision++;
      document.removeEventListener("input", change, true);
      document.removeEventListener("change", change, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("online", recover);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
      try {
        chrome.runtime.onMessage.removeListener?.(listener);
      } catch (error) {
        console.warn("FS listener context expired:", error.message);
      }
      indicator.dispose();
      activation.dispose();
      if (globalThis.__ordercheckFsBridge === bridge) delete globalThis.__ordercheckFsBridge;
    };
    try {
      globalThis.__ordercheckFsBridge?.dispose?.();
    } catch (error) {
      console.warn("Previous FS bridge cleanup failed:", error.message);
    }
    const adapter = createFsAdapter(document);
    let lastDraftIdentity = "", last = "", selection = null, pending = null, suppressed = "", response = null, timer, refreshTimer, revision = 0, disposed = false, inFlight = false;
    const indicator = createInlineAllocation(adapter, document);
    const host = indicator.host;
    const activation = createFsActivation(document, FS_BRIDGE_VERSION, () => adapter.inspect());
    async function scan(force = false) {
      if (disposed) return { error: "FS bridge was replaced. Reconnect to FS." };
      let next = cleanSelection(adapter.read());
      if (pending && JSON.stringify(next.facility) === JSON.stringify(pending.facility) && confirmedAddition(pending.order, next.order, pending.draft)) {
        suppressed = JSON.stringify([next.facility, next.draft]);
        pending = null;
      }
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
      inFlight = true;
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
      } finally {
        if (requestRevision === revision) {
          inFlight = false;
          refreshLater();
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
      if (mutations.some((m) => m.target !== host && !host.contains(m.target) && m.target !== activation.host && !activation.host.contains(m.target))) safeScan();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const change = () => {
      clearTimeout(timer);
      safeScan();
    };
    const click = (event) => {
      if (adapter.isNewOrder(event.target)) {
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
    document.addEventListener("input", change, true);
    document.addEventListener("change", change, true);
    document.addEventListener("click", click, true);
    const recover = () => {
      if (selection?.draft && document.visibilityState !== "hidden" && !inFlight) void scan(true).catch((error) => console.warn("FS recovery failed:", error.message));
    };
    window.addEventListener("online", recover);
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
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
