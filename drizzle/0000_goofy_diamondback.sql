CREATE TABLE `xstats_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`fetched_at` text NOT NULL,
	`source_summary` text NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `xstats_runs_session_idx` ON `xstats_runs` (`session_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `xstats_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `xstats_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`session_id` text NOT NULL,
	`account_id` text NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`followers` integer,
	`following` integer,
	`posts` integer,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `xstats_snapshots_session_idx` ON `xstats_snapshots` (`session_id`,`fetched_at`);