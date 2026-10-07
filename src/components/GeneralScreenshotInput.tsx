import { authFetch } from '../utils/authFetch';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
export interface GeneralScreenshotHandle { acceptFile: (file: File) => void }
export default forwardRef<GeneralScreenshotHandle, { label: string; inputsKey: string; resetKey: number; onText: (text: string) => void; onInvalidate: () => void }>(function GeneralScreenshotInput({ label, inputsKey, resetKey, onText, onInvalidate }, ref) {
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  const currentInputs = useRef(inputsKey); currentInputs.current = inputsKey;
  const request = useRef<AbortController | null>(null);
  useEffect(() => { request.current?.abort(); setBusy(false); }, [inputsKey]);
  useEffect(() => { revision.current++; request.current?.abort(); setImage(''); setMessage(''); setBusy(false); }, [resetKey]);
  useEffect(() => () => { revision.current++; request.current?.abort(); }, []);
  const acceptFile = (file: File) => {
    if (!file.type.startsWith('image/')) { setMessage('Please select an image.'); return; }
    const version = ++revision.current; const key = currentInputs.current;
    request.current?.abort(); onInvalidate(); setImage(''); setBusy(false); setMessage('');
    const reader = new FileReader();
    reader.onerror = () => setMessage('Unable to read image.');
    reader.onload = () => { if (revision.current === version && key === currentInputs.current) { onText(''); setImage(String(reader.result)); } };
    reader.readAsDataURL(file);
  };
  useImperativeHandle(ref, () => ({ acceptFile }));
  const scan = async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const version = revision.current; const key = currentInputs.current;
    onInvalidate(); setBusy(true); setMessage('');
    try {
      const response = await authFetch('/api/scan-screenshot', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auditScope: 'general_auditor', imageBase64: image, mimeType: image.split(';')[0].split(':')[1] }) });
      const data = await response.json();
      if (!response.ok || !data.text?.trim()) throw new Error(data.error || data.message || 'Screenshot scanning returned no text.');
      if (controller.signal.aborted || version !== revision.current || key !== currentInputs.current) return;
      onText(data.text); setMessage('Extracted text below. Review it before auditing.');
    } catch (error: any) { if (!controller.signal.aborted) setMessage(error.message || 'Screenshot service unavailable.'); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <div className="rounded-xl border border-dashed border-purple-200 p-3 space-y-2 text-xs" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) acceptFile(file); }}>
    <label className="block cursor-pointer font-semibold">{label}: upload, drop, or paste an image (Ctrl+V)
      <input aria-label={`${label} screenshot`} type="file" accept="image/*" className="block mt-2" onChange={event => { const file = event.target.files?.[0]; if (file) acceptFile(file); event.target.value = ''; }} />
    </label>
    {image && <div className="flex items-center gap-3"><img src={image} alt={`${label} screenshot preview`} className="w-16 h-16 object-contain" /><button type="button" disabled={busy} onClick={scan} className="bg-purple-700 text-white rounded-lg p-2">{busy ? 'Scanning…' : 'Scan screenshot'}</button><button type="button" onClick={() => { revision.current++; request.current?.abort(); setImage(''); setMessage(''); setBusy(false); }}>Remove image</button></div>}
    {message && <p role="status">{message}</p>}
  </div>;
});
