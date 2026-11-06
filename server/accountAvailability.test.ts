import test from 'node:test';
import assert from 'node:assert/strict';
import {accountAvailabilityError} from './accountAvailability';
import {registrationHandlers} from './registration';
import {createAuthentication} from './auth';
import {loadAccountAccess} from '../src/utils/loadAccountAccess';

const quota={code:8,message:'private-provider-data'};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

test('account errors distinguish database quota, permissions and outages without exposing provider data',()=>{
  for(const code of [8,'resource-exhausted','firestore/resource-exhausted','RESOURCE_EXHAUSTED']){
    const value=accountAvailabilityError({code,message:quota.message});
    assert.equal(value.code,'DATABASE_QUOTA_EXCEEDED');assert.match(value.error,/does not mean your profile is missing/);
    assert.doesNotMatch(JSON.stringify(value),/private-provider-data/);
  }
  assert.equal(accountAvailabilityError({code:7}).code,'ACCOUNT_STORAGE_PERMISSION');
  assert.equal(accountAvailabilityError({code:14}).code,'ACCOUNT_STORAGE_UNAVAILABLE');
});

test('registration read and save quota failures return service failure, never an absent profile or success',async()=>{
  const handler=registrationHandlers({get:async()=>{throw quota;},save:async()=>{throw quota;}});
  let status=200,body:any;
  const res:any={locals:{identity:{uid:'user',email:'user@example.com'}},status(code:number){status=code;return this;},json(value:any){body=value;}};
  await handler.get({} as any,res,()=>{});
  assert.equal(status,503);assert.equal(body.code,'DATABASE_QUOTA_EXCEEDED');assert.notEqual(body,null);
  await handler.save({body:{name:'Grace',position:'CCA',nest:'Ghana'}} as any,res,()=>{});
  assert.equal(status,503);assert.equal(body.code,'DATABASE_QUOTA_EXCEEDED');
});

test('role lookup quota failure fails closed with a storage category, not account rejection',async()=>{
  let status=200,body:any,next=false;
  const handler=createAuthentication(async()=>({uid:'u',email:'grace@example.com',email_verified:true}),async()=>{throw quota;});
  await handler({headers:{authorization:'Bearer valid'},method:'GET',path:'/auth/me'} as any,
    {locals:{},status(code:number){status=code;return this;},json(value:any){body=value;}} as any,()=>{next=true;});
  assert.equal(status,503);assert.equal(next,false);assert.equal(body.code,'DATABASE_QUOTA_EXCEEDED');
});

test('approved existing users load access first without a redundant registration lookup',async()=>{
  const paths:string[]=[];
  const profile={id:'u',role:'cca',email:'grace@example.com'};
  const account=await loadAccountAccess(true,async path=>{paths.push(path);return response(profile);});
  assert.deepEqual(paths,['/api/auth/me']);assert.deepEqual(account.profile,profile);
  assert.equal(account.registrationChecked,false);
});

test('failed access reads cannot become new-profile or awaiting-approval states and do not issue further requests',async()=>{
  for(const [status,body] of [[503,accountAvailabilityError(quota)],[503,accountAvailabilityError({code:7})],[403,{error:'A verified email account is required.'}]] as const){
    const paths:string[]=[];
    await assert.rejects(loadAccountAccess(true,async path=>{paths.push(path);return response(body,status);}),{message:body.error});
    assert.deepEqual(paths,['/api/auth/me']);
  }
});

test('only confirmed unassigned access proceeds to registration; quota failure is never interpreted as missing',async()=>{
  const paths:string[]=[];
  const request=async(path:string)=>{
    paths.push(path);return path==='/api/auth/me'?response({code:'ACCOUNT_NOT_APPROVED',error:'Approval required'},403):response(accountAvailabilityError(quota),503);
  };
  await assert.rejects(loadAccountAccess(true,request),/database usage limit/);
  assert.deepEqual(paths,['/api/auth/me','/api/auth/registration']);
  const missing=await loadAccountAccess(true,async path=>path==='/api/auth/me'?response({code:'ACCOUNT_NOT_APPROVED'},403):response(null));
  assert.equal(missing.registrationChecked,true);assert.equal(missing.registration,null);assert.equal(missing.profile,null);
});

test('unverified accounts can retrieve registration without receiving operational access',async()=>{
  const paths:string[]=[];
  const registration={name:'Grace',position:'CCA',nest:'Ghana'};
  const account=await loadAccountAccess(false,async path=>{paths.push(path);return response(registration);});
  assert.deepEqual(paths,['/api/auth/registration']);assert.equal(account.profile,null);
  assert.deepEqual(account.registration,registration);assert.equal(account.registrationChecked,true);
});

test('a user-triggered retry recovers after database availability returns without stale denial',async()=>{
  let available=false,calls=0;
  const request=async()=>{calls++;return available?response({role:'cca',name:'Grace'}):response(accountAvailabilityError(quota),503);};
  await assert.rejects(loadAccountAccess(true,request));assert.equal(calls,1);
  available=true;const result=await loadAccountAccess(true,request);
  assert.equal(result.profile.role,'cca');assert.equal(calls,2);
});
