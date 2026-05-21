<?php
declare(strict_types=1);

namespace Ubuntu;

final class Util
{
    /** RFC4122 v4 UUID. */
    public static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }

    public static function bearerToken(): ?string
    {
        $h = $_SERVER['HTTP_AUTHORIZATION']
            ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
        if (!$h && function_exists('getallheaders')) {
            $all = getallheaders();
            foreach ($all as $k => $v) {
                if (strcasecmp($k, 'Authorization') === 0) { $h = $v; break; }
            }
        }
        if (preg_match('/^Bearer\s+([A-Za-z0-9._\-]{20,})$/', (string) $h, $m)) {
            return $m[1];
        }
        return null;
    }

    /** camelCase ↔ snake_case helpers. */
    public static function snake(string $s): string
    {
        return strtolower(preg_replace('/([a-z0-9])([A-Z])/', '$1_$2', $s));
    }

    public static function camel(string $s): string
    {
        return lcfirst(str_replace(' ', '', ucwords(str_replace('_', ' ', $s))));
    }

    /** Read JSON request body once, cached. */
    private static $json = null;
    public static function jsonBody(): array
    {
        if (self::$json !== null) return self::$json;
        $raw = file_get_contents('php://input');
        if ($raw === '' || $raw === false) { return self::$json = []; }
        try {
            $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            Response::error('bad_request', 'Invalid JSON body: ' . $e->getMessage(), 400);
            exit;
        }
        return self::$json = is_array($data) ? $data : [];
    }
}
