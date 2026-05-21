-- Ubuntu 3.0 — v0.3.5h — hard-delete the trainees that v0.3.5g-dedup marked as merged
--
-- The v0.3.5g dedup script disabled duplicate trainees and renamed their
-- emails to 'merged-<uuid>@ubuntu3.local'. That hides them from the admin
-- table (which filters out merged-* + disabled), but the rows still exist.
--
-- This one-off purge HARD-DELETES those merged duplicates. Before deleting,
-- we double-check that nothing still references them:
--   * participants.user_id   — repointed by v0.3.5g; we re-check here
--   * any *.author_id column — these were stamped by the original author
--                               and we must NOT orphan them
--
-- For each merged user we verify that NO participants point to them AND that
-- they don't appear as author_id anywhere. If they do, we leave them disabled
-- (the admin UI already hides them) and skip the delete for safety.
--
-- Safe to re-run. Wraps everything in a transaction.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.5h-purge-merged.sql

START TRANSACTION;

-- (1) Candidate set: every user that was tagged 'merged-' by v0.3.5g.
DROP TEMPORARY TABLE IF EXISTS _purge_candidates;
CREATE TEMPORARY TABLE _purge_candidates (
  id CHAR(36) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

INSERT INTO _purge_candidates (id)
SELECT id FROM users
WHERE role = 'trainee'
  AND email LIKE 'merged-%@ubuntu3.local';

SELECT COUNT(*) AS merged_candidates FROM _purge_candidates;

-- (2) Remove any candidate that is still referenced as author_id on any
-- entity. Keeping them disabled is safer than orphaning audit trails.
DELETE c FROM _purge_candidates c
WHERE EXISTS (SELECT 1 FROM cohorts           x WHERE x.author_id = c.id)
   OR EXISTS (SELECT 1 FROM `groups_`         x WHERE x.author_id = c.id)
   OR EXISTS (SELECT 1 FROM training_sessions x WHERE x.author_id = c.id)
   OR EXISTS (SELECT 1 FROM participants      x WHERE x.author_id = c.id)
   OR EXISTS (SELECT 1 FROM attendance        x WHERE x.author_id = c.id)
   OR EXISTS (SELECT 1 FROM stories           x WHERE x.author_id = c.id);

-- (3) Also remove anything still pointed at by participants.user_id (should
-- be zero after v0.3.5g, but belt-and-braces).
DELETE c FROM _purge_candidates c
WHERE EXISTS (SELECT 1 FROM participants p WHERE p.user_id = c.id);

SELECT COUNT(*) AS safe_to_hard_delete FROM _purge_candidates;

-- (4) Hard-delete the safe candidates.
DELETE u FROM users u
JOIN _purge_candidates c ON c.id = u.id;

COMMIT;

-- Final counts so you can sanity-check after running.
SELECT COUNT(*) AS leftover_merged_users
  FROM users
  WHERE role = 'trainee' AND email LIKE 'merged-%@ubuntu3.local';

SELECT role, COUNT(*) AS n FROM users GROUP BY role;
