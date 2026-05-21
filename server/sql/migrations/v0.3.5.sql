-- Ubuntu 3.0 — v0.3.5 schema migration
-- Participants become Users.
--
-- Every participant must also have a `users` row (role='trainee'). This
-- unifies the directory so the same person can be picked from a single
-- list when enrolling them in a new course.
--
-- Walk-in trainees never log in: their password_hash is set to a placeholder
-- that no password_verify() call will ever match.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.5.sql

-- 1) Extend role ENUM with 'trainee'
ALTER TABLE users
  MODIFY COLUMN role ENUM('trainer','admin','trainee') NOT NULL DEFAULT 'trainer';

-- 2) Add user_id FK on participants (nullable while we backfill)
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS user_id CHAR(36) NULL AFTER id,
  ADD KEY IF NOT EXISTS idx_participants_user (user_id);

-- 3) Backfill: create a `users` row for every alive participant that doesn't
--    already have one. Synthetic email keyed by participant.id guarantees
--    uniqueness; real emails (if any) live on the participant.contact field
--    and can be promoted later via the admin UI.
INSERT INTO users
  (id, email, username, password_hash, name, first_name, last_name, role, language, must_change_password, created_at, updated_at)
SELECT
  UUID() AS id,
  CONCAT('trainee-', p.id, '@ubuntu3.local') AS email,
  CONCAT('trainee-', p.id, '@ubuntu3.local') AS username,
  '!' AS password_hash,                                  -- intentionally invalid; password_verify() will always return false
  TRIM(CONCAT(COALESCE(p.first_name,''), ' ', COALESCE(p.last_name,''))) AS name,
  COALESCE(p.first_name, 'Unknown') AS first_name,
  COALESCE(p.last_name, '') AS last_name,
  'trainee' AS role,
  'fr' AS language,
  0 AS must_change_password,
  NOW() AS created_at,
  NOW() AS updated_at
FROM participants p
WHERE p.deleted_at IS NULL
  AND p.user_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = CONCAT('trainee-', p.id, '@ubuntu3.local')
  );

-- 4) Link participants to the user we just created
UPDATE participants p
INNER JOIN users u ON u.email = CONCAT('trainee-', p.id, '@ubuntu3.local')
SET p.user_id = u.id
WHERE p.user_id IS NULL;

-- 5) Soft-deleted participants without a user stay user_id=NULL (no record
--    needed for tombstones). All alive participants now have user_id set.
--    We leave the column nullable for now to keep the migration reversible.
