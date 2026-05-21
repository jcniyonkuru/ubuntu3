<?php
declare(strict_types=1);

namespace Ubuntu;

final class PasswordReset
{
    private const TTL_SECONDS = 3600;   // 1 hour

    /**
     * POST /api/auth/forgot-password
     * Body: { email }
     * Always returns 200, even if email isn't on file (don't leak account existence).
     */
    public static function forgot(): void
    {
        $body = Util::jsonBody();
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Response::ok();
        }
        $pdo = Db::pdo();
        $stmt = $pdo->prepare('SELECT id, email, name, language FROM users WHERE email = ? AND disabled_at IS NULL LIMIT 1');
        $stmt->execute([$email]);
        $u = $stmt->fetch();
        if ($u) {
            self::issueReset($u);
        }
        Response::ok();
    }

    /**
     * Admin triggers a reset for a specific user.
     * Returns ok (no temp password leaked back).
     */
    public static function adminTrigger(string $userId): void
    {
        Auth::requireAdmin();
        $pdo = Db::pdo();
        $stmt = $pdo->prepare('SELECT id, email, name, language FROM users WHERE id = ? AND disabled_at IS NULL LIMIT 1');
        $stmt->execute([$userId]);
        $u = $stmt->fetch();
        if (!$u) Response::error('not_found', 'User not found.', 404);
        $ok = self::issueReset($u);
        Response::ok(['emailSent' => $ok]);
    }

    /**
     * POST /api/auth/reset-password
     * Body: { token, new_password }
     */
    public static function reset(): void
    {
        $body = Util::jsonBody();
        $token = (string) ($body['token'] ?? '');
        $new   = (string) ($body['new_password'] ?? '');
        if ($token === '' || strlen($new) < 8) {
            Response::error('bad_request', 'Token and new password (8+ chars) required.', 400);
        }
        $hash = hash('sha256', $token);
        $pdo  = Db::pdo();
        $stmt = $pdo->prepare(
            'SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at, u.email
             FROM password_resets pr
             JOIN users u ON u.id = pr.user_id
             WHERE pr.token_hash = ? LIMIT 1'
        );
        $stmt->execute([$hash]);
        $row = $stmt->fetch();
        if (!$row) Response::error('invalid_token', 'Reset link is invalid.', 400);
        if ($row['used_at'] !== null) Response::error('used_token', 'Reset link has already been used.', 400);
        if (strtotime($row['expires_at'] . ' UTC') < time()) Response::error('expired_token', 'Reset link has expired.', 400);

        $cost = (int) Config::get('auth.bcrypt_cost', 12);
        $phash = password_hash($new, PASSWORD_BCRYPT, ['cost' => $cost]);
        $now = Db::nowUtc();

        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
                ->execute([$phash, $now, $row['user_id']]);
            $pdo->prepare('UPDATE password_resets SET used_at = ? WHERE id = ?')->execute([$now, $row['id']]);
            // Revoke all existing sessions for safety
            $pdo->prepare('DELETE FROM auth_sessions WHERE user_id = ?')->execute([$row['user_id']]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        Response::ok();
    }

    // -----------------------------------------------------------

    private static function issueReset(array $user): bool
    {
        $token = bin2hex(random_bytes(32));
        $hash  = hash('sha256', $token);
        $id    = Util::uuid();
        $now   = Db::nowUtc();
        $exp   = gmdate('Y-m-d H:i:s', time() + self::TTL_SECONDS);
        Db::pdo()->prepare(
            'INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)'
        )->execute([$id, $user['id'], $hash, $exp]);

        $appUrl = Config::appUrl();
        $resetUrl = $appUrl . '/#/reset?token=' . urlencode($token);
        $lang = $user['language'] ?? 'fr';
        [$subject, $html, $text] = self::emailBody($lang, $user['name'] ?? '', $resetUrl);
        return Email::send($user['email'], $user['name'] ?? '', $subject, $html, $text);
    }

    private static function emailBody(string $lang, string $name, string $url): array
    {
        $brand = 'Ubuntu 3.0';
        if ($lang === 'en') {
            $subject = "{$brand} — Reset your password";
            $intro = htmlspecialchars($name === '' ? 'Hello,' : "Hello {$name},");
            $body = "We received a request to reset your password. Click the link below to choose a new one. This link expires in 1 hour.";
            $cta = "Reset my password";
            $ignore = "If you did not request this, you can ignore this email.";
        } elseif ($lang === 'rn') {
            $subject = "{$brand} — Hindura ijambo banga";
            $intro = htmlspecialchars($name === '' ? 'Bwakeye,' : "Bwakeye {$name},");
            $body = "Twakiriye ikibazo co guhindura ijambo banga ryawe. Kanda kuri uru rurwiriro ushire irindi rishasha. Uru rurwiriro ruzohera mu masaha 1.";
            $cta = "Hindura ijambo banga";
            $ignore = "Niwaba utisabye ico, urashobora kwirengagiza iyi meli.";
        } else {
            $subject = "{$brand} — Réinitialisation du mot de passe";
            $intro = htmlspecialchars($name === '' ? 'Bonjour,' : "Bonjour {$name},");
            $body = "Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le lien ci-dessous pour en choisir un nouveau. Ce lien expire dans 1 heure.";
            $cta = "Réinitialiser mon mot de passe";
            $ignore = "Si vous n'avez pas fait cette demande, vous pouvez ignorer cet email.";
        }
        $url_esc = htmlspecialchars($url);
        $html = "<!doctype html><html><body style=\"font-family:Helvetica,Arial,sans-serif;color:#1B1B1B;\">"
              . "<p>{$intro}</p>"
              . "<p>{$body}</p>"
              . "<p style=\"margin:24px 0;\"><a href=\"{$url_esc}\" style=\"display:inline-block;padding:12px 18px;background:#B73B3F;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;\">{$cta}</a></p>"
              . "<p style=\"color:#6B6B6B;font-size:13px;\">{$ignore}</p>"
              . "<p style=\"color:#6B6B6B;font-size:13px;\">{$url_esc}</p>"
              . "</body></html>";
        $text = strip_tags($intro) . "\n\n" . $body . "\n\n" . $url . "\n\n" . $ignore;
        return [$subject, $html, $text];
    }
}
