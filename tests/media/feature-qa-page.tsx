'use client';
import {useRef,useState} from 'react';
import {SubtitleOverlay} from '../../app/components/subtitle-overlay';
import {openCompatibleMovie, type CompatibleMovie} from '../../app/lib/compatible-media';
import {VoiceMovieAudio} from '../../app/lib/voice-audio';
export default function QA(){
 const movieRef=useRef<CompatibleMovie|null>(null),video=useRef<HTMLVideoElement>(null),[log,setLog]=useState<string[]>([]),[busy,setBusy]=useState(false);
 async function run(){setBusy(true);const say=(s:string)=>setLog(x=>[...x,s]),v=video.current!;
 if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=>Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,'0')).join('')});
 const NativeWorker=Worker;globalThis.Worker=class extends NativeWorker{constructor(url:string|URL,options?:WorkerOptions){super(String(url).includes('/media-codecs/')?'/__media-qa/worker-fallback.js':url,options)}};
 const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));const until=async(test:()=>boolean,label:string)=>{for(let i=0;i<120;i++){if(test())return;await wait(100)}throw new Error(label)};
 const abort=new AbortController();let mixer:VoiceMovieAudio|undefined;let ctx:AudioContext|undefined;
 try{
 const response=await fetch(location.search.includes('mp4')?'/__media-qa/subtitles.mp4':'/__media-qa/subtitles.mkv');const movie=await openCompatibleMovie(v,new File([await response.blob()],'subs.mkv'),abort.signal,message=>say(`FAIL ${message}`));
 movieRef.current=movie;
 say(`Found ${movie.subtitles.length} subtitle tracks: ${JSON.stringify(movie.subtitles)}`);await v.play();await until(()=>v.currentTime>1,'play');
 const active=()=>movie.subtitleText(v.currentTime);
 await wait(150);if(document.querySelector('[data-testid=subtitle-overlay]')?.textContent!=='Hello from embedded SRT')throw new Error('Subtitle overlay did not render visible text');say('PASS caption painted in the actual player overlay');
 say(`Subtitle at 1s: ${active()}`);if(active()!=='Hello from embedded SRT')throw new Error('Embedded SRT missing');say('PASS embedded SRT displays automatically');
 if(movie.subtitles.length>1){movie.selectSubtitles(movie.subtitles[1].streamIndex);await wait(200);if(active()!=='Hello from embedded SRT')throw new Error('ASS track missing');say('PASS ASS subtitle track selection');}
 movie.selectSubtitles(-1);if(active())throw new Error('Off did not hide subtitles');say('PASS subtitles Off');movie.selectSubtitles(movie.subtitles[0].streamIndex);
 v.currentTime=25;await until(()=>!v.seeking&&v.readyState>=2,'seek');await wait(150);if(active()!=='Subtitle after seek')throw new Error(`Seek subtitle missing: ${active()}`);say('PASS subtitles follow forward seeks');v.currentTime=1;await until(()=>!v.seeking&&v.readyState>=2,'back seek');await wait(150);if(active()!=='Hello from embedded SRT')throw new Error('Back seek subtitle missing');say('PASS subtitles follow backward seeks');v.pause();
 // Real movie through production gain graph, with synthetic voice streams (no microphone permission).
 ctx=new AudioContext();await ctx.resume();const observer=ctx.createAnalyser(),destination=ctx.createMediaStreamDestination(),osc=ctx.createOscillator(),voiceGain=ctx.createGain();osc.frequency.value=1100;voiceGain.gain.value=0;osc.connect(voiceGain);voiceGain.connect(destination);osc.start();
 let local:MediaStream|null=destination.stream,remote:MediaStream|null=null;
 mixer=new VoiceMovieAudio(v,()=>[local,remote]);await mixer.resume();mixer.monitor(true);
 const mixCtx=(mixer as any).context as AudioContext,mixGain=(mixer as any).gain as GainNode,output=mixCtx.createAnalyser();mixGain.connect(output);const samples=new Float32Array(output.fftSize);
 const rms=()=>{output.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length)};
 await v.play();await wait(250);const baseline=rms();if(baseline<.001)throw new Error('Movie output was silent before speech');
 voiceGain.gain.value=.2;await wait(450);const localRatio=rms()/baseline;if(localRatio<.15||localRatio>.4)throw new Error(`Local duck ratio ${localRatio}`);say(`PASS local speech lowers movie to ${(localRatio*100).toFixed(0)}%`);
 local=null;remote=destination.stream;await wait(450);const remoteRatio=rms()/baseline;if(remoteRatio<.15||remoteRatio>.4)throw new Error(`Remote duck ratio ${remoteRatio}`);say(`PASS partner speech lowers movie to ${(remoteRatio*100).toFixed(0)}%`);
 voiceGain.gain.value=0;await wait(1300);const restored=rms()/baseline;if(restored<.9||restored>1.1)throw new Error(`Restore ratio ${restored}`);say('PASS silence restores normal movie sound');
 mixer.monitor(false);await wait(300);if(v.paused||v.readyState<2)throw new Error('Voice monitoring interrupted playback');say('PASS voice changes preserve continuous playback');
 v.pause();say('DONE');
 }catch(e){say(`FAIL ${String(e)}`)}finally{abort.abort();mixer?.destroy();await ctx?.close();setBusy(false)}
 }
 return <main style={{padding:24}}><h1>Voice and embedded subtitle checks</h1><button onClick={run} disabled={busy}>Run feature checks</button><div className="stage" style={{width:640,maxWidth:'100%'}}><video ref={video} playsInline controls/><SubtitleOverlay video={video} read={time=>movieRef.current?.subtitleText(time)||''}/></div><ol>{log.map((s,i)=><li key={i}>{s}</li>)}</ol></main>;
}
