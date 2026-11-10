-- Schema compatibility is handled by ensureSchema on write operations.
-- Some Sites-managed databases already have this column despite this migration
-- being pending, so keep this migration idempotent and avoid duplicate ALTERs.
SELECT 1;
