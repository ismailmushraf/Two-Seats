'use client';
import {useRef,useState} from 'react';
import {openCompatibleMovie,type CompatibleMovie} from '../../app/lib/compatible-media';
import {SubtitleOverlay} from '../../app/components/subtitle-overlay';
export default function PgsQA(){
 const video=useRef<HTMLVideoElement>(null),movie=useRef<CompatibleMovie|null>(null),[log,setLog]=useState<string[]>([]),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false);
 async function run(){
 setBusy(true);setLog([]);const v=video.current!,say=(line:string)=>setLog(old=>[...old,line]),wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async(test:()=>boolean,message:string)=>{for(let i=0;i<150;i++){if(test())return;await wait(100)}throw new Error(message)};
 if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=>Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,'0')).join('')});
 const NativeWorker=Worker;globalThis.Worker=class extends NativeWorker{constructor(url:string|URL,options?:WorkerOptions){super(String(url).includes('/media-codecs/')?'/__media-qa/worker-fallback.js':url,options)}};
 const abort=new AbortController();
 const canvas=()=>document.querySelector('[data-testid=pgs-subtitle-overlay]') as HTMLCanvasElement|null;
 const painted=()=>{const c=canvas();return !!c&&!c.hidden&&Array.from(c.getContext('2d')!.getImageData(0,0,c.width,c.height).data).some((value,i)=>i%4===3&&value>0)};
 try{
  const response=await fetch('/__media-qa/pgs.mkv');movie.current=await openCompatibleMovie(v,new File([await response.blob()],'pgs.mkv'),abort.signal,message=>say('FAIL '+message));
  if(movie.current.subtitles[0]?.codec!=='S_HDMV/PGS')throw new Error('PGS track not detected');say('PASS real MKV PGS track detected automatically');
  await v.play();await until(()=>v.currentTime>1.4&&painted(),'PGS picture was not painted over video');v.pause();say('PASS embedded PGS picture rendered on canvas');
  const paused=v.currentTime;await wait(250);if(Math.abs(v.currentTime-paused)>.05||!painted())throw new Error('Pause lost picture or advanced');say('PASS pause holds movie and PGS picture');
  const seek=async(time:number)=>{v.currentTime=time;await until(()=>!v.seeking&&v.readyState>=2,'Video seek failed');await wait(200)};
  await seek(5);if(painted())throw new Error('PGS clear did not hide picture');say('PASS PGS clear removes picture exactly');
  await seek(9);await until(painted,'Split object not rendered');say('PASS split image packets display after seek');
  await seek(10.5);await until(painted,'Palette update not painted');const c=canvas()!,pixels=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let green=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>200&&pixels[i]<50&&pixels[i+2]<50&&pixels[i+3]>200)green++;if(green<30)throw new Error('Palette update color missing');say('PASS palette updates change visible subtitle colours');
  await seek(17);if(movie.current.subtitleBitmap(17)?.parts.length!==2||!painted())throw new Error('Multiple objects missing');say('PASS multiple PGS objects compose together');
  await seek(25);if(movie.current.subtitleBitmap(25)?.parts[0].crop.width!==80||!painted())throw new Error('Cropped picture missing');say('PASS cropped PGS picture survives forward seek');
  await seek(2);await until(painted,'Backward seek lost caption');say('PASS backward seek restores original PGS picture');
  movie.current.selectSubtitles(-1);await until(()=>!painted(),'Off failed');say('PASS CC Off hides PGS');
  movie.current.selectSubtitles(movie.current.subtitles[0].streamIndex);await until(painted,'Track re-enable failed');say('PASS PGS track can be switched back on');
  say('DONE — preview remains paused at the first caption');
 }catch(error){say('FAIL '+String(error));abort.abort();movie.current=null}finally{setBusy(false)}
 }
 return <main style={{padding:24}}><h1>PGS picture subtitle playback checks</h1><button disabled={busy} onClick={run}>Run PGS playback checks</button><button onClick={()=>setExpanded(true)}>Expand picture preview</button><div className={`stage ${expanded?'expanded':''}`} style={{width:expanded?'100vw':640,maxWidth:'100%'}}>{expanded&&<button style={{position:'absolute',zIndex:10,top:10,left:10}} onClick={()=>setExpanded(false)}>Exit picture preview</button>}<video ref={video} playsInline controls/><SubtitleOverlay video={video} read={time=>movie.current?.subtitleText(time)||''} readBitmap={time=>movie.current?.subtitleBitmap(time)||null}/></div><ol>{log.map((line,i)=><li key={i}>{line}</li>)}</ol></main>;
}
