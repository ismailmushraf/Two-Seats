'use client';
import {useEffect,useRef,useState} from 'react';
import Cinema from '../../app/page';
export default function ConnectionQA(){
 const [ready,setReady]=useState(false),mode=useRef('good'),peer=useRef<any>(null),restarts=useRef(0),[count,setCount]=useState(0);
 useEffect(()=>{
 const originalFetch=window.fetch,NativePeer=window.RTCPeerConnection,originalMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),saved=sessionStorage.getItem('two-seats-room');
 let own='',enabled=false,eventId=0,version=1;const remote='b'.repeat(32);let events:any[]=[];
 const context=new AudioContext();
 navigator.mediaDevices.getUserMedia=async()=>context.createMediaStreamDestination().stream;
 class Peer{
 connectionState='new';iceConnectionState='new';signalingState='stable';localDescription:any=null;remoteDescription:any=null;onconnectionstatechange:any;oniceconnectionstatechange:any;onicecandidate:any;ontrack:any;ondatachannel:any;
 constructor(public config:any){peer.current=this}getConfiguration(){return this.config}setConfiguration(c:any){this.config=c}addTrack(){}
 createDataChannel(){return {readyState:'open',close(){},send(){},onopen:null,onmessage:null,onclose:null}}
 async createOffer(options?:any){if(options?.iceRestart){restarts.current++;setCount(restarts.current)}return {type:'offer',sdp:'test'}}
 async setLocalDescription(description:any){this.localDescription=description;this.signalingState=description.type==='rollback'?'stable':'have-local-offer'}
 async setRemoteDescription(description:any){this.remoteDescription=description;this.signalingState='stable';this.connectionState='connected';this.iceConnectionState='connected';this.onconnectionstatechange?.();this.oniceconnectionstatechange?.()}
 async addIceCandidate(){}close(){this.connectionState='closed'}
 }
 window.RTCPeerConnection=Peer as any;
 const room=()=>({id:'a'.repeat(32),role:'owner',stateVersion:version,serverNow:Date.now(),expires:Date.now()+3600000,playing:false,position:2100000,revision:1,updated:Date.now(),command:'pause',match:true,participants:[{role:'owner',present:true,online:true,ready:true,loaded:true,voice:enabled,voiceSession:own},{role:'guest',present:true,online:true,ready:true,loaded:true,voice:true,voiceSession:remote}],events});
 sessionStorage.setItem('two-seats-room',JSON.stringify({id:'a'.repeat(32)}));
 window.fetch=async(input,options)=>{
  const path=String(input);
  if(path.startsWith('/api/session')){
   if(mode.current==='network'){mode.current='good';return new Response('Temporary gateway failure',{status:502})}
   if(mode.current==='expired')return new Response('Sign in required',{status:401});
   return Response.json({authenticated:true,user:{email:'test@example.invalid',displayName:'QA viewer'},roomService:{available:true}});
  }
  if(path.startsWith('/api/room')){
   const body=options?.body?JSON.parse(String(options.body)):{};
   if(body.action==='voice-config')return Response.json({iceServers:[{urls:'stun:example.invalid'}],expiresAt:Date.now()+14400000,relayConfigured:false});
   if(body.action==='diagnostic')return Response.json({ok:true});
   if(body.action==='voice'){own=body.session;enabled=body.enabled;version++}
   if(body.action==='event'&&body.type==='offer')events=[{id:++eventId,mine:false,type:'answer',created:Date.now(),payload:{fromSession:remote,toSession:own,data:{type:'answer',sdp:'test'}}}];
   return Response.json(room());
  }
  return originalFetch(input,options);
 };
 setReady(true);return()=>{window.fetch=originalFetch;window.RTCPeerConnection=NativePeer;navigator.mediaDevices.getUserMedia=originalMedia;void context.close();if(saved)sessionStorage.setItem('two-seats-room',saved);else sessionStorage.removeItem('two-seats-room')};
 },[]);
 function simulate(next:string){mode.current=next;document.dispatchEvent(new Event('visibilitychange'))}
 function drop(){const p=peer.current;if(p){p.connectionState='disconnected';p.iceConnectionState='disconnected';p.onconnectionstatechange?.();p.oniceconnectionstatechange?.()}}
 return <><div style={{padding:16}}><strong>Local connection QA · ICE restart offers: {count}</strong><button onClick={()=>simulate('network')}>Fail one background network probe</button><button onClick={drop}>Interrupt voice network</button><button onClick={()=>simulate('expired')}>Expire login</button></div>{ready&&<Cinema/>}</>;
}
