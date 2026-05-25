# Local development stack

Running the whole Ubuntu 3.0 platform on your Mac, isolated from production. No surprises, no remote DB calls, no risk to live users.

## What you get

- **PWA** at <http://localhost:8080>
- **Admin** at <http://localhost:8080/admin/>
- **API** at <http://localhost:8080/api/health>
- A **MariaDB 10.11** container with its own data volume, completely separate from the droplet's database.

Two Docker containers (`ubuntu3-app` for PHP + Apache, `ubuntu3-db` for MariaDB) plus a named volume for the DB. Project files are bind-mounted, so any edit in `app/` or `server/` shows up instantly on refresh.

## One-time setup

### 1. Install Docker Desktop

Download from <https://www.docker.com/products/docker-desktop/> and open it once so the daemon is running. You'll see the whale icon in the menu bar.

### 2. Copy the local config

```bash
cd "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform"
cp server/config.local.example.php server/config.php
```

The `server/config.php` file is gitignored — it stays out of source control.

### 3. Start the stack

```bash
docker compose up -d
```

The first run pulls the images (~300 MB), creates the data volume, applies `server/sql/schema.sql` and every migration in `server/sql/migrations/` in order, then starts both containers. Watch the logs to see the schema being loaded:

```bash
docker compose logs -f db
```

Wait until you see `[ubuntu3-init] done.` — that's the signal the DB is ready.

### 4. Create your first admin

The DB is empty by default. Create an admin user from inside the app container:

```bash
docker exec -it ubuntu3-app \
  php /var/www/server/bin/create-admin.php \
      --email=admin@local \
      --first-name=Local \
      --last-name=Admin \
      --role=admin \
      --password=local-admin-pwd
```

### 5. Sign in

Open <http://localhost:8080/admin/> in your browser and log in with `admin@local` / `local-admin-pwd`. From here you can also reach the PWA at <http://localhost:8080/>.

## Daily use

```bash
docker compose up -d         # start (idempotent)
docker compose logs -f app   # tail Apache + PHP logs
docker compose logs -f db    # tail MariaDB logs
docker compose ps            # show what's running
docker compose stop          # stop the containers (keeps data)
docker compose down          # stop AND remove containers (still keeps data)
docker compose down -v       # stop AND wipe the database — fresh start next up
```

You don't need to restart Docker when you edit code — Apache picks up file changes immediately. The exception is the **service worker**: bump the `CACHE` constant in `app/service-worker.js` whenever you change PWA assets, then hard-reload (Cmd-Shift-R) to clear the browser cache.

## Running the regression suite against local

```bash
cd tests
source .venv/bin/activate
TEST_BASE_URL=http://localhost:8080 \
TEST_ADMIN_EMAIL=admin@local \
TEST_ADMIN_PASSWORD=local-admin-pwd \
  pytest -v
```

Local tests run in seconds (no network round-trip to the droplet). Run them before every commit.

## Pulling a snapshot of production data (optional)

For testing with realistic data — e.g. the dedup migration on real duplicates, or the Moodle news bell with real Moodle imports:

```bash
# On the droplet (one-line, replace <PASSWORD>):
sudo docker exec moodle-mariadb-1 \
  mariadb-dump -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me > /tmp/prod.sql

# From your Mac:
scp ubuntu@165.232.85.152:/tmp/prod.sql ./.data/prod.sql

# Wipe local DB and reload:
docker compose down -v
docker compose up -d
docker exec -i ubuntu3-db \
  mariadb -uroot -p'local-root-pwd' ubuntu_me < ./.data/prod.sql

# Reset the admin password on a row you know the email of, so you can log in:
docker exec -it ubuntu3-db \
  mariadb -uroot -p'local-root-pwd' ubuntu_me \
    -e "UPDATE users SET password_hash = '\$2y\$10\$YN1FvxIO3FBPP9bckwHGYO5LWxqB1blf0kwYP.s4jrAUu5N/eEUYW' WHERE email='you@example.com';"
# The hash above is bcrypt('local-admin-pwd').
```

**Refresh policy:** pull at most once a week. Keeping local and prod in lockstep is more trouble than it's worth, and there are privacy considerations. Most v0.3.7 work needs no real data.

## Troubleshooting

**"Apache can't connect to db: Connection refused"** — the DB hasn't finished initialising. Check `docker compose logs db`; wait for `[ubuntu3-init] done.` then `docker compose restart app`.

**"https_required" 400 errors** — your `server/config.php` is still set to `'production' => true`. Make sure you copied `server/config.local.example.php` not `server/config.example.php`.

**"Database errors" after pulling new code** — a new migration landed. Restart the stack with `docker compose down && docker compose up -d`, or apply migrations by hand:
```bash
docker exec -i ubuntu3-db mariadb -uroot -p'local-root-pwd' ubuntu_me \
  < server/sql/migrations/v0.3.6...sql
```

**"Port 8080 is already in use"** — another service on your Mac is using it. Edit `docker-compose.yml`, change the host side of the mapping (`"127.0.0.1:8080:80"` → `"127.0.0.1:9090:80"`), then `docker compose up -d`.

**Clean slate** — `docker compose down -v && docker compose up -d` wipes the database and reapplies schema. Useful when migrations get tangled.

## Why both ports are on 127.0.0.1

Both `:8080` (Apache) and `:3308` (MariaDB) are bound to localhost only — they're not reachable from anywhere else on your Wi-Fi. If you want to test the PWA from a phone on the same network, change `127.0.0.1:8080:80` to `0.0.0.0:8080:80` temporarily, find your Mac's LAN IP, and load `http://192.168.x.x:8080`.

## What lives in `.data/`

`.data/storage` is a bind mount for user-uploaded photos / audio. It's a real folder on your Mac so the bytes survive container resets. The folder is gitignored.
