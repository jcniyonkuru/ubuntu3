<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Donor reports — server compiles all the data for a given period and
 * optional cohort, the admin UI renders it into a printable HTML report.
 *
 * Strictly read-only. Admins only. No state is mutated.
 *
 * v0.3.2 — first iteration (HTML + browser print-to-PDF). A future iteration
 * may add server-side PDF (DomPDF/mPDF) or XLSX (PhpSpreadsheet).
 */
final class Reports
{
    /**
     * POST /api/admin/reports/donor
     * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", cohortId?: string }
     */
    public static function donor(): void
    {
        Auth::requireAdmin();

        $body = Util::jsonBody();
        $from = self::parseDate($body['from'] ?? null) ?: date('Y-m-d', strtotime('first day of -3 months'));
        $to   = self::parseDate($body['to']   ?? null) ?: date('Y-m-d');
        // Swap if reversed
        if ($from > $to) { $tmp = $from; $from = $to; $to = $tmp; }
        $cohortId = isset($body['cohortId']) && $body['cohortId'] !== '' ? (string) $body['cohortId'] : null;

        Response::json([
            'period'          => self::periodLabel($from, $to),
            'kpis'            => self::kpis($from, $to, $cohortId),
            'demographics'    => self::demographics($cohortId),
            'cohorts'         => self::perCohort($from, $to, $cohortId),
            'attendanceTrend' => self::attendanceTrend($from, $to, $cohortId),
            'stories'         => self::stories($from, $to, $cohortId),
        ]);
    }

    // -----------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------

    private static function parseDate($v): ?string
    {
        if (!is_string($v)) return null;
        $t = strtotime($v);
        return $t === false ? null : date('Y-m-d', $t);
    }

    private static function periodLabel(string $from, string $to): array
    {
        return [
            'from'  => $from,
            'to'    => $to,
            'label' => date('d M Y', strtotime($from)) . ' → ' . date('d M Y', strtotime($to)),
            'days'  => (int) ((strtotime($to) - strtotime($from)) / 86400) + 1,
        ];
    }

    /** Restrict groups to a particular cohort if requested, otherwise all non-deleted groups. */
    private static function scopedGroupIds(?string $cohortId): array
    {
        $sql = 'SELECT id FROM groups_ WHERE deleted_at IS NULL';
        $args = [];
        if ($cohortId !== null) {
            $sql .= ' AND cohort_id = ?';
            $args[] = $cohortId;
        }
        $stmt = Db::pdo()->prepare($sql);
        $stmt->execute($args);
        return array_map(static fn($r) => (string) $r['id'], $stmt->fetchAll());
    }

    /** "?,?,?" placeholder list for a known-safe array of ids. */
    private static function inPlaceholders(array $ids): string
    {
        return $ids ? implode(',', array_fill(0, count($ids), '?')) : 'NULL';
    }

    // -----------------------------------------------------------
    //  KPIs — banner numbers at the top of the report
    // -----------------------------------------------------------

    private static function kpis(string $from, string $to, ?string $cohortId): array
    {
        $pdo = Db::pdo();
        $groupIds = self::scopedGroupIds($cohortId);
        $gIn = self::inPlaceholders($groupIds);

        // Active cohorts in scope (either all or just the selected one, if it had any sessions/participants).
        if ($cohortId !== null) {
            $cohorts = 1;
        } else {
            $stmt = $pdo->query('SELECT COUNT(*) FROM cohorts WHERE deleted_at IS NULL');
            $cohorts = (int) $stmt->fetchColumn();
        }

        $groups = count($groupIds);

        // Participants in scope (alive, in scoped groups)
        $sql = "SELECT COUNT(*) FROM participants WHERE deleted_at IS NULL AND group_id IN ($gIn)";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($groupIds);
        $participants = $groupIds ? (int) $stmt->fetchColumn() : 0;

        // Sessions in scope (in period, in scoped groups, alive)
        $sql = "SELECT COUNT(*) FROM training_sessions
                WHERE deleted_at IS NULL AND date BETWEEN ? AND ? AND group_id IN ($gIn)";
        $stmt = $pdo->prepare($sql);
        $stmt->execute(array_merge([$from, $to], $groupIds));
        $sessions = $groupIds ? (int) $stmt->fetchColumn() : 0;

        // Attendance — count attendance rows whose session falls in scope
        $sql = "SELECT
                  SUM(CASE WHEN a.present = 1 THEN 1 ELSE 0 END) AS present_count,
                  COUNT(*) AS total_count
                FROM attendance a
                JOIN training_sessions s ON s.id = a.session_id
                WHERE s.deleted_at IS NULL
                  AND s.date BETWEEN ? AND ?
                  AND s.group_id IN ($gIn)";
        $stmt = $pdo->prepare($sql);
        $stmt->execute(array_merge([$from, $to], $groupIds));
        $att = $stmt->fetch();
        $presentTotal = (int) ($att['present_count'] ?? 0);
        $attTotal     = (int) ($att['total_count']   ?? 0);
        $attendancePct = $attTotal > 0 ? round(($presentTotal * 100) / $attTotal) : 0;

        // Stories — count stories tied to sessions in scope
        $sql = "SELECT COUNT(*) FROM stories st
                LEFT JOIN training_sessions s ON s.id = st.session_id
                WHERE st.deleted_at IS NULL
                  AND s.deleted_at IS NULL
                  AND s.date BETWEEN ? AND ?
                  AND s.group_id IN ($gIn)";
        $stmt = $pdo->prepare($sql);
        $stmt->execute(array_merge([$from, $to], $groupIds));
        $stories = $groupIds ? (int) $stmt->fetchColumn() : 0;

        return [
            'cohorts'                 => $cohorts,
            'groups'                  => $groups,
            'participants'            => $participants,
            'sessions'                => $sessions,
            'stories'                 => $stories,
            'attendancePct'           => $attendancePct,
            'presentTotal'            => $presentTotal,
            'attendanceRecordedTotal' => $attTotal,
        ];
    }

