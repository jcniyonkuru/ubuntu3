# Ubuntu 3.0 — v0.3.1b: Unattended Moodle sync

Turns the manual "Sync with Ubuntu eLearning" button into a scheduled background job.

## What got added

- `server/src/MoodleSync.php` — new `cronEndpoint()` method, validates `X-Cron-Secret` via `hash_equals`.
- `server/public/index.php` — new route `POST /api/admin/moodle/sync-cron`.
- `server/config.example.php` — new `moodle.cron_secret` setting.
- `server/bin/moodle-cron.php` — CLI entry point, runs `MoodleSync::syncAll()` directly. No HTTP, no secret needed.
- `server/bin/ubuntu3-moodle-cron` — system crontab template (drops in `/etc/cron.d/`).

No PWA / admin UI changes. No SQL migrations. The existing manual sync button still works.

## Two ways to trigger it

Pick the one that matches your setup. **CLI** is simpler when cron runs on the same host as PHP. **HTTP** is for when the scheduler lives elsewhere (another container, external uptime monitor, etc.).

### Option A — CLI via docker exec (recommended)

The Ubuntu 3.0 backend runs inside the `ubuntu3-app` container. The host
mounts `/opt/ubuntu3/config.php` into the container at `/var/www/server/config.php`
(see `docker-compose.yml`), so the CLI script finds the real config the moment
it boots inside the container. No shared secret needed — Docker socket access
is the only credential.

1. **Deploy the new files** (from your Mac):
   ```bash
   rsync -avz "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform/server/bin/" \
     ubuntu@165.232.85.152:/opt/ubuntu3/server/bin/
   rsync -avz "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform/server/src/MoodleSync.php" \
     ubuntu@165.232.85.152:/opt/ubuntu3/server/src/MoodleSync.php
   rsync -avz "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform/server/public/index.php" \
     ubuntu@165.232.85.152:/opt/ubuntu3/server/public/index.php
   ```
   The `./server` directory on the host is bind-mounted into the container at
   `/var/www/server`, so changes appear immediately — no container rebuild
   needed.

2. **Smoke-test the CLI** (on the droplet, in the DigitalOcean console as `ubuntu`):
   ```bash
   sudo docker exec ubuntu3-app php /var/www/server/bin/moodle-cron.php
   ```
   You should see a summary line like:
   ```
   [moodle-cron] 2026-05-19 12:34:56Z — groups=3 sessions(+0/~2/-0) participants(+5/~0/-0) errors=0
   ```
   Plus the full JSON summary underneath.

3. **Install the system crontab** on the host:
   ```bash
   sudo cp /opt/ubuntu3/server/bin/ubuntu3-moodle-cron /etc/cron.d/ubuntu3-moodle-cron
   sudo chmod 644 /etc/cron.d/ubuntu3-moodle-cron
   sudo touch /var/log/ubuntu3-moodle-cron.log
   ```

4. **Verify cron picked it up**:
   ```bash
   sudo systemctl status cron        # service is active
   sudo grep CRON /var/log/syslog | tail -20
   ```

5. **First scheduled run** — the template fires at 02:15 server-local time. After it runs, check the log:
   ```bash
   sudo tail -50 /var/log/ubuntu3-moodle-cron.log
   ```

6. **Cleanup the phantom config** (one-off):
   ```bash
   sudo rm /opt/ubuntu3/server/config.php
   ```
   This file isn't read by the running container (the real config is mounted
   from `/opt/ubuntu3/config.php`). It just clutters debugging.

### Option B — HTTP with shared secret

Use this when cron runs from a different machine or container.

1. **Generate a 64-char hex secret** on the droplet:
   ```bash
   php -r "echo bin2hex(random_bytes(32)) . PHP_EOL;"
   ```
   Copy the output.

2. **Add it to `config.php`** (on the droplet):
   ```bash
   sudo -u www-data nano /opt/ubuntu3/server/config.php
   ```
   In the `'moodle' => [ ... ]` block, set:
   ```php
   'cron_secret' => 'PASTE_THE_64_CHAR_HEX_HERE',
   ```

3. **Test the endpoint** (replace `<SECRET>` with the value you generated):
   ```bash
   curl -X POST \
     -H "X-Cron-Secret: <SECRET>" \
     https://ubuntu3.academyubuntu.com/api/admin/moodle/sync-cron
   ```
   You should get a JSON summary back. A wrong/missing secret returns `403`.

4. **Schedule it** in whatever scheduler you use. Example with system cron on any host:
   ```
   15 2 * * * curl -sf -X POST -H "X-Cron-Secret: <SECRET>" https://ubuntu3.academyubuntu.com/api/admin/moodle/sync-cron >> /var/log/ubuntu3-moodle-cron.log 2>&1
   ```

## Common gotchas

- **Timezone**: cron uses the server's local timezone. If you want UTC, check with `timedatectl` and either change the server's timezone (`sudo timedatectl set-timezone UTC`) or compute the offset.
- **PHP errors hidden**: cron output goes to the log file you redirected to. If you see no output, check `sudo journalctl -u cron | tail` for cron-level errors (permissions, missing user, etc.).
- **Lock file**: if a sync somehow runs longer than 24 hours (it shouldn't — even with hundreds of groups) and the next one fires while it's still running, both could double-write. Add a `flock` wrapper if you ever scale that far.
- **`config.php` ownership**: the CLI must be runnable by `www-data`. If you copy files as root, you may need to `sudo chown www-data:www-data /opt/ubuntu3/server/config.php`.
