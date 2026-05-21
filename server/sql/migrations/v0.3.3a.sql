-- Ubuntu 3.0 — v0.3.3a schema migration
-- Adds view/like tracking for the public stories feed.
--
-- Run inside the container:
--   sudo docker exec -i moodle-mariadb-1 \
--     mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
--     < /opt/ubuntu3/server/sql/migrations/v0.3.3a.sql

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS view_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER publishable,
  ADD COLUMN IF NOT EXISTS like_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER view_count;

-- Per-IP like dedup: an IP gets at most one like per story. The IP is hashed
-- (sha256 with a server-side salt) so we don't store raw addresses.
CREATE TABLE IF NOT EXISTS story_likes (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  story_id    CHAR(36)        NOT NULL,
  ip_hash     CHAR(64)        NOT NULL,
  created_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_story_ip (story_id, ip_hash),
  KEY idx_likes_story (story_id),
  CONSTRAINT fk_likes_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-IP view dedup window: an IP only counts once per (story, hour). Same
-- table layout as likes but a different bucket.
CREATE TABLE IF NOT EXISTS story_views (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  story_id    CHAR(36)        NOT NULL,
  ip_hash     CHAR(64)        NOT NULL,
  bucket      CHAR(13)        NOT NULL,  -- YYYY-MM-DD-HH
  created_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_story_ip_bucket (story_id, ip_hash, bucket),
  KEY idx_views_story (story_id),
  CONSTRAINT fk_views_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