    // -----------------------------------------------------------
    //  Demographics — sex / age range breakdown for participants in scope
    // -----------------------------------------------------------

    private static function demographics(?string $cohortId): array
    {
        $pdo = Db::pdo();
        $groupIds = self::scopedGroupIds($cohortId);
        if (!$groupIds) {
            return ['bySex' => [], 'byAgeRange' => []];
        }
        $gIn = self::inPlaceholders($groupIds);

        $sql = "SELECT sex, COUNT(*) AS n
                FROM participants
                WHERE deleted_at IS NULL AND group_id IN ($gIn)
                GROUP BY sex";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($groupIds);
        $bySex = [];
        foreach ($stmt->fetchAll() as $r) {
            $bySex[(string) ($r['sex'] ?? '')] = (int) $r['n'];
        }

        $sql = "SELECT age_range, COUNT(*) AS n
                FROM participants
                WHERE deleted_at IS NULL AND group_id IN ($gIn)
                GROUP BY age_range
                ORDER BY age_range";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($groupIds);
        $byAge = [];
        foreach ($stmt->fetchAll() as $r) {
            $byAge[(string) ($r['age_range'] ?? '')] = (int) $r['n'];
        }

        return ['bySex' => $bySex, 'byAgeRange' => $byAge];
    }

    // -----------------------------------------------------------
    //  Per-cohort breakdown
    // -----------------------------------------------------------

