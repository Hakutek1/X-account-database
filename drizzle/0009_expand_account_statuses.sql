CREATE TABLE `xstats_account_statuses_new` (
	`session_id` text NOT NULL,
	`account_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'ended', 'suspended', 'non_alt')),
	`updated_at` text NOT NULL,
	PRIMARY KEY (`session_id`, `account_id`),
	FOREIGN KEY (`session_id`) REFERENCES `xstats_sessions`(`id`)
);
--> statement-breakpoint
INSERT INTO `xstats_account_statuses_new` (`session_id`, `account_id`, `status`, `updated_at`)
SELECT `session_id`, `account_id`,
	CASE WHEN `status` IN ('active', 'ended', 'suspended', 'non_alt') THEN `status` ELSE 'active' END,
	`updated_at`
FROM `xstats_account_statuses`;
--> statement-breakpoint
DROP INDEX IF EXISTS `xstats_account_statuses_session_account_uq`;
--> statement-breakpoint
DROP INDEX IF EXISTS `xstats_account_statuses_session_status_idx`;
--> statement-breakpoint
DROP TABLE `xstats_account_statuses`;
--> statement-breakpoint
ALTER TABLE `xstats_account_statuses_new` RENAME TO `xstats_account_statuses`;
--> statement-breakpoint
CREATE UNIQUE INDEX `xstats_account_statuses_session_account_uq` ON `xstats_account_statuses` (`session_id`, `account_id`);
--> statement-breakpoint
CREATE INDEX `xstats_account_statuses_session_status_idx` ON `xstats_account_statuses` (`session_id`, `status`);
