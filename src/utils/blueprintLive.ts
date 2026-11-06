import {connectAuthenticatedLive} from './authenticatedLive';

// Recheck the selected saved document when returning from FS. A stream can
// remain open after sleep or a proxy interruption without delivering updates.
// This is event-driven recovery, not background polling of every district.
export function connectBlueprintLive(options:Parameters<typeof connectAuthenticatedLive>[0]) {
  let stopped=false,pending:AbortController|undefined;
  const currentUrl=/\/api\/vaccine\/blueprint-districts\/[^/]+\/events$/.test(options.url)?options.url.replace(/\/events$/, '/current'):options.url;
  const refresh=async()=>{
    if(stopped||options.document.hidden||pending||currentUrl===options.url)return;
    const controller=new AbortController();pending=controller;
    let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},10000);
    try {
      const response=await options.request(currentUrl,{signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw Error('Saved allocation unavailable');
      const data=await response.json();
      if(!data.sheet||data.error)throw Error('Saved allocation unavailable');
      if(!stopped&&!controller.signal.aborted&&!options.document.hidden)options.receive(data);
    } catch {
      if(!stopped&&(!controller.signal.aborted||timedOut)&&!options.document.hidden)options.unavailable();
    } finally {clearTimeout(timeout);if(pending===controller)pending=undefined;}
  };
  const stopLive=connectAuthenticatedLive({...options,unavailable:()=>{options.unavailable();void refresh();}});
  const returnToSheet=()=>{
    if(options.document.hidden){pending?.abort();pending=undefined;return;}
    void refresh();
  };
  options.document.addEventListener('visibilitychange',returnToSheet);
  options.window.addEventListener('focus',returnToSheet);
  options.window.addEventListener('online',returnToSheet);
  return ()=>{
    stopped=true;pending?.abort();stopLive();
    options.document.removeEventListener('visibilitychange',returnToSheet);
    options.window.removeEventListener('focus',returnToSheet);
    options.window.removeEventListener('online',returnToSheet);
  };
}
