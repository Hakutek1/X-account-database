CREATE TABLE `xstats_account_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`account_id` text NOT NULL,
	`avatar_key` text NOT NULL,
	`avatar_url` text NOT NULL,
	`content_type` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `xstats_account_assets_session_account_idx` ON `xstats_account_assets` (`session_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `xstats_account_assets_session_account_uq` ON `xstats_account_assets` (`session_id`,`account_id`);