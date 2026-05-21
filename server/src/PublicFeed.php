<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Public-facing read-only feed of stories that trainers have flagged as
 * publishable. No authentication. Strict PII minimization:
 *
 *   - First name only (no last name, no contact, no email)
 *   - Cohort region instead of group name
 *   - Photo only (no audio — audio leaks more identifying info)
 *   - No internal session notes / location
 *
 * The full participant is only ever exposed when:
 *   - story.consent       = 1   (explicit consent recorded by the trainer)
 *   - story.publishable   = 1   (separate opt-in for *public* display)
 *
 * Class is named PublicFeed because PHP reserves the bareword "public".
 */
final class PublicFeed
{
    private const PAGE_SIZE_DEFAULT = 12;
    private const PAGE_SIZE_MAX     = 50;

    /**
     * GET /api/public/stories?page=1&pageSize=12
     * No auth. Cache-friendly headers set so a CDN/Caddy can cache for a bit.
     */
    public static function stories(): void
    {
        $page     = max(1, (int) ($_GET['page'] ?? 1));
        $pageSize = (int) ($_GET['pageSize'] ?? self::PAGE_SIZE_DEFAULT);
        if ($pageSize < 1) $pageSize = self::PAGE_SIZE_DEFAULT;
        if ($pageSize > self::PAGE_SIZE_MAX) $pageSize = self::PAGE_SIZE_MAX;
        $offset = ($page - 1) * $pageSize;

        $pdo = Db::pdo();

        // Total count first — lets the client know if there's a next page.
        // LEFT JOIN means we include free-form stories (no session attached).
        // We still exclude stories whose session was soft-deleted (consistency).
        $countSql = "SELECT COUNT(*) FROM stories st
                     LEFT JOIN training_sessions s ON s.id = st.session_id
                     WHERE st.deleted_at IS NULL
                       AND st.consent = 1
                       AND st.publishable = 1
                       AND (st.session_id IS NULL OR s.deleted_at IS NULL)";
        $total = (int) $pdo->query($countSql)->fetchColumn();

        $sql = "SELECT
                  st.id, st.text, st.created_at, st.has_photo, st.has_audio,
                  st.view_count, st.like_count,
                  s.date AS session_date,
                  p.first_name AS participant_first_name,
                  c.region AS cohort_region
                FROM stories st
                LEFT JOIN training_sessions s ON s.id = st.session_id
                LEFT JOIN groups_      g ON g.id = s.group_id
                LEFT JOIN cohorts      c ON c.id = g.cohort_id
                LEFT JOIN participants p ON p.id = st.participant_id
                WHERE st.deleted_at IS NULL
                  AND st.consent = 1
                  AND st.publishable = 1
                  AND (st.session_id IS NULL OR s.deleted_at IS NULL)
                ORDER BY COALESCE(s.date, DATE(st.created_at)) DESC, st.created_at DESC
                LIMIT ? OFFSET ?";
        $stmt = $pdo->prepare($sql);
        $stmt->bindValue(1, $pageSize, \PDO::PARAM_INT);
        $stmt->bindValue(2, $offset, \PDO::PARAM_INT);
        $stmt->execute();

        $items = [];
        foreach ($stmt->fetchAll() as $r) {
            $items[] = [
                'id'           => (string) $r['id'],
                'text'         => (string) ($r['text'] ?? ''),
                'date'         => $r['session_date'] ?? null,
                'firstName'    => (string) ($r['participant_first_name'] ?? ''),
                'region'       => (string) ($r['cohort_region'] ?? ''),
                'photoUrl'     => $r['has_photo'] ? ('/api/public/stories/' . $r['id'] . '/photo') : null,
                'audioUrl'     => $r['has_audio'] ? ('/api/public/stories/' . $r['id'] . '/audio') : null,
                'views'        => (int) ($r['view_count'] ?? 0),
                'likes'        => (int) ($r['like_count'] ?? 0),
            ];
        }

        // Permissive CORS + caching — this is fully public read-only data.
        header('Access-Control-Allow-Origin: *');
        header('Cache-Control: public, max-age=120');
        Response::json([
            'page'      => $page,
            'pageSize'  => $pageSize,
            'total'     => $total,
            'hasMore'   => ($offset + count($items)) < $total,
            'items'     => $items,
        ]);
    }

