<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Donor portal — v0.3.8
 *
 * Read-only, no-auth, aggregated stats designed for a public funder
 * mini-site (donors.academyubuntu.com). Strict PII minimisation:
 *
 *   - No participant identifiers ever leave the server (no ids, no names,
 *     no emails, no phone). We expose counts and percentages only.
 *   - Demographic breakdowns (by sex, by age range) are gated on a
 *     k-anonymity-lite threshold (DEMO_MIN_BUCKET): a bucket with fewer
 *     than that many people is collapsed into "Other" so individuals can
 *     never be inferred from a small slice.
 *   - "Active" cohort = a cohort that held at least one session in the
 *     last 90 days. This avoids legacy or paused cohorts inflating the
 *     headline number that funders see.
 *   - Soft-deleted rows and the seeded DEMO cohort are filtered out so
 *     the donor view never advertises training data.
 *
 * The endpoint is cache-friendly (60s Cache-Control) so the same Caddy
 * front-door that fronts the PWA can cache the JSON between page loads.
 */
final class DonorPortal
{
    /** Minimum bucket size before a demographic slice is shown verbatim. */
    private const DEMO_MIN_BUCKET = 5;

    /** Cohort is "active" if it held a session in this many days. */
    private const ACTIVE_DAYS = 90;

    /** How many recent stories to surface in the donor highlights strip. */
    private const STORIES_LIMIT = 6;

    /** Pattern used by Demo::seed() — we exclude it from donor stats. */
    private const DEMO_COHORT_PREFIX = 'DEMO — ';

    /**
     * GET /api/public/donor-stats
     *
     * Returns:
     *   {
     *     generatedAt:     "2026-06-01T12:34:56Z",
     *     totals:          { cohorts, activeCohorts, courses, participants,
     *                        sessions, sessionsLast30, stories },
     *     attendance:      { overallPct, presentTotal, recordedTotal,
     *                        last30Pct },
     *     demographics:    { bySex:        [{ label, count, pct }],
     *                        byAgeRange:   [{ label, count, pct }],
     *                        sampleSize:   N,
     *                        threshold:    DEMO_MIN_BUCKET },
     *     trend:           [{ month: "2026-01", sessions, attendancePct,
     *                         attendanceN }],
     *     regions:         [{ region, cohorts, participants }],
     *     stories:         [{ date, region, firstName, text, hasPhoto }]
     *   }
     */
    public static function stats(): void
    {
        $pdo = Db::pdo();

        // Cache for a minute. Donor traffic is light; this keeps the SQL
        // out of the hot path when several funders refresh at once.
        header('Cache-Control: public, max-age=60');
        header('Content-Type: application/json; charset=utf-8');

        Response::json([
            'generatedAt'  => Db::nowIsoUtc(),
            'totals'       => self::totals($pdo),
            'attendance'   => self::attendance($pdo),
            'demographics' => self::demographics($pdo),
            'trend'        => self::trend($pdo),
            'regions'      => self::regions($pdo),
            'stories'      => self::stories($pdo),
        ]);
    }

    // -----------------------------------------------------------
    //  Internals
    // -----------------------------------------------------------

    /** Build the WHERE clause that excludes DEMO and tombstoned cohorts. */
    private static function cohortFilter(string $alias = 'c'): string
    {
        return "$alias.deleted_at IS NULL
                AND ($alias.name NOT LIKE '" . self::DEMO_COHORT_PREFIX . "%')";
    }

