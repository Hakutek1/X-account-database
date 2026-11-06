CREATE TABLE `xstats_historical_account_exclusions` (
	`session_id` text NOT NULL,
	`account_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xstats_historical_account_exclusions_session_account_uq` ON `xstats_historical_account_exclusions` (`session_id`,`account_id`);