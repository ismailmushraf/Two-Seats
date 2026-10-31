'use client';
import {useEffect,useRef,useState} from 'react';
import Cinema from '../../app/page';
export default function AuthQA(){
 const [ready,setReady]=useState(false),mode=useRef('good'),failures=useRef(0);
 useEffect(()=>{
  const original=window.fetch,saved=sessionStorage.getItem('two-seats-room');sessionStorage.setItem('two-seats-room',JSON.stringify({id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}));
  window.fetch=async(input,options)=>{
   const path=String(input);
   if(path.startsWith('/api/session')){
    if(mode.current==='expired'||mode.current==='transient'&&failures.current++===0)return new Response('<!DOCTYPE html><a href="/signin-with-chatgpt">Continue with ChatGPT</a>',{headers:{'Content-Type':'text/html'}});
    return Response.json({authenticated:true,user:{email:'test@example.invalid',displayName:'QA viewer'},roomService:{available:true}});
   }
   if(path.startsWith('/api/room'))return Response.json({id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',role:'guest',stateVersion:1,serverNow:Date.now(),expires:Date.now()+3600000,playing:false,position:5000,revision:1,updated:Date.now(),command:'pause',match:true,participants:[{role:'owner',present:true,online:true,ready:true,loaded:true,voice:false},{role:'guest',present:true,online:true,ready:true,loaded:true,voice:false}],events:[]});
   return original(input,options);
  };
  setReady(true);return()=>{window.fetch=original;if(saved)sessionStorage.setItem('two-seats-room',saved);else sessionStorage.removeItem('two-seats-room')};
 },[]);
 function simulate(next:string){mode.current=next;failures.current=0;document.dispatchEvent(new Event('visibilitychange'));}
 return <><div style={{padding:16}}><strong>Local session-response QA</strong><button onClick={()=>simulate('transient')}>Simulate one HTML login response</button><button onClick={()=>simulate('expired')}>Simulate persistent expired login</button><button onClick={()=>simulate('good')}>Restore valid session</button></div>{ready&&<Cinema/>}</>;
}
