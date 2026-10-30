import type {AuditStorageState} from '../../shared/auditStorage';
export default function AuditStorageNotice({storage,busy,onRetry,error}:{storage?:AuditStorageState;busy:boolean;onRetry:()=>void;error?:string}){
 if(!storage)return null;
 return <section aria-label="Audit storage" className={`border rounded-xl p-3 text-xs ${storage.status==='saved'?'border-green-200 text-green-800':'border-amber-200 text-amber-800'}`}>
  <p role="status">{storage.message}</p>
  {storage.status!=='saved' && <button type="button" disabled={busy} onClick={onRetry} className="mt-2 border rounded px-3 py-2 font-semibold disabled:opacity-50">{busy?'Checking save…':'Retry saving audit'}</button>}
  {error && <p role="alert">{error}</p>}
 </section>;
}
