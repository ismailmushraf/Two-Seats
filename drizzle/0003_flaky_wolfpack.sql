CREATE TABLE `diagnostics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room` text NOT NULL,
	`role` text NOT NULL,
	`code` text NOT NULL,
	`details` text NOT NULL,
	`created` integer NOT NULL
);
