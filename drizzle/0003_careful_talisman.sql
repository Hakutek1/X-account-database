CREATE TABLE `xstats_microsoft_tokens` (
	`session_id` text PRIMARY KEY NOT NULL,
	`microsoft_user_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` text NOT NULL
);
