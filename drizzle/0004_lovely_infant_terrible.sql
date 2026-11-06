CREATE TABLE `xstats_daily_history` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`date` text NOT NULL,
	`account_id` text NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`followers` integer,
	`following` integer,
	`posts` integer,
	`fetched_at` text NOT NULL,
	`origin` text DEFAULT 'migration' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `xstats_daily_history_session_date_idx` ON `xstats_daily_history` (`session_id`,`date`);--> statement-breakpoint
CREATE INDEX `xstats_daily_history_session_account_idx` ON `xstats_daily_history` (`session_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `xstats_daily_history_session_account_date_uq` ON `xstats_daily_history` (`session_id`,`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `xstats_daily_history_meta` (
	`session_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`backfilled` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
