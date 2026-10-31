export type SyncSample={revision:number;playing:boolean;position:number;updated:number;command?:string|null};
export type SyncMemory={revision:number;lastSeek:number;largeDrift:number};
export function playbackPlan(sample:SyncSample,media:{time:number;duration:number;seeking:boolean;paused:boolean},memory:SyncMemory,now:number,serverNow:number){
 const target=Math.min(media.duration,Math.max(0,(sample.position+(sample.playing?Math.max(0,serverNow-sample.updated):0))/1000));
 if(media.seeking)return {target,rate:1,seek:false,next:memory};
 const changed=sample.revision!==memory.revision;
 const drift=target-media.time;
 const next={...memory,revision:sample.revision};
 let seek=false,rate=1;
 if(changed){
   next.largeDrift=0;
   // Explicit seeks and pauses are applied once, rather than on each poll.
   const threshold=sample.command==='seek'||!sample.playing?0.25:1.5;
   seek=Math.abs(drift)>threshold;
 }else if(sample.playing){
   next.largeDrift=Math.abs(drift)>4?memory.largeDrift+1:0;
   // Require sustained drift and a cooldown before doing a recovery seek.
   seek=next.largeDrift>=3&&now-memory.lastSeek>10000;
   if(!seek&&Math.abs(drift)>0.25)rate=drift>0?1.02:0.98;
 }
 if(seek){next.lastSeek=now;next.largeDrift=0}
 return {target,rate,seek,next};
}
