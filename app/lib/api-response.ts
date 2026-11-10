export class ApiResponseError extends Error{
 constructor(message:string,readonly status:number,readonly code:'auth'|'response'|'connection'|'canceled'='response'){super(message);this.name='ApiResponseError';}
}
/** A brief verification failure is not a logout. Require confirmation over ten seconds. */
export class SessionRecovery{
 private first:number|null=null;
 private attempts=0;
 private authFailures=0;
 get active(){return this.first!==null;}
 success(){this.first=null;this.attempts=0;this.authFailures=0;}
 failure(auth:boolean,now:number){
  this.first??=now;this.attempts++;if(auth)this.authFailures++;else this.authFailures=0;
  const elapsed=now-this.first;
  if(elapsed>=10000){if(auth&&this.authFailures<2)return {state:'reconnecting' as const,delay:1000};return {state:auth?'signedout' as const:'error' as const,delay:0};}
  return {state:'reconnecting' as const,delay:Math.min([1000,3000,6000][Math.min(this.attempts-1,2)],10000-elapsed)};
 }
}
export async function readApiResponse(response:Response):Promise<any>{
 const expired=()=>new ApiResponseError('Your sign-in expired. Sign in again to reconnect to your room.',401,'auth');
 // Gateways can send HTML or redirects on an expired session. Check before JSON parsing.
 if([401,419,440].includes(response.status))throw expired();
 const type=response.headers.get('content-type')||'';
 if(!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(type)){
  const text=(await response.text()).slice(0,16000);
  if((response.ok||response.status===403)&&/signin-with-chatgpt|continue with chatgpt|log in to access|sign in required/i.test(text))throw expired();
  if(response.redirected&&/\/signin-with-chatgpt(?:[/?]|$)/i.test(response.url))throw expired();
  throw new ApiResponseError(response.status===429?'Too many requests. Please wait a moment and retry.':'The connection returned an unexpected page. Please retry.',response.ok?502:response.status);
 }
 let data:any;try{data=await response.json();}catch{throw new ApiResponseError('The server response was incomplete. Please retry.',502);}
 if(!data||typeof data!=='object')throw new ApiResponseError('The server returned an invalid response. Please retry.',502);
 if(!response.ok)throw new ApiResponseError(typeof data?.error==='string'?data.error:'Could not connect. Please retry.',response.status);
 return data;
}

/** A failed network probe cannot revoke an already verified identity. Explicit auth failures can. */
export function keepVerifiedSession(verified:boolean,error:unknown){return verified&&!(error instanceof ApiResponseError&&error.code==='auth');}

/** Retry only reads or explicitly idempotent actions; never replay playback or room creation. */
export async function requestJson(input:RequestInfo|URL,init:RequestInit={},options:{retry?:boolean;timeout?:number;current?:()=>boolean}={}){
 for(let attempt=0;;attempt++){
  const controller=new AbortController(),signal=init.signal;
  const cancel=()=>controller.abort();if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,options.timeout??15000);
  try{return await readApiResponse(await fetch(input,{...init,signal:controller.signal}))}
  catch(error){
   if(signal?.aborted)throw new ApiResponseError('Request canceled.',0,'canceled');
   const e=error instanceof ApiResponseError?error:new ApiResponseError('The connection was interrupted. Please retry.',408,'connection');
   if(options.retry&&attempt===0&&[408,502,503,504].includes(e.status)&&options.current?.()!==false){continue}
   throw e;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
 }
}
