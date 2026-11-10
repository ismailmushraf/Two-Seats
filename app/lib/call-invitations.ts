export type CallParticipant={role:string;voice:boolean;voiceSession?:string|null;online:boolean};
/** A local call intent is also consent to a crossed invitation. Only one owner offer is needed. */
export function incomingCall(participants:CallParticipant[],role:string,localIntent:boolean,dismissed:ReadonlySet<string>){
 const peer=participants.find(person=>person.role!==role);
 return !localIntent&&peer?.online&&peer.voice&&peer.voiceSession&&!dismissed.has(peer.voiceSession)?peer.voiceSession:null;
}
export const CALL_RING_MS=60000;
