<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Sample-data toggle — v0.3.8
 *
 * Admin-only utility for spinning up a self-contained "DEMO" cohort full of
 * fake data so new trainers can poke around the PWA without polluting the
 * real M&E corpus. One click creates it on the server; on the trainer's
 * next sync it shows up alongside their real cohorts. A second button (or
 * a second POST) deletes the entire subtree just as cleanly.
 *
 * Design notes
 * ------------
 *  • Idempotent — every entity is tagged with the prefix "DEMO — " in its
 *    user-visible name, and `Demo::findDemoCohortId()` looks for the cohort
 *    by name. Two consecutive "create" clicks return the existing tree
 *    instead of stacking duplicates.
 *  • No schema change — we lean on the name prefix instead of an `is_demo`
 *    column so this can ship without a migration.
 *  • Soft-delete to play nicely with the sync protocol — every device that
 *    has already pulled the demo data will see tombstones on next sync and
 *    drop the rows locally. We do NOT hard-delete; the rows linger with
 *    deleted_at set, which is exactly how every other delete in this app
 *    works. The cleanup endpoint's response is the count of rows tombstoned.
 *  • The shape (2 courses, 10 participants/course, 5 sessions/course,
 *    ~70 % attendance, 2 stories) is chosen to populate every screen on
 *    the dashboard / reports without being noisy. Tunable in CONFIG.
 */
final class Demo
{
    private const COHORT_PREFIX = 'DEMO — ';

    /** Tunables for the seed shape. Adjust here; everything else flows. */
    private const CONFIG = [
        'cohortName'     => 'DEMO — Sandbox cohort',
        'cohortRegion'   => 'Demo region',
        'courses'        => [
            ['name' => 'DEMO — Leadership 101',  'theme' => 'Leadership'],
            ['name' => 'DEMO — Civic skills',    'theme' => 'Civic engagement'],
        ],
        'participantsPerCourse' => 10,
        'sessionsPerCourse'     => 5,
        'attendanceRate'        => 0.72,    // ~72 % present, varied per row
        'storiesPerCourse'      => 2,
    ];

    /**
     * POST /api/admin/demo/seed
     *
     * Creates the demo cohort if it doesn't exist yet; otherwise returns the
     * existing one untouched. Always returns a summary so the admin UI can
     * render "you now have N participants / M sessions" toasts.
     */
    public static function seed(): void
    {
        $admin = Auth::requireAdmin();
        $pdo = Db::pdo();

        $existingId = self::findDemoCohortId($pdo);
        if ($existingId !== null) {
            Response::json(self::summary($pdo, $existingId, /*created*/ false));
            return;
        }

        $now = Db::nowUtc();
        $authorId = (string) $admin['id'];

        $pdo->beginTransaction();
        try {
            // ----- Cohort -----
            $cohortId = Util::uuid();
            $stmt = $pdo->prepare(
                "INSERT INTO cohorts (id, name, region, start_date, end_date,
                                      author_id, client_updated_at, server_updated_at, created_at)
                 VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)"
            );
            $start = date('Y-m-d', strtotime('-3 months'));
            $stmt->execute([
                $cohortId,
                self::CONFIG['cohortName'],
                self::CONFIG['cohortRegion'],
                $start, $authorId, $now, $now, $now,
            ]);

