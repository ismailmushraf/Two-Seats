import {readFileSync} from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const js=ts.transpileModule(readFileSync('app/lib/playback.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {playbackPlan}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
let memory={revision:1,lastSeek:0,largeDrift:0};
const sample={revision:1,playing:true,position:0,updated:100000,command:'play'};
for(let i=1;i<50;i++){
 const now=100000+i*850;const jitter=i%2?400:-300;
 const plan=playbackPlan(sample,{time:i*.85,duration:7200,seeking:false,paused:false},memory,now,now+jitter);
 assert(!plan.seek,'Normal clock jitter must not cause a hard seek');assert(plan.rate>=.98&&plan.rate<=1.02);memory=plan.next;
}
let plan=playbackPlan({...sample,revision:2,playing:false,position:30000,command:'pause'},{time:32,duration:7200,seeking:false,paused:false},memory,150000,150000);assert(plan.seek);assert.equal(plan.target,30);memory=plan.next;
plan=playbackPlan({...sample,revision:2,playing:false,position:30000,command:'pause'},{time:29.6,duration:7200,seeking:false,paused:true},memory,151000,151000);assert(!plan.seek,'A repeated paused snapshot must not repeatedly seek');
plan=playbackPlan({...sample,revision:3,playing:true,position:120000,updated:152000,command:'seek'},{time:30,duration:7200,seeking:false,paused:false},memory,152000,152000);assert(plan.seek);assert.equal(plan.target,120);memory=plan.next;
plan=playbackPlan({...sample,revision:4,playing:true,position:0,updated:100000,command:'play'},{time:0,duration:7200,seeking:true,paused:false},memory,153000,153000);assert(!plan.seek);assert.equal(plan.next.revision,memory.revision);
memory={revision:1,lastSeek:0,largeDrift:0};
for(let i=0;i<3;i++){plan=playbackPlan(sample,{time:1,duration:7200,seeking:false,paused:false},memory,200000+i*850,200000+i*850);memory=plan.next;if(i<2)assert(!plan.seek);else assert(plan.seek)}
plan=playbackPlan(sample,{time:1,duration:7200,seeking:false,paused:false},memory,203000,203000);assert(!plan.seek,'A drift recovery seek must have a cooldown');
console.log('PASS: jitter causes no seeking; pause/seek revisions apply once; active seeking is untouched; large-drift recovery requires persistence and a cooldown.');
