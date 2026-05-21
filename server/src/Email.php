<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Brevo (Sendinblue) HTTP API client — Phase B password-reset emails.
 * No PHPMailer dependency. Uses cURL.
 */
final class Email
{
    public static function send(string $toEmail, string $toName, string $subject, string $htmlBody, ?string $textBody = null): bool
    {
        $cfg = Config::brevo();
        if (empty($cfg['api_key'])) {
            error_log('[ubuntu30 email] no brevo api_key in config.php — skipping send to ' . $toEmail);
            return false;
        }
        if (empty($cfg['from_email'])) {
            error_log('[ubuntu30 email] no brevo.from_email — skipping send to ' . $toEmail);
            return false;
        }
        $payload = [
            'sender' => ['email' => $cfg['from_email'], 'name' => $cfg['from_name'] ?? 'Ubuntu 3.0'],
            'to'     => [['email' => $toEmail, 'name' => $toName]],
            'subject' => $subject,
            'htmlContent' => $htmlBody,
        ];
        if ($textBody) $payload['textContent'] = $textBody;

        $ch = curl_init('https://api.brevo.com/v3/smtp/email');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_HTTPHEADER => [
                'api-key: ' . $cfg['api_key'],
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        ]);
        $resp     = curl_exec($ch);
        $code     = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        $ok = $code >= 200 && $code < 300;
        if (!$ok) {
            $excerpt = is_string($resp) ? substr($resp, 0, 500) : '(no body)';
            error_log(sprintf(
                '[ubuntu30 email] FAILED to %s: http=%d curl_err="%s" body=%s key=%s... from=%s',
                $toEmail, $code, $curlErr, $excerpt,
                substr((string) $cfg['api_key'], 0, 10),
                $cfg['from_email']
            ));
        } else {
            error_log(sprintf('[ubuntu30 email] sent to %s (http %d)', $toEmail, $code));
        }
        return $ok;
    }
}
