import type {RequestHandler} from 'express';

type Message={sheet:any;checkedAt:string}|{error:string};
/** One selected-document listener per server, shared by its visible viewers. */
export function createBlueprintLiveHub(watch:(id:string,next:(sheet:any)=>void,error:()=>void)=>()=>void){
  const entries=new Map<string,{listeners:Set<(message:Message)=>void>;stop:()=>void;latest?:Message}>();
  return {subscribe(id:string,listener:(message:Message)=>void){
    let entry=entries.get(id);
    if(!entry){
      entry={listeners:new Set(),stop:()=>{}};entries.set(id,entry);
      const current=entry;
      current.listeners.add(listener);
      let stop=()=>{};
      try{stop=watch(id,sheet=>{
        const message:Message=sheet?{sheet:{...sheet,id},checkedAt:new Date().toISOString()}:{error:'This sheet no longer exists. Reload the sheet list.'};
        current.latest=message;for(const callback of current.listeners)callback(message);
      },()=>{
        const message:Message={error:'Live updates are unavailable. Check the latest allocation before fulfilment.'};
        current.latest=message;for(const callback of current.listeners)callback(message);
      });}catch{
        entries.delete(id);current.latest={error:'Live updates are unavailable. Check the latest allocation before fulfilment.'};
        for(const callback of current.listeners)callback(current.latest);
      }
      current.stop=stop;
      // A synchronous failure can close the subscriber before watch returns.
      if(entries.get(id)!==current)stop();
    }else{entry.listeners.add(listener);if(entry.latest)listener(entry.latest);}
    const current=entry;
    return ()=>{current.listeners.delete(listener);if(!current.listeners.size && entries.get(id)===current){entries.delete(id);current.stop();}};
  }};
}

export function blueprintLiveHandler(hub:ReturnType<typeof createBlueprintLiveHub>,authorize:(req:any)=>Promise<boolean>):RequestHandler{
  return (req,res)=>{
    const id=req.params.id;
    if(typeof id!=='string'||!id||id.length>200||/[\/\x00-\x1f]/.test(id)){res.status(400).json({error:'Invalid allocation sheet.'});return;}
    res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-store');res.setHeader('X-Accel-Buffering','no');res.flushHeaders?.();
    let closed=false,stop=()=>{},timer:ReturnType<typeof setInterval>|undefined;
    const close=()=>{if(closed)return;closed=true;clearInterval(timer);stop();res.end();};
    res.on('close',close);
    let queued:Message|undefined,delivering=false;
    const deliver=async()=>{
      if(delivering||closed)return;delivering=true;
      try{
        while(queued&&!closed){
          const message=queued;queued=undefined;
          if('error' in message){res.write(`data: ${JSON.stringify(message)}\n\n`);close();break;}
          // Current role/token checks apply to each delivery, not a cached grant.
          let deadline:ReturnType<typeof setTimeout>|undefined;let allowed=false;
          try{allowed=await Promise.race([authorize(req),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error('Live authorization timed out')),5000);deadline.unref?.();})]);}
          finally{clearTimeout(deadline);}
          if(!allowed){if(!closed)res.write(`data: ${JSON.stringify({error:'Live access could not be verified. Sign in or retry before using these balances.'})}\n\n`);close();break;}
          if(closed)break;
          if(res.write(`data: ${JSON.stringify(message)}\n\n`)===false){close();break;}
        }
      }catch{if(!closed)res.write(`data: ${JSON.stringify({error:'Live updates are unavailable. Check the latest allocation before fulfilment.'})}\n\n`);close();}
      finally{delivering=false;}
    };
    stop=hub.subscribe(id,message=>{queued=message;void deliver();});
    if(closed){stop();return;}
    timer=setInterval(()=>{if(!closed)res.write(': keepalive\n\n');},25000);timer.unref?.();
  };
}
