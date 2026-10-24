// The Edit script action anchors the actual script, independently of its UUID.
export function createFsScriptReader() {
  let orderRoot, orderId, generation = 0, previous, blocked;
  const hidden = el => el?.hidden || el?.getAttribute('aria-hidden') === 'true' || el?.style?.display === 'none' || el?.style?.visibility === 'hidden';
  const visible = el => {
    for (let node = el; node; node = node.parentElement) {
      if (hidden(node)) return false;
      const style = node.ownerDocument.defaultView?.getComputedStyle?.(node);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  };
  function textOf(el) {
    if (hidden(el)) return '';
    if (el.ownerDocument.defaultView?.getComputedStyle && typeof el.innerText === 'string') return el.innerText;
    const walk = node => {
      if (node.nodeType === 3) return node.nodeValue;
      if (node.nodeType !== 1 || hidden(node)) return '';
      if (node.tagName === 'BR') return '\n';
      const text = [...node.childNodes].map(walk).join('');
      return ['P', 'DIV', 'LI'].includes(node.tagName) && node !== el ? text + '\n' : text;
    };
    return walk(el);
  }
  function candidate(scope) {
    const buttons = [...scope.querySelectorAll('button[aria-label="Edit script"]')].filter(visible);
    if (buttons.length !== 1) return null;
    const button = buttons[0];
    // Allow an icon/action wrapper between the text and its Edit script button.
    for (let action = button, depth = 0; action && action !== scope && scope.contains(action) && depth < 4; action = action.parentElement, depth++) {
      const value = action.previousElementSibling;
      if (value?.tagName !== 'DIV' || !value.id || !visible(value)) continue;
      if (value.matches('[role="combobox"],[role="button"],[role="heading"]')) continue;
      if (value.querySelector('button,input,select,textarea,h1,h2,h3,h4,h5,h6,[role="heading"],[role="button"]')) continue;
      return value;
    }
    return null;
  }
  return {
    reset() { generation++; blocked = previous; },
    read(root) {
      let scope = root?.closest('form,[role="dialog"],main') || root;
      // Facility detection may cache a small React card. Package & Script can
      // be its sibling in the same order screen, outside the native form.
      if (root && !scope.querySelector('button[aria-label="Edit script"]')) {
        for (let parent = scope.parentElement; parent && parent !== root.ownerDocument.body && parent !== root.ownerDocument.documentElement; parent = parent.parentElement) {
          const named = [...parent.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].some(el => el.textContent.trim().toLowerCase() === 'package & script');
          if (named && parent.querySelector('button[aria-label="Edit script"]')) { scope = parent; break; }
        }
      }
      const nextId = scope?.getAttribute('data-order-id') || '';
      if (scope !== orderRoot) { orderRoot = scope; orderId = nextId; generation++; blocked = null; }
      else if (nextId !== orderId) { orderId = nextId; generation++; blocked = previous; }
      if (!scope) { previous = null; return { orderKey: String(generation), text: null }; }
      // Prefer the named section; fall back only to Edit script within this order.
      const headings = [...scope.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(el => el.textContent.trim().toLowerCase() === 'package & script');
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
    },
  };
}

export function createFsScriptSync({ field, onChanged, persist }) {
  let owned = false, source, observed = false;
  field.addEventListener?.('input', event => { if (event.isTrusted) owned = false; });
  return {
    get owned() { return owned; },
    get observed() { return observed; },
    apply(script) {
      if (!script || typeof script.text !== 'string') {
        if (script || owned) observed = true;
        source = undefined;
        if (!owned) return;
        owned = false;
        if (!field.value) return;
        field.value = ''; persist(''); onChanged(); return;
      }
      const identity = JSON.stringify([script.orderKey, script.text]);
      if (source === identity) return;
      source = identity; owned = true; observed = true;
      if (field.value === script.text) return;
      field.value = script.text; persist(script.text); onChanged();
    },
  };
}
