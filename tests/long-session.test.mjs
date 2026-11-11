import {readFileSync} from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
async function load(file){const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))}
const {appendWithEviction}=await load('app/lib/media-buffer.ts');
let time=0,start=0,end=0,attempts=0,quota=false;const bytes=new ArrayBuffer(1),order=[];
const ranges=()=>({length:end>start?1:0,start:()=>start,end:()=>end});
const remove=async(a,b)=>{assert(b<time,'Eviction must leave playable frames');start=b;order.push('remove')};
for(time=0;time<10800;time+=5){
 quota=time===2100;attempts=0;order.length=0;
 await appendWithEviction(bytes,()=>time,ranges,async actual=>{assert.equal(actual,bytes);order.push('append');attempts++;if(quota&&attempts===1)throw new DOMException('Full','QuotaExceededError');end=time+15;},remove);
 assert(end-start<=31,'Three-hour playback keeps bounded buffer history');
 if(quota){assert.equal(attempts,2);assert.deepEqual(order.slice(-3),['append','remove','append']);assert.equal(start,2098)}
}
await assert.rejects(()=>appendWithEviction(bytes,()=>100,ranges,async()=>{throw new Error('Decode failure')},remove),/Decode failure/);
let count=0;await assert.rejects(()=>appendWithEviction(bytes,()=>100,ranges,async()=>{count++;throw new DOMException('Full','QuotaExceededError')},async()=>{}));assert.equal(count,2,'Quota retry cannot loop forever');
console.log('PASS: three hours of bounded buffer maintenance, quota at 35 minutes retries identical bytes, persistent quota and decode errors stay bounded.');
const {VoiceRecovery}=await load('app/lib/voice-recovery.ts');
const nativeSet=globalThis.setTimeout,nativeClear=globalThis.clearTimeout;let now=0,id=0;const timers=new Map();
globalThis.setTimeout=(fn,ms)=>{const key=++id;timers.set(key,{fn,at:now+ms});return key};globalThis.clearTimeout=id=>timers.delete(id);
async function advance(ms){const end=now+ms;while(true){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();for(let i=0;i<8;i++)await Promise.resolve();}now=end}
try{
 let attempts=0,failures=0;const recovery=new VoiceRecovery(async()=>{attempts++},()=>failures++);
 recovery.request();await advance(3000);recovery.connected();await advance(6000);assert.equal(attempts,0,'Short interruptions recover without negotiation');
 recovery.request(true);recovery.request(true);await advance(0);assert.equal(attempts,1,'Duplicate ICE and connection events coalesce');recovery.connected();await advance(20000);assert.equal(attempts,1);
 recovery.request(true);await advance(40000);assert.equal(attempts,4);assert.equal(failures,1,'Three attempts then a clear failure');
 recovery.stop();recovery.request(true);await advance(60000);assert.equal(attempts,4,'User hangup cancels all recovery');
 let finish;const slow=new VoiceRecovery(()=>new Promise(resolve=>finish=resolve),()=>assert.fail('Stopped peer failed'));slow.request(true);await advance(0);slow.stop();finish();await Promise.resolve();await advance(60000);assert.equal(timers.size,0,'Late work cannot revive a closed peer');
 const transient=new VoiceRecovery(async()=>{throw new Error('Signaling offline')},()=>failures++);transient.request(true);await advance(40000);assert.equal(failures,2);transient.stop();
 let offline=true,active=0,ended=0;const deferred=new VoiceRecovery(async()=>{if(offline)return 'defer';active++},()=>ended++);deferred.request(true);await advance(120000);assert.equal(active,0);assert.equal(ended,0,'Offline/background waiting must not exhaust active ICE retries');offline=false;await advance(50000);assert.equal(active,3);assert.equal(ended,1);deferred.stop();
 console.log('PASS: voice grace period, deduplicated bounded retries, recovered/closed peer cancellation, and signaling outages.');
}finally{globalThis.setTimeout=nativeSet;globalThis.clearTimeout=nativeClear}