    private static function totals(\PDO $pdo): array
    {
        $cohorts = (int) $pdo->query(
            "SELECT COUNT(*) FROM cohorts c WHERE " . self::cohortFilter()
        )->fetchColumn();

        $activeCutoff = date('Y-m-d', strtotime('-' . self::ACTIVE_DAYS . ' days'));
        $stmt = $pdo->prepare(
            "SELECT COUNT(DISTINCT g.cohort_id) FROM training_sessions s
             JOIN groups_ g ON g.id = s.group_id
             JOIN cohorts c ON c.id = g.cohort_id
             WHERE s.deleted_at IS NULL AND g.deleted_at IS NULL
               AND " . self::cohortFilter() . "
               AND s.date >= ?"
        );
        $stmt->execute([$activeCutoff]);
        $activeCohorts = (int) $stmt->fetchColumn();

        $courses = (int) $pdo->query(
            "SELECT COUNT(*) FROM groups_ g
             JOIN cohorts c ON c.id = g.cohort_id
             WHERE g.deleted_at IS NULL AND " . self::cohortFilter()
        )->fetchColumn();

        $participants = (int) $pdo->query(
            "SELECT COUNT(*) FROM participants p
             JOIN groups_ g ON g.id = p.group_id
             JOIN cohorts c ON c.id = g.cohort_id
             WHERE p.deleted_at IS NULL AND g.deleted_at IS NULL AND " . self::cohortFilter()
        )->fetchColumn();

        $sessions = (int) $pdo->query(
            "SELECT COUNT(*) FROM training_sessions s
             JOIN groups_ g ON g.id = s.group_id
             JOIN cohorts c ON c.id = g.cohort_id
             WHERE s.deleted_at IS NULL AND g.deleted_at IS NULL AND " . self::cohortFilter()
        )->fetchColumn();

        $last30Cutoff = date('Y-m-d', strtotime('-30 days'));
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) FROM training_sessions s
             JOIN groups_ g ON g.id = s.group_id
             JOIN cohorts c ON c.id = g.cohort_id
             WHERE s.deleted_at IS NULL AND g.deleted_at IS NULL
               AND " . self::cohortFilter() . "
               AND s.date >= ?"
        );
        $stmt->execute([$last30Cutoff]);
        $sessionsLast30 = (int) $stmt->fetchColumn();

        // Stories: only count those with explicit consent so we don't
        // advertise an inflated number that includes private notes.
        $stories = (int) $pdo->query(
            "SELECT COUNT(*) FROM stories st
             LEFT JOIN training_sessions s ON s.id = st.session_id
             LEFT JOIN groups_ g ON g.id = s.group_id
             LEFT JOIN cohorts c ON c.id = g.cohort_id
             WHERE st.deleted_at IS NULL AND st.consent = 1
               AND (st.session_id IS NULL OR (s.deleted_at IS NULL AND g.deleted_at IS NULL
                                              AND " . self::cohortFilter() . "))"
        )->fetchColumn();

        return [
            'cohorts'        => $cohorts,
            'activeCohorts'  => $activeCohorts,
            'courses'        => $courses,
            'participants'   => $participants,
            'sessions'       => $sessions,
            'sessionsLast30' => $sessionsLast30,
            'stories'        => $stories,
        ];
    }

    private static function attendance(\PDO $pdo): array
    {
        $row = $pdo->query(
            "SELECT
               SUM(CASE WHEN a.present = 1 THEN 1 ELSE 0 END) AS present_n,
               COUNT(*) AS total_n
             FROM attendance a
             JOIN training_sessions s ON s.id = a.session_id
             JOIN groups_ g ON g.id = s.group_id
             JOIN cohorts c ON c.id = g.cohort_id
             WHERE a.deleted_at IS NULL AND s.deleted_at IS NULL AND g.deleted_at IS NULL
               AND " . self::cohortFilter()
        )->fetch();

        $present = (int) ($row['present_n'] ?? 0);
        $total   = (int) ($row['total_n']   ?? 0);
        $pct     = $total > 0 ? (int) round($present * 100 / $total) : 0;

        $cutoff = date('Y-m-d', strtotime('-30 days'));
        $stmt = $pdo->prepare(
            "SELECT
               SUM(CASE WHEN a.present = 1 THEN 1 ELSE 0 END) AS present_n,
               COUNT(*) AS total_n
             FROM attendance a
             JOIN training_sessions s ON s.id = a.session_id
             JOIN groups_ g ON g.id = s.group_id
             JOIN cohorts c ON c.id = g.cohort_id
             WHERE a.deleted_at IS NULL AND s.deleted_at IS NULL AND g.deleted_at IS NULL
               AND " . self::cohortFilter() . "
               AND s.date >= ?"
        );
        $stmt->execute([$cutoff]);
        $row30 = $stmt->fetch();
        $present30 = (int) ($row30['present_n'] ?? 0);
        $total30   = (int) ($row30['total_n']   ?? 0);
        $pct30     = $total30 > 0 ? (int) round($present30 * 100 / $total30) : 0;

        return [
            'overallPct'    => $pct,
            'presentTotal'  => $present,
            'recordedTotal' => $total,
            'last30Pct'     => $pct30,
        ];
    }

    private static function demographics(\PDO $pdo): array
    {
        // Both columns live on participants (split off users in v0.3.6+).
        // We use COALESCE to keep the donor view tidy when fields are NULL.
        $sex = $pdo->query(
            "SELECT COALESCE(NULLIF(p.sex, ''), '—') AS bucket, COUNT(*) AS n
             FROM participants p
             JOIN groups_ g ON g.id = p.group_id
             JOIN cohorts c ON c.id = g.cohort_id
             WHERE p.deleted_at IS NULL AND g.deleted_at IS NULL AND " . self::cohortFilter() . "
             GROUP BY bucket"
        )->fetchAll();

        $age = $pdo->query(
            "SELECT COALESCE(NULLIF(p.age_range, ''), '—') AS bucket, COUNT(*) AS n
             FROM participants p
             JOIN groups_ g ON g.id = p.group_id
             JOIN cohorts c ON c.id = g.cohort_id
             WHERE p.deleted_at IS NULL AND g.deleted_at IS NULL AND " . self::cohortFilter() . "
             GROUP BY bucket"
        )->fetchAll();

        $bySex      = self::squashSmallBuckets(self::labelSex($sex));
        $byAgeRange = self::squashSmallBuckets($age);

        $sampleSize = array_sum(array_column($bySex, 'count'));

        return [
            'bySex'      => $bySex,
            'byAgeRange' => $byAgeRange,
            'sampleSize' => $sampleSize,
            'threshold'  => self::DEMO_MIN_BUCKET,
        ];
    }

    /** Map F/M/NB codes to human labels — donors don't speak DB enums. */
    private static function labelSex(array $rows): array
    {
        $map = ['F' => 'Female', 'M' => 'Male', 'NB' => 'Non-binary', '—' => 'Not recorded'];
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'label' => $map[$r['bucket']] ?? $r['bucket'],
                'count' => (int) $r['n'],
            ];
        }
        return $out;
    }

    /**
     * Roll any bucket below the k-anonymity threshold into a single
     * "Other" row. Adds a `pct` field to every surviving bucket.
     */
    private static function squashSmallBuckets(array $rows): array
    {
        $smallSum = 0;
        $kept = [];
        foreach ($rows as $r) {
            $count = isset($r['count']) ? (int) $r['count'] : (int) $r['n'];
            $label = $r['label'] ?? (string) $r['bucket'];
            if ($count < self::DEMO_MIN_BUCKET) {
                $smallSum += $count;
            } else {
                $kept[] = ['label' => $label, 'count' => $count];
            }
        }
        if ($smallSum > 0) {
            $kept[] = ['label' => 'Other', 'count' => $smallSum];
        }
        $total = array_sum(array_column($kept, 'count'));
        foreach ($kept as &$row) {
            $row['pct'] = $total > 0 ? (int) round($row['count'] * 100 / $total) : 0;
        }
        // Sort largest first for a tidy bar chart.
        usort($kept, static fn ($a, $b) => $b['count'] <=> $a['count']);
        return $kept;
    }

    /** Last 6 months of attendance + session counts, oldest → newest. */
    private static function trend(\PDO $pdo): array
    {
        $cutoff = date('Y-m-01', strtotime('-5 months')); // include current month
        $stmt = $pdo->prepare(
            "SELECT
               DATE_FORMAT(s.date, '%Y-%m')                            AS month,
               COUNT(DISTINCT s.id)                                    AS sessions,
               SUM(CASE WHEN a.present = 1 THEN 1 ELSE 0 END)          AS present_n,
               SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END)       AS total_n
             FROM training_sessions s
             JOIN groups_ g ON g.id = s.group_id
             JOIN cohorts c ON c.id = g.cohort_id
             LEFT JOIN attendance a ON a.session_id = s.id AND a.deleted_at IS NULL
             WHERE s.deleted_at IS NULL AND g.deleted_at IS NULL
               AND " . self::cohortFilter() . "
               AND s.date IS NOT NULL AND s.date >= ?
             GROUP BY month
             ORDER BY month ASC"
        );
        $stmt->execute([$cutoff]);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $present = (int) ($r['present_n'] ?? 0);
            $total   = (int) ($r['total_n']   ?? 0);
            $out[] = [
                'month'         => (string) $r['month'],
                'sessions'      => (int) $r['sessions'],
                'attendancePct' => $total > 0 ? (int) round($present * 100 / $total) : 0,
                'attendanceN'   => $total,
            ];
        }
        return $out;
    }

    /** Cohort + participant counts grouped by region. */
    private static function regions(\PDO $pdo): array
    {
        $rows = $pdo->query(
            "SELECT
               COALESCE(NULLIF(c.region, ''), '—') AS region,
               COUNT(DISTINCT c.id)               AS cohorts,
               COUNT(DISTINCT p.id)               AS participants
             FROM cohorts c
             LEFT JOIN groups_ g      ON g.cohort_id = c.id AND g.deleted_at IS NULL
             LEFT JOIN participants p ON p.group_id  = g.id AND p.deleted_at IS NULL
             WHERE " . self::cohortFilter() . "
             GROUP BY region
             ORDER BY cohorts DESC, region ASC"
        )->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'region'       => (string) $r['region'],
                'cohorts'      => (int) $r['cohorts'],
                'participants' => (int) $r['participants'],
            ];
        }
        return $out;
    }

    /** Same publishable+consent filter as PublicFeed, capped for the donor view. */
    private static function stories(\PDO $pdo): array
    {
        $limit = self::STORIES_LIMIT;
        $sql = "SELECT
                  st.id, st.text, st.has_photo, st.created_at,
                  s.date AS session_date,
                  p.first_name AS first_name,
                  c.region AS region
                FROM stories st
                LEFT JOIN training_sessions s ON s.id = st.session_id
                LEFT JOIN groups_      g ON g.id = s.group_id
                LEFT JOIN cohorts      c ON c.id = g.cohort_id
                LEFT JOIN participants p ON p.id = st.participant_id
                WHERE st.deleted_at IS NULL AND st.consent = 1 AND st.publishable = 1
                  AND (st.session_id IS NULL OR (s.deleted_at IS NULL AND g.deleted_at IS NULL
                                                 AND " . self::cohortFilter() . "))
                ORDER BY COALESCE(s.date, DATE(st.created_at)) DESC, st.created_at DESC
                LIMIT ?";
        $stmt = $pdo->prepare($sql);
        $stmt->bindValue(1, $limit, \PDO::PARAM_INT);
        $stmt->execute();
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[] = [
                'id'        => (string) $r['id'],
                'text'      => self::truncate((string) ($r['text'] ?? ''), 220),
                'date'      => $r['session_date'] ?? null,
                'firstName' => (string) ($r['first_name'] ?? ''),
                'region'    => (string) ($r['region'] ?? ''),
                'hasPhoto'  => (bool) ($r['has_photo'] ?? false),
                // photoUrl is the same media path the news feed already uses.
                'photoUrl'  => ((bool) ($r['has_photo'] ?? false))
                    ? '/api/public/stories/' . $r['id'] . '/photo' : null,
            ];
        }
        return $out;
    }

    private static function truncate(string $s, int $max): string
    {
        // Strip basic HTML tags from rich-text stories so the donor portal
        // never accidentally injects markup pulled from the editor.
        $s = trim(strip_tags($s));
        if (mb_strlen($s) <= $max) return $s;
        return rtrim(mb_substr($s, 0, $max - 1)) . '…';
    }
}
