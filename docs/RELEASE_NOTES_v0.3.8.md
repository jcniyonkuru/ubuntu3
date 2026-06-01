# Ubuntu 3.0 — v0.3.8 release notes

**Cut date:** June 2026
**Service worker cache:** `ubuntu30-v0.3.8`
**Targeted at:** ongoing trainer feedback rounds (Burundi) + first funder-facing deliverables

---

## What's in this release

### PWA — session capture
- **Bulk attendance.** "All present" action circle on session detail flips every attendee to present in one tap. Honours walk-ins.
- **Quick session resume.** Opening today's session auto-scrolls past the header so the attendance roster is the first thing trainers see.
- **Session photo (visual proof) end-to-end.** Group photo at the start of every session: capture, store locally, sync to server (`/api/sessions/<id>/media/photo`), display in the session detail banner, used as the session card thumbnail in the Sessions list. Banner is height-capped, deletable inline, and can be dragged to reposition the crop. Migration `v0.3.8a-session-photo.sql` adds `training_sessions.has_photo`.
- **Voice notes on sessions.** Hold-to-record audio memo per session (max ~60 s). Live recording pulse, in-browser playback, sync via `/api/sessions/<id>/media/audio`. Migration `v0.3.8b-session-audio.sql` adds `training_sessions.has_audio`.

### PWA — participant management
- **Duplicate-name warning.** The + Participant picker shows a "Did you mean…?" hint when an entered first/last name fuzzy-matches an existing participant on the same course (Levenshtein + NFD diacritic strip). Cancellable bypass for genuine namesakes.
- **At-risk pill.** Participants flagged with an "At-risk" badge after 3+ consecutive absences. Tooltip explains the trigger.
- **PDF certificate per participant.** "Generate certificate" button on participant detail produces a single-page printable certificate via a body-class print stylesheet. Multilingual (FR / EN / RN).

### PWA — analytics & exports
- **Attendance trend chart on course detail.** Hand-rolled SVG sparkline showing the attendance % per session, with the average overlaid as a dashed line. No new chart dependency.
- **CSV export from the course detail.** "Export attendance (CSV)" and "Export stories (CSV)" buttons, UTF-8 BOM so Excel handles French/Kirundi accents correctly out of the box.
- **Inline editor on Reports → Participants to complete.** Edit `Sex` / `Age range` straight from the row instead of bouncing to the participant detail page.

### PWA — story capture
- **Story prompts.** Blank story form now shows a rotating pool of 8 starter prompts in FR / EN / RN to help trainers begin.

### PWA — onboarding
- **First-run tour.** First time a non-admin lands on the dashboard, a 4-step coachmark walks them through the four main tabs (Dashboard → Sessions → Stories → More) with a spotlight + tooltip on each tab. Skippable, dismissed via `localStorage['ubuntu30.tourSeen']`. Replayable from More → App tour.

### Admin
- **Audit log view.** New `Audit log` sidebar entry shows "who edited what, when" across cohorts, courses, sessions, participants, and stories. Derived from the existing `author_id` + `server_updated_at` / `created_at` / `deleted_at` columns — no schema change. Filters: entity, action (created/updated/deleted), date range. Paginated. Per-page CSV download.
- **Sample-data toggle for trainer training.** Admin can spin up a self-contained `DEMO — Sandbox cohort` (10 participants/course × 2 courses, 5 sessions/course on a 2-week cadence, ~72 % attendance, 2 stories) and remove it again in one click. The demo syncs down to every device so trainers can practice in the PWA. Anchored by the cohort name prefix `DEMO — ` so no schema change is required; the donor portal filters it out.

### Public surface (funder-facing)
- **Donor portal mini-site at `donors.academyubuntu.com`.** Read-only dashboard with aggregated, anonymised stats — active cohorts, courses, participants, sessions (total + last 30 days), average attendance, stories with consent, demographics, last-6-month trend, reach by region, and 6 recent published stories. New endpoint `GET /api/public/donor-stats` (no auth, 60 s cache). Strict PII minimisation: no IDs / names / contacts in the payload; demographic buckets below 5 people roll into "Other"; DEMO cohort and tombstoned rows excluded by a single `cohortFilter()` helper.

