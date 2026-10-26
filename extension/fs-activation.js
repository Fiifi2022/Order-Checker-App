// A nonblocking, dismissible confirmation; shadow DOM keeps FS styles isolated.
export function createFsActivation(doc, version, inspect = () => ({})) {
  const host = doc.createElement('div');
  host.id = 'ordercheck-active-status';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = ':host{position:fixed;top:16px;right:16px;z-index:2147483647;max-width:calc(100vw - 32px);font:14px/1.5 system-ui;color:#142b26}section{background:#fff;border:2px solid #178362;border-radius:12px;box-shadow:0 4px 20px #0003;padding:14px 40px 14px 16px;width:300px;max-width:calc(100vw - 90px)}strong{display:block;color:#12674d}p{margin:4px 0;overflow-wrap:anywhere}button{position:absolute;right:10px;top:8px;border:0;background:transparent;font:24px system-ui;cursor:pointer;color:#142b26}';
  const box = doc.createElement('section');
  box.setAttribute('role', 'status');
  const title = doc.createElement('strong');
  title.textContent = `OrderCheck active · v${version}`;
  const facility = doc.createElement('p'), connection = doc.createElement('p');
  const details = doc.createElement('details'), summary = doc.createElement('summary'), report = doc.createElement('textarea');
  summary.textContent = 'Detection details';
  report.readOnly = true; report.setAttribute('aria-label', 'OrderCheck detection details');
  report.style.cssText = 'box-sizing:border-box;width:100%;height:150px;font:12px monospace;margin-top:8px';
  details.append(summary, report);
  summary.addEventListener('click', () => { report.value = JSON.stringify({ version, ...inspect() }, null, 2); });
  const close = doc.createElement('button');
  close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss OrderCheck status');
  close.addEventListener('click', () => host.remove());
  box.append(title, facility, connection, details, close); shadow.append(style, box);
  (doc.body || doc.documentElement).append(host);
  const set = (el, value) => { if (el.textContent !== value) el.textContent = value; };
  return {
    host,
    render(selection, response) {
      set(facility, selection?.facility?.name ? `Facility: ${selection.facility.name}` : 'Waiting for facility selection in FS');
      set(connection, response?.error || (!response ? 'Connecting to allocation service…' : response.allocation?.status === 'matched' ? 'Connected · Blueprint facility found' : response.allocation?.message || (selection?.facility?.name ? 'FS selection detected · Waiting for allocation lookup' : 'Facility selection not detected · Open Detection details')));
    },
    dispose() { host.remove(); },
  };
}
