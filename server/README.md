# Ubuntu 3.0 — Backend (v0.2.1)

PHP 8 + MySQL backend that lives alongside the existing Moodle install on your DigitalOcean droplet. Provides authentication, sync, media storage, password reset (via Brevo), and an admin web view for the PWA in `../app/`.

## What's in here

```
server/
├── public/
│   ├── index.php              Front controller for /api
│   ├── .htaccess
│   └── admin/                 Admin web view (HTML/CSS/JS)
├── src/                       PHP sources (Auth, Sync, Users, Media, PasswordReset, Email, …)
├── sql/schema.sql             Database schema
├── bin/create-admin.php       CLI to mint the first admin
├── storage/                   Media bytes (created automatically on first upload)
├── config.example.php         Copy to config.php and fill in
└── README.md
```

## Deployment on your DigitalOcean droplet

These commands assume the same droplet that runs Moodle. The backend is installed under `/var/www/ubuntu3-server` and the PWA stays at `/var/www/ubuntu3`. Adjust paths to taste.

### 1. Database

Log in to MySQL as a user that can `CREATE DATABASE`:

```bash
sudo mysql
```

```sql
CREATE DATABASE ubuntu_me CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ubuntu_me'@'localhost' IDENTIFIED BY 'PUT_A_STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON ubuntu_me.* TO 'ubuntu_me'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Import the schema:

```bash
mysql -u ubuntu_me -p ubuntu_me < /var/www/ubuntu3-server/sql/schema.sql
```

### 2. Files

From your laptop:

```bash
# Upload the server folder
rsync -av --delete \
  "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform/server/" \
  YOUR_USER@DROPLET:/var/www/ubuntu3-server/

# Upload the PWA (if not already there)
rsync -av --delete \
  "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform/app/" \
  YOUR_USER@DROPLET:/var/www/ubuntu3/
```

On the droplet:

```bash
# Permissions: only the web user reads config.php
sudo chown -R www-data:www-data /var/www/ubuntu3-server
sudo find /var/www/ubuntu3-server -type d -exec chmod 755 {} \;
sudo find /var/www/ubuntu3-server -type f -exec chmod 644 {} \;

# Media storage (writable by Apache)
sudo mkdir -p /var/www/ubuntu3-server/storage/stories
sudo chown -R www-data:www-data /var/www/ubuntu3-server/storage
sudo chmod -R 755 /var/www/ubuntu3-server/storage
```

### 3. Config

```bash
cd /var/www/ubuntu3-server
sudo -u www-data cp config.example.php config.php
sudo -u www-data nano config.php
```

Fill in:
- `db.pass` — the password you chose above
- `app_url` — your public URL (e.g. `https://me.academyubuntu.com`). Used in password-reset email links.
- `brevo.api_key` — your Brevo SMTP API key (starts with `xkeysib-...`). Used for password-reset emails. Required for self-service "Forgot password" and admin "Send reset" actions.
- `brevo.from_email` and `brevo.from_name` — what shows up in the trainer's inbox.

### 4. Apache vhost

Create `/etc/apache2/sites-available/ubuntu3.conf`:

```apache
<VirtualHost *:80>
    ServerName me.academyubuntu.com
    DocumentRoot /var/www/ubuntu3

    # PWA static files (no PHP)
    <Directory /var/www/ubuntu3>
        Options -Indexes +FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    # Send /api to the PHP front controller
    Alias /api /var/www/ubuntu3-server/public
    <Directory /var/www/ubuntu3-server/public>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted

        # Route every URL under /api/* to index.php
        RewriteEngine On
        RewriteBase /api/
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^(.*)$ index.php [QSA,L]
    </Directory>

    # Admin web view
    Alias /admin /var/www/ubuntu3-server/public/admin
    <Directory /var/www/ubuntu3-server/public/admin>
        Options -Indexes +FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    AddType application/manifest+json .webmanifest

    ErrorLog ${APACHE_LOG_DIR}/ubuntu3-error.log
    CustomLog ${APACHE_LOG_DIR}/ubuntu3-access.log combined
</VirtualHost>
```

Enable and reload:

```bash
sudo a2enmod rewrite
sudo a2ensite ubuntu3
sudo apache2ctl configtest
sudo systemctl reload apache2
```

