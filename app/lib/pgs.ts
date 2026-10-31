/** HDMV/PGS graphics decoder. All buffers originate from the user's local movie. */
export type PgsPart={x:number;y:number;width:number;height:number;rle:Uint8Array;palette:Uint8ClampedArray;crop:{x:number;y:number;width:number;height:number}};
export type PgsFrame={id:string;width:number;height:number;parts:PgsPart[]};
type Display={time:number;end:number;frame:PgsFrame|null};
type ObjectData={width:number;height:number;data:Uint8Array;used:number;complete:boolean};
type Reference={id:number;window:number;x:number;y:number;crop?:{x:number;y:number;width:number;height:number}};
type Rect={x:number;y:number;width:number;height:number};
const u16=(b:Uint8Array,p:number)=>b[p]*256+b[p+1];
const u24=(b:Uint8Array,p:number)=>b[p]*65536+b[p+1]*256+b[p+2];
function requireSize(ok:boolean){if(!ok)throw new Error('Invalid or incomplete PGS subtitle data.');}
export function decodePgsRle(rle:Uint8Array,width:number,height:number,palette:Uint8ClampedArray):Uint8ClampedArray{
 requireSize(width>0&&height>0&&width*height<=4_194_304&&palette.length===1024);
 const output=new Uint8ClampedArray(width*height*4);let at=0,pixel=0,row=0;
 while(at<rle.length&&pixel<width*height){
  let color=rle[at++],run=1;
  if(color===0){
   requireSize(at<rle.length);const flags=rle[at++];run=flags&63;
   if(flags&64){requireSize(at<rle.length);run=run*256+rle[at++];}
   if(flags&128){requireSize(at<rle.length);color=rle[at++];}
   if(!run){row++;pixel=Math.max(pixel,row*width);continue;}
  }
  requireSize(pixel+run<=width*height);
  const p=color*4,r=palette[p],g=palette[p+1],b=palette[p+2],a=palette[p+3];for(let i=0;i<run;i++){const at=pixel*4;output[at]=r;output[at+1]=g;output[at+2]=b;output[at+3]=a;pixel++;}
 }
 requireSize(pixel>=width*height);return output;
}
export class PgsDecoder{
 private palettes=new Map<number,Uint8ClampedArray>();
 private objects=new Map<number,ObjectData>();
 private windows=new Map<number,Rect>();
 private composition:{width:number;height:number;palette:number;references:Reference[];time:number;end:number;number:number}|null=null;
 private sequence=0;
 constructor(private display:(event:Display)=>void){}
 reset(){this.palettes.clear();this.objects.clear();this.windows.clear();this.composition=null;}
 feed(bytes:Uint8Array,time:number,duration=0){
  requireSize(bytes.length<=4_500_000&&Number.isFinite(time));
  for(let at=0;at<bytes.length;){
   // SUP-framed input is tolerated, but Matroska's timestamp remains authoritative.
   if(bytes[at]===0x50&&bytes[at+1]===0x47){requireSize(at+13<=bytes.length);at+=10;}
   requireSize(at+3<=bytes.length);const type=bytes[at],length=u16(bytes,at+1);at+=3;requireSize(at+length<=bytes.length);
   const data=bytes.subarray(at,at+length);at+=length;
   if(type===0x16)this.presentation(data,time,duration);
   else if(type===0x14)this.palette(data);
   else if(type===0x15)this.object(data);
   else if(type===0x17)this.window(data);
   else if(type===0x80)this.finish(duration>0?time+duration:Infinity);
  }
 }
 private presentation(data:Uint8Array,time:number,duration:number){
  requireSize(data.length>=11);const width=u16(data,0),height=u16(data,2),number=u16(data,5);
  requireSize(width>0&&height>0&&width<=8192&&height<=8192&&data[10]<=64);
  if(data[7]&0xc0){this.palettes.clear();this.objects.clear();this.windows.clear();}
  const references:Reference[]=[];
  for(let i=0,at=11;i<data[10];i++){
   requireSize(at+8<=data.length);const ref:Reference={id:u16(data,at),window:data[at+2],x:u16(data,at+4),y:u16(data,at+6)},cropped=!!(data[at+3]&0x80);at+=8;
   if(cropped){requireSize(at+8<=data.length);ref.crop={x:u16(data,at),y:u16(data,at+2),width:u16(data,at+4),height:u16(data,at+6)};at+=8;}
   references.push(ref);
  }
  this.composition={width,height,number,palette:data[9],references,time,end:duration>0?time+duration:Infinity};
 }
 private palette(data:Uint8Array){
  requireSize(data.length>=2&&(data.length-2)%5===0&&this.palettes.size<257);
  const palette=this.palettes.get(data[0])?.slice()||new Uint8ClampedArray(1024),hd=(this.composition?.height||1080)>576;
  for(let i=2;i+4<data.length;i+=5){
   const id=data[i]*4,y=1.16438356*(data[i+1]-16),cr=data[i+2]-128,cb=data[i+3]-128;
   palette[id]=y+(hd?1.792741:1.596027)*cr;palette[id+1]=y-(hd?.213249:.391762)*cb-(hd?.532909:.812968)*cr;palette[id+2]=y+(hd?2.112402:2.017232)*cb;palette[id+3]=data[i+4];
  }
  this.palettes.set(data[0],palette);
 }
 private object(data:Uint8Array){
  requireSize(data.length>=4);const id=u16(data,0),flags=data[3];let object=this.objects.get(id),at=4;
  if(flags&0x80){
   requireSize(data.length>=11);const size=u24(data,4)-4,width=u16(data,7),height=u16(data,9);at=11;
   requireSize(size>0&&size<=4_194_304&&width>0&&height>0&&width*height<=4_194_304&&width<=8192&&height<=8192);
   // Compressed object caches are bounded even for malformed files without epoch resets.
   if(!this.objects.has(id)&&this.objects.size>=64)this.objects.delete(this.objects.keys().next().value!);
   this.objects.delete(id);let used=0;for(const value of this.objects.values())used+=value.data.length;
   while(used+size>8_388_608&&this.objects.size){const key=this.objects.keys().next().value!;used-=this.objects.get(key)!.data.length;this.objects.delete(key);}
   object={width,height,data:new Uint8Array(size),used:0,complete:false};this.objects.set(id,object);
  }
  requireSize(!!object);const current=object!;requireSize(current.used+data.length-at<=current.data.length);
  current.data.set(data.subarray(at),current.used);current.used+=data.length-at;
  current.complete=current.used===current.data.length;
  if(flags&0x40)requireSize(current.complete);
 }
 private window(data:Uint8Array){
  requireSize(data.length>=1&&data.length>=1+data[0]*9);
  for(let i=0,at=1;i<data[0];i++,at+=9)this.windows.set(data[at],{x:u16(data,at+1),y:u16(data,at+3),width:u16(data,at+5),height:u16(data,at+7)});
 }
 private finish(fallbackEnd=Infinity){
  const composition=this.composition;if(!composition)return;
  this.composition=null;
  if(!composition.references.length){this.display({time:composition.time,end:Infinity,frame:null});return;}
  const palette=this.palettes.get(composition.palette);requireSize(!!palette);
  const parts:PgsPart[]=[];
  for(const ref of composition.references){
   const object=this.objects.get(ref.id);requireSize(!!object?.complete);const bitmap=object!;
   const crop=ref.crop||{x:0,y:0,width:bitmap.width,height:bitmap.height};
   requireSize(crop.x+crop.width<=bitmap.width&&crop.y+crop.height<=bitmap.height&&crop.width>0&&crop.height>0);
   const window=this.windows.get(ref.window)||{x:0,y:0,width:composition.width,height:composition.height};
   const x=Math.max(ref.x,window.x,0),y=Math.max(ref.y,window.y,0),right=Math.min(ref.x+crop.width,window.x+window.width,composition.width),bottom=Math.min(ref.y+crop.height,window.y+window.height,composition.height);
   if(right<=x||bottom<=y)continue;
   parts.push({x,y,width:bitmap.width,height:bitmap.height,rle:bitmap.data,palette:palette!,crop:{x:crop.x+x-ref.x,y:crop.y+y-ref.y,width:right-x,height:bottom-y}});
  }
  this.display({time:composition.time,end:Math.min(composition.end,fallbackEnd),frame:parts.length?{id:`${composition.time}:${composition.number}:${++this.sequence}`,width:composition.width,height:composition.height,parts}:null});
 }
}
export class PgsTimeline{
 private events=new Map<number,Display>();
 private ordered:Display[]=[];
 private dirty=false;
 private bytes=0;
 private focus=0;
 private decoder=new PgsDecoder(event=>{
  const size=(item:Display|undefined)=>item?.frame?.parts.reduce((sum,part)=>sum+part.rle.byteLength+1024,0)||0;
  this.bytes+=size(event)-size(this.events.get(event.time));this.events.set(event.time,event);this.dirty=true;
  if(this.bytes>16_777_216||this.events.size>4096){this.ordered=[...this.events.values()].sort((a,b)=>a.time-b.time);this.trim(this.focus);}
 });
 private coverage:{start:number;end:number}|null=null;
 private managed=false;
 error='';
 received=0;
 resetDecoder(){this.managed=true;this.decoder.reset();}
 windowReady(start:number,end:number){this.coverage={start,end};}
 add(bytes:Uint8Array,start:number,end:number){
  this.received++;
  try{this.decoder.feed(bytes,start,Number.isFinite(end)&&end>start?end-start:0);this.error='';}
  catch(error){this.error=error instanceof Error?error.message:'PGS subtitle decoding failed.';this.events.set(start,{time:start,end:Infinity,frame:null});this.dirty=true;}
 }
 get count(){let count=0;for(const event of this.events.values())if(event.frame)count++;return count;}
 at(time:number):PgsFrame|null{
  this.focus=time;
  if(this.managed&&(!this.coverage||time<this.coverage.start||time>this.coverage.end))return null;
  if(this.dirty){this.ordered=[...this.events.values()].sort((a,b)=>a.time-b.time);this.dirty=false;this.trim(time);}
  let lo=0,hi=this.ordered.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.ordered[mid].time<=time)lo=mid+1;else hi=mid;}
  const event=this.ordered[lo-1];return event&&time<event.end?event.frame:null;
 }
 private trim(time:number){
  let bytes=0;for(const event of this.ordered)for(const part of event.frame?.parts||[])bytes+=part.rle.byteLength+1024;
  if(bytes<=16_777_216&&this.events.size<=4096)return;
  for(const event of [...this.ordered].sort((a,b)=>Math.abs(b.time-time)-Math.abs(a.time-time))){
   if(bytes<=16_777_216&&this.events.size<=4096)break;
   this.events.delete(event.time);for(const part of event.frame?.parts||[])bytes-=part.rle.byteLength+1024;
  }
  this.ordered=[...this.events.values()].sort((a,b)=>a.time-b.time);
  this.bytes=bytes;
 }
 clear(){this.decoder.reset();this.events.clear();this.ordered=[];this.dirty=false;this.error='';this.received=0;this.coverage=null;this.managed=false;this.bytes=0;}
}
