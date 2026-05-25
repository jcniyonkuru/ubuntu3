<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Sync engine: pull (server → client) and push (client → server).
 *
 * Last-write-wins on client_updated_at (if the server already has a newer
 * server_updated_at, the incoming write still goes through — the client
 * adopts the server's stamp on the next pull). This is intentional: the
 * server is the source of truth.
 */
final class Sync
{
    /**
     * Entity definitions: API name → { table, columns mapping client → DB }.
     * 'id', 'createdAt', 'updatedAt', 'authorId', 'deletedAt' are handled centrally.
     */
    private const ENTITIES = [
        'cohorts' => [
            'table' => 'cohorts',
            'fields' => [
                'name' => 'name',
                'region' => 'region',
                'startDate' => 'start_date',
                'endDate' => 'end_date',
            ],
        ],
        'groups' => [
            'table' => 'groups_',
            'fields' => [
                'cohortId' => 'cohort_id',
                'name' => 'name',
                'facilitator' => 'facilitator',
                'facilitatorIds' => 'facilitator_ids',
                'moodleCourseId' => 'moodle_course_id',
            ],
            // v0.3.7 — banner image pulled from Moodle. Server populates
            // image_url to a stable /api/courses/<id>/image path; clients
            // never push it back.
            'readonly' => [
                'imageUrl' => 'image_url',
            ],
        ],
        'participants' => [
            'table' => 'participants',
            'fields' => [
                'groupId' => 'group_id',
                'firstName' => 'first_name',
                'lastName' => 'last_name',
                'sex' => 'sex',
                'ageRange' => 'age_range',
                'contact' => 'contact',
                'walkInSessionId' => 'walk_in_session_id',  // v0.3.5c: session-local scope
                'status' => 'status',                       // v0.3.5d: 'active' | 'dropped'
            ],
            'readonly' => [
                'source' => 'source',
                'moodleUserId' => 'moodle_user_id',
                'userId' => 'user_id',          // v0.3.5: link to users(id)
            ],
        ],
        'sessions' => [
            'table' => 'training_sessions',
            'fields' => [
                'groupId' => 'group_id',
                'date' => 'date',
                'theme' => 'theme',
                'location' => 'location',
                'notes' => 'notes',
                // v0.3.8 — visual + audio proof. Mirrors hasPhoto/hasAudio on stories.
                'hasPhoto' => 'has_photo',
                'hasAudio' => 'has_audio',
            ],
            'readonly' => [
                'source' => 'source',
                'moodleActivityId' => 'moodle_activity_id',
            ],
        ],
        'attendance' => [
            'table' => 'attendance',
            'fields' => [
                'sessionId' => 'session_id',
                'participantId' => 'participant_id',
                'present' => 'present',
                'walkIn' => 'walk_in',
            ],
        ],
        'stories' => [
            'table' => 'stories',
            'fields' => [
                'sessionId' => 'session_id',
                'participantId' => 'participant_id',
                'text' => 'text',
                'consent' => 'consent',
                'publishable' => 'publishable',
                'hasPhoto' => 'has_photo',
                'hasAudio' => 'has_audio',
            ],
        ],
    ];

    /**
     * GET /api/sync/pull?since=ISO8601
     * Returns all records (incl. tombstones) updated since `since`,
     * plus the server's current UTC time.
     */
    public static function pull(): void
    {
        Auth::requireUser();
        // Accept `since` from query string OR JSON body — the latter lets clients
        // use POST when behind proxies (Zscaler etc.) that intercept GETs.
        $since = $_GET['since'] ?? null;
        if ($since === null && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
            $body  = Util::jsonBody();
            $since = $body['since'] ?? null;
        }
        $since = (string) ($since ?? '1970-01-01T00:00:00Z');
        $sinceMysql = self::isoToMysql($since);
        $pdo = Db::pdo();
        $out = ['serverTime' => Db::nowIsoUtc()];

        foreach (self::ENTITIES as $name => $def) {
            $cols = array_values($def['fields']);
            if (!empty($def['readonly'])) {
                $cols = array_merge($cols, array_values($def['readonly']));
            }
            $cols = array_merge(
                ['id', 'author_id', 'client_updated_at', 'server_updated_at', 'created_at', 'deleted_at'],
                $cols
            );
            $sql = 'SELECT ' . implode(',', $cols) . ' FROM `' . $def['table'] . '` WHERE server_updated_at > ?';
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$sinceMysql]);
            $rows = $stmt->fetchAll();
            $out[$name] = array_map(static fn($r) => self::dbToClient($name, $r), $rows);
        }
        Response::json($out);
    }

    /**
     * POST /api/sync/push
     * Body: same shape as pull (only the records the client thinks are dirty).
     * Each row must have an `id` (UUID); server stamps server_updated_at and
     * author_id from the auth context.
     */
    public static function push(): void
    {
        $user = Auth::requireUser();
        $body = Util::jsonBody();
        $pdo  = Db::pdo();
        $now  = Db::nowUtc();
        $accepted = [];

        try {
            $pdo->beginTransaction();
            foreach (self::ENTITIES as $name => $def) {
                $accepted[$name] = [];
                if (!isset($body[$name]) || !is_array($body[$name])) continue;
                foreach ($body[$name] as $row) {
                    if (!is_array($row) || empty($row['id'])) continue;
                    $dbRow = self::clientToDb($name, $row);
                    $dbRow['id']                = (string) $row['id'];
                    $dbRow['author_id']         = $user['id'];
                    $dbRow['server_updated_at'] = $now;
                    if (empty($dbRow['client_updated_at'])) {
                        $dbRow['client_updated_at'] = $now;
                    }
                    if (empty($dbRow['created_at'])) {
                        $dbRow['created_at'] = $dbRow['client_updated_at'];
                    }
                    self::upsert($def['table'], $dbRow);
                    $accepted[$name][] = $dbRow['id'];
                }
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            Response::error('sync_failed', 'Push failed: ' . $e->getMessage(), 500);
        }

        Response::json([
            'accepted'   => $accepted,
            'serverTime' => Db::nowIsoUtc(),
        ]);
    }

    // -----------------------------------------------------------
    //  helpers
    // -----------------------------------------------------------

    private static function upsert(string $table, array $row): void
    {
        $cols = array_keys($row);
        $placeholders = array_fill(0, count($cols), '?');
        $updateCols = array_filter($cols, static fn($c) => $c !== 'id' && $c !== 'created_at');
        $updateClauses = array_map(static fn($c) => "`$c` = VALUES(`$c`)", $updateCols);
        $sql = 'INSERT INTO `' . $table . '` (`' . implode('`,`', $cols) . '`) VALUES (' . implode(',', $placeholders) . ')';
        if ($updateClauses) {
            $sql .= ' ON DUPLICATE KEY UPDATE ' . implode(',', $updateClauses);
        }
        Db::pdo()->prepare($sql)->execute(array_values($row));
    }

    private static function clientToDb(string $entity, array $row): array
    {
        $def = self::ENTITIES[$entity];
        $out = [];
        foreach ($def['fields'] as $clientKey => $dbKey) {
            if (array_key_exists($clientKey, $row)) {
                $out[$dbKey] = self::normaliseValue($entity, $clientKey, $row[$clientKey]);
            }
        }
        if (array_key_exists('createdAt', $row)) {
            $out['created_at'] = self::isoToMysql((string) $row['createdAt']);
        }
        if (array_key_exists('updatedAt', $row)) {
            $out['client_updated_at'] = self::isoToMysql((string) $row['updatedAt']);
        }
        if (array_key_exists('deletedAt', $row)) {
            $v = $row['deletedAt'];
            $out['deleted_at'] = $v ? self::isoToMysql((string) $v) : null;
        }
        return $out;
    }

    private static function dbToClient(string $entity, array $row): array
    {
        $def = self::ENTITIES[$entity];
        $out = ['id' => $row['id']];
        foreach ($def['fields'] as $clientKey => $dbKey) {
            $out[$clientKey] = self::denormaliseValue($entity, $clientKey, $row[$dbKey] ?? null);
        }
        if (!empty($def['readonly'])) {
            foreach ($def['readonly'] as $clientKey => $dbKey) {
                $out[$clientKey] = $row[$dbKey] ?? null;
            }
        }
        $out['authorId']  = $row['author_id'];
        $out['createdAt'] = self::mysqlToIso($row['created_at'] ?? null);
        $out['updatedAt'] = self::mysqlToIso($row['server_updated_at'] ?? null);
        $out['deletedAt'] = self::mysqlToIso($row['deleted_at'] ?? null);
        return $out;
    }

    private static function normaliseValue(string $entity, string $field, $value)
    {
        // Multi-valued: course facilitators are a JSON array of user UUIDs.
        // Accept array (from a fresh client) or string (from a re-push of a
        // pulled row). Always store as JSON text so the column type stays
        // simple (TEXT) and the value round-trips cleanly.
        if ($field === 'facilitatorIds') {
            if ($value === null) return null;
            if (is_array($value))  return $value === [] ? null : json_encode(array_values($value));
            if (is_string($value)) {
                $s = trim($value);
                if ($s === '' || $s === '[]') return null;
                // Validate it's parseable as JSON; if not, drop to null rather than poison the row.
                $decoded = json_decode($s, true);
                return is_array($decoded) ? json_encode(array_values($decoded)) : null;
            }
            return null;
        }
        if ($value === '' || $value === null) {
            if (in_array($field, ['present', 'consent', 'hasPhoto', 'hasAudio'], true)) return 0;
            if (in_array($field, ['startDate', 'endDate', 'date'], true)) return null;
            return null;
        }
        if (in_array($field, ['present', 'consent', 'hasPhoto', 'hasAudio'], true)) {
            return $value ? 1 : 0;
        }
        if (in_array($field, ['startDate', 'endDate', 'date'], true)) {
            // Accept either "YYYY-MM-DD" or full ISO
            return substr((string) $value, 0, 10);
        }
        return $value;
    }

    private static function denormaliseValue(string $entity, string $field, $value)
    {
        if (in_array($field, ['present', 'consent', 'hasPhoto', 'hasAudio'], true)) {
            return (bool) (int) $value;
        }
        if ($field === 'facilitatorIds') {
            if ($value === null || $value === '') return [];
            $decoded = json_decode((string) $value, true);
            return is_array($decoded) ? array_values($decoded) : [];
        }
        return $value;
    }

    // Made public so adjacent helpers (e.g. MoodleSync::news) can reuse the
    // same ISO <-> MySQL DATETIME conventions without duplicating the logic.
    public static function isoToMysql(string $iso): string
    {
        $t = strtotime($iso);
        if ($t === false) $t = time();
        return gmdate('Y-m-d H:i:s', $t);
    }

    public static function mysqlToIso(?string $mysql): ?string
    {
        if (!$mysql) return null;
        $t = strtotime($mysql . ' UTC');
        if ($t === false) return null;
        return gmdate('Y-m-d\TH:i:s\Z', $t);
    }
}
