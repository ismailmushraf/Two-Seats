/** Detect speech locally; no audio samples or activity messages leave this device. */
export function microphoneEnabled(stream:MediaStream|null,wanted:boolean,connected:boolean):boolean{
  const tracks=stream?.getAudioTracks()||[];
  const enabled=wanted&&connected&&tracks.some(track=>track.readyState==='live');
  for(const track of tracks)track.enabled=enabled;
  return enabled;
}
export function speechLevel(samples: Float32Array): number {
  let energy=0;for(const value of samples)energy+=value*value;
  return samples.length?Math.sqrt(energy/samples.length):0;
}
export class SpeechDucking {
  private until=0;
  update(local:number,remote:number,now:number){
    if(Math.max(local,remote)>=0.012)this.until=now+550;
    return now<this.until?0.25:1;
  }
  reset(){this.until=0;}
}
export class VoiceMovieAudio {
  private context:AudioContext|null=null;
  private gain:GainNode|null=null;
  private movieSource:MediaElementAudioSourceNode|null=null;
  private meters=new Map<MediaStream,{source:MediaStreamAudioSourceNode;analyser:AnalyserNode;samples:Float32Array<ArrayBuffer>}>();
  private silent:GainNode|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;
  private speech=new SpeechDucking();
  private enabled=false;
  private disposed=false;
  constructor(private video:HTMLVideoElement,private streams:()=>Array<MediaStream|null>){}
  async resume(){
    if(this.disposed)return;
    try{
      const Context=globalThis.AudioContext||(globalThis as any).webkitAudioContext;
      if(!Context)return;
      this.context??=new Context();const ctx=this.context!;
      await ctx.resume();if(this.disposed||ctx.state!=='running')return;
      if(!this.movieSource){
        // Never reroute a movie into a blocked/suspended context.
        this.gain=ctx.createGain();this.gain.connect(ctx.destination);
        this.movieSource=ctx.createMediaElementSource(this.video);this.movieSource.connect(this.gain);
        this.silent=ctx.createGain();this.silent.gain.value=0;this.silent.connect(ctx.destination);
      }
      if(!this.timer)this.timer=setInterval(()=>this.sample(),50);
    }catch{/* A failed enhancement must not block microphone setup or native playback. */}
  }
  monitor(enabled:boolean){this.enabled=enabled;if(!enabled){this.clearMeters();this.speech.reset();this.setGain(1);}}
  private clearMeters(){for(const meter of this.meters.values()){meter.source.disconnect();meter.analyser.disconnect();}this.meters.clear();}
  private setGain(value:number){if(!this.context||!this.gain)return;this.gain.gain.setTargetAtTime(value,this.context.currentTime,value<1?0.025:0.15);}
  private sample(){
    const ctx=this.context;if(!ctx||ctx.state!=='running'||!this.enabled)return;
    const streams=this.streams().filter((s):s is MediaStream=>!!s&&s.getAudioTracks().some(t=>t.readyState==='live'));
    for(const [stream,meter] of this.meters)if(!streams.includes(stream)){meter.source.disconnect();meter.analyser.disconnect();this.meters.delete(stream);}
    let level=0;
    for(const stream of streams){
      try{
        let meter=this.meters.get(stream);
        if(!meter){const source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();analyser.fftSize=1024;source.connect(analyser);analyser.connect(this.silent!);meter={source,analyser,samples:new Float32Array(analyser.fftSize)};this.meters.set(stream,meter);}
        if(!stream.getAudioTracks().some(t=>t.enabled&&!t.muted))continue;
        meter.analyser.getFloatTimeDomainData(meter.samples);level=Math.max(level,speechLevel(meter.samples));
      }catch{/* An ended/replaced voice track must not affect the movie. */}
    }
    this.setGain(this.speech.update(level,0,performance.now()));
  }
  destroy(){this.disposed=true;if(this.timer)clearInterval(this.timer);this.clearMeters();this.movieSource?.disconnect();this.gain?.disconnect();this.silent?.disconnect();void this.context?.close().catch(()=>{});}
}
