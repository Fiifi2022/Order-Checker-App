import { useEffect, useState } from 'react';

type Status = 'off' | 'ready' | 'processing' | 'done' | 'quota_exceeded' | 'unavailable';
const labels: Record<Status, string> = { off: 'Off', ready: 'Ready', processing: 'Processing', done: 'Done', quota_exceeded: 'Quota Exceeded', unavailable: 'Unavailable' };

export default function GeminiStatus() {
  const [status, setStatus] = useState<Status>('off');

  useEffect(() => {
    // A passive subscription to real usage and its local return-to-idle timer.
    const events = new EventSource('/api/gemini-status/events');
    events.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (Object.prototype.hasOwnProperty.call(labels, data.status)) setStatus(data.status);
      } catch { setStatus('unavailable'); }
    };
    events.onerror = () => {
      // Disable EventSource's automatic reconnect rather than retrying while idle.
      events.close();
      setStatus('unavailable');
    };
    return () => events.close();
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
