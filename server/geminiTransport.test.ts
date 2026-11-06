import test from 'node:test';
import assert from 'node:assert/strict';
import {geminiProviderTimeout} from './geminiTransport';
import {optionalAuditAi} from './auditBudget';

test('short audit timeouts never advertise an invalid Gemini deadline',()=>{
 for(const ms of [1,50,1500,3000,4000,9999])assert.equal(geminiProviderTimeout(ms),10000);
 assert.equal(geminiProviderTimeout(15000),15000);assert.equal(geminiProviderTimeout(Number.NaN),10000);
});

test('valid provider deadline does not lengthen the local audit cancellation budget',async()=>{
 const started=performance.now();let providerDeadline=0;let observed:AbortSignal|undefined;
 await assert.rejects(optionalAuditAi(signal=>{
  observed=signal;providerDeadline=geminiProviderTimeout(30);
  return new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 },30),/available processing time/);
 assert.equal(providerDeadline,10000);assert.equal(observed?.aborted,true);
 assert.ok(performance.now()-started<1000,'The local caller must not wait for the provider deadline.');
});
