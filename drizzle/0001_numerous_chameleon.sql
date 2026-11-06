CREATE TABLE `xstats_schedules` (
	`session_id` text PRIMARY KEY NOT NULL,
	`hours` text DEFAULT '0,6,12,18' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `xstats_watchlist` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`handle` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `xstats_watchlist_session_idx` ON `xstats_watchlist` (`session_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `xstats_watchlist_session_handle_uq` ON `xstats_watchlist` (`session_id`,`handle`);