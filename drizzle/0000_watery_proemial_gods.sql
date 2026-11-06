CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`mesa` text NOT NULL,
	`numero` integer NOT NULL,
	`nombre` text NOT NULL,
	`direccion` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`precision` real NOT NULL,
	`fecha` text NOT NULL,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mesa_numero_unique` ON `deliveries` (`mesa`,`numero`);