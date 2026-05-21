-- Ubuntu 3.0 — v0.3.5c
-- Walk-ins are local to a single session — they should not appear on the
-- parent course's roster. We mark them by setting `walk_in_session_id` to
-- the session.id they belong to. NULL means "regular course participant".
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.5c.sql

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS walk_in_session_id CHAR(36) NULL AFTER source,
  ADD KEY IF NOT EXISTS idx_participants_walkin_session (walk_in_session_id);

-- Retroactive backfill: any participant whose ONLY attendance is a walk-in,
-- and who has no other attendance anywhere, gets flagged so they disappear
-- from the course roster going forward. Best-effort heuristic — admins can
-- correct manually if needed.
UPDATE participants p
SET walk_in_session_id = (
  SELECT a.session_id
  FROM attendance a
  WHERE a.participant_id = p.id
  ORDER BY a.created_at
  LIMIT 1
)
WHERE p.deleted_at IS NULL
  AND p.walk_in_session_id IS NULL
  AND p.source = 'user'
  AND EXISTS (
    SELECT 1 FROM attendance a WHERE a.participant_id = p.id AND a.walk_in = 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM attendance a WHERE a.participant_id = p.id AND a.walk_in = 0
  );
