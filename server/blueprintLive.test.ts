import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createBlueprintLiveHub,blueprintLiveHandler} from './blueprintLive';
import {connectBlueprintLive} from '../src/utils/blueprintLive';
import {firestoreReadReport,trackFirestoreListener} from './firestoreReads';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('visible viewers share one selected-sheet listener; updates and unsubscribe stay scoped',()=>{
  let watches=0,stops=0;const callbacks=new Map<string,(sheet:any)=>void>();
  const hub=createBlueprintLiveHub((id,next)=>{watches++;callbacks.set(id,next);return()=>{stops++;};});
  const a:any[]=[],b:any[]=[],other:any[]=[];
  const stopA=hub.subscribe('october-east',value=>a.push(value)),stopB=hub.subscribe('october-east',value=>b.push(value));
  assert.equal(watches,1);const stopOther=hub.subscribe('november-west',value=>other.push(value));
  callbacks.get('october-east')!({rows:[{balance:7}],updatedAt:'v1'});
  assert.equal(a[0].sheet.id,'october-east');assert.equal(b[0].sheet.rows[0].balance,7);assert.equal(other.length,0);
  stopA();assert.equal(stops,0);stopB();assert.equal(stops,1);stopOther();assert.equal(stops,2);
  hub.subscribe('october-east',()=>{})();assert.equal(watches,3);assert.equal(stops,3);
});

function streamResponse(){
  const res:any=new EventEmitter();res.frames=[];res.locals={};res.code=200;res.ended=false;
  res.setHeader=()=>{};res.flushHeaders=()=>{};res.status=(code:number)=>{res.code=code;return res;};res.json=(value:any)=>{res.body=value;};
  res.write=(frame:string)=>{res.frames.push(frame);return true;};res.end=()=>{res.ended=true;res.emit('close');};return res;
}
test('saved-sheet deliveries recheck current authorization and stop on revocation without leaking the next sheet',async()=>{
  let emit!:(sheet:any)=>void,stops=0,allowed=true,checks=0;
  const hub=createBlueprintLiveHub((_id,next)=>{emit=next;return()=>{stops++;};});
  const handler=blueprintLiveHandler(hub,async()=>{checks++;return allowed;});const res=streamResponse();
  handler({params:{id:'sheet'}} as any,res,()=>{});
  emit({rows:[{balance:10}]});await tick();assert.match(res.frames[0],/"balance":10/);
  allowed=false;emit({rows:[{balance:9}]});await tick();
  assert.equal(checks,2);assert.equal(stops,1);assert.equal(res.ended,true);
  assert.doesNotMatch(res.frames.join(''),/"balance":9/);
});

test('database listener errors close the stream without another role read, and invalid sheet IDs never subscribe',async()=>{
  let fail!:()=>void,watches=0,checks=0,stops=0;
  const hub=createBlueprintLiveHub((_id,_next,error)=>{watches++;fail=error;return()=>{stops++;};});
  const handler=blueprintLiveHandler(hub,async()=>{checks++;return true;});
  const invalid=streamResponse();handler({params:{id:'invalid/path'}} as any,invalid,()=>{});assert.equal(invalid.code,400);assert.equal(watches,0);
  const res=streamResponse();handler({params:{id:'sheet'}} as any,res,()=>{});fail();await tick();
  assert.equal(checks,0);assert.equal(stops,1);assert.match(res.frames.join(''),/unavailable/);assert.equal(res.ended,true);
});

test('a disconnected client receives no in-flight authorized snapshot and listener counts release exactly once',async()=>{
  let emit!:(sheet:any)=>void,authorize!:(allowed:boolean)=>void;
  const hub=createBlueprintLiveHub((_id,next)=>{emit=next;return()=>{};});
  const res=streamResponse();blueprintLiveHandler(hub,()=>new Promise(resolve=>authorize=resolve))({params:{id:'sheet'}} as any,res,()=>{});
  emit({rows:[{balance:10}]});res.emit('close');authorize(true);await tick();assert.equal(res.frames.length,0);
  const before=firestoreReadReport().listeners,release=trackFirestoreListener();assert.equal(firestoreReadReport().listeners,before+1);
  release();release();assert.equal(firestoreReadReport().listeners,before);
});

