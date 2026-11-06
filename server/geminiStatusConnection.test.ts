import test from 'node:test';
import assert from 'node:assert/strict';
import {connectAuthenticatedLive} from '../src/utils/authenticatedLive';
import {readFileSync} from 'node:fs';
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('status transport reconnects on focus after a disconnect and never calls a Gemini model', async () => {
  const document = Object.assign(new EventTarget(), {hidden: false});
  const window = new EventTarget();
  let attempts = 0, warnings = 0;
  const statuses: string[] = [];
  const stop = connectAuthenticatedLive({document, window, url:'/api/gemini-status/events',
    unavailable:()=>{warnings++;}, receive:data=>statuses.push(data.status),
    request:async (url,init)=>{
      assert.equal(url,'/api/gemini-status/events');attempts++;
      if(attempts===1)throw Error('Connection dropped');
      return new Response(new ReadableStream({start(controller){
        controller.enqueue(new TextEncoder().encode('data: {"status":"ready"}\n\n'));
        init.signal?.addEventListener('abort',()=>controller.close(),{once:true});
      }}),{headers:{'Content-Type':'text/event-stream'}});
    }});
  await tick();assert.equal(warnings,1);assert.equal(attempts,1);
  window.dispatchEvent(new Event('focus'));await tick();
  assert.deepEqual(statuses,['ready']);assert.equal(attempts,2);
  stop();window.dispatchEvent(new Event('focus'));await tick();assert.equal(attempts,2);
});

test('website distinguishes status-connection failure from actual provider unavailability',()=>{
  const component=readFileSync(new URL('../src/components/GeminiStatus.tsx',import.meta.url),'utf8');
  assert.match(component,/connection_lost: 'Status reconnecting'/);
  assert.match(component,/unavailable: \(\) => setStatus\('connection_lost'\)/);
  assert.doesNotMatch(component,/catch.*setStatus\('unavailable'\)/);
});
