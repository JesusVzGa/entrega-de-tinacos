CREATE TABLE `delivery_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`resetting` integer DEFAULT 0 NOT NULL,
	`job` text DEFAULT '' NOT NULL
);

--> statement-breakpoint
INSERT INTO delivery_state (id, generation, resetting, job) VALUES (1, 0, 0, '');
