# Ubuntu 3.0 — v0.3.7 release notes

**Cut date:** May 2026
**Service worker cache:** `ubuntu30-v0.3.7`
**Targeted at:** ongoing trainer feedback rounds (Burundi)

---

## What's in this release

### PWA — visual & layout polish
- **iOS Calls-style action circles** under every list search bar. Replaces the soft block buttons + heading-row "+ New X" links with a single horizontal strip of round buttons. Right-justified so they line up with the rest of the app's right-anchored actions. Applied on:
  - **Sessions** list — `eLearning` (sync) + `Session` (new).
  - **Courses** list — `eLearning`.
  - **Stories** list — `Story`.
  - **Cohorts** list — `Cohort`.
  - **Course detail** — `eLearning` under the header, `Participant` under the participants search, `Session` under the sessions search.
  - **Cohort detail** — `Course` under the courses search.
  - **Session detail** — `Walk-in`, `Course`, `Story` under the attendance search.
- **List thumbnails on every row.** Tab-bar-style icon badges next to each item on Cohorts / Courses / Sessions / Stories / Participants. Stories prefer the attached photo (or first inline rich-text image), then fall back to an audio glyph (audio-only stories), then the generic Stories icon.
- **Accent header card** with icon on Course / Cohort / Session detail pages so the top card stands out from the lists below it.
- **Icons next to section headings** (`Attendance`, `Participants`, `Sessions`, `Courses`) to anchor each section visually.
- **Bell badge counter** — header bell now shows the actual count of unseen Moodle items (capped at `99+`) instead of a tiny yellow dot.
- **Online dot turns green.** White-on-red wasn't readable; the dot now uses `var(--success)`. Offline stays amber.
- **Dashboard greeting** — "Hello, **{Name}**. Here is a snapshot of your data." Bigger font, trainer name bolded in dark-brand red.
- **Smaller action-circle diameter** (48px) and clean labels (no leading "+").
- **Removed `+ Add` CTA inside empty states** when the action already exists nearby (drop-anyway redundancy).

### PWA — features
- **Reports tab** in the bottom bar with two trainer reports:
  - Participants with missing **Sex** or **Age range** (deep-link to fix).
  - Stories published to the public news site.
  Both honour the existing **My courses only** filter.
- **Story rich-text editor.** Replaces the plain `textarea` for the story body with a contentEditable editor: bold / italic / underline, bullet & numbered lists, font-size +/-, color picker, link, undo / redo, inline images captured on the spot. HTML is sanitized server-side and on the public news page.
- **iOS-style pill search** on every list (Courses / Sessions / Stories / Cohorts / Participants / course-detail participants & sessions / Attendance / cohort-detail courses).
- **Password show/hide** eye on every password field (login, change-password, forced-reset).
- **Trainers can create brand-new participants** from the `+ Participant` picker. Email is the unicity key; sex and age are required.
- **Search inside Attendance** (session detail) and inside **Cohort → Courses**.
- **Moodle pill on participant rows** in the course-detail roster, matching the pill shown on courses & sessions.

### PWA — navigation & chrome
- **Settings moved** from the header gear into the **More** tab.
- **Header language switcher hidden** (still reachable from More → Language).
- **Show / hide Cohorts tab** added to Settings → Navigation. Default is OFF for trainers, ON for admins. Bottom bar reflows its grid when the tab is hidden.
- **EN tab label fix** — `Courses` now reads correctly in English (was stuck on the French fallback "Cours").
- **Forward nav button hidden** in the header; back arrow and bigger / bolder page title.

### Moodle integration
- **Course banner images sync.** When a course is linked to Moodle, the sync now downloads the first overview image from Moodle into `storage/courses/<groupId>.<ext>` on the server. The PWA renders it as the course thumbnail (replaces the generic course icon). Empty / missing images leave the icon in place.
- New endpoint `GET /api/courses/<id>/image` streams the stored banner with a 1-day private cache. The Moodle WS token never leaves the server.

### Server / API
- New migration `v0.3.7-course-image.sql` — adds `groups_.image_url`.
- `MoodleSync::syncCourseImage` per linked course on every sync.
- `Sync.php` exposes `imageUrl` as a read-only field on `groups`.
- `Users::create` relaxed from admin-only to **trainer can create trainees when `sendInvite=false`** (the path the PWA picker uses). Every other shape stays admin-only.

### Schema migrations included in this release

| Migration | Purpose |
| --- | --- |
| `v0.3.7-course-image.sql` | adds `groups_.image_url VARCHAR(512) NULL` |

Apply with:

```bash
sudo docker exec -i moodle-mariadb-1 \
  mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
  < /opt/ubuntu3/server/sql/migrations/v0.3.7-course-image.sql
```

Idempotent (uses `IF NOT EXISTS`).

---

## Deploy checklist

From your Mac, on the v0.3.7 tag (or `main` after the merge):

```bash
cd "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform"

# Stage server/ and app/ to /tmp on the droplet
rsync -av --delete --exclude 'storage/' --exclude 'config.php' \
  "./server/" ubuntu@165.232.85.152:/tmp/u3-v0.3.7-server/
rsync -av --delete \
  "./app/"    ubuntu@165.232.85.152:/tmp/u3-v0.3.7-app/
```

Then ssh to the droplet and swap into place:

```bash
ssh ubuntu@165.232.85.152
sudo rsync -av --delete /tmp/u3-v0.3.7-server/ /opt/ubuntu3/server/
sudo rsync -av --delete /tmp/u3-v0.3.7-app/    /opt/ubuntu3/app/

sudo docker exec -i moodle-mariadb-1 \
  mariadb -h127.0.0.1 -uubuntu_me -p<PASSWORD> ubuntu_me \
  < /opt/ubuntu3/server/sql/migrations/v0.3.7-course-image.sql

sudo mkdir -p /opt/ubuntu3/storage/courses
sudo chown 33:33 /opt/ubuntu3/storage/courses
sudo chmod 0775  /opt/ubuntu3/storage/courses

sudo rm -rf /tmp/u3-v0.3.7-server /tmp/u3-v0.3.7-app
sudo docker restart ubuntu3-app
```

Verify on production:

```bash
curl -s https://ubuntu3.academyubuntu.com/app.js | grep "APP_VERSION = " | head -1
# → const APP_VERSION = '0.3.7';
```

Then open `https://ubuntu3.academyubuntu.com/admin/`, log in, and trigger a Moodle sync from the Courses tab. Banner images should populate within seconds (one `<groupId>.<ext>` file per linked course inside `/opt/ubuntu3/storage/courses/`).

---

## Known limitations

- **Local development behind corporate Zscaler can't test Moodle sync** end-to-end — Zscaler intercepts the container's outbound TLS and forces a captive portal. Test Moodle features against the droplet (no Zscaler) or off a non-corporate network. Everything else works locally.
- **Course image sync requires `overviewfiles` on the Moodle course.** Courses without a banner image in Moodle keep the generic icon — no error, just no image.
