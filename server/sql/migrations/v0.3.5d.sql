-- Ubuntu 3.0 — v0.3.5d
-- Adds a "dropped" status on participants. Once a participant is dropped,
-- they cannot be added as an attendee in any session anymore, but their
-- past attendance is preserved for reports.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.5d.sql

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS status ENUM('active','dropped') NOT NULL DEFAULT 'active' AFTER source;
