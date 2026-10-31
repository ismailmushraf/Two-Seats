import {readFileSync} from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';import {deflateSync} from 'node:zlib';
async function mod(path){let js=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;if(path.endsWith('/subtitles.ts')){const pgs=ts.transpileModule(readFileSync('app/lib/pgs.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;js=js.replace("'./pgs'",JSON.stringify('data:text/javascript;base64,'+Buffer.from(pgs).toString('base64')))}return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));}
const {readMatroskaTracks,createMatroskaSubtitleReader}=await mod('app/lib/matroska-tracks.ts'),{MovieSubtitles}=await mod('app/lib/subtitles.ts');
const concat=(...parts)=>new Uint8Array(Buffer.concat(parts.map(part=>Buffer.from(part)))),u=(n)=>{const bytes=[];do{bytes.unshift(n%256);n=Math.floor(n/256);}while(n);return new Uint8Array(bytes)},str=s=>new TextEncoder().encode(s);
function eb(id,payload){const identifier=Uint8Array.from(Buffer.from(id,'hex'));let length=1;while(payload.length>=2**(length*7)-1)length++;let size=payload.length,bytes=new Uint8Array(length);for(let i=length-1;i>=0;i--){bytes[i]=size%256;size=Math.floor(size/256)}bytes[0]|=1<<(8-length);return concat(identifier,bytes,payload);}
function fixture(compression){
 const encoding=compression===undefined?new Uint8Array():eb('6d80',eb('6240',eb('5034',concat(eb('4254',u(compression)),...(compression===3?[eb('4255',str('Prefix '))]:[])))));
 const tracks=eb('1654ae6b',concat(eb('ae',concat(eb('d7',u(1)),eb('83',u(1)),eb('86',str('V_MPEG4/ISO/AVC')))),eb('ae',concat(eb('d7',u(2)),eb('83',u(17)),eb('86',str('S_TEXT/UTF8')),encoding))));
 const packet=(time,text,duration)=>{let data=str(text);if(compression===0)data=deflateSync(data);const block=eb('a1',concat(new Uint8Array([0x82,time>>8,time&255,0]),data));return eb('a0',concat(block,...(duration===undefined?[]:[eb('9b',u(duration))])));};
 const cluster=eb('1f43b675',concat(eb('e7',u(0)),packet(1000,'Hello',undefined),packet(4000,'Next',2000)));
 return new Blob([eb('1a45dfa3',new Uint8Array()),eb('18538067',concat(eb('1549a966',eb('2ad7b1',u(1000000))),tracks,cluster))]);
}
for(const compression of [undefined,0,3]){
 const file=fixture(compression),tracks=await readMatroskaTracks(file);assert.equal(tracks[1].codec,'S_TEXT/UTF8');assert.equal(tracks[1].compression,compression);
 const movie=new MovieSubtitles({},[{type:'header',streamIndex:1,codec:tracks[1].codec}]),abort=new AbortController();let packets=[];
 const reader=createMatroskaSubtitleReader(file,tracks,items=>{packets.push(...items);movie.add(items)},abort.signal);reader.request(0);
 for(let i=0;i<100&&!movie.cueCount;i++)await new Promise(r=>setTimeout(r,10));assert.equal(movie.cueCount,2);assert.equal(movie.caption(2),compression===3?'Prefix Hello':'Hello');assert.equal(movie.caption(4.5),compression===3?'Prefix Next':'Next');assert.equal(movie.caption(6),'');assert.equal(movie.diagnostics.inferred,1);
 // A later exact duration upgrades an inferred cue without a duplicate or stale timeline index.
 movie.add([{...packets[0],end:2500}]);assert.equal(movie.cueCount,2);assert.equal(movie.caption(3),'');reader.destroy();abort.abort();
}
const picture=new MovieSubtitles({},[{type:'header',streamIndex:0,codec:'S_HDMV/PGS'}]);picture.add([{type:'dialogue',streamIndex:0,start:0,end:0,content:new Uint8Array([0x16,0,0])}]);assert.equal(picture.cueCount,0);assert.equal(picture.cueCount,0);
console.log('PASS: direct local MKV reading extracts subtitle payloads without libav output; missing durations display and end at the next line; zlib/header stripping work; exact timings replace estimates; picture data is never displayed as garbage.');
const {existsSync}=await import('node:fs');
if(existsSync('public/__media-qa/subtitles.mkv')){
 const file=new Blob([readFileSync('public/__media-qa/subtitles.mkv')]),tracks=await readMatroskaTracks(file);assert.equal(tracks.filter(t=>t.type===17).length,2);
 const movie=new MovieSubtitles({},tracks.flatMap((track,index)=>track.type===17?[{type:'header',streamIndex:index,codec:track.codec}]:[])),abort=new AbortController(),reader=createMatroskaSubtitleReader(file,tracks,items=>movie.add(items),abort.signal);reader.request(0);
 for(let i=0;i<200&&movie.cueCount<2;i++)await new Promise(r=>setTimeout(r,10));assert.equal(movie.caption(1),'Hello from embedded SRT');assert.equal(movie.caption(25),'Subtitle after seek');reader.destroy();abort.abort();console.log('PASS: direct extraction also reads both real ffmpeg-generated embedded subtitle tracks from MKV.');
}
if(existsSync('public/__media-qa/pgs.mkv')){
 const file=new Blob([readFileSync('public/__media-qa/pgs.mkv')]),tracks=await readMatroskaTracks(file),headers=tracks.flatMap((track,index)=>track.type===17?[{type:'header',streamIndex:index,codec:track.codec}]:[]);assert.equal(headers[0].codec,'S_HDMV/PGS');
 const movie=new MovieSubtitles({},headers),abort=new AbortController(),reader=createMatroskaSubtitleReader(file,tracks,items=>movie.add(items),abort.signal);reader.request(0);
 for(let i=0;i<200&&!movie.bitmap(2);i++)await new Promise(r=>setTimeout(r,10));assert(movie.bitmap(2),'real MKV PGS picture must decode');assert.equal(movie.bitmap(5),null);assert.equal(movie.bitmap(17).parts.length,2);assert.equal(movie.bitmap(25).parts[0].crop.width,80);movie.select(-1);assert.equal(movie.bitmap(2),null);reader.selectPgs(null);movie.select(headers[0].streamIndex);reader.selectPgs(headers[0].streamIndex);reader.request(2);for(let i=0;i<200&&!movie.bitmap(2);i++)await new Promise(r=>setTimeout(r,10));assert(movie.bitmap(2),'track switching must re-read picture data');reader.destroy();abort.abort();console.log('PASS: real MKV PGS packets decode independently, clear, crop, compose multiple objects and reload after track switching.');
}
