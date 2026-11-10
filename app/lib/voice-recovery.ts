/** One bounded recovery loop per peer. No microphone acquisition or automatic unmute. */
export class VoiceRecovery {
 private timer:ReturnType<typeof setTimeout>|null=null;
 private attempts=0;
 private stopped=false;
 private running=false;
 private generation=0;
 constructor(private attempt:()=>Promise<void>,private exhausted:()=>void){}
 request(immediate=false){
  if(this.stopped||this.running||this.timer||this.attempts>=3)return;
  this.timer=setTimeout(()=>{this.timer=null;void this.run()},immediate?0:5000);
 }
 private async run(){
  if(this.stopped)return;
  if(this.attempts>=3){this.exhausted();return}
  const generation=this.generation;this.running=true;this.attempts++;
  try{await this.attempt()}catch{/* Retry signaling outages with the same session. */}
  finally{
   this.running=false;
   if(!this.stopped&&generation===this.generation)this.timer=setTimeout(()=>{this.timer=null;void this.run()},12000);
  }
 }
 connected(){this.generation++;this.attempts=0;if(this.timer)clearTimeout(this.timer);this.timer=null;}
 stop(){this.stopped=true;this.generation++;if(this.timer)clearTimeout(this.timer);this.timer=null;}
}
