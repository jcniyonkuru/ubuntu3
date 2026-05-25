-- Ubuntu 3.0 — v0.3.8a — session photo (visual proof)
--
-- Adds a flag on training_sessions that records whether the trainer
-- attached a photo to the session ("group photo at the start"). The
-- actual bytes live on disk at server/storage/sessions/<id>.<ext> and
-- are served by the new /api/sessions/<id>/media/photo endpoint.
--
-- Safe to re-run thanks to IF NOT EXISTS.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.8a-session-photo.sql

ALTER TABLE `training_sessions`
  ADD COLUMN IF NOT EXISTS `has_photo` TINYINT(1) NOT NULL DEFAULT 0 AFTER `notes`;
