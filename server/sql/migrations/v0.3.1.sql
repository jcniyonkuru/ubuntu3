-- Ubuntu 3.0 — migration to v0.3.1
-- Links groups to Ubuntu eLearning courses and tags sessions/participants by source.
-- Records tagged source='moodle' are managed by the sync engine; source='user' is sacred.
-- Idempotent.

-- groups can optionally link to one eLearning course
ALTER TABLE groups_
  ADD COLUMN IF NOT EXISTS moodle_course_id INT NULL AFTER name;

-- training_sessions: source + moodle activity id
ALTER TABLE training_sessions
  ADD COLUMN IF NOT EXISTS source ENUM('user','moodle') NOT NULL DEFAULT 'user' AFTER notes,
  ADD COLUMN IF NOT EXISTS moodle_activity_id INT NULL AFTER source,
  ADD UNIQUE KEY IF NOT EXISTS uniq_sessions_moodle (group_id, moodle_activity_id);

-- participants: source + moodle user id
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS source ENUM('user','moodle') NOT NULL DEFAULT 'user' AFTER contact,
  ADD COLUMN IF NOT EXISTS moodle_user_id INT NULL AFTER source,
  ADD UNIQUE KEY IF NOT EXISTS uniq_participants_moodle (group_id, moodle_user_id);
