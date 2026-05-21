-- Ubuntu 3.0 — v0.3.5i — multi-facilitator support on courses
--
-- Courses used to have a single free-text `facilitator` column. We're
-- replacing it with a JSON list of user ids drawn from staff (role IN
-- ('trainer','admin')). The old column stays as a display fallback for
-- pre-migration data and for any legacy clients still pushing it.
--
-- Storage: facilitator_ids holds a JSON array of CHAR(36) UUIDs, e.g.
--   '["a3e1...","b9f2..."]'  or  NULL when no facilitator is assigned.
--
-- Safe to re-run thanks to IF NOT EXISTS.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.5i-facilitator-ids.sql

ALTER TABLE `groups_`
  ADD COLUMN IF NOT EXISTS `facilitator_ids` TEXT NULL AFTER `facilitator`;
