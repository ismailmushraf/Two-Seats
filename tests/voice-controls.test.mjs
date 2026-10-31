import {readFileSync} from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
async function module(path){let js=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;if(path.endsWith('/subtitles.ts')){const pgs=ts.transpileModule(readFileSync('app/lib/pgs.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;js=js.replace("'./pgs'",JSON.stringify('data:text/javascript;base64,'+Buffer.from(pgs).toString('base64')))}return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));}
const {speechLevel,SpeechDucking,microphoneEnabled}=await module('app/lib/voice-audio.ts');
const track={enabled:false,readyState:'live'},stream={getAudioTracks:()=>[track]};let enabled=false;enabled=microphoneEnabled(stream,!enabled,true);assert(enabled&&track.enabled);enabled=microphoneEnabled(stream,!enabled,true);assert(!enabled&&!track.enabled);enabled=microphoneEnabled(stream,true,false);assert(!enabled&&!track.enabled);assert.equal(microphoneEnabled(null,true,true),false);
assert.equal(speechLevel(new Float32Array(1024)),0);assert(Math.abs(speechLevel(new Float32Array([.1,-.1]))-.1)<.0001);
const duck=new SpeechDucking();assert.equal(duck.update(0,0,1000),1);assert.equal(duck.update(.1,0,1100),.25);assert.equal(duck.update(0,0,1500),.25);assert.equal(duck.update(0,0,1700),1);assert.equal(duck.update(0,.1,1800),.25);duck.reset();assert.equal(duck.update(0,0,1801),1);
const {subtitleText}=await module('app/lib/subtitles.ts');
assert.equal(subtitleText({content:'0,0,Default,,0,0,0,,{\\i1}Hi, Sinu!\\NSecond line'},['ReadOrder','Layer','Style','Name','MarginL','MarginR','MarginV','Effect','Text']),'Hi, Sinu!\nSecond line');
assert.equal(subtitleText({content:new TextEncoder().encode('Hello')}),'Hello');assert.equal(subtitleText({content:'{\\p1}m 0 0 l 100 100'}),'');assert.equal(subtitleText({content:'<b>Hello</b>'}),'Hello');
console.log('PASS: speech from either side ducks sound with a silence hold and reset; subtitle text preserves commas/newlines, handles byte packets, strips styling and drawing instructions.');
