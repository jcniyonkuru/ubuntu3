<?php
declare(strict_types=1);

namespace Ubuntu;

final class Auth
{
    /**
     * POST /api/auth/login
     * Body: { email, password }
     * Returns: { token, user }
     */
    public static function login(): void
    {
        $body = Util::jsonBody();
        // The login field accepts either a username or an email. The body still uses
        // 'email' as the JSON key for backward compatibility with the existing PWA.
        $identifier = strtolower(trim((string) ($body['email'] ?? $body['username'] ?? '')));
        $password = (string) ($body['password'] ?? '');
        if ($identifier === '' || $password === '') {
            Response::error('bad_request', 'Username (or email) and password required.', 400);
        }

        $pdo = Db::pdo();
        $stmt = $pdo->prepare(
            'SELECT * FROM users
             WHERE (LOWER(username) = ? OR LOWER(email) = ?)
               AND disabled_at IS NULL
             LIMIT 1'
        );
        $stmt->execute([$identifier, $identifier]);
        $u = $stmt->fetch();
        $localOk = $u && password_verify($password, $u['password_hash']);

        // Optional Ubuntu eLearning sign-in: if local auth failed AND eLearning is
        // configured, try those credentials. On first success we link / auto-create
        // the Ubuntu 3.0 user.
        if (!$localOk && Config::get('moodle.enabled', false)) {
            $profile = MoodleAuth::authenticate($identifier, $password);
            if ($profile) {
                $u = self::linkOrCreateForMoodle($identifier, $profile, $u ?: null);
                $localOk = true;
            }
        }

        if (!$u || !$localOk) {
            Response::error('invalid_credentials', 'Username or password incorrect.', 401);
        }

        // Issue token
        $token = bin2hex(random_bytes(32));
        $hash  = hash('sha256', $token);
        $sid   = Util::uuid();
        $ttl   = (int) Config::get('auth.token_ttl_seconds', 30 * 24 * 3600);
        $now   = Db::nowUtc();
        $exp   = gmdate('Y-m-d H:i:s', time() + $ttl);
        $ua    = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);
        $ip    = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? ($_SERVER['REMOTE_ADDR'] ?? null);
        if ($ip !== null) $ip = substr(trim(explode(',', $ip)[0]), 0, 45);

        $pdo->prepare('INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_used_at, user_agent, ip) VALUES (?,?,?,?,?,?,?,?)')
            ->execute([$sid, $u['id'], $hash, $now, $exp, $now, $ua, $ip]);
        $pdo->prepare('UPDATE users SET last_login_at = ? WHERE id = ?')->execute([$now, $u['id']]);

