<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Sync from Ubuntu eLearning (Moodle) into Ubuntu 3.0.
 * For each group with a linked Moodle course, pulls:
 *   Step A — activities → training_sessions (source='moodle')
 *   Step B — enrolled students → participants (source='moodle')
 *
 * Strictly one-way. Records with source='user' are never touched.
 * Requires a service-account Web Services token in config moodle.ws_token.
 */
final class MoodleSync
{
    /** POST /api/admin/moodle/sync — any authenticated user can trigger a manual sync. */
    public static function syncEndpoint(): void
    {
        Auth::requireUser();
        $summary = self::syncAll();
        Response::json(['summary' => $summary]);
    }

    /**
     * GET /api/admin/moodle/news?since=<iso8601>
     * Lightweight poll endpoint for the header notification bell. Counts how
     * many Moodle-sourced rows landed (or got updated) on the server since
     * the caller's last-seen timestamp. Used by the PWA to decide whether to
     * light up the red dot.
     *
     * Response shape:
     *   {
     *     since: '<echoed iso>',
     *     latestUpdate: '<iso of newest moodle row>',
     *     newSessions: N,
     *     newParticipants: N,
     *     newCourses: N
     *   }
     */
    public static function news(): void
    {
        Auth::requireUser();
        // Accept ?since= or { since: ... } in body; default to "very old" so
        // an unset client gets a full count.
        $since = $_GET['since'] ?? null;
        if ($since === null && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
            $body = Util::jsonBody();
            $since = $body['since'] ?? null;
        }
        $since = (string) ($since ?? '1970-01-01T00:00:00Z');
        $sinceMy = Sync::isoToMysql($since);
        $pdo = Db::pdo();

        // Sessions imported (or updated) from Moodle since `since`.
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) FROM training_sessions
             WHERE source = 'moodle' AND server_updated_at > ?"
        );
        $stmt->execute([$sinceMy]);
        $newSessions = (int) $stmt->fetchColumn();

        // Participants synced from Moodle since `since`.
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) FROM participants
             WHERE source = 'moodle' AND server_updated_at > ?"
        );
        $stmt->execute([$sinceMy]);
        $newParticipants = (int) $stmt->fetchColumn();

        // Courses linked to Moodle that landed (or had their name updated) since `since`.
        // We use created_at to count NEW links; updated linked courses don't count
        // as "news" — they're routine field updates.
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) FROM groups_
             WHERE moodle_course_id IS NOT NULL
               AND deleted_at IS NULL
               AND created_at > ?"
        );
        $stmt->execute([$sinceMy]);
        $newCourses = (int) $stmt->fetchColumn();

        // Newest Moodle-sourced row timestamp (or null if nothing yet).
        $stmt = $pdo->query(
            "SELECT GREATEST(
                COALESCE((SELECT MAX(server_updated_at) FROM training_sessions WHERE source = 'moodle'), '1970-01-01'),
                COALESCE((SELECT MAX(server_updated_at) FROM participants      WHERE source = 'moodle'), '1970-01-01'),
                COALESCE((SELECT MAX(server_updated_at) FROM groups_           WHERE moodle_course_id IS NOT NULL), '1970-01-01')
             ) AS latest"
        );
        $latestRow = $stmt->fetchColumn();
        $latest = $latestRow ? Sync::mysqlToIso($latestRow) : null;

        Response::json([
            'since'           => $since,
            'latestUpdate'    => $latest,
            'newSessions'     => $newSessions,
            'newParticipants' => $newParticipants,
            'newCourses'      => $newCourses,
            'serverTime'      => Db::nowIsoUtc(),
        ]);
    }

    /**
     * POST /api/admin/moodle/sync-cron — unattended trigger for scheduled jobs.
     * Requires header X-Cron-Secret matching Config::get('moodle.cron_secret').
     * Compared with hash_equals to prevent timing attacks.
     */
    public static function cronEndpoint(): void
    {
        $expected = (string) Config::get('moodle.cron_secret', '');
        if ($expected === '') {
            Response::error('not_configured', 'moodle.cron_secret is not set in config.php', 503);
        }
        $provided = (string) ($_SERVER['HTTP_X_CRON_SECRET'] ?? '');
        if ($provided === '' || !hash_equals($expected, $provided)) {
            error_log('[ubuntu30 moodle-cron] rejected request — bad or missing X-Cron-Secret');
            Response::error('forbidden', 'Bad cron secret.', 403);
        }
        $summary = self::syncAll();
        error_log('[ubuntu30 moodle-cron] HTTP run finished: ' . json_encode($summary));
        Response::json(['summary' => $summary]);
    }

    /** Iterate every group that has a linked Moodle course and sync each. */
    public static function syncAll(): array
    {
        $base = rtrim((string) Config::get('moodle.url', ''), '/');
        $token = (string) Config::get('moodle.ws_token', '');
        if ($base === '' || $token === '') {
            return [
                'started_at' => Db::nowIsoUtc(),
                'finished_at' => Db::nowIsoUtc(),
                'skipped' => 'moodle_not_configured',
                'note' => 'Set moodle.url and moodle.ws_token in config.php.',
            ];
        }

        $pdo = Db::pdo();
        $rows = $pdo->query(
            "SELECT id, name, moodle_course_id FROM groups_
             WHERE moodle_course_id IS NOT NULL AND deleted_at IS NULL"
        )->fetchAll();

        $startedAt = Db::nowIsoUtc();
        $totals = [
            'started_at'   => $startedAt,
            'finished_at'  => null,
            'groups_linked' => count($rows),
            'sessions_created' => 0,
            'sessions_updated' => 0,
            'sessions_deleted' => 0,
            'participants_created' => 0,
            'participants_updated' => 0,
            'participants_deleted' => 0,
            'errors' => [],
        ];

        foreach ($rows as $g) {
            try {
                $r = self::syncGroup($g, $base, $token);
                foreach (['sessions_created','sessions_updated','sessions_deleted',
                          'participants_created','participants_updated','participants_deleted'] as $k) {
                    $totals[$k] += $r[$k] ?? 0;
                }
            } catch (\Throwable $e) {
                error_log('[ubuntu30 moodle-sync] group ' . $g['id'] . ' failed: ' . $e->getMessage());
                $totals['errors'][] = [
                    'group_id'   => $g['id'],
                    'group_name' => $g['name'],
                    'error'      => $e->getMessage(),
                ];
            }
        }

        $totals['finished_at'] = Db::nowIsoUtc();
        return $totals;
    }

    // -----------------------------------------------------------
    //  One group
    // -----------------------------------------------------------

    private static function syncGroup(array $group, string $base, string $token): array
    {
        $courseId = (int) $group['moodle_course_id'];
        $groupId  = (string) $group['id'];

        $activities = self::fetchActivities($base, $token, $courseId);
        $students   = self::fetchEnrolments($base, $token, $courseId);

        return array_merge(
            self::reconcileSessions($groupId, $activities),
            self::reconcileParticipants($groupId, $students)
        );
    }

    // -----------------------------------------------------------
    //  Step A — activities → sessions
    // -----------------------------------------------------------

    /** @return array<int, array{id:int, name:string}> */
    private static function fetchActivities(string $base, string $token, int $courseId): array
    {
        $url  = $base . '/webservice/rest/server.php';
        $resp = self::http('POST', $url, [
            'wstoken'             => $token,
            'wsfunction'          => 'core_course_get_contents',
            'moodlewsrestformat'  => 'json',
            'courseid'            => (string) $courseId,
        ]);
        if ($resp === null) throw new \RuntimeException('Failed to call core_course_get_contents');
        $data = json_decode($resp, true);
        if (!is_array($data) || isset($data['exception'])) {
            $msg = is_array($data) ? ($data['message'] ?? 'Unknown') : 'Bad response';
            throw new \RuntimeException('core_course_get_contents error: ' . $msg);
        }
        $out = [];
        foreach ($data as $section) {
            if (!is_array($section) || empty($section['modules'])) continue;
            foreach ($section['modules'] as $mod) {
                if (!is_array($mod) || empty($mod['id'])) continue;
                $out[] = [
                    'id'   => (int) $mod['id'],
                    'name' => (string) ($mod['name'] ?? 'Activity'),
                ];
            }
        }
        return $out;
    }

    private static function reconcileSessions(string $groupId, array $activities): array
    {
        $pdo = Db::pdo();
        $now = Db::nowUtc();

        // existing moodle-sourced sessions for this group
        $stmt = $pdo->prepare(
            "SELECT id, moodle_activity_id, theme, deleted_at
             FROM training_sessions
             WHERE group_id = ? AND source = 'moodle'"
        );
        $stmt->execute([$groupId]);
        $existing = [];
        foreach ($stmt->fetchAll() as $r) {
            $existing[(int) $r['moodle_activity_id']] = $r;
        }

        $created = 0; $updated = 0; $deleted = 0;
        $seenActivityIds = [];

        foreach ($activities as $act) {
            $aid = (int) $act['id'];
            $seenActivityIds[$aid] = true;
            $theme = $act['name'];

            if (isset($existing[$aid])) {
                $row = $existing[$aid];
                // Resurrect if previously deleted, and/or update theme
                $needsTheme   = ((string) $row['theme']) !== $theme;
                $needsRestore = $row['deleted_at'] !== null;
                if ($needsTheme || $needsRestore) {
                    $sets = [];
                    $vals = [];
                    if ($needsTheme)   { $sets[] = 'theme = ?';      $vals[] = $theme; }
                    if ($needsRestore) { $sets[] = 'deleted_at = NULL'; }
                    $sets[] = 'server_updated_at = ?'; $vals[] = $now;
                    $vals[] = $row['id'];
                    $pdo->prepare(
                        'UPDATE training_sessions SET ' . implode(', ', $sets) . ' WHERE id = ?'
                    )->execute($vals);
                    $updated++;
                }
            } else {
                // Create new — default the session date to today so it shows up in
                // current-month dashboard KPIs. Trainers can edit afterwards.
                $newId = Util::uuid();
                $today = gmdate('Y-m-d');
                $pdo->prepare(
                    "INSERT INTO training_sessions
                     (id, group_id, date, theme, location, notes, source, moodle_activity_id,
                      author_id, client_updated_at, server_updated_at, created_at)
                     VALUES (?,?,?,?,NULL,NULL,'moodle',?,NULL,?,?,?)"
                )->execute([$newId, $groupId, $today, $theme, $aid, $now, $now, $now]);
                $created++;
            }
        }

        // Soft-delete sessions that disappeared from eLearning
        foreach ($existing as $aid => $row) {
            if (isset($seenActivityIds[$aid])) continue;
            if ($row['deleted_at'] !== null) continue;
            $pdo->prepare(
                "UPDATE training_sessions
                 SET deleted_at = ?, server_updated_at = ? WHERE id = ?"
            )->execute([$now, $now, $row['id']]);
            $deleted++;
        }

        return [
            'sessions_created' => $created,
            'sessions_updated' => $updated,
            'sessions_deleted' => $deleted,
        ];
    }

    // -----------------------------------------------------------
    //  Step B — enrolled students → participants
    // -----------------------------------------------------------

    /** @return array<int, array{id:int, username:string, email:string, firstname:string, lastname:string}> */
    private static function fetchEnrolments(string $base, string $token, int $courseId): array
    {
        $url  = $base . '/webservice/rest/server.php';
        $resp = self::http('POST', $url, [
            'wstoken'             => $token,
            'wsfunction'          => 'core_enrol_get_enrolled_users',
            'moodlewsrestformat'  => 'json',
            'courseid'            => (string) $courseId,
        ]);
        if ($resp === null) throw new \RuntimeException('Failed to call core_enrol_get_enrolled_users');
        $data = json_decode($resp, true);
        if (!is_array($data) || isset($data['exception'])) {
            $msg = is_array($data) ? ($data['message'] ?? 'Unknown') : 'Bad response';
            throw new \RuntimeException('core_enrol_get_enrolled_users error: ' . $msg);
        }
        $out = [];
        foreach ($data as $u) {
            if (!is_array($u) || empty($u['id'])) continue;
            // Keep only "student" role members. If roles array is missing, keep them (some
            // sites don't enforce roles for the WS).
            if (!empty($u['roles']) && is_array($u['roles'])) {
                $isStudent = false;
                foreach ($u['roles'] as $r) {
                    if (!is_array($r)) continue;
                    if (($r['shortname'] ?? '') === 'student') { $isStudent = true; break; }
                }
                if (!$isStudent) continue;
            }
            $out[] = [
                'id'        => (int) $u['id'],
                'username'  => (string) ($u['username']  ?? ''),
                'email'     => (string) ($u['email']     ?? ''),
                'firstname' => (string) ($u['firstname'] ?? ''),
                'lastname'  => (string) ($u['lastname']  ?? ''),
                // v0.3.5g — capture Moodle's suspended flag so we can mirror it as
                // user.disabled_at + participant.status='dropped' on the Ubuntu side
                'suspended' => !empty($u['suspended']),
            ];
        }
        return $out;
    }

    private static function reconcileParticipants(string $groupId, array $students): array
    {
        $pdo = Db::pdo();
        $now = Db::nowUtc();

        // Existing moodle-sourced participants in this group
        $stmt = $pdo->prepare(
            "SELECT id, user_id, moodle_user_id, first_name, last_name, contact, status, deleted_at
             FROM participants
             WHERE group_id = ? AND source = 'moodle'"
        );
        $stmt->execute([$groupId]);
        $existing = [];
        foreach ($stmt->fetchAll() as $r) {
            $existing[(int) $r['moodle_user_id']] = $r;
        }

        $created = 0; $updated = 0; $deleted = 0;
        $seenUserIds = [];

        foreach ($students as $s) {
            $uid = (int) $s['id'];
            $seenUserIds[$uid] = true;
            $fn = $s['firstname'] !== '' ? $s['firstname'] : $s['username'];
            $ln = $s['lastname'];
            $contact = $s['email'];
            $suspended = !empty($s['suspended']);
            // v0.3.5g — mirror Moodle's suspended flag onto participant.status
            $targetStatus = $suspended ? 'dropped' : 'active';

            // v0.3.5: upsert the corresponding users.id (role='trainee') so the
            // participant always points at a real user row.
            $userId = self::upsertTraineeUserFromMoodle($uid, $fn, $ln, $contact, $suspended, $now);

            if (isset($existing[$uid])) {
                $row = $existing[$uid];
                $sets = [];
                $vals = [];
                if ((string) $row['first_name'] !== $fn) { $sets[] = 'first_name = ?'; $vals[] = $fn; }
                if ((string) $row['last_name']  !== $ln) { $sets[] = 'last_name = ?';  $vals[] = $ln; }
                if ((string) ($row['contact'] ?? '') !== $contact) { $sets[] = 'contact = ?'; $vals[] = $contact; }
                if ($row['deleted_at'] !== null) { $sets[] = 'deleted_at = NULL'; }
                // Backfill user_id on existing participants too (idempotent)
                if (empty($row['user_id']) && $userId) {
                    $sets[] = 'user_id = ?'; $vals[] = $userId;
                }
                // Reflect Moodle's enrolment status into our participant status
                if (((string) ($row['status'] ?? 'active')) !== $targetStatus) {
                    $sets[] = 'status = ?'; $vals[] = $targetStatus;
                }
                if ($sets) {
                    $sets[] = 'server_updated_at = ?'; $vals[] = $now;
                    $vals[] = $row['id'];
                    $pdo->prepare(
                        'UPDATE participants SET ' . implode(', ', $sets) . ' WHERE id = ?'
                    )->execute($vals);
                    $updated++;
                }
            } else {
                $newId = Util::uuid();
                $pdo->prepare(
                    "INSERT INTO participants
                     (id, user_id, group_id, first_name, last_name, sex, age_range, contact, source, status, moodle_user_id,
                      author_id, client_updated_at, server_updated_at, created_at)
                     VALUES (?,?,?,?,?,NULL,NULL,?,'moodle',?,?,NULL,?,?,?)"
                )->execute([$newId, $userId, $groupId, $fn, $ln, $contact, $targetStatus, $uid, $now, $now, $now]);
                $created++;
            }
        }

        // Soft-delete moodle-sourced participants no longer enrolled
        foreach ($existing as $uid => $row) {
            if (isset($seenUserIds[$uid])) continue;
            if ($row['deleted_at'] !== null) continue;
            $pdo->prepare(
                "UPDATE participants
                 SET deleted_at = ?, server_updated_at = ? WHERE id = ?"
            )->execute([$now, $now, $row['id']]);
            $deleted++;
        }

        return [
            'participants_created' => $created,
            'participants_updated' => $updated,
            'participants_deleted' => $deleted,
        ];
    }

    // -----------------------------------------------------------
    //  v0.3.5 — upsert a `users` row for each Moodle student so participants
    //  can link to a single canonical user (and walk-ins / Moodle trainees
    //  share the same directory).
    // -----------------------------------------------------------

    /**
     * Find or create a trainee user for a Moodle student. Returns the user's UUID.
     *
     * Lookup order: users.moodle_user_id -> users.email -> insert new.
     *
     * Trainees never log in; we store an intentionally-invalid placeholder hash.
     *
     * v0.3.5g — on every call, refresh name / email / role on the linked user
     * so changes in Moodle (rename, email change, role change) propagate.
     * Reflect Moodle's "suspended" flag as users.disabled_at.
     */
    private static function upsertTraineeUserFromMoodle(int $moodleUserId, string $first, string $last, string $email, bool $suspended, string $now): ?string
    {
        $pdo = Db::pdo();
        $emailLower = strtolower(trim($email));
        $emailValid = $emailLower !== '' && filter_var($emailLower, FILTER_VALIDATE_EMAIL);
        $name       = trim($first . ' ' . $last);
        $disabledAt = $suspended ? $now : null;

        // (1) Already linked by Moodle user id — refresh fields.
        $stmt = $pdo->prepare('SELECT id, email, first_name, last_name, name, role, disabled_at FROM users WHERE moodle_user_id = ? LIMIT 1');
        $stmt->execute([$moodleUserId]);
        $row = $stmt->fetch();
        if ($row) {
            self::refreshTraineeUser($row, $emailValid ? $emailLower : null, $first, $last, $name, $disabledAt, $now);
            return (string) $row['id'];
        }

        // (2) Match by email (if Moodle gave us one).
        if ($emailValid) {
            $stmt = $pdo->prepare('SELECT id, email, first_name, last_name, name, role, disabled_at FROM users WHERE email = ? LIMIT 1');
            $stmt->execute([$emailLower]);
            $row = $stmt->fetch();
            if ($row) {
                // Backfill the Moodle id + refresh fields
                $pdo->prepare('UPDATE users SET moodle_user_id = ?, updated_at = ? WHERE id = ?')
                    ->execute([$moodleUserId, $now, $row['id']]);
                self::refreshTraineeUser($row, $emailLower, $first, $last, $name, $disabledAt, $now);
                return (string) $row['id'];
            }
        }

        // (3) Create a new trainee user.
        $newId    = Util::uuid();
        $useEmail = $emailValid ? $emailLower : 'moodle-' . $moodleUserId . '@ubuntu3.local';
        try {
            $pdo->prepare(
                'INSERT INTO users
                 (id, email, username, password_hash, name, first_name, last_name,
                  role, language, must_change_password, moodle_user_id, disabled_at, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?)'
            )->execute([
                $newId, $useEmail, $useEmail, '!disabled-trainee-account!',
                $name, $first ?: 'Unknown', $last ?: '', 'trainee', 'fr',
                $moodleUserId, $disabledAt, $now, $now,
            ]);
            return $newId;
        } catch (\PDOException $e) {
            // 1062 = duplicate. Two syncs may have raced. Re-query and return.
            if (($e->errorInfo[1] ?? 0) === 1062) {
                $stmt = $pdo->prepare('SELECT id FROM users WHERE moodle_user_id = ? OR email = ? LIMIT 1');
                $stmt->execute([$moodleUserId, $useEmail]);
                $id = $stmt->fetchColumn();
                if ($id) return (string) $id;
            }
            error_log('[ubuntu30 moodle-sync] upsertTraineeUserFromMoodle failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Apply a fresh snapshot of Moodle-known fields to an existing user.
     * Only writes changed values. Always forces role='trainee' for Moodle-synced
     * trainees (in case they were created with an older role).
     */
    private static function refreshTraineeUser(array $existing, ?string $emailFromMoodle, string $first, string $last, string $name, ?string $disabledAt, string $now): void
    {
        $sets = [];
        $vals = [];

        // Only overwrite the email when Moodle has a real one AND the existing
        // is synthetic — never clobber a legitimate user-provided email.
        if ($emailFromMoodle !== null) {
            $current = (string) ($existing['email'] ?? '');
            $isSynthetic = str_ends_with($current, '@ubuntu3.local');
            if ($current === '' || $isSynthetic || strcasecmp($current, $emailFromMoodle) === 0 ? false : true) {
                // Only refresh email if current looks like a placeholder
                if ($isSynthetic || $current === '') {
                    if ($current !== $emailFromMoodle) {
                        $sets[] = 'email = ?';    $vals[] = $emailFromMoodle;
                        $sets[] = 'username = ?'; $vals[] = $emailFromMoodle;
                    }
                }
            }
        }
        if ($first !== '' && ((string) ($existing['first_name'] ?? '')) !== $first) {
            $sets[] = 'first_name = ?'; $vals[] = $first;
        }
        if ($last !== '' && ((string) ($existing['last_name'] ?? '')) !== $last) {
            $sets[] = 'last_name = ?';  $vals[] = $last;
        }
        if ($name !== '' && ((string) ($existing['name'] ?? '')) !== $name) {
            $sets[] = 'name = ?';        $vals[] = $name;
        }
        // Force role to trainee for Moodle-synced students (the spec says so).
        if (($existing['role'] ?? '') !== 'trainee') {
            $sets[] = 'role = ?';        $vals[] = 'trainee';
        }
        // Mirror Moodle's suspended flag onto disabled_at — only flip when the
        // state actually changes so we don't churn updated_at every sync.
        $currentDisabled = $existing['disabled_at'] !== null;
        $shouldDisable   = $disabledAt !== null;
        if ($currentDisabled !== $shouldDisable) {
            $sets[] = 'disabled_at = ?'; $vals[] = $disabledAt;
        }

        if ($sets) {
            $sets[] = 'updated_at = ?'; $vals[] = $now;
            $vals[] = $existing['id'];
            Db::pdo()->prepare('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?')
                ->execute($vals);
        }
    }

    private static function http(string $method, string $url, array $fields): ?string
    {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
        ];
        if ($method === 'POST') {
            $opts[CURLOPT_POST]       = true;
            $opts[CURLOPT_POSTFIELDS] = http_build_query($fields);
        }
        curl_setopt_array($ch, $opts);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($body === false || $code !== 200) {
            error_log(sprintf('[ubuntu30 moodle-sync] HTTP %s %s → code=%d err=%s', $method, $url, $code, $err));
            return null;
        }
        return is_string($body) ? $body : null;
    }
}