### 5. HTTPS (Let's Encrypt)

Make sure DNS A record for `me.academyubuntu.com` points to the droplet, then:

```bash
sudo certbot --apache -d me.academyubuntu.com
```

### 6. Create the first admin

```bash
cd /var/www/ubuntu3-server
sudo -u www-data php bin/create-admin.php \
  --email=you@academyubuntu.com \
  --name="Your Name" \
  --role=admin
```

The script prints a temporary password. Open the PWA, sign in with this email + temp password, you'll be forced to change it on first login.

### 7. Smoke test

From any machine:

```bash
# 1) Service is reachable
curl https://me.academyubuntu.com/api/
# {"service":"ubuntu30","version":"v0.2.0"}

curl https://me.academyubuntu.com/api/health
# {"ok":true,"time":"2026-..."}

# 2) Login (replace email and temp password)
TOKEN=$(curl -s -X POST https://me.academyubuntu.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@academyubuntu.com","password":"YOUR_TEMP_PASSWORD"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
echo "Token: $TOKEN"

# 3) Pull empty data set
curl -H "Authorization: Bearer $TOKEN" \
  "https://me.academyubuntu.com/api/sync/pull?since=1970-01-01T00:00:00Z"

# 4) Admin web view
open https://me.academyubuntu.com/admin/

# 5) Brevo email is reachable (will send a reset link if the email exists)
curl -X POST https://me.academyubuntu.com/api/auth/forgot-password \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@academyubuntu.com"}'
# {"ok":true}
```

### 8. End-to-end check on a phone

1. Open `https://me.academyubuntu.com/` on the phone (Chrome / Safari).
2. Log in with your admin email + temp password. You'll be forced to change it.
3. Pick the language (FR / EN / RN) from the header.
4. Create a cohort → group → participant → session → mark attendance → capture a story with a photo. Watch the sync icon spin then settle on idle.
5. From a laptop, open `https://me.academyubuntu.com/admin/`, log in, navigate to Stories. The story you just captured should be there. The "photo" link downloads the bytes.

## Adding more trainers

While Phase A doesn't yet have a UI, you can mint trainer accounts from the command line:

```bash
sudo -u www-data php bin/create-admin.php \
  --email=alice@academyubuntu.com \
  --name="Alice Mukamana" \
  --role=trainer \
  --lang=fr
```

The script prints a temporary password. Send it to Alice. She logs in, the PWA forces her to change it.

Phase B will add an admin web UI that does this with a form and sends invite emails via Brevo.

## Updating later

When you change PHP source or the PWA, just `rsync` again. No service to restart for code changes (PHP-FPM picks them up on the next request). If you change Apache config, run `sudo systemctl reload apache2`.

When the PWA changes, bump the `CACHE` version string at the top of `app/service-worker.js` (e.g. from `v0.2.0` to `v0.2.1`). Devices will pick up the new version on next launch.

## v0.3.0 — Optional Ubuntu eLearning sign-in

### Migrate the database

```bash
UBUNTU_DB_PASS='YOUR_UBUNTU_DB_PASS'
sudo docker exec -i moodle-mariadb-1 mariadb -uubuntu_me -p"$UBUNTU_DB_PASS" ubuntu_me \
  < /opt/ubuntu3/server/sql/migrations/v0.3.0.sql
```

### Configure Ubuntu 3.0 to talk to Ubuntu eLearning

Add the `'moodle'` block in `/opt/ubuntu3/config.php` (after `'auth'`):

```php
'moodle' => [
    'enabled' => true,
    'url'     => 'https://learn.academyubuntu.com',
    'service' => 'moodle_mobile_app',
    'ws_token' => '',   // for v0.3.1 sync, leave empty for now
],
```

Then restart the container:

```bash
sudo docker restart ubuntu3-app
```

### Click-by-click on the Ubuntu eLearning (Moodle) side — ~5 minutes

