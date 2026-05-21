-- Ubuntu 3.0 — v0.3.5e
-- Demographics (sex, age range) belong to the PERSON, not the course
-- membership. Move them from `participants` to `users`. We keep the old
-- columns on `participants` for backward compat during the transition;
-- the app now reads/writes them on `users`.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.5e.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sex       CHAR(1)     NULL AFTER last_name,
  ADD COLUMN IF NOT EXISTS age_range VARCHAR(20) NULL AFTER sex;

-- Backfill: for each user linked to a participant, copy the demographic
-- fields. If the same user is in multiple courses with conflicting values,
-- pick the most recently updated one (MAX(updated_at) heuristic).
UPDATE users u
JOIN (
  SELECT user_id,
         SUBSTRING_INDEX(GROUP_CONCAT(sex       ORDER BY server_updated_at DESC SEPARATOR '|'), '|', 1) AS sex,
         SUBSTRING_INDEX(GROUP_CONCAT(age_range ORDER BY server_updated_at DESC SEPARATOR '|'), '|', 1) AS age_range
  FROM participants
  WHERE user_id IS NOT NULL
    AND deleted_at IS NULL
    AND (sex IS NOT NULL OR age_range IS NOT NULL)
  GROUP BY user_id
) p ON p.user_id = u.id
SET
  u.sex       = COALESCE(NULLIF(u.sex, ''),       NULLIF(p.sex, '')),
  u.age_range = COALESCE(NULLIF(u.age_range, ''), NULLIF(p.age_range, ''));

-- Fix-up: earlier runs of v0.3.5 created the synthetic users with role='trainer'
-- because the ENUM hadn't been extended yet. Re-tag them as 'trainee' so the
-- admin UI filter works correctly.
UPDATE users
SET role = 'trainee'
WHERE (
  email LIKE 'trainee-%@ubuntu3.local'
  OR email LIKE 'moodle-%@ubuntu3.local'
)
AND role <> 'trainee';
