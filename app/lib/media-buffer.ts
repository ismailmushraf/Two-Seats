/** SourceBuffer writes must be serialized by the caller. Evict history before allocating. */
export async function appendWithEviction(
 data:ArrayBuffer,time:()=>number,ranges:()=>TimeRanges,
 append:(data:ArrayBuffer)=>Promise<void>,remove:(start:number,end:number)=>Promise<void>,
){
 if(!data.byteLength)return;
 async function trim(keep:number,margin=0){
  const end=time()-keep,buffered=ranges();
  if(end>0&&buffered.length&&buffered.start(0)<end-margin)await remove(0,end);
 }
 await trim(10,5);
 try{await append(data)}catch(error){
  if(!(error instanceof Error)||error.name!=='QuotaExceededError')throw error;
  // A quota failure rejects before consuming the bytes. Retry that exact fragment once.
  await trim(2);await append(data);
 }
}