1. Sign in to `https://learn.academyubuntu.com` as a Moodle admin.
2. **Site administration** → **Server** → **Web services** → **Overview**.
3. Step 1 ("Enable web services") — make sure it's enabled.
4. Step 2 ("Enable protocols") — enable **REST protocol**.
5. Step 3 ("Manage tokens") — no token needed for v0.3.0 (token-based authentication uses the user's own credentials).
6. **Site administration** → **Plugins** → **Web services** → **External services**.
7. Find **Moodle mobile web service** in the list. Make sure **Enabled** is checked.
8. **Site administration** → **Server** → **Mobile authentication** → confirm "Enable web services for mobile devices" is on.

Quick smoke test from the droplet:

```bash
# Replace USERNAME and PASSWORD with a real Moodle user's credentials.
curl -sk "https://learn.academyubuntu.com/login/token.php" \
  -d "username=USERNAME&password=PASSWORD&service=moodle_mobile_app"
```

You should see `{"token":"...","privatetoken":"..."}`. That confirms Ubuntu eLearning will accept Ubuntu 3.0's credential checks.

### Test the end-to-end sign-in

1. Open `https://ubuntu3.academyubuntu.com/` in a fresh browser (or incognito).
2. Enter an email + password that exists ONLY in Ubuntu eLearning (not yet in Ubuntu 3.0).
3. The PWA logs you in: Ubuntu 3.0 creates a trainer record for that user automatically, linked to the eLearning account.
4. Confirm in the admin web view → Users → the new row shows the email and `lang` set from the eLearning profile.

### Disable / roll back

If anything goes wrong, set `'moodle' => ['enabled' => false]` in `config.php` and restart the container. Local accounts keep working — only the eLearning fallback is turned off.

## v0.3.1a — Activity & enrolment sync from Ubuntu eLearning

### Migrate the database

```bash
sudo docker exec -i moodle-mariadb-1 mariadb -h127.0.0.1 -uubuntu_me -pBurundi257 ubuntu_me < /opt/ubuntu3/server/sql/migrations/v0.3.1.sql
```

Verify:

```bash
sudo docker exec moodle-mariadb-1 mariadb -h127.0.0.1 -uubuntu_me -pBurundi257 ubuntu_me \
  -e "DESCRIBE training_sessions;" | grep -E '(source|moodle_activity)'
sudo docker exec moodle-mariadb-1 mariadb -h127.0.0.1 -uubuntu_me -pBurundi257 ubuntu_me \
  -e "DESCRIBE participants;" | grep -E '(source|moodle_user)'
sudo docker exec moodle-mariadb-1 mariadb -h127.0.0.1 -uubuntu_me -pBurundi257 ubuntu_me \
  -e "DESCRIBE groups_;" | grep moodle_course
```

Expect three new columns: `training_sessions.source`, `training_sessions.moodle_activity_id`, `participants.source`, `participants.moodle_user_id`, `groups_.moodle_course_id`.

### Moodle admin: create a service-account user + Web Services token (~10 min, one-time)

The sync runs unattended, so it can't use your personal user's token. Create a dedicated service-account user in Moodle:

1. Sign in as a Moodle admin.
2. **Site administration → Users → Accounts → Add a new user**.
   - Username: `ubuntu3-sync`
   - Authentication method: `Manual accounts`
   - Set a strong random password. The sync never logs in interactively — this password is only a back-stop.
   - Email: any address you control (e.g. `tech@academyubuntu.com`).
   - First name / Last name: `Ubuntu 3.0` / `Sync`.
3. Give the user **Manager** role at the site level (or a custom role with the capabilities listed below):
   - **Site administration → Users → Permissions → Assign system roles** → Manager → add `ubuntu3-sync`.

Required capabilities (Manager has them all by default):

- `webservice/rest:use`
- `moodle/course:viewhiddencourses`
- `moodle/course:view`
- `moodle/user:viewdetails`
- `moodle/role:assign` is NOT needed
- `moodle/course:viewhiddenactivities` (for retrieving all activities)

Now create a Web Services token:

4. **Site administration → Server → Web services → Manage tokens** → **Add**.
   - User: `ubuntu3-sync`.
   - Service: `Moodle mobile web service`.
   - Valid until: leave blank.
   - IP restriction: leave blank for now (lock down later if needed).
5. **Save**. Copy the long hex token — keep it safe.

### Put the token into config.php (droplet)

```bash
sudo nano /opt/ubuntu3/config.php
```

In the `'moodle'` block set `ws_token`:

```php
'moodle' => [
    'enabled'  => true,
    'url'      => 'https://learn.academyubuntu.com',
    'service'  => 'moodle_mobile_app',
    'ws_token' => 'PASTE_THE_TOKEN_HERE',
],
```

Save, then restart the container:

```bash
sudo docker restart ubuntu3-app
```

### Smoke test the WS token

```bash
curl -sk "https://learn.academyubuntu.com/webservice/rest/server.php" \
  -d "wstoken=YOUR_WS_TOKEN&wsfunction=core_course_get_contents&moodlewsrestformat=json&courseid=2"
```

(Replace `courseid=2` with a real course id from your Moodle.)

You should get back a JSON array of course sections each containing `modules`. If you get `{"exception":"...","errorcode":"accessexception"}`, the service account is missing a capability — re-check its role.

### Link a group to a course (in the PWA)

1. Sign into the PWA.
2. Cohorts → pick a cohort → pick a group → **Modifier** (or create a new group).
3. In the new field **"Cours Ubuntu eLearning lié (optionnel)"**, enter the course id (e.g. `2`).
4. Save.

### Trigger the sync

In the **admin web view** (`https://ubuntu3.academyubuntu.com/admin/`):

1. Go to **Sessions** in the sidebar.
2. Click **"Sync with Ubuntu eLearning"** at the top right.
3. Wait a couple seconds. The toast will show counts:
   `Sessions: +N ~M -K · Participants: +N ~M -K`.

Then navigate to the PWA → the linked group should now contain new sessions (one per activity) and new participants (one per enrolled student). They sync down on the next PWA sync (auto, every 5 minutes; or tap the sync icon).

### Setting up nightly auto-sync (optional, will be cleaner in v0.3.1b)

Until v0.3.1b adds the in-container cron with a shared secret, set up a host-side cron that hits the admin endpoint with a stored admin session token. Easiest interim:

```bash
sudo crontab -e
# Add:
# 0 2 * * * curl -sk -X POST -H "Authorization: Bearer SOME_ADMIN_TOKEN" https://ubuntu3.academyubuntu.com/api/admin/moodle/sync > /var/log/ubuntu3-sync.log 2>&1
```

(That admin token gets revoked the moment you log out of the admin web view, which is fragile. v0.3.1b will introduce a permanent shared-secret cron endpoint.)

### Rolling back

If the sync mis-behaves and you want to undo just the synced rows in one group:

```sql
UPDATE training_sessions SET deleted_at = NOW() WHERE group_id = 'GROUP_ID' AND source = 'moodle';
UPDATE participants       SET deleted_at = NOW() WHERE group_id = 'GROUP_ID' AND source = 'moodle';
```

User-typed sessions and participants stay untouched.

## What v0.2.1 does NOT yet do (queued for v0.2.2)

- **No soft-delete propagation.** If you delete a record locally, it stays on the server and on other devices. A real "delete from everywhere" needs tombstone sync.
- **No login rate limiting.** Brute-force on `/api/auth/login` is currently only protected by bcrypt cost. We'll add IP rate-limiting and a small audit log in v0.2.2.
- **No cross-device media display.** If trainer A uploads a photo and trainer B pulls the story, B's PWA sees the metadata but doesn't fetch the bytes until v0.2.2. The admin web view DOES fetch and display media — use it for now if you need cross-device viewing.

## Troubleshooting

**`curl` returns 404 for `/api/`**
Apache's `Alias` line is missing or `mod_rewrite` isn't enabled. Run `sudo a2enmod rewrite && sudo systemctl reload apache2`.

**`{"error":{"code":"https_required"}}`**
The API refuses non-HTTPS in production. Make sure certbot completed and your URL starts with `https://`.

**`{"error":{"code":"server_misconfigured"}}`**
`config.php` is missing or not readable by the web user. Re-run the `cp` and `chown` steps above.

**Login returns 401**
Either the password is wrong, or the user account was created with `disabled_at`. Check with `mysql -u ubuntu_me -p ubuntu_me -e "SELECT id, email, disabled_at FROM users;"`.

**Sync seems stuck on "syncing…"**
Open the browser DevTools and watch the Network tab. The PWA logs `[ubuntu30]` errors to console; the server logs to `/var/log/apache2/ubuntu3-error.log`.
