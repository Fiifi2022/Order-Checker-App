import { EventEmitter } from 'node:events';

export type GeminiUsageStatus = 'off' | 'ready' | 'processing' | 'done' | 'quota_exceeded' | 'unavailable';

// Local state only: reading/subscribing never initializes the client or calls Gemini.
export class GeminiUsageTracker {
  private pending = 0;
  private lastStatus: GeminiUsageStatus = 'off';
  private completionStatus: GeminiUsageStatus = 'done';
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private events = new EventEmitter();
  private quotaUntil = new WeakMap<object, number>();
  private usage={requests:0,failedRequests:0,promptTokens:0,outputTokens:0,totalTokens:0,groundedResponses:0,searchQueries:0,responsesWithoutTokenUsage:0};
  getUsage(){return {...this.usage};}

  constructor(private completionDisplayMs = 2000, private quotaPauseMs = 60_000, private now = () => Date.now()) {
    this.events.setMaxListeners(0);
  }

  getStatus() {
    return { status: this.pending ? 'processing' as const : this.lastStatus };
  }

  subscribe(listener: () => void) {
    this.events.on('change', listener);
    return () => { this.events.off('change', listener); };
  }

  async run<T>(request: () => Promise<T>, client: object = this): Promise<T> {
    // All features using this API client share one pause. No timer, polling,
    // model switching or SDK request is needed to check it.
    const retryAt = this.quotaUntil.get(client) || 0;
    if (retryAt > this.now()) throw Object.assign(new Error('AI assistance is temporarily unavailable. Catalogue checks remain available; unresolved details require review.'), {status:429,retryAt});
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.pending === 0) {
      this.completionStatus = 'done';
      this.lastStatus = 'ready';
      this.events.emit('change');
    }
    this.pending++;
    this.usage.requests++;
    this.events.emit('change');
    try {
      const result = await request();
      const metadata=(result as any)?.usageMetadata;
      const count=(value:any)=>Number.isFinite(value)&&value>=0?value:0;
      if(metadata){this.usage.promptTokens+=count(metadata.promptTokenCount);this.usage.outputTokens+=count(metadata.candidatesTokenCount);this.usage.totalTokens+=count(metadata.totalTokenCount);}
      else this.usage.responsesWithoutTokenUsage++;
      const queries=(result as any)?.candidates?.[0]?.groundingMetadata?.webSearchQueries;
      if(Array.isArray(queries)&&queries.length){this.usage.groundedResponses++;this.usage.searchQueries+=queries.length;}
      return result;
    } catch (error: any) {
      this.usage.failedRequests++;
      const code = Number(error?.status || error?.code);
      const quota = code === 429 || String(error?.status || error?.code).toUpperCase() === 'RESOURCE_EXHAUSTED';
      if (quota) this.quotaUntil.set(client,this.now()+this.quotaPauseMs);
      if (quota || this.completionStatus !== 'quota_exceeded') {
        this.completionStatus = quota ? 'quota_exceeded' : 'unavailable';
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
