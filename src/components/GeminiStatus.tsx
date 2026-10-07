import { authFetch } from '../utils/authFetch';
import { useEffect, useState } from 'react';

type Status = 'off' | 'ready' | 'processing' | 'done' | 'quota_exceeded' | 'unavailable';
const labels: Record<Status, string> = { off: 'Off', ready: 'Ready', processing: 'Processing', done: 'Done', quota_exceeded: 'Quota Exceeded', unavailable: 'Unavailable' };

export default function GeminiStatus() {
  const [status, setStatus] = useState<Status>('off');

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await authFetch('/api/gemini-status/events', { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error('Status stream unavailable');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';
          for (const frame of frames) {
            const line = frame.split('\n').find(line => line.startsWith('data:'));
            if (!line) continue;
            const data = JSON.parse(line.slice(5));
            if (Object.prototype.hasOwnProperty.call(labels, data.status)) setStatus(data.status);
          }
        }
      } catch { if (!controller.signal.aborted) setStatus('unavailable'); }
    })();
    return () => controller.abort();
  }, []);

  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-purple-100">
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        status === 'done' || status === 'ready' ? 'bg-emerald-300' : status === 'unavailable' || status === 'quota_exceeded' ? 'bg-amber-300' : status === 'processing' ? 'bg-purple-300 animate-pulse' : 'bg-slate-400'
      }`} />
      Gemini: {labels[status]}
    </span>
  );
}
