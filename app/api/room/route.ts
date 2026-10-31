import { env } from 'cloudflare:workers';
import { authenticatedUser } from '../../lib/session';
import { roomResponse } from '../../lib/room-response';
import { reactionPacket } from '../../lib/reactions';
export const dynamic = 'force-dynamic';
const relayCache=new Map<string,{expires:number;config:any}>();
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const validId=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
function fail(message:string,status=400):never {throw Object.assign(new Error(message),{status});}
export async function GET(req:Request){return handle(req,false)}
export async function POST(req:Request){return handle(req,true)}
async function handle(req:Request,write:boolean){try{
 const uid=authenticatedUser(req.headers)?.userId;if(!uid)return json({error:'Sign in to open your private cinema.'},401);
 const db=env.DB;if(!db)return json({error:'Room service is unavailable. Please try again shortly.'},503);
 const url=new URL(req.url);
 if(write){const origin=req.headers.get('origin');if(!origin||origin!==url.origin)return json({error:'Request origin was rejected.'},403);if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required.'},415);}
 let b:any={};if(write){const raw=await req.text();if(raw.length>24000)return json({error:'Request too large.'},413);try{b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))return json({error:'Invalid request.'},400)}catch{return json({error:'Invalid request.'},400)}}
 const now=Date.now();
 if(write&&b.action==='create'){
 await db.prepare('DELETE FROM events WHERE created < ?').bind(now-12*3600000).run();await db.prepare('DELETE FROM rooms WHERE expires < ?').bind(now).run();
 const count:any=await db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE owner=? AND expires>?').bind(uid,now).first();if(count.n>=3)fail('You already have three active rooms. Close one first.',429);
 const id=crypto.randomUUID().replaceAll('-',''),token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 await db.prepare('INSERT INTO rooms (id,token_hash,owner,updated,expires,owner_seen) VALUES (?,?,?,?,?,?)').bind(id,await hash(token),uid,now,now+12*3600000,now).run();return json({id,token});
 }
 const id=write?b.id:url.searchParams.get('id');if(!validId(id))fail('That room link is invalid.');
 let r:any=await db.prepare('SELECT * FROM rooms WHERE id=? AND expires>?').bind(id,now).first();if(!r)fail('This room has closed or expired.',404);
 if(write&&b.action==='join'&&uid!==r.owner&&uid!==r.guest){if(typeof b.token!=='string'||b.token.length!==64||await hash(b.token)!==r.token_hash)fail('The invite could not be verified.',403);await db.prepare('UPDATE rooms SET guest=?,guest_seen=?,state_version=state_version+1 WHERE id=? AND guest IS NULL').bind(uid,now,id).run();r=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();}
 const role=uid===r.owner?'owner':uid===r.guest?'guest':null;if(!role)fail('This room is private or already has two people.',403);
 if(write){
 const action=b.action;
 if(action==='close'){if(role!=='owner')fail('Only the room creator can close it.',403);await db.batch([db.prepare('DELETE FROM events WHERE room=?').bind(id),db.prepare('DELETE FROM rooms WHERE id=?').bind(id)]);return json({closed:true});}
 if(action==='media'){
 if(typeof b.media!=='string'||!/^\d{1,12}:[a-f0-9]{64}:\d{1,9}$/.test(b.media))fail('Choose a playable movie file.');
 await db.prepare(`UPDATE rooms SET ${role}_media=?,${role}_ready=0,playing=0,position=0,revision=revision+1,state_version=state_version+1,command='media',updated=? WHERE id=?`).bind(b.media,now,id).run();
 }else if(action==='ready'){
 if(!r[role+'_media'])fail('Choose a movie first.');await db.prepare(`UPDATE rooms SET ${role}_ready=1,state_version=state_version+1 WHERE id=?`).bind(id).run();
 }else if(action==='control'){
 if(!Number.isInteger(b.revision)||!Number.isFinite(b.position)||b.position<0||b.position>86400000||typeof b.playing!=='boolean')fail('Invalid playback command.');
 if(!r.owner_ready||!r.guest_ready||!r.owner_media||r.owner_media!==r.guest_media)fail('Both people must load the same movie and tap Ready.');
 const duration=Number(r.owner_media.split(':')[2]);if(b.position>duration+1000)fail('Playback position exceeds the movie length.');
 const command=b.command==='seek'?'seek':b.playing?'play':'pause';
 if(command==='pause'&&!r.playing&&r.command==='pause')return json(roomResponse(r,uid,[]));
 const out=await db.prepare('UPDATE rooms SET playing=?,position=?,updated=?,command=?,revision=revision+1,state_version=state_version+1 WHERE id=? AND revision=?').bind(b.playing?1:0,Math.round(b.position),now,command,id,b.revision).run();if(!out.meta.changes)return json({error:'Playback changed. Try again.'},409);
 }else if(action==='voice-config'){
 const base=[{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'}];
 if(!env.TURN_KEY_ID||!env.TURN_KEY_API_TOKEN)return json({iceServers:base,relayConfigured:false});
 const cacheKey=id+':'+uid;const cached=relayCache.get(cacheKey);if(cached&&cached.expires>now)return json(cached.config);
 const recent:any=await db.prepare("SELECT COUNT(*) AS n FROM events WHERE room=? AND sender=? AND type='relay-config' AND created>?").bind(id,uid,now-60000).first();
 if(recent.n>=4)fail('Please wait a minute before retrying voice.',429);
 await db.prepare('INSERT INTO events(room,sender,type,payload,created) VALUES (?,?,?,?,?)').bind(id,uid,'relay-config','null',now).run();
 const response=await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/'+encodeURIComponent(env.TURN_KEY_ID.trim())+'/credentials/generate-ice-servers',{method:'POST',headers:{Authorization:'Bearer '+env.TURN_KEY_API_TOKEN.trim(),'Content-Type':'application/json'},body:JSON.stringify({ttl:14400}),signal:AbortSignal.timeout(10000)});
 if(!response.ok){console.warn('voice_relay_error',{providerStatus:response.status});fail(response.status===401||response.status===403?'The relay credentials were rejected. Check the TURN key settings.':'The voice relay is unavailable. Please retry later.',503);}
 const config:any=await response.json();
 if(!Array.isArray(config.iceServers)||!config.iceServers.some((s:any)=>[].concat(s.urls||[]).some((u:any)=>typeof u==='string'&&/^turns?:/.test(u))))fail('The voice relay returned an invalid configuration.',503);
 const result={iceServers:config.iceServers,relayConfigured:true,expiresAt:now+14400000};relayCache.set(cacheKey,{expires:now+13800000,config:result});if(relayCache.size>100)relayCache.delete(relayCache.keys().next().value!);return json(result);
 }else if(action==='diagnostic'){
 const codes=['mic_context','mic_denied','mic_missing','mic_busy','mic_stopped','mic_allowed','relay_ready','relay_failed','rtc_failed','rtc_connected','audio_blocked','waiting_peer'];if(!codes.includes(b.code))fail('Invalid diagnostic code.');
 console.info('voice_diagnostic',{role,code:b.code});return json({ok:true});
 }else if(action==='voice'){
 if(typeof b.enabled!=='boolean')fail('Invalid voice state.');
 const session=b.session;if(session!=null&&!validId(session))fail('Invalid voice session.');
 if(b.enabled){await db.prepare(`UPDATE rooms SET ${role}_voice=1,${role}_voice_session=?,state_version=state_version+1 WHERE id=?`).bind(session||crypto.randomUUID().replaceAll('-',''),id).run();}
 else if(!session||session===r[role+'_voice_session']){
 const peer=role==='owner'?'guest':'owner';
 await db.batch([db.prepare('INSERT INTO events(room,sender,type,payload,created) VALUES (?,?,?,?,?)').bind(id,uid,'hangup',JSON.stringify({fromSession:r[role+'_voice_session'],toSession:r[peer+'_voice_session'],data:null}),now),db.prepare(`UPDATE rooms SET ${role}_voice=0,${role}_voice_session=NULL,state_version=state_version+1 WHERE id=?`).bind(id)]);
 }
 }else if(action==='event'){
 if(!['offer','answer','ice','hangup','reaction','buffer'].includes(b.type))fail('Unknown room event.');
 const payload=JSON.stringify(b.payload);if(!payload||payload.length>18000)fail('Event too large.');
 if(b.type==='reaction'&&!['❤️','😂','😱','🥹','👏','😘'].includes(b.payload)&&!reactionPacket(b.payload))fail('Unknown reaction.');
 if(b.type==='buffer'&&typeof b.payload!=='boolean'&&(!Number.isFinite(b.payload?.position)||b.payload.position<0||b.payload.position>86400000))fail('Invalid buffering state.');
 if(['offer','answer','ice'].includes(b.type)){
 const peer=role==='owner'?'guest':'owner';
 if(!r[role+'_voice']||!r[peer+'_voice']||b.payload?.fromSession!==r[role+'_voice_session']||b.payload?.toSession!==r[peer+'_voice_session'])fail('Voice session changed. Retry the connection.',409);
 if(['offer','answer'].includes(b.type)&&(b.payload.data?.type!==b.type||typeof b.payload.data?.sdp!=='string'))fail('Invalid voice handshake.');
 }
 const category=b.type==='reaction'?'reaction':'signal';const query=category==='reaction'?"SELECT COUNT(*) AS n FROM events WHERE room=? AND sender=? AND type='reaction' AND created>?":"SELECT COUNT(*) AS n FROM events WHERE room=? AND sender=? AND type!='reaction' AND created>?";
 const recent:any=await db.prepare(query).bind(id,uid,now-60000).first();if(recent.n>=(category==='reaction'?120:600))fail('Too many events. Try again in a moment.',429);
 await db.prepare('INSERT INTO events(room,sender,type,payload,created) VALUES (?,?,?,?,?)').bind(id,uid,b.type,payload,now).run();
 if(b.type==='buffer'&&b.payload!==false&&r.playing){const pos=Math.min(Number(r.owner_media?.split(':')[2])||86400000,typeof b.payload==='object'?Math.round(b.payload.position):r.position+now-r.updated);await db.prepare("UPDATE rooms SET playing=0,position=?,updated=?,command='buffer',revision=revision+1,state_version=state_version+1 WHERE id=? AND revision=?").bind(pos,now,id,r.revision).run();}
 }else if(action!=='join')fail('Unknown room action.');
 }
 await db.prepare(`UPDATE rooms SET ${role}_seen=? WHERE id=?`).bind(now,id).run();
 r=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();if(!r)fail('Room closed.',404);
 const after=Number(url.searchParams.get('after')||b.after||0);if(!Number.isSafeInteger(after)||after<0)fail('Invalid event cursor.');
 const ev=await db.prepare('SELECT id,sender,type,payload,created FROM events WHERE room=? AND id>? AND created>? ORDER BY id LIMIT 200').bind(id,after,now-120000).all();
 return json(roomResponse(r,uid,ev.results as any[]));
 }catch(e:any){return json({error:e.status?e.message:'Something went wrong. Please retry.'},e.status||500)}}
