-- Ubuntu 3.0 — v0.3.5b
-- Tags an attendance row as a "walk-in" so the session detail screen can
-- show a pill and a one-tap delete action distinct from regular toggles.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.5b.sql

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS walk_in TINYINT(1) NOT NULL DEFAULT 0 AFTER present;
