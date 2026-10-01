# Ubuntu 3.0 — v0.3.9 release notes

**Cut date:** July 2026 (deployed to production in July; committed to git on 1 October 2026)
**Service worker cache:** `ubuntu30-v0.3.9`
**Targeted at:** trainer feedback round — faces on the roster, clearer wording, more reliable sync in the field

> **Note on the version label.** Production was deployed from the working copy before the version label was bumped, so the live app's More → App card reads "v0.3.8" while serving the `ubuntu30-v0.3.9` cache. This commit corrects the label to `0.3.9`; the fix reaches trainers with the next deploy.

---

## What's in this release

### PWA — photos
- **Participant photo (avatar).** Take or pick a photo on the participant form. Stored locally, synced to the server (`/api/participants/<id>/media/photo`), and shown as a round avatar in participant lists, attendance rows and pickers. Migration `v0.3.9a-participant-photo.sql` adds `participants.has_photo`.
- **Your own profile photo.** Set it under More → Profile (needs to be online). It appears next to your name in the staff, participant and walk-in pickers on every device. Migration `v0.3.9b-user-photo.sql` adds `users.has_photo`. A trainee already photographed in another course shows that photo in the picker too.

### PWA — courses and academic years
- **"+ Course" from the Courses tab.** Same pattern as Sessions and Stories. The form offers an academic-year picker limited to current and upcoming years.
- **No new courses on a finished academic year.** The "+ Course" action is hidden on past years, and a stale link to the form is refused on save.
- **"Cohort" is now "Academic year"** throughout the PWA wording (FR / EN / RN), the app manifest and the README.

### PWA — sync reliability
- Sync no longer waits for `navigator.onLine`, which is unreliable in installed PWAs (iOS home-screen apps can report offline long after the connection is back). The request is attempted and a real network failure shows the calm offline state.
- The app also syncs whenever it returns to the foreground, which is what actually flushes records captured in the field.
- Media bytes are stripped from the JSON push and go through the upload endpoints only (Safari-safe blob detection).

### Admin
- "Cohorts" renamed to "Academic years" across the console (navigation, tables, forms, demo-data card, donor report CSV, which is now `donor-report-academic-years.csv` with an `AcademicYear` column).

### Server / API additions
- `Media::uploadParticipantMedia / downloadParticipantMedia / deleteParticipantMedia($id, 'photo')`
- `Media::uploadUserMedia / downloadUserMedia / deleteUserMedia($id, 'photo')` — a user manages their own photo; admins can manage anyone's.
- `Sync.php` `participants` entity exposes `hasPhoto`; the staff and user directory endpoints return `hasPhoto`.

### Schema migrations included in this release

| Migration | Purpose |
| --- | --- |
| `v0.3.9a-participant-photo.sql` | adds `participants.has_photo TINYINT(1) NOT NULL DEFAULT 0` |
| `v0.3.9b-user-photo.sql` | adds `users.has_photo TINYINT(1) NOT NULL DEFAULT 0` |

Apply with (idempotent — both use `IF NOT EXISTS`):

```bash
sudo docker exec -i moodle-mariadb-1 \
  mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
  < /opt/ubuntu3/server/sql/migrations/v0.3.9a-participant-photo.sql

sudo docker exec -i moodle-mariadb-1 \
  mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
  < /opt/ubuntu3/server/sql/migrations/v0.3.9b-user-photo.sql
```

---

## Deploy notes

The deploy steps are the same as v0.3.8 (see `RELEASE_NOTES_v0.3.8.md`), plus the two migrations above. The server creates `storage/participants` and `storage/users` on first upload; if the storage folder is not writable by the web server, create them by hand the same way as `storage/sessions`.

Verify on production:

```bash
curl -s https://ubuntu3.academyubuntu.com/service-worker.js | grep "CACHE = "
# → const CACHE = 'ubuntu30-v0.3.9';
```

---

## Known limitations

- **Profile photos need a connection.** Your own photo uploads straight to the server; participant photos work offline and sync later.
- **Swahili and Arabic are not part of v0.3.9.** They are in progress on `develop` for the next release.
