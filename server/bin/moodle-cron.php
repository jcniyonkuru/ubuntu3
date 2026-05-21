<?php
/**
 * Ubuntu 3.0 — Unattended Moodle sync (cron entry point)
 *
 * Iterates every group with a linked Moodle course and pulls down activities
 * (→ sessions) and enrolled students (→ participants). Strictly one-way; rows
 * with source='user' are never touched.
 *
 * Designed to be called from a host crontab. Exit code is 0 on success
 * (even if no groups were synced) and 2 on misconfiguration / fatal error.
 *
 * Usage:
 *   php server/bin/moodle-cron.php                 # use default config.php
 *   php server/bin/moodle-cron.php --quiet         # only print summary line
 *   php server/bin/moodle-cron.php --config=/path  # alternate config
 *
 * Example crontab line (run daily at 02:15 UTC):
 *   15 2 * * * www-data /usr/bin/php /opt/ubuntu3/server/bin/moodle-cron.php --quiet >> /var/log/ubuntu3-moodle-cron.log 2>&1
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Run from the command line only.\n");
    exit(1);
}

$base = dirname(__DIR__);
require $base . '/src/Config.php';
require $base . '/src/Response.php';
require $base . '/src/Util.php';
require $base . '/src/Db.php';
require $base . '/src/Auth.php';
require $base . '/src/MoodleSync.php';

use Ubuntu\Config;
use Ubuntu\MoodleSync;

function arg(string $name, array $argv, $default = null) {
    foreach ($argv as $a) {
        if (str_starts_with($a, "--{$name}=")) return substr($a, strlen($name) + 3);
        if ($a === "--{$name}") return true;
    }
    return $default;
}

$configPath = (string) arg('config', $argv, $base . '/config.php');
$quiet      = (bool)   arg('quiet',  $argv, false);

try {
    Config::load($configPath);
} catch (\Throwable $e) {
    fwrite(STDERR, '[moodle-cron] Config load failed: ' . $e->getMessage() . "\n");
    exit(2);
}

$startedHuman = gmdate('Y-m-d H:i:s') . ' UTC';
if (!$quiet) fwrite(STDOUT, "[moodle-cron] started at {$startedHuman}\n");

try {
    $summary = MoodleSync::syncAll();
} catch (\Throwable $e) {
    fwrite(STDERR, '[moodle-cron] Sync threw: ' . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n");
    exit(2);
}

$line = sprintf(
    '[moodle-cron] %s — groups=%d sessions(+%d/~%d/-%d) participants(+%d/~%d/-%d) errors=%d',
    gmdate('Y-m-d H:i:s') . 'Z',
    $summary['groups_linked']         ?? 0,
    $summary['sessions_created']      ?? 0,
    $summary['sessions_updated']      ?? 0,
    $summary['sessions_deleted']      ?? 0,
    $summary['participants_created']  ?? 0,
    $summary['participants_updated']  ?? 0,
    $summary['participants_deleted']  ?? 0,
    count($summary['errors'] ?? [])
);
fwrite(STDOUT, $line . "\n");

if (!$quiet) {
    fwrite(STDOUT, json_encode($summary, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
}

if (!empty($summary['errors'])) {
    fwrite(STDERR, "[moodle-cron] " . count($summary['errors']) . " group(s) failed:\n");
    foreach ($summary['errors'] as $err) {
        fwrite(STDERR, "  - {$err['group_name']} ({$err['group_id']}): {$err['error']}\n");
    }
}

exit(0);
