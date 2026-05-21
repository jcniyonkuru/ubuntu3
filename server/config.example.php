<?php
/**
 * Ubuntu 3.0 — Backend configuration
 *
 * Copy this file to config.php and fill in the real values.
 * config.php is gitignored and should NEVER be committed.
 */

return [
    // MySQL — same server as Moodle, separate database.
    'db' => [
        'host'     => '127.0.0.1',
        'name'     => 'ubuntu_me',
        'user'     => 'ubuntu_me',
        'pass'     => 'CHANGE_ME_TO_A_STRONG_PASSWORD',
        'charset'  => 'utf8mb4',
    ],

    // Public-facing app URL (used in emails).
    'app_url' => 'https://me.academyubuntu.com',

    // Brevo (formerly Sendinblue) — used in Phase B for password-reset emails.
    'brevo' => [
        'api_key'   => '',                                     // xkeysib-... from Brevo dashboard
        'from_email' => 'no-reply@academyubuntu.com',
        'from_name'  => 'Académie Ubuntu',
    ],

    // Auth.
    'auth' => [
        'token_ttl_seconds' => 30 * 24 * 3600,   // 30 days, sliding
        'bcrypt_cost'       => 12,
    ],

    // Ubuntu eLearning (Moodle) — used for optional sign-in fallback and v0.3 sync.
    'moodle' => [
        'enabled' => false,                       // set to true to enable eLearning sign-in
        'url'     => 'https://learn.academyubuntu.com',
        'service' => 'moodle_mobile_app',         // Moodle service the auth-token endpoint uses
        'ws_token' => '',                         // Service-account Web Services token (v0.3.1 sync)

        // v0.3.1b — unattended cron sync.
        // Shared secret required to call POST /api/admin/moodle/sync-cron without
        // a logged-in user. Generate with:
        //   php -r "echo bin2hex(random_bytes(32));"
        // Leave empty to disable HTTP-triggered cron (the CLI entry point
        // server/bin/moodle-cron.php works regardless).
        'cron_secret' => '',
    ],

    // CORS. The PWA and API are same-origin, so this is empty by default.
    // If you split them across subdomains, list the PWA's origin here.
    'cors_origins' => [],

    // Set to true on production. When true, the API refuses non-HTTPS.
    'production' => true,
];
