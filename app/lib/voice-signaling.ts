/** Keep packets that arrive ahead of their room snapshot instead of losing them forever. */
export class VoiceSignalingInbox{
 private pending=new Map<number,any>();
 push(event:any){this.pending.set(event.id,event);if(this.pending.size>128)this.pending.delete(this.pending.keys().next().value!)}
 clear(){this.pending.clear()}
 take(own:string,peer:string,announcedOwn:string|null|undefined,now:number){
  const ready:any[]=[];
  for(const [id,event] of this.pending){
   if(!own||event.payload?.toSession!==own||now-event.created>60000){this.pending.delete(id);continue}
   if(announcedOwn===own&&peer&&event.payload.fromSession===peer){ready.push(event);this.pending.delete(id)}
  }
  return ready;
 }
}
export function canNegotiateVoice(participants:{role:string;voice:boolean;voiceSession?:string|null}[],role:string,own:string){
 return !!own&&participants.find(p=>p.role===role)?.voiceSession===own&&participants.every(p=>p.voice&&p.voiceSession);
}
/** Media priming is best effort. An interrupted play() must never block room readiness. */
export function primePlayback(video:HTMLVideoElement,shouldPause:()=>boolean,muted:boolean,blocked:()=>void){
 video.muted=true;
 try{void video.play().catch(error=>{if(error?.name!=='AbortError')blocked()}).finally(()=>{if(shouldPause())video.pause();video.muted=muted})}
 catch(error:any){video.muted=muted;if(error?.name!=='AbortError')blocked()}
}
