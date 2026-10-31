import {PgsTimeline,type PgsFrame} from './pgs';
export type SubtitleChoice={streamIndex:number;language:string;title:string;codec?:string};
function decode(value:unknown):string{
  if(typeof value==='string')return value;
  if(value instanceof Uint8Array)return new TextDecoder().decode(value);
  if(value instanceof ArrayBuffer)return new TextDecoder().decode(value);
  if(Array.isArray(value)&&value.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255))return new TextDecoder().decode(new Uint8Array(value));
  return '';
}
/** Convert text packets to plain subtitle text. Never insert movie-provided HTML. */
export function subtitleText(packet:any,format:string[]=[]):string{
  let text=decode(packet.fields?.Text??packet.fields?.text);
  if(!text){
    text=decode(packet.content);
    // FFmpeg emits Matroska ASS packets as ReadOrder,Layer,Style,Name,MarginL,
    // MarginR,MarginV,Effect,Text even when the container header uses another format.
    if(/^\d+,\d+,[^,\n]*,/.test(text)){
      let start=0;for(let i=0;i<8;i++){const next=text.indexOf(',',start);if(next<0){start=0;break}start=next+1}text=text.slice(start);
    }else{
    const field=format.findIndex(name=>name.toLowerCase()==='text');
    if(field>0){let start=0;for(let i=0;i<field;i++){const next=text.indexOf(',',start);if(next<0){start=0;break}start=next+1}text=text.slice(start);}
    }
  }
  // ASS drawings are not dialogue. Position/style overrides are displayed as readable plain text.
  if(/\{[^}]*\\p[1-9]/.test(text))return '';
  // Bitmap packets aren't UTF-8 text; never render their binary bytes as captions.
  if(/[\x00-\x08\x0E-\x1F]/.test(text))return '';
  return text.replace(/\{[^}]*\}/g,'').replace(/\\[Nn]/g,'\n').replace(/\\h/g,' ')
    .replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .trim().slice(0,8000);
}
export type SubtitleCue={start:number;end:number;text:string};
const cueIndexes=new WeakMap<SubtitleCue[],{length:number;ends:number[]}>();
export function activeSubtitle(cues:SubtitleCue[],time:number):string{
  if(!Number.isFinite(time))return '';
  let index=cueIndexes.get(cues);
  if(!index||index.length!==cues.length){let end=0;const ends=cues.map(cue=>(end=Math.max(end,cue.end)));index={length:cues.length,ends};cueIndexes.set(cues,index);}
  let lo=0,hi=cues.length;while(lo<hi){const mid=(lo+hi)>>>1;if(cues[mid].start<=time)lo=mid+1;else hi=mid;}
  const lines:string[]=[];for(let i=lo-1;i>=0&&index.ends[i]>time;i--)if(cues[i].end>time)lines.push(cues[i].text);
  return [...new Set(lines.reverse())].join('\n');
}
function timestamp(text:string):number{
 const parts=text.trim().replace(',','.').split(':').map(Number);
 if(parts.length<2||parts.length>3||parts.some(value=>!Number.isFinite(value)||value<0))return NaN;
 return parts.reduce((value,part)=>value*60+part,0);
}
export function parseSubtitleFile(input:string,extension:string):SubtitleCue[]{
 const text=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'),cues:SubtitleCue[]=[];
 const add=(start:number,end:number,value:string)=>{const clean=subtitleText({fields:{Text:value}});if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&clean)cues.push({start,end,text:clean});};
 if(/^(ass|ssa)$/i.test(extension)){
 let format=['Layer','Start','End','Style','Name','MarginL','MarginR','MarginV','Effect','Text'],events=false;
 for(const line of text.split('\n')){
 if(/^\[/.test(line)){events=/^\[Events\]/i.test(line);continue}if(!events)continue;
 if(/^Format:/i.test(line)){format=line.slice(line.indexOf(':')+1).split(',').map(field=>field.trim());continue}
 if(!/^Dialogue:/i.test(line))continue;
 const raw=line.slice(line.indexOf(':')+1).trimStart(),values:string[]=[];let at=0;
 for(let i=0;i<format.length-1;i++){const next=raw.indexOf(',',at);if(next<0)break;values.push(raw.slice(at,next));at=next+1;}values.push(raw.slice(at));
 const get=(name:string)=>values[format.findIndex(field=>field.toLowerCase()===name)]||'';
 add(timestamp(get('start')),timestamp(get('end')),get('text'));
 }
 }else{
 for(const block of text.split(/\n[ \t]*\n/)){
 const lines=block.split('\n'),at=lines.findIndex(line=>line.includes('-->'));if(at<0)continue;
 const match=lines[at].match(/([\d:. ,]+)\s+-->\s+([\d:.,]+)/);if(!match)continue;
 add(timestamp(match[1]),timestamp(match[2]),lines.slice(at+1).join('\n'));
 }
 }
 if(!cues.length)throw new Error('No readable subtitle lines found. Choose a text subtitle file: SRT, VTT, ASS or SSA.');
 if(cues.length>50000)throw new Error('This subtitle file has too many lines. Choose a smaller subtitle file.');
 return cues.sort((a,b)=>a.start-b.start);
}
export class MovieSubtitles{
 readonly choices:SubtitleChoice[]=[];
 private selected=-1;
 private tracks=new Map<number,{format:string[];seen:Map<string,SubtitleCue>;cues:SubtitleCue[];codec:string;received:number;rejected:number;inferred:Set<SubtitleCue>;pgs?:PgsTimeline}>();
 constructor(_video:HTMLVideoElement,headers:any[]){
  for(const header of headers){
   const streamIndex=Number(header.streamIndex);
   if(header.type!=='header'||!Number.isInteger(streamIndex)||this.tracks.has(streamIndex))continue;
   this.tracks.set(streamIndex,{format:Array.isArray(header.format)?header.format:[],seen:new Map(),cues:[],codec:header.codec||'',received:0,rejected:0,inferred:new Set(),pgs:header.codec==='S_HDMV/PGS'?new PgsTimeline():undefined});
   this.choices.push({streamIndex,language:header.language||'',title:header.title||header.language||`Subtitles ${this.choices.length+1}`,codec:header.codec||''});
  }
  this.choices.sort((a,b)=>Number(/PGS|VOBSUB|DVB|BITMAP/i.test(a.codec||''))-Number(/PGS|VOBSUB|DVB|BITMAP/i.test(b.codec||'')));
  this.select(this.choices[0]?.streamIndex??-1);
 }
 select(index:number){if(this.selected!==index)this.tracks.get(this.selected)?.pgs?.clear();this.selected=index;}
 caption(time:number){return activeSubtitle(this.tracks.get(this.selected)?.cues||[],time);}
 bitmap(time:number):PgsFrame|null{return this.tracks.get(this.selected)?.pgs?.at(time)||null;}
 get cueCount(){const track=this.tracks.get(this.selected);return track?.pgs?.count||track?.cues.length||0;}
 get diagnostics(){const track=this.tracks.get(this.selected);return {codec:track?.codec||'',received:track?.received||0,rejected:track?.rejected||0,inferred:track?.inferred.size||0,pgsError:track?.pgs?.error||''};}
 add(packets:any[]){
  const changed=new Set<number>();
  for(const packet of packets){
   const id=Number(packet.streamIndex),track=this.tracks.get(id);if(!track)continue;
   if(packet.type==='pgs-reset'){track.pgs?.resetDecoder();continue}
   if(packet.type==='pgs-window-end'){track.pgs?.windowReady(packet.start,packet.end);continue}
   if(packet.type==='pgs'&&track.pgs){track.received++;track.pgs.add(packet.content,Number(packet.start)/1000,Number(packet.end)/1000);continue}
   if(packet.type!=='dialogue'||track.pgs)continue;
   track.received++;
   const start=Number(packet.start)/1000,rawEnd=Number(packet.end)/1000;
   if(!Number.isFinite(start)||start < -60){track.rejected++;continue;}
   const text=/PGS|VOBSUB|DVB|BITMAP/i.test(track.codec)?'':subtitleText(packet,track.format);if(!text){track.rejected++;continue;}
   const missingDuration=!Number.isFinite(rawEnd)||rawEnd<=start,end=missingDuration?start+8:rawEnd;
   const key=`${start}:${text}`,existing=track.seen.get(key);
   if(existing){if(track.inferred.has(existing)&&!missingDuration){existing.end=end;track.inferred.delete(existing);changed.add(id)}continue}
   if(track.seen.size>=50000)continue;
   const cue={start:Math.max(0,start),end,text};track.cues.push(cue);if(missingDuration)track.inferred.add(cue);track.seen.set(key,cue);changed.add(id);
  }
  for(const id of changed){const track=this.tracks.get(id)!;track.cues.sort((a,b)=>a.start-b.start);
   // Missing durations are common in subtitle packets. Keep the line visible,
   // ending it at the next different timestamp (capped at eight seconds).
   for(let i=0;i<track.cues.length;i++)if(track.inferred.has(track.cues[i])){let j=i+1;while(j<track.cues.length&&track.cues[j].start===track.cues[i].start)j++;track.cues[i].end=Math.min(track.cues[i].start+8,track.cues[j]?.start??Infinity);}
   cueIndexes.delete(track.cues);
  }
 }
 clear(){for(const track of this.tracks.values()){track.cues=[];track.seen.clear();track.inferred.clear();track.received=0;track.rejected=0;track.pgs?.clear();}}
 destroy(){this.clear();this.tracks.clear();}
}
