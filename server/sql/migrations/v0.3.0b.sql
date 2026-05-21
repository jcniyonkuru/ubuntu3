-- Ubuntu 3.0 — migration to v0.3.0b
-- Adds a separate `username` column so login no longer has to be an email.
-- Existing users are backfilled with username = email so they keep signing in.
-- Idempotent.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username VARCHAR(120) NULL AFTER email,
  ADD UNIQUE KEY IF NOT EXISTS uniq_users_username (username);

UPDATE users SET username = email WHERE username IS NULL OR username = '';

ALTER TABLE users MODIFY username VARCHAR(120) NOT NULL;
