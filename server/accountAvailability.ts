/** Public account errors contain categories only, never raw provider messages. */
export function accountAvailabilityError(error: any) {
  const code=String(error?.code ?? '').toLowerCase().replace(/^firestore\//,'');
  if(['8','resource-exhausted','resource_exhausted'].includes(code))return {
    error:'Your profile cannot be checked because the database usage limit has been reached. This does not mean your profile is missing. Ask an administrator to check Firebase usage, then retry.',
    code:'DATABASE_QUOTA_EXCEEDED',retryable:true,
  };
  if(['7','16','permission-denied','permission_denied','unauthenticated'].includes(code))return {
    error:'The server cannot access account records. Ask an administrator to check the database permissions. Your profile has not been checked.',
    code:'ACCOUNT_STORAGE_PERMISSION',retryable:false,
  };
  return {error:'Account records are temporarily unavailable. Your profile has not been checked. Please retry.',code:'ACCOUNT_STORAGE_UNAVAILABLE',retryable:true};
}
