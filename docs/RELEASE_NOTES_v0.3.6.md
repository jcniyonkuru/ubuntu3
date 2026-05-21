# Ubuntu 3.0 — v0.3.6 release notes

**Cut date:** May 2026
**Service worker cache:** `ubuntu30-v0.3.6`
**Targeted at:** first wave of real-user feedback (trainers + admins, Burundi)

---

## What's in this release

### PWA — trainer-facing
- **Multi-facilitator courses.** A course now has a list of facilitators picked from staff (trainers + admins). Searchable picker with selected chips at the top, both in the PWA edit-course screen and in the admin console.
- **"My courses only" filter.** Dashboard counts, Courses list, and Sessions list scope to courses the current user facilitates. Defaults to ON. Toggle in the new Settings popup.
- **Settings popup.** Bottom-sheet on phones, centered modal on desktop. Section for Dashboard: KPI banner toggle, Quick Actions card toggle, per-tile toggles (Sessions / Stories / Courses / Cohorts). Default tiles: Sessions, Stories, Courses. Cohorts off. Participants tile removed entirely.
- **"Pick up where you left off" strip.** Always shows three small cards — Last session, Last story, Last course — at the top of the dashboard, in that order. Distinct from the headline tiles (smaller, soft brand-tint background, dashed border).
- **Header gets back / forward / bell / settings buttons.** In-app history navigation and a Moodle-news bell with a yellow dot when something new has landed.
- **No duplicate participants.** Adding the same user to a course twice is now blocked in both PWA and admin (the "+ Create new" reuse-by-email path was the gap).
- **Delete-anyway** for re-activated participants with attendance history (drop is still the default, delete becomes available as a secondary action with a stronger confirm).
- **Per-course Sync from Moodle** button on the course detail page (in addition to the global one on the Courses list).

### Admin
- **Top-bar Refresh button** for pulling fresh server state.
- **Hides tombstones from refresh.** Deleted courses, sessions, etc. disappear from admin tables on the next refresh instead of lingering.
- **Trainees: "Show merged / disabled" toggle** for manual cleanup of duplicates from the v0.3.5g dedup migration.
- **Drop vs Delete logic** on participants — drop preserves attendance, delete only when none recorded.

### Server / API
- New endpoint `POST /api/users/staff` — minimal directory of trainer + admin users, callable by any authenticated user. Used by the new facilitators picker.
- New endpoint `GET/POST /api/admin/moodle/news` — lightweight poll for the bell.
- Sync.php: `facilitatorIds` field on the `groups` entity, JSON-encoded at the wire boundary.
- Moodle sync (v0.3.5j): suspended Moodle enrolments mirror to dropped participants on our side.

### Schema migrations included in this release
- `v0.3.5f.sql` — adds `users.phone`
- `v0.3.5g-dedup.sql` — one-off dedup of synthetic trainee accounts
- `v0.3.5h-purge-merged.sql` — optional hard delete of merged duplicates (safe — skips anyone still referenced)
- `v0.3.5i-facilitator-ids.sql` — adds `groups_.facilitator_ids` TEXT column

Run them in order (idempotent, safe to re-run):
```
for f in /opt/ubuntu3/server/sql/migrations/v0.3.5{f,g-dedup,h-purge-merged,i-facilitator-ids}.sql; do
  sudo docker exec -i moodle-mariadb-1 mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me < "$f"
done
```

---

## Deploy checklist

From your Mac:

```bash
cd "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform"

# Server (PHP) — keep subdirectories
rsync -av server/src/        ubuntu@165.232.85.152:/opt/ubuntu3/server/src/
rsync -av server/public/index.php ubuntu@165.232.85.152:/opt/ubuntu3/server/public/
rsync -av server/sql/migrations/ ubuntu@165.232.85.152:/opt/ubuntu3/server/sql/migrations/

# Admin
rsync -av server/public/admin/ ubuntu@165.232.85.152:/opt/ubuntu3/server/public/admin/

# PWA
rsync -av app/  ubuntu@165.232.85.152:/opt/ubuntu3/app/
```

Then on the droplet, run any unapplied migrations (see above), and hard-refresh both `/admin` and the PWA in the browser to pick up the bumped service-worker cache (`ubuntu30-v0.3.6`).

---

## Known limitations / next-round notes

- **Stories list isn't yet filtered** by "my courses only" — to do next.
- **Sessions list filter behavior** when toggling "my courses only" off needs another look — a user reported sessions still showing only their courses after disabling the toggle.
- **Settings UI** is a starting point. Will be redesigned once trainers send feedback.
- **Participants list view** doesn't honour the "my courses" filter yet — by design for now (participants are usually looked at from inside a course context).
- **Stories endpoint filter** for Moodle news — currently counts the org-wide totals, not per-user.

---

## User guides

Four .docx files in this folder:

- `Trainer-Guide-FR.docx` — Guide du Formateur (français)
- `Trainer-Guide-EN.docx` — Trainer Guide (English)
- `Admin-Guide-FR.docx` — Guide de l'Administrateur (français)
- `Admin-Guide-EN.docx` — Administrator Guide (English)

All four are practical walkthroughs (~12 pages) of the everyday flows. Open in Word / Google Docs to lightly customise (logos, screenshots) before distributing.