class Visibility extends EventTarget{hidden=false;}
test('client consumes saved-sheet events, stops in hidden tabs and reconnects on return without interval polling',async()=>{
  const document=new Visibility(),window=new EventTarget();let calls=0,aborts=0;
  const messages:any[]=[];
  const stop=connectBlueprintLive({url:'/events',document,window,receive:value=>messages.push(value),unavailable:()=>{throw Error('No failure expected');},request:async(_url,init)=>{
    calls++;
    const body=new ReadableStream({start(controller){
      init.signal!.addEventListener('abort',()=>{aborts++;controller.error(Error('Aborted'));});
      controller.enqueue(new TextEncoder().encode('data: {"sheet":{"id":"sheet","balance":7},"checkedAt":"now"}\n\n'));
    }});
    return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
  }});
  await tick();assert.equal(calls,1);assert.equal(messages[0].sheet.balance,7);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));await tick();assert.equal(aborts,1);assert.equal(calls,1);
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));await tick();assert.equal(calls,2);
  window.dispatchEvent(new Event('focus'));await tick();assert.equal(calls,2);
  stop();await tick();assert.equal(aborts,2);
});

test('unavailable live connection reports staleness and does not immediately hammer the server',async()=>{
  const document=new Visibility(),window=new EventTarget();let requests=0,warnings=0;
  const stop=connectBlueprintLive({url:'/events',document,window,receive:()=>{throw Error('No snapshot');},unavailable:()=>{warnings++;},request:async()=>{requests++;return new Response('',{status:503});}});
  await tick();await tick();assert.equal(requests,1);assert.equal(warnings,1);stop();
});

test('returning from FS reads the selected saved Blueprint even if its stream stays open and silent',async()=>{
 const document=new Visibility(),window=new EventTarget(),messages:any[]=[],reads:string[]=[];
 let finish!:()=>void;
 const stop=connectBlueprintLive({url:'/api/vaccine/blueprint-districts/west_mamprusi/events',document,window,receive:data=>messages.push(data),unavailable:()=>assert.fail('No read failure expected'),request:async(url,init)=>{
  reads.push(url);
  if(url.endsWith('/events'))return new Response(new ReadableStream({start(controller){init.signal!.addEventListener('abort',()=>controller.error(Error('Aborted')));}}),{headers:{'Content-Type':'text/event-stream'}});
  assert.equal(init.cache,'no-store');
  await new Promise<void>(resolve=>{finish=resolve;});
  return Response.json({sheet:{id:'west_mamprusi',rows:[{vaccines:{BCG:{distributed:2,balance:1}}}]},checkedAt:'now'});
 }});
 await tick();window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));
 assert.deepEqual(reads,['/api/vaccine/blueprint-districts/west_mamprusi/events','/api/vaccine/blueprint-districts/west_mamprusi/current']);
 finish();await tick();assert.equal(messages[0].sheet.rows[0].vaccines.BCG.balance,1);
 stop();window.dispatchEvent(new Event('focus'));await tick();assert.equal(reads.length,2);
});

test('a broken Blueprint stream falls back to a fresh saved-document read without polling all sheets',async()=>{
 const document=new Visibility(),window=new EventTarget(),reads:string[]=[],messages:any[]=[];let warnings=0;
 const stop=connectBlueprintLive({url:'/api/vaccine/blueprint-districts/one/events',document,window,receive:data=>messages.push(data),unavailable:()=>{warnings++;},request:async url=>{
  reads.push(url);return url.endsWith('/events')?new Response('',{status:503}):Response.json({sheet:{id:'one',rows:[{balance:3}]},checkedAt:'now'});
 }});
 await tick();await tick();assert.equal(warnings,1);assert.equal(messages[0].sheet.rows[0].balance,3);
 assert.deepEqual(reads,['/api/vaccine/blueprint-districts/one/events','/api/vaccine/blueprint-districts/one/current']);stop();
});

test('a hidden or unmounted Blueprint cannot receive a late focus-refresh response',async()=>{
 const document=new Visibility(),window=new EventTarget();let resolve!:(value:Response)=>void,signal:AbortSignal|undefined;const messages:any[]=[];
 const stop=connectBlueprintLive({url:'/api/vaccine/blueprint-districts/one/events',document,window,receive:data=>messages.push(data),unavailable:()=>{},request:async(url,init)=>{
  if(url.endsWith('/events'))return new Response(new ReadableStream({start(controller){init.signal!.addEventListener('abort',()=>controller.error(Error('Aborted')));}}),{headers:{'Content-Type':'text/event-stream'}});
  signal=init.signal as AbortSignal;return new Promise<Response>(done=>{resolve=done;});
 }});
 await tick();window.dispatchEvent(new Event('focus'));document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(signal?.aborted,true);resolve(Response.json({sheet:{id:'one'},checkedAt:'late'}));await tick();assert.equal(messages.length,0);stop();
});
