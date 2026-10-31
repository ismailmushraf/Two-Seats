/** Read codec metadata from local MKV headers, skipping media payloads by byte offsets. */
export type MatroskaTrack={number:number;type:number;codec:string;compression?:number;prefix?:Uint8Array;defaultDuration?:number};
type Element={id:number;start:number;end:number;unknown:boolean};
function element(bytes:Uint8Array,offset:number,limit=bytes.length):Element|null{
 if(offset>=limit||!bytes[offset])return null;
 const length=(byte:number,max:number)=>{let n=1;while(n<=max&&!(byte&(1<<(8-n))))n++;return n;};
 const idLength=length(bytes[offset],4);if(idLength>4||offset+idLength>=limit)return null;
 let id=0;for(let i=0;i<idLength;i++)id=id*256+bytes[offset+i];
 const at=offset+idLength,sizeLength=length(bytes[at],8);if(sizeLength>8||at+sizeLength>limit)return null;
 let size=bytes[at]&((1<<(8-sizeLength))-1),unknown=size===((1<<(8-sizeLength))-1);
 for(let i=1;i<sizeLength;i++){size=size*256+bytes[at+i];unknown=unknown&&bytes[at+i]===255;}
 const start=at+sizeLength;
 if(!unknown&&!Number.isSafeInteger(size))return null;
 return {id,start,end:unknown?limit:start+size,unknown};
}
function integer(bytes:Uint8Array){let value=0;for(const byte of bytes)value=value*256+byte;return value;}
function children(bytes:Uint8Array,start=0,end=bytes.length){const list:Element[]=[];for(let pos=start;pos<end;){const e=element(bytes,pos,end);if(!e||e.end>end||e.end<=pos)break;list.push(e);pos=e.end;}return list;}
export function parseTrackEntries(bytes:Uint8Array):MatroskaTrack[]{
 return children(bytes).filter(e=>e.id===0xAE).map(entry=>{
  const fields=children(bytes,entry.start,entry.end),get=(id:number)=>{const e=fields.find(e=>e.id===id);return e?bytes.subarray(e.start,e.end):new Uint8Array();};
  let compression:number|undefined,prefix:Uint8Array|undefined;
  const encodings=get(0x6D80);
  for(const encoding of children(encodings).filter(e=>e.id===0x6240)){
   const compressed=children(encodings,encoding.start,encoding.end).find(e=>e.id===0x5034);
   if(compressed){const fields=children(encodings,compressed.start,compressed.end),algo=fields.find(e=>e.id===0x4254),settings=fields.find(e=>e.id===0x4255);compression=algo?integer(encodings.subarray(algo.start,algo.end)):0;prefix=settings?encodings.slice(settings.start,settings.end):undefined;}
  }
  return {number:integer(get(0xD7)),type:integer(get(0x83)),codec:new TextDecoder().decode(get(0x86)),defaultDuration:integer(get(0x23E383)),compression,prefix};
 });
}

