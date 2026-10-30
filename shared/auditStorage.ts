export interface AuditStorageState {
  status:'pending'|'saved'|'failed';
  category?:'authentication'|'permission'|'schema'|'network'|'initialization'|'timeout'|'quota'|'unknown';
  message:string;
  retryable:boolean;
  savedAt?:string;
}
