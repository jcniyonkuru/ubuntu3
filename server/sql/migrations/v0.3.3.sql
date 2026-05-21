-- Ubuntu 3.0 — v0.3.3 schema migration
-- Adds a `publishable` flag on stories. Trainers can opt-in a story to the
-- public feed at /news/ on top of the existing `consent` flag.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.3.sql

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS publishable TINYINT(1) NOT NULL DEFAULT 0 AFTER consent;
