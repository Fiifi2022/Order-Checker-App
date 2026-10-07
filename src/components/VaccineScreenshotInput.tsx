import { authFetch } from '../utils/authFetch';
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, RefreshCw, ScanText, X } from 'lucide-react';

export default function VaccineScreenshotInput({ onText, inputText }: {
  onText: (text: string) => void;
  inputText: string;
}) {
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const cancel = () => {
    revision.current++;
    request.current?.abort();
    request.current = null;
    setBusy(false);
  };

  const acceptFile = (file: File) => {
    cancel();
    setMessage('');
    if (!file.type.startsWith('image/')) {
      setMessage('Select an image file to scan.');
      return;
    }
    const version = revision.current;
    const reader = new FileReader();
    reader.onerror = () => {
      if (version === revision.current) setMessage('Unable to read this image. Try another file.');
    };
    reader.onload = () => {
      if (version === revision.current) setImage(String(reader.result));
    };
    reader.readAsDataURL(file);
  };
  const acceptFileRef = useRef(acceptFile);
  acceptFileRef.current = acceptFile;

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.items || [])
        .find(item => item.type.startsWith('image/'))?.getAsFile();
      if (file) {
        event.preventDefault();
        acceptFileRef.current(file);
      }
    };
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('paste', paste);
      revision.current++;
      request.current?.abort();
    };
  }, []);

  // Discard a scan if the operator edits or replaces the order while it runs.
  useEffect(() => { cancel(); }, [inputText]);

  const scan = async () => {
    cancel();
    const version = revision.current;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch('/api/scan-screenshot', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: image, mimeType: image.split(';')[0].split(':')[1] }),
      });
      const data = await response.json();
      if (!response.ok || !data.text?.trim()) {
        throw new Error(data.message || 'Screenshot scanning is unavailable. Paste the message text to continue.');
      }
      if (version !== revision.current || controller.signal.aborted) return;
      onTextRef.current(data.text);
      setMessage('Text extracted. Review the message below before confirming the order.');
    } catch (error) {
      if (version === revision.current) {
        setMessage(controller.signal.aborted
          ? 'Scanning timed out. Paste the message text to continue.'
          : error instanceof Error ? error.message : 'Unable to scan. Paste the message text to continue.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };

  return (
    <div className="space-y-3">
      <div
        className="rounded-xl border border-dashed border-purple-200 bg-purple-50/30 p-4 text-center"
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) acceptFile(file);
        }}
      >
        <input ref={fileInput} type="file" accept="image/*" aria-label="WhatsApp order screenshot" className="sr-only" onChange={event => {
          const file = event.target.files?.[0];
          if (file) acceptFile(file);
          event.target.value = '';
        }} />
        {image ? (
          <div className="relative">
            <img src={image} alt="WhatsApp order screenshot preview" className="mx-auto h-36 max-w-full rounded-lg object-contain" />
            <button type="button" aria-label="Remove screenshot" onClick={() => { cancel(); setImage(''); setMessage(''); }} className="absolute right-0 top-0 rounded-lg bg-white p-1.5 text-slate-500 shadow-sm hover:text-rose-600"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <button type="button" onClick={() => fileInput.current?.click()} className="w-full rounded-lg py-3 focus-visible:outline-2 focus-visible:outline-purple-600">
            <ImagePlus className="mx-auto mb-2 h-7 w-7 text-[#5C2D91]" />
            <span className="block text-xs font-semibold text-[#3B1A5E]">Drop a screenshot or browse files</span>
            <span className="mt-1 block text-[11px] text-slate-500">You can also paste an image with Ctrl+V / Cmd+V.</span>
          </button>
        )}
      </div>
      {image && <button type="button" onClick={() => void scan()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#5C2D91] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3B1A5E] disabled:opacity-60">
        {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />}
        {busy ? 'Scanning screenshot...' : 'Scan Screenshot'}
      </button>}
      {message && <p role="status" className="rounded-lg bg-purple-50 p-2.5 text-xs text-purple-900">{message}</p>}
    </div>
  );
}
