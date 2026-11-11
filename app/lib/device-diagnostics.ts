import {normalizeDiagnostic,type DiagnosticRecord} from './diagnostics';
type Pending={room:string;record:DiagnosticRecord};
export class DeviceDiagnostics{
 private scope='';private room='';private queue:Pending[]=[];private busy=false;private next=0;private last=new Map<string,number>();
 context(scope:string,room:string){if(scope!==this.scope){this.scope=scope;try{const stored=JSON.parse(localStorage.getItem('two-seats-reports:'+scope)||'[]');this.queue=Array.isArray(stored)?stored.slice(-100).filter(item=>/^[a-f0-9]{32}$/.test(item.room)&&normalizeDiagnostic(item.record)):[]}catch{this.queue=[]}}this.room=room}
 private persist(){try{localStorage.setItem('two-seats-reports:'+this.scope,JSON.stringify(this.queue.slice(-100)))}catch{}}
 add(code:string,details:Record<string,unknown>={}){if(!this.scope||!this.room)return;const record=normalizeDiagnostic({code,details:{...details,observedAt:Date.now()}}),now=Date.now();if(!record||now-(this.last.get(code)||0)<1000)return;this.last.set(code,now);this.queue.push({room:this.room,record});this.queue=this.queue.slice(-100);this.persist()}
 async flush(){if(this.busy||!this.queue.length||Date.now()<this.next||navigator.onLine===false)return;this.busy=true;const room=this.queue[0].room,batch=this.queue.filter(item=>item.room===room).slice(0,20);try{const response=await fetch('/api/diagnostics',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({room,records:batch.map(item=>item.record)}),signal:AbortSignal.timeout(12000)});if(response.ok||[403,404].includes(response.status)){this.queue=this.queue.filter(item=>!batch.includes(item));this.persist()}if(response.status===429)this.next=Date.now()+60000}catch{this.next=Date.now()+5000}finally{this.busy=false}}
}
export async function peerHealth(peer:RTCPeerConnection|null){
 const details:Record<string,unknown>={};if(!peer)return details;
 details.connection=peer.connectionState;details.ice=peer.iceConnectionState;
 try{const stats=await peer.getStats();let pair:any,remote:any;stats.forEach((report:any)=>{if(report.type==='transport'&&report.selectedCandidatePairId)pair=stats.get(report.selectedCandidatePairId);if(!pair&&report.type==='candidate-pair'&&report.state==='succeeded'&&report.nominated)pair=report;if(report.type==='inbound-rtp'&&(report.kind==='audio'||report.mediaType==='audio')){details.packetsLost=Math.max(0,report.packetsLost||0);details.jitter=report.jitter;details.bytesReceived=report.bytesReceived}});if(pair){remote=stats.get(pair.remoteCandidateId);details.candidate=remote?.candidateType||'unknown';details.rtt=pair.currentRoundTripTime}}
 catch{/* A closing peer may no longer expose stats. */}return details;
}
