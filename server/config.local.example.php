<?php
/**
 * Ubuntu 3.0 — LOCAL development config.
 *
 * Copy this file to server/config.php (which is gitignored) when running the
 * Docker Compose stack. DO NOT use these settings in production.
 *
 *   cp server/config.local.example.php server/config.php
 */

return [
    // Talks to the MariaDB container by service name from inside the app container.
    'db' => [
        'host'    => 'db',                       // docker compose service name
        'name'    => 'ubuntu_me',
        'user'    => 'ubuntu_me',
        'pass'    => 'local-dev-pwd',            // matches docker-compose.yml
        'charset' => 'utf8mb4',
    ],

    'app_url' => 'http://localhost:8080',

    // Brevo disabled locally — password reset emails are printed to PHP error log.
    'brevo' => [
        'api_key'    => '',
        'from_email' => 'no-reply@localhost',
        'from_name'  => 'Ubuntu 3.0 local',
    ],

    'auth' => [
        'token_ttl_seconds' => 30 * 24 * 3600,
        'bcrypt_cost'       => 10,    // a touch cheaper for snappier local logins
    ],

    // Moodle integration is OFF by default locally. If you want to test the
    // Moodle sync against the real eLearning instance, paste the prod values
    // here — but be aware that any new participants you sync will be created
    // ONLY in the local DB, not in production (the local DB is isolated).
    'moodle' => [
        'enabled'     => false,
        'url'         => 'https://learn.academyubuntu.com',
        'service'     => 'moodle_mobile_app',
        'ws_token'    => '',
        'cron_secret' => '',
    ],

    'cors_origins' => [],

    // CRITICAL: keep this false locally so the HTTPS check in index.php
    // doesn't refuse plain-HTTP localhost requests.
    'production' => false,
];
