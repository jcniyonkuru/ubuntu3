<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Audit log endpoint — aggregates "who edited what, when" across the
 * mutable entities by mining the existing author_id / server_updated_at
 * / created_at / deleted_at columns. No new schema.
 *
 * Action inference (per row, latest state only):
 *   deleted_at IS NOT NULL                          → 'deleted'
 *   server_updated_at - created_at <= 2 seconds     → 'created'
 *   otherwise                                       → 'updated'
 *
 * That's the best we can do without a proper history table; trainers
 * can still see who touched what and roughly when. Attendance rows
 * are excluded because they're high-volume (every toggle = one event)
 * and would drown the timeline.
 */
final class Audit
{
    private const ENTITIES = [
        'cohorts'      => ['table' => 'cohorts',           'title' => '`name`',                                                'sub' => "''"],
        'courses'      => ['table' => 'groups_',           'title' => '`name`',                                                'sub' => "''"],
        'sessions'     => ['table' => 'training_sessions', 'title' => "COALESCE(`theme`, '')",                                 'sub' => "COALESCE(DATE_FORMAT(`date`, '%Y-%m-%d'), '')"],
        'participants' => ['table' => 'participants',      'title' => "CONCAT(COALESCE(`first_name`, ''), ' ', COALESCE(`last_name`, ''))", 'sub' => "''"],
        'stories'      => ['table' => 'stories',           'title' => "LEFT(COALESCE(`text`, ''), 80)",                        'sub' => "''"],
    ];

    /** GET /api/admin/audit */
    public static function list(): void
    {
        Auth::requireAdmin();

        // Parse + clamp filters
        $entityIn = explode(',', (string) ($_GET['entity'] ?? ''));
        $entityIn = array_filter(array_map('trim', $entityIn), static function ($e) {
            return $e !== '' && isset(self::ENTITIES[$e]);
        });
        $entityList = $entityIn ?: array_keys(self::ENTITIES);

        $action = (string) ($_GET['action'] ?? '');
        if (!in_array($action, ['', 'created', 'updated', 'deleted'], true)) $action = '';

        $since = $_GET['since'] ?? null;
        $until = $_GET['until'] ?? null;
        $sinceMy = $since ? Sync::isoToMysql((string) $since) : null;
        $untilMy = $until ? Sync::isoToMysql((string) $until) : null;

        $page = max(1, (int) ($_GET['page'] ?? 1));
        $size = max(10, min(200, (int) ($_GET['size'] ?? 50)));
        $offset = ($page - 1) * $size;

        // Build UNION ALL across the requested entity tables
        $unionParts = [];
        foreach ($entityList as $e) {
            $cfg = self::ENTITIES[$e];
            $unionParts[] = "
                SELECT
                    '" . addslashes($e) . "' AS entity,
                    `id`,
                    CASE
                        WHEN `deleted_at` IS NOT NULL THEN 'deleted'
                        WHEN TIMESTAMPDIFF(SECOND, `created_at`, `server_updated_at`) <= 2 THEN 'created'
                        ELSE 'updated'
                    END AS action,
                    `author_id`,
                    COALESCE(`deleted_at`, `server_updated_at`) AS at,
                    {$cfg['title']} AS title,
                    {$cfg['sub']}   AS sub
                FROM `{$cfg['table']}`
            ";
        }
        $union = implode(' UNION ALL ', $unionParts);

        // Apply outer filters
        $where = [];
        $params = [];
        if ($action !== '') { $where[] = 'action = ?'; $params[] = $action; }
        if ($sinceMy)       { $where[] = 'at >= ?';   $params[] = $sinceMy; }
        if ($untilMy)       { $where[] = 'at <= ?';   $params[] = $untilMy; }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $pdo = Db::pdo();
        // Total count for pagination — same query, COUNT(*)
        $countSql = "SELECT COUNT(*) FROM ({$union}) AS combined {$whereSql}";
        $countStmt = $pdo->prepare($countSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $sql = "SELECT * FROM ({$union}) AS combined {$whereSql} ORDER BY at DESC LIMIT {$size} OFFSET {$offset}";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        // Resolve authors in one round-trip
        $authorIds = array_filter(array_unique(array_column($rows, 'author_id')));
        $authors = [];
        if ($authorIds) {
            $place = implode(',', array_fill(0, count($authorIds), '?'));
            $aStmt = $pdo->prepare("SELECT id, first_name, last_name, email, role FROM users WHERE id IN ({$place})");
            $aStmt->execute(array_values($authorIds));
            foreach ($aStmt->fetchAll() as $u) {
                $authors[$u['id']] = $u;
            }
        }

        $items = array_map(static function ($r) use ($authors) {
            $a = $authors[$r['author_id']] ?? null;
            return [
                'entity' => $r['entity'],
                'id'     => $r['id'],
                'action' => $r['action'],
                'at'     => Sync::mysqlToIso($r['at']),
                'author' => $a ? [
                    'id'        => $a['id'],
                    'firstName' => $a['first_name'],
                    'lastName'  => $a['last_name'],
                    'email'     => $a['email'],
                    'role'      => $a['role'],
                ] : null,
                'title'  => $r['title'],
                'sub'    => $r['sub'],
            ];
        }, $rows);

        Response::json([
            'items' => $items,
            'page'  => $page,
            'size'  => $size,
            'total' => $total,
        ]);
    }
}
