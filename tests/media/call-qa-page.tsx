'use client';
import {useEffect,useState} from 'react';
import Cinema from '../../app/page';
// Synthetic two-device fixture: runs the real Cinema UI with shared signaling and silent tracks.
export default function CallQA(){
 const [role,setRole]=useState(''),[ready,setReady]=useState(false),[stats,setStats]=useState('');
 useEffect(()=>{
  const side=new URLSearchParams(location.search).get('role')||'';setRole(side);
  if(!side){
   (window as any).__callQA={people:{owner:{voice:false,voiceSession:''},guest:{voice:false,voiceSession:''}},events:[],version:1,captures:0,offers:0,answers:0,delay:false};
   setReady(true);const timer=setInterval(()=>{const q=(window as any).__callQA;setStats(JSON.stringify({captures:q.captures,offers:q.offers,answers:q.answers,people:q.people}))},250);return()=>clearInterval(timer);
  }
  const q=(window.parent as any).__callQA;if(!q)return;
  const original=window.fetch,OriginalPeer=window.RTCPeerConnection,capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),saved=sessionStorage.getItem('two-seats-room');
  const context=new AudioContext();
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
  window.RTCPeerConnection=Peer as any;
  const room=()=>({id:'a'.repeat(32),role:side,stateVersion:q.version,serverNow:Date.now(),expires:Date.now()+3600000,playing:false,position:0,revision:1,updated:Date.now(),command:'pause',match:true,participants:['owner','guest'].map(role=>({role,present:true,online:true,ready:false,loaded:false,...q.people[role]})),events:q.events.map((e:any)=>({...e,mine:e.sender===side}))});
  sessionStorage.setItem('two-seats-room',JSON.stringify({id:'a'.repeat(32)}));
  window.fetch=async(input,options)=>{
   const path=String(input);if(path.startsWith('/api/session'))return Response.json({authenticated:true,user:{email:side+'@example.invalid',displayName:side},roomService:{available:true}});
   if(path.startsWith('/api/room')){
    const b=options?.body?JSON.parse(String(options.body)):{};const own=q.people[side],peer=q.people[side==='owner'?'guest':'owner'];
    const event=(type:string,payload:any)=>q.events.push({id:q.events.length+1,sender:side,type,payload,created:Date.now()});
    if(b.action==='voice-config')return Response.json({iceServers:[],expiresAt:Date.now()+14400000,relayConfigured:false});
    if(b.action==='diagnostic')return Response.json({ok:true});
    if(b.action==='voice'){
     if(b.enabled){if(b.acceptSession&&peer.voiceSession!==b.acceptSession)return Response.json({error:'Invitation ended'},{status:409});own.voice=true;own.voiceSession=b.session}
     else if(own.voiceSession===b.session){event('hangup',{fromSession:own.voiceSession,toSession:peer.voiceSession,data:null});own.voice=false;own.voiceSession=''}q.version++;
    }
    if(b.action==='decline-call'){
     if(own.voice||peer.voiceSession!==b.session)return Response.json({error:'Invitation ended'},{status:409});event('call-declined',{toSession:b.session});peer.voice=false;peer.voiceSession='';q.version++;
    }
    if(b.action==='event')event(b.type,b.payload);
    return Response.json(room());
   }
   return original(input,options);
  };
  setReady(true);return()=>{window.fetch=original;window.RTCPeerConnection=OriginalPeer;navigator.mediaDevices.getUserMedia=capture;void context.close();if(saved)sessionStorage.setItem('two-seats-room',saved);else sessionStorage.removeItem('two-seats-room')};
 },[]);
 if(!ready)return <p>Preparing call checks…</p>;
 if(role)return <Cinema/>;
 return <><div style={{padding:12}}><strong>Two-device call QA · synthetic microphone and RTC</strong><button onClick={()=>{const q=(window as any).__callQA;q.delay=!q.delay}}>Toggle 4-second microphone delay</button><button onClick={()=>{document.querySelectorAll('iframe').forEach(f=>{const b=Array.from(f.contentDocument!.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Enable voice');b?.click()})}}>Call from both devices together</button><pre style={{whiteSpace:'pre-wrap'}}>{stats}</pre></div><div style={{display:'flex',gap:8}}>{['owner','guest'].map(role=><iframe key={role} title={role} src={'/media-qa?role='+role} style={{width:390,maxWidth:'48vw',height:800,border:'2px solid #621e2a'}}/>)}</div></>;
}