        Response::json([
            'token' => $token,
            'user'  => self::publicUser($u),
        ]);
    }

    /**
     * POST /api/auth/logout — revokes the current token.
     */
    public static function logout(): void
    {
        $user = self::requireUser();
        Db::pdo()->prepare('DELETE FROM auth_sessions WHERE id = ?')->execute([$user['session_id']]);
        Response::ok();
    }

    /**
     * GET /api/auth/me — returns the user attached to the current token.
     */
    public static function me(): void
    {
        $user = self::requireUser();
        unset($user['session_id']);
        Response::json(['user' => $user]);
    }

    /**
     * POST /api/auth/change-password
     * Body: { current_password, new_password }
     */
    public static function changePassword(): void
    {
        $user = self::requireUser();
        $body = Util::jsonBody();
        $cur  = (string) ($body['current_password'] ?? '');
        $new  = (string) ($body['new_password'] ?? '');
        if (strlen($new) < 8) {
            Response::error('weak_password', 'New password must be at least 8 characters.', 400);
        }
        $pdo  = Db::pdo();
        $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
        $stmt->execute([$user['id']]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($cur, $row['password_hash'])) {
            Response::error('invalid_credentials', 'Current password is incorrect.', 401);
        }
        $cost = (int) Config::get('auth.bcrypt_cost', 12);
        $hash = password_hash($new, PASSWORD_BCRYPT, ['cost' => $cost]);
        $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
            ->execute([$hash, Db::nowUtc(), $user['id']]);
        Response::ok();
    }

    /**
     * Middleware: load the user from the Bearer token; respond 401 if absent/invalid.
     * Returns the user array with an extra 'session_id'.
     */
    public static function requireUser(): array
    {
        $token = Util::bearerToken();
        if ($token === null) {
            Response::error('unauthenticated', 'Missing or invalid token.', 401);
        }
        $hash = hash('sha256', $token);
        $pdo  = Db::pdo();
        $stmt = $pdo->prepare(
            'SELECT s.id AS session_id, s.expires_at,
                    u.id, u.email, u.name, u.role, u.language, u.must_change_password
             FROM auth_sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ?
               AND s.expires_at > UTC_TIMESTAMP()
               AND u.disabled_at IS NULL
             LIMIT 1'
        );
        $stmt->execute([$hash]);
        $row = $stmt->fetch();
        if (!$row) {
            Response::error('unauthenticated', 'Session expired. Please log in again.', 401);
        }
        // Sliding expiration
        $ttl = (int) Config::get('auth.token_ttl_seconds', 30 * 24 * 3600);
        $newExp = gmdate('Y-m-d H:i:s', time() + $ttl);
        $pdo->prepare('UPDATE auth_sessions SET last_used_at = ?, expires_at = ? WHERE id = ?')
            ->execute([Db::nowUtc(), $newExp, $row['session_id']]);
        return [
            'id' => $row['id'],
            'email' => $row['email'],
            'name' => $row['name'],
            'role' => $row['role'],
            'language' => $row['language'],
            'must_change_password' => (bool) $row['must_change_password'],
            'session_id' => $row['session_id'],
        ];
    }

    public static function requireAdmin(): array
    {
        $u = self::requireUser();
        if ($u['role'] !== 'admin') {
            Response::error('forbidden', 'Admin role required.', 403);
        }
        return $u;
    }

    public static function publicUser(array $row): array
    {
        $first = (string) ($row['first_name'] ?? '');
        $last  = (string) ($row['last_name']  ?? '');
        // Fall back to the legacy `name` field for users created before v0.3.4
        $name  = (string) ($row['name'] ?? '');
        if ($first === '' && $last === '' && $name !== '') {
            // Best-effort split for callers that need firstName/lastName
            $parts = explode(' ', trim($name), 2);
            $first = $parts[0] ?? '';
            $last  = $parts[1] ?? '';
        }
        return [
            'id' => $row['id'],
            'username' => $row['username'] ?? ($row['email'] ?? ''),
            'email' => $row['email'],
            'firstName' => $first,
            'lastName'  => $last,
            'name' => $name !== '' ? $name : trim($first . ' ' . $last),
            'role' => $row['role'],
            'language' => $row['language'],
            'must_change_password' => (bool) ($row['must_change_password'] ?? 0),
        ];
    }

    /**
     * Called after Ubuntu eLearning successfully validates credentials.
     *   - If a local user already exists with that email, link the Moodle ID.
     *   - Otherwise, create a new trainer record with a random local password
     *     (the user will keep signing in via eLearning).
     */
    private static function linkOrCreateForMoodle(string $identifier, array $profile, ?array $existing): array
    {
        $pdo = Db::pdo();
        $now = Db::nowUtc();

        // If we didn't find a user by what was typed, try matching by what Moodle
        // told us — the eLearning user might already exist under their username or email.
        if (!$existing) {
            $stmt = $pdo->prepare(
                'SELECT * FROM users
                 WHERE (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?))
                   AND disabled_at IS NULL
                 LIMIT 1'
            );
            $stmt->execute([$profile['username'], $profile['email']]);
            $existing = $stmt->fetch() ?: null;
        }

        if ($existing) {
            $sets = [];
            $vals = [];
            if (empty($existing['moodle_user_id'])) {
                $sets[] = 'moodle_user_id = ?'; $vals[] = $profile['moodle_user_id'];
            }
            // Keep username in sync with Moodle when it's known and differs
            if (!empty($profile['username']) && strcasecmp((string) $existing['username'], (string) $profile['username']) !== 0) {
                $sets[] = 'username = ?'; $vals[] = $profile['username'];
            }
            // Backfill / update email when:
            //  - the stored email is empty, OR
            //  - the stored email is the same as the username (a placeholder from a previous build), OR
            //  - the stored email doesn't look like an email
            // We never override an email that already looks legitimate AND differs from Moodle's.
            if (!empty($profile['email'])) {
                $current = (string) ($existing['email'] ?? '');
                $looksPlaceholder = $current === ''
                    || strcasecmp($current, (string) $existing['username']) === 0
                    || !filter_var($current, FILTER_VALIDATE_EMAIL);
                if ($looksPlaceholder && strcasecmp($current, (string) $profile['email']) !== 0) {
                    $sets[] = 'email = ?'; $vals[] = $profile['email'];
                }
            }
            // Optional: backfill the display name if it's currently empty
            if (!empty($profile['name']) && empty($existing['name'])) {
                $sets[] = 'name = ?'; $vals[] = $profile['name'];
            }
            if ($sets) {
                $sets[] = 'updated_at = ?'; $vals[] = $now;
                $vals[] = $existing['id'];
                $pdo->prepare('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
                $r = $pdo->prepare('SELECT * FROM users WHERE id = ?');
                $r->execute([$existing['id']]);
                $existing = $r->fetch();
            }
            return $existing;
        }

        // First-time eLearning sign-in for this user — create a local record.
        $id   = Util::uuid();
        $cost = (int) Config::get('auth.bcrypt_cost', 12);
        // Random unguessable local password — the user signs in via Moodle from now on.
        $hash = password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT, ['cost' => $cost]);

        $username  = $profile['username'] !== '' ? $profile['username'] : $identifier;
        $email     = $profile['email']    !== '' ? $profile['email']    : $identifier;
        $name      = $profile['name']     !== '' ? $profile['name']     : $username;
        $firstName = (string) ($profile['first_name'] ?? '');
        $lastName  = (string) ($profile['last_name']  ?? '');
        // If Moodle didn't return split names, derive them from `name`.
        if ($firstName === '' && $lastName === '' && $name !== '') {
            $parts     = explode(' ', trim($name), 2);
            $firstName = $parts[0] ?? '';
            $lastName  = $parts[1] ?? '';
        }
        if ($firstName === '') $firstName = $username;   // last-resort fallback
        $lang     = in_array($profile['language'], ['fr', 'en', 'rn'], true) ? $profile['language'] : 'fr';

        $pdo->prepare(
            'INSERT INTO users (id, email, username, password_hash, name, first_name, last_name, role, language, must_change_password, moodle_user_id, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?)'
        )->execute([$id, $email, $username, $hash, $name, $firstName, $lastName, 'trainer', $lang, $profile['moodle_user_id'], $now, $now]);

        return [
            'id'                    => $id,
            'email'                 => $email,
            'username'              => $username,
            'password_hash'         => $hash,
            'name'                  => $name,
            'first_name'            => $firstName,
            'last_name'             => $lastName,
            'role'                  => 'trainer',
            'language'              => $lang,
            'must_change_password'  => 0,
            'moodle_user_id'        => $profile['moodle_user_id'],
            'disabled_at'           => null,
        ];
    }
}
