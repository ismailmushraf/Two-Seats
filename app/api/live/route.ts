import { env } from 'cloudflare:workers';
import { authenticatedUser } from '../../lib/session';
import { roomResponse } from '../../lib/room-response';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const uid=authenticatedUser(request.headers)?.userId;
 if(!uid)return Response.json({error:'Sign in required.'},{status:401});
 if(!env.DB)return Response.json({error:'Room service unavailable.'},{status:503});
 const url=new URL(request.url),id=url.searchParams.get('id');
 if(!id||!/^[a-f0-9]{32}$/.test(id))return Response.json({error:'Invalid room.'},{status:400});
 let after=Math.max(Number(url.searchParams.get('after')||0),Number(request.headers.get('last-event-id')||0));
 if(!Number.isSafeInteger(after)||after<0)return Response.json({error:'Invalid event cursor.'},{status:400});
 const db=env.DB;
 const first:any=await db.prepare('SELECT * FROM rooms WHERE id=? AND expires>?').bind(id,Date.now()).first();
 if(!first)return Response.json({error:'Room closed.'},{status:404});
 if(uid!==first.owner&&uid!==first.guest)return Response.json({error:'Private room.'},{status:403});
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,lastState='',controller:ReadableStreamDefaultController<Uint8Array>;
 const encoder=new TextEncoder(),started=Date.now();
 const stop=()=>{stopped=true;if(timer)clearTimeout(timer);request.signal.removeEventListener('abort',stop);try{controller?.close()}catch{}};
 const stream=new ReadableStream<Uint8Array>({start(c){controller=c;request.signal.addEventListener('abort',stop,{once:true});c.enqueue(encoder.encode(': private room live stream\nretry: 1000\n\n'));
 const pump=async()=>{if(stopped)return;try{
 if(Date.now()-started>55000){stop();return}
 const r:any=await db.prepare('SELECT * FROM rooms WHERE id=? AND expires>?').bind(id,Date.now()).first();
 if(!r||(uid!==r.owner&&uid!==r.guest)){c.enqueue(encoder.encode('event: room-closed\ndata: {}\n\n'));stop();return}
 const rows=await db.prepare('SELECT id,sender,type,payload,created FROM events WHERE room=? AND id>? AND created>? ORDER BY id LIMIT 200').bind(id,after,Date.now()-120000).all();
 const state=String(r.state_version);
 if(rows.results.length||state!==lastState){
 const payload=roomResponse(r,uid,rows.results as any[]);
 if(rows.results.length)after=Number((rows.results.at(-1) as any).id);
 c.enqueue(encoder.encode(`id: ${after}\ndata: ${JSON.stringify(payload)}\n\n`));lastState=state;
 }else c.enqueue(encoder.encode(': heartbeat\n\n'));
 }catch{stop();return}if(!stopped)timer=setTimeout(pump,250)};
 void pump();},cancel(){stop()}});
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}