export function createMatroskaSubtitleReader(file:Blob,tracks:MatroskaTrack[],onPackets:(packets:any[])=>void,signal:AbortSignal){
 const supported=new Map(tracks.map((track,index)=>[track.number,{...track,index}]).filter(([,track])=>typeof track==='object'&&track.type===17&&/^(S_TEXT\/(UTF8|ASS|SSA|WEBVTT)|D_WEBVTT\/|S_HDMV\/PGS)/.test(track.codec)) as Array<[number,MatroskaTrack&{index:number}]>);
 if(!supported.size)return null;const pgsStreams=[...supported.values()].filter(track=>track.codec==='S_HDMV/PGS').map(track=>track.index);let pgsWindow:{start:number;end:number}|null=null,selectedPgs:number|null=pgsStreams[0]??null;
 let closed=false,running=false,requested:number|null=null,scanPos=0,segmentEnd=file.size,timeScale=1_000_000,initialized=false,lastError='';
 const index:Array<{start:number;end:number;time:number}>=[],loaded:Array<{start:number;end:number}>=[];
 const check=()=>{if(closed||signal.aborted)throw new DOMException('Movie changed.','AbortError');};
 const header=async(pos:number)=>{check();const e=element(new Uint8Array(await file.slice(pos,pos+16).arrayBuffer()),0);if(!e)return null;return {...e,start:pos+e.start,end:e.unknown?file.size:pos+e.end};};
 async function initialize(){
  for(let pos=0,count=0;pos<file.size&&count<8;count++){const e=await header(pos);if(!e)return;if(e.id===0x18538067){scanPos=e.start;segmentEnd=e.end;initialized=true;return}pos=e.end;}
 }
 async function unpack(bytes:Uint8Array,track:MatroskaTrack){
  if(track.compression===undefined)return bytes;
  if(track.compression===3){const result=new Uint8Array((track.prefix?.length||0)+bytes.length);if(track.prefix)result.set(track.prefix);result.set(bytes,track.prefix?.length||0);return result;}
  if(track.compression===0){
   const reader=new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){check();const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_000_000)throw new Error('Subtitle packet exceeds size limit.');chunks.push(value);}}finally{reader.releaseLock();}
   const result=new Uint8Array(size);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}return result;
  }
  throw new Error(`Unsupported subtitle compression ${track.compression}`);
 }
 async function parseCluster(cluster:{start:number;end:number;time:number}){
  check();if(cluster.end-cluster.start>32_000_000)return;
  const bytes=new Uint8Array(await file.slice(cluster.start,cluster.end).arrayBuffer()),packets:any[]=[];
  for(const child of children(bytes)){
   let block:Element|undefined,duration=0;
   if(child.id===0xA3)block=child;
   else if(child.id===0xA0){const fields=children(bytes,child.start,child.end);block=fields.find(e=>e.id===0xA1);const timing=fields.find(e=>e.id===0x9B);if(timing)duration=integer(bytes.subarray(timing.start,timing.end))*timeScale/1e6;}
   if(!block)continue;
   const first=bytes[block.start];let length=1;while(length<=8&&!(first&(1<<(8-length))))length++;if(length>8||block.start+length+3>block.end)continue;
   let trackNumber=first&((1<<(8-length))-1);for(let i=1;i<length;i++)trackNumber=trackNumber*256+bytes[block.start+i];
   const track=supported.get(trackNumber);if(!track)continue;
   const at=block.start+length,relative=(bytes[at]*256+bytes[at+1])<<16>>16,flags=bytes[at+2];
   if(flags&6)continue; // Subtitle lacing is not defined by the supported mappings.
   const start=cluster.time*1000+relative*timeScale/1e6;
   try{
    const payload=await unpack(bytes.subarray(at+3,block.end),track);check();
    if(track.codec==='S_HDMV/PGS'){if(track.index!==selectedPgs)continue;packets.push({type:'pgs',streamIndex:track.index,start,end:start+duration,content:payload.slice()});continue}
    let content=new TextDecoder().decode(payload);
    if(track.codec.startsWith('D_WEBVTT/'))content=content.split('\n').slice(2).join('\n');
    packets.push({type:'dialogue',streamIndex:track.index,start,end:start+(duration||((track.defaultDuration||0)/1e6)),content});
   }catch(error){if(signal.aborted||closed)throw error;lastError=error instanceof Error?error.message:'This subtitle packet could not be decoded.';}
  }
  if(packets.length){check();onPackets(packets.filter(packet=>packet.type!=='pgs'||packet.streamIndex===selectedPgs));}
 }
 async function window(time:number){
  if(!initialized)await initialize();if(!initialized)return;
  const from=Math.max(0,time-(selectedPgs!==null?60:15)),to=time+45;
  if(selectedPgs!==null?(pgsWindow&&pgsWindow.start<=from&&pgsWindow.end>=to):loaded.some(window=>window.start<=from&&window.end>=to))return;
  if(selectedPgs!==null)onPackets(pgsStreams.map(streamIndex=>({type:'pgs-reset',streamIndex})));
  // Index only as far as needed. Media bytes are skipped, not copied into memory.
  while(scanPos<segmentEnd&&(!index.length||index[index.length-1].time<=to)){
   const e=await header(scanPos);if(!e||e.end<=scanPos)break;
   if(e.id===0x1549A966&&e.end-e.start<1_000_000){const bytes=new Uint8Array(await file.slice(e.start,e.end).arrayBuffer()),scale=children(bytes).find(e=>e.id===0x2AD7B1);if(scale)timeScale=integer(bytes.subarray(scale.start,scale.end))||1_000_000;}
   if(e.id===0x1F43B675){
    const bytes=new Uint8Array(await file.slice(e.start,Math.min(e.end,e.start+4096)).arrayBuffer());let timestamp=0;
    for(let pos=0;pos<bytes.length;){const field=element(bytes,pos);if(!field)break;if(field.id===0xE7&&field.end<=bytes.length){timestamp=integer(bytes.subarray(field.start,field.end))*timeScale/1e9;break}if(field.end>bytes.length)break;pos=field.end;}
    index.push({start:e.start,end:e.end,time:timestamp});
   }
   scanPos=e.end;if(e.unknown)break;
  }
  for(let i=0;i<index.length;i++){check();const cluster=index[i],next=index[i+1]?.time??Infinity;if(cluster.time<=to&&next>=from)await parseCluster(cluster);}
  if(selectedPgs!==null){pgsWindow={start:from,end:to};onPackets(pgsStreams.map(streamIndex=>({type:'pgs-window-end',streamIndex,start:from,end:to})));}else loaded.push({start:from,end:to});
 }
 async function run(){if(running)return;running=true;try{while(requested!==null&&!closed){const time=requested;requested=null;await window(time);}}catch{/* This independent subtitle path must never interrupt audio/video. */}finally{running=false;}}
 return {
  get error(){return lastError;},
  streams:new Set([...supported.values()].map(track=>track.index)),
  selectPgs(index:number|null){const selected=index!==null&&pgsStreams.includes(index)?index:null;if(selected!==selectedPgs){selectedPgs=selected;pgsWindow=null;}},
  request(time:number){if(closed||signal.aborted||(selectedPgs!==null?(pgsWindow&&pgsWindow.start<=Math.max(0,time-15)&&pgsWindow.end>=time+15):loaded.some(window=>window.start<=Math.max(0,time-15)&&window.end>=time+15)))return;requested=time;void run();},
  destroy(){closed=true;requested=null;},
 };
}
export async function readMatroskaTracks(file:Blob,signal?:AbortSignal):Promise<MatroskaTrack[]>{
 const check=()=>{if(signal?.aborted)throw new DOMException('Movie changed.','AbortError');};
 const header=async(pos:number)=>{check();const bytes=new Uint8Array(await file.slice(pos,pos+16).arrayBuffer()),e=element(bytes,0);if(!e)return null;return {...e,start:pos+e.start,end:e.unknown?file.size:pos+e.end};};
 const tracks=async(e:Element)=>{if(e.end-e.start>8_000_000)return [];check();return parseTrackEntries(new Uint8Array(await file.slice(e.start,e.end).arrayBuffer()));};
 let segment:Element|null=null;
 for(let pos=0,count=0;pos<file.size&&count<8;count++){
  const e=await header(pos);if(!e)return [];if(e.id===0x18538067){segment=e;break}if(e.end<=pos)return [];pos=e.end;
 }
 if(!segment)return [];
 for(let pos=segment.start,count=0;pos<segment.end&&count<128;count++){
  const e=await header(pos);if(!e||e.end<=pos)return [];
  if(e.id===0x1654AE6B)return tracks(e);
  if(e.id===0x114D9B74&&e.end-e.start<1_000_000){
   const bytes=new Uint8Array(await file.slice(e.start,e.end).arrayBuffer());
   for(const seek of children(bytes).filter(e=>e.id===0x4DBB)){
    const fields=children(bytes,seek.start,seek.end),id=fields.find(e=>e.id===0x53AB),offset=fields.find(e=>e.id===0x53AC);
    if(id&&offset&&integer(bytes.subarray(id.start,id.end))===0x1654AE6B){const target=await header(segment.start+integer(bytes.subarray(offset.start,offset.end)));if(target?.id===0x1654AE6B)return tracks(target);}
   }
  }
  if(e.unknown)return [];pos=e.end;
 }
 return [];
}
