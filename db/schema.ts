import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', {
 id: text('id').primaryKey(), tokenHash: text('token_hash').notNull(), owner: text('owner').notNull(), guest: text('guest'),
 ownerMedia: text('owner_media'), guestMedia: text('guest_media'), ownerReady: integer('owner_ready').notNull().default(0), guestReady: integer('guest_ready').notNull().default(0),
 ownerVoice: integer('owner_voice').notNull().default(0), guestVoice: integer('guest_voice').notNull().default(0),
 stateVersion: integer('state_version').notNull().default(0), command: text('command'), ownerVoiceSession: text('owner_voice_session'), guestVoiceSession: text('guest_voice_session'),
 ownerSeen: integer('owner_seen').notNull().default(0), guestSeen: integer('guest_seen').notNull().default(0),
 playing: integer('playing').notNull().default(0), position: integer('position').notNull().default(0), revision: integer('revision').notNull().default(0), updated: integer('updated').notNull(), expires: integer('expires').notNull(),
}, t=>[index('rooms_owner_idx').on(t.owner),index('rooms_expiry_idx').on(t.expires)]);
export const events = sqliteTable('events', {
 id: integer('id').primaryKey({autoIncrement:true}), room: text('room').notNull().references(()=>rooms.id,{onDelete:'cascade'}), sender:text('sender').notNull(), type:text('type').notNull(), payload:text('payload').notNull(), created:integer('created').notNull(),
},t=>[index('events_room_idx').on(t.room,t.id)]);
