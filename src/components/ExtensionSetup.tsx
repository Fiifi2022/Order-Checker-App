import { useState } from 'react';
import { Download, Puzzle } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

export default function ExtensionSetup() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadExtension() {
    setDownloading(true);
    setError(null);
    try {
      const response = await authFetch('/api/download-extension');
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Unable to download the extension. Please try again.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ordercheck-compliance-companion.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to download the extension. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section aria-labelledby="extension-heading" className="rounded-2xl border border-purple-100 bg-white p-6 sm:p-8 shadow-sm space-y-6">
      <div className="flex items-start gap-3">
        <Puzzle className="h-7 w-7 shrink-0 text-[#5C2D91]" />
        <div>
          <h2 id="extension-heading" className="text-xl font-bold text-[#3B1A5E]">Companion Chrome Extension</h2>
          <p className="mt-2 text-sm text-slate-600">Use OrderCheck in Chrome to capture order details and audit them with your approved account.</p>
        </div>
      </div>

      <div>
        <button type="button" onClick={() => void downloadExtension()} disabled={downloading} className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-5 py-3 text-sm font-bold text-white hover:bg-[#3B1A5E] disabled:opacity-60 disabled:cursor-wait">
          <Download className="h-4 w-4" />
          {downloading ? 'Preparing download…' : 'Download Packed ZIP'}
        </button>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </div>

      <div className="rounded-xl bg-purple-50 p-5">
        <h3 className="font-bold text-[#3B1A5E]">Install in Chrome</h3>
        <ol className="mt-3 list-decimal pl-5 space-y-3 text-sm text-slate-700">
          <li>Download the ZIP and extract it to a folder you can keep on your computer.</li>
          <li>Open <code className="rounded bg-white px-1 py-0.5">chrome://extensions</code> in Chrome and enable <strong>Developer mode</strong>.</li>
          <li>Click <strong>Load unpacked</strong> and select the extracted folder containing <code>manifest.json</code>.</li>
          <li>Open the OrderCheck extension and sign in with your approved portal email and password. The download includes this app’s backend address.</li>
        </ol>
        <p className="mt-4 text-sm text-slate-600">Updating an existing installation? Replace its files with the newly extracted download, click <strong>Reload</strong> in Chrome’s Extensions page, and refresh any tabs used for capture.</p>
      </div>
    </section>
  );
}