### Server / API additions
- `Media::uploadSessionMedia / downloadSessionMedia / deleteSessionMedia($id, $kind)` with `$kind in {'photo','audio'}`.
- `Sync.php` `sessions` entity now exposes `hasPhoto` and `hasAudio` flags.
- New classes:
  - `Audit.php` — `GET /api/admin/audit`
  - `Demo.php` — `POST /api/admin/demo/{seed,remove}`, `GET /api/admin/demo/status`
  - `DonorPortal.php` — `GET /api/public/donor-stats`

### Schema migrations included in this release

| Migration | Purpose |
| --- | --- |
| `v0.3.8a-session-photo.sql` | adds `training_sessions.has_photo TINYINT(1) NOT NULL DEFAULT 0` |
| `v0.3.8b-session-audio.sql` | adds `training_sessions.has_audio TINYINT(1) NOT NULL DEFAULT 0` |

Apply with (idempotent — both use `IF NOT EXISTS`):

```bash
sudo docker exec -i moodle-mariadb-1 \
  mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
  < /opt/ubuntu3/server/sql/migrations/v0.3.8a-session-photo.sql

sudo docker exec -i moodle-mariadb-1 \
  mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
  < /opt/ubuntu3/server/sql/migrations/v0.3.8b-session-audio.sql
```

---

## Deploy checklist

From your Mac, on the `v0.3.8` tag (or `main` after the merge):

```bash
cd "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform"

# Stage server/ and app/ to /tmp on the droplet
rsync -av --delete --exclude 'storage/' --exclude 'config.php' \
  "./server/" ubuntu@165.232.85.152:/tmp/u3-v0.3.8-server/
rsync -av --delete \
  "./app/"    ubuntu@165.232.85.152:/tmp/u3-v0.3.8-app/
```

Then ssh to the droplet and swap into place:

```bash
ssh ubuntu@165.232.85.152
sudo rsync -av --delete /tmp/u3-v0.3.8-server/ /opt/ubuntu3/server/
sudo rsync -av --delete /tmp/u3-v0.3.8-app/    /opt/ubuntu3/app/

# Migrations (idempotent)
sudo docker exec -i moodle-mariadb-1 \
  mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
  < /opt/ubuntu3/server/sql/migrations/v0.3.8a-session-photo.sql
sudo docker exec -i moodle-mariadb-1 \
  mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
  < /opt/ubuntu3/server/sql/migrations/v0.3.8b-session-audio.sql

# Storage dir for session media (photo + audio)
sudo mkdir -p /opt/ubuntu3/storage/sessions
sudo chown 33:33 /opt/ubuntu3/storage/sessions
sudo chmod 0775  /opt/ubuntu3/storage/sessions

sudo rm -rf /tmp/u3-v0.3.8-server /tmp/u3-v0.3.8-app
sudo docker restart ubuntu3-app
```

Verify on production:

```bash
curl -s https://ubuntu3.academyubuntu.com/app.js | grep "APP_VERSION = " | head -1
# → const APP_VERSION = '0.3.8';
```

### Donor portal hosting (optional, one-time Caddy work)

The donor mini-site lives at `app/donors/index.html`. To expose it at
`donors.academyubuntu.com` in production, add a Caddy block that serves
that path and reverse-proxies `/api/*` to the same backend so the page
stays same-origin and avoids CORS:

```caddyfile
donors.academyubuntu.com {
    root * /opt/ubuntu3/app/donors
    file_server

    handle /api/* {
        reverse_proxy ubuntu3-app:80
    }
}
```

The endpoint sets `Cache-Control: public, max-age=60` so a CDN / Caddy
in front can serve the JSON straight from cache between funder visits.

---

## Known limitations

- **Local development behind corporate Zscaler** still can't reach GitHub or Moodle from the container; pushes and Moodle sync need to be run from your Mac or a non-corporate network. The rest of the stack works locally.
- **Demo cohort is anchored on the name prefix `DEMO — `.** If an admin renames it from the database directly, the cleanup endpoint and donor portal exclude filter will both stop recognising it. Edit it from the admin UI instead.
- **Audit log excludes attendance toggles** by design — every present/absent flip would otherwise drown the timeline. The donor stats and reports keep counting them, just the per-row audit doesn't list them.
