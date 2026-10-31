'use client';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {decodePgsRle,type PgsFrame} from '../lib/pgs';
/** Render in the page so captions don't depend on native Safari/MSE cue painting. */
export function SubtitleOverlay({video,read,readBitmap}:{video:RefObject<HTMLVideoElement|null>;read:(time:number)=>string;readBitmap?:(time:number)=>PgsFrame|null}){
 const latest=useRef({read,readBitmap});latest.current={read,readBitmap};const [text,setText]=useState(''),canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const scratch=document.createElement('canvas');let painted='';
  const update=()=>{
   const v=video.current;setText(v?.src?latest.current.read(v.currentTime):'');
   const layer=canvas.current;if(!layer||!v)return;const frame=v.src?latest.current.readBitmap?.(v.currentTime):null;
   if(!frame){layer.hidden=true;painted='';return}
   const width=v.clientWidth,height=v.clientHeight,key=`${frame.id}:${width}:${height}`;
   if(!width||!height||key===painted)return;
   try{
    const ratio=Math.min(devicePixelRatio||1,2,1280/width);layer.width=Math.max(1,Math.round(width*ratio));layer.height=Math.max(1,Math.round(height*ratio));
    const context=layer.getContext('2d'),image=scratch.getContext('2d');if(!context||!image)return;
    context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,width,height);
    const scale=Math.min(width/(v.videoWidth||frame.width),height/(v.videoHeight||frame.height));
    const areaWidth=(v.videoWidth||frame.width)*scale,areaHeight=(v.videoHeight||frame.height)*scale,left=(width-areaWidth)/2,top=(height-areaHeight)/2,sx=areaWidth/frame.width,sy=areaHeight/frame.height;
    const controls=v.parentElement?.querySelector('.player-bottom')?.getBoundingClientRect().height||0;
    const bottom=height-controls-8,lastBottom=Math.max(...frame.parts.map(part=>top+(part.y+part.crop.height)*sy)),shift=Math.max(0,lastBottom-bottom);
    for(const part of frame.parts){
     const rgba=decodePgsRle(part.rle,part.width,part.height,part.palette);scratch.width=part.width;scratch.height=part.height;
     image.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>,part.width,part.height),0,0);
     context.drawImage(scratch,part.crop.x,part.crop.y,part.crop.width,part.crop.height,left+part.x*sx,Math.max(0,top+part.y*sy-shift),part.crop.width*sx,part.crop.height*sy);
    }
    layer.hidden=false;painted=key;
   }catch{layer.hidden=true;painted='';}
  };
  const timer=setInterval(update,80),v=video.current;
  for(const event of ['timeupdate','seeked','loadedmetadata','emptied'])v?.addEventListener(event,update);
  update();return()=>{clearInterval(timer);for(const event of ['timeupdate','seeked','loadedmetadata','emptied'])v?.removeEventListener(event,update)};
 },[video]);
 return <><canvas ref={canvas} hidden className="pgs-subtitle-overlay" data-testid="pgs-subtitle-overlay" aria-hidden="true"/>{text&&<div className="subtitle-overlay" data-testid="subtitle-overlay" dir="auto"><span>{text}</span></div>}</>;
}
