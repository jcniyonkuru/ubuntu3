-- Ubuntu 3.0 — v0.3.9a — participant photo (avatar)
--
-- Adds a flag on participants that records whether a profile photo was
-- attached. The actual bytes live on disk at
-- server/storage/participants/<id>.<ext> and are served by the new
-- /api/participants/<id>/media/photo endpoint.
--
-- Safe to re-run thanks to IF NOT EXISTS.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.9a-participant-photo.sql

ALTER TABLE `participants`
  ADD COLUMN IF NOT EXISTS `has_photo` TINYINT(1) NOT NULL DEFAULT 0 AFTER `contact`;
