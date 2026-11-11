'use client';
import {useEffect,useState} from 'react';
import Cinema from '../../app/page';
import Diagnostics from '../../app/diagnostics/page';
import {normalizeDiagnostic} from '../../app/lib/diagnostics';
import {mediaMatch,movieDuration} from '../../app/lib/room-response';
// Synthetic two-device fixture: runs the real Cinema UI with shared signaling and silent tracks.
export default function CallQA(){
 const [role,setRole]=useState(''),[ready,setReady]=useState(false),[stats,setStats]=useState('');
 useEffect(()=>{
  const params=new URLSearchParams(location.search),side=params.get('role')||'',real=params.has('real');setRole(side);
  if(!side){
   (window as any).__callQA={people:{owner:{voice:false,voiceSession:''},guest:{voice:false,voiceSession:''}},events:[],version:1,captures:0,offers:0,answers:0,delay:false,pcs:{},failRead:false,readRetries:0,playing:false,position:0,revision:1,updated:Date.now(),stall:false,buffers:0,diagnostics:[]};
   setReady(true);const timer=setInterval(()=>{const q=(window as any).__callQA;setStats(JSON.stringify({captures:q.captures,offers:q.offers,answers:q.answers,people:q.people,playing:q.playing,buffers:q.buffers,videos:Array.from(document.querySelectorAll('iframe')).map(f=>{const v=f.contentDocument?.querySelector('video');return {time:v?.currentTime,paused:v?.paused,seeking:v?.seeking}}),icePackets:q.events.filter((e:any)=>e.type==='ice').length,peers:Object.fromEntries(Object.entries(q.pcs).map(([role,p]:[string,any])=>[role,{connection:p.connectionState,ice:p.iceConnectionState,gathering:p.iceGatheringState,local:p.localDescription?.type,remote:p.remoteDescription?.type}]))}))},250);return()=>clearInterval(timer);
  }
  const q=(window.parent as any).__callQA;if(!q)return;
  const original=window.fetch,OriginalPeer=window.RTCPeerConnection,capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),saved=sessionStorage.getItem('two-seats-room');
  const context=new AudioContext(),OriginalWorker=window.Worker,nativePlay=HTMLMediaElement.prototype.play;
  window.Worker=class extends OriginalWorker{constructor(url:string|URL,options?:WorkerOptions){super(String(url).includes('/media-codecs/')?'/__media-qa/worker-fallback.js':url,options)}};
  HTMLMediaElement.prototype.play=function(){if(side==='owner'&&q.stall)return new Promise((_,reject)=>{q.release=()=>reject(new DOMException('Interrupted test playback','AbortError'))});return nativePlay.call(this)};
  navigator.mediaDevices.getUserMedia=async()=>{q.captures++;if(q.delay)await new Promise(resolve=>setTimeout(resolve,4000));return context.createMediaStreamDestination().stream};
  class Peer{
   connectionState='new';iceConnectionState='new';signalingState='stable';localDescription:any=null;remoteDescription:any=null;onconnectionstatechange:any;oniceconnectionstatechange:any;onicecandidate:any;ontrack:any;ondatachannel:any;
   constructor(public config:any){}getConfiguration(){return this.config}setConfiguration(c:any){this.config=c}addTrack(){}
   createDataChannel(){return {readyState:'open',close(){},send(){},onopen:null,onmessage:null,onclose:null}}
   async createOffer(){q.offers++;return {type:'offer',sdp:'test'}}async createAnswer(){q.answers++;return {type:'answer',sdp:'test'}}
   async setLocalDescription(d:any){this.localDescription=d;this.signalingState=d.type==='offer'?'have-local-offer':'stable';if(d.type==='answer')this.connect()}
   async setRemoteDescription(d:any){this.remoteDescription=d;this.signalingState='stable';if(d.type==='answer')this.connect()}
   connect(){this.connectionState='connected';this.iceConnectionState='connected';this.onconnectionstatechange?.();this.oniceconnectionstatechange?.()}
   async addIceCandidate(){}close(){this.connectionState='closed'}
  }
  if(!real)window.RTCPeerConnection=Peer as any;else window.RTCPeerConnection=class extends OriginalPeer{constructor(config?:RTCConfiguration){super(config);q.pcs[side]=this}};
  const room=()=>({id:'a'.repeat(32),role:side,stateVersion:q.version,serverNow:Date.now(),expires:Date.now()+3600000,playing:q.playing,position:q.position,revision:q.revision,updated:q.updated,command:q.command||'pause',match:mediaMatch(q.people.owner.media,q.people.guest.media),matchKind:mediaMatch(q.people.owner.media,q.people.guest.media)?'duration':'different',participants:['owner','guest'].map(role=>({role,present:true,online:true,ready:false,loaded:false,duration:movieDuration(q.people[role].media),...q.people[role]})),events:q.events.map((e:any)=>({...e,mine:e.sender===side}))});
  sessionStorage.setItem('two-seats-room',JSON.stringify({id:'a'.repeat(32)}));
  window.fetch=async(input,options)=>{
   const path=String(input);if(path.startsWith('/api/diagnostics')){const body=options?.body?JSON.parse(String(options.body)):null;if(body){for(const record of body.records){const safe=normalizeDiagnostic(record);if(safe)q.diagnostics.unshift({id:q.diagnostics.length+1,room:body.room,role:side,created:Date.now(),...safe})}return Response.json({saved:body.records.length})}return side==='owner'?Response.json({records:q.diagnostics,retentionDays:14}):Response.json({error:'Only the site owner can view diagnostics.'},{status:403})}if(path.startsWith('/api/room')&&!options?.body&&q.failRead){q.failRead=false;q.readRetries++;throw new DOMException('Fetch is aborted','AbortError')}if(path.startsWith('/api/session'))return Response.json({authenticated:true,isOwner:side==='owner',user:{email:side+'@example.invalid',displayName:side},roomService:{available:true}});
   if(path.startsWith('/api/room')){
    const b=options?.body?JSON.parse(String(options.body)):{};const own=q.people[side],peer=q.people[side==='owner'?'guest':'owner'];
    const event=(type:string,payload:any)=>q.events.push({id:q.events.length+1,sender:side,type,payload,created:Date.now()});
    if(b.action==='voice-config')return Response.json({iceServers:[],expiresAt:Date.now()+14400000,relayConfigured:false});
    if(b.action==='diagnostic')return Response.json({ok:true});
    if(b.action==='attach'){if(q.playing)q.position+=Date.now()-q.updated;q.playing=false;q.updated=Date.now();q.revision++;q.version++;own.ready=false;if(own.voice){event('hangup',{fromSession:own.voiceSession,toSession:peer.voiceSession,reason:'refreshed'});own.voice=false;own.voiceSession=''}}
    if(b.action==='media'&&own.media!==b.media){own.loaded=true;own.ready=false;own.media=b.media;q.playing=false;q.revision++;q.version++}
    if(b.action==='ready'){own.ready=true;q.version++}
    if(b.action==='control'){q.playing=b.playing;q.position=b.position;q.command=b.command||(b.playing?'play':'pause');q.updated=Date.now();q.revision++;q.version++}
    if(b.action==='voice'){
     if(b.enabled){if(b.acceptSession&&peer.voiceSession!==b.acceptSession)return Response.json({error:'Invitation ended'},{status:409});own.voice=true;own.voiceSession=b.session}
     else if(own.voiceSession===b.session){event('hangup',{fromSession:own.voiceSession,toSession:peer.voiceSession,data:null});own.voice=false;own.voiceSession=''}q.version++;
    }
    if(b.action==='decline-call'){
     if(own.voice||peer.voiceSession!==b.session)return Response.json({error:'Invitation ended'},{status:409});event('call-declined',{toSession:b.session});peer.voice=false;peer.voiceSession='';q.version++;
    }
    if(b.action==='event'){if(real){if(b.type==='offer')q.offers++;if(b.type==='answer')q.answers++}if(['offer','answer','ice','restart'].includes(b.type)&&(!own.voice||!peer.voice||own.voiceSession!==b.payload?.fromSession||peer.voiceSession!==b.payload?.toSession))return Response.json({error:'Voice session changed'},{status:409});event(b.type,b.payload);if(b.type==='buffer'&&q.playing&&(b.payload.revision==null||b.payload.revision===q.revision)){q.playing=false;q.position=b.payload.position;q.command='buffer';q.updated=Date.now();q.revision++;q.version++;q.buffers++}}
    return Response.json(room());
   }
   return original(input,options);
  };
  setReady(true);return()=>{window.fetch=original;window.Worker=OriginalWorker;HTMLMediaElement.prototype.play=nativePlay;window.RTCPeerConnection=OriginalPeer;navigator.mediaDevices.getUserMedia=capture;void context.close();if(saved)sessionStorage.setItem('two-seats-room',saved);else sessionStorage.removeItem('two-seats-room')};
 },[]);
 if(!ready)return <p>Preparing call checks…</p>;
 if(role)return location.search.includes('diagnostics')?<Diagnostics/>:<Cinema/>;
 return <><div style={{padding:12}}><strong>Two-device call QA · synthetic microphone · optional native WebRTC with ?real=1</strong><button onClick={()=>{const q=(window as any).__callQA;q.delay=!q.delay}}>Toggle 4-second microphone delay</button><button onClick={()=>{document.querySelectorAll('iframe').forEach(f=>{const b=Array.from(f.contentDocument!.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Enable voice');b?.click()})}}>Call from both devices together</button><button onClick={()=>{(window as any).__callQA.failRead=true;document.querySelectorAll('iframe').forEach(f=>f.contentDocument!.dispatchEvent(new Event('visibilitychange')))}}>Interrupt fetch and return to room</button><button onClick={async()=>{for(const [index,frame] of Array.from(document.querySelectorAll('iframe')).entries()){const data=await(await fetch(index===1?'/__media-qa/subtitles.mp4':'/__media-qa/subtitles.mkv')).blob();const transfer=new DataTransfer();transfer.items.add(new File([data],index===1?'Different title.mp4':'subtitles.mkv'));const input=frame.contentDocument!.querySelector('input[accept^="video/"]') as HTMLInputElement;input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))}}}>Load subtitle movie on both devices</button><button onClick={()=>{const q=(window as any).__callQA;q.stall=true;document.querySelector('iframe')!.contentDocument!.querySelector('video')!.pause()}}>Stall first player</button><button onClick={()=>{const q=(window as any).__callQA;q.stall=false;q.release?.()}}>Release stalled player</button><button onClick={()=>{const frame=document.querySelector('iframe')!;const transfer=new DataTransfer();transfer.items.add(new File(['1\n00:00:00,000 --> 00:00:30,000\nSaved sidecar after refresh\n'],'remember-me.srt'));const input=frame.contentDocument!.querySelector('input[aria-label="Choose subtitle file"]') as HTMLInputElement;input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))}}>Add sidecar to first device</button><button onClick={()=>document.querySelector('iframe')!.contentWindow!.location.reload()}>Refresh first device</button><button onClick={()=>{document.querySelectorAll('iframe')[0].src='/media-qa?role=owner&diagnostics=1'}}>Open owner reports</button><button onClick={()=>{document.querySelectorAll('iframe')[1].src='/media-qa?role=guest&diagnostics=1'}}>Open partner reports</button><pre style={{whiteSpace:'pre-wrap'}}>{stats}</pre></div><div style={{display:'flex',gap:8}}>{['owner','guest'].map(role=><iframe key={role} title={role} src={'/media-qa?role='+role+(location.search.includes('real')?'&real=1':'')} style={{width:390,maxWidth:'48vw',height:800,border:'2px solid #621e2a'}}/>)}</div></>;
}
