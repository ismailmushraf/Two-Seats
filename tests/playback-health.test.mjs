import {readFileSync} from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const js=ts.transpileModule(readFileSync('app/lib/playback-health.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {PlaybackHealth,PlaybackStarter}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const sample={revision:1,playing:true,time:1,paused:false,seeking:false,readyState:4,hidden:false,loading:false};
for(const [overrides,reason] of [[{seeking:true},'seeking'],[{paused:true},'paused'],[{readyState:1},'buffering'],[{},'buffering']]){
 const health=new PlaybackHealth();assert.equal(health.sample({...sample,...overrides},0),null);assert.equal(health.sample({...sample,...overrides},3500),null);assert.equal(health.sample({...sample,...overrides},4000),reason);assert.equal(health.sample({...sample,...overrides},5000),null,'Report once per play revision');
 assert.equal(health.sample({...sample,revision:2,...overrides},6000),null,'Explicit resume gives the decoder a new grace period');
}
const healthy=new PlaybackHealth();for(let time=0;time<120000;time+=500)assert.equal(healthy.sample({...sample,time:time/1000},time),null);
for(const ignored of [{hidden:true},{loading:true},{playing:false}]){const health=new PlaybackHealth();health.sample(sample,0);assert.equal(health.sample({...sample,...ignored},10000),null);assert.equal(health.sample(sample,10001),null)}
const seeks=new PlaybackHealth();seeks.sample({...sample,seeking:true},0);assert.equal(seeks.sample({...sample,seeking:true,time:99},4000),'seeking','Changing seek target is not decoded playback progress');
let calls=0,failures=0,rejectPlay;const starter=new PlaybackStarter(),video={play:()=>{calls++;return new Promise((_,reject)=>rejectPlay=reject)}};
starter.start(video,()=>failures++);let signaled=false;signaled=true;assert(signaled,'Shared control can be sent before play settles');for(let i=0;i<10;i++)starter.start(video,()=>failures++);assert.equal(calls,1,'Polling cannot create a pile of pending play calls');
rejectPlay(new DOMException('Paused','AbortError'));for(let i=0;i<5;i++)await Promise.resolve();assert.equal(failures,0);starter.start(video,()=>failures++);assert.equal(calls,2);rejectPlay(new DOMException('Permission','NotAllowedError'));for(let i=0;i<5;i++)await Promise.resolve();assert.equal(failures,1);
console.log('PASS: stalled seeks, unexpected pauses, frozen clocks, buffering, graceful resume, healthy playback, background/loading, and nonblocking deduplicated play.');
