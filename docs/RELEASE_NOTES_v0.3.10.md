# Ubuntu 3.0 — v0.3.10 release notes

**Cut date:** October 2026
**Service worker cache:** `ubuntu30-v0.3.10`
**Targeted at:** trainers who work in Swahili or Arabic

---

## What's in this release

### PWA — two new interface languages
- **Swahili (Kiswahili) and Arabic (العربية)** join French, English and Kirundi. All 526 interface strings are translated in both. Choose the language under More → Language, on the onboarding screen, or with the switcher on the login screen.
- **Arabic is right-to-left.** Selecting it mirrors the whole app: tab bar, header arrows, lists, forms, toggles and the floating button. Email, phone, URL and password fields stay left-to-right. Dates use Latin digits to match the counts shown elsewhere.
- **Certificates and CSV yes/no values** follow the selected language, as before.
- **Version label corrected.** More → App now reads the real version (production showed "v0.3.8" while running v0.3.9).

### Server
- `sw` and `ar` are accepted wherever a user language is stored: account creation and update, first login through Ubuntu eLearning (Moodle), and `server/bin/create-admin.php --lang`.
- **Password-reset email** is sent in Swahili or Arabic for users with that language (the Arabic email is right-to-left).

### Admin
- The new-user form offers Kiswahili and العربية in the Language dropdown. The admin console itself stays in English.

### Guides
- New `docs/Trainer-Guide-SW.docx` and `docs/Trainer-Guide-AR.docx`, translated from the English Trainer Guide.

### Schema migrations

None. `users.language` is `CHAR(2)` and already holds the new codes.

---

## Deploy checklist

From your Mac, on the `v0.3.10` tag (or `main` after the merge):

```bash
cd "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform"

# Stage server/ and app/ to /tmp on the droplet
rsync -av --delete --exclude 'storage/' --exclude 'config.php' \
  "./server/" ubuntu@165.232.85.152:/tmp/u3-v0.3.10-server/
rsync -av --delete \
  "./app/"    ubuntu@165.232.85.152:/tmp/u3-v0.3.10-app/
```

Then ssh to the droplet and swap into place:

```bash
ssh ubuntu@165.232.85.152
sudo rsync -av --delete /tmp/u3-v0.3.10-server/ /opt/ubuntu3/server/
sudo rsync -av --delete /tmp/u3-v0.3.10-app/    /opt/ubuntu3/app/

sudo rm -rf /tmp/u3-v0.3.10-server /tmp/u3-v0.3.10-app
sudo docker restart ubuntu3-app
```

Verify on production:

```bash
curl -s https://ubuntu3.academyubuntu.com/service-worker.js | grep "CACHE = "
# → const CACHE = 'ubuntu30-v0.3.10';
curl -s https://ubuntu3.academyubuntu.com/app.js | grep "APP_VERSION = " | head -1
# → const APP_VERSION = '0.3.10';
```

Trainers' devices pick up the new version the next time they open the app online; the new cache name replaces the old one.

### Rolling back

```bash
git checkout v0.3.9
# repeat the rsync steps above, then: git checkout develop
```

---

## Known limitations

- **Swahili and Arabic are first-pass translations** (app, reset email and guides). Have a native speaker review them; any string can be corrected in `app/i18n.js` without touching other code.
- **Arabic plurals are simplified.** Counts read "label: number" (for example "عدد الدورات: 5") rather than using Arabic plural agreement.
- **Not translated:** the admin console, the donor portal and the public news page stay in English. There is no Swahili or Arabic Admin Guide.
- **The English and French guides still describe v0.3.9** and list three languages.
