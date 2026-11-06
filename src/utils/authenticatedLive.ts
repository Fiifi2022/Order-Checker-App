/** Authenticated SSE, suspended for hidden tabs. Reconnects back off on failures. */
export function connectAuthenticatedLive(options:{url:string;request:(url:string,init:RequestInit)=>Promise<Response>;receive:(data:any)=>void;unavailable:()=>void;
  document:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>;window:Pick<Window,'addEventListener'|'removeEventListener'>}){
  let stopped=false,controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined,delay=30000;
  const connect=async()=>{
    if(stopped||options.document.hidden||controller)return;
    clearTimeout(timer);const current=new AbortController();controller=current;
    try{
      const response=await options.request(options.url,{signal:current.signal});
      if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))throw Error('Live stream unavailable');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      while(!current.signal.aborted){
        const {value,done}=await reader.read();if(done)throw Error('Live stream closed');
        // A CRLF separator can straddle two network chunks. Normalize after
        // appending so the frame boundary is still recognized in that case.
        buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');
        if(buffer.length>8_000_000)throw Error('Live stream exceeds limit');
        let boundary;
        while((boundary=buffer.indexOf('\n\n'))>=0){
          const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
          const payload=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
          if(!payload)continue;
          const data=JSON.parse(payload);if(data.error)throw Error('Live stream failed');
          if(stopped||current.signal.aborted)break;
          delay=30000;options.receive(data);
        }
      }
    }catch{if(!current.signal.aborted&&!stopped)options.unavailable();}
    finally{
      if(controller===current)controller=undefined;
      current.abort();
      if(!stopped&&!options.document.hidden&&!controller){timer=setTimeout(()=>void connect(),delay);delay=Math.min(delay*2,300000);}
    }
  };
  const visibility=()=>{
    clearTimeout(timer);
    if(options.document.hidden){controller?.abort();return;}
    if(controller?.signal.aborted)controller=undefined;
    void connect();
  };
  options.document.addEventListener('visibilitychange',visibility);options.window.addEventListener('focus',visibility);void connect();
  return ()=>{stopped=true;clearTimeout(timer);controller?.abort();options.document.removeEventListener('visibilitychange',visibility);options.window.removeEventListener('focus',visibility);};
}
