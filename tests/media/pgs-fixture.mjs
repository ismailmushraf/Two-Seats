import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const concat=(...items)=>new Uint8Array(Buffer.concat(items.map(item=>Buffer.from(item))));
const be16=n=>new Uint8Array([n>>8,n&255]),be24=n=>new Uint8Array([n>>16,(n>>8)&255,n&255]);
const segment=(type,data)=>concat([type],be16(data.length),data);
const letters={P:['11110','10001','10001','11110','10000','10000','10000'],G:['01110','10001','10000','10111','10001','10001','01110'],S:['01111','10000','10000','01110','00001','00001','11110'],W:['10001','10001','10001','10101','10101','10101','01010'],O:['01110','10001','10001','10001','10001','10001','01110'],R:['11110','10001','10001','11110','10100','10010','10001'],K:['10001','10010','10100','11000','10100','10010','10001'],' ':Array(7).fill('00000')};
function bitmap(){const text='PGS WORKS',scale=3,width=text.length*6*scale+2,height=7*scale+2,pixels=new Uint8Array(width*height);for(let c=0;c<text.length;c++)for(let y=0;y<7;y++)for(let x=0;x<5;x++)if(letters[text[c]][y][x]==='1')for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++)pixels[(1+y*scale+yy)*width+1+c*6*scale+x*scale+xx]=2;const outline=pixels.slice();for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)if(pixels[y*width+x])for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)if(!outline[(y+yy)*width+x+xx])outline[(y+yy)*width+x+xx]=1;return {width,height,pixels:outline};}
export function encodeRle(pixels,width,height){const bytes=[];for(let y=0;y<height;y++){for(let x=0;x<width;){const color=pixels[y*width+x];let run=1;while(x+run<width&&pixels[y*width+x+run]===color&&run<16383)run++;if(color&&run<3){for(let i=0;i<run;i++)bytes.push(color)}else{bytes.push(0,(run>=64?64:0)|(color?128:0)|(run>=64?run>>8:run));if(run>=64)bytes.push(run&255);if(color)bytes.push(color)}x+=run;}bytes.push(0,0);}return new Uint8Array(bytes);}
export function pgsFixture(){
 const image=bitmap(),rle=encodeRle(image.pixels,image.width,image.height),packets=[];let number=0;
 const put=(time,type,data)=>packets.push({time,data:segment(type,data)});
 const pcs=(time,refs,state=0x80)=>{
  const objects=refs.map(ref=>{const crop=ref.crop?[be16(ref.crop.x),be16(ref.crop.y),be16(ref.crop.width),be16(ref.crop.height)]:[];return concat(be16(1),[0,ref.crop?0x80:0],be16(ref.x),be16(ref.y),...crop)});
  put(time,0x16,concat(be16(320),be16(180),[0x10],be16(number++),[state,0,0,refs.length],...objects));
 };
 const palette=(time,green=false)=>put(time,0x14,new Uint8Array([0,green?1:0,0,16,128,128,0,1,16,128,128,255,2,green?145:235,green?34:128,green?54:128,255]));
 const object=(time,split=false)=>{const header=concat(be16(1),[0,split?0x80:0xc0],be24(rle.length+4),be16(image.width),be16(image.height));if(split){const half=Math.floor(rle.length/2);put(time,0x15,concat(header,rle.slice(0,half)));put(time,0x15,concat(be16(1),[0,0x40],rle.slice(half)))}else put(time,0x15,concat(header,rle));};
 const window=time=>put(time,0x17,concat([1,0],be16(0),be16(0),be16(320),be16(180))),end=time=>put(time,0x80,new Uint8Array()),clear=time=>{pcs(time,[],0);end(time)};
 pcs(1,[{x:78,y:110}]);window(1);palette(1);object(1);end(1);clear(4);
 pcs(8,[{x:78,y:110}]);window(8);palette(8);object(8,true);end(8);
 pcs(10,[{x:78,y:110}],0);palette(10,true);end(10);clear(12);
 pcs(16,[{x:20,y:80},{x:130,y:130}]);window(16);palette(16);object(16);end(16);clear(21);
 pcs(24,[{x:100,y:110,crop:{x:2,y:2,width:80,height:15}}]);window(24);palette(24);object(24);end(24);clear(27);
 return {packets,image,rle};
}
export function supBytes(packets){return concat(...packets.map(packet=>{const timestamp=Math.round(packet.time*90000),stamp=new Uint8Array(4);new DataView(stamp.buffer).setUint32(0,timestamp);return concat([0x50,0x47],stamp,stamp,packet.data)}));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)writeFileSync(process.argv[2],supBytes(pgsFixture().packets));
