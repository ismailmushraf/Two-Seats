'use client';
import {useRef,useState} from 'react';
import {openCompatibleMovie} from '../../app/lib/compatible-media';
export default function MediaQA(){
 const video=useRef<HTMLVideoElement>(null),[log,setLog]=useState<string[]>([]),[running,setRunning]=useState(false);
 async function run(){
 setRunning(true);setLog([]);
 // The internal HTTP preview lacks randomUUID; production HTTPS provides it.
 if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=>Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,'0')).join('')});
 const NativeWorker=Worker;globalThis.Worker=class extends NativeWorker{constructor(url:string|URL,options?:WorkerOptions){super(String(url).includes('/media-codecs/')?(location.search.includes('fallback')?'/__media-qa/worker-fallback.js':'/__media-qa/worker.js'):url,options)}};
const v=video.current!;const say=(s:string)=>setLog(x=>[...x,s]);
 const context=new AudioContext(),node=context.createMediaElementSource(v),analyser=context.createAnalyser();node.connect(analyser);analyser.connect(context.destination);await context.resume();
 const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async(check:()=>boolean,label:string)=>{for(let i=0;i<100;i++){if(check())return;await wait(100)}throw new Error(label)};
 for(const codec of ['ac3','eac3','dts','truehd','multi']){
 const abort=new AbortController();let movie:Awaited<ReturnType<typeof openCompatibleMovie>>|undefined;
 try{
 say(`${codec}: opening`);
 const response=await fetch(`/__media-qa/${codec}.mkv`);const file=new File([await response.blob()],`${codec}.mkv`);
 movie=await openCompatibleMovie(v,file,abort.signal,message=>say(`FAIL ${codec}: ${message}`));
 say(`${codec}: loaded ${movie.duration.toFixed(3)}s, audio ${movie.hasAudio}, ${movie.tracks.length} tracks`);
 await v.play();await until(()=>v.currentTime>1,'video failed to advance');
 let peak=0;const data=new Float32Array(analyser.fftSize);for(let i=0;i<10;i++){analyser.getFloatTimeDomainData(data);peak=Math.max(peak,...data.map(Math.abs));await wait(40)}
 if(peak<.001)throw new Error('decoded audio is silent');say(`PASS ${codec}: audible PCM peak ${peak.toFixed(3)}`);
 v.pause();const paused=v.currentTime;await wait(250);if(Math.abs(v.currentTime-paused)>.05)throw new Error('pause advanced');say(`PASS ${codec}: pause holds immediately`);
 v.currentTime=25;await until(()=>!v.seeking&&v.readyState>=2,'forward seek did not settle');await v.play();await until(()=>v.currentTime>25.2,'forward seek did not play');v.pause();
 v.currentTime=2;await until(()=>!v.seeking&&v.readyState>=2,'backward seek did not settle');await v.play();await until(()=>v.currentTime>2.2,'backward seek did not play');v.pause();say(`PASS ${codec}: forward/back seeks and resume`);
 if(codec==='ac3'){v.currentTime=31;await until(()=>!v.seeking&&v.readyState>=2,'end seek');await v.play();await until(()=>v.ended,'end event missing');v.currentTime=1;await until(()=>!v.seeking&&v.readyState>=2,'seek after end');await v.play();await until(()=>v.currentTime>1.2,'resume after end');v.pause();say('PASS ac3: end-of-movie and replay seek');}
 if(codec==='multi'){
 await movie.selectTrack(movie.tracks[1].streamIndex);await v.play();await wait(500);analyser.getFloatTimeDomainData(data);if(!data.some(x=>Math.abs(x)>.001))throw new Error('second audio track is silent');v.pause();say('PASS multi: audio track switch plays sound');
 }
 }catch(e){say(`FAIL ${codec}: ${String(e)}`)}finally{v.pause();abort.abort();movie?.destroy();v.removeAttribute('src');v.load()}
 }
 await context.close();
 const cancellation=new AbortController(),started=Date.now();const opening=openCompatibleMovie(v,new File([new Uint8Array(100)],'cancel.mkv'),cancellation.signal,()=>{});cancellation.abort();try{await opening;say('FAIL cancellation accepted')}catch(e){say((e instanceof DOMException&&e.name==='AbortError'&&Date.now()-started<2000)?'PASS cancellation: stale selection stops promptly':`FAIL cancellation: ${String(e)}`)}
 say('DONE');setRunning(false);
 }
 return <main style={{padding:32}}><h1>Local movie compatibility QA</h1><button disabled={running} onClick={run}>Run codec checks</button><video style={{width:480,maxWidth:'100%'}} ref={video} playsInline controls/><ol>{log.map((line,i)=><li key={i}>{line}</li>)}</ol></main>;
}