            // ----- Courses + their participants + sessions + attendance + stories -----
            foreach (self::CONFIG['courses'] as $courseIdx => $course) {
                $groupId = Util::uuid();
                $stmt = $pdo->prepare(
                    "INSERT INTO groups_ (id, cohort_id, name, facilitator,
                                          author_id, client_updated_at, server_updated_at, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                );
                $stmt->execute([
                    $groupId, $cohortId, $course['name'], 'DEMO Facilitator',
                    $authorId, $now, $now, $now,
                ]);

                // Participants (mixed sex + age range so demographics tiles light up)
                $participantIds = [];
                for ($i = 0; $i < self::CONFIG['participantsPerCourse']; $i++) {
                    $pid = Util::uuid();
                    $sex  = ['F', 'M', 'F', 'M', 'F', 'M', 'F', 'M', 'NB', 'F'][$i] ?? 'F';
                    $age  = ['18-24', '25-34', '35-44', '18-24', '25-34',
                             '35-44', '45-54', '18-24', '25-34', '35-44'][$i] ?? '25-34';
                    $first = self::FIRST_NAMES[$courseIdx * 10 + $i % count(self::FIRST_NAMES)];
                    $last  = self::LAST_NAMES[($courseIdx * 7 + $i) % count(self::LAST_NAMES)];
                    $stmt = $pdo->prepare(
                        "INSERT INTO participants (id, group_id, first_name, last_name, sex, age_range,
                                                   author_id, client_updated_at, server_updated_at, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    );
                    $stmt->execute([
                        $pid, $groupId, $first, $last, $sex, $age,
                        $authorId, $now, $now, $now,
                    ]);
                    $participantIds[] = $pid;
                }

                // Sessions — spread across the last ~10 weeks, theme rotates
                $sessionIds = [];
                for ($s = 0; $s < self::CONFIG['sessionsPerCourse']; $s++) {
                    $sid = Util::uuid();
                    $daysAgo = (self::CONFIG['sessionsPerCourse'] - $s) * 14; // every 2 weeks
                    $sessionDate = date('Y-m-d', strtotime('-' . $daysAgo . ' days'));
                    $theme = $course['theme'] . ' · session ' . ($s + 1);
                    $stmt = $pdo->prepare(
                        "INSERT INTO training_sessions (id, group_id, date, theme, location, notes,
                                                        author_id, client_updated_at, server_updated_at, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    );
                    $stmt->execute([
                        $sid, $groupId, $sessionDate, $theme, 'Community hall',
                        'Sample session for trainer practice. Safe to edit or delete.',
                        $authorId, $now, $now, $now,
                    ]);
                    $sessionIds[] = $sid;

                    // Attendance: ~72 % present, deterministic per row so the
                    // demo looks the same every time but isn't monotonous.
                    foreach ($participantIds as $pIdx => $pid) {
                        $hash = (int) (crc32($sid . $pid) & 0x7fffffff);
                        $present = ($hash % 100) < (int) (self::CONFIG['attendanceRate'] * 100) ? 1 : 0;
                        $stmt = $pdo->prepare(
                            "INSERT INTO attendance (id, session_id, participant_id, present,
                                                     author_id, client_updated_at, server_updated_at, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                        );
                        $stmt->execute([
                            Util::uuid(), $sid, $pid, $present,
                            $authorId, $now, $now, $now,
                        ]);
                    }
                }

                // Stories — pick the first N participants in the first N sessions
                $storySamples = [
                    "Aujourd'hui j'ai appris à mieux écouter mon équipe. (DEMO)",
                    "I felt heard for the first time in this group. (DEMO)",
                    'Narakomeza kwiga gushikira intumbero zanje. (DEMO)',
                ];
                for ($k = 0; $k < self::CONFIG['storiesPerCourse']; $k++) {
                    $stmt = $pdo->prepare(
                        "INSERT INTO stories (id, session_id, participant_id, text, consent,
                                              author_id, client_updated_at, server_updated_at, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    );
                    $stmt->execute([
                        Util::uuid(),
                        $sessionIds[$k % count($sessionIds)],
                        $participantIds[$k % count($participantIds)],
                        $storySamples[$k % count($storySamples)],
                        1,                          // consent yes — they're fake people
                        $authorId, $now, $now, $now,
                    ]);
                }
            }

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            Response::error('server_error', 'Demo seed failed: ' . $e->getMessage(), 500);
            return;
        }

        Response::json(self::summary($pdo, $cohortId, /*created*/ true));
    }

    /**
     * POST /api/admin/demo/remove
     *
     * Soft-deletes the demo cohort plus every course, participant, session,
     * attendance row, and story that lives under it. Sync push from any
     * device will then drop the rows locally. Idempotent — returns
     * {removed:false} if there was no demo cohort to begin with.
     */
    public static function remove(): void
    {
        Auth::requireAdmin();
        $pdo = Db::pdo();
        $cohortId = self::findDemoCohortId($pdo);
        if ($cohortId === null) {
            Response::json(['removed' => false]);
            return;
        }

        $now = Db::nowUtc();
        $pdo->beginTransaction();
        try {
            // groups under cohort
            $groupIds = $pdo->prepare("SELECT id FROM groups_ WHERE cohort_id = ? AND deleted_at IS NULL");
            $groupIds->execute([$cohortId]);
            $gIds = array_column($groupIds->fetchAll(), 'id');

            // sessions under groups
            $sIds = [];
            $pIds = [];
            if ($gIds) {
                $place = implode(',', array_fill(0, count($gIds), '?'));
                $sStmt = $pdo->prepare("SELECT id FROM training_sessions WHERE group_id IN ($place) AND deleted_at IS NULL");
                $sStmt->execute($gIds);
                $sIds = array_column($sStmt->fetchAll(), 'id');

                $pStmt = $pdo->prepare("SELECT id FROM participants WHERE group_id IN ($place) AND deleted_at IS NULL");
                $pStmt->execute($gIds);
                $pIds = array_column($pStmt->fetchAll(), 'id');
            }

            $touched = 0;
            $touched += self::tombstone($pdo, 'attendance', 'session_id', $sIds, $now);
            $touched += self::tombstone($pdo, 'stories',    'session_id', $sIds, $now);
            $touched += self::tombstone($pdo, 'training_sessions', 'id', $sIds, $now);
            $touched += self::tombstone($pdo, 'participants',      'id', $pIds, $now);
            $touched += self::tombstone($pdo, 'groups_',           'id', $gIds, $now);
            $touched += self::tombstone($pdo, 'cohorts',           'id', [$cohortId], $now);

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            Response::error('server_error', 'Demo cleanup failed: ' . $e->getMessage(), 500);
            return;
        }

        Response::json([
            'removed' => true,
            'tombstoned' => $touched,
        ]);
    }

    /**
     * GET /api/admin/demo/status
     *
     * Lightweight probe used by the admin UI to decide which CTA to show
     * (Create vs. Remove). Returns the same summary shape as seed() but
     * with `present: false` when no demo cohort exists.
     */
    public static function status(): void
    {
        Auth::requireAdmin();
        $pdo = Db::pdo();
        $cohortId = self::findDemoCohortId($pdo);
        if ($cohortId === null) {
            Response::json(['present' => false]);
            return;
        }
        Response::json(self::summary($pdo, $cohortId, /*created*/ false));
    }

    // -----------------------------------------------------------
    //  Internals
    // -----------------------------------------------------------

    /** @return ?string Cohort id, or null if no demo cohort is present. */
    private static function findDemoCohortId(\PDO $pdo): ?string
    {
        $stmt = $pdo->prepare(
            "SELECT id FROM cohorts
             WHERE deleted_at IS NULL AND name LIKE ?
             ORDER BY created_at ASC
             LIMIT 1"
        );
        $stmt->execute([self::COHORT_PREFIX . '%']);
        $row = $stmt->fetch();
        return $row ? (string) $row['id'] : null;
    }

    /** Tombstone all rows in $table whose $idCol is in $ids. Returns row count. */
    private static function tombstone(\PDO $pdo, string $table, string $idCol, array $ids, string $now): int
    {
        if (!$ids) return 0;
        $place = implode(',', array_fill(0, count($ids), '?'));
        $sql = "UPDATE `$table` SET deleted_at = ?, server_updated_at = ?
                WHERE `$idCol` IN ($place) AND deleted_at IS NULL";
        $stmt = $pdo->prepare($sql);
        $stmt->execute(array_merge([$now, $now], $ids));
        return $stmt->rowCount();
    }

    /** Build the summary payload describing the demo cohort's contents. */
    private static function summary(\PDO $pdo, string $cohortId, bool $created): array
    {
        $count = function (string $sql, array $params) use ($pdo): int {
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            return (int) $stmt->fetchColumn();
        };
        $courses      = $count("SELECT COUNT(*) FROM groups_ WHERE cohort_id = ? AND deleted_at IS NULL", [$cohortId]);
        $participants = $count("SELECT COUNT(*) FROM participants p
                                JOIN groups_ g ON g.id = p.group_id
                                WHERE g.cohort_id = ? AND p.deleted_at IS NULL", [$cohortId]);
        $sessions     = $count("SELECT COUNT(*) FROM training_sessions s
                                JOIN groups_ g ON g.id = s.group_id
                                WHERE g.cohort_id = ? AND s.deleted_at IS NULL", [$cohortId]);
        $attendance   = $count("SELECT COUNT(*) FROM attendance a
                                JOIN training_sessions s ON s.id = a.session_id
                                JOIN groups_ g ON g.id = s.group_id
                                WHERE g.cohort_id = ? AND a.deleted_at IS NULL", [$cohortId]);
        $stories      = $count("SELECT COUNT(*) FROM stories st
                                JOIN training_sessions s ON s.id = st.session_id
                                JOIN groups_ g ON g.id = s.group_id
                                WHERE g.cohort_id = ? AND st.deleted_at IS NULL", [$cohortId]);

        return [
            'present'      => true,
            'created'      => $created,
            'cohortId'     => $cohortId,
            'cohortName'   => self::CONFIG['cohortName'],
            'courses'      => $courses,
            'participants' => $participants,
            'sessions'     => $sessions,
            'attendance'   => $attendance,
            'stories'      => $stories,
        ];
    }

    /** First-name pool — multilingual on purpose so the demo feels Burundian. */
    private const FIRST_NAMES = [
        'Aline', 'Jean', 'Claudine', 'Eric', 'Diane', 'Patrick',
        'Sandrine', 'David', 'Liliane', 'Olivier',
        'Marie', 'Joseph', 'Esperance', 'Gilbert', 'Chantal',
        'Bertin', 'Yvette', 'Donatien', 'Lydie', 'Pacifique',
    ];
    /** Last-name pool — common Burundian surnames. */
    private const LAST_NAMES = [
        'Niyonkuru', 'Bukuru', 'Ndayisenga', 'Habonimana', 'Nshimirimana',
        'Ndayikengurukiye', 'Ntahonkiriye', 'Sindayigaya', 'Manirakiza', 'Bigirimana',
    ];
}
