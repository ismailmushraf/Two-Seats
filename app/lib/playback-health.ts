export type PlaybackHealthSample={revision:number;playing:boolean;time:number;paused:boolean;seeking:boolean;readyState:number;hidden:boolean;loading:boolean};
/** Time jumps and seek requests are not proof that decoded frames are advancing. */
export class PlaybackHealth{
 private revision=-1;private time=0;private advanced=0;private reported=false;
 reset(){this.revision=-1;this.reported=false}
 sample(s:PlaybackHealthSample,now:number):'seeking'|'paused'|'buffering'|null{
  if(!s.playing||s.hidden||s.loading){this.reset();return null}
  if(this.revision!==s.revision){this.revision=s.revision;this.time=s.time;this.advanced=now;this.reported=false;return null}
  const moved=s.time-this.time;this.time=s.time;
  if(!s.paused&&!s.seeking&&s.readyState>=2&&moved>.025&&moved<2)this.advanced=now;
  if(this.reported||now-this.advanced<4000)return null;
  this.reported=true;return s.seeking?'seeking':s.paused?'paused':'buffering';
 }
}
/** One pending play per video. Network signaling never awaits a decoder/autoplay promise. */
export class PlaybackStarter{
 private pending=false;
 start(video:{play:()=>Promise<void>},failed:(error:any)=>void){
  if(this.pending)return;this.pending=true;
  try{void video.play().catch(error=>{if(error?.name!=='AbortError')failed(error)}).finally(()=>{this.pending=false})}
  catch(error:any){this.pending=false;if(error?.name!=='AbortError')failed(error)}
 }
}
