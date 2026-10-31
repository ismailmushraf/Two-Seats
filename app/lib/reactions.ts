export const reactionEmojis=['❤️','😂','😱','🥹','👏','😘'];
export type ReactionPacket={id:string;emoji:string};
export function reactionPacket(value:unknown):ReactionPacket|null {
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>;
 return typeof v.id==='string'&&/^[a-f0-9]{32}$/.test(v.id)&&typeof v.emoji==='string'&&reactionEmojis.includes(v.emoji)?{id:v.id,emoji:v.emoji}:null;
}
export class ReactionInbox {
 private seen=new Set<string>();
 accept(value:unknown){const packet=reactionPacket(value);if(!packet||this.seen.has(packet.id))return null;this.seen.add(packet.id);if(this.seen.size>1000)this.seen.delete(this.seen.values().next().value!);return packet}
}
