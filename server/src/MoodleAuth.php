<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Validates credentials against Ubuntu eLearning (Moodle) via its built-in
 * Web Services token endpoint, then pulls the user profile so we can create
 * or link a matching Ubuntu 3.0 user.
 *
 * Requires on the Moodle side:
 *   - Web Services enabled (Site admin → Server → Web services → Overview)
 *   - The "Moodle mobile web service" (or a custom service) enabled
 *   - The user account permitted to obtain a token for that service
 *
 * NO Moodle plugin is required — this uses stock endpoints.
 */
final class MoodleAuth
{
    /**
     * Tries to authenticate `$email` + `$password` against Moodle.
     * Returns a profile array on success, or null on any failure.
     *
     * Profile shape:
     *   [
     *     'moodle_user_id' => int,
     *     'email'          => string,
     *     'name'           => string,
     *     'language'       => string ('fr' / 'en' / 'rn'),
     *   ]
     */
    public static function authenticate(string $identifier, string $password): ?array
    {
        $base = rtrim((string) Config::get('moodle.url', ''), '/');
        if ($base === '') return null;
        $service = (string) Config::get('moodle.service', 'moodle_mobile_app');

        // Forward the identifier (Moodle username or email) as-is. Moodle's
        // /login/token.php accepts username natively; emails work too if the site
        // has "Allow login by email" enabled.
        $token = self::fetchToken($base, $identifier, $password, $service);
        if ($token === null) return null;

        return self::fetchProfile($base, $token);
    }

    // -----------------------------------------------------------

    private static function fetchToken(string $base, string $email, string $password, string $service): ?string
    {
        $url = $base . '/login/token.php';
        // Moodle's token endpoint accepts query params OR POST body; POST keeps the password out of any logs.
        $resp = self::http('POST', $url, [
            'username' => $email,
            'password' => $password,
            'service'  => $service,
        ]);
        if ($resp === null) return null;
        $data = json_decode($resp, true);
        if (!is_array($data)) return null;
        if (!empty($data['error'])) {
            error_log('[ubuntu30 moodle-auth] token error: ' . $data['error']);
            return null;
        }
        return !empty($data['token']) ? (string) $data['token'] : null;
    }

    private static function fetchProfile(string $base, string $token): ?array
    {
        $url = $base . '/webservice/rest/server.php';

        // Step 1 — site info (carries username, fullname, lang, userid)
        $resp = self::http('POST', $url, [
            'wstoken'            => $token,
            'wsfunction'         => 'core_webservice_get_site_info',
            'moodlewsrestformat' => 'json',
        ]);
        if ($resp === null) return null;
        $info = json_decode($resp, true);
        if (!is_array($info) || empty($info['userid'])) {
            if (is_array($info) && !empty($info['message'])) {
                error_log('[ubuntu30 moodle-auth] site info error: ' . $info['message']);
            }
            return null;
        }
        $lang = strtolower(substr((string) ($info['lang'] ?? 'fr'), 0, 2));
        if (!in_array($lang, ['fr', 'en', 'rn'], true)) $lang = 'fr';

        $profile = [
            'moodle_user_id' => (int) $info['userid'],
            'username'       => (string) ($info['username'] ?? ''),
            'email'          => '',
            'name'           => (string) ($info['fullname'] ?? ''),
            'first_name'     => (string) ($info['firstname'] ?? ''),
            'last_name'      => (string) ($info['lastname']  ?? ''),
            'language'       => $lang,
        ];

        // Step 2 — fetch the user's email (and any other extra fields).
        // core_webservice_get_site_info does NOT return email, so we look it up
        // by id with the user's own token. A user can always read their own profile.
        $resp2 = self::http('POST', $url, [
            'wstoken'            => $token,
            'wsfunction'         => 'core_user_get_users_by_field',
            'moodlewsrestformat' => 'json',
            'field'              => 'id',
            'values[0]'          => (string) $profile['moodle_user_id'],
        ]);
        if ($resp2 !== null) {
            $users = json_decode($resp2, true);
            if (is_array($users) && !empty($users[0]) && is_array($users[0])) {
                if (!empty($users[0]['email'])) {
                    $profile['email'] = (string) $users[0]['email'];
                }
                // Refine the name if get_site_info gave us a less-friendly version
                if (empty($profile['name']) && !empty($users[0]['fullname'])) {
                    $profile['name'] = (string) $users[0]['fullname'];
                }
                if (empty($profile['first_name']) && !empty($users[0]['firstname'])) {
                    $profile['first_name'] = (string) $users[0]['firstname'];
                }
                if (empty($profile['last_name']) && !empty($users[0]['lastname'])) {
                    $profile['last_name'] = (string) $users[0]['lastname'];
                }
            } elseif (is_array($users) && !empty($users['exception'])) {
                error_log('[ubuntu30 moodle-auth] user lookup exception: ' . ($users['message'] ?? json_encode($users)));
            }
        }

        return $profile;
    }

    private static function http(string $method, string $url, array $fields): ?string
    {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
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
            error_log(sprintf('[ubuntu30 moodle-auth] HTTP %s %s → code=%d err=%s', $method, $url, $code, $err));
            return null;
        }
        return is_string($body) ? $body : null;
    }
}
