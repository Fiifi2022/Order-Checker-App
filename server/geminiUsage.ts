import { EventEmitter } from 'node:events';

export type GeminiUsageStatus = 'off' | 'ready' | 'processing' | 'done' | 'quota_exceeded' | 'unavailable';

// Local state only: reading/subscribing never initializes the client or calls Gemini.
export class GeminiUsageTracker {
  private pending = 0;
  private lastStatus: GeminiUsageStatus = 'off';
  private completionStatus: GeminiUsageStatus = 'done';
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private events = new EventEmitter();

  constructor(private completionDisplayMs = 2000) {
    this.events.setMaxListeners(0);
  }

  getStatus() {
    return { status: this.pending ? 'processing' as const : this.lastStatus };
  }

  subscribe(listener: () => void) {
    this.events.on('change', listener);
    return () => { this.events.off('change', listener); };
  }

  async run<T>(request: () => Promise<T>): Promise<T> {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.pending === 0) {
      this.completionStatus = 'done';
      this.lastStatus = 'ready';
      this.events.emit('change');
    }
    this.pending++;
    this.events.emit('change');
    try {
      const result = await request();
      return result;
    } catch (error: any) {
      const code = Number(error?.status || error?.code);
      if (code === 429 || this.completionStatus !== 'quota_exceeded') {
        this.completionStatus = code === 429 ? 'quota_exceeded' : 'unavailable';
      }
      throw error;
    } finally {
      this.pending--;
      if (this.pending === 0) {
        this.lastStatus = this.completionStatus;
        // One local display timer, never a Gemini call or a retry.
        this.idleTimer = setTimeout(() => {
          this.idleTimer = undefined;
          this.lastStatus = 'off';
          this.events.emit('change');
        }, this.completionDisplayMs);
        this.idleTimer.unref();
        this.events.emit('change');
      }
    }
  }
}

export const geminiUsage = new GeminiUsageTracker();
