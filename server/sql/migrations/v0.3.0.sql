-- Ubuntu 3.0 — migration to v0.3.0
-- Adds the Ubuntu eLearning ↔ Ubuntu 3.0 user linkage column.
-- Idempotent: safe to run more than once.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS moodle_user_id INT NULL AFTER must_change_password,
  ADD UNIQUE KEY IF NOT EXISTS uniq_users_moodle_user (moodle_user_id);
