export type PlaybackIntent={playing:boolean;position:number;command:'play'|'pause'|'seek'};
export function capturePlaybackIntent(media:{currentTime:number;pause:()=>void}|null,playing:boolean,position?:number,command?:string):PlaybackIntent {
 // Capture the frame at the tap; network waits and conflict retries must not move it.
 const captured=position??(media?.currentTime||0)*1000;
 if(!playing)media?.pause();
 return {playing,position:Math.max(0,captured),command:command==='seek'?'seek':playing?'play':'pause'};
}
export async function commitPlaybackIntent<T extends {revision:number;playing:boolean;position:number;updated:number;serverNow:number;command?:string|null}>(intent:PlaybackIntent,revision:number,transport:{send:(intent:PlaybackIntent,revision:number)=>Promise<T>;refresh:()=>Promise<T>;accept:(state:T)=>Promise<void>}) {
 let next={...intent};
 for(let attempt=0;attempt<2;attempt++){
  try{const state=await transport.send(next,revision);await transport.accept(state);return state}
  catch(error:any){
   if(error.status!==409||attempt===1)throw error;
   const latest=await transport.refresh();await transport.accept(latest);
   // A simultaneous pause already achieved the requested state. Keep its position.
   if(next.command==='pause'&&!latest.playing)return latest;
   // Never replay a pre-seek pause position over a newer explicit seek.
   if(next.command==='pause'&&latest.command==='seek')next={...next,position:latest.position+Math.max(0,latest.serverNow-latest.updated)};
   revision=latest.revision;
  }
 }
 throw new Error('Playback could not be updated.');
}
