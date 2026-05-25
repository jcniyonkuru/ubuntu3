<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Admin-only user management. Phase A: list + create (with temp password).
 * Phase B will add invite emails, password resets, and a UI.
 */
final class Users
{
    /** GET /api/users — admin only. */
    public static function list(): void
    {
        Auth::requireAdmin();
        $pdo = Db::pdo();
        $rows = $pdo->query(
            'SELECT id, email, phone, username, name, first_name, last_name, sex, age_range, role, language,
                    created_at, last_login_at, disabled_at, must_change_password
             FROM users ORDER BY created_at DESC'
        )->fetchAll();
        Response::json(['users' => array_map(static function ($r) {
            return [
                'id' => $r['id'],
                'email' => $r['email'],
                'phone' => $r['phone'] ?? null,
                'username' => $r['username'] ?? $r['email'],
                'firstName' => $r['first_name'] ?? '',
                'lastName'  => $r['last_name']  ?? '',
                'name' => $r['name'],
                'sex'      => $r['sex']       ?? null,
                'ageRange' => $r['age_range'] ?? null,
                'role' => $r['role'],
                'language' => $r['language'],
                'createdAt' => $r['created_at'],
                'lastLoginAt' => $r['last_login_at'],
                'disabledAt' => $r['disabled_at'],
                'mustChangePassword' => (bool) $r['must_change_password'],
            ];
        }, $rows)]);
    }

