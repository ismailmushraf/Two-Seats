'use client';
import {useRef,useState} from 'react';
import {openCompatibleMovie} from '../../app/lib/compatible-media';
export default function LongSessionQA(){
 const video=useRef<HTMLVideoElement>(null),[log,setLog]=useState<string[]>([]),[running,setRunning]=useState(false);
 async function run(){
  setRunning(true);setLog([]);const say=(line:string)=>setLog(lines=>[...lines,line]);
  const NativeWorker=Worker,nativeInterval=window.setInterval.bind(window),abort=new AbortController();let movie:Awaited<ReturnType<typeof openCompatibleMovie>>|undefined;
  const v=video.current!,wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));let problem='';
  try{
   globalThis.Worker=class extends NativeWorker{constructor(url:string|URL,options?:WorkerOptions){super(String(url).includes('/media-codecs/')?'/__media-qa/worker.js':url,options)}};
   const file=new File([await (await fetch('/__media-qa/long.mkv')).blob()],'long.mkv');
   // Accelerate pumping and advance only within already buffered frames. This still reads,
   // transcodes, appends and evicts every fragment of the 40-minute file in order.
   window.setInterval=((fn:TimerHandler,ms?:number,...args:any[])=>nativeInterval(fn,ms===200?1:ms,...args)) as typeof window.setInterval;
   movie=await openCompatibleMovie(v,file,abort.signal,message=>{problem=message;say('FAIL '+message)});
   window.setInterval=nativeInterval;say('Opened 40-minute H.264 / AC-3 MKV');
   let marker=0,maxSpan=0;const started=performance.now();
   while(v.currentTime<2395){
    if(problem)throw new Error(problem);if(performance.now()-started>240000)throw new Error('Long session timed out');
    const ranges=v.buffered;
    if(ranges.length){const end=ranges.end(ranges.length-1);maxSpan=Math.max(maxSpan,end-ranges.start(0));if(!v.seeking&&end>v.currentTime+1)v.currentTime=Math.min(2395,end-.5);}
    if(v.currentTime>=marker){say(`Sequentially processed ${Math.floor(v.currentTime/60)} minutes; buffered span ${maxSpan.toFixed(1)}s`);marker+=300;}
    await wait(10);
   }
   await wait(300);await v.play();const start=v.currentTime;await wait(600);if(v.currentTime<=start+.15)throw new Error('Playback did not advance after minute 39');
   v.pause();const paused=v.currentTime;await wait(250);if(Math.abs(v.currentTime-paused)>.05)throw new Error('Pause advanced');
   say('PASS: all 40 minutes processed sequentially; playback and pause work after minute 39');
   if(maxSpan>45)throw new Error('History grew unexpectedly');say(`PASS: buffer stayed bounded (${maxSpan.toFixed(1)}s maximum)`);
   v.currentTime=2100;for(let n=0;n<300&&(v.seeking||v.readyState<2);n++)await wait(20);await v.play();const seek=v.currentTime;await wait(500);if(v.currentTime<=seek+.1)throw new Error('Back seek at 35 minutes failed');v.pause();say('PASS: backward seek and resume at minute 35');
  }catch(error){say('FAIL '+String(error))}finally{window.setInterval=nativeInterval;globalThis.Worker=NativeWorker;v.pause();abort.abort();movie?.destroy();setRunning(false);say('DONE')}
 }
 return <main style={{padding:24}}><h1>Long-session media QA</h1><button disabled={running} onClick={run}>Run 40-minute media checks</button><video ref={video} playsInline controls style={{display:'block',width:480}}/><ol>{log.map((line,index)=><li key={index}>{line}</li>)}</ol></main>
}
