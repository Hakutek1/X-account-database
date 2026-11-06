CREATE TABLE `xstats_import_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`import_id` text NOT NULL,
	`issue_type` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_name` text NOT NULL,
	`account_id` text,
	`handle` text,
	`display_name` text,
	`date` text,
	`metric` text,
	`source_value` integer,
	`site_value` integer,
	`details` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `xstats_import_issues_session_idx` ON `xstats_import_issues` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `xstats_import_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_name` text NOT NULL,
	`source_key` text NOT NULL,
	`account_id` text NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `xstats_import_mappings_session_idx` ON `xstats_import_mappings` (`session_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `xstats_import_mappings_session_source_uq` ON `xstats_import_mappings` (`session_id`,`source_key`);