-- Ubuntu 3.0 — v0.3.5f
-- Adds a phone column on `users`. Email stays as the unique identifier;
-- phone is intentionally NOT unique (people share landlines, change numbers,
-- and trainees may not have one).
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.5f.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50) NULL AFTER email;

-- Backfill from participants.contact when it doesn't look like an email
-- (no '@' character). Run only when the user doesn't already have a phone.
UPDATE users u
JOIN (
  SELECT user_id,
         SUBSTRING_INDEX(GROUP_CONCAT(contact ORDER BY server_updated_at DESC SEPARATOR '|'), '|', 1) AS contact
  FROM participants
  WHERE user_id IS NOT NULL
    AND deleted_at IS NULL
    AND contact IS NOT NULL
    AND contact <> ''
    AND contact NOT LIKE '%@%'
  GROUP BY user_id
) p ON p.user_id = u.id
SET u.phone = COALESCE(NULLIF(u.phone, ''), p.contact);
