'use client';
import { useEffect,useRef,useState } from 'react';
import { readApiResponse, ApiResponseError, SessionRecovery } from './lib/api-response';
import { parseRoomInvite } from './lib/invites';
import { playbackPlan } from './lib/playback';
import { capturePlaybackIntent, commitPlaybackIntent } from './lib/playback-controls';
import { ReactionInbox, reactionPacket } from './lib/reactions';
import { activeSubtitle, parseSubtitleFile, type SubtitleChoice, type SubtitleCue } from './lib/subtitles';
import { SubtitleOverlay } from './components/subtitle-overlay';
import { VoiceMovieAudio, microphoneEnabled } from './lib/voice-audio';
import { microphoneIssue, type MicrophoneIssue } from './lib/microphone';
import { isMatroska, openCompatibleMovie, type CompatibleMovie, type MovieTrack } from './lib/compatible-media';
import { Armchair,ArrowUpRight,Captions,Check,CheckCheck,ChevronDown,Copy,Expand,Film,Headphones,Heart,Link as LinkIcon,LoaderCircle,Lock,Mic,MicOff,Minimize,Pause,Play,Plus,ShieldCheck,SkipBack,Smile,Upload,Volume2,VolumeX,X } from 'lucide-react';
type Session={user:{displayName:string;email:string};roomService:{available:boolean}};
type Person={role:string;present:boolean;online:boolean;ready:boolean;loaded:boolean;voice:boolean;voiceSession?:string|null};
type Room={id:string;role:string;stateVersion:number;serverNow:number;expires:number;playing:boolean;position:number;revision:number;updated:number;command?:string|null;match:boolean;participants:Person[];events:any[]};
const clock=(n:number)=>{if(!Number.isFinite(n))return '0:00';const s=Math.max(0,Math.floor(n));return s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
const reactions=['❤️','😂','😱','🥹','👏','😘'];
export default function Cinema(){
 const [session,setSession]=useState<Session|null>(null),[authStatus,setAuthStatus]=useState<'checking'|'verified'|'signedout'|'error'|'reconnecting'>('checking'),[accountOpen,setAccountOpen]=useState(false);
 const authEpoch=useRef(0),verifiedSession=useRef(false),sessionCheck=useRef(false),everVerified=useRef(false),sessionRecovery=useRef(new SessionRecovery()),recoveryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 function verificationFailed(auth:boolean){
 authEpoch.current++;verifiedSession.current=false;video.current?.pause();stopVoice(false);pendingControl.current=null;localPlaybackGoal.current=false;pauseFailed.current=true;setOptimisticPlaying(false);
 if(recoveryTimer.current)clearTimeout(recoveryTimer.current);recoveryTimer.current=null;
 if(auth&&!everVerified.current){setSession(null);setAuthStatus('signedout');return}
 const plan=sessionRecovery.current.failure(auth,Date.now());setAuthStatus(plan.state);
 if(plan.state==='signedout'){setSession(null);setError('Your sign-in expired. Sign in again to reconnect to your room.');return}
 if(plan.state==='error'){setError('Could not verify the connection. Your room and movie selection are kept. Retry the login check.');return}
 setError('');recoveryTimer.current=setTimeout(()=>{recoveryTimer.current=null;checkSession()},plan.delay);
 }
 async function checkSession(){
 if(sessionCheck.current)return;sessionCheck.current=true;const epoch=authEpoch.current;
 try{const res=await fetch('/api/session',{headers:{Accept:'application/json'},credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)});const data=await readApiResponse(res);if(epoch!==authEpoch.current)return;if(!data.authenticated||!data.user?.email)throw new ApiResponseError('Sign in required.',401,'auth');const recovered=sessionRecovery.current.active;sessionRecovery.current.success();if(recoveryTimer.current)clearTimeout(recoveryTimer.current);recoveryTimer.current=null;everVerified.current=true;verifiedSession.current=true;setSession(data);setAuthStatus('verified');if(recovered){setError('');toast('Connection verified again. Press Play when you’re ready.')}}
 catch(e){if(epoch!==authEpoch.current)return;verificationFailed(e instanceof ApiResponseError&&e.code==='auth')}finally{sessionCheck.current=false}
 }
 useEffect(()=>{checkSession();const interval=setInterval(checkSession,60000);const refresh=()=>{if(!document.hidden)checkSession()};document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(interval);document.removeEventListener('visibilitychange',refresh)}},[]);
 const canUseRooms=authStatus==='verified'&&!!session?.roomService.available;
 const [room,setRoom]=useState<Room|null>(null),[roomId,setRoomId]=useState(''),[invite,setInvite]=useState(''),[joinInput,setJoinInput]=useState(''),[invited,setInvited]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[fileName,setFileName]=useState(''),[loadingFile,setLoadingFile]=useState(false),[duration,setDuration]=useState(0),[time,setTime]=useState(0),[expanded,setExpanded]=useState(false),[muted,setMuted]=useState(false),[voice,setVoice]=useState('off'),[talking,setTalking]=useState(false),[blocked,setBlocked]=useState(false),[help,setHelp]=useState(false),[reactionMenu,setReactionMenu]=useState(false),[floats,setFloats]=useState<{id:number;emoji:string;mine:boolean}[]>([]);
 const syncMemory=useRef({revision:-1,lastSeek:0,largeDrift:0}),bestRtt=useRef(Infinity),clockKnown=useRef(false),scrubbing=useRef(false),waitingTimer=useRef<ReturnType<typeof setTimeout>|null>(null),pendingControl=useRef<{playing:boolean;position?:number;command?:string}|null>(null),ownVoiceSession=useRef(''),peerVoiceSession=useRef(''),relayConfigured=useRef(false);
 const micOn=useRef(false),remoteVoiceStream=useRef<MediaStream|null>(null),movieAudio=useRef<VoiceMovieAudio|null>(null);
 function resumeMovieAudio(){if(video.current){movieAudio.current??=new VoiceMovieAudio(video.current,()=>[stream.current,remoteVoiceStream.current]);void movieAudio.current.resume()}}
 const mediaBusy=useRef(false),compatibleMovie=useRef<CompatibleMovie|null>(null),movieAbort=useRef<AbortController|null>(null),selectedMovie=useRef<File|null>(null);
 const subtitleInput=useRef<HTMLInputElement>(null),externalSubtitles=useRef<SubtitleCue[]|null>(null),subtitleSelection=useRef(-1),subtitleDelay=useRef(0);
 const [subtitleOffset,setSubtitleOffset]=useState(0),[subtitleStatus,setSubtitleStatus]=useState(''),[subtitleFileError,setSubtitleFileError]=useState('');
 const [subtitleChoices,setSubtitleChoices]=useState<SubtitleChoice[]>([]),[subtitleChoice,setSubtitleChoice]=useState(-1);
 const [movieAudioStatus,setMovieAudioStatus]=useState(''),[audioTracks,setAudioTracks]=useState<MovieTrack[]>([]),[selectedTrack,setSelectedTrack]=useState(-1),[repairingAudio,setRepairingAudio]=useState(false);
 const [voiceDetail,setVoiceDetail]=useState(''),[hasRelay,setHasRelay]=useState<boolean|null>(null);
 const [optimisticPlaying,setOptimisticPlaying]=useState<boolean|null>(null);
 const localPlaybackGoal=useRef<boolean|null>(null),pauseFailed=useRef(false);
 const reactionInbox=useRef(new ReactionInbox()),seenEvents=useRef(new Set<number>()),channel=useRef<RTCDataChannel|null>(null),voiceEnabling=useRef(false),voiceTimeout=useRef<ReturnType<typeof setTimeout>|null>(null),relayConfigCache=useRef<any>(null),rtcStarted=useRef(false),connectionPing=useRef<ReturnType<typeof setInterval>|null>(null);
 const [micIssue,setMicIssue]=useState<MicrophoneIssue|null>(null),[audioBlocked,setAudioBlocked]=useState(false),[liveUpdates,setLiveUpdates]=useState(false),[roundTrip,setRoundTrip]=useState<number|null>(null),[externalUrl,setExternalUrl]=useState('/');
 const joiningInvite=useRef(false),lastAutoInvite=useRef(''),roomPanel=useRef<HTMLElement>(null);
 useEffect(()=>{setExternalUrl(roomId?`${location.origin}/?room=${encodeURIComponent(roomId)}`:location.href)},[roomId]);
 const video=useRef<HTMLVideoElement>(null),audio=useRef<HTMLAudioElement>(null),stage=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),roomRef=useRef<Room|null>(null),cursor=useRef(0),urlRef=useRef(''),pc=useRef<RTCPeerConnection|null>(null),stream=useRef<MediaStream|null>(null),ice=useRef<any[]>([]),eventChain=useRef(Promise.resolve()),offerBusy=useRef(false),offset=useRef(0),lastBuffer=useRef(0),pollLock=useRef(false),fileVersion=useRef(0),controlsBusy=useRef(false),mounted=useRef(true);
 function toast(s:string){setNotice(s);setTimeout(()=>setNotice(''),4500)}
 async function api(data?:any,id?:string){const rid=id||roomRef.current?.id||roomId;const started=Date.now(),epoch=authEpoch.current;const res=await fetch(`/api/room${data?'':`?id=${encodeURIComponent(rid)}&after=${cursor.current}`}`,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json',Accept:'application/json'}:{Accept:'application/json'},credentials:'same-origin',body:data?JSON.stringify({...data,id:rid,after:cursor.current}):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});let b:any;try{b=await readApiResponse(res)}catch(e){if(e instanceof ApiResponseError&&e.code==='auth'&&epoch===authEpoch.current)verificationFailed(true);throw e}if(epoch!==authEpoch.current)throw new ApiResponseError('That request was interrupted while reconnecting. Please retry.',409);if(b.serverNow){const received=Date.now(),rtt=received-started;const sample=b.serverNow-(started+received)/2;if(!clockKnown.current){offset.current=sample;clockKnown.current=true;bestRtt.current=rtt}else if(rtt<=bestRtt.current*1.25+25){offset.current=offset.current*0.9+sample*0.1;bestRtt.current=Math.min(bestRtt.current,rtt)}}return b}
 function addReaction(emoji:string,mine:boolean){const id=Date.now()+Math.random();setFloats(a=>[...a.slice(-8),{id,emoji,mine}]);setTimeout(()=>setFloats(a=>a.filter(x=>x.id!==id)),4200)}
 function receiveReaction(value:unknown){const packet=reactionInbox.current.accept(value);if(packet)addReaction(packet.emoji,false)}
 function reactTogether(emoji:string){
 const packet={id:crypto.randomUUID().replaceAll('-',''),emoji};reactionInbox.current.accept(packet);addReaction(emoji,true);
 if(channel.current?.readyState==='open')try{channel.current.send(JSON.stringify({type:'reaction',...packet}))}catch{}
 sendEvent('reaction',packet).catch(e=>setError(e.message));
 }
 function reportVoice(code:string){if(roomRef.current)api({action:'diagnostic',code}).catch(()=>{})}
 function ingestEvents(events:any[],serverNow:number){
 for(const e of events||[]){if(seenEvents.current.has(e.id))continue;seenEvents.current.add(e.id);cursor.current=Math.max(cursor.current,e.id);if(seenEvents.current.size>1000)seenEvents.current.delete(seenEvents.current.values().next().value!);
 if(e.mine)continue;
 if(e.type==='reaction'){if(serverNow-e.created<8000){if(typeof e.payload==='string')addReaction(e.payload,false);else receiveReaction(e.payload)}continue}
 if(e.type==='buffer'){toast('Your partner paused while their movie catches up. Press play when both are ready.');continue}
 if(['offer','answer','ice','hangup'].includes(e.type))eventChain.current=eventChain.current.then(()=>handleEvent(e)).catch(()=>{setVoice('failed');setVoiceDetail('The voice handshake failed. Disconnect and enable voice on both devices again.');reportVoice('rtc_failed')});
 }
 }
 async function sendEvent(type:string,payload:any){const b=await api({action:'event',type,payload});await accept(b)}
 function stopVoice(update=true){
 micOn.current=false;remoteVoiceStream.current=null;movieAudio.current?.monitor(false);if(audio.current){audio.current.pause();audio.current.srcObject=null}
 if(voiceTimeout.current)clearTimeout(voiceTimeout.current);voiceTimeout.current=null;rtcStarted.current=false;channel.current?.close();channel.current=null;if(connectionPing.current)clearInterval(connectionPing.current);connectionPing.current=null;setRoundTrip(null);setAudioBlocked(false);
 const session=ownVoiceSession.current;ownVoiceSession.current='';peerVoiceSession.current='';
 stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;
 const old=pc.current;pc.current=null;old?.close();ice.current=[];offerBusy.current=false;setTalking(false);setVoice('off');setVoiceDetail('');
 if(update&&roomRef.current&&session)api({action:'voice',enabled:false,session}).then(accept).catch(()=>{});
 }
 async function sendVoice(type:string,data:any){
 const fromSession=ownVoiceSession.current,toSession=peerVoiceSession.current;
 if(!fromSession||!toSession)return;
 await sendEvent(type,{fromSession,toSession,data});
 }
 function bindChannel(dc:RTCDataChannel){
 channel.current=dc;
 dc.onopen=()=>{if(connectionPing.current)clearInterval(connectionPing.current);connectionPing.current=setInterval(()=>{if(dc.readyState==='open')dc.send(JSON.stringify({type:'ping',stamp:performance.now()}))},5000)};
 dc.onmessage=e=>{if(typeof e.data!=='string'||e.data.length>2000)return;try{const packet=JSON.parse(e.data);if(packet.type==='reaction')receiveReaction(packet);else if(packet.type==='ping'&&Number.isFinite(packet.stamp)&&dc.readyState==='open')dc.send(JSON.stringify({type:'pong',stamp:packet.stamp}));else if(packet.type==='pong'&&Number.isFinite(packet.stamp)){const rtt=performance.now()-packet.stamp;if(rtt>=0&&rtt<30000)setRoundTrip(Math.round(rtt))}}catch{}};
 dc.onclose=()=>{if(channel.current===dc){channel.current=null;setRoundTrip(null);if(connectionPing.current)clearInterval(connectionPing.current);connectionPing.current=null}};
 }
 function armVoiceTimeout(p:RTCPeerConnection){
 if(rtcStarted.current)return;rtcStarted.current=true;setVoice('connecting');setVoiceDetail('Connecting your microphones…');
 if(voiceTimeout.current)clearTimeout(voiceTimeout.current);
 voiceTimeout.current=setTimeout(()=>{if(pc.current===p&&p.connectionState!=='connected'&&p.connectionState!=='closed'){setVoice('failed');setVoiceDetail('The call could not connect. Try voice again on both devices.');reportVoice('rtc_failed')}},45000);
 }
 function buildPeer(servers:RTCIceServer[]){
 talk(false);remoteVoiceStream.current=null;const previous=pc.current;pc.current=null;previous?.close();ice.current=[];rtcStarted.current=false;
 if(voiceTimeout.current)clearTimeout(voiceTimeout.current);voiceTimeout.current=null;
 const p=new RTCPeerConnection({iceServers:servers});pc.current=p;
 for(const track of stream.current?.getTracks()||[])p.addTrack(track,stream.current!);
 if(roomRef.current?.role==='owner')bindChannel(p.createDataChannel('two-seats-reactions',{ordered:false,maxRetransmits:1}));
 else p.ondatachannel=e=>bindChannel(e.channel);
 p.onicecandidate=e=>{if(pc.current===p&&e.candidate)sendVoice('ice',e.candidate.toJSON()).catch(()=>{})};
 p.ontrack=e=>{if(pc.current===p&&audio.current){remoteVoiceStream.current=e.streams[0]||new MediaStream([e.track]);audio.current.srcObject=remoteVoiceStream.current;audio.current.play().catch(()=>{setAudioBlocked(true);reportVoice('audio_blocked')})}};
 p.onconnectionstatechange=()=>{if(pc.current!==p)return;if(p.connectionState==='connected'){if(voiceTimeout.current)clearTimeout(voiceTimeout.current);setVoice('connected');setVoiceDetail('Connected. Tap the mic to turn it on; tap again to mute.');reportVoice('rtc_connected')}if(p.connectionState!=='connected')talk(false);movieAudio.current?.monitor(p.connectionState==='connected');if(p.connectionState==='failed'){setVoice('failed');setVoiceDetail('The call connection failed. Tap Retry voice on both devices.');reportVoice('rtc_failed')}if(p.connectionState==='disconnected')setVoiceDetail('Voice connection interrupted. Waiting for recovery…')};
 return p;
 }
 async function handleEvent(e:any){if(e.mine)return;
 if(e.type==='reaction')addReaction(e.payload,false);
 if(e.type==='buffer'&&e.payload!==false)toast('Your partner paused while their movie catches up. Press play when both are ready.');
 if(!['offer','answer','ice','hangup'].includes(e.type))return;
 const payload=e.payload;
 if(!ownVoiceSession.current||!payload||payload.toSession!==ownVoiceSession.current)return;
 const peer=roomRef.current?.participants.find(p=>p.role!==roomRef.current?.role);
 if(e.type==='hangup'){if(payload.fromSession===peerVoiceSession.current){stopVoice();toast('Your partner disconnected voice. Both can enable it again.')}return}
 if(payload.fromSession!==peer?.voiceSession||payload.fromSession!==peerVoiceSession.current||!pc.current)return;
 const p=pc.current;
 if(e.type==='offer'){
 if(roomRef.current?.role!=='guest')return;armVoiceTimeout(p);
 await p.setRemoteDescription(payload.data);for(const c of ice.current)await p.addIceCandidate(c);ice.current=[];
 const answer=await p.createAnswer();if(pc.current!==p)return;await p.setLocalDescription(answer);if(pc.current!==p)return;await sendVoice('answer',{type:answer.type,sdp:answer.sdp});
 }
 if(e.type==='answer'&&p.signalingState==='have-local-offer'){await p.setRemoteDescription(payload.data);for(const c of ice.current)await p.addIceCandidate(c);ice.current=[]}
 if(e.type==='ice'){if(p.remoteDescription)await p.addIceCandidate(payload.data);else ice.current.push(payload.data)}
 }
 async function accept(b:Room){
 if(!b?.participants)return;if(roomRef.current?.id===b.id&&b.stateVersion<roomRef.current.stateVersion){ingestEvents(b.events,b.serverNow);return}
 if(roomRef.current?.id!==b.id)syncMemory.current={revision:-1,lastSeek:0,largeDrift:0};
 roomRef.current=b;setRoom(b);
 const peer=b.participants.find(p=>p.role!==b.role);
 if(pc.current&&ownVoiceSession.current&&peer?.voice&&peer.voiceSession){
 if(peerVoiceSession.current&&peerVoiceSession.current!==peer.voiceSession){const servers=pc.current.getConfiguration().iceServers||[];buildPeer(servers);setVoice('connecting')}
 peerVoiceSession.current=peer.voiceSession;
 }
 ingestEvents(b.events,b.serverNow);
 sync(b);
 if(b.role==='owner'&&b.participants.every(p=>p.voice&&p.voiceSession)&&pc.current&&ownVoiceSession.current&&!pc.current.localDescription&&!offerBusy.current){
 offerBusy.current=true;try{const p=pc.current,session=ownVoiceSession.current;armVoiceTimeout(p);const offer=await p.createOffer();if(pc.current!==p||ownVoiceSession.current!==session)return;await p.setLocalDescription(offer);if(pc.current!==p||ownVoiceSession.current!==session)return;await sendVoice('offer',{type:offer.type,sdp:offer.sdp})}catch{setVoice('failed');setVoiceDetail('Could not start voice. Retry on both devices.')}finally{offerBusy.current=false}
 }
 }
 function sync(b:Room){
 if(!verifiedSession.current){video.current?.pause();return}
 const v=video.current;if(!v||!urlRef.current||!Number.isFinite(v.duration)||mediaBusy.current)return;
 if(controlsBusy.current||pauseFailed.current){if(localPlaybackGoal.current===false)v.pause();return}
 // Stop advancing frames before any shared-position correction starts a seek.
 if(!b.playing&&!v.paused)v.pause();
 if(v.seeking||scrubbing.current)return;
 const plan=playbackPlan(b,{time:v.currentTime,duration:v.duration,seeking:v.seeking,paused:v.paused},syncMemory.current,Date.now(),Date.now()+offset.current);
 syncMemory.current=plan.next;
 if(plan.seek)v.currentTime=plan.target;
 v.playbackRate=plan.rate;
 if(b.playing&&v.paused)v.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true));
 }
 function reportBuffering(){
 if(waitingTimer.current)clearTimeout(waitingTimer.current);
 waitingTimer.current=setTimeout(()=>{const v=video.current,r=roomRef.current;if(!v||!r?.playing||v.seeking||scrubbing.current||controlsBusy.current||Date.now()-syncMemory.current.lastSeek<2500||v.readyState>=3||Date.now()-lastBuffer.current<8000)return;
 lastBuffer.current=Date.now();sendEvent('buffer',{position:Math.round(v.currentTime*1000)}).catch(()=>{});
 },1800);
 }
 function commitScrub(){if(!scrubbing.current)return;scrubbing.current=false;control(localPlaybackGoal.current??!!roomRef.current?.playing,time*1000,'seek')}
 useEffect(()=>{mounted.current=true;
 const captureInvite=()=>{
   let pending=parseRoomInvite(location.href,location.origin);
   if(!pending)try{pending=parseRoomInvite(sessionStorage.getItem('two-seats-pending-invite')||'',location.origin)}catch{}
   if(pending){setInvited(true);setJoinInput(pending.url);setRoomId(pending.id);try{sessionStorage.setItem('two-seats-pending-invite',pending.url)}catch{}return true}
   return false;
 };
 if(!captureInvite()){try{const memberRoom=new URLSearchParams(location.search).get('room');const saved=memberRoom&&/^[a-f0-9]{32}$/.test(memberRoom)?{id:memberRoom}:JSON.parse(sessionStorage.getItem('two-seats-room')||'null');if(saved){setRoomId(saved.id);setInvite(saved.invite||'');api(undefined,saved.id).then(accept).catch(e=>setError(e.message))}}catch{}}
 const hashChanged=()=>{if(parseRoomInvite(location.href,location.origin)){lastAutoInvite.current='';captureInvite()}};
 window.addEventListener('hashchange',hashChanged);
 const release=()=>talk(false);const visibility=()=>{if(document.hidden){release();const r=roomRef.current;if(r?.playing)api({action:'control',playing:false,position:(video.current?.currentTime||0)*1000,revision:r.revision}).catch(()=>{})}};document.addEventListener('visibilitychange',visibility);
 return()=>{mounted.current=false;if(recoveryTimer.current)clearTimeout(recoveryTimer.current);movieAbort.current?.abort();compatibleMovie.current?.destroy();if(waitingTimer.current)clearTimeout(waitingTimer.current);window.removeEventListener('hashchange',hashChanged);release();stream.current?.getTracks().forEach(t=>t.stop());pc.current?.close();if(voiceTimeout.current)clearTimeout(voiceTimeout.current);if(connectionPing.current)clearInterval(connectionPing.current);if(urlRef.current)URL.revokeObjectURL(urlRef.current);movieAudio.current?.destroy();movieAudio.current=null;document.removeEventListener('visibilitychange',visibility)};
 },[]);
 useEffect(()=>{
 if(!canUseRooms||room||busy||joiningInvite.current)return;
 const pending=parseRoomInvite(joinInput,location.origin);
 if(!pending||lastAutoInvite.current===pending.url)return;
 lastAutoInvite.current=pending.url;
 try{sessionStorage.setItem('two-seats-pending-invite',pending.url)}catch{}
 join(pending.url);
 },[canUseRooms,joinInput,!!room,busy]);
 useEffect(()=>{if(!roomId||!room||authStatus!=='verified')return;let active=true;const timer=setInterval(async()=>{if(pollLock.current)return;pollLock.current=true;try{const b=await api(undefined,roomId);if(active){await accept(b);setError('')}}catch(e:any){if(active){setError(e.message);if(e.status===404){video.current?.pause();stopVoice(false);roomRef.current=null;setRoom(null);setRoomId('');try{sessionStorage.removeItem('two-seats-room')}catch{}}}}finally{pollLock.current=false}},850);return()=>{active=false;clearInterval(timer)}},[roomId,!!room,authStatus]);
 useEffect(()=>{
 if(!roomId||!room||authStatus!=='verified'||typeof EventSource==='undefined')return;
 let active=true;const source=new EventSource(`/api/live?id=${encodeURIComponent(roomId)}&after=${cursor.current}`);
 source.onopen=()=>{if(active)setLiveUpdates(true)};
 source.onmessage=e=>{if(!verifiedSession.current)return;try{const data=JSON.parse(e.data);if(active&&data.id===roomId)accept(data)}catch{}};
 source.onerror=()=>{if(active)setLiveUpdates(false)};
 source.addEventListener('room-closed',()=>{source.close();setLiveUpdates(false);setError('This room has closed.');video.current?.pause();stopVoice(false)});
 return()=>{active=false;source.close();setLiveUpdates(false)};
 },[roomId,!!room,authStatus]);
 useEffect(()=>{const f=()=>{if(!document.fullscreenElement)setExpanded(false)};document.addEventListener('fullscreenchange',f);return()=>document.removeEventListener('fullscreenchange',f)},[]);
 async function create(){if(!canUseRooms){setError('Verify your sign-in before creating a room.');return}setBusy(true);setError('');try{const b=await api({action:'create'});const link=`${location.origin}/#room=${b.id}&key=${b.token}`;setInvite(link);setRoomId(b.id);cursor.current=0;try{sessionStorage.setItem('two-seats-room',JSON.stringify({id:b.id,invite:link}))}catch{}await accept(await api(undefined,b.id));setInvited(false);setJoinInput('');history.replaceState(null,'','/');try{sessionStorage.removeItem('two-seats-pending-invite')}catch{}toast('Room created. Copy your invite to share it privately.')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function join(value?:string){
 if(!canUseRooms){setError('Verify your sign-in before joining a room.');return}
 if(joiningInvite.current)return;
 const pending=parseRoomInvite(value||joinInput,location.origin);
 if(!pending){setError('Paste the complete private room invite, including #room and key.');return}
 joiningInvite.current=true;setBusy(true);setError('');
 try{
   cursor.current=0;
   const joined=await api({action:'join',token:pending.token},pending.id);
   if(joined.id!==pending.id||!joined.participants)throw new Error('Room join could not be confirmed. Please retry.');
   await accept(joined);setRoomId(pending.id);setInvited(false);
   if(joined.role==='owner')setInvite(pending.url);
   history.replaceState(null,'','/');
   try{sessionStorage.setItem('two-seats-room',JSON.stringify({id:pending.id,...(joined.role==='owner'?{invite:pending.url}:{})}));sessionStorage.removeItem('two-seats-pending-invite')}catch{}
   toast('Joined the room. Now choose your copy of the movie.');
 }catch(e:any){setError(e.message)}finally{joiningInvite.current=false;setBusy(false)}
 }
 function showRoomSetup(){roomPanel.current?.scrollIntoView({behavior:'smooth',block:'center'});toast('Join your partner’s room first. Paste the complete room invite below.');setTimeout(()=>document.getElementById('invite')?.focus(),300)}
 function releaseMovie(){setSubtitleFileError('');setSubtitleStatus('');externalSubtitles.current=null;subtitleSelection.current=-1;subtitleDelay.current=0;setSubtitleOffset(0);setSubtitleChoices([]);setSubtitleChoice(-1);movieAbort.current?.abort();movieAbort.current=null;compatibleMovie.current?.destroy();compatibleMovie.current=null;if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current='';}
 async function loadMovieSource(file:File,compatibility:boolean,version:number){
 const v=video.current!;releaseMovie();const abort=new AbortController();movieAbort.current=abort;v.pause();
 if(compatibility){
 setMovieAudioStatus('Preparing compatible movie audio on this device…');
 const result=await openCompatibleMovie(v,file,abort.signal,message=>{setMovieAudioStatus(message);setError(message);if(roomRef.current?.playing)control(false)});
 if(version!==fileVersion.current||abort.signal.aborted){result.destroy();throw new DOMException('Movie changed.','AbortError')}
 compatibleMovie.current=result;urlRef.current=result.url;setSubtitleChoices(result.subtitles);setSubtitleChoice(result.subtitles[0]?.streamIndex??-1);subtitleSelection.current=result.subtitles[0]?.streamIndex??-1;setAudioTracks(result.tracks);setSelectedTrack(result.tracks[0]?.streamIndex??-1);
 setMovieAudioStatus(result.hasAudio?'Compatibility audio enabled · processed only on this device':'This file has no usable audio track. Choose a copy with sound.');
 return result.duration;
 }
 setAudioTracks([]);setSelectedTrack(-1);setMovieAudioStatus('Browser audio · use Repair movie sound if silent');
 const url=URL.createObjectURL(file);urlRef.current=url;
 await new Promise<void>((resolve,reject)=>{
 const clean=()=>{clearTimeout(timeout);v.removeEventListener('loadedmetadata',ok);v.removeEventListener('error',bad);abort.signal.removeEventListener('abort',stopped)};
 const ok=()=>{clean();resolve()},bad=()=>{clean();reject(new Error('Your browser cannot open this file. Try compatibility mode.'))},stopped=()=>{clean();reject(new DOMException('Movie changed.','AbortError'))};
 const timeout=setTimeout(()=>{clean();reject(new Error('The browser could not open this movie. Try compatibility mode.'))},20000);
 v.addEventListener('loadedmetadata',ok);v.addEventListener('error',bad);abort.signal.addEventListener('abort',stopped,{once:true});v.disableRemotePlayback=false;v.src=url;v.load();
 });return v.duration;
 }
 async function chooseFile(file?:File,forceCompatibility=false){
 if(!file||!roomRef.current)return;const v=video.current;if(!v)return;
 localPlaybackGoal.current=null;pauseFailed.current=false;setOptimisticPlaying(null);const version=++fileVersion.current;mediaBusy.current=true;setLoadingFile(true);setError('');setFileName('');setDuration(0);selectedMovie.current=file;
 try{
 let movieDuration:number;
 try{movieDuration=await loadMovieSource(file,true,version)}catch(e){if((e as Error).name==='AbortError'||forceCompatibility||isMatroska(file))throw e;movieDuration=await loadMovieSource(file,false,version)}
 if(!Number.isFinite(movieDuration)||movieDuration<=0||movieDuration>86400)throw new Error('Choose a playable movie shorter than 24 hours.');
 const slices=await Promise.all([file.slice(0,65536).arrayBuffer(),file.slice(Math.floor(file.size/2),Math.floor(file.size/2)+65536).arrayBuffer(),file.slice(Math.max(0,file.size-65536)).arrayBuffer()]);const bytes=new Uint8Array(slices.reduce((n,b)=>n+b.byteLength,0));let at=0;for(const part of slices){bytes.set(new Uint8Array(part),at);at+=part.byteLength}const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');if(version!==fileVersion.current)return;
 const media=`${file.size}:${digest}:${Math.round(movieDuration*1000)}`;await accept(await api({action:'media',media}));if(version!==fileVersion.current)return;setFileName(file.name);setDuration(movieDuration);setTime(0);toast('Movie loaded on this device. Tap Ready when you are.');
 }catch(e:any){if(version!==fileVersion.current||e.name==='AbortError')return;setError(e.message);setMovieAudioStatus(e.message);releaseMovie();v.removeAttribute('src');v.load()}finally{if(version===fileVersion.current){mediaBusy.current=false;setLoadingFile(false);if(input.current)input.current.value=''}}
 }
 async function repairMovieSound(){
 const file=selectedMovie.current,v=video.current;if(!file||!v||repairingAudio)return;
 if(!fileName){await chooseFile(file,true);return}
 mediaBusy.current=true;setRepairingAudio(true);setError('');const version=fileVersion.current;const position=v.currentTime;
 try{
 if(roomRef.current?.playing)await control(false);
 await loadMovieSource(file,true,version);if(version!==fileVersion.current)return;
 v.currentTime=position;v.muted=muted;toast('Movie audio compatibility enabled. Press Play when both are ready.');
 }catch(e:any){if(e.name!=='AbortError'){setMovieAudioStatus(e.message);setError(e.message)}}finally{mediaBusy.current=false;setRepairingAudio(false)}
 }
 async function changeMovieTrack(index:number){
 if(!compatibleMovie.current||repairingAudio)return;mediaBusy.current=true;setRepairingAudio(true);
 try{if(roomRef.current?.playing)await control(false);await compatibleMovie.current.selectTrack(index);setSelectedTrack(index);setMovieAudioStatus('Audio track changed. Press Play when both are ready.')}catch(e:any){setMovieAudioStatus(e.message)}finally{mediaBusy.current=false;setRepairingAudio(false)}
 }
 function chooseSubtitle(index:number){subtitleSelection.current=index;setSubtitleChoice(index);compatibleMovie.current?.selectSubtitles(index);}
 function readSubtitleBitmap(time:number){return subtitleSelection.current===-2?null:compatibleMovie.current?.subtitleBitmap(time-subtitleDelay.current)||null;}
 function readSubtitle(time:number){const target=time-subtitleDelay.current;return subtitleSelection.current===-2?activeSubtitle(externalSubtitles.current||[],target):compatibleMovie.current?.subtitleText(target)||'';}
 async function loadSubtitle(file?:File){
 if(!file)return;setSubtitleFileError('');const version=fileVersion.current;
 try{
 if(file.size>5_000_000)throw new Error('Choose a subtitle file smaller than 5 MB.');
 const extension=file.name.split('.').pop()?.toLowerCase()||'';if(!['srt','vtt','ass','ssa'].includes(extension))throw new Error('Choose an SRT, VTT, ASS or SSA subtitle file.');
 const bytes=new Uint8Array(await file.arrayBuffer());let encoding='utf-8';if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';else if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
 const cues=parseSubtitleFile(new TextDecoder(encoding).decode(bytes),extension);if(version!==fileVersion.current)return;
 externalSubtitles.current=cues;setSubtitleChoices(old=>[...old.filter(track=>track.streamIndex!==-2),{streamIndex:-2,title:file.name,language:''}]);chooseSubtitle(-2);toast('Subtitle file loaded on this device.');
 }catch(e:any){setSubtitleFileError(e.message)}finally{if(subtitleInput.current)subtitleInput.current.value=''}
 }
 useEffect(()=>{if(!fileName)return;const update=()=>{
 const selected=subtitleSelection.current,count=selected===-2?externalSubtitles.current?.length||0:compatibleMovie.current?.subtitleCueCount()||0,info=compatibleMovie.current?.subtitleDiagnostics(),codec=info?.codec||'Embedded subtitle';
 if(selected===-1){setSubtitleStatus(subtitleChoices.length?'Subtitles are off.':'No embedded tracks detected. Add a text subtitle file.');return}
 if(selected===-2){setSubtitleStatus(`${count} subtitle lines loaded from your file.`);return}
 if(/VOBSUB|DVB|BITMAP/i.test(codec)){setSubtitleStatus(`${codec}: picture subtitles detected. VLC can decode these; this site currently needs a separate SRT/VTT/ASS text subtitle file for this track.`);return}
 if(!count&&info?.readerError){setSubtitleStatus(`${codec} · ${info.readerError} Add a text subtitle file for this track.`);return}
 setSubtitleStatus(`${codec} · ${count} ${codec==='S_HDMV/PGS'?'picture subtitles':'subtitle lines'} loaded${count?' · displayed inside the player':info?.received?` · ${info.received} packets received, ${info.rejected} unreadable`:' · reading subtitles directly from the movie'}`);
 };update();const timer=setInterval(update,1000);return()=>clearInterval(timer)},[fileName,subtitleChoice,subtitleChoices.length]);

 async function ready(){try{const v=video.current;if(!v)return;if(movieAudio.current)resumeMovieAudio();v.muted=true;try{await v.play();v.pause()}finally{v.muted=muted}await accept(await api({action:'ready'}));toast('You’re ready. Stay on this screen for movie night.')}catch(e:any){if(video.current)video.current.muted=muted;setError(e.message||'Tap the player to allow playback.')}}
 async function control(playing:boolean,position?:number,command?:string){
 const r=roomRef.current;if(!r||!canUseRooms||!verifiedSession.current)return;
 if(playing&&mediaBusy.current){toast('Wait for the movie audio to finish preparing.');return}
 if(!r.match||!r.participants.every(p=>p.ready)){if(!playing)video.current?.pause();toast('Both of you need to select the same movie and tap Ready.');return}
 // This runs before the busy guard or any await, including for a queued pause.
 const intent=capturePlaybackIntent(video.current,playing,position,command);
 localPlaybackGoal.current=playing;pauseFailed.current=false;setOptimisticPlaying(playing);
 if(controlsBusy.current){pendingControl.current=intent;return}
 controlsBusy.current=true;let succeeded=false;
 try{
 if(playing&&video.current){if(movieAudio.current)resumeMovieAudio();try{await video.current.play();setBlocked(false)}catch{setBlocked(true)}}
 await commitPlaybackIntent<Room>(intent,r.revision,{
 send:(next,revision)=>api({action:'control',...next,revision}),
 refresh:()=>api(),accept,
 });succeeded=true;
 }catch(e:any){setError(e.message)}finally{
 controlsBusy.current=false;
 if(!verifiedSession.current){pendingControl.current=null;video.current?.pause();return}
 const pending=pendingControl.current;pendingControl.current=null;
 if(pending){control(pending.playing,pending.position,pending.command);return}
 if(!succeeded&&localPlaybackGoal.current===false){pauseFailed.current=true;video.current?.pause();setError('Could not share the pause. Your screen stays paused. Tap Play to reconnect.');return}
 localPlaybackGoal.current=null;setOptimisticPlaying(null);if(roomRef.current)sync(roomRef.current);
 }
 }
 async function fullscreen(){if(expanded){if(document.fullscreenElement)await document.exitFullscreen();setExpanded(false);return}setExpanded(true);if(stage.current?.requestFullscreen)try{await stage.current.requestFullscreen()}catch{} }
 async function enableVoice(){
 if(!canUseRooms||!verifiedSession.current||!roomRef.current){toast('Join a room before enabling voice.');return}
 if(voiceEnabling.current)return;
 if(voice==='waiting'||voice==='connecting'||voice==='connected'){stopVoice();setMicIssue(null);return}
 voiceEnabling.current=true;setMicIssue(null);setError('');
 const context={embedded:window.top!==window.self,secure:window.isSecureContext,policy:((document as any).permissionsPolicy||(document as any).featurePolicy)?.allowsFeature?.('microphone')!==false,platform:navigator.userAgent};
 if(!context.secure||!context.policy||!navigator.mediaDevices?.getUserMedia){
 const issue=microphoneIssue('Unsupported',context);setMicIssue(issue);setVoice('mic-blocked');setVoiceDetail(issue.title);voiceEnabling.current=false;reportVoice(issue.code);return;
 }
 stopVoice();setVoice('requesting');setVoiceDetail('Allow microphone access when your browser asks.');
 // Request permission synchronously from this tap, before any network request.
 let captured:MediaStream|null=null,stage='microphone';
 try{
 resumeMovieAudio();
 const capture=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
 captured=await capture;
 if(!mounted.current){captured.getTracks().forEach(t=>t.stop());return}
 captured.getAudioTracks().forEach(t=>{t.enabled=false;t.onended=()=>{if(stream.current===captured){stopVoice();const issue=microphoneIssue('Stopped',context);setMicIssue(issue);setVoice('mic-blocked');setVoiceDetail(issue.title);reportVoice(issue.code)}}});
 stream.current=captured;reportVoice('mic_allowed');stage='relay';setVoiceDetail('Microphone allowed. Preparing the call…');
 let config=relayConfigCache.current;
 if(!config||config.expiresAt<Date.now()+60000){config=await api({action:'voice-config'});relayConfigCache.current={...config,expiresAt:config.expiresAt||Date.now()+3600000}}
 if(!mounted.current){stopVoice(false);return}
 relayConfigured.current=!!config.relayConfigured;setHasRelay(!!config.relayConfigured);reportVoice('relay_ready');stage='handshake';
 ownVoiceSession.current=crypto.randomUUID().replaceAll('-','');peerVoiceSession.current='';buildPeer(config.iceServers);
 setVoice('waiting');setVoiceDetail('Your microphone is ready. Waiting for your partner to enable theirs.');reportVoice('waiting_peer');
 await accept(await api({action:'voice',enabled:true,session:ownVoiceSession.current}));
 }catch(e:any){
 captured?.getTracks().forEach(t=>t.stop());stopVoice();
 if(stage==='microphone'){const issue=microphoneIssue(e.name||'Unknown',context);setMicIssue(issue);setVoice('mic-blocked');setVoiceDetail(issue.title);reportVoice(issue.code)}
 else{setVoice('failed');setVoiceDetail(e.message||'Could not prepare the voice connection.');reportVoice(stage==='relay'?'relay_failed':'rtc_failed')}
 }finally{voiceEnabling.current=false}
 }
 function talk(on:boolean){const enabled=microphoneEnabled(stream.current,on,pc.current?.connectionState==='connected');micOn.current=enabled;setTalking(enabled);if(enabled)resumeMovieAudio()}
 function toggleTalk(){talk(!micOn.current)}
 async function closeRoom(){if(!confirm('Close this room for both of you?'))return;try{await api({action:'close'});localPlaybackGoal.current=null;pauseFailed.current=false;setOptimisticPlaying(null);stopVoice(false);roomRef.current=null;setRoom(null);setRoomId('');setInvite('');setFileName('');fileVersion.current++;mediaBusy.current=false;selectedMovie.current=null;releaseMovie();setMovieAudioStatus('');setAudioTracks([]);video.current?.pause();video.current?.removeAttribute('src');try{sessionStorage.removeItem('two-seats-room')}catch{}}catch(e:any){setError(e.message)}}
 const playerPlaying=canUseRooms&&(optimisticPlaying??room?.playing??false);
 const signInHref='/signin-with-chatgpt?return_to='+encodeURIComponent(roomId?'/?room='+roomId:'/');
 const me=room?.participants.find(p=>p.role===room.role),partner=room?.participants.find(p=>p.role!==room.role),bothReady=canUseRooms&&room?.match&&room.participants.every(p=>p.ready),stageLabel=loadingFile?'Opening your movie…':fileName?'Your movie is ready':'A scene is better shared.';
 return <main>
 <header className="topbar"><a className="brand" href="/" aria-label="Two Seats home"><span className="brand-icon"><Armchair size={23}/><Armchair size={23}/></span>two seats<span className="brand-dot">.</span></a><span className="top-note">a little closer, wherever you are</span><div className="account-area"><button className={`account-trigger ${authStatus==='verified'?'verified':''}`} onClick={()=>setAccountOpen(!accountOpen)} aria-expanded={accountOpen} aria-label="Account and login status">{authStatus==='checking'?<LoaderCircle className="spin" size={15}/>:authStatus==='verified'?<ShieldCheck size={15}/>:<Lock size={15}/>}<span>{authStatus==='checking'?'Checking sign-in…':authStatus==='reconnecting'?'Reconnecting…':authStatus==='verified'?session?.user.displayName:authStatus==='signedout'?'Sign in required':'Check login'}</span><ChevronDown size={13}/></button>{accountOpen&&<div className="account-menu"><span className="account-label">{authStatus==='verified'?'SIGNED IN WITH CHATGPT':'ACCOUNT STATUS'}</span>{session&&authStatus==='verified'?<><strong>{session.user.displayName}</strong><span className="account-email">{session.user.email}</span><p><Check size={13}/>Session verified by the server</p><a href="/signout-with-chatgpt?return_to=%2F" target="_top" onClick={()=>{video.current?.pause();stopVoice()}}>Sign out</a></>:<><p>{authStatus==='checking'?'Confirming your account…':authStatus==='signedout'?'Your login could not be verified. Sign in to use rooms.':'We couldn’t check your session. Please retry.'}</p><button onClick={checkSession}>Check again</button><a href={signInHref} target="_top">Continue with ChatGPT</a></>}</div>}</div><button className="quiet help-button" onClick={()=>setHelp(true)}><Headphones size={15}/>How it works</button></header>
 <section className="heading"><div><div className="eyebrow"><span/> A NIGHT, JUST FOR TWO</div><h1>Different places.<br/><em>Same scene.</em></h1></div><p>A favourite movie. Your favourite person.<br/>Make a little room for being together.</p></section>
 {authStatus==='reconnecting'&&<div className="session-banner" role="status"><LoaderCircle className="spin" size={16}/><span>Rechecking your sign-in for a few seconds. Your room and movie selection are kept; playback is paused.</span></div>}{authStatus==='signedout'&&<div className="session-banner" role="alert"><Lock size={16}/><span>Your sign-in needs to be renewed. Sign in with your own account to reconnect to your room.</span><a href={signInHref} target="_top">Sign in</a></div>}{authStatus==='error'&&<div className="session-banner" role="alert"><ShieldCheck size={16}/><span>We couldn’t verify your login. Room actions are paused until we can check it.</span><button onClick={checkSession}>Retry check</button></div>}{authStatus==='verified'&&!session?.roomService.available&&<div className="session-banner" role="alert"><Film size={16}/><span>You’re signed in, but the room service is unavailable. Please retry shortly.</span><button onClick={checkSession}>Retry</button></div>}<div className="cinema-grid"><section className="watch-column">
 <div className={`stage ${expanded?'expanded':''}`} ref={stage}>
 <video ref={video} playsInline preload="metadata" muted={muted} onTimeUpdate={()=>{if(!scrubbing.current)setTime(video.current?.currentTime||0)}} onEnded={()=>control(false,duration*1000)} onWaiting={reportBuffering} onPlaying={()=>{if(waitingTimer.current)clearTimeout(waitingTimer.current)}} onError={()=>{if(fileName)setError('Playback failed. Try an MP4 with H.264 video and AAC audio.')}}/>
 {!fileName&&<div className="scene"><svg className="landscape" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="sky" x2="0" y2="1"><stop stopColor="#243c36"/><stop offset="1" stopColor="#b4aa7d"/></linearGradient><linearGradient id="hill" x2="0" y2="1"><stop stopColor="#43614e"/><stop offset="1" stopColor="#172e29"/></linearGradient><radialGradient id="glow"><stop stopColor="#fff2c3" stopOpacity=".5"/><stop offset="1" stopColor="#fff2c3" stopOpacity="0"/></radialGradient></defs><path fill="url(#sky)" d="M0 0h1000v600H0z"/><circle cx="687" cy="196" r="180" fill="url(#glow)"/><circle cx="687" cy="196" r="31" fill="#ede7bd" opacity=".8"/><path d="M0 340Q100 190 230 290T480 290T740 318T1000 250V600H0Z" fill="#6d7961"/><path d="M0 409Q140 275 280 355T570 340T840 350T1000 330V600H0Z" fill="url(#hill)"/><path d="M0 480Q180 370 350 440T650 425T1000 390V600H0Z" fill="#142b25"/><path d="M0 540Q200 450 370 500T700 485T1000 480V600H0Z" fill="#10221e"/></svg><div className="scene-shade"/><span className="scene-corner">THE BEST SEAT IS NEXT TO YOU</span><div className="stage-empty"><div className="film-medallion">{loadingFile?<LoaderCircle className="spin" size={26}/>:<Film size={26}/>}</div><h2>{stageLabel}</h2><p>{room?'Room joined. Choose the same movie on both devices.':busy?'Joining your private room…':'First join your partner’s room, then choose your movie.'}</p><button className="light-btn" disabled={loadingFile||repairingAudio||busy} onClick={()=>room?input.current?.click():showRoomSetup()}><Plus size={17}/>{loadingFile?'Opening movie':busy?'Joining room…':room?'Choose your movie':'Join or create a room first'}</button><small>Stays on your device. Always.</small></div></div>}
 <div className="stage-top"><span className="stage-badge"><span className={bothReady?'dot live':'dot'}/>{!canUseRooms?(authStatus==='reconnecting'||authStatus==='checking'?'RECHECKING CONNECTION':'SIGN IN TO RECONNECT'):bothReady?'Ready together':room?'ROOM JOINED · CHOOSE YOUR MOVIE':'JOIN A ROOM FIRST'}</span>{expanded&&<button className="icon-btn" title="Exit viewing mode" onClick={fullscreen}><Minimize size={19}/></button>}</div>
 {fileName&&!playerPlaying&&<button className="center-play" aria-label={bothReady?'Play together':'Waiting for both people to be ready'} onClick={()=>control(true)}><Play fill="currentColor" size={28}/></button>}
 <SubtitleOverlay video={video} read={readSubtitle} readBitmap={readSubtitleBitmap}/>
 <div className="reaction-floats" aria-live="polite">{floats.map(f=><span className="float" key={f.id} style={{left:`${20+(f.id%60)}%`}}>{f.emoji}<small>{f.mine?'You':'Your person'}</small></span>)}</div>
 {blocked&&<button className="unlock" onClick={()=>{if(movieAudio.current)resumeMovieAudio();if(roomRef.current?.playing)video.current?.play().then(()=>setBlocked(false)).catch(()=>{});audio.current?.play().then(()=>setBlocked(false)).catch(()=>{})}}>Tap to enable playback & sound</button>}
 <div className="player-bottom"><input className="seek" type="range" aria-label="Seek movie for both people" min="0" max={duration||1} value={Math.min(time,duration||1)} step=".1" disabled={!bothReady} onPointerDown={()=>{scrubbing.current=true}} onChange={e=>{scrubbing.current=true;setTime(Number(e.target.value))}} onPointerUp={commitScrub} onKeyUp={commitScrub} onBlur={commitScrub} onPointerCancel={()=>{scrubbing.current=false}}/>
 <div className="player-controls"><button className="icon-btn" aria-label={playerPlaying?'Pause for both':'Play together'} onClick={()=>control(!(localPlaybackGoal.current??roomRef.current?.playing??false))} disabled={!fileName||!canUseRooms}>{playerPlaying?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}</button><button className="icon-btn back-ten" aria-label="Back ten seconds for both" onClick={()=>control(localPlaybackGoal.current??!!roomRef.current?.playing,Math.max(0,time-10)*1000,'seek')} disabled={!bothReady}><SkipBack size={17}/></button><span className="time">{clock(time)} <span>/ {clock(duration)}</span></span><div className="control-spacer"/><button className={`talk-mini ${talking?'talking':''}`} disabled={voice!=='connected'} onClick={toggleTalk} aria-pressed={talking} aria-label={talking?'Mute microphone':'Unmute microphone'}>{talking?<Mic size={17}/>:<MicOff size={17}/>}<span>{talking?'Mic on':'Mic off'}</span></button><div className="reaction-wrap"><button className="icon-btn" title="Show or hide reactions" aria-label="Show or hide reactions" aria-expanded={reactionMenu} disabled={!room||!canUseRooms} onClick={()=>setReactionMenu(open=>!open)}><Smile size={20}/></button>{reactionMenu&&<div className="reaction-pop">{reactions.map(e=><button key={e} onClick={()=>reactTogether(e)}>{e}</button>)}</div>}</div>{fileName&&<button className="icon-btn" aria-label={!subtitleChoices.length?'Add subtitles':subtitleChoice===-1?'Show subtitles':'Hide subtitles'} aria-pressed={subtitleChoice!==-1} onClick={()=>{if(!subtitleChoices.length){subtitleInput.current?.click();return}chooseSubtitle(subtitleChoice===-1?subtitleChoices[0].streamIndex:-1)}}><Captions size={19}/></button>}<button className="icon-btn" title={muted?'Unmute movie':'Mute movie'} onClick={()=>setMuted(!muted)}>{muted?<VolumeX size={19}/>:<Volume2 size={19}/>}</button><button className="icon-btn" aria-label={expanded?'Exit viewing mode':'Expand viewing mode'} onClick={fullscreen}>{expanded?<Minimize size={19}/>:<Expand size={19}/>}</button></div></div>
 </div>
 <input ref={subtitleInput} className="hidden-input" type="file" accept=".srt,.vtt,.ass,.ssa" aria-label="Choose subtitle file" onChange={e=>loadSubtitle(e.target.files?.[0])}/>
 <input ref={input} className="hidden-input" type="file" accept="video/*,.mkv,.mp4,.mov,.webm" onChange={e=>chooseFile(e.target.files?.[0])}/>
 <div className="under-player"><div><span className="little-icon"><Film size={18}/></span><div><strong>{fileName||'Tonight’s feature'}</strong><small>{fileName?'Loaded from your device · never uploaded':'Bring a movie. We’ll bring you together.'}</small></div></div><button className="text-btn" disabled={loadingFile||repairingAudio||busy} onClick={()=>room?input.current?.click():showRoomSetup()}>{fileName?'Change movie':room?'Choose file':'Join room first'}<ArrowUpRight size={15}/></button></div>
 {selectedMovie.current&&<div className="movie-audio-panel"><div><Volume2 size={17}/><strong>Movie sound & subtitles</strong></div><p role="status">{movieAudioStatus}</p>{subtitleChoices.length>0&&<label>Subtitles<select aria-label="Movie subtitles" value={subtitleChoice} onChange={e=>chooseSubtitle(Number(e.target.value))}><option value={-1}>Off</option>{subtitleChoices.map(track=><option value={track.streamIndex} key={track.streamIndex}>{track.title}{track.language?` · ${track.language}`:''}</option>)}</select></label>}<p className="subtitle-status" role="status">{subtitleStatus}</p>{subtitleFileError&&<p role="alert">{subtitleFileError}</p>}<button className="text-btn" disabled={!fileName||loadingFile||repairingAudio} onClick={()=>subtitleInput.current?.click()}>Add subtitle file · SRT / VTT / ASS</button>{subtitleChoices.length>0&&<label>Subtitle timing (seconds)<input aria-label="Subtitle timing offset in seconds" type="number" min={-60} max={60} step={0.5} value={subtitleOffset} onChange={e=>{const value=Number(e.target.value);if(Number.isFinite(value)&&Math.abs(value)<=60){subtitleDelay.current=value;setSubtitleOffset(value)}}}/><small>Positive values show subtitles later.</small></label>}{audioTracks.length>1&&<label>Audio track<select aria-label="Movie audio track" value={selectedTrack} disabled={loadingFile||repairingAudio} onChange={e=>changeMovieTrack(Number(e.target.value))}>{audioTracks.map((track,i)=><option value={track.streamIndex} key={track.streamIndex}>{track.title||`Track ${i+1}`}{track.language?` · ${track.language}`:''}</option>)}</select></label>}<button className="text-btn" disabled={loadingFile||repairingAudio} onClick={repairMovieSound}>{repairingAudio?<><LoaderCircle className="spin" size={14}/>Preparing audio…</>:compatibleMovie.current?'Restart audio compatibility':'Repair sound / load subtitles'}</button><small>Embedded text subtitles display inside this player. Embedded PGS picture subtitles are decoded locally. VobSub needs a separate text subtitle file. Converts supported audio to AAC locally. Some video codecs and protected files still need conversion to H.264/AAC MP4.</small></div>}
 <div className="privacy-note"><ShieldCheck size={16}/><span>Your movie stays yours. Only playback controls and connection data are shared.</span></div>
 </section>
 <aside className="room-panel" ref={roomPanel}><div className="panel-heading"><h2>Your movie night</h2><Lock size={15}/></div><p className="panel-subtitle">{room?(canUseRooms?'Room joined · Next: choose your movie':'Room kept · reconnect to continue'):busy?'Joining your private room…':invited?'Invite received · Joining after sign-in verification':'Signed in? Join or create a room to choose your movie.'}</p>
 {!room?<div className="start-room"><div className="seat-illustration"><Armchair size={42}/><Heart size={16}/><Armchair size={42}/></div><h3>Save them a seat.</h3><p>{invited?'Your room invite is ready. We’ll join it automatically once your sign-in is verified.':'Create a room, or paste your partner’s room invite below. Signing in alone does not join a room.'}</p><button className="primary" onClick={create} disabled={busy||!canUseRooms}>{busy?<LoaderCircle className="spin" size={17}/>:<Plus size={17}/>}Create a room</button><div className="or"><span/>or join your person<span/></div><label className="field-label" htmlFor="invite">PRIVATE INVITE LINK</label><input id="invite" value={joinInput} onChange={e=>setJoinInput(e.target.value)} placeholder="Paste your invite link" autoComplete="off" spellCheck={false}/><button className="secondary" onClick={()=>join()} disabled={busy||!joinInput||!canUseRooms}><LinkIcon size={16}/>{busy?'Joining room…':invited?'Join your private room':'Join room'}</button></div>:<>
 <div className="room-live"><span className="dot live"/> {canUseRooms?'ROOM JOINED':'ROOM KEPT · RECONNECT'} <span>12-hour room</span></div>
 <div className="people">{room.participants.map(p=><div className="person" key={p.role}><span className={`avatar ${p.role==='guest'?'guest':''}`}>{p.role===room.role?'Y':<Heart size={20}/>}<i className={p.online?'online':''}/></span><div><strong>{p.role===room.role?(session?.user.displayName||'You'):'Your person'} {p.role===room.role&&<small>THIS DEVICE</small>}</strong><span>{!p.present?'Waiting for your person…':!p.online?'Away from the room':p.ready?'Ready for movie night':p.loaded?'Movie selected':'Choosing a movie'}</span></div>{p.ready?<CheckCheck size={17} className="sage"/>:<span className="status-ring"/>}</div>)}</div>
 <div className={`match-note ${room.match?'matched':''}`}>{room.match?<Check size={15}/>:<Film size={15}/>}<span>{room.match?'Same movie. Perfect company.':me?.loaded&&partner?.loaded?'These copies don’t match. Choose the same file.':'Choose the same movie on both devices.'}</span></div>
 <button className="primary ready-btn" disabled={!canUseRooms||!fileName||!!me?.ready||loadingFile||repairingAudio} onClick={ready}>{me?.ready?<CheckCheck size={17}/>:<Check size={17}/>} {!canUseRooms?'Reconnect before watching':me?.ready?'You’re ready': 'I’m ready to watch'}</button>
 {invite&&<button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(invite);toast('Private invite copied. Share it only with your person.')}catch{setJoinInput(invite);toast('Copy the invite from the field below.')}}}><Copy size={15}/>Copy private invite</button>}
 {invite&&joinInput===invite&&<input aria-label="Private invite to copy" readOnly value={invite} onFocus={e=>e.target.select()}/>}
 <div className="section-divider"/><div className="voice-heading"><h3>Hear their voice</h3><span className={`voice-dot ${voice==='connected'?'on':''}`}/></div><p className="voice-copy">For the “wait, did you see that?” moments.</p><button className={`secondary voice-btn ${voice==='connected'?'connected':''}`} onClick={enableVoice} disabled={!canUseRooms||voice==='requesting'}>{voice==='off'||voice==='failed'||voice==='mic-blocked'?<Mic size={17}/>:voice==='connected'?<Headphones size={17}/>:<LoaderCircle className="spin" size={17}/>} {voice==='off'?'Enable voice':voice==='mic-blocked'?'Retry microphone':voice==='failed'?'Retry voice':voice==='requesting'?'Waiting for microphone permission…':voice==='waiting'?'Waiting for partner · disconnect':voice==='connected'?'Voice connected · disconnect':'Connecting voice · cancel'}</button>
 <button className={`hold-talk ${talking?'talking':''}`} disabled={voice!=='connected'} onClick={toggleTalk} aria-pressed={talking} aria-label={talking?'Mute microphone':'Unmute microphone'}>{talking?<Mic size={19}/>:<MicOff size={19}/>} {talking?'Mic on · tap to mute':'Mic off · tap to talk'}</button><small className="voice-hint">Use headphones. Tap to unmute, tap again to mute. Movie sound lowers during conversation.</small>{voiceDetail&&<p className={`voice-message ${voice==='failed'?'voice-failed':''}`} role="status">{voiceDetail}</p>}{micIssue&&<div className="mic-help" role="alert"><strong>{micIssue.title}</strong><ol>{micIssue.steps.map(step=><li key={step}>{step}</li>)}</ol><a href={externalUrl} target="_blank" rel="noopener noreferrer">Open Two Seats in a browser ↗</a></div>}{audioBlocked&&<button className="primary" onClick={()=>audio.current?.play().then(()=>setAudioBlocked(false)).catch(()=>setVoiceDetail('Tap again to allow your partner’s audio.'))}>Enable partner’s audio</button>}{hasRelay===false&&<p className="voice-message">Voice is currently direct-only. Some networks need a relay service before voice can work.</p>}
 <div className="section-divider"/><div className="reactions-title"><h3>A little reaction</h3><span>{liveUpdates?'live reactions':'reconnecting live updates'}</span></div><div className="reactions">{reactions.map(e=><button key={e} aria-label={`Send ${e}`} disabled={!canUseRooms} onClick={()=>{reactTogether(e)}}>{e}</button>)}</div><small className="reaction-hint">Instant on your screen. Partner delivery depends on the connection.{roundTrip!==null&&` Connection round trip: ${roundTrip} ms.`}</small>
 {room.role==='owner'&&<button className="close-room" onClick={closeRoom}>Close room for both</button>}
 </>}
 </aside></div>
 <section className="ritual"><div><span>01</span><h3>Bring your movie</h3><p>Both select the same file.<br/>No uploads, no waiting.</p></div><div><span>02</span><h3>Get comfortable</h3><p>Headphones on. Lights down.<br/>Tap ready when you’re settled.</p></div><div><span>03</span><h3>Press play, together</h3><p>Pause, laugh, talk, rewind.<br/>It’s your night.</p></div></section>
 <footer><span className="footer-brand"><Armchair size={15}/> two seats.</span><span>Distance gets the small screen tonight.</span><button onClick={()=>setHelp(true)}><ShieldCheck size={13}/>Privacy & help</button></footer>
 {error&&authStatus!=='reconnecting'&&authStatus!=='signedout'&&<div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={17}/></button></div>}{notice&&<div className="toast" role="status"><Check size={16}/>{notice}</div>}
 <audio ref={audio} autoPlay playsInline/>
 {help&&<div className="modal-shade" onClick={()=>setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-label="Your movie night guide" onClick={e=>e.stopPropagation()}><button className="modal-close icon-btn" aria-label="Close help" onClick={()=>setHelp(false)}><X size={20}/></button><span className="eyebrow">YOUR LITTLE CINEMA</span><h2>A good night, made simple.</h2><ol><li>Create a room and share its invite privately. Both people need access to this signed-in website. Opening a complete room invite automatically joins after sign-in verification. If you arrive at the home screen after login, reopen the original room invite or paste it in the invite field.</li><li>Both select the same movie from Files on your phone or computer. The player loads embedded text subtitles automatically and includes a subtitle selector and CC toggle. If subtitles do not appear, choose another track or add a local SRT, VTT, ASS or SSA file under Movie sound & subtitles. Timing can be adjusted there. PGS picture subtitles are decoded directly from MKV. VobSub still requires a separate text subtitle file. Movies use local compatibility mode where supported. If another movie is silent, use Repair movie sound below the player. You can choose among multiple audio tracks there. MP4 with H.264 video and AAC audio remains the safest choice. A sampled file fingerprint, size and duration check the copies match; this isn’t a full-file verification.</li><li>Tap Ready on both devices. Either person can play, pause or rewind. If playback buffers, both pause; press play when you’re ready again.</li><li>Enable voice on both devices, wear headphones, and tap the mic to unmute. Tap again to mute. Movie sound lowers automatically while either person speaks and returns after a short pause. The mic starts muted and mutes again if the app goes into the background or voice disconnects. Voice is encrypted in transit with WebRTC. A configured relay helps the call connect on restrictive networks. Both people must allow microphone access. If blocked inside an app preview, open this site directly in Safari or Chrome.</li></ol><h3>On iPhone</h3><p>In Safari, choose Share → Add to Home Screen → Open as Web App. Open the icon, rotate your phone sideways and use our expand button to keep the mic and reactions visible. This is an expanded page, not the iOS native video player. Your phone may still show system indicators.</p><h3>Private by design</h3><p>Movies never leave your device. Sign-in and site access protect the website. Invite secrets are hashed on the server, and each room admits two signed-in accounts. Temporary room records expire after 12 hours and are cleaned up when new rooms are created. Only room members can read playback state and connection messages. Keep the app in the foreground; leaving pauses shared playback.</p><p>Invite links grant a room seat only to someone who can already access this site. Room expiry, browser refresh or choosing a different movie may require reselecting your file.</p><button className="primary" onClick={()=>setHelp(false)}>Sounds like a movie night<Heart size={16}/></button></section></div>}
 </main>
}
