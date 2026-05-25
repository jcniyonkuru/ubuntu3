<?php
/**
 * Ubuntu 3.0 — API front controller
 * Routes every /api/* request to the right handler.
 */
declare(strict_types=1);

use Ubuntu\Config;
use Ubuntu\Response;
use Ubuntu\Auth;
use Ubuntu\Sync;
use Ubuntu\Users;
use Ubuntu\Media;
use Ubuntu\PasswordReset;
use Ubuntu\MoodleSync;
use Ubuntu\Reports;
use Ubuntu\PublicFeed;

$base = dirname(__DIR__);
require $base . '/src/Config.php';
require $base . '/src/Response.php';
require $base . '/src/Util.php';
require $base . '/src/Db.php';
require $base . '/src/Auth.php';
require $base . '/src/Sync.php';
require $base . '/src/Users.php';
require $base . '/src/Email.php';
require $base . '/src/PasswordReset.php';
require $base . '/src/Media.php';
require $base . '/src/MoodleAuth.php';
require $base . '/src/MoodleSync.php';
require $base . '/src/Reports.php';
require $base . '/src/PublicFeed.php';

// Load config (config.php sits next to config.example.php in $base)
try {
    Config::load($base . '/config.php');
} catch (\Throwable $e) {
    Response::error('server_misconfigured', $e->getMessage(), 500);
}

// HTTPS check in production
if (Config::isProduction()) {
    $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    if (!$https) Response::error('https_required', 'HTTPS is required.', 400);
}

// Optional CORS (default: same-origin, no headers needed)
$origins = (array) Config::get('cors_origins', []);
$origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, $origins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Authorization, Content-Type');
        header('Access-Control-Max-Age: 600');
        http_response_code(204);
        exit;
    }
}

// Build path
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
$path = '/' . ltrim($uri, '/');
// Strip an optional "/api" prefix
if (strpos($path, '/api') === 0) $path = substr($path, 4) ?: '/';

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// Tiny router. Each route is [method, regex, callable].
$routes = [
    ['GET',    '#^/$#',                       fn() => Response::json(['service' => 'ubuntu30', 'version' => 'v0.2.0'])],
    ['GET',    '#^/health$#',                 fn() => Response::ok(['time' => \Ubuntu\Db::nowIsoUtc()])],

    ['POST',   '#^/auth/login$#',             [Auth::class, 'login']],
    ['POST',   '#^/auth/logout$#',            [Auth::class, 'logout']],
    ['GET',    '#^/auth/me$#',                [Auth::class, 'me']],
    ['POST',   '#^/auth/change-password$#',   [Auth::class, 'changePassword']],
    ['POST',   '#^/auth/forgot-password$#',   [PasswordReset::class, 'forgot']],
    ['POST',   '#^/auth/reset-password$#',    [PasswordReset::class, 'reset']],

    ['GET',    '#^/sync/pull$#',              [Sync::class, 'pull']],
    ['POST',   '#^/sync/pull$#',              [Sync::class, 'pull']],
    ['POST',   '#^/sync/push$#',              [Sync::class, 'push']],

    ['GET',    '#^/users$#',                  [Users::class, 'list']],
    ['POST',   '#^/users/list$#',             [Users::class, 'list']],
    ['POST',   '#^/users$#',                  [Users::class, 'create']],
    ['GET',    '#^/users/pick$#',             [Users::class, 'pick']],
    ['POST',   '#^/users/pick$#',             [Users::class, 'pick']],
    ['GET',    '#^/users/staff$#',            [Users::class, 'staff']],
    ['POST',   '#^/users/staff$#',            [Users::class, 'staff']],
    ['PATCH',  '#^/users/([a-f0-9-]{36})$#',  fn($id) => Users::update($id)],
    ['POST',   '#^/users/([a-f0-9-]{36})/send-reset$#', fn($id) => PasswordReset::adminTrigger($id)],
    ['POST',   '#^/users/([a-f0-9-]{36})/delete$#',     fn($id) => Users::delete($id)],

    // v0.3.1 — manual Ubuntu eLearning sync (admin-triggered)
    ['POST',   '#^/admin/moodle/sync$#',                [MoodleSync::class, 'syncEndpoint']],
    // v0.3.5j — lightweight poll used by the header bell to highlight new
    // Moodle-sourced rows since the user's last-seen timestamp.
    ['GET',    '#^/admin/moodle/news$#',                [MoodleSync::class, 'news']],
    ['POST',   '#^/admin/moodle/news$#',                [MoodleSync::class, 'news']],
    // v0.3.1b — unattended cron trigger (shared-secret header)
    ['POST',   '#^/admin/moodle/sync-cron$#',           [MoodleSync::class, 'cronEndpoint']],
    // v0.3.7 — course banner image fetched from Moodle during sync,
    // served from our own storage to avoid leaking the WS token.
    ['GET',    '#^/courses/([a-f0-9-]{36})/image$#',    fn($id) => MoodleSync::serveCourseImage($id)],

    // v0.3.2 — donor reports (admin only)
    ['POST',   '#^/admin/reports/donor$#',              [Reports::class, 'donor']],

    // v0.3.3 — public stories feed (no auth)
    ['GET',    '#^/public/stories$#',                                       [PublicFeed::class, 'stories']],
    ['GET',    '#^/public/stories/([a-f0-9-]{36})/(photo|audio)$#',         fn($id, $kind) => PublicFeed::media($id, $kind)],
    // v0.3.3a — views and likes
    ['POST',   '#^/public/stories/([a-f0-9-]{36})/view$#',                  fn($id) => PublicFeed::view($id)],
    ['POST',   '#^/public/stories/([a-f0-9-]{36})/like$#',                  fn($id) => PublicFeed::like($id)],

    ['POST',   '#^/stories/([a-f0-9-]{36})/media/(photo|audio)$#',     fn($id, $kind) => Media::upload($id, $kind)],
    ['GET',    '#^/stories/([a-f0-9-]{36})/media/(photo|audio)$#',     fn($id, $kind) => Media::download($id, $kind)],
    // POST alias so corporate proxies (Zscaler) that intercept authenticated GETs
    // don't strip the Authorization header on media downloads.
    ['POST',   '#^/stories/([a-f0-9-]{36})/media/(photo|audio)/get$#', fn($id, $kind) => Media::download($id, $kind)],
    ['DELETE', '#^/stories/([a-f0-9-]{36})/media/(photo|audio)$#',     fn($id, $kind) => Media::delete($id, $kind)],
];

try {
    foreach ($routes as [$m, $pattern, $handler]) {
        if ($m !== $method) continue;
        if (preg_match($pattern, $path, $matches)) {
            array_shift($matches);
            $handler(...$matches);
            exit;
        }
    }
    Response::error('not_found', 'Route not found: ' . $method . ' ' . $path, 404);
} catch (\Throwable $e) {
    error_log('[ubuntu30] ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    if (Config::isProduction()) {
        Response::error('server_error', 'An internal error occurred.', 500);
    } else {
        Response::error('server_error', $e->getMessage(), 500, ['trace' => $e->getTraceAsString()]);
    }
}