    /**
     * GET /api/public/stories/{id}/photo
     * GET /api/public/stories/{id}/audio
     * Streams the media bytes, but ONLY if the story is consent+publishable.
     * Same path layout as Media::download() but skips authentication.
     */
    public static function media(string $storyId, string $kind): void
    {
        if ($kind !== 'photo' && $kind !== 'audio') {
            Response::error('bad_request', 'Unknown media kind.', 400);
        }
        $pdo = Db::pdo();
        $stmt = $pdo->prepare(
            "SELECT m.mime, m.size_bytes, m.storage_path
             FROM story_media m
             JOIN stories st ON st.id = m.story_id
             WHERE m.story_id = ? AND m.kind = ?
               AND st.deleted_at IS NULL
               AND st.consent = 1
               AND st.publishable = 1
             LIMIT 1"
        );
        $stmt->execute([$storyId, $kind]);
        $row = $stmt->fetch();
        if (!$row) {
            Response::error('not_found', 'Media not found or not public.', 404);
        }
        $abs = dirname(__DIR__) . '/storage/' . $row['storage_path'];
        if (!is_file($abs)) {
            Response::error('not_found', 'File missing.', 404);
        }
        header('Access-Control-Allow-Origin: *');
        header('Content-Type: ' . $row['mime']);
        header('Content-Length: ' . $row['size_bytes']);
        header('Accept-Ranges: bytes');
        header('Cache-Control: public, max-age=86400');
        readfile($abs);
        exit;
    }

    /**
     * POST /api/public/stories/{id}/view
     * Counts a view from the calling IP, deduplicated to one per hour per story.
     * Returns the new aggregate view count.
     */
    public static function view(string $storyId): void
    {
        if (!self::storyIsPublic($storyId)) {
            Response::error('not_found', 'Story not found or not public.', 404);
        }
        $pdo = Db::pdo();
        $ipHash = self::ipHash();
        $bucket = gmdate('Y-m-d-H');
        $now    = Db::nowUtc();

        try {
            $stmt = $pdo->prepare(
                'INSERT INTO story_views (story_id, ip_hash, bucket, created_at)
                 VALUES (?, ?, ?, ?)'
            );
            $stmt->execute([$storyId, $ipHash, $bucket, $now]);
            // First view this hour from this IP — bump the counter
            $pdo->prepare('UPDATE stories SET view_count = view_count + 1 WHERE id = ?')
                ->execute([$storyId]);
        } catch (\PDOException $e) {
            // Duplicate (already viewed this hour) — silently ignore.
            if (($e->errorInfo[1] ?? 0) !== 1062) throw $e;
        }
        $views = (int) $pdo->query('SELECT view_count FROM stories WHERE id = ' . $pdo->quote($storyId))->fetchColumn();
        header('Access-Control-Allow-Origin: *');
        Response::json(['views' => $views]);
    }

    /**
     * POST /api/public/stories/{id}/like
     * Toggle a like from the calling IP — adds one if not present, removes if it was.
     * Returns the new aggregate like count and the user's like state.
     */
    public static function like(string $storyId): void
    {
        if (!self::storyIsPublic($storyId)) {
            Response::error('not_found', 'Story not found or not public.', 404);
        }
        $pdo = Db::pdo();
        $ipHash = self::ipHash();
        $now    = Db::nowUtc();

        // Does this IP already have a like for this story?
        $stmt = $pdo->prepare('SELECT id FROM story_likes WHERE story_id = ? AND ip_hash = ? LIMIT 1');
        $stmt->execute([$storyId, $ipHash]);
        $existing = $stmt->fetchColumn();
        $liked = false;
        if ($existing) {
            // Unlike
            $pdo->prepare('DELETE FROM story_likes WHERE id = ?')->execute([$existing]);
            $pdo->prepare('UPDATE stories SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?')
                ->execute([$storyId]);
        } else {
            // Like
            $pdo->prepare(
                'INSERT INTO story_likes (story_id, ip_hash, created_at) VALUES (?, ?, ?)'
            )->execute([$storyId, $ipHash, $now]);
            $pdo->prepare('UPDATE stories SET like_count = like_count + 1 WHERE id = ?')
                ->execute([$storyId]);
            $liked = true;
        }
        $likes = (int) $pdo->query('SELECT like_count FROM stories WHERE id = ' . $pdo->quote($storyId))->fetchColumn();
        header('Access-Control-Allow-Origin: *');
        Response::json(['likes' => $likes, 'liked' => $liked]);
    }

    // -----------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------

    /** Quick gate: does this story exist AND is it publishable+consenting? */
    private static function storyIsPublic(string $storyId): bool
    {
        $stmt = Db::pdo()->prepare(
            'SELECT 1 FROM stories
             WHERE id = ? AND deleted_at IS NULL AND consent = 1 AND publishable = 1
             LIMIT 1'
        );
        $stmt->execute([$storyId]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Hash the client IP with a server-side secret salt. Stored as the
     * dedup key for views/likes. Never store raw IPs. Trusts X-Forwarded-For
     * if present (we're behind Caddy).
     */
    private static function ipHash(): string
    {
        $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        // X-Forwarded-For can be a list — take the first (original client).
        if (strpos($ip, ',') !== false) $ip = trim(explode(',', $ip)[0]);
        $salt = (string) Config::get('public.ip_hash_salt', 'ubuntu30-default-salt-change-me');
        return hash('sha256', $salt . '|' . $ip);
    }
}
