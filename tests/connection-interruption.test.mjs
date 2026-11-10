import {readFileSync} from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
async function load(file){const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))}
const {primePlayback,VoiceSignalingInbox,canNegotiateVoice}=await load('app/lib/voice-signaling.ts');
let rejectPlay,posted=false,blocked=false,pauses=0;
const video={muted:false,play:()=>new Promise((_,reject)=>rejectPlay=reject),pause(){pauses++}};
primePlayback(video,()=>true,false,()=>blocked=true);posted=true;assert(posted,'Room readiness proceeds while the browser play promise is unresolved');
rejectPlay(new DOMException('The operation was aborted.','AbortError'));for(let i=0;i<6;i++)await Promise.resolve();
assert(!blocked);assert(!video.muted);assert.equal(pauses,1);
primePlayback({...video,play:()=>Promise.reject(new DOMException('Gesture needed','NotAllowedError'))},()=>true,false,()=>blocked=true);
for(let i=0;i<6;i++)await Promise.resolve();assert(blocked,'A real autoplay restriction still offers the playback-unlock button');
const participants=[{role:'owner',voice:true,voiceSession:'old-owner'},{role:'guest',voice:true,voiceSession:'guest'}];
assert(!canNegotiateVoice(participants,'owner','new-owner'),'An old snapshot cannot start a new peer before its own session is advertised');
participants[0].voiceSession='new-owner';assert(canNegotiateVoice(participants,'owner','new-owner'));
const inbox=new VoiceSignalingInbox(),offer={id:1,type:'offer',created:1000,payload:{fromSession:'new-owner',toSession:'guest'}};
inbox.push(offer);assert.deepEqual(inbox.take('guest','old-owner','guest',1100),[]);
assert.deepEqual(inbox.take('guest','new-owner','old-guest',1200),[]);
assert.deepEqual(inbox.take('guest','new-owner','guest',1300),[offer],'An early offer is delivered once its room snapshot catches up');
assert.deepEqual(inbox.take('guest','new-owner','guest',1400),[]);
inbox.push(offer);assert.deepEqual(inbox.take('other-guest','new-owner','other-guest',1400),[]);
inbox.push(offer);assert.deepEqual(inbox.take('guest','new-owner','guest',62000),[],'Expired offers cannot revive a call');
const {requestJson}=await load('app/lib/api-response.ts');const nativeFetch=globalThis.fetch;
try{
 let calls=0;globalThis.fetch=async()=>{calls++;if(calls===1)throw new DOMException('Fetch is aborted','AbortError');return Response.json({ready:true})};
 assert.deepEqual(await requestJson('/api/room',{method:'POST',body:'ready'},{retry:true}),{ready:true});assert.equal(calls,2);
 calls=0;await assert.rejects(()=>requestJson('/api/room',{method:'POST',body:'control'}),e=>e.code==='connection'&&!/abort/i.test(e.message));assert.equal(calls,1,'Playback commands are never blindly replayed');
 globalThis.fetch=async()=>{throw new DOMException('Operation aborted','AbortError')};await assert.rejects(()=>requestJson('/api/room',{}, {retry:true}),e=>e.status===408&&e.code==='connection');
 calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'Sign in'},{status:401})};await assert.rejects(()=>requestJson('/api/room',{}, {retry:true}),e=>e.code==='auth');assert.equal(calls,1);
 const stop=new AbortController();stop.abort();calls=0;globalThis.fetch=async()=>{calls++;throw new DOMException('Aborted','AbortError')};await assert.rejects(()=>requestJson('/api/room',{signal:stop.signal},{retry:true}),e=>e.code==='canceled');assert.equal(calls,1);
 globalThis.fetch=async(_input,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError')),{once:true}));
 await assert.rejects(()=>requestJson('/api/room',{}, {timeout:1}),e=>e.code==='connection');
}finally{globalThis.fetch=nativeFetch}
console.log('PASS: Ready survives interrupted media priming; stale snapshots cannot negotiate; early signaling is retained; safe retry, auth, explicit cancellation and timeout behavior.');
