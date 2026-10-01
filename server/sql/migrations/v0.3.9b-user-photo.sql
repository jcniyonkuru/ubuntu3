-- Ubuntu 3.0 — v0.3.9b — user profile photo (trainers, admins, trainees)
--
-- Adds a flag on users that records whether a profile photo was attached.
-- The actual bytes live on disk at server/storage/users/<id>.<ext> and are
-- served by the new /api/users/<id>/media/photo endpoint. Shown as avatars
-- in the staff picker and the participant picker.
--
-- Safe to re-run thanks to IF NOT EXISTS.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.9b-user-photo.sql

ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `has_photo` TINYINT(1) NOT NULL DEFAULT 0 AFTER `age_range`;
