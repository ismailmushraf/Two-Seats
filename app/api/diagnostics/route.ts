import {env} from 'cloudflare:workers';
import {authenticatedUser} from '../../lib/session';
import {diagnosticOwner,normalizeDiagnostic} from '../../lib/diagnostics';
export const dynamic='force-dynamic';
const reply=(value:any,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){
 const user=authenticatedUser(request.headers);if(!user)return reply({error:'Sign in required.'},401);
 if(!diagnosticOwner(user.email,env.DIAGNOSTICS_OWNER_EMAIL))return reply({error:'Only the site owner can view diagnostics.'},403);
 if(!env.DB)return reply({error:'Diagnostics unavailable.'},503);
 const url=new URL(request.url),before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)return reply({error:'Invalid cursor.'},400);
 const rows=await env.DB.prepare('SELECT id,room,role,code,details,created FROM diagnostics WHERE id<? AND created>? ORDER BY id DESC LIMIT 100').bind(before,Date.now()-14*86400000).all();
 return reply({records:rows.results.map((row:any)=>({...row,details:JSON.parse(row.details)})),retentionDays:14});
}
export async function POST(request:Request){try{
 const user=authenticatedUser(request.headers);if(!user)return reply({error:'Sign in required.'},401);
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'Origin rejected.'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'JSON required.'},415);
 const text=await request.text();if(text.length>24000)return reply({error:'Report too large.'},413);
 let body:any;try{body=JSON.parse(text)}catch{return reply({error:'Invalid report.'},400)}
 if(!body||typeof body!=='object'||!/^[a-f0-9]{32}$/.test(body.room)||!Array.isArray(body.records)||!body.records.length||body.records.length>20)return reply({error:'Invalid report.'},400);
 const db=env.DB;if(!db)return reply({error:'Diagnostics unavailable.'},503);const now=Date.now();
 const room:any=await db.prepare('SELECT owner,guest FROM rooms WHERE id=?').bind(body.room).first();
 if(!room||user.userId!==room.owner&&user.userId!==room.guest)return reply({error:'Room membership required.'},403);
 const role=user.userId===room.owner?'owner':'guest';const records=body.records.map(normalizeDiagnostic);if(records.some((r:any)=>!r))return reply({error:'Unknown diagnostic code.'},400);
 const recent:any=await db.prepare('SELECT COUNT(*) AS n FROM diagnostics WHERE room=? AND role=? AND created>?').bind(body.room,role,now-60000).first();if(recent.n+records.length>60)return reply({error:'Reports are temporarily rate limited.'},429);
 await db.batch([...records.map((record:any)=>db.prepare('INSERT INTO diagnostics(room,role,code,details,created) VALUES (?,?,?,?,?)').bind(body.room,role,record.code,JSON.stringify(record.details),now)),db.prepare('DELETE FROM diagnostics WHERE created<?').bind(now-14*86400000),db.prepare('DELETE FROM diagnostics WHERE id IN (SELECT id FROM diagnostics ORDER BY id DESC LIMIT -1 OFFSET 5000)')]);
 return reply({saved:records.length});
 }catch{return reply({error:'Could not save diagnostics.'},500)}}
