-- Ubuntu 3.0 — v0.3.8b — session voice note
--
-- Adds a flag on training_sessions that records whether the trainer
-- attached a short voice memo to the session. Audio bytes live on
-- disk at server/storage/sessions/<id>.<ext> (same dir as session
-- photos — sessions only ever have one of each kind so the naming
-- can't collide).
--
-- Safe to re-run thanks to IF NOT EXISTS.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.8b-session-audio.sql

ALTER TABLE `training_sessions`
  ADD COLUMN IF NOT EXISTS `has_audio` TINYINT(1) NOT NULL DEFAULT 0 AFTER `has_photo`;
