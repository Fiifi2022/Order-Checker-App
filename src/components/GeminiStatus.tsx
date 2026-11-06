import {connectAuthenticatedLive} from '../utils/authenticatedLive';
import { authFetch } from '../utils/authFetch';
import { useEffect, useState } from 'react';

type Status = 'off' | 'ready' | 'processing' | 'done' | 'quota_exceeded' | 'unavailable' | 'connection_lost';
const labels: Record<Status, string> = { off: 'Off', ready: 'Ready', processing: 'Processing', done: 'Done', quota_exceeded: 'Paused — catalogue checks available', unavailable: 'Unavailable — catalogue checks available', connection_lost: 'Status reconnecting' };

export default function GeminiStatus() {
  const [status, setStatus] = useState<Status>('off');

  useEffect(() => {
    const controller = new AbortController();
    const stop = connectAuthenticatedLive({
      url: '/api/gemini-status/events', request: authFetch, document, window,
      receive: data => { if (Object.prototype.hasOwnProperty.call(labels, data.status)) setStatus(data.status); },
      unavailable: () => setStatus('connection_lost'),
    });
    return () => {controller.abort(); stop();};
  }, []);

  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-purple-100">
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        status === 'done' || status === 'ready' ? 'bg-emerald-300' : status === 'unavailable' || status === 'quota_exceeded' || status === 'connection_lost' ? 'bg-amber-300' : status === 'processing' ? 'bg-purple-300 animate-pulse' : 'bg-slate-400'
      }`} />
      Gemini: {labels[status]}
    </span>
  );
}
