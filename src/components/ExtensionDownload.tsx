import { useState } from 'react';
import { Download, Puzzle } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

export async function downloadCompanionExtension(request: typeof authFetch = authFetch) {
  const response = await request('/api/download-extension');
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || 'Unable to download the extension. Please try again.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ordercheck-compliance-companion.zip';
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); URL.revokeObjectURL(url); }
}

export default function ExtensionDownload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await downloadCompanionExtension(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to download the extension. Please try again.'); }
    finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-purple-100 bg-white p-5 sm:p-8 shadow-sm space-y-5" aria-label="Companion Chrome Extension">
    <div className="flex items-start gap-3">
      <span className="rounded-xl bg-purple-50 p-3 text-[#5C2D91]"><Puzzle className="h-6 w-6" aria-hidden="true" /></span>
      <div><h1 className="text-xl font-bold text-[#3B1A5E]">OrderCheck Chrome Extension</h1>
        <p className="mt-2 text-sm text-slate-600">Download the latest OrderCheck side panel with inventory comparisons and product-specific customer confirmation. The download is configured for this app.</p></div>
    </div>
    <button type="button" onClick={download} disabled={busy} className="inline-flex min-h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[#5C2D91] px-5 py-3 text-sm font-semibold text-white hover:bg-[#3B1A5E] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700">
      <Download className="h-4 w-4" aria-hidden="true" />{busy ? 'Preparing download…' : 'Download Packed ZIP'}
    </button>
    {busy && <p role="status" className="text-sm text-purple-800">Preparing your extension download…</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-4 space-y-3 text-sm text-slate-700">
      <h2 className="font-bold text-[#3B1A5E]">Install or update in Chrome</h2>
      <ol className="list-decimal pl-5 space-y-2">
        <li>Extract the downloaded ZIP into a folder.</li>
        <li>Open <code>chrome://extensions</code> and enable Developer mode.</li>
        <li>Click <strong>Load unpacked</strong> and select the extracted folder containing <code>manifest.json</code>.</li>
        <li>Open OrderCheck from Chrome’s toolbar and sign in with your approved app account.</li>
      </ol>
      <p>Updating an existing installation? Replace its files with the extracted download, click <strong>Reload</strong> on its Chrome extension card, then refresh your FS and WhatsApp tabs.</p>
    </div>
  </section>;
}
