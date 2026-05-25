-- Ubuntu 3.0 — v0.3.7 — course banner image (synced from Moodle)
--
-- Adds a column on groups_ that records whether we have a stored
-- banner image for the course and, when present, exposes its
-- relative URL so the PWA can render <img src=...> instead of the
-- generic course icon.
--
-- The image bytes live on disk under server/storage/courses/<groupId>.<ext>
-- (analogous to story media). image_url stores a stable relative URL
-- the client uses to fetch the file via the new /api/courses/<id>/image
-- endpoint.
--
-- Safe to re-run thanks to IF NOT EXISTS.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.7-course-image.sql

ALTER TABLE `groups_`
  ADD COLUMN IF NOT EXISTS `image_url` VARCHAR(512) NULL AFTER `moodle_course_id`;
