-- Ubuntu 3.0 — v0.3.4 schema migration
-- Splits users.name into first_name + last_name.
--
-- Email remains the unique identifier. first_name, last_name, and email
-- are all mandatory at creation (enforced by the app).
--
-- The legacy `name` column stays in place as a derived/cached value
-- (first_name + ' ' + last_name) so older code paths keep working.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.4.sql

-- Add the new columns as nullable first (so backfill can run)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(80) NULL AFTER name,
  ADD COLUMN IF NOT EXISTS last_name  VARCHAR(80) NULL AFTER first_name;

-- Backfill from the existing single `name`:
--   "Jean-Claude Niyonkuru"  -> first_name="Jean-Claude", last_name="Niyonkuru"
--   "Anitha"                 -> first_name="Anitha",      last_name=""
--   "Mary Anne Smith"        -> first_name="Mary",        last_name="Anne Smith"
UPDATE users
SET
  first_name = TRIM(SUBSTRING_INDEX(TRIM(name), ' ', 1)),
  last_name  = CASE
                 WHEN LOCATE(' ', TRIM(name)) > 0
                   THEN TRIM(SUBSTRING(TRIM(name), LOCATE(' ', TRIM(name)) + 1))
                 ELSE ''
               END
WHERE (first_name IS NULL OR first_name = '')
  AND name IS NOT NULL AND name <> '';

-- Anyone still NULL (e.g. weirdly created rows) gets a placeholder so the
-- NOT NULL constraint can apply.
UPDATE users SET first_name = 'Unknown' WHERE first_name IS NULL OR first_name = '';
UPDATE users SET last_name  = ''        WHERE last_name  IS NULL;

ALTER TABLE users
  MODIFY COLUMN first_name VARCHAR(80) NOT NULL,
  MODIFY COLUMN last_name  VARCHAR(80) NOT NULL DEFAULT '';
