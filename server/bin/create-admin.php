<?php
/**
 * Ubuntu 3.0 — Initial admin / trainer creation
 *
 * Usage on the droplet (run as the web user so the config is readable):
 *   php server/bin/create-admin.php --email=you@example.com --name="Jane Doe" [--role=admin|trainer] [--lang=fr|en|rn] [--password=...]
 *
 * If --password is omitted, a 12-char random temp password is generated and printed.
 */
declare(strict_types=1);

$base = dirname(__DIR__);
require $base . '/src/Config.php';
require $base . '/src/Response.php';
require $base . '/src/Util.php';
require $base . '/src/Db.php';

use Ubuntu\Config;
use Ubuntu\Db;
use Ubuntu\Util;

function arg(string $name, array $argv, $default = null) {
    foreach ($argv as $a) {
        if (str_starts_with($a, "--{$name}=")) return substr($a, strlen($name) + 3);
        if ($a === "--{$name}") return true;
    }
    return $default;
}

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Run from the command line only.\n");
    exit(1);
}

$email    = arg('email', $argv);
$username = arg('username', $argv);
$first    = arg('first', $argv) ?: arg('first-name', $argv);
$last     = arg('last',  $argv) ?: arg('last-name',  $argv);
// Backward compat: if --first/--last aren't given but --name is, split it
$name     = arg('name', $argv);
if (!$first && !$last && $name) {
    $parts = explode(' ', trim((string) $name), 2);
    $first = $parts[0] ?? '';
    $last  = $parts[1] ?? '';
}
$role     = arg('role', $argv, 'admin');
$lang     = arg('lang', $argv, 'fr');
$pwd      = arg('password', $argv);

if (!$email || !$first || !$last) {
    fwrite(STDERR,
        "Usage: php server/bin/create-admin.php --email=you@example.com --first=\"Jane\" --last=\"Doe\""
      . " [--username=jane] [--role=admin|trainer] [--lang=fr|en|rn] [--password=...]\n"
      . "       --first and --last are both required (was --name in v0.3.3).\n"
    );
    exit(2);
}
if (!$username) $username = strtolower($email); // default username = email

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Invalid email.\n"); exit(2);
}
if (!in_array($role, ['admin', 'trainer'], true)) { fwrite(STDERR, "Role must be admin or trainer.\n"); exit(2); }
if (!in_array($lang, ['fr', 'en', 'rn'], true)) { fwrite(STDERR, "Lang must be fr, en, or rn.\n"); exit(2); }
$first = trim((string) $first);
$last  = trim((string) $last);
$name  = trim($first . ' ' . $last);

Config::load($base . '/config.php');

if (!$pwd) {
    $alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $pwd = '';
    for ($i = 0; $i < 12; $i++) $pwd .= $alpha[random_int(0, strlen($alpha) - 1)];
}
if (strlen((string) $pwd) < 8) { fwrite(STDERR, "Password must be at least 8 characters.\n"); exit(2); }

$cost = (int) Config::get('auth.bcrypt_cost', 12);
$hash = password_hash((string) $pwd, PASSWORD_BCRYPT, ['cost' => $cost]);
$id   = Util::uuid();
$now  = Db::nowUtc();

try {
    $stmt = Db::pdo()->prepare(
        'INSERT INTO users (id, email, username, password_hash, name, first_name, last_name, role, language, must_change_password, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,1,?,?)'
    );
    $stmt->execute([$id, strtolower((string) $email), strtolower((string) $username), $hash, $name, $first, $last, $role, $lang, $now, $now]);
} catch (\PDOException $e) {
    if (($e->errorInfo[1] ?? 0) === 1062) {
        if (stripos($e->getMessage(), 'username') !== false) {
            fwrite(STDERR, "Username already exists.\n"); exit(3);
        }
        fwrite(STDERR, "Email already exists.\n"); exit(3);
    }
    throw $e;
}

echo "OK\n";
echo "id:         {$id}\n";
echo "email:      {$email}\n";
echo "username:   {$username}\n";
echo "first name: {$first}\n";
echo "last name:  {$last}\n";
echo "role:       {$role}\n";
echo "language:   {$lang}\n";
echo "password:   {$pwd}\n";
echo "\nNote: the user must change this password on first login.\n";
