-- Ubuntu 3.0 — v0.3.5g — one-off dedup of trainee users
--
-- The v0.3.5 migration created one users row per existing participant. If
-- the same person had multiple participant rows (across courses or repeated
-- enrolments), they ended up with multiple synthetic users:
--   trainee-<uuid-1>@ubuntu3.local
--   trainee-<uuid-2>@ubuntu3.local
--   ...
-- and Moodle-synced rows similarly:
--   moodle-<moodle_user_id>@ubuntu3.local
--
-- This script groups synthetic trainees by (lowercased first_name,
-- lowercased last_name, COALESCE(phone, '')) — keeps the OLDEST as the
-- canonical user, repoints all participant references at the canonical id,
-- and DISABLES the duplicates (sets disabled_at) so they disappear from the
-- admin tables but stay in the database (we don't hard-delete user rows in
-- case other tables still reference them via author_id).
--
-- Safe to re-run — the GROUP BY only catches rows that still have a
-- duplicate sibling.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.5g-dedup.sql

START TRANSACTION;

-- (1) Build the canonical-vs-duplicate mapping in a temporary table.
DROP TEMPORARY TABLE IF EXISTS _trainee_dedup;
CREATE TEMPORARY TABLE _trainee_dedup (
  group_key  VARCHAR(300) NOT NULL,
  canonical_id CHAR(36)   NOT NULL,
  dup_id       CHAR(36)   NOT NULL,
  PRIMARY KEY (dup_id),
  KEY (canonical_id),
  KEY (group_key)
) ENGINE=InnoDB;

INSERT INTO _trainee_dedup (group_key, canonical_id, dup_id)
SELECT
  group_key,
  canonical_id,
  u.id AS dup_id
FROM users u
JOIN (
  -- Group key: case-insensitive name + phone (empty when null)
  SELECT
    CONCAT(LOWER(TRIM(first_name)), '|', LOWER(TRIM(COALESCE(last_name,''))), '|', COALESCE(NULLIF(TRIM(phone),''),'')) AS group_key,
    MIN(created_at) AS oldest_created_at,
    (SELECT u2.id
       FROM users u2
       WHERE u2.role = 'trainee'
         AND u2.disabled_at IS NULL
         AND (u2.email LIKE 'trainee-%@ubuntu3.local' OR u2.email LIKE 'moodle-%@ubuntu3.local')
         AND CONCAT(LOWER(TRIM(u2.first_name)), '|', LOWER(TRIM(COALESCE(u2.last_name,''))), '|', COALESCE(NULLIF(TRIM(u2.phone),''),''))
             = CONCAT(LOWER(TRIM(g.first_name)), '|', LOWER(TRIM(COALESCE(g.last_name,''))), '|', COALESCE(NULLIF(TRIM(g.phone),''),''))
       ORDER BY u2.created_at ASC
       LIMIT 1) AS canonical_id
  FROM users g
  WHERE g.role = 'trainee'
    AND g.disabled_at IS NULL
    AND (g.email LIKE 'trainee-%@ubuntu3.local' OR g.email LIKE 'moodle-%@ubuntu3.local')
    AND TRIM(COALESCE(g.first_name,'')) <> ''   -- skip rows we can't match safely
  GROUP BY group_key
  HAVING COUNT(*) > 1
) g ON CONCAT(LOWER(TRIM(u.first_name)), '|', LOWER(TRIM(COALESCE(u.last_name,''))), '|', COALESCE(NULLIF(TRIM(u.phone),''),'')) = g.group_key
WHERE u.role = 'trainee'
  AND u.disabled_at IS NULL
  AND (u.email LIKE 'trainee-%@ubuntu3.local' OR u.email LIKE 'moodle-%@ubuntu3.local')
  AND u.id <> g.canonical_id;

-- (2) Show what we're about to do (for the human reading the log)
SELECT COUNT(*) AS duplicates_to_merge FROM _trainee_dedup;

-- (3) Repoint participants.user_id from duplicate -> canonical.
UPDATE participants p
JOIN _trainee_dedup d ON d.dup_id = p.user_id
SET p.user_id = d.canonical_id,
    p.server_updated_at = NOW();

-- (4) Disable the duplicate users (do NOT hard-delete — author_id columns
-- elsewhere may still reference them via stamping). Mark with a special
-- email prefix so they're easy to spot or restore.
UPDATE users u
JOIN _trainee_dedup d ON d.dup_id = u.id
SET u.disabled_at = NOW(),
    u.email = CONCAT('merged-', u.id, '@ubuntu3.local'),
    u.username = CONCAT('merged-', u.id, '@ubuntu3.local'),
    u.updated_at = NOW();

-- (5) Bump server_updated_at on the canonical users so PWA clients pull the
-- merged participant data next sync.
UPDATE users u
JOIN _trainee_dedup d ON d.canonical_id = u.id
SET u.updated_at = NOW();

COMMIT;

-- Final counts so you can sanity-check after running.
SELECT role, COUNT(*) AS n FROM users WHERE disabled_at IS NULL GROUP BY role;
SELECT COUNT(*) AS active_trainees_with_synthetic_email
  FROM users
  WHERE role = 'trainee'
    AND disabled_at IS NULL
    AND (email LIKE 'trainee-%@ubuntu3.local' OR email LIKE 'moodle-%@ubuntu3.local');