    private static function perCohort(string $from, string $to, ?string $cohortId): array
    {
        $pdo = Db::pdo();
        $sql = 'SELECT id, name, region, start_date, end_date FROM cohorts WHERE deleted_at IS NULL';
        $args = [];
        if ($cohortId !== null) {
            $sql .= ' AND id = ?';
            $args[] = $cohortId;
        }
        $sql .= ' ORDER BY COALESCE(start_date, "0000-00-00") DESC, name';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($args);
        $cohorts = $stmt->fetchAll();

        $out = [];
        foreach ($cohorts as $c) {
            $cid = (string) $c['id'];
            $gids = [];
            $g = $pdo->prepare('SELECT id FROM groups_ WHERE cohort_id = ? AND deleted_at IS NULL');
            $g->execute([$cid]);
            foreach ($g->fetchAll() as $row) $gids[] = (string) $row['id'];

            $gIn = self::inPlaceholders($gids);
            $participants = 0;
            $sessions = 0;
            $presentTotal = 0;
            $attTotal = 0;

            if ($gids) {
                $p = $pdo->prepare("SELECT COUNT(*) FROM participants WHERE deleted_at IS NULL AND group_id IN ($gIn)");
                $p->execute($gids);
                $participants = (int) $p->fetchColumn();

                $s = $pdo->prepare("SELECT COUNT(*) FROM training_sessions
                                    WHERE deleted_at IS NULL AND date BETWEEN ? AND ? AND group_id IN ($gIn)");
                $s->execute(array_merge([$from, $to], $gids));
                $sessions = (int) $s->fetchColumn();

                $a = $pdo->prepare("SELECT
                                      SUM(CASE WHEN a.present = 1 THEN 1 ELSE 0 END) AS present_count,
                                      COUNT(*) AS total_count
                                    FROM attendance a
                                    JOIN training_sessions s ON s.id = a.session_id
                                    WHERE s.deleted_at IS NULL
                                      AND s.date BETWEEN ? AND ?
                                      AND s.group_id IN ($gIn)");
                $a->execute(array_merge([$from, $to], $gids));
                $row = $a->fetch();
                $presentTotal = (int) ($row['present_count'] ?? 0);
                $attTotal     = (int) ($row['total_count']   ?? 0);
            }

            $out[] = [
                'id'             => $cid,
                'name'           => (string) $c['name'],
                'region'         => (string) ($c['region'] ?? ''),
                'startDate'      => $c['start_date'] ?? null,
                'endDate'        => $c['end_date']   ?? null,
                'groups'         => count($gids),
                'participants'   => $participants,
                'sessions'       => $sessions,
                'attendancePct'  => $attTotal > 0 ? round(($presentTotal * 100) / $attTotal) : 0,
                'attendanceN'    => $attTotal,
            ];
        }
        return $out;
    }

    // -----------------------------------------------------------
    //  Attendance trend — monthly buckets across the period
    // -----------------------------------------------------------

    private static function attendanceTrend(string $from, string $to, ?string $cohortId): array
    {
        $pdo = Db::pdo();
        $groupIds = self::scopedGroupIds($cohortId);
        if (!$groupIds) return [];
        $gIn = self::inPlaceholders($groupIds);

        $sql = "SELECT
                  DATE_FORMAT(s.date, '%Y-%m') AS month,
                  COUNT(DISTINCT s.id)         AS sessions,
                  SUM(CASE WHEN a.present = 1 THEN 1 ELSE 0 END) AS present_count,
                  COUNT(a.id)                  AS total_count
                FROM training_sessions s
                LEFT JOIN attendance a ON a.session_id = s.id
                WHERE s.deleted_at IS NULL
                  AND s.date BETWEEN ? AND ?
                  AND s.group_id IN ($gIn)
                GROUP BY month
                ORDER BY month";
        $stmt = $pdo->prepare($sql);
        $stmt->execute(array_merge([$from, $to], $groupIds));
        $rows = $stmt->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $tot = (int) ($r['total_count'] ?? 0);
            $pres = (int) ($r['present_count'] ?? 0);
            $out[] = [
                'month'         => (string) $r['month'],
                'sessions'      => (int) ($r['sessions'] ?? 0),
                'attendancePct' => $tot > 0 ? round(($pres * 100) / $tot) : 0,
                'presentTotal'  => $pres,
                'attendanceN'   => $tot,
            ];
        }
        return $out;
    }

    // -----------------------------------------------------------
    //  Stories — only ones tied to sessions in scope with explicit consent
    // -----------------------------------------------------------

    private static function stories(string $from, string $to, ?string $cohortId): array
    {
        $pdo = Db::pdo();
        $groupIds = self::scopedGroupIds($cohortId);
        if (!$groupIds) return [];
        $gIn = self::inPlaceholders($groupIds);

        $sql = "SELECT
                  st.id, st.text, st.consent, st.has_photo, st.has_audio, st.created_at,
                  s.date AS session_date, s.theme AS session_theme,
                  g.name AS group_name,
                  p.first_name, p.last_name,
                  u.name AS author_name
                FROM stories st
                JOIN training_sessions s ON s.id = st.session_id
                LEFT JOIN groups_ g ON g.id = s.group_id
                LEFT JOIN participants p ON p.id = st.participant_id
                LEFT JOIN users u ON u.id = st.author_id
                WHERE st.deleted_at IS NULL
                  AND st.consent = 1
                  AND s.deleted_at IS NULL
                  AND s.date BETWEEN ? AND ?
                  AND s.group_id IN ($gIn)
                ORDER BY s.date DESC, st.created_at DESC
                LIMIT 50";
        $stmt = $pdo->prepare($sql);
        $stmt->execute(array_merge([$from, $to], $groupIds));
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[] = [
                'id'           => (string) $r['id'],
                'text'         => (string) ($r['text'] ?? ''),
                'consent'      => (bool) $r['consent'],
                'hasPhoto'     => (bool) $r['has_photo'],
                'hasAudio'     => (bool) $r['has_audio'],
                'sessionDate'  => $r['session_date'] ?? null,
                'sessionTheme' => (string) ($r['session_theme'] ?? ''),
                'groupName'    => (string) ($r['group_name'] ?? ''),
                'participant'  => trim(((string) ($r['first_name'] ?? '')) . ' ' . ((string) ($r['last_name'] ?? ''))),
                'authorName'   => (string) ($r['author_name'] ?? ''),
                'photoUrl'     => $r['has_photo'] ? ('/api/stories/' . $r['id'] . '/media/photo') : null,
            ];
        }
        return $out;
    }
}
