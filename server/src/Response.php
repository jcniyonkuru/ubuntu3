<?php
declare(strict_types=1);

namespace Ubuntu;

final class Response
{
    public static function json($data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function error(string $code, string $message, int $status = 400, array $extra = []): void
    {
        $body = ['error' => array_merge(['code' => $code, 'message' => $message], $extra)];
        self::json($body, $status);
    }

    public static function ok(array $data = []): void
    {
        self::json(array_merge(['ok' => true], $data));
    }
}
