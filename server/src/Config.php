<?php
declare(strict_types=1);

namespace Ubuntu;

final class Config
{
    private static ?array $data = null;

    public static function load(string $path): void
    {
        if (!is_file($path)) {
            throw new \RuntimeException("Config file not found: {$path}. Copy config.example.php to config.php and edit.");
        }
        $data = require $path;
        if (!is_array($data)) {
            throw new \RuntimeException('Config file must return an array.');
        }
        self::$data = $data;
    }

    public static function get(string $key, $default = null)
    {
        if (self::$data === null) {
            throw new \RuntimeException('Config not loaded.');
        }
        $parts = explode('.', $key);
        $node = self::$data;
        foreach ($parts as $p) {
            if (is_array($node) && array_key_exists($p, $node)) {
                $node = $node[$p];
            } else {
                return $default;
            }
        }
        return $node;
    }

    public static function db(): array { return self::get('db'); }
    public static function auth(): array { return self::get('auth'); }
    public static function brevo(): array { return self::get('brevo'); }
    public static function isProduction(): bool { return (bool) self::get('production', true); }
    public static function appUrl(): string { return rtrim((string) self::get('app_url', ''), '/'); }
}
