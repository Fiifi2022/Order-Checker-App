import test from 'node:test';
import assert from 'node:assert/strict';
import {connectAuthenticatedLive} from '../src/utils/authenticatedLive';
class Visibility extends EventTarget{hidden=false;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const newline of ['\n','\r\n'])test(`live updates survive network chunks splitting ${JSON.stringify(newline)} frame delimiters`,async()=>{
 const messages:any[]=[];let warnings=0;
 const stop=connectAuthenticatedLive({url:'/test-events',document:new Visibility(),window:new EventTarget(),receive:value=>messages.push(value),unavailable:()=>{warnings++;},request:async(_url,init)=>{
  const text=`: heartbeat${newline}${newline}data: {"sheet":{"id":"fixture","balance":7}}${newline}${newline}data: {"sheet":{"id":"fixture","balance":6}}${newline}${newline}`;
  const body=new ReadableStream({start(controller){for(const byte of new TextEncoder().encode(text))controller.enqueue(new Uint8Array([byte]));init.signal!.addEventListener('abort',()=>controller.error(Error('Stopped')));}});
  return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
 }});
 try{for(let i=0;i<4;i++)await tick();assert.deepEqual(messages.map(message=>message.sheet.balance),[7,6]);assert.equal(warnings,0);}finally{stop();await tick();}
});