    /**
     * POST /api/users — admin only.
     * Body: { firstName, lastName, email, role?, language?, password?, username? }
     *
     * v0.3.4 — firstName, lastName, email are all mandatory. Email is the
     * unique identifier. `name` is auto-derived as "firstName lastName" for
     * backward compatibility.
     */
    public static function create(): void
    {
        // v0.3.7 — trainers may also create trainees from the PWA picker (the
        // "+ Create a new person" expander on a course). We allow that
        // specific path here and enforce admin-only for everything else
        // (creating staff, sending invites, etc.) further below.
        $caller = Auth::requireUser();
        $body = Util::jsonBody();

        $email     = strtolower(trim((string) ($body['email'] ?? '')));
        $firstName = trim((string) ($body['firstName'] ?? $body['first_name'] ?? ''));
        $lastName  = trim((string) ($body['lastName']  ?? $body['last_name']  ?? ''));
        $username  = strtolower(trim((string) ($body['username'] ?? '')));
        $sex       = trim((string) ($body['sex'] ?? ''));
        $ageRange  = trim((string) ($body['ageRange'] ?? $body['age_range'] ?? ''));
        $phone     = trim((string) ($body['phone'] ?? ''));
        if ($sex !== '' && !in_array($sex, ['F','M','O'], true)) $sex = '';
        if (mb_strlen($phone) > 50) Response::error('bad_request', 'Phone too long.', 400);
        $rawRole   = (string) ($body['role'] ?? 'trainer');
        $role      = in_array($rawRole, ['admin','trainer','trainee'], true) ? $rawRole : 'trainer';
        $lang      = $body['language'] ?? 'fr';
        if (!in_array($lang, ['fr', 'en', 'rn'], true)) $lang = 'fr';
        // sendInvite controls whether a welcome email is dispatched. Defaults to TRUE
        // for trainers/admins (existing behavior) and FALSE for trainees (walk-ins).
        $sendInvite = array_key_exists('sendInvite', $body) ? (bool) $body['sendInvite'] : ($role !== 'trainee');

        // Authorization: trainers may create trainees with sendInvite=false
        // (the only path the PWA picker uses). Anything else stays admin-only.
        $callerIsAdmin = ($caller['role'] === 'admin');
        if (!$callerIsAdmin) {
            $allowedForTrainer = ($role === 'trainee' && $sendInvite === false);
            if (!$allowedForTrainer) {
                Response::error('forbidden', 'Admin role required.', 403);
            }
        }

        if ($firstName === '') Response::error('bad_request', 'First name required.', 400);
        if ($lastName  === '') Response::error('bad_request', 'Last name required.', 400);
        if (mb_strlen($firstName) > 80) Response::error('bad_request', 'First name too long.', 400);
        if (mb_strlen($lastName)  > 80) Response::error('bad_request', 'Last name too long.', 400);

        $id = Util::uuid();
        // For trainees, allow an empty email and synthesize one. Trainers/admins
        // still need a real email (they receive the invite there).
        if ($role === 'trainee') {
            if ($email === '') {
                $email = 'trainee-' . $id . '@ubuntu3.local';
            } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                Response::error('bad_request', 'Email must be a valid address (or leave it blank to auto-generate).', 400);
            }
        } else {
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) Response::error('bad_request', 'Valid email required.', 400);
        }

        // v0.3.5g — trainee reuse-by-email. If a user already exists with this
        // (real) email, return it instead of creating a duplicate. Synthetic
        // emails (trainee-<uuid>@ubuntu3.local) are skipped because they're
        // unique per insert by definition.
        $isSynthetic = str_ends_with($email, '@ubuntu3.local');
        if ($role === 'trainee' && !$isSynthetic) {
            $stmt = Db::pdo()->prepare(
                'SELECT id, email, phone, username, name, first_name, last_name, sex, age_range, role, language, must_change_password
                 FROM users WHERE email = ? LIMIT 1'
            );
            $stmt->execute([$email]);
            $existing = $stmt->fetch();
            if ($existing) {
                // Best-effort backfill: if the existing user has empty
                // demographics and we now know them, fill them in. (Don't
                // overwrite anything that's already set.)
                $patches = [];
                $vals = [];
                if (empty($existing['first_name']) && $firstName !== '') { $patches[] = 'first_name = ?'; $vals[] = $firstName; }
                if (empty($existing['last_name'])  && $lastName  !== '') { $patches[] = 'last_name = ?';  $vals[] = $lastName; }
                if (empty($existing['phone'])      && $phone     !== '') { $patches[] = 'phone = ?';      $vals[] = $phone; }
                if (empty($existing['sex'])        && $sex       !== '') { $patches[] = 'sex = ?';        $vals[] = $sex; }
                if (empty($existing['age_range'])  && $ageRange  !== '') { $patches[] = 'age_range = ?';  $vals[] = $ageRange; }
                if ($patches) {
                    $patches[] = 'updated_at = ?'; $vals[] = Db::nowUtc();
                    $vals[] = $existing['id'];
                    Db::pdo()->prepare('UPDATE users SET ' . implode(', ', $patches) . ' WHERE id = ?')
                        ->execute($vals);
                    // Re-read to return fresh values
                    $stmt = Db::pdo()->prepare(
                        'SELECT id, email, phone, username, name, first_name, last_name, sex, age_range, role, language, must_change_password
                         FROM users WHERE id = ? LIMIT 1'
                    );
                    $stmt->execute([$existing['id']]);
                    $existing = $stmt->fetch();
                }
                Response::json([
                    'user' => [
                        'id'        => $existing['id'],
                        'email'     => $existing['email'],
                        'phone'     => $existing['phone'] ?? null,
                        'username'  => $existing['username'],
                        'firstName' => $existing['first_name'] ?? '',
                        'lastName'  => $existing['last_name']  ?? '',
                        'name'      => $existing['name'],
                        'sex'       => $existing['sex']       ?? null,
                        'ageRange'  => $existing['age_range'] ?? null,
                        'role'      => $existing['role'],
                        'language'  => $existing['language'],
                        'mustChangePassword' => (bool) $existing['must_change_password'],
                    ],
                    'tempPassword' => null,
                    'emailSent'    => false,
                    'reused'       => true,
                ]);
                return;
            }
        }

        if ($username === '') $username = $email;
        if (strlen($username) < 3 || strlen($username) > 120) {
            Response::error('bad_request', 'Username must be 3–120 characters.', 400);
        }

        $name = trim($firstName . ' ' . $lastName);

        // Trainees never log in: store an intentionally-invalid bcrypt placeholder
        // that password_verify() will never accept.
        $tempPassword = $body['password'] ?? self::randomPassword();
        if ($role !== 'trainee' && strlen((string) $tempPassword) < 8) {
            Response::error('weak_password', 'Password must be at least 8 characters.', 400);
        }
        $cost = (int) Config::get('auth.bcrypt_cost', 12);
        $hash = $role === 'trainee'
            ? '!disabled-trainee-account!'
            : password_hash((string) $tempPassword, PASSWORD_BCRYPT, ['cost' => $cost]);
        $now  = Db::nowUtc();
        $mustChange = $role === 'trainee' ? 0 : 1;

        try {
            Db::pdo()->prepare(
                'INSERT INTO users (id, email, phone, username, password_hash, name, first_name, last_name, sex, age_range, role, language, must_change_password, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
            )->execute([
                $id, $email, $phone ?: null, $username, $hash, $name, $firstName, $lastName,
                $sex ?: null, $ageRange ?: null,
                $role, $lang, $mustChange, $now, $now
            ]);
        } catch (\PDOException $e) {
            if (($e->errorInfo[1] ?? 0) === 1062) {
                if (stripos($e->getMessage(), 'username') !== false) {
                    Response::error('username_taken', 'Username already in use.', 409);
                }
                Response::error('email_taken', 'Email already in use.', 409);
            }
            throw $e;
        }

        // Invite email — skipped for trainees and when caller opted out.
        $emailSent = false;
        if ($sendInvite && $role !== 'trainee') {
            $emailSent = self::sendInviteEmail([
                'email' => $email, 'name' => $name, 'language' => $lang,
            ], $tempPassword);
        }

        Response::json([
            'user' => [
                'id' => $id, 'email' => $email, 'phone' => $phone ?: null, 'username' => $username,
                'firstName' => $firstName, 'lastName' => $lastName, 'name' => $name,
                'sex' => $sex ?: null, 'ageRange' => $ageRange ?: null,
                'role' => $role, 'language' => $lang,
                'mustChangePassword' => (bool) $mustChange,
            ],
            'tempPassword' => $role === 'trainee' ? null : $tempPassword,
            'emailSent'    => $emailSent,
        ]);
    }

    /**
     * GET /api/users/pick?courseId=<uuid>&q=<text>
     * Returns the active directory of users (trainers + trainees) — minus
     * anyone already enrolled in the given course. Used by the PWA course
     * page to populate the searchable "+ Participant" picker.
     *
     * Both trainers and admins can hit this — trainers need it for walk-in
     * dropdowns; admins need it to manage course rosters.
     */
    /**
     * GET /api/users/staff — any authenticated user can call this.
     * Returns a minimal directory of trainers + admins for course-facilitator
     * pickers and similar UIs. Disabled users are excluded.
     */
    public static function staff(): void
    {
        Auth::requireUser();
        $stmt = Db::pdo()->query(
            "SELECT id, first_name, last_name, name, email, role
             FROM users
             WHERE disabled_at IS NULL
               AND role IN ('trainer','admin')
             ORDER BY first_name, last_name"
        );
        $rows = $stmt->fetchAll();
        Response::json(['users' => array_map(static fn($r) => [
            'id'        => $r['id'],
            'firstName' => $r['first_name'] ?? '',
            'lastName'  => $r['last_name']  ?? '',
            'name'      => $r['name'],
            'email'     => $r['email'],
            'role'      => $r['role'],
        ], $rows)]);
    }

    public static function pick(): void
    {
        Auth::requireUser();
        // Accept params from query string (GET) OR JSON body (POST) so the PWA
        // can use POST when behind corporate proxies that strip auth on GETs.
        $courseId = $_GET['courseId'] ?? null;
        $q        = $_GET['q']        ?? null;
        if (($courseId === null || $q === null) && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
            $body = Util::jsonBody();
            if ($courseId === null) $courseId = $body['courseId'] ?? null;
            if ($q        === null) $q        = $body['q']        ?? null;
        }
        $courseId = strtolower(trim((string) ($courseId ?? '')));
        $q        = strtolower(trim((string) ($q ?? '')));

        $pdo = Db::pdo();
        // Exclude users already enrolled in the target course (alive participants).
        $excludeSql = '';
        $args = [];
        if ($courseId !== '') {
            // Exclude only REGULAR enrolments in the target course. Walk-in
            // participants (walk_in_session_id IS NOT NULL) don't count as
            // course members, so their user should remain pickable.
            $excludeSql = ' AND u.id NOT IN (
                SELECT p.user_id FROM participants p
                WHERE p.group_id = ?
                  AND p.user_id IS NOT NULL
                  AND p.deleted_at IS NULL
                  AND p.walk_in_session_id IS NULL
            )';
            $args[] = $courseId;
        }
        $searchSql = '';
        if ($q !== '') {
            $like = '%' . str_replace(['%','_'], ['\\%','\\_'], $q) . '%';
            $searchSql = ' AND (LOWER(u.first_name) LIKE ? OR LOWER(u.last_name) LIKE ? OR LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ?)';
            $args[] = $like; $args[] = $like; $args[] = $like; $args[] = $like;
        }
        $sql = 'SELECT id, email, phone, first_name, last_name, name, sex, age_range, role
                FROM users u
                WHERE u.disabled_at IS NULL'
              . $excludeSql . $searchSql
              . ' ORDER BY u.first_name, u.last_name
                LIMIT 50';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($args);
        $rows = $stmt->fetchAll();
        Response::json([
            'users' => array_map(static fn($r) => [
                'id'        => $r['id'],
                'email'     => $r['email'],
                'phone'     => $r['phone']     ?? null,
                'firstName' => $r['first_name'] ?? '',
                'lastName'  => $r['last_name']  ?? '',
                'name'      => $r['name'],
                'sex'       => $r['sex']       ?? null,
                'ageRange'  => $r['age_range'] ?? null,
                'role'      => $r['role'],
                // Hide synthetic placeholder emails from the picker — they're noise.
                'syntheticEmail' => str_ends_with((string) $r['email'], '@ubuntu3.local'),
            ], $rows),
        ]);
    }

    /** Sends a localized welcome email with the temp password. Returns true on success. */
    private static function sendInviteEmail(array $user, string $tempPassword): bool
    {
        $appUrl   = Config::appUrl();
        $loginUrl = $appUrl . '/';
        $lang     = $user['language'] ?? 'fr';
        $name     = $user['name'] ?? '';
        $brand    = 'Ubuntu 3.0';

        if ($lang === 'en') {
            $subject     = "{$brand} — Your account has been created";
            $intro       = $name === '' ? 'Hello,' : "Hello {$name},";
            $body        = "You have been invited to use Ubuntu 3.0, the Académie Ubuntu monitoring &amp; evaluation app.";
            $tempLabel   = "Temporary password";
            $instruction = "Sign in with the email and temporary password below. You will be asked to choose a new password on first sign-in.";
            $cta         = "Open Ubuntu 3.0";
        } elseif ($lang === 'rn') {
            $subject     = "{$brand} — Konti yawe yashizweho";
            $intro       = $name === '' ? 'Bwakeye,' : "Bwakeye {$name},";
            $body        = "Watumiwe gukoresha Ubuntu 3.0, porogaramu y'Académie Ubuntu yo gukurikirana no gusuzuma.";
            $tempLabel   = "Ijambo banga ry'akanya";
            $instruction = "Iyinjire ukoresheje imeli n'ijambo banga ry'akanya biri hano. Uzosabwa guhitamo irindi ijambo banga rishasha ukwinjira ubwa mbere.";
            $cta         = "Ugura Ubuntu 3.0";
        } else {
            $subject     = "{$brand} — Votre compte a été créé";
            $intro       = $name === '' ? 'Bonjour,' : "Bonjour {$name},";
            $body        = "Vous avez été invité(e) à utiliser Ubuntu 3.0, l'application de suivi &amp; évaluation de l'Académie Ubuntu.";
            $tempLabel   = "Mot de passe temporaire";
            $instruction = "Connectez-vous avec l'email et le mot de passe temporaire ci-dessous. Un nouveau mot de passe vous sera demandé à la première connexion.";
            $cta         = "Ouvrir Ubuntu 3.0";
        }

        $emailEsc = htmlspecialchars($user['email'], ENT_QUOTES, 'UTF-8');
        $tempEsc  = htmlspecialchars($tempPassword, ENT_QUOTES, 'UTF-8');
        $urlEsc   = htmlspecialchars($loginUrl, ENT_QUOTES, 'UTF-8');
        $introEsc = htmlspecialchars($intro, ENT_QUOTES, 'UTF-8');

        $html = "<!doctype html><html><body style=\"font-family:Helvetica,Arial,sans-serif;color:#1B1B1B;line-height:1.5;\">"
              . "<p>{$introEsc}</p>"
              . "<p>{$body}</p>"
              . "<p>{$instruction}</p>"
              . "<table style=\"margin:18px 0;background:#F5F5F7;padding:14px 18px;border-radius:8px;border-collapse:collapse;\"><tr><td>"
              . "<strong>Email:</strong> {$emailEsc}<br>"
              . "<strong>{$tempLabel}:</strong> <code style=\"font-family:Menlo,monospace;\">{$tempEsc}</code>"
              . "</td></tr></table>"
              . "<p style=\"margin:24px 0;\">"
              . "<a href=\"{$urlEsc}\" style=\"display:inline-block;padding:12px 20px;background:#B73B3F;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;\">{$cta}</a>"
              . "</p>"
              . "<p style=\"color:#6B6B6B;font-size:13px;\">{$urlEsc}</p>"
              . "</body></html>";

        $text = $intro . "\n\n" . strip_tags($body) . "\n\n" . $instruction
              . "\n\nEmail: " . $user['email']
              . "\n" . $tempLabel . ": " . $tempPassword
              . "\n\n" . $loginUrl;

        return Email::send($user['email'], $name, $subject, $html, $text);
    }

    /** PATCH /api/users/:id — admin only. Body: { name?, role?, language?, disabled? } */
    public static function update(string $id): void
    {
        Auth::requireAdmin();
        $body = Util::jsonBody();

        // If we're about to demote an admin → trainer OR disable an admin,
        // make sure there's another active admin left in the system.
        $demoting = isset($body['role']) && $body['role'] === 'trainer';
        $disabling = !empty($body['disabled']);
        if ($demoting || $disabling) {
            $stmt = Db::pdo()->prepare('SELECT role, disabled_at FROM users WHERE id = ? LIMIT 1');
            $stmt->execute([$id]);
            $current = $stmt->fetch();
            if (!$current) Response::error('not_found', 'User not found.', 404);
            if ($current['role'] === 'admin' && $current['disabled_at'] === null) {
                $why = $demoting
                    ? 'Cannot demote the last admin. Promote another user to admin first.'
                    : 'Cannot disable the last admin. Promote another user to admin first.';
                self::assertOtherActiveAdminExists($id, $why);
            }
        }

        $sets = [];
        $vals = [];

        // firstName/lastName updates — when either changes, also rewrite the
        // derived `name` cache and require both ends to stay non-empty.
        $newFirst = isset($body['firstName']) ? trim((string) $body['firstName'])
                  : (isset($body['first_name']) ? trim((string) $body['first_name']) : null);
        $newLast  = isset($body['lastName'])  ? trim((string) $body['lastName'])
                  : (isset($body['last_name'])  ? trim((string) $body['last_name'])  : null);
        if ($newFirst !== null || $newLast !== null) {
            // Load current values so we only overwrite what was passed in
            $stmt = Db::pdo()->prepare('SELECT first_name, last_name FROM users WHERE id = ? LIMIT 1');
            $stmt->execute([$id]);
            $cur = $stmt->fetch();
            if (!$cur) Response::error('not_found', 'User not found.', 404);
            $finalFirst = $newFirst !== null ? $newFirst : (string) ($cur['first_name'] ?? '');
            $finalLast  = $newLast  !== null ? $newLast  : (string) ($cur['last_name']  ?? '');
            if ($finalFirst === '') Response::error('bad_request', 'First name cannot be empty.', 400);
            if ($finalLast  === '') Response::error('bad_request', 'Last name cannot be empty.', 400);
            $sets[] = 'first_name = ?'; $vals[] = $finalFirst;
            $sets[] = 'last_name = ?';  $vals[] = $finalLast;
            $sets[] = 'name = ?';        $vals[] = trim($finalFirst . ' ' . $finalLast);
        } elseif (isset($body['name'])) {
            // Legacy callers can still send `name` (kept for backward compat).
            $sets[] = 'name = ?'; $vals[] = trim((string) $body['name']);
        }

        if (isset($body['role']) && in_array($body['role'], ['trainer', 'admin', 'trainee'], true)) {
            $sets[] = 'role = ?'; $vals[] = $body['role'];
        }
        if (isset($body['language']) && in_array($body['language'], ['fr', 'en', 'rn'], true)) {
            $sets[] = 'language = ?'; $vals[] = $body['language'];
        }
        if (array_key_exists('sex', $body)) {
            $s = trim((string) $body['sex']);
            if ($s !== '' && !in_array($s, ['F','M','O'], true)) {
                Response::error('bad_request', 'Sex must be F, M, O or empty.', 400);
            }
            $sets[] = 'sex = ?'; $vals[] = $s === '' ? null : $s;
        }
        if (array_key_exists('ageRange', $body) || array_key_exists('age_range', $body)) {
            $a = trim((string) ($body['ageRange'] ?? $body['age_range'] ?? ''));
            $sets[] = 'age_range = ?'; $vals[] = $a === '' ? null : $a;
        }
        if (array_key_exists('phone', $body)) {
            $ph = trim((string) $body['phone']);
            if (mb_strlen($ph) > 50) Response::error('bad_request', 'Phone too long.', 400);
            $sets[] = 'phone = ?'; $vals[] = $ph === '' ? null : $ph;
        }
        if (array_key_exists('email', $body)) {
            $newEmail = strtolower(trim((string) $body['email']));
            if ($newEmail === '' || !filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
                Response::error('bad_request', 'Email must be a valid address.', 400);
            }
            // Uniqueness check (excluding self)
            $stmt = Db::pdo()->prepare('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1');
            $stmt->execute([$newEmail, $id]);
            if ($stmt->fetchColumn()) {
                Response::error('email_taken', 'Email already in use by another user.', 409);
            }
            $sets[] = 'email = ?'; $vals[] = $newEmail;
        }
        if (array_key_exists('username', $body)) {
            $newU = strtolower(trim((string) $body['username']));
            if ($newU === '' || strlen($newU) < 3 || strlen($newU) > 120) {
                Response::error('bad_request', 'Username must be 3-120 characters.', 400);
            }
            $stmt = Db::pdo()->prepare('SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1');
            $stmt->execute([$newU, $id]);
            if ($stmt->fetchColumn()) {
                Response::error('username_taken', 'Username already in use by another user.', 409);
            }
            $sets[] = 'username = ?'; $vals[] = $newU;
        }
        if (isset($body['disabled'])) {
            $sets[] = 'disabled_at = ?';
            $vals[] = $body['disabled'] ? Db::nowUtc() : null;
        }
        if (!$sets) Response::error('bad_request', 'Nothing to update.', 400);
        $sets[] = 'updated_at = ?'; $vals[] = Db::nowUtc();
        $vals[] = $id;
        Db::pdo()->prepare('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
        Response::ok();
    }

    /**
     * Hard-delete a user. Their authored records keep `author_id = NULL`
     * (we set the FK to ON DELETE SET NULL in the schema). Their auth_sessions
     * are cascaded.
     *
     * Guarded so:
     *   - admins cannot delete themselves
     *   - the last active admin cannot be deleted (system-lockout safety)
     */
    public static function delete(string $id): void
    {
        $admin = Auth::requireAdmin();
        if ($id === $admin['id']) {
            Response::error('forbidden', 'You cannot delete your own account.', 400);
        }
        $pdo = Db::pdo();
        $stmt = $pdo->prepare('SELECT id, email, role, disabled_at FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) Response::error('not_found', 'User not found.', 404);

        // If the target is an active admin, ensure at least one other active admin remains.
        if ($row['role'] === 'admin' && $row['disabled_at'] === null) {
            self::assertOtherActiveAdminExists($id, 'Cannot delete the last admin. Promote another user to admin first.');
        }

        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
        Response::ok(['deletedId' => $id, 'deletedEmail' => $row['email']]);
    }

    /** Returns the number of active (non-disabled) admins excluding $excludeId. */
    private static function countOtherActiveAdmins(string $excludeId): int
    {
        $stmt = Db::pdo()->prepare(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled_at IS NULL AND id <> ?"
        );
        $stmt->execute([$excludeId]);
        return (int) $stmt->fetchColumn();
    }

    /** Throws a 400 error if removing/demoting/disabling $excludeId would leave the system with zero admins. */
    private static function assertOtherActiveAdminExists(string $excludeId, string $message): void
    {
        if (self::countOtherActiveAdmins($excludeId) < 1) {
            Response::error('last_admin', $message, 400);
        }
    }

    private static function randomPassword(int $len = 12): string
    {
        $alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $out = '';
        for ($i = 0; $i < $len; $i++) {
            $out .= $alpha[random_int(0, strlen($alpha) - 1)];
        }
        return $out;
    }
}
