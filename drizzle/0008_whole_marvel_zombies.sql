CREATE TABLE `xstats_account_statuses` (
	`session_id` text NOT NULL,
	`account_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xstats_account_statuses_session_account_uq` ON `xstats_account_statuses` (`session_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `xstats_account_statuses_session_status_idx` ON `xstats_account_statuses` (`session_id`,`status`);