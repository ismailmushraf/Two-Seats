CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room` text NOT NULL,
	`sender` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`room`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_room_idx` ON `events` (`room`,`id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`owner` text NOT NULL,
	`guest` text,
	`owner_media` text,
	`guest_media` text,
	`owner_ready` integer DEFAULT 0 NOT NULL,
	`guest_ready` integer DEFAULT 0 NOT NULL,
	`owner_voice` integer DEFAULT 0 NOT NULL,
	`guest_voice` integer DEFAULT 0 NOT NULL,
	`owner_seen` integer DEFAULT 0 NOT NULL,
	`guest_seen` integer DEFAULT 0 NOT NULL,
	`playing` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_owner_idx` ON `rooms` (`owner`);--> statement-breakpoint
CREATE INDEX `rooms_expiry_idx` ON `rooms` (`expires`);