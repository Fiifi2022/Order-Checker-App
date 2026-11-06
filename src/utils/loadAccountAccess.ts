/** A failed lookup never means that a registration or access assignment is absent. */
export async function loadAccountAccess(emailVerified:boolean,request:(path:string)=>Promise<Response>) {
  if(emailVerified){
    const response=await request('/api/auth/me');
    const profile=await response.json();
    if(response.ok)return {profile,registration:null,registrationChecked:false};
    const unassigned=response.status===403 && (profile.code==='ACCOUNT_NOT_APPROVED' || profile.error==='Your account has not been granted access. Contact an administrator.');
    if(!unassigned)throw Error(profile.error || 'Account access could not be checked. Please retry.');
  }
  const response=await request('/api/auth/registration');
  const registration=await response.json();
  if(!response.ok)throw Error(registration.error || 'Your profile could not be checked. Please retry.');
  return {profile:null,registration,registrationChecked:true};
}
