CREATE TABLE `app_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `deliveries` ADD `operador` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `tiene_ine` integer DEFAULT 0 NOT NULL;