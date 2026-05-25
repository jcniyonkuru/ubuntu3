/* Ubuntu 3.0 — Application logic
 * Hash-based router, view rendering, business logic. Trilingual (fr/en/rn).
 */
(function () {
  'use strict';

  const t = (k, v) => window.I18N.t(k, v);
  const tn = (n, s, p, v) => window.I18N.tn(n, s, p, v);

  // ============================================================
  //  Constants
  // ============================================================

  // Visible app version. Bump this and the CACHE constant in
  // service-worker.js together when cutting a release. Exposed on window
  // so DevTools and tests can read it without parsing source.
  const APP_VERSION = '0.3.7-dev.25';
  window.UBUNTU3_VERSION = APP_VERSION;

  const SEX_OPTIONS = ['F', 'M', 'NB'];
  const AGE_RANGES = ['<18', '18-25', '26-35', '36-45', '46-60', '>60'];

  // ============================================================
  //  Helpers
  // ============================================================

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset') {
          Object.assign(node.dataset, v);
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, v);
        }
      }
    }
    if (children != null) appendChildren(node, children);
    return node;
  }
  function appendChildren(parent, children) {
    if (Array.isArray(children)) children.forEach((c) => appendChildren(parent, c));
    else if (children instanceof Node) parent.appendChild(children);
    else if (children != null) parent.appendChild(document.createTextNode(String(children)));
  }
  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    try {
      return d.toLocaleDateString(window.I18N.dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  }
  function formatDateInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toISOString().slice(0, 10);
  }
  function todayInput() { return new Date().toISOString().slice(0, 10); }

  let _toastTimer = null;
  function toast(msg) {
    const tEl = $('#toast');
    tEl.textContent = msg;
    tEl.hidden = false;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { tEl.hidden = true; }, 2400);
  }

  function sexLabel(code) {
    if (code === 'F') return t('sex.f');
    if (code === 'M') return t('sex.m');
    return t('sex.nb');
  }

  // ---------- list-row thumbnails ----------
  // SVG glyphs mirror the bottom tab bar so every list row carries the
  // same visual cue as the tab it belongs to. Story rows prefer the
  // attached photo (or first inline rich-text image) and only fall back
  // to the Stories icon when nothing is embedded.
  const THUMB_ICONS = {
    cohorts:      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>',
    groups:       '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/><circle cx="6" cy="7" r="1.4" fill="currentColor"/><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="6" cy="17" r="1.4" fill="currentColor"/></svg>',
    sessions:     '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5C3.9 4 3 4.9 3 6v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zM7 12h5v5H7z"/></svg>',
    stories:      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>',
    participants: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
    audio:        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>',
    attendance:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>',
    reports:      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 9.2h3V19H5V9.2zm5.6-5h2.8V19h-2.8V4.2zM16.2 13H19V19h-2.8v-6z"/></svg>',
    warning:      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    publish:      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9zm-9-7c-3.87 0-7 3.13-7 7 0 2.18.97 4.12 2.5 5.42V12h2v4.83A6.97 6.97 0 0 0 12 19c.86 0 1.68-.16 2.43-.45L10 14.59V11h2v2.59L17.5 19A6.96 6.96 0 0 0 19 12c0-3.87-3.13-7-7-7z"/></svg>'
  };
  function thumbIcon(kind) {
    return el('div', { class: 'thumb thumb--icon', html: THUMB_ICONS[kind] || '' });
  }
  // Course thumbnail: when the server-side Moodle sync has populated an
  // imageUrl, render it as an <img>; otherwise fall back to the Courses
  // tab glyph. The img is wrapped in a .thumb container so it picks up
  // the same 56x56 rounded frame used elsewhere.
  function courseThumb(g) {
    const url = g && g.imageUrl;
    if (!url) return thumbIcon('groups');
    // Prepend /api if Sync returned a bare /courses/... path so the
    // browser hits the API base regardless of where the PWA is served.
    const src = url.startsWith('http') ? url : (url.startsWith('/api') ? url : ('/api' + url));
    const wrap = el('div', { class: 'thumb' });
    const img = el('img', { alt: '', src });
    // If the image fails (offline, deleted server-side, 404), gracefully
    // swap in the generic icon so the row never shows a broken-image glyph.
    img.addEventListener('error', () => {
      wrap.classList.add('thumb--icon');
      wrap.innerHTML = THUMB_ICONS.groups || '';
    });
    wrap.appendChild(img);
    return wrap;
  }
  // iOS-Calls-style row of round action buttons. Each item:
  //   { key, icon, label, href? | onClick? }
  // Renders as a horizontal scroll strip — useful under the search pill
  // on entity lists where the screen has a handful of one-tap actions
  // (sync, create new, etc.) that we don't want hiding inside the more
  // menu or floating action button.
  const ACTION_ICONS = {
    sync: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>'
  };
  function actionCircles(items) {
    const row = el('div', { class: 'action-circles' });
    (items || []).filter(Boolean).forEach((item) => {
      const isLink = !!item.href;
      const attrs = isLink
        ? { class: 'action-circle', href: item.href }
        : { class: 'action-circle', type: 'button', onClick: item.onClick };
      if (item.disabled) attrs.disabled = true;
      const node = el(isLink ? 'a' : 'button', attrs, [
        el('span', { class: 'action-circle__icon', html: item.icon || '' }),
        el('span', { class: 'action-circle__label' }, item.label || '')
      ]);
      // Hook so callers can mutate state (e.g. show "Syncing…" while a
      // long action runs) without re-rendering the whole row.
      if (item.ref) item.ref(node);
      row.appendChild(node);
    });
    return row;
  }

  // Inline icon for a section heading (h3). Renders an SVG glyph next
  // to the title text, matching the colour and stroke of the tab-bar
  // icon for that entity type. `extra` lets callers tack an action
  // button onto the right side (e.g. + New).
  function sectionHeading(kind, text, extra) {
    const h = el('h3', { class: 'section-h' }, [
      el('span', { class: 'section-h__icon', html: THUMB_ICONS[kind] || '' }),
      el('span', { class: 'section-h__text' }, text)
    ]);
    if (extra) {
      return el('div', { class: 'row between section-h__row' }, [h, extra]);
    }
    return h;
  }
  // Build a thumbnail for a story row. Preference order:
  //   1. attached photo Blob
  //   2. first <img src="data:image/..."> embedded in the rich-text body
  //   3. an audio glyph (when only audio is attached)
  //   4. the generic Stories tab icon
  function storyThumb(s) {
    if (s.photo) {
      const wrap = el('div', { class: 'thumb' });
      const img  = el('img', { alt: '' });
      img.src = URL.createObjectURL(s.photo);
      img.onload = () => URL.revokeObjectURL(img.src);
      wrap.appendChild(img);
      return wrap;
    }
    const html = s.text || '';
    const m = html.match(/<img\s+[^>]*src=["'](data:image\/[^"']+)["'][^>]*>/i);
    if (m) {
      const wrap = el('div', { class: 'thumb' });
      wrap.appendChild(el('img', { alt: '', src: m[1] }));
      return wrap;
    }
    if (s.audio) return thumbIcon('audio');
    return thumbIcon('stories');
  }

  // ============================================================
  //  Author / device profile + language
  // ============================================================

  let CURRENT_AUTHOR = null;

  async function loadProfile() {
    let profile = await DB.metaGet('profile');
    if (!profile) {
      profile = {
        id: DB.uuid(),
        name: '',
        lang: window.I18N.detectBrowserLang(),
        createdAt: new Date().toISOString()
      };
      await DB.metaSet('profile', profile);
    }
    if (!profile.lang) profile.lang = window.I18N.detectBrowserLang();
    // If logged in, prefer the server user as our identity
    const apiUser = window.API && window.API.getUser();
    if (apiUser) {
      profile.id = apiUser.id;
      profile.name = apiUser.name || profile.name;
      profile.email = apiUser.email;
      profile.role = apiUser.role;
      profile.lang = apiUser.language || profile.lang;
      profile.must_change_password = !!apiUser.must_change_password;
      await DB.metaSet('profile', profile);
    }
    CURRENT_AUTHOR = profile;
    window.I18N.setLang(profile.lang);
    return profile;
  }
  async function saveProfileName(name) {
    CURRENT_AUTHOR.name = name.trim();
    await DB.metaSet('profile', CURRENT_AUTHOR);
  }
  async function saveProfileLang(lang) {
    CURRENT_AUTHOR.lang = lang;
    window.I18N.setLang(lang);
    await DB.metaSet('profile', CURRENT_AUTHOR);
    applyStaticLabels();
  }

  /** Apply translated labels to the persistent UI chrome (header, tabs, lang button). */
  function applyStaticLabels() {
    document.title = t('app.title');
    const dot = $('#net-dot');
    if (dot) {
      dot.title = t('app.netStatus');
      dot.setAttribute('aria-label', t('app.netStatus'));
    }
    const tabs = {
      dashboard: t('tab.dashboard'),
      cohorts:   t('tab.cohorts'),
      sessions:  t('tab.sessions'),
      stories:   t('tab.stories'),
      // v0.3.7 — without this entry the Courses tab fell back to its
      // hard-coded HTML text ("Cours") in every language.
      groups:    t('tab.courses'),
      reports:   t('tab.reports'),
      more:      t('tab.more')
    };
    $$('.tab').forEach((tab) => {
      const span = tab.querySelector('span');
      if (span && tabs[tab.dataset.tab]) span.textContent = tabs[tab.dataset.tab];
    });
    applyTabVisibility();

    // Language switcher button + menu state
    const lang = window.I18N.getLang();
    const codeEl = $('#lang-current');
    if (codeEl) codeEl.textContent = lang.toUpperCase();
    const btn = $('#lang-btn');
    if (btn) btn.setAttribute('aria-label', t('common.language'));
    $$('.lang-menu__item').forEach((item) => {
      if (item.dataset.lang === lang) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });

    // Sync button label
    const sb = $('#sync-btn');
    if (sb) sb.setAttribute('aria-label', t('sync.now'));

    // Header back/forward — icons only, label travels in title/aria.
    const nb = $('#nav-back-btn');
    if (nb) { nb.setAttribute('aria-label', t('nav.back')); nb.setAttribute('title', t('nav.back')); }
    const nf = $('#nav-fwd-btn');
    if (nf) { nf.setAttribute('aria-label', t('nav.forward')); nf.setAttribute('title', t('nav.forward')); }

    // Notification bell — header icon only, label travels in title/aria.
    const bb = $('#bell-btn');
    if (bb) {
      bb.setAttribute('aria-label', t('news.title'));
      bb.setAttribute('title',      t('news.title'));
    }

    // v0.3.7 — settings moved out of the header into the More tab to
    // free up header real estate. The gear-button wireup that used to
    // live here was removed; openSettingsPopup() is reached from the
    // Settings card inside moreView() instead.
  }

  function setSyncState(state) {
    const btn = $('#sync-btn');
    if (!btn) return;
    btn.dataset.state = state;
    const labels = {
      idle: t('sync.status.idle'),
      syncing: t('sync.status.syncing'),
      offline: t('sync.status.offline'),
      error: t('sync.status.error'),
    };
    btn.title = labels[state] || labels.idle;
  }

  function wireSyncIndicator() {
    const btn = $('#sync-btn');
    if (!btn) return;
    let clickCount = 0;
    let clickTimer = null;
    btn.addEventListener('click', async () => {
      if (!window.API || !window.API.isAuthenticated()) return;
      // Triple-tap the sync icon to show the media diagnostics modal
      // (useful on iOS where there's no dev console).
      clickCount++;
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { clickCount = 0; }, 600);
      if (clickCount >= 3) {
        clickCount = 0;
        await showMediaDiag();
        return;
      }
      const r = await window.SYNC.syncNow();
      if (r && r.ok && r.pushed != null) {
        toast(r.pushed > 0 ? t('sync.pushed', { n: r.pushed }) : t('sync.status.idle'));
      }
    });
    window.SYNC.on('change', (s) => setSyncState(s.status || 'idle'));
    window.SYNC.getState().then((s) => setSyncState(s.status || 'idle'));
  }

  // ============================================================
  //  Header notification bell — Moodle updates
  // ============================================================
  // Lightweight polling against /api/admin/moodle/news. We track a
  // "last seen" timestamp in localStorage; the server tells us how many
  // Moodle-sourced rows landed since then. Click the bell to see what's new
  // and reset the timestamp.
  let _lastNewsCount = 0;
  let _lastNewsBody  = null;
  const NEWS_LAST_SEEN_KEY = 'ubuntu30.moodleLastSeen';
  const NEWS_POLL_MS = 5 * 60 * 1000;   // every 5 minutes
  function _lastSeen() {
    return localStorage.getItem(NEWS_LAST_SEEN_KEY) || '1970-01-01T00:00:00Z';
  }
  function _setLastSeen(iso) {
    try { localStorage.setItem(NEWS_LAST_SEEN_KEY, iso || new Date().toISOString()); } catch (e) {}
  }
  function _updateBellBadge(n) {
    _lastNewsCount = n;
    const btn = $('#bell-btn'); const dot = $('#bell-dot');
    if (!btn) return;
    btn.dataset.count = String(n || 0);
    if (dot) {
      // Cap displayed count so the badge stays compact. Above 99 we
      // show '99+' — the popup still lists the full breakdown.
      dot.textContent = n > 99 ? '99+' : (n ? String(n) : '');
      dot.hidden = !n;
    }
  }
  async function pollMoodleNews() {
    if (!window.API || !window.API.isAuthenticated() || !navigator.onLine) return;
    try {
      const r = await window.API.moodleNews(_lastSeen());
      _lastNewsBody = r || null;
      const total = ((r && r.newSessions) || 0) + ((r && r.newParticipants) || 0) + ((r && r.newCourses) || 0);
      _updateBellBadge(total);
    } catch (e) { /* keep previous state on failure */ }
  }
  // Exposed so manual "Sync from Moodle" buttons can refresh the badge
  // immediately after a successful pull, without waiting for the next poll.
  window.pollMoodleNews = pollMoodleNews;
  function wireNotificationBell() {
    const btn = $('#bell-btn');
    if (!btn) return;
    btn.addEventListener('click', () => openNewsPopup());
    // Initial poll + periodic + on focus / visibility change.
    pollMoodleNews();
    setInterval(pollMoodleNews, NEWS_POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pollMoodleNews();
    });
    window.addEventListener('focus', pollMoodleNews);
  }

  /** Small popup that lists the unseen Moodle changes and offers "Mark as seen". */
  function openNewsPopup() {
    // Idempotent: if a popup is already open, just close it (toggle).
    const existing = document.getElementById('news-popup');
    if (existing) { existing.remove(); return; }

    function close() {
      bg.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    const bg = el('div', {
      class: 'popup-bg', id: 'news-popup',
      onClick: (e) => { if (e.target === bg) close(); }
    });

    const body = el('div', { class: 'popup__body' });
    const total = _lastNewsCount;
    const n = _lastNewsBody || { newSessions: 0, newParticipants: 0, newCourses: 0, latestUpdate: null };

    body.appendChild(el('p', { class: 'small muted', style: 'margin:0 0 8px' },
      total > 0 ? t('news.intro', { n: total }) : t('news.empty')));

    if (total > 0) {
      const list = el('div');
      if (n.newCourses) {
        list.appendChild(el('p', { style: 'margin:6px 0' }, '· ' + t('news.courses', { n: n.newCourses })));
      }
      if (n.newSessions) {
        list.appendChild(el('p', { style: 'margin:6px 0' }, '· ' + t('news.sessions', { n: n.newSessions })));
      }
      if (n.newParticipants) {
        list.appendChild(el('p', { style: 'margin:6px 0' }, '· ' + t('news.participants', { n: n.newParticipants })));
      }
      body.appendChild(list);
    }

    body.appendChild(el('div', { class: 'row', style: 'gap:8px; margin-top:14px; flex-wrap:wrap' }, [
      el('button', {
        class: 'btn btn--soft btn--sm', type: 'button',
        onClick: async () => {
          // Pull the freshest data, then mark as seen.
          if (navigator.onLine && window.SYNC) {
            await window.SYNC.syncNow().catch(() => {});
          }
          _setLastSeen(n.latestUpdate || new Date().toISOString());
          await pollMoodleNews();
          close();
          toast(t('news.markedSeen'));
        }
      }, t('news.markSeenCta')),
      el('a', {
        class: 'btn btn--ghost btn--sm', href: '#/sessions',
        onClick: () => close()
      }, t('news.openSessions'))
    ]));

    const head = el('div', { class: 'popup__head' }, [
      el('h3', { class: 'popup__title' }, t('news.title')),
      el('button', { class: 'popup__close', type: 'button', 'aria-label': 'Close', onClick: close }, '×')
    ]);
    bg.appendChild(el('div', { class: 'popup', role: 'dialog', 'aria-modal': 'true' }, [head, body]));
    document.body.appendChild(bg);
    document.addEventListener('keydown', onKey);
  }

  /**
   * Show last media-sync diagnostics in a visible alert (iOS-friendly).
   * Triggered by triple-tapping the sync icon.
   */
  async function showMediaDiag() {
    const diag = await DB.metaGet('lastMediaDiag');
    if (!diag) {
      alert('No sync diagnostics yet — tap Sync once, then triple-tap to see results.');
      return;
    }
    const lines = [];
    lines.push('Last sync: ' + diag.at);
    lines.push('Stories scanned: ' + diag.storyCount);
    lines.push('Candidates (with photo/audio): ' + diag.candidates);
    lines.push('Uploaded this run: ' + diag.uploaded);
    lines.push('');
    lines.push('Per-story media state:');
    (diag.inspected || []).forEach((row) => {
      lines.push(' • ' + row.id + ' photo=' + row.photo + ' audio=' + row.audio
        + ' hasP=' + row.hasPhoto + ' hasA=' + row.hasAudio
        + ' upP=' + row.photoUploaded + ' upA=' + row.audioUploaded);
    });
    if (diag.attempts && diag.attempts.length) {
      lines.push('');
      lines.push('Upload attempts:');
      diag.attempts.forEach((a) => {
        lines.push(' • ' + a.id + '/' + a.kind + ' ' + a.size + 'b ' + (a.ok ? 'OK' : 'FAIL ' + (a.error || '')));
      });
    }
    alert(lines.join('\n'));
  }

  /** Wire up the always-visible language switcher in the header. Called once on boot. */
  function wireLangSwitcher() {
    const btn = $('#lang-btn');
    const menu = $('#lang-menu');
    if (!btn || !menu) return;

    function openMenu() {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      // Close on outside click / Escape
      setTimeout(() => {
        document.addEventListener('click', onOutside, { once: true });
        document.addEventListener('keydown', onEscape);
      }, 0);
    }
    function closeMenu() {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onEscape);
    }
    function onOutside(e) {
      if (menu.contains(e.target) || btn.contains(e.target)) {
        // Re-arm: still open, listen for the next outside click
        document.addEventListener('click', onOutside, { once: true });
        return;
      }
      closeMenu();
    }
    function onEscape(e) {
      if (e.key === 'Escape') { closeMenu(); btn.focus(); }
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    $$('.lang-menu__item', menu).forEach((item) => {
      item.addEventListener('click', async () => {
        const lang = item.dataset.lang;
        closeMenu();
        if (lang === window.I18N.getLang()) return;
        await saveProfileLang(lang);
        await handleRoute();
      });
    });
  }

  // ============================================================
  //  Router
  // ============================================================

  const routes = [];
  function route(pattern, view) {
    const parts = pattern.split('/').filter(Boolean);
    routes.push({ parts, view });
  }
  function matchRoute(path) {
    const segs = path.split('/').filter(Boolean);
    for (const r of routes) {
      if (r.parts.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i], s = segs[i];
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(s);
        else if (p !== s) { ok = false; break; }
      }
      if (ok) return { view: r.view, params };
    }
    return null;
  }
  function go(path) { location.hash = '#' + path; }
  function normalizeHash(hash) { return hash.replace(/^#/, '').split('?')[0] || '/dashboard'; }

  // -------- In-app history stack (for header back/forward buttons) --------
  // We can't rely on history.length (it grows for every external nav too)
  // and the History API can't tell us whether we're at the top of the stack.
  // So we keep our own list of paths visited and an index. navOnHashChange()
  // is called from handleRoute for every navigation; navBack/navForward flip
  // the index and replay the matching hash. The "silent" flag prevents the
  // back/forward action from itself re-recording the navigation.
  const NAV = { stack: [], idx: -1, silent: false };
  function navRecord(path) {
    if (NAV.silent) { NAV.silent = false; navUpdateButtons(); return; }
    // Avoid recording the same path twice in a row (e.g. when handleRoute
    // re-renders after a setting change).
    if (NAV.idx >= 0 && NAV.stack[NAV.idx] === path) { navUpdateButtons(); return; }
    // Truncate any forward history when navigating from a middle point.
    NAV.stack = NAV.stack.slice(0, NAV.idx + 1);
    NAV.stack.push(path);
    NAV.idx = NAV.stack.length - 1;
    navUpdateButtons();
  }
  function navBack() {
    if (NAV.idx <= 0) return;
    NAV.idx--;
    NAV.silent = true;
    location.hash = '#' + NAV.stack[NAV.idx];
  }
  function navForward() {
    if (NAV.idx >= NAV.stack.length - 1) return;
    NAV.idx++;
    NAV.silent = true;
    location.hash = '#' + NAV.stack[NAV.idx];
  }
  function navUpdateButtons() {
    const b = $('#nav-back-btn'); const f = $('#nav-fwd-btn');
    if (b) b.disabled = NAV.idx <= 0;
    if (f) f.disabled = NAV.idx >= NAV.stack.length - 1;
  }
  function wireHeaderNav() {
    const b = $('#nav-back-btn'); const f = $('#nav-fwd-btn');
    if (b) b.addEventListener('click', navBack);
    if (f) f.addEventListener('click', navForward);
    navUpdateButtons();
  }

  async function handleRoute() {
    const path = normalizeHash(location.hash);
    const match = matchRoute(path);
    const view = $('#view');
    view.innerHTML = '';
    // Record this navigation into the in-app history stack so the header
    // back/forward buttons know where they can take us. Redirects below
    // (auth gating, /settings legacy redirect, etc.) will themselves trigger
    // another handleRoute → navRecord call on the final destination.
    navRecord(path);

    const tabKey = path.split('/')[1] || 'dashboard';
    $$('.tab').forEach((tab) => {
      if (tab.dataset.tab === tabKey) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });

    // Auth gating
    const authed = window.API && window.API.isAuthenticated();
    const publicPaths = ['/login', '/forgot', '/reset'];
    if (!authed && publicPaths.indexOf(path) === -1) { go('/login'); return; }
    if (authed && path === '/login') { go('/dashboard'); return; }
    // Forced password change for users with a temporary password
    if (authed && CURRENT_AUTHOR.must_change_password && path !== '/change-password' && publicPaths.indexOf(path) === -1) {
      go('/change-password'); return;
    }
    // Legacy onboarding path: only used when logged in but missing a name (rare)
    if (authed && !CURRENT_AUTHOR.name && path !== '/onboarding' && path !== '/change-password') {
      go('/onboarding'); return;
    }
    if (authed && CURRENT_AUTHOR.name && path === '/onboarding') { go('/dashboard'); return; }

    // Legacy: /settings used to be a route. It's a popup now — redirect to
    // dashboard and open the popup so old bookmarks / back-buttons still work.
    if (path === '/settings') {
      go('/dashboard');
      setTimeout(() => { try { openSettingsPopup(); } catch (e) {} }, 0);
      return;
    }

    if (!match) {
      view.appendChild(notFoundView());
      setTitle(t('nf.title'));
      return;
    }
    try {
      await match.view(match.params, view);
    } catch (err) {
      console.error(err);
      view.appendChild(el('p', { class: 'muted' }, t('common.error', { msg: err && err.message ? err.message : String(err) })));
    }
    window.scrollTo(0, 0);
  }

  function setTitle(s) {
    $('#page-title').textContent = s || t('app.short');
    document.title = (s ? s + ' · ' : '') + t('app.short');
  }

  // ============================================================
  //  Views
  // ============================================================

  function notFoundView() {
    return el('div', { class: 'empty' }, [
      el('h3', null, t('nf.title')),
      el('p', null, t('nf.body')),
      el('a', { class: 'btn', href: '#/dashboard' }, t('nf.back'))
    ]);
  }

  // ---------- Login ----------
  async function loginView(_params, root) {
    setTitle(t('auth.loginTitle'));
    const errBox = el('p', { class: 'small', style: 'color:var(--danger); margin:4px 0', hidden: true });
    const form = el('form', {
      class: 'auth-card',
      onSubmit: async (e) => {
        e.preventDefault();
        errBox.hidden = true;
        const email = form.elements['email'].value.trim().toLowerCase();
        const password = form.elements['password'].value;
        if (!email || !password) return;
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        const origLabel = btn.textContent;
        btn.textContent = t('auth.loggingIn');
        try {
          await window.API.login(email, password);
          await loadProfile();
          applyStaticLabels();
          toast(t('auth.welcomeBack', { name: CURRENT_AUTHOR.name || '' }));
          // Kick off background sync
          window.SYNC.syncNow().catch(() => {});
          go('/dashboard');
        } catch (err) {
          let msg;
          if (err.code === 'network') msg = navigator.onLine ? t('auth.networkError') : t('auth.networkRequired');
          else if (err.status === 401) msg = t('auth.invalidCreds');
          else if (err.status === 500) msg = t('auth.serverError');
          else msg = err.message || t('auth.serverError');
          errBox.textContent = msg;
          errBox.hidden = false;
        } finally {
          btn.disabled = false;
          btn.textContent = origLabel;
        }
      }
    }, [
      el('div', { class: 'login-logo' }, el('img', { src: 'logo.png', alt: 'Académie Ubuntu' })),
      el('h2', null, t('auth.loginTitle')),
      el('p', { class: 'muted' }, t('auth.loginIntro')),
      errBox,
      fg(t('auth.email'), el('input', { name: 'email', type: 'text', required: true, autocomplete: 'username' })),
      fg(t('auth.password'), passwordInput({ name: 'password', required: true, autocomplete: 'current-password' })),
      el('button', { class: 'btn btn--block', type: 'submit' }, t('auth.loginCta')),
      el('p', { class: 'small muted', style: 'text-align:center; margin:10px 0 0' }, t('auth.elearningHint')),
      el('div', { class: 'row', style: 'justify-content:center; margin-top:8px' },
        el('a', { class: 'small', href: '#/forgot' }, t('auth.forgotLink'))
      )
    ]);

    // Collapsible "Server URL" card — hidden by default, revealed via a small link
    const serverCard = el('div', { class: 'auth-server-card', hidden: true }, [
      el('h3', null, t('auth.serverUrl')),
      el('p', { class: 'small muted' }, t('auth.serverUrlHint')),
      fg(t('auth.serverUrl'), el('input', { id: 'server-url', type: 'url', value: window.API.getBase() })),
      el('button', {
        class: 'btn btn--sm btn--ghost',
        type: 'button',
        onClick: () => {
          const v = $('#server-url').value.trim();
          window.API.setBase(v);
          toast(t('auth.serverUrlSaved'));
        }
      }, t('common.save'))
    ]);
    const serverToggle = el('button', {
      class: 'auth-server-toggle',
      type: 'button',
      onClick: () => { serverCard.hidden = !serverCard.hidden; }
    }, t('auth.serverUrl'));

    renderAuthOverlay(root, [form, serverToggle, serverCard]);
  }

  /**
   * Wrap auth-flow content (login / forgot / reset) in a full-screen gradient
   * overlay, with a small language switcher floating in the top-right corner.
   */
  function renderAuthOverlay(root, contentNodes) {
    const inner = el('div', { class: 'auth-overlay__inner' }, contentNodes);
    const overlay = el('div', { class: 'auth-overlay' }, inner);
    // Floating language switcher (the header is covered by the overlay, so we
    // surface one in the corner instead).
    const corner = el('div', { class: 'auth-corner' },
      el('button', {
        class: 'lang-btn',
        type: 'button',
        onClick: () => {
          const order = ['fr', 'en', 'rn'];
          const cur = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'fr';
          const next = order[(order.indexOf(cur) + 1) % order.length];
          if (window.I18N && window.I18N.setLang) window.I18N.setLang(next);
          go(location.hash.replace(/^#/, '') || '/login');
        }
      }, [
        el('span', { class: 'lang-btn__code' }, ((window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'fr').toUpperCase())
      ])
    );
    root.appendChild(overlay);
    root.appendChild(corner);
  }

  // ---------- Forgot Password ----------
  async function forgotPasswordView(_params, root) {
    setTitle(t('auth.forgotTitle'));
    const successBox = el('p', { class: 'small', style: 'color:var(--success); margin:4px 0', hidden: true });
    const errBox = el('p', { class: 'small', style: 'color:var(--danger); margin:4px 0', hidden: true });
    const form = el('form', {
      class: 'card',
      onSubmit: async (e) => {
        e.preventDefault();
        successBox.hidden = true; errBox.hidden = true;
        const email = form.elements['email'].value.trim().toLowerCase();
        if (!email) return;
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          await window.API.forgotPassword(email);
          successBox.textContent = t('auth.forgotSent');
          successBox.hidden = false;
          form.elements['email'].value = '';
        } catch (err) {
          errBox.textContent = err.code === 'network' ? t('auth.networkError') : (err.message || t('auth.serverError'));
          errBox.hidden = false;
        } finally {
          btn.disabled = false;
        }
      }
    }, [
      el('div', { class: 'login-logo' }, el('img', { src: 'logo.png', alt: 'Académie Ubuntu' })),
      el('h2', null, t('auth.forgotTitle')),
      el('p', { class: 'muted small' }, t('auth.forgotIntro')),
      successBox, errBox,
      fg(t('auth.email'), el('input', { name: 'email', type: 'email', required: true, autocomplete: 'username' })),
      el('button', { class: 'btn btn--block', type: 'submit' }, t('auth.forgotCta'))
    ]);
    form.classList.remove('card');
    form.classList.add('auth-card');
    const back = el('div', { class: 'row', style: 'justify-content:center; margin-top:12px' },
      el('a', { class: 'small', href: '#/login', style: 'color:#fff; text-decoration:underline;' }, t('auth.backToLogin'))
    );
    renderAuthOverlay(root, [form, back]);
  }

  // ---------- Reset Password ----------
  async function resetPasswordView(_params, root) {
    setTitle(t('auth.resetTitle'));
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const token = q.get('token') || '';
    const errBox = el('p', { class: 'small', style: 'color:var(--danger); margin:4px 0', hidden: true });
    const successBox = el('p', { class: 'small', style: 'color:var(--success); margin:4px 0', hidden: true });

    if (!token) {
      renderAuthOverlay(root, [
        el('div', { class: 'auth-card' }, [
          el('div', { class: 'login-logo' }, el('img', { src: 'logo.png', alt: 'Académie Ubuntu' })),
          el('h2', null, t('auth.resetTitle')),
          el('p', { class: 'muted' }, t('auth.resetInvalid')),
          el('a', { class: 'btn btn--block', href: '#/forgot' }, t('auth.forgotLink'))
        ])
      ]);
      return;
    }
    const form = el('form', {
      class: 'auth-card',
      onSubmit: async (e) => {
        e.preventDefault();
        errBox.hidden = true;
        const next = form.elements['next'].value;
        const conf = form.elements['confirm'].value;
        if (next.length < 8) { errBox.textContent = t('auth.pwTooShort'); errBox.hidden = false; return; }
        if (next !== conf)   { errBox.textContent = t('auth.pwMismatch'); errBox.hidden = false; return; }
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          await window.API.resetPassword(token, next);
          successBox.textContent = t('auth.resetSuccess');
          successBox.hidden = false;
          setTimeout(() => go('/login'), 1500);
        } catch (err) {
          if (err.code === 'invalid_token' || err.code === 'expired_token' || err.code === 'used_token') {
            errBox.textContent = t('auth.resetInvalid');
          } else {
            errBox.textContent = err.message || t('auth.serverError');
          }
          errBox.hidden = false;
        } finally {
          btn.disabled = false;
        }
      }
    }, [
      el('div', { class: 'login-logo' }, el('img', { src: 'logo.png', alt: 'Académie Ubuntu' })),
      el('h2', null, t('auth.resetTitle')),
      el('p', { class: 'muted small' }, t('auth.resetIntro')),
      errBox, successBox,
      fg(t('auth.newPw'), passwordInput({ name: 'next', required: true, autocomplete: 'new-password' })),
      fg(t('auth.newPwConfirm'), passwordInput({ name: 'confirm', required: true, autocomplete: 'new-password' })),
      el('button', { class: 'btn btn--block', type: 'submit' }, t('auth.resetCta'))
    ]);
    renderAuthOverlay(root, [form]);
  }

  // ---------- Change Password ----------
  async function changePasswordView(_params, root) {
    setTitle(t('auth.changePwTitle'));
    const errBox = el('p', { class: 'small', style: 'color:var(--danger); margin:4px 0', hidden: true });
    const form = el('form', {
      class: 'card',
      onSubmit: async (e) => {
        e.preventDefault();
        errBox.hidden = true;
        const cur = form.elements['current'].value;
        const next = form.elements['next'].value;
        const conf = form.elements['confirm'].value;
        if (next.length < 8) { errBox.textContent = t('auth.pwTooShort'); errBox.hidden = false; return; }
        if (next !== conf)   { errBox.textContent = t('auth.pwMismatch'); errBox.hidden = false; return; }
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          await window.API.changePassword(cur, next);
          // Refresh local profile (clears must_change_password)
          await loadProfile();
          toast(t('auth.pwChanged'));
          go('/dashboard');
        } catch (err) {
          errBox.textContent = err.status === 401 ? t('auth.invalidCreds') : (err.message || t('auth.serverError'));
          errBox.hidden = false;
        } finally {
          btn.disabled = false;
        }
      }
    }, [
      el('h2', null, t('auth.changePwTitle')),
      el('p', { class: 'muted small' }, t('auth.changePwIntro')),
      errBox,
      fg(t('auth.currentPw'), passwordInput({ name: 'current', required: true, autocomplete: 'current-password' })),
      fg(t('auth.newPw'), passwordInput({ name: 'next', required: true, autocomplete: 'new-password' })),
      fg(t('auth.newPwConfirm'), passwordInput({ name: 'confirm', required: true, autocomplete: 'new-password' })),
      el('button', { class: 'btn btn--block', type: 'submit' }, t('auth.changePwCta'))
    ]);
    root.appendChild(form);
  }

  // ---------- Onboarding ----------
  function onboardingView(_params, root) {
    setTitle(t('onboard.title'));
    const langs = window.I18N.languages();
    const form = el('form', {
      class: 'card',
      onSubmit: async (e) => {
        e.preventDefault();
        const name = form.elements['name'].value.trim();
        const lang = form.elements['lang'].value;
        if (!name) return;
        if (lang && lang !== CURRENT_AUTHOR.lang) await saveProfileLang(lang);
        await saveProfileName(name);
        toast(t('toast.profileSaved'));
        go('/dashboard');
      }
    }, [
      el('div', { class: 'login-logo' }, el('img', { src: 'logo.png', alt: 'Académie Ubuntu' })),
      el('h2', null, t('onboard.heading')),
      el('p', { class: 'muted' }, t('onboard.note')),
      fg(t('onboard.langLabel'), selectEl('lang', langs.map((l) => ({ value: l.code, label: l.label })), CURRENT_AUTHOR.lang, true, async (e) => {
        await saveProfileLang(e.target.value);
        // Re-render this view in the new language
        await handleRoute();
      })),
      fg(t('onboard.nameLabel'), el('input', { id: 'name', name: 'name', type: 'text', required: true, autocomplete: 'name', placeholder: t('onboard.namePh') })),
      el('button', { class: 'btn btn--block', type: 'submit' }, t('onboard.cta'))
    ]);
    root.appendChild(form);
  }

  // ---------- Dashboard ----------
  async function dashboardView(_params, root) {
    setTitle(t('dash.title'));
    const [cohorts, _allGroups, _allParticipants, _allSessions, _allAttendance, _allStories] = await Promise.all([
      DB.all('cohorts'), DB.all('groups'), DB.all('participants'),
      DB.all('sessions'), DB.all('attendance'), DB.all('stories')
    ]);
    // v0.3.5j — "my courses only" filter: when on (default), every count on
    // the dashboard is scoped to courses where the current user is a
    // facilitator. Toggle it off in Settings to see everything across the
    // organisation. Cohort tile is unaffected — cohorts span courses.
    const groups       = applyMyCourses(_allGroups);
    const groupIdSet   = new Set(groups.map((g) => g.id));
    const sessions     = _allSessions.filter((s) => !myCoursesFilterOn() || groupIdSet.has(s.groupId));
    const sessionIdSet = new Set(sessions.map((s) => s.id));
    const participants = _allParticipants
      .filter((p) => !p.walkInSessionId)
      .filter((p) => !myCoursesFilterOn() || groupIdSet.has(p.groupId));
    const attendance   = _allAttendance.filter((a) => !myCoursesFilterOn() || sessionIdSet.has(a.sessionId));
    const stories      = _allStories.filter((s) => !myCoursesFilterOn() || sessionIdSet.has(s.sessionId));

    const sexCounts = participants.reduce((acc, p) => { acc[p.sex || 'NB'] = (acc[p.sex || 'NB'] || 0) + 1; return acc; }, {});
    const totalP = participants.length;
    const pct = (n) => totalP ? Math.round((n * 100) / totalP) : 0;

    const now = new Date();
    const monthKey = now.toISOString().slice(0, 7);
    const sessionsThisMonth = sessions.filter((s) => (s.date || '').slice(0, 7) === monthKey).length;

    const presentCount = attendance.filter((a) => a.present).length;
    const attRate = attendance.length ? Math.round((presentCount * 100) / attendance.length) : 0;

    const storiesConsent = stories.filter((s) => s.consent).length;
    const consentRate = stories.length ? Math.round((storiesConsent * 100) / stories.length) : 0;

    // Groups that held at least one session this calendar month
    const activeGroupIds = new Set(
      sessions
        .filter((s) => (s.date || '').slice(0, 7) === monthKey)
        .map((s) => s.groupId)
        .filter(Boolean)
    );
    const activeGroupsCount = activeGroupIds.size;
    const activeGroupsRate = groups.length ? Math.round((activeGroupsCount * 100) / groups.length) : 0;

    // The Settings gear lives in the global app header now — see the
    // Settings button now lives in the More tab. The dashboard just shows the
    // greeting, then reads the user's preferences for what to render.
    const settings = SETTINGS.read();
    const dashCfg  = SETTINGS.dashCfg(settings);
    // Greeting with the trainer's name in bold. We split the translated
    // sentence around the {name} placeholder so the surrounding wording
    // stays in the FR/EN/RN translation files. The marker () is a
    // private control char that never appears in real translations.
    (() => {
      const raw = t('dash.hello', { name: '' });
      const i = raw.indexOf('');
      const before = i >= 0 ? raw.slice(0, i) : raw;
      const after  = i >= 0 ? raw.slice(i + 1) : '';
      root.appendChild(el('p', { class: 'dash-hello' }, [
        document.createTextNode(before),
        el('strong', null, CURRENT_AUTHOR.name || ''),
        document.createTextNode(after)
      ]));
    })();

    // "Pick up where you left off": last session, last story, last course —
    // in that order, left-to-right. Always rendered, even before any of the
    // three has been touched (in that case each slot shows a soft "—"
    // placeholder). Visually leaner than .tile so trainers read them as
    // recent-history shortcuts rather than headline metrics.
    const lastSessionId = localStorage.getItem('ubuntu30.lastSessionId');
    const lastStoryId   = localStorage.getItem('ubuntu30.lastStoryId');
    const lastCourseId  = localStorage.getItem('ubuntu30.lastCourseId');
    const lastSession   = lastSessionId ? sessions.find((s) => s.id === lastSessionId) : null;
    const lastStory     = lastStoryId   ? stories.find((s) => s.id === lastStoryId)   : null;
    const lastCourse    = lastCourseId  ? groups.find((g) => g.id === lastCourseId)   : null;

    function resumeTile(labelKey, href, title, sub) {
      const isEmpty = !href;
      return el('a', {
        class: 'resume-tile' + (isEmpty ? ' resume-tile--empty' : ''),
        href: href || '#',
        // Block navigation on empty placeholders — there's nothing to open.
        onClick: isEmpty ? (e) => e.preventDefault() : null,
        'aria-disabled': isEmpty ? 'true' : null
      }, [
        el('div', { class: 'resume-tile__label' }, t(labelKey)),
        el('div', { class: 'resume-tile__title' }, title || '—'),
        sub ? el('div', { class: 'resume-tile__sub' }, sub) : null
      ]);
    }

    root.appendChild(el('h3', { style: 'margin:8px 0' }, t('dash.resume')));
    const resumeRow = el('div', { class: 'resume-strip' });

    // 1) Last session
    {
      const groupName = lastSession ? ((groups.find((g) => g.id === lastSession.groupId) || {}).name || '') : '';
      resumeRow.appendChild(resumeTile(
        'dash.resumeSession',
        lastSession ? '#/sessions/' + lastSession.id : null,
        lastSession ? (lastSession.theme || t('common.noTheme')) : null,
        lastSession ? [formatDate(lastSession.date), groupName].filter(Boolean).join(' · ') : null
      ));
    }

    // 2) Last story
    {
      // Story text is HTML in v0.3.7+. Strip tags before truncating for the
      // resume tile so the trainer sees a clean preview.
      const lastStoryPlain = lastStory ? stripHtml(lastStory.text || '') : '';
      const snippet = lastStory ? (lastStoryPlain.slice(0, 64) + (lastStoryPlain.length > 64 ? '…' : '')) : null;
      resumeRow.appendChild(resumeTile(
        'dash.resumeStory',
        lastStory ? '#/stories/' + lastStory.id + '/edit' : null,
        lastStory ? (snippet || t('common.noText')) : null,
        lastStory ? formatDate(lastStory.updatedAt || lastStory.createdAt) : null
      ));
    }

    // 3) Last course
    {
      const cohortName = lastCourse ? ((cohorts.find((c) => c.id === lastCourse.cohortId) || {}).name || '') : '';
      const partCount  = lastCourse ? participants.filter((p) => p.groupId === lastCourse.id).length : 0;
      resumeRow.appendChild(resumeTile(
        'dash.resumeCourse',
        lastCourse ? '#/groups/' + lastCourse.id : null,
        lastCourse ? (lastCourse.name || t('common.noName')) : null,
        lastCourse ? [cohortName, t('cohort.participants', { n: partCount })].filter(Boolean).join(' · ') : null
      ));
    }

    root.appendChild(resumeRow);
    // Extra breathing room before the headline tiles
    root.appendChild(el('div', { class: 'resume-spacer' }));

    // KPI banner — only when the user has explicitly opted in via Settings.
    if (dashCfg.showKpi) {
      root.appendChild(el('section', { class: 'kpis' }, [
        kpi(t('dash.tile.attendance'),
            attRate + '%',
            t('dash.attSub', { n: presentCount, total: attendance.length }),
            attRate),
        kpi(t('dash.tile.consentRate'),
            consentRate + '%',
            t('dash.consentSub', { n: storiesConsent, total: stories.length }),
            consentRate),
        kpi(t('dash.tile.activeGroups'),
            activeGroupsRate + '%',
            t('dash.activeGroupsSub', { n: activeGroupsCount, total: groups.length }),
            activeGroupsRate)
      ]));
    }

    // Information tiles — render only those the user has enabled in
    // Settings, in the configured order. The participants count honours
    // the 'my courses only' filter via the earlier participants array
    // (already scoped to facilitated courses when the flag is on).
    const tileBuilders = {
      sessionsMonth: () => linkTile(
        t('dash.tile.sessionsMonth'),
        sessionsThisMonth,
        t('dash.sessionsTotal', { n: sessions.length }),
        '#/sessions'
      ),
      stories: () => linkTile(
        t('dash.tile.stories'),
        stories.length,
        t('dash.storiesSub', { n: storiesConsent }),
        '#/stories'
      ),
      groups: () => linkTile(t('dash.tile.groups'), groups.length, null, '#/groups'),
      participants: () => linkTile(
        t('dash.tile.participants'),
        totalP,
        totalP ? t('dash.sexSub', { f: pct(sexCounts.F || 0), m: pct(sexCounts.M || 0) }) : null,
        '#/participants'
      ),
      cohorts: () => linkTile(t('dash.tile.cohorts'), cohorts.length, null, '#/cohorts'),
    };
    const visibleTileKeys = (dashCfg.tiles || []).filter((k) => tileBuilders[k]);
    if (visibleTileKeys.length) {
      const tiles = el('div', { class: 'tiles' });
      visibleTileKeys.forEach((k) => tiles.appendChild(tileBuilders[k]()));
      root.appendChild(tiles);
    }

    if (dashCfg.showActions) {
      root.appendChild(el('div', { class: 'spacer-lg' }));
      root.appendChild(el('div', { class: 'card' }, [
        el('h3', null, t('dash.actions')),
        el('div', { class: 'row', style: 'flex-wrap:wrap; gap:8px' }, [
          el('a', { class: 'btn btn--soft', href: '#/sessions/new' }, t('dash.newSession')),
          el('a', { class: 'btn btn--soft', href: '#/stories/new' }, t('dash.newStory')),
          el('a', { class: 'btn btn--ghost', href: '#/more' }, t('dash.exportCsv')),
          el('a', { class: 'btn btn--ghost', href: 'https://learn.academyubuntu.com', target: '_blank', rel: 'noopener noreferrer' }, t('dash.openMoodle'))
        ])
      ]));
    }
  }

  function tile(label, value, sub, barPct) {
    const node = el('div', { class: 'tile' }, [
      el('div', { class: 'tile__label' }, label),
      el('div', { class: 'tile__value' }, String(value))
    ]);
    if (sub) node.appendChild(el('div', { class: 'tile__sub' }, sub));
    if (typeof barPct === 'number') {
      node.appendChild(el('div', { class: 'bar' }, el('div', { class: 'bar__fill', style: `width:${barPct}%` })));
    }
    return node;
  }

  /** A headline KPI block — brand-coloured, with a progress bar. */
  function kpi(label, value, sub, pct) {
    const node = el('div', { class: 'kpi' }, [
      el('div', { class: 'kpi__label' }, label),
      el('div', { class: 'kpi__value' }, String(value)),
    ]);
    if (sub) node.appendChild(el('div', { class: 'kpi__sub' }, sub));
    if (typeof pct === 'number') {
      node.appendChild(el('div', { class: 'kpi__bar' },
        el('div', { class: 'kpi__bar-fill', style: `width:${Math.max(0, Math.min(100, pct))}%` })
      ));
    }
    return node;
  }

  /** Tile that acts as a navigation shortcut. Renders as <a class="tile tile--link" href=...>. */
  function linkTile(label, value, sub, href) {
    const node = el('a', { class: 'tile tile--link', href }, [
      el('div', { class: 'tile__label' }, label),
      el('div', { class: 'tile__value' }, String(value))
    ]);
    if (sub) node.appendChild(el('div', { class: 'tile__sub' }, sub));
    return node;
  }

  // ---------- Cohorts list ----------
  async function cohortsListView(_params, root) {
    setTitle(t('cohorts.title'));
    const cohorts = (await DB.all('cohorts')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const groups = await DB.all('groups');
    // v0.3.5c — cohort/course counts exclude session-scoped walk-ins
    const participants = (await DB.all('participants')).filter((p) => !p.walkInSessionId);

    root.appendChild(actionCircles([
      { icon: ACTION_ICONS.plus, label: t('actions.newCohort'), href: '#/cohorts/new' }
    ]));
    root.appendChild(el('p', { class: 'muted' }, tn(cohorts.length, 'cohorts.countOne', 'cohorts.countOther')));

    if (!cohorts.length) {
      root.appendChild(emptyState(t('cohorts.emptyTitle'), t('cohorts.emptyBody'), '#/cohorts/new', t('cohorts.emptyCta')));
      return;
    }
    cohorts.forEach((c) => {
      const cohortGroups = groups.filter((g) => g.cohortId === c.id);
      const cohortGroupIds = new Set(cohortGroups.map((g) => g.id));
      const cohortPCount = participants.filter((p) => cohortGroupIds.has(p.groupId)).length;
      const sub = [
        c.region || t('cohort.unknownRegion'),
        c.startDate ? formatDate(c.startDate) : null,
        t('cohorts.sub', { g: cohortGroups.length, p: cohortPCount })
      ].filter(Boolean).join(' · ');
      root.appendChild(el('a', { class: 'card-link', href: `#/cohorts/${c.id}` }, [
        el('div', { class: 'card card--row' }, [
          thumbIcon('cohorts'),
          el('div', { class: 'grow', style: 'min-width:0' }, [
            el('div', { class: 'card__title' }, c.name || t('common.noName')),
            el('div', { class: 'card__sub' }, sub)
          ])
        ])
      ]));
    });
    attachListSearch(root, { key: 'pwa.cohorts' });
  }

  // ---------- Cohort form ----------
  async function cohortFormView(params, root) {
    const isEdit = !!params.id;
    let cohort = isEdit ? await DB.get('cohorts', params.id) : { name: '', region: '', startDate: '', endDate: '' };
    if (isEdit && !cohort) { root.appendChild(notFoundView()); return; }
    setTitle(isEdit ? t('cohort.editTitle') : t('cohort.newTitle'));

    const form = el('form', { class: 'card', onSubmit: async (e) => {
      e.preventDefault();
      cohort.name = form.elements['name'].value.trim();
      cohort.region = form.elements['region'].value.trim();
      cohort.startDate = form.elements['startDate'].value || null;
      cohort.endDate = form.elements['endDate'].value || null;
      await DB.put('cohorts', cohort, CURRENT_AUTHOR.id);
      toast(isEdit ? t('cohort.updated') : t('cohort.created'));
      go('/cohorts/' + cohort.id);
    } }, [
      fg(t('cohort.nameLabel'), el('input', { name: 'name', type: 'text', required: true, value: cohort.name || '', placeholder: t('cohort.namePh') })),
      fg(t('common.region'), el('input', { name: 'region', type: 'text', value: cohort.region || '', placeholder: t('cohort.regionPh') })),
      el('div', { class: 'row', style: 'gap:12px' }, [
        el('div', { class: 'grow' }, fg(t('common.startDate'), el('input', { name: 'startDate', type: 'date', value: formatDateInput(cohort.startDate) }))),
        el('div', { class: 'grow' }, fg(t('common.endDate'), el('input', { name: 'endDate', type: 'date', value: formatDateInput(cohort.endDate) })))
      ]),
      el('button', { class: 'btn btn--block', type: 'submit' }, isEdit ? t('common.save') : t('cohort.createCta'))
    ]);
    root.appendChild(form);

    if (isEdit) {
      root.appendChild(dangerButton(t('cohort.deleteCta'), async () => {
        if (!confirm(t('cohort.deleteConfirm'))) return;
        await DB.delete('cohorts', cohort.id);
        if (window.SYNC) window.SYNC.syncNow().catch(() => {});
        toast(t('cohort.deleted'));
        go('/cohorts');
      }));
    }
  }

  // ---------- Cohort detail ----------
  async function cohortDetailView(params, root) {
    const cohort = await DB.get('cohorts', params.id);
    if (!cohort) { root.appendChild(notFoundView()); return; }
    setTitle(cohort.name || t('cohort.defaultTitle'));

    const groups = (await DB.byIndex('groups', 'cohortId', cohort.id))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    root.appendChild(el('div', { class: 'card card--accent' }, [
      el('div', { class: 'row between' }, [
        el('div', { class: 'row', style: 'gap:12px; min-width:0' }, [
          thumbIcon('cohorts'),
          el('div', { style: 'min-width:0' }, [
            el('div', { class: 'card__title' }, cohort.name || t('common.noName')),
            el('div', { class: 'card__sub' }, [
              cohort.region || t('cohort.unknownRegion'),
              cohort.startDate ? ' · ' + formatDate(cohort.startDate) : '',
              cohort.endDate ? ' → ' + formatDate(cohort.endDate) : ''
            ].join(''))
          ])
        ]),
        el('a', { class: 'btn btn--sm btn--ghost', href: `#/cohorts/${cohort.id}/edit` }, t('common.edit'))
      ])
    ]));

    root.appendChild(sectionHeading('groups', t('cohort.groupsHeading', { n: groups.length }),
      el('a', { class: 'btn btn--sm', href: `#/cohorts/${cohort.id}/groups/new` }, t('cohort.newGroup'))
    ));

    if (!groups.length) {
      root.appendChild(emptyState(t('cohort.noGroupsTitle'), t('cohort.noGroupsBody'), `#/cohorts/${cohort.id}/groups/new`, t('cohort.noGroupsCta')));
      return;
    }
    // v0.3.5c — cohort detail shows enrolled participants, not walk-ins
    const participants = (await DB.all('participants')).filter((p) => !p.walkInSessionId);
    // Wrap courses in a section so the search bar can scope to its
    // children only (not the cohort header card above).
    const coursesSection = el('div', { class: 'cohort-courses' });
    groups.forEach((g) => {
      const pCount = participants.filter((p) => p.groupId === g.id).length;
      coursesSection.appendChild(el('a', { class: 'card-link cohort-course', href: `#/groups/${g.id}` }, [
        el('div', { class: 'card card--row' }, [
          courseThumb(g),
          el('div', { class: 'grow', style: 'min-width:0' }, [
            el('div', { class: 'card__title' }, g.name || t('common.noName')),
            el('div', { class: 'card__sub' },
              // v0.3.5i — facilitator can be a list now; the legacy .facilitator
              // text always mirrors the joined names of facilitatorIds, so it's
              // safe to display directly. Plural label kicks in when there's a
              // comma in the joined string (cheap heuristic).
              (g.facilitator
                ? (g.facilitator.indexOf(',') >= 0
                    ? t('cohort.facilitatedByMany', { names: g.facilitator })
                    : t('cohort.facilitatedBy',     { name:  g.facilitator }))
                : t('cohort.noFacilitator')) +
              ' · ' + t('cohort.participants', { n: pCount })
            )
          ])
        ])
      ]));
    });
    root.appendChild(coursesSection);
    attachListSearch(coursesSection, {
      key: 'pwa.cohort.' + cohort.id + '.courses',
      placeholder: t('common.searchPh'),
      itemSelector: '.cohort-course',
      position: 'beforeItems',
    });
  }

  // ---------- Group form ----------
  async function groupFormView(params, root) {
    const isEdit = !!params.id;
    let group;
    let cohortId = params.cohortId || null;
    if (isEdit) {
      group = await DB.get('groups', params.id);
      if (!group) { root.appendChild(notFoundView()); return; }
      cohortId = group.cohortId;
    } else {
      group = { cohortId, name: '', facilitator: '', facilitatorIds: [] };
    }
    const cohort = await DB.get('cohorts', cohortId);
    if (!cohort) { root.appendChild(notFoundView()); return; }
    setTitle(isEdit ? t('group.editTitle') : t('group.newTitle'));

    // v0.3.5i — load staff (trainers + admins) so we can pick course
    // facilitators from a list rather than typing a free-text name. Falls
    // back gracefully if the device is offline.
    let staff = [];
    let staffError = false;
    try {
      const r = await window.API.listStaff();
      staff = (r && r.users) || [];
    } catch (e) {
      staffError = true;
    }
    // Make sure we keep historical names visible even if the staff endpoint
    // didn't surface them (e.g., a user later disabled).
    const selected = new Set(Array.isArray(group.facilitatorIds) ? group.facilitatorIds : []);

    // Build the facilitators block. When the staff list is available we
    // render a search box, a chip strip of currently-selected staff (so they
    // stay visible even when the search filters them out), and a filtered
    // list of remaining staff. Click a row to add; click the × on a chip to
    // remove. Offline: fall back to a single text input.
    const facBlock = el('div', { class: 'fac-list' });
    function staffNameOf(u) {
      return ((u && u.firstName || '') + ' ' + (u && u.lastName || '')).trim() || (u && u.email) || '—';
    }
    let facQuery = '';
    function renderFacList() {
      facBlock.innerHTML = '';
      if (staffError && !staff.length) {
        facBlock.appendChild(el('p', { class: 'small muted', style: 'margin:0 0 6px' }, t('group.facilitatorsOffline')));
        facBlock.appendChild(el('input', {
          name: 'facilitatorLegacy', type: 'text', value: group.facilitator || '', placeholder: t('group.facilitatorLegacyPh')
        }));
        return;
      }
      if (!staff.length) {
        facBlock.appendChild(el('p', { class: 'small muted', style: 'margin:0' }, t('group.facilitatorsNone')));
        return;
      }

      // ---- Selected chips ----
      if (selected.size) {
        const chips = el('div', { style: 'display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px' });
        Array.from(selected).forEach((id) => {
          const u = staff.find((s) => s.id === id);
          const label = staffNameOf(u || { id });
          const chip = el('span', {
            style: 'display:inline-flex; align-items:center; gap:6px; background:var(--brand-tint); color:var(--brand); border:1px solid var(--brand-tint); border-radius:999px; padding:3px 8px 3px 10px; font-size:13px; font-weight:600'
          }, [
            el('span', null, label),
            el('button', {
              type: 'button', 'aria-label': t('common.cancel') || 'Remove',
              style: 'background:transparent; border:0; color:inherit; cursor:pointer; font-size:16px; line-height:1; padding:0 2px',
              onClick: () => { selected.delete(id); renderFacList(); }
            }, '×')
          ]);
          chips.appendChild(chip);
        });
        facBlock.appendChild(el('div', { class: 'small muted', style: 'margin-bottom:4px' }, t('group.facSelectedTitle') + ' · ' + selected.size));
        facBlock.appendChild(chips);
      }

      // ---- Search input ----
      const search = el('input', {
        type: 'text',
        placeholder: t('group.facSearchPh'),
        autocomplete: 'off',
        value: facQuery,
        style: 'width:100%; padding:8px 10px; border:1px solid var(--border); border-radius:8px; font-size:14px; margin-bottom:6px'
      });
      search.addEventListener('input', () => {
        facQuery = search.value;
        renderResults();
      });
      facBlock.appendChild(search);

      // ---- Filterable list ----
      const listWrap = el('div', { style: 'max-height:220px; overflow-y:auto; border:1px solid var(--border); border-radius:8px' });
      facBlock.appendChild(listWrap);
      function renderResults() {
        listWrap.innerHTML = '';
        const q = facQuery.trim().toLowerCase();
        const filtered = staff.filter((u) => {
          if (!q) return true;
          const hay = (staffNameOf(u) + ' ' + (u.email || '')).toLowerCase();
          return hay.indexOf(q) !== -1;
        });
        if (!filtered.length) {
          listWrap.appendChild(el('p', { class: 'small muted', style: 'margin:8px 10px' }, t('group.facNoMatch')));
          return;
        }
        filtered.forEach((u) => {
          const cb = el('input', { type: 'checkbox', value: u.id });
          if (selected.has(u.id)) cb.checked = true;
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(u.id);
            else selected.delete(u.id);
            renderFacList();   // refresh chips + count
            // After re-render the search input is recreated; restore focus.
            const s = facBlock.querySelector('input[type="text"]');
            if (s) { s.focus(); s.setSelectionRange(facQuery.length, facQuery.length); }
          });
          const sub = u.role === 'admin' ? t('picker.roleAdmin') : t('picker.roleTrainer');
          listWrap.appendChild(el('label', {
            class: 'fac-row',
            style: 'display:flex; align-items:center; gap:10px; padding:6px 10px; cursor:pointer; border-bottom:1px solid var(--border)'
          }, [
            cb,
            el('div', { class: 'grow' }, [
              el('div', null, staffNameOf(u)),
              el('div', { class: 'small muted' }, sub)
            ])
          ]));
        });
      }
      renderResults();
    }
    renderFacList();

    const form = el('form', { class: 'card', onSubmit: async (e) => {
      e.preventDefault();
      group.name = form.elements['name'].value.trim();
      // Multi-facilitator: store the selected user UUIDs.
      group.facilitatorIds = Array.from(selected);
      // Mirror the joined names into the legacy facilitator string so older
      // clients (and any read path that hasn't been migrated yet) still see
      // who's running the course. If the offline-fallback input was shown,
      // use its value verbatim.
      const legacyInput = form.elements['facilitatorLegacy'];
      if (legacyInput) {
        group.facilitator = legacyInput.value.trim();
      } else if (group.facilitatorIds.length) {
        group.facilitator = group.facilitatorIds.map((id) => {
          const u = staff.find((s) => s.id === id);
          if (!u) return '';
          return ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
        }).filter(Boolean).join(', ');
      } else {
        group.facilitator = '';
      }
      const courseRaw = form.elements['moodleCourseId'].value.trim();
      group.moodleCourseId = courseRaw === '' ? null : parseInt(courseRaw, 10);
      if (group.moodleCourseId !== null && (isNaN(group.moodleCourseId) || group.moodleCourseId < 1)) {
        toast(t('group.courseIdInvalid'));
        return;
      }
      group.cohortId = cohortId;
      await DB.put('groups', group, CURRENT_AUTHOR.id);
      toast(isEdit ? t('group.updated') : t('group.created'));
      go('/groups/' + group.id);
    } }, [
      // Info banner — the group itself isn't synced, but its sessions / participants are
      isEdit && group.moodleCourseId
        ? el('div', { class: 'synced-banner', html: t('sync.bannerGroup') })
        : null,
      el('p', { class: 'hint' }, t('group.cohortLabel', { name: cohort.name || '—' })),
      fg(t('group.nameLabel'), el('input', { name: 'name', type: 'text', required: true, value: group.name || '', placeholder: t('group.namePh') })),
      fg(t('group.facilitatorsLabel'), facBlock),
      fg(t('group.courseIdLabel'), el('input', {
        name: 'moodleCourseId', type: 'number', min: '1',
        value: group.moodleCourseId != null ? String(group.moodleCourseId) : '',
        placeholder: t('group.courseIdPh')
      })),
      el('p', { class: 'hint small' }, t('group.courseIdHint')),
      el('button', { class: 'btn btn--block', type: 'submit' }, isEdit ? t('common.save') : t('group.createCta'))
    ]);
    root.appendChild(form);

    if (isEdit) {
      root.appendChild(dangerButton(t('group.deleteCta'), async () => {
        if (!confirm(t('group.deleteConfirm'))) return;
        await DB.delete('groups', group.id);
        if (window.SYNC) window.SYNC.syncNow().catch(() => {});
        toast(t('group.deleted'));
        go('/cohorts/' + group.cohortId);
      }));
    }
  }

  // ---------- Group detail ----------
  async function groupDetailView(params, root) {
    const group = await DB.get('groups', params.id);
    if (!group) { root.appendChild(notFoundView()); return; }
    const cohort = await DB.get('cohorts', group.cohortId);
    setTitle(group.name || t('group.defaultTitle'));
    // Remember the last course opened on this device, so the dashboard's
    // "Pick up where you left off" tile can surface it. Same pattern as
    // lastSessionId / lastStoryId.
    try { localStorage.setItem('ubuntu30.lastCourseId', group.id); } catch (e) {}

    // v0.3.5c — exclude walk-ins (session-scoped) from the course roster
    const participants = (await DB.byIndex('participants', 'groupId', group.id))
      .filter((p) => !p.walkInSessionId)
      .sort((a, b) => ((a.lastName || '') + (a.firstName || '')).localeCompare((b.lastName || '') + (b.firstName || '')));
    const sessions = (await DB.byIndex('sessions', 'groupId', group.id))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    root.appendChild(el('div', { class: 'card card--accent' }, [
      el('div', { class: 'row between' }, [
        el('div', { class: 'row', style: 'gap:12px; min-width:0' }, [
          courseThumb(group),
          el('div', { style: 'min-width:0' }, [
            el('div', { class: 'card__title' }, [
              document.createTextNode(group.name || t('common.noName')),
              group.moodleCourseId
                ? el('span', { class: 'pill pill--moodle', style: 'margin-left:8px;font-size:11px' }, t('sync.pill'))
                : null
            ]),
            el('div', { class: 'card__sub' },
              (cohort ? cohort.name : t('group.unknownCohort')) + (group.facilitator ? ' · ' + group.facilitator : '')
            )
          ])
        ]),
        el('a', { class: 'btn btn--sm btn--ghost', href: `#/groups/${group.id}/edit` }, t('common.edit'))
      ])
    ]));

    // Sync-from-Ubuntu-eLearning — only surfaced when THIS course is linked
    // to a Moodle course; otherwise the action has nothing to pull. Rendered
    // as an action circle so it matches the row layout used on the other
    // list views.
    if (group.moodleCourseId) {
      let courseSyncRef = null;
      root.appendChild(actionCircles([{
        icon: ACTION_ICONS.sync,
        label: t('actions.eLearning'),
        ref: (n) => { courseSyncRef = n; },
        onClick: async () => {
          if (!navigator.onLine) { toast(t('sync.status.offline')); return; }
          const labelEl = courseSyncRef.querySelector('.action-circle__label');
          const origLabel = labelEl.textContent;
          courseSyncRef.disabled = true;
          labelEl.textContent = t('actions.syncing');
          try {
            const r = await window.API.moodleSync();
            const s = (r && r.summary) || {};
            if (s.skipped) {
              toast(t('sessions.syncSkipped'));
            } else if ((s.errors || []).length) {
              console.warn('Sync errors:', s.errors);
              toast(t('sessions.syncErrors', { n: s.errors.length }));
            } else {
              toast(t('sessions.syncResult', {
                sNew: s.sessions_created || 0,
                pNew: s.participants_created || 0
              }));
            }
            if (window.SYNC) await window.SYNC.syncNow();
            await handleRoute();
          } catch (err) {
            toast(err.message || t('sync.status.error'));
          } finally {
            if (courseSyncRef) {
              labelEl.textContent = origLabel;
              courseSyncRef.disabled = false;
            }
          }
        }
      }]));
    }

    // Participants live in their own section so we can scope a search bar
    // to them only — the sessions block below stays unfiltered.
    const partsSection = el('div', { class: 'course-participants' });
    partsSection.appendChild(sectionHeading('participants', t('group.participantsHeading', { n: participants.length })));
    // Action-circle row for + Participant. Slotted under the search bar
    // for populated lists (see the placement step after attachListSearch),
    // or directly under the heading for empty lists.
    const partsActions = actionCircles([
      { icon: ACTION_ICONS.plus, label: t('actions.newParticipant'), href: `#/groups/${group.id}/participants/new` }
    ]);
    if (!participants.length) {
      partsSection.appendChild(partsActions);
      partsSection.appendChild(emptyState(t('group.noParticipantsTitle'), t('group.noParticipantsBody')));
    } else {
      // Active rows first, then dropped (with a pill and faded look)
      const sorted = participants.slice().sort((a, b) => {
        const aDrop = a.status === 'dropped' ? 1 : 0;
        const bDrop = b.status === 'dropped' ? 1 : 0;
        return aDrop - bDrop;
      });
      sorted.forEach((p) => {
        const sub = [sexLabel(p.sex), p.ageRange || '', p.contact || ''].filter(Boolean).join(' · ');
        const isDropped = p.status === 'dropped';
        // Moodle pill — flag enrolees that came from Ubuntu eLearning so
        // the trainer doesn't accidentally edit/delete a synced record.
        // Mirrors the pill shown on courses and sessions.
        const titleNode = el('div', { class: 'list-item__title' }, [
          document.createTextNode(((p.firstName || '') + ' ' + (p.lastName || '')).trim() || t('common.noName')),
          p.source === 'moodle'
            ? el('span', { class: 'pill pill--moodle', style: 'margin-left:8px;font-size:11px' }, t('sync.pill'))
            : null,
          isDropped ? el('span', {
            class: 'pill', style: 'margin-left:8px;font-size:11px;background:#EEE;color:var(--muted)'
          }, t('p.statusDropped')) : null
        ]);
        partsSection.appendChild(el('a', {
          class: 'card-link course-participant',
          href: `#/participants/${p.id}/edit`,
          style: isDropped ? 'opacity:.62' : ''
        }, [
          el('div', { class: 'list-item' }, [
            thumbIcon('participants'),
            el('div', { class: 'grow' }, [
              titleNode,
              el('div', { class: 'list-item__sub' }, sub)
            ])
          ])
        ]));
      });
      // Search bar scoped to participant cards only (not the sessions list
      // below). Placement: beforeItems so the heading stays above the
      // search; the search slots between heading and the first card.
      attachListSearch(partsSection, {
        key: 'pwa.course.' + group.id + '.participants',
        placeholder: t('group.searchParticipantsPh') || t('common.searchPh'),
        itemSelector: '.course-participant',
        position: 'beforeItems',
      });
      // Slot the action-circle row right after the search bar
      // (heading → search → action → items).
      const partsSearchBar = partsSection.querySelector('.list-search');
      if (partsSearchBar) partsSearchBar.after(partsActions);
      else partsSection.appendChild(partsActions);
    }
    root.appendChild(partsSection);

    // Sessions block — wrapped in its own section so the search bar can
    // scope to .course-session cards only (not the participants above).
    // Removed the previous slice(0, 5) cap so search can reach every
    // session — when the trainer types something, they expect the filter
    // to match the entire course history, not just the most recent 5.
    const sessSection = el('div', { class: 'course-sessions', style: 'margin-top:16px' });
    sessSection.appendChild(sectionHeading('sessions', t('group.sessionsHeading', { n: sessions.length })));
    // Same pattern as participants: a + Session action circle that sits
    // under the search bar when there are sessions, or directly under
    // the heading when the list is empty.
    const sessActions = actionCircles([
      { icon: ACTION_ICONS.plus, label: t('actions.newSession'), href: `#/sessions/new?groupId=${group.id}` }
    ]);
    if (!sessions.length) {
      sessSection.appendChild(sessActions);
      sessSection.appendChild(el('p', { class: 'muted small' }, t('group.noSessions')));
    } else {
      sessions.forEach((s) => {
        sessSection.appendChild(el('a', { class: 'card-link course-session', href: `#/sessions/${s.id}` }, [
          el('div', { class: 'list-item' }, [
            thumbIcon('sessions'),
            el('div', { class: 'grow' }, [
              el('div', { class: 'list-item__title' }, s.theme || t('common.noTheme')),
              el('div', { class: 'list-item__sub' }, formatDate(s.date))
            ])
          ])
        ]));
      });
      attachListSearch(sessSection, {
        key: 'pwa.course.' + group.id + '.sessions',
        placeholder: t('group.searchSessionsPh') || t('common.searchPh'),
        itemSelector: '.course-session',
        position: 'beforeItems',
      });
      const sessSearchBar = sessSection.querySelector('.list-search');
      if (sessSearchBar) sessSearchBar.after(sessActions);
      else sessSection.appendChild(sessActions);
    }
    root.appendChild(sessSection);
  }

  // ---------- All Groups (flat list across cohorts) ----------
  async function groupsListView(_params, root) {
    setTitle(t('dash.tile.groups'));
    // v0.3.5j — same "my courses only" filter the dashboard applies.
    const groups = applyMyCourses(await DB.all('groups'))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // v0.3.7 — action-circle for Moodle sync (replaces the block button).
    let coursesSyncRef = null;
    root.appendChild(actionCircles([
      {
        icon: ACTION_ICONS.sync,
        label: t('actions.eLearning'),
        ref: (n) => { coursesSyncRef = n; },
        onClick: async () => {
          if (!navigator.onLine) { toast(t('sync.status.offline')); return; }
          const labelEl = coursesSyncRef.querySelector('.action-circle__label');
          const origLabel = labelEl.textContent;
          coursesSyncRef.disabled = true;
          labelEl.textContent = t('actions.syncing');
          try {
            const r = await window.API.moodleSync();
            const s = (r && r.summary) || {};
            if (s.skipped) {
              toast(t('sessions.syncSkipped'));
            } else if ((s.errors || []).length) {
              console.warn('Sync errors:', s.errors);
              toast(t('sessions.syncErrors', { n: s.errors.length }));
            } else {
              toast(t('sessions.syncResult', {
                sNew: s.sessions_created || 0,
                pNew: s.participants_created || 0
              }));
            }
            if (window.SYNC) await window.SYNC.syncNow();
            await handleRoute();
          } catch (err) {
            toast(err.message || t('sync.status.error'));
          } finally {
            if (coursesSyncRef) {
              labelEl.textContent = origLabel;
              coursesSyncRef.disabled = false;
            }
          }
        }
      }
    ]));

    if (!groups.length) {
      root.appendChild(emptyState(
        t('cohort.noGroupsTitle'),
        t('groupsList.empty'),
        '#/cohorts',
        t('cohorts.emptyCta')
      ));
      return;
    }
    const cohorts = await DB.all('cohorts');
    const cohortsById = new Map(cohorts.map((c) => [c.id, c]));
    // v0.3.5c — courses list shows enrolled participant counts (walk-ins excluded)
    const participants = (await DB.all('participants')).filter((p) => !p.walkInSessionId);
    const partCounts = new Map();
    participants.forEach((p) => partCounts.set(p.groupId, (partCounts.get(p.groupId) || 0) + 1));

    root.appendChild(el('p', { class: 'muted' }, tn(groups.length, 'groupsList.countOne', 'groupsList.countOther')));

    groups.forEach((g) => {
      const cohort = cohortsById.get(g.cohortId);
      const pCount = partCounts.get(g.id) || 0;
      const sub = [
        cohort ? cohort.name : t('group.unknownCohort'),
        g.facilitator || null,
        t('cohort.participants', { n: pCount })
      ].filter(Boolean).join(' · ');
      const titleNode = el('div', { class: 'card__title' }, [
        document.createTextNode(g.name || t('common.noName')),
        g.moodleCourseId
          ? el('span', { class: 'pill pill--moodle', style: 'margin-left:8px;font-size:11px' }, t('sync.pill'))
          : null
      ]);
      root.appendChild(el('a', { class: 'card-link', href: `#/groups/${g.id}` }, [
        el('div', { class: 'card card--row' }, [
          courseThumb(g),
          el('div', { class: 'grow', style: 'min-width:0' }, [
            titleNode,
            el('div', { class: 'card__sub' }, sub)
          ])
        ])
      ]));
    });
    attachListSearch(root, { key: 'pwa.courses' });
  }

  // ---------- All Participants (flat list across groups) ----------
  async function participantsListView(_params, root) {
    setTitle(t('dash.tile.participants'));
    // v0.3.5c — flat participants list shows enrolled people, not session walk-ins
    const participants = (await DB.all('participants'))
      .filter((p) => !p.walkInSessionId)
      .sort((a, b) => ((a.lastName || '') + (a.firstName || '')).localeCompare((b.lastName || '') + (b.firstName || '')));

    if (!participants.length) {
      root.appendChild(emptyState(
        t('group.noParticipantsTitle'),
        t('participantsList.empty'),
        '#/cohorts',
        t('cohorts.emptyCta')
      ));
      return;
    }
    const groups = await DB.all('groups');
    const groupsById = new Map(groups.map((g) => [g.id, g]));

    root.appendChild(el('p', { class: 'muted' }, tn(participants.length, 'participantsList.countOne', 'participantsList.countOther')));

    participants.forEach((p) => {
      const group = groupsById.get(p.groupId);
      const sub = [
        sexLabel(p.sex),
        p.ageRange || null,
        group ? group.name : null
      ].filter(Boolean).join(' · ');
      const isDropped = p.status === 'dropped';
      const titleNode = el('div', { class: 'list-item__title' }, [
        document.createTextNode(((p.firstName || '') + ' ' + (p.lastName || '')).trim() || t('common.noName')),
        p.source === 'moodle'
          ? el('span', { class: 'pill pill--moodle', style: 'margin-left:8px;font-size:11px' }, t('sync.pill'))
          : null,
        isDropped
          ? el('span', { class: 'pill', style: 'margin-left:8px;font-size:11px;background:#EEE;color:var(--muted)' }, t('p.statusDropped'))
          : null
      ]);
      root.appendChild(el('a', {
        class: 'card-link',
        href: `#/participants/${p.id}/edit`,
        style: isDropped ? 'opacity:.62' : ''
      }, [
        el('div', { class: 'list-item' }, [
          thumbIcon('participants'),
          el('div', { class: 'grow' }, [
            titleNode,
            el('div', { class: 'list-item__sub' }, sub)
          ])
        ])
      ]));
    });
    attachListSearch(root, { key: 'pwa.participants' });
  }

  // ---------- Participant form ----------
  /**
   * v0.3.5 — Searchable user picker rendered when a trainer or admin taps
   * "+ Participant" on a course. v0.3.7 — both roles can now also create a
   * brand-new trainee inline (no invite email). Email is the unicity key:
   * if a user with that email already exists, the server reuses them and
   * back-fills any missing demographics rather than creating a duplicate.
   *
   * Tapping a user creates a participant row in IndexedDB pointing at the
   * picked user.id, then navigates back to the course.
   */
  async function renderUserPicker(root, group) {
    if (!navigator.onLine) {
      root.appendChild(el('div', { class: 'card' }, [
        el('h3', { style: 'margin-top:0' }, t('picker.offlineTitle')),
        el('p', { class: 'muted' }, t('picker.offlineBody'))
      ]));
      return;
    }

    root.appendChild(el('p', { class: 'hint' }, t('p.groupLabel', { name: group.name || '—' })));

    const search = el('input', {
      type: 'text', placeholder: t('picker.searchPh'), autocomplete: 'off',
      style: 'width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; font-size:14px; margin-bottom:10px;'
    });
    root.appendChild(search);

    const status = el('p', { class: 'small muted' }, t('picker.startTyping'));
    root.appendChild(status);

    const listEl = el('div', { class: 'list' });
    root.appendChild(listEl);

    /** Persist the chosen user as a participant in this course, then leave. */
    async function pickUser(u) {
      // Guard: never enrol the same user twice. The server's pick endpoint
      // already filters enrolled users out of the search, but the "+ Create
      // new" path reuses an existing user by email and could land here with
      // someone already on this course's roster. Also covers a stale local
      // cache during a flaky network.
      const existing = (await DB.byIndex('participants', 'groupId', group.id))
        .filter((p) => p.userId === u.id && !p.walkInSessionId);
      if (existing.length) {
        toast(t('picker.alreadyEnrolled', {
          name: ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || t('common.noName')
        }));
        go('/groups/' + group.id);
        return;
      }
      const newP = {
        userId: u.id,
        groupId: group.id,
        firstName: u.firstName || '',
        lastName:  u.lastName  || '',
        sex: '',
        ageRange: '',
        contact:   (u.syntheticEmail ? '' : (u.email || '')),
        source: 'user',
      };
      await DB.put('participants', newP, CURRENT_AUTHOR.id);
      toast(t('p.added'));
      go('/groups/' + group.id);
    }

    let inflight = null;
    async function runSearch() {
      const q = search.value.trim();
      if (q.length === 0) {
        status.textContent = t('picker.startTyping');
        listEl.innerHTML = '';
        return;
      }
      if (q.length < 2) return;     // wait for at least 2 chars
      status.textContent = t('picker.searching');
      // Cancel any in-flight request indirectly by ignoring stale results
      const myReq = (inflight = {});
      try {
        const r = await window.API.pickUsers(group.id, q);
        if (myReq !== inflight) return;   // stale
        const users = (r && r.users) || [];
        listEl.innerHTML = '';
        if (!users.length) {
          status.textContent = t('picker.noMatch');
          return;
        }
        status.textContent = tn(users.length, 'picker.foundOne', 'picker.foundOther');
        users.forEach((u) => {
          listEl.appendChild(el('button', {
            class: 'list-item', type: 'button',
            onClick: () => pickUser(u)
          }, [
            el('div', { class: 'grow' }, [
              el('div', { class: 'list-item__title' }, ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || t('common.noName')),
              el('div', { class: 'list-item__sub' }, [
                u.syntheticEmail ? null : u.email,
                u.role === 'admin' ? t('picker.roleAdmin') : (u.role === 'trainer' ? t('picker.roleTrainer') : t('picker.roleTrainee'))
              ].filter(Boolean).join(' · '))
            ])
          ]));
        });
      } catch (err) {
        if (myReq !== inflight) return;
        console.error('[ubuntu30 picker] pickUsers failed', err);
        // Show enough info to triage from the screen
        status.textContent = t('picker.error') + ' (' + (err && (err.status || err.code) || 'unknown') + ': ' + (err && err.message || 'no message') + ')';
      }
    }

    // 250ms debounce
    let dbTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(dbTimer);
      dbTimer = setTimeout(runSearch, 250);
    });
    setTimeout(() => search.focus(), 0);

    // v0.3.7 — "Create a brand-new person" expander, available to trainers
    // and admins alike. Email + sex + age are required so the participant
    // row is usable for reporting, and email is the unicity key the server
    // uses to dedupe against existing users.
    const createBtn = el('button', {
      class: 'btn btn--ghost btn--block', type: 'button',
      style: 'margin-top:16px'
    }, t('picker.createNewCta'));
    const createForm = el('form', {
      class: 'card', style: 'margin-top:8px', hidden: true,
      onSubmit: async (e) => {
        e.preventDefault();
        const firstName = createForm.elements['firstName'].value.trim();
        const lastName  = createForm.elements['lastName'].value.trim();
        const email     = createForm.elements['email'].value.trim().toLowerCase();
        const phone     = createForm.elements['phone'].value.trim();
        const sex       = createForm.elements['sex'].value;
        const ageRange  = createForm.elements['ageRange'].value;
        if (!firstName || !lastName) return;
        // Defensive: required is set on the inputs, but double-check here in
        // case the browser strips the constraint (older WebViews).
        if (!email || !sex || !ageRange) {
          toast(t('picker.createNewMissing'));
          return;
        }
        const submit = createForm.querySelector('button[type=submit]');
        submit.disabled = true;
        try {
          const r = await window.API.createUser({
            firstName, lastName, email, phone, sex, ageRange,
            role: 'trainee', sendInvite: false,
          });
          // Now enrol them as a participant in this course
          await pickUser({
            id: r.user.id,
            firstName: r.user.firstName,
            lastName:  r.user.lastName,
            email:     r.user.email,
            syntheticEmail: false,
          });
        } catch (err) {
          toast(err.message || t('common.error'));
          submit.disabled = false;
        }
      }
    }, [
      el('h3', { style: 'margin-top:0' }, t('picker.createNewTitle')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, t('picker.createNewIntro')),
      el('div', { class: 'row', style: 'gap:12px' }, [
        el('div', { class: 'grow' }, fg(t('common.firstName'), el('input', { name: 'firstName', type: 'text', required: true, autocomplete: 'given-name' }))),
        el('div', { class: 'grow' }, fg(t('common.lastName'),  el('input', { name: 'lastName',  type: 'text', required: true, autocomplete: 'family-name' })))
      ]),
      fg(t('common.email'), el('input', { name: 'email', type: 'email', required: true, autocomplete: 'email', placeholder: t('common.emailPh') })),
      fg(t('common.phone'), el('input', { name: 'phone', type: 'tel',   autocomplete: 'tel',   placeholder: '+257…' })),
      el('div', { class: 'row', style: 'gap:12px' }, [
        el('div', { class: 'grow' }, fg(t('common.sex'), selectEl('sex', [{ value: '', label: '—' }].concat(SEX_OPTIONS.map((s) => ({ value: s, label: sexLabel(s) }))), '', true))),
        el('div', { class: 'grow' }, fg(t('common.ageRange'), selectEl('ageRange', [{ value: '', label: '—' }].concat(AGE_RANGES.map((a) => ({ value: a, label: a }))), '', true)))
      ]),
      el('div', { class: 'row', style: 'gap:8px' }, [
        el('button', { class: 'btn', type: 'submit' }, t('picker.createNewSave')),
        el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          onClick: () => { createForm.reset(); createForm.hidden = true; createBtn.hidden = false; }
        }, t('common.cancel') || 'Cancel')
      ])
    ]);
    createBtn.addEventListener('click', () => {
      createForm.hidden = false; createBtn.hidden = true;
      const fn = createForm.elements['firstName']; if (fn) fn.focus();
    });
    root.appendChild(createBtn);
    root.appendChild(createForm);
  }

  async function participantFormView(params, root) {
    const isEdit = !!params.id;
    let p;
    let groupId = params.groupId || null;
    if (isEdit) {
      p = await DB.get('participants', params.id);
      if (!p) { root.appendChild(notFoundView()); return; }
      groupId = p.groupId;
    } else {
      p = { groupId, firstName: '', lastName: '', sex: 'F', ageRange: '', contact: '' };
    }
    const group = await DB.get('groups', groupId);
    if (!group) { root.appendChild(notFoundView()); return; }
    setTitle(isEdit ? t('p.editTitle') : t('p.newTitle'));

    // v0.3.5 — when CREATING a participant (not editing), use the user-picker
    // flow. Editing keeps the classic form so trainers can adjust sex/age/contact.
    if (!isEdit) {
      renderUserPicker(root, group);
      return;
    }

    // Moodle-synced participant — name and contact come from upstream, lock them
    const synced = isEdit && p.source === 'moodle';

    const firstNameInput = el('input', { name: 'firstName', type: 'text', required: true, value: p.firstName || '' });
    const lastNameInput  = el('input', { name: 'lastName',  type: 'text', value: p.lastName  || '' });
    const contactInput   = el('input', { name: 'contact',   type: 'text', value: p.contact   || '', placeholder: t('common.contactPh') });
    if (synced) {
      firstNameInput.disabled = true;
      lastNameInput.disabled  = true;
      contactInput.disabled   = true;
    }

    const form = el('form', { class: 'card', onSubmit: async (e) => {
      e.preventDefault();
      // Synced fields are intentionally untouched here — Moodle wins for those
      if (!synced) {
        p.firstName = firstNameInput.value.trim();
        p.lastName  = lastNameInput.value.trim();
        p.contact   = contactInput.value.trim();
      }
      p.sex = form.elements['sex'].value;
      p.ageRange = form.elements['ageRange'].value;
      p.groupId = groupId;
      await DB.put('participants', p, CURRENT_AUTHOR.id);
      toast(isEdit ? t('p.updated') : t('p.added'));
      go('/groups/' + groupId);
    } }, [
      synced ? el('div', { class: 'synced-banner', html: t('sync.bannerParticipant') }) : null,
      el('p', { class: 'hint' }, t('p.groupLabel', { name: group.name || '—' })),
      el('div', { class: 'row', style: 'gap:12px' }, [
        el('div', { class: 'grow' }, fg(t('common.firstName'), firstNameInput)),
        el('div', { class: 'grow' }, fg(t('common.lastName'),  lastNameInput))
      ]),
      el('div', { class: 'row', style: 'gap:12px' }, [
        el('div', { class: 'grow' }, fg(t('common.sex'), selectEl('sex', SEX_OPTIONS.map((s) => ({ value: s, label: sexLabel(s) })), p.sex))),
        el('div', { class: 'grow' }, fg(t('common.ageRange'), selectEl('ageRange', [{ value: '', label: '—' }].concat(AGE_RANGES.map((a) => ({ value: a, label: a }))), p.ageRange)))
      ]),
      fg(t('common.contact'), contactInput),
      el('button', { class: 'btn btn--block', type: 'submit' }, isEdit ? t('common.save') : t('common.add'))
    ]);
    root.appendChild(form);

    // Synced participants can't be removed from the PWA — unenroll them in Moodle
    // v0.3.5d — participants who were marked PRESENT at any session can't be
    // hard-deleted; they get "Dropped" instead, which preserves history but blocks
    // new sessions. Rows where present=false are just unchecked roster entries
    // — they don't count as "history" worth preserving, so delete is allowed.
    if (isEdit && !synced) {
      const attRecs = await DB.byIndex('attendance', 'participantId', p.id);
      const hasAttendance = attRecs.some((a) => a.present);
      if (p.status === 'dropped') {
        root.appendChild(el('p', { class: 'hint small', style: 'margin:8px 0' }, t('p.droppedHint')));
        root.appendChild(el('button', {
          class: 'btn btn--ghost btn--block', type: 'button',
          onClick: async () => {
            if (!confirm(t('p.reactivateConfirm'))) return;
            p.status = 'active';
            await DB.put('participants', p, CURRENT_AUTHOR.id);
            toast(t('p.reactivated'));
            go('/groups/' + p.groupId);
          }
        }, t('p.reactivateCta')));
      } else if (hasAttendance) {
        // Has attendance — primary action is Drop (keeps history). We also
        // expose a secondary "Delete anyway" with a stronger confirmation
        // so trainers who reactivated a participant (or genuinely want them
        // gone) aren't stuck — they can erase the row + its attendance.
        root.appendChild(el('p', { class: 'hint small', style: 'margin:8px 0' }, t('p.dropHint')));
        root.appendChild(dangerButton(t('p.dropCta'), async () => {
          if (!confirm(t('p.dropConfirm'))) return;
          p.status = 'dropped';
          await DB.put('participants', p, CURRENT_AUTHOR.id);
          toast(t('p.dropped'));
          go('/groups/' + p.groupId);
        }));
        const presentCount = attRecs.filter((a) => a.present).length;
        root.appendChild(el('button', {
          class: 'btn btn--ghost btn--block',
          style: 'margin-top:8px; color:var(--danger); border-color:var(--danger)',
          type: 'button',
          onClick: async () => {
            if (!confirm(t('p.deleteAnywayConfirm', { n: presentCount }))) return;
            for (const a of attRecs) {
              await DB.delete('attendance', a.id);
            }
            await DB.delete('participants', p.id);
            if (window.SYNC) window.SYNC.syncNow().catch(() => {});
            toast(t('p.deleted'));
            go('/groups/' + p.groupId);
          }
        }, t('p.deleteAnywayCta')));
      } else {
        // No attendance counted as "present" — safe to hard-delete. Clean up
        // any unticked attendance rows pointing here so we don't leave orphans.
        root.appendChild(dangerButton(t('common.delete'), async () => {
          if (!confirm(t('p.deleteConfirm'))) return;
          for (const a of attRecs) {
            await DB.delete('attendance', a.id);
          }
          await DB.delete('participants', p.id);
          if (window.SYNC) window.SYNC.syncNow().catch(() => {});
          toast(t('p.deleted'));
          go('/groups/' + p.groupId);
        }));
      }
    }
  }

  // ---------- Sessions list ----------
  async function sessionsListView(_params, root) {
    setTitle(t('sessions.title'));
    const groups = await DB.all('groups');
    // v0.3.5j — "my courses only" filter: hide sessions whose course doesn't
    // list the current user as a facilitator.
    const sessions = applyMySessions(await DB.all('sessions'), groups)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const groupName = (id) => (groups.find((g) => g.id === id) || {}).name || '';
    const attendance = await DB.all('attendance');

    // v0.3.7 — iOS Calls-style action circles under the search pill.
    // Replaces the old soft sync button + "+ New session" link.
    let syncBtnRef = null;
    root.appendChild(actionCircles([
      {
        icon: ACTION_ICONS.sync,
        label: t('actions.eLearning'),
        ref: (n) => { syncBtnRef = n; },
        onClick: async () => {
          if (!navigator.onLine) { toast(t('sync.status.offline')); return; }
          const labelEl = syncBtnRef.querySelector('.action-circle__label');
          const origLabel = labelEl.textContent;
          syncBtnRef.disabled = true;
          labelEl.textContent = t('actions.syncing');
          try {
            const r = await window.API.moodleSync();
            const s = (r && r.summary) || {};
            if (s.skipped) {
              toast(t('sessions.syncSkipped'));
            } else if ((s.errors || []).length) {
              console.warn('Sync errors:', s.errors);
              toast(t('sessions.syncErrors', { n: s.errors.length }));
            } else {
              toast(t('sessions.syncResult', {
                sNew: s.sessions_created || 0,
                pNew: s.participants_created || 0
              }));
            }
            if (window.SYNC) await window.SYNC.syncNow();
            await handleRoute();
          } catch (err) {
            toast(err.message || t('sync.status.error'));
          } finally {
            if (syncBtnRef) {
              labelEl.textContent = origLabel;
              syncBtnRef.disabled = false;
            }
          }
        }
      },
      { icon: ACTION_ICONS.plus, label: t('actions.newSession'), href: '#/sessions/new' }
    ]));

    root.appendChild(el('p', { class: 'muted' }, tn(sessions.length, 'sessions.countOne', 'sessions.countOther')));

    if (!sessions.length) {
      root.appendChild(emptyState(t('sessions.emptyTitle'), t('sessions.emptyBody'), '#/sessions/new', t('sessions.emptyCta')));
      return;
    }

    sessions.forEach((s) => {
      const att = attendance.filter((a) => a.sessionId === s.id);
      const present = att.filter((a) => a.present).length;
      const total = att.length;
      const titleRow = el('div', { class: 'card__title' }, [
        document.createTextNode(s.theme || t('common.noTheme')),
        s.source === 'moodle'
          ? el('span', { class: 'pill pill--moodle', style: 'margin-left:8px;font-size:11px' }, t('sync.pill'))
          : null
      ]);
      root.appendChild(el('a', { class: 'card-link', href: `#/sessions/${s.id}` }, [
        el('div', { class: 'card' }, [
          el('div', { class: 'row between' }, [
            thumbIcon('sessions'),
            el('div', { class: 'grow', style: 'min-width:0' }, [
              titleRow,
              el('div', { class: 'card__sub' }, [formatDate(s.date), groupName(s.groupId), s.location].filter(Boolean).join(' · '))
            ]),
            total > 0
              ? el('span', { class: 'pill pill--success' }, `${present}/${total}`)
              : el('span', { class: 'pill pill--muted' }, '—')
          ])
        ])
      ]));
    });
    attachListSearch(root, { key: 'pwa.sessions' });
  }

  // ---------- Session form ----------
  async function sessionFormView(params, root) {
    const isEdit = !!params.id;
    let session;
    if (isEdit) {
      session = await DB.get('sessions', params.id);
      if (!session) { root.appendChild(notFoundView()); return; }
    } else {
      const q = new URLSearchParams((location.hash.split('?')[1] || ''));
      session = { groupId: q.get('groupId') || '', date: todayInput(), theme: '', location: '', notes: '' };
    }
    setTitle(isEdit ? t('session.editTitle') : t('session.newTitle'));

    const groups = (await DB.all('groups')).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (!groups.length) {
      root.appendChild(el('div', { class: 'card' }, [
        el('h3', null, t('session.noGroupsTitle')),
        el('p', { class: 'muted' }, t('session.noGroupsBody')),
        el('a', { class: 'btn', href: '#/cohorts/new' }, t('session.noGroupsCta'))
      ]));
      return;
    }

    // If this is a Moodle-synced session, the upstream fields are locked. Sex
    // and ageRange-equivalent fields don't apply here; trainers can still edit
    // location and notes (we don't sync those).
    const synced = isEdit && session.source === 'moodle';

    const groupSel = selectEl('groupId', groups.map((g) => ({ value: g.id, label: g.name || t('common.noName') })), session.groupId, true);
    const dateInput = el('input', { name: 'date', type: 'date', required: true, value: session.date || todayInput() });
    const themeInput = el('input', { name: 'theme', type: 'text', required: true, value: session.theme || '', placeholder: t('session.themePh') });
    if (synced) {
      groupSel.disabled = true;
      dateInput.disabled = true;
      themeInput.disabled = true;
    }

    const form = el('form', { class: 'card', onSubmit: async (e) => {
      e.preventDefault();
      // Only update editable fields when synced — keep the upstream values intact
      if (!synced) {
        session.groupId = form.elements['groupId'].value;
        session.date = form.elements['date'].value;
        session.theme = form.elements['theme'].value.trim();
      }
      session.location = form.elements['location'].value.trim();
      session.notes = form.elements['notes'].value.trim();
      await DB.put('sessions', session, CURRENT_AUTHOR.id);
      toast(isEdit ? t('session.updated') : t('session.created'));
      go('/sessions/' + session.id);
    } }, [
      synced ? el('div', { class: 'synced-banner', html: t('sync.bannerSession') }) : null,
      fg(t('session.groupLabel'), groupSel),
      fg(t('common.date'), dateInput),
      fg(t('common.theme'), themeInput),
      fg(t('common.location'), el('input', { name: 'location', type: 'text', value: session.location || '' })),
      fg(t('common.notes'), el('textarea', { name: 'notes' }, session.notes || '')),
      el('button', { class: 'btn btn--block', type: 'submit' }, isEdit ? t('common.save') : t('session.createCta'))
    ]);
    root.appendChild(form);

    // Synced sessions can't be deleted from the PWA — delete the activity in
    // Moodle and the next sync will tombstone it locally.
    if (isEdit && !synced) {
      root.appendChild(dangerButton(t('session.deleteCta'), async () => {
        if (!confirm(t('session.deleteConfirm'))) return;
        const att = await DB.byIndex('attendance', 'sessionId', session.id);
        for (const a of att) await DB.delete('attendance', a.id);
        await DB.delete('sessions', session.id);
        if (window.SYNC) window.SYNC.syncNow().catch(() => {});
        toast(t('session.deleted'));
        go('/sessions');
      }));
    }
  }

  // ---------- Session detail (attendance) ----------
  async function sessionDetailView(params, root) {
    const session = await DB.get('sessions', params.id);
    if (!session) { root.appendChild(notFoundView()); return; }
    // v0.3.5g — remember this session for the dashboard "Resume" tile
    try { localStorage.setItem('ubuntu30.lastSessionId', session.id); } catch (e) {}
    const group = await DB.get('groups', session.groupId);
    setTitle(session.theme || t('session.defaultTitle'));

    // v0.3.5c — show regular course participants + walk-ins added to THIS
    // session. Walk-ins from OTHER sessions are scoped away.
    // v0.3.5d — dropped participants don't appear unless they already have
    // attendance for THIS session (preserves historical roster).
    const attendance = await DB.byIndex('attendance', 'sessionId', session.id);
    const attMap = new Map(attendance.map((a) => [a.participantId, a]));
    const participants = group ? (await DB.byIndex('participants', 'groupId', group.id))
      .filter((p) => !p.walkInSessionId || p.walkInSessionId === session.id)
      .filter((p) => p.status !== 'dropped' || attMap.has(p.id))
      .sort((a, b) => ((a.lastName || '') + (a.firstName || '')).localeCompare((b.lastName || '') + (b.firstName || ''))) : [];

    /**
     * Duplicate this session: same group/theme/location/notes, dated today,
     * source='user' (a fresh trainer-created session, never a Moodle one — the
     * duplicate isn't tied to any upstream activity even if the original was).
     */
    async function duplicateSession() {
      if (!confirm(t('session.duplicateConfirm'))) return;
      const dup = {
        groupId:  session.groupId,
        date:     todayInput(),
        theme:    session.theme  || '',
        location: session.location || '',
        notes:    session.notes  || '',
        source:   'user',
      };
      await DB.put('sessions', dup, CURRENT_AUTHOR.id);
      toast(t('session.duplicated'));
      go('/sessions/' + dup.id + '/edit');
    }

    root.appendChild(el('div', { class: 'card card--accent' }, [
      el('div', { class: 'row between' }, [
        el('div', { class: 'row', style: 'gap:12px; min-width:0' }, [
          thumbIcon('sessions'),
          el('div', { style: 'min-width:0' }, [
            el('div', { class: 'card__title' }, session.theme || t('common.noTheme')),
            el('div', { class: 'card__sub' }, [
              formatDate(session.date),
              group ? group.name : t('session.unknownGroup'),
              session.location
            ].filter(Boolean).join(' · '))
          ])
        ]),
        el('div', { class: 'row', style: 'gap:6px' }, [
          el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onClick: duplicateSession }, t('session.duplicate')),
          el('a', { class: 'btn btn--sm btn--ghost', href: `#/sessions/${session.id}/edit` }, t('common.edit'))
        ])
      ]),
      session.notes ? el('p', { class: 'small', style: 'margin-top:8px; white-space:pre-wrap' }, session.notes) : null
    ]));

    const heading = el('h3', { class: 'section-h' }, [
      el('span', { class: 'section-h__icon', html: THUMB_ICONS.attendance }),
      el('span', { class: 'section-h__text' }, t('session.attendanceHeading', { n: participants.length }))
    ]);
    root.appendChild(heading);

    const presentCountEl = el('p', { class: 'muted small' });
    const updateCount = () => {
      const c = participants.filter((x) => (attMap.get(x.id) || {}).present).length;
      presentCountEl.textContent = tn(c, 'session.presentCountOne', 'session.presentCountOther', { total: participants.length });
    };
    /** Update the heading roster count whenever a walk-in is added. */
    const updateHeading = () => {
      heading.textContent = t('session.attendanceHeading', { n: participants.length });
    };

    // Container we'll append rows into — walk-ins join here without a re-render.
    const attendanceList = el('div');

    /** Render one attendance row (used both for initial render and walk-in additions). */
    function makeAttendanceRow(p) {
      const existing = attMap.get(p.id);
      const checked  = existing ? !!existing.present : false;
      const isWalkIn = !!(existing && existing.walkIn);

      const titleNode = el('div', { class: 'list-item__title' }, [
        document.createTextNode(((p.firstName || '') + ' ' + (p.lastName || '')).trim() || t('common.noName')),
        isWalkIn
          ? el('span', { class: 'pill', style: 'margin-left:8px;font-size:11px;background:#F5DCDD;color:var(--brand-dark)' }, t('session.walkInPill'))
          : null
      ]);

      // Delete button — only on walk-in rows (regular enrolment shouldn't be
      // deletable from a session view; that belongs in the course).
      const deleteBtn = isWalkIn
        ? el('button', {
            class: 'icon-btn', type: 'button',
            'aria-label': t('session.walkInDelete'),
            title: t('session.walkInDelete'),
            style: 'background:transparent;border:0;color:var(--muted);font-size:18px;cursor:pointer;padding:4px 8px;',
            onClick: async () => {
              if (!confirm(t('session.walkInDeleteConfirm'))) return;
              const rec = attMap.get(p.id);
              if (rec) {
                await DB.delete('attendance', rec.id);
                attMap.delete(p.id);
              }
              // Walk-ins are session-local: deleting the attendance also removes
              // the participant. (Walk-ins never have attendance in other sessions.)
              if (p.walkInSessionId === session.id) {
                await DB.delete('participants', p.id);
                const idx = participants.findIndex((x) => x.id === p.id);
                if (idx > -1) participants.splice(idx, 1);
              } else {
                // Defensive fallback for legacy walk-ins flagged before v0.3.5c
                const otherAtt = (await DB.byIndex('attendance', 'participantId', p.id))
                  .filter((a) => a.sessionId !== session.id);
                if (otherAtt.length === 0) {
                  await DB.delete('participants', p.id);
                  const idx = participants.findIndex((x) => x.id === p.id);
                  if (idx > -1) participants.splice(idx, 1);
                }
              }
              // Remove from the DOM
              row.remove();
              updateCount();
              updateHeading();
              if (participants.length === 0) {
                attendanceList.appendChild(el('p', { class: 'muted', id: 'att-empty' }, t('session.noParticipants')));
              }
              if (window.SYNC) window.SYNC.syncNow().catch(() => {});
              toast(t('session.walkInDeleted'));
            }
          }, '×')
        : null;

      const row = el('div', { class: 'att-row' + (isWalkIn ? ' att-row--walkin' : '') }, [
        el('div', { class: 'grow' }, [
          titleNode,
          el('div', { class: 'list-item__sub' }, [sexLabel(p.sex), p.ageRange || ''].filter(Boolean).join(' · '))
        ]),
        deleteBtn,
        el('input', {
          class: 'toggle', type: 'checkbox', checked: checked,
          'aria-label': t('session.presentAria'),
          onChange: async (e) => {
            const present = e.target.checked;
            let rec = attMap.get(p.id);
            if (!rec) rec = { sessionId: session.id, participantId: p.id, present };
            else rec.present = present;
            await DB.put('attendance', rec, CURRENT_AUTHOR.id);
            attMap.set(p.id, rec);
            updateCount();
          }
        })
      ]);
      return row;
    }

    if (!participants.length) {
      attendanceList.appendChild(el('p', { class: 'muted', id: 'att-empty' }, t('session.noParticipants')));
    } else {
      root.appendChild(presentCountEl);
      updateCount();
      participants.forEach((p) => attendanceList.appendChild(makeAttendanceRow(p)));
    }
    root.appendChild(attendanceList);
    // Search bar over the attendance rows — scoped to .att-row so the
    // walk-in picker below stays unfiltered. Skip on empty rosters.
    if (participants.length) {
      attachListSearch(attendanceList, {
        key: 'pwa.session.' + session.id + '.attendance',
        placeholder: t('common.searchPh'),
        itemSelector: '.att-row',
        position: 'beforeItems',
      });
    }

    // ---------- Walk-in attendance (picker-first) ----------
    // v0.3.5a — Trainers and admins both see a searchable picker of users in
    // Ubuntu 3.0. Picking a user marks them present (enrolling them in the
    // course on the fly if they weren't already). A "+ Create new" expander
    // at the bottom handles true first-time walk-ins.
    if (group) {
      const panel  = el('div', { class: 'card', style: 'margin-top:12px', hidden: true });
      const openBtn = el('button', {
        class: 'btn btn--soft btn--block', style: 'margin-top:12px', type: 'button',
        onClick: () => { panel.hidden = false; openBtn.hidden = true; renderWalkInPicker(); }
      }, t('session.walkInCta'));

      /**
       * Mark a user present at this session. If they aren't yet a participant
       * in the course, create the participant row first (linked to the user).
       * Idempotent w.r.t. the attendance row.
       */
      async function markUserPresent(u) {
        // Find existing participant in this course for this user
        let p = participants.find((x) => x.userId === u.id);
        const isNewParticipant = !p;
        if (isNewParticipant) {
          p = {
            userId:    u.id,
            groupId:   group.id,
            firstName: u.firstName || '',
            lastName:  u.lastName  || '',
            sex:       '',
            ageRange:  '',
            contact:   (u.syntheticEmail ? '' : (u.email || '')),
            source:    'user',
            // v0.3.5c — walk-ins are scoped to THIS session only.
            // The course's roster filters them out; only this session shows them.
            walkInSessionId: session.id,
          };
          await DB.put('participants', p, CURRENT_AUTHOR.id);
          participants.push(p);
        }
        // Write the attendance row FIRST so makeAttendanceRow() picks up walkIn
        let rec = attMap.get(p.id);
        if (!rec) {
          rec = { sessionId: session.id, participantId: p.id, present: true, walkIn: true };
          await DB.put('attendance', rec, CURRENT_AUTHOR.id);
          attMap.set(p.id, rec);
        } else if (!rec.present) {
          rec.present = true;
          rec.walkIn  = true;
          await DB.put('attendance', rec, CURRENT_AUTHOR.id);
        }
        // Now render — either append a new row, or swap the existing one so
        // the walk-in pill + delete button show up immediately.
        if (isNewParticipant) {
          const empty = $('#att-empty'); if (empty) empty.remove();
          if (participants.length === 1) root.insertBefore(presentCountEl, attendanceList);
          attendanceList.appendChild(makeAttendanceRow(p));
        } else {
          const oldRows = attendanceList.querySelectorAll('.att-row');
          const idx = participants.findIndex((x) => x.id === p.id);
          if (oldRows[idx]) {
            oldRows[idx].replaceWith(makeAttendanceRow(p));
          }
        }
        updateCount();
        updateHeading();
      }

      function renderWalkInPicker() {
        panel.innerHTML = '';
        panel.appendChild(el('h3', { style: 'margin-top:0' }, t('session.walkInTitle')));
        panel.appendChild(el('p', { class: 'small muted', style: 'margin-top:0' }, t('session.walkInIntro')));

        if (!navigator.onLine) {
          panel.appendChild(el('p', { class: 'muted' }, t('picker.offlineBody')));
          panel.appendChild(el('div', { class: 'row', style: 'margin-top:8px; justify-content:flex-end' },
            el('button', {
              class: 'btn btn--ghost btn--sm', type: 'button',
              onClick: () => { panel.hidden = true; openBtn.hidden = false; }
            }, t('common.cancel'))
          ));
          return;
        }

        const search = el('input', {
          type: 'text', placeholder: t('picker.searchPh'), autocomplete: 'off',
          style: 'width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; font-size:14px; margin-bottom:8px;'
        });
        const status = el('p', { class: 'small muted' }, t('picker.startTyping'));
        const listEl = el('div', { class: 'list' });

        let inflight = null;
        async function runSearch() {
          const q = search.value.trim();
          if (q.length === 0) { status.textContent = t('picker.startTyping'); listEl.innerHTML = ''; return; }
          if (q.length < 2) return;
          status.textContent = t('picker.searching');
          const myReq = (inflight = {});
          try {
            // Pass courseId so the server excludes anyone already enrolled OR
            // dropped from this course. That keeps the toggle list clean and
            // honours the "dropped users can't be re-added" rule.
            const r = await window.API.pickUsers(group.id, q);
            if (myReq !== inflight) return;
            const users = (r && r.users) || [];
            listEl.innerHTML = '';
            if (!users.length) { status.textContent = t('picker.noMatch'); return; }
            status.textContent = tn(users.length, 'picker.foundOne', 'picker.foundOther');
            users.forEach((u) => {
              const alreadyInCourse = participants.some((p) => p.userId === u.id);
              listEl.appendChild(el('button', {
                class: 'list-item', type: 'button',
                onClick: async () => {
                  await markUserPresent(u);
                  toast(t('session.pickListAdded', { name: ((u.firstName || '') + ' ' + (u.lastName || '')).trim() }));
                  renderWalkInPicker();
                }
              }, [
                el('div', { class: 'grow' }, [
                  el('div', { class: 'list-item__title' }, ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || t('common.noName')),
                  el('div', { class: 'list-item__sub' }, [
                    u.syntheticEmail ? null : u.email,
                    u.role === 'admin' ? t('picker.roleAdmin') : (u.role === 'trainer' ? t('picker.roleTrainer') : t('picker.roleTrainee')),
                    alreadyInCourse ? t('picker.inCourse') : null
                  ].filter(Boolean).join(' · '))
                ])
              ]));
            });
          } catch (err) {
            if (myReq !== inflight) return;
            console.error('[ubuntu30 walk-in picker] failed', err);
            status.textContent = t('picker.error') + ' (' + (err && (err.status || err.code) || 'unknown') + ': ' + (err && err.message || 'no message') + ')';
          }
        }
        let dbTimer = null;
        search.addEventListener('input', () => { clearTimeout(dbTimer); dbTimer = setTimeout(runSearch, 250); });
        setTimeout(() => search.focus(), 0);

        panel.appendChild(search);
        panel.appendChild(status);
        panel.appendChild(listEl);

        // "+ Create new" — works for trainer AND admin on a session.
        const newBtn = el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          style: 'margin-top:10px'
        }, t('picker.createNewCta'));
        const newForm = el('form', {
          style: 'margin-top:10px', hidden: true,
          onSubmit: async (e) => {
            e.preventDefault();
            const firstName = newForm.elements['firstName'].value.trim();
            const lastName  = newForm.elements['lastName'].value.trim();
            const email     = newForm.elements['email'].value.trim();
            const phone     = newForm.elements['phone'].value.trim();
            const sex       = newForm.elements['sex'].value;
            const ageRange  = newForm.elements['ageRange'].value;
            if (!firstName) return;
            const submit = newForm.querySelector('button[type=submit]');
            submit.disabled = true;
            try {
              const r = await window.API.createUser({
                firstName, lastName: lastName || firstName,
                email, phone, sex, ageRange,
                role: 'trainee', sendInvite: false,
              });
              await markUserPresent({
                id: r.user.id,
                firstName: r.user.firstName,
                lastName:  r.user.lastName,
                email:     r.user.email,
                syntheticEmail: !email,
              });
              toast(t('session.walkInAdded'));
              renderWalkInPicker();   // refresh
            } catch (err) {
              toast(err.message || t('common.error'));
              submit.disabled = false;
            }
          }
        }, [
          el('div', { class: 'row', style: 'gap:12px' }, [
            el('div', { class: 'grow' }, fg(t('common.firstName'), el('input', { name: 'firstName', type: 'text', required: true, autocomplete: 'given-name' }))),
            el('div', { class: 'grow' }, fg(t('common.lastName'),  el('input', { name: 'lastName',  type: 'text', autocomplete: 'family-name' })))
          ]),
          fg(t('common.email'), el('input', { name: 'email', type: 'email', autocomplete: 'email', placeholder: t('common.emailPh') })),
          fg(t('common.phone'), el('input', { name: 'phone', type: 'tel',   autocomplete: 'tel',   placeholder: '+257…' })),
          el('div', { class: 'row', style: 'gap:12px' }, [
            el('div', { class: 'grow' }, fg(t('common.sex'), selectEl('sex', [{ value: '', label: '—' }].concat(SEX_OPTIONS.map((s) => ({ value: s, label: sexLabel(s) }))), ''))),
            el('div', { class: 'grow' }, fg(t('common.ageRange'), selectEl('ageRange', [{ value: '', label: '—' }].concat(AGE_RANGES.map((a) => ({ value: a, label: a }))), '')))
          ]),
          el('div', { class: 'row', style: 'gap:8px' }, [
            el('button', { class: 'btn btn--sm', type: 'submit' }, t('session.walkInSave')),
            el('button', {
              class: 'btn btn--ghost btn--sm', type: 'button',
              onClick: () => { newForm.reset(); newForm.hidden = true; newBtn.hidden = false; }
            }, t('session.walkInCancel'))
          ])
        ]);
        newBtn.addEventListener('click', () => {
          newForm.hidden = false; newBtn.hidden = true;
          const fn = newForm.elements['firstName']; if (fn) fn.focus();
        });
        panel.appendChild(newBtn);
        panel.appendChild(newForm);

        // Done
        panel.appendChild(el('div', { class: 'row', style: 'margin-top:14px; justify-content:flex-end' },
          el('button', {
            class: 'btn btn--ghost btn--sm', type: 'button',
            onClick: () => { panel.hidden = true; openBtn.hidden = false; }
          }, t('session.pickListDone'))
        ));
      }

      root.appendChild(openBtn);
      root.appendChild(panel);
    }

    // Link back to the parent Course
    if (group) {
      const label = group.name
        ? t('session.viewCourseCta', { name: group.name })
        : t('session.viewCourseCtaNoName');
      root.appendChild(el('a', {
        class: 'btn btn--ghost btn--block', style: 'margin-top:12px',
        href: `#/groups/${group.id}`
      }, label));
    }

    root.appendChild(el('a', {
      class: 'btn btn--soft btn--block', style: 'margin-top:12px',
      href: `#/stories/new?sessionId=${session.id}`
    }, t('session.addStoryCta')));
  }

  // ---------- Stories list ----------
  async function storiesListView(_params, root) {
    setTitle(t('stories.title'));
    const stories = (await DB.all('stories'))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    root.appendChild(actionCircles([
      { icon: ACTION_ICONS.plus, label: t('actions.newStory'), href: '#/stories/new' }
    ]));
    root.appendChild(el('p', { class: 'muted' }, tn(stories.length, 'stories.countOne', 'stories.countOther')));

    if (!stories.length) {
      root.appendChild(emptyState(t('stories.emptyTitle'), t('stories.emptyBody'), '#/stories/new', t('stories.emptyCta')));
      return;
    }

    const sessions = await DB.all('sessions');
    const participants = await DB.all('participants');

    stories.forEach((s) => {
      const tag = s.sessionId ? ((sessions.find((x) => x.id === s.sessionId) || {}).theme || t('stories.tag.session'))
        : s.participantId ? ((participants.find((x) => x.id === s.participantId) || {}).firstName || t('stories.tag.participant'))
        : t('stories.tag.free');
      root.appendChild(el('a', { class: 'card-link', href: `#/stories/${s.id}/edit` }, [
        el('div', { class: 'list-item' }, [
          storyThumb(s),
          el('div', { class: 'grow' }, [
            el('div', { class: 'list-item__title' }, (() => {
              const plain = stripHtml(s.text || '');
              return plain ? (plain.length > 60 ? plain.slice(0, 60) + '…' : plain) : t('common.noText');
            })()),
            el('div', { class: 'list-item__sub' }, [tag, formatDate(s.updatedAt), s.consent ? t('stories.hasConsent') : t('stories.noConsent')].filter(Boolean).join(' · '))
          ])
        ])
      ]));
    });
    attachListSearch(root, { key: 'pwa.stories' });
  }

  // ---------- Reports (PWA, trainer-focused) ----------
  // Two cards: data-quality alerts (participants missing sex/age) and
  // a publish digest (stories opted-in for the public news feed). Both
  // honour the dashboard's myCoursesOnly filter so trainers see "their"
  // numbers first; admins can flip the filter off in Settings.
  async function reportsView(_params, root) {
    setTitle(t('reports.title'));

    const allGroups = await DB.all('groups');
    const groups = applyMyCourses(allGroups);
    const myGroupIds = new Set(groups.map((g) => g.id));
    const groupName = (id) => (allGroups.find((g) => g.id === id) || {}).name || '';

    // ----- Card 1: participants with missing demographics -----
    // Walk-ins are session-scoped data points, not enrolees — exclude
    // them so we don't badger trainers about walk-in records they may
    // never see again.
    const participants = (await DB.all('participants'))
      .filter((p) => !p.walkInSessionId)
      .filter((p) => myGroupIds.has(p.groupId))
      .filter((p) => p.status !== 'dropped')
      .filter((p) => !p.sex || !p.ageRange)
      .sort((a, b) => ((a.lastName || '') + (a.firstName || '')).localeCompare((b.lastName || '') + (b.firstName || '')));

    const missingCard = el('div', { class: 'card card--accent' }, [
      el('div', { class: 'row', style: 'gap:12px; align-items:flex-start' }, [
        el('div', { class: 'thumb thumb--icon', html: THUMB_ICONS.warning }),
        el('div', { class: 'grow', style: 'min-width:0' }, [
          el('div', { class: 'card__title' }, t('reports.missingTitle')),
          el('div', { class: 'card__sub' }, tn(participants.length, 'reports.missingCountOne', 'reports.missingCountOther'))
        ])
      ])
    ]);
    root.appendChild(missingCard);

    if (participants.length) {
      participants.forEach((p) => {
        const missing = [
          !p.sex      ? t('common.sex')      : null,
          !p.ageRange ? t('common.ageRange') : null
        ].filter(Boolean).join(' · ');
        const title = el('div', { class: 'list-item__title' }, [
          document.createTextNode(((p.firstName || '') + ' ' + (p.lastName || '')).trim() || t('common.noName')),
          p.source === 'moodle'
            ? el('span', { class: 'pill pill--moodle', style: 'margin-left:8px;font-size:11px' }, t('sync.pill'))
            : null
        ]);
        root.appendChild(el('a', { class: 'card-link', href: `#/participants/${p.id}/edit` }, [
          el('div', { class: 'list-item' }, [
            thumbIcon('participants'),
            el('div', { class: 'grow' }, [
              title,
              el('div', { class: 'list-item__sub' }, [groupName(p.groupId), t('reports.missingFields', { fields: missing })].filter(Boolean).join(' · '))
            ])
          ])
        ]));
      });
    } else {
      root.appendChild(el('p', { class: 'muted small', style: 'margin-top:-4px' }, t('reports.missingNone')));
    }

    // ----- Card 2: stories that ship to the public feed -----
    // publishable=true implies consent=true (the story form forces that),
    // so we don't double-check consent here. We do scope by course when
    // the story has a session; orphan/no-session stories are always shown
    // because there's no other natural place for the trainer to find them.
    const sessions = await DB.all('sessions');
    const sessionGroupOf = (sid) => (sessions.find((s) => s.id === sid) || {}).groupId || null;
    const stories = (await DB.all('stories'))
      .filter((s) => !!s.publishable)
      .filter((s) => {
        if (!s.sessionId) return true;             // free-form story → keep
        const gid = sessionGroupOf(s.sessionId);
        return !gid || myGroupIds.has(gid);        // unknown course → keep, mine → keep
      })
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    root.appendChild(el('div', { style: 'height:14px' }));

    const publishCard = el('div', { class: 'card card--accent' }, [
      el('div', { class: 'row', style: 'gap:12px; align-items:flex-start' }, [
        el('div', { class: 'thumb thumb--icon', html: THUMB_ICONS.publish }),
        el('div', { class: 'grow', style: 'min-width:0' }, [
          el('div', { class: 'card__title' }, t('reports.publishedTitle')),
          el('div', { class: 'card__sub' }, tn(stories.length, 'reports.publishedCountOne', 'reports.publishedCountOther'))
        ])
      ])
    ]);
    root.appendChild(publishCard);

    if (stories.length) {
      stories.forEach((s) => {
        root.appendChild(el('a', { class: 'card-link', href: `#/stories/${s.id}/edit` }, [
          el('div', { class: 'list-item' }, [
            storyThumb(s),
            el('div', { class: 'grow' }, [
              el('div', { class: 'list-item__title' }, (() => {
                const plain = stripHtml(s.text || '');
                return plain ? (plain.length > 60 ? plain.slice(0, 60) + '…' : plain) : t('common.noText');
              })()),
              el('div', { class: 'list-item__sub' }, [
                s.sessionId ? groupName(sessionGroupOf(s.sessionId)) : null,
                formatDate(s.updatedAt)
              ].filter(Boolean).join(' · '))
            ])
          ])
        ]));
      });
    } else {
      root.appendChild(el('p', { class: 'muted small', style: 'margin-top:-4px' }, t('reports.publishedNone')));
    }
  }

  // ---------- Story form ----------
  let _recorder = null;
  let _recordedChunks = [];
  async function storyFormView(params, root) {
    const isEdit = !!params.id;
    let story;
    if (isEdit) {
      story = await DB.get('stories', params.id);
      if (!story) { root.appendChild(notFoundView()); return; }
      // v0.3.5g — remember this story for the dashboard "Resume" tile
      try { localStorage.setItem('ubuntu30.lastStoryId', story.id); } catch (e) {}
    } else {
      const q = new URLSearchParams(location.hash.split('?')[1] || '');
      story = {
        text: '',
        sessionId: q.get('sessionId') || null,
        participantId: q.get('participantId') || null,
        photo: null, audio: null, consent: false
      };
    }
    setTitle(isEdit ? t('story.editTitle') : t('story.newTitle'));

    const sessions = (await DB.all('sessions')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const participants = await DB.all('participants');

    let photoBlob = story.photo;
    let audioBlob = story.audio;
    const _origPhoto = story.photo;
    const _origAudio = story.audio;

    const photoPreview = el('div', { class: 'thumb', style: 'width:80px; height:80px' });
    function renderPhotoPreview() {
      photoPreview.innerHTML = '';
      if (photoBlob) {
        const img = el('img', { alt: '' });
        img.src = URL.createObjectURL(photoBlob);
        photoPreview.appendChild(img);
      } else {
        photoPreview.textContent = t('story.noPhoto');
      }
    }
    renderPhotoPreview();

    const audioInfo = el('span', { class: 'small muted' }, audioBlob ? t('story.audioRecorded', { size: Math.round(audioBlob.size / 1024) }) : t('story.noAudio'));
    const recordBtn = el('button', { type: 'button', class: 'btn btn--sm btn--soft' }, t('story.recordAudio'));
    const stopBtn = el('button', { type: 'button', class: 'btn btn--sm btn--ghost', hidden: true }, t('story.stop'));
    const clearAudioBtn = el('button', { type: 'button', class: 'btn btn--sm btn--ghost' }, t('common.delete'));

    recordBtn.addEventListener('click', async () => {
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        toast(t('story.audioUnsupported'));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _recordedChunks = [];
        _recorder = new MediaRecorder(stream);
        _recorder.ondataavailable = (e) => { if (e.data && e.data.size) _recordedChunks.push(e.data); };
        _recorder.onstop = () => {
          audioBlob = new Blob(_recordedChunks, { type: _recorder.mimeType || 'audio/webm' });
          stream.getTracks().forEach((tr) => tr.stop());
          audioInfo.textContent = t('story.audioRecorded', { size: Math.round(audioBlob.size / 1024) });
          recordBtn.hidden = false;
          stopBtn.hidden = true;
        };
        _recorder.start();
        recordBtn.hidden = true;
        stopBtn.hidden = false;
        toast(t('story.recording'));
      } catch (err) {
        toast(t('story.micUnavailable', { err: err.message || err }));
      }
    });
    stopBtn.addEventListener('click', () => { if (_recorder && _recorder.state === 'recording') _recorder.stop(); });
    clearAudioBtn.addEventListener('click', () => { audioBlob = null; audioInfo.textContent = t('story.noAudio'); });

    // The Publish-to-public checkbox is tied to consent: if consent goes off,
    // publishable goes off and the box is greyed. Trainers must opt-in twice.
    const consentInput = el('input', { type: 'checkbox', name: 'consent', checked: !!story.consent });
    const publishableInput = el('input', { type: 'checkbox', name: 'publishable', checked: !!story.publishable });
    if (!consentInput.checked) { publishableInput.checked = false; publishableInput.disabled = true; }
    consentInput.addEventListener('change', () => {
      if (consentInput.checked) {
        publishableInput.disabled = false;
      } else {
        publishableInput.checked = false;
        publishableInput.disabled = true;
      }
    });

    // v0.3.7 — long story text is now rich-text. Stores HTML in story.text.
    const rtEditor = buildRichTextEditor(story.text || '', { placeholder: t('story.textPh') });

    const form = el('form', { class: 'card', onSubmit: async (e) => {
      e.preventDefault();
      story.text = rtEditor.getHtml();
      story.sessionId = form.elements['sessionId'].value || null;
      story.participantId = form.elements['participantId'].value || null;
      story.consent = consentInput.checked;
      story.publishable = story.consent && publishableInput.checked;
      story.photo = story.consent ? photoBlob : null;
      story.audio = story.consent ? audioBlob : null;
      if (!story.text && !story.photo && !story.audio) {
        toast(t('story.empty'));
        return;
      }
      // Mark for re-upload if the blob changed
      if (story.photo && story.photo !== _origPhoto) story.photoUploaded = false;
      if (story.audio && story.audio !== _origAudio) story.audioUploaded = false;
      // Surface to server-visible flags
      story.hasPhoto = !!story.photo;
      story.hasAudio = !!story.audio;
      await DB.put('stories', story, CURRENT_AUTHOR.id);
      toast(isEdit ? t('story.updated') : t('story.created'));
      // Kick off a background sync (uploads media)
      if (window.SYNC) window.SYNC.syncNow().catch(() => {});
      go('/stories');
    } }, [
      fg(t('story.textLabel'), rtEditor.wrapper),
      fg(t('story.photoLabel'), el('div', { class: 'row', style: 'gap:12px; align-items:center' }, [
        photoPreview,
        el('label', { class: 'btn btn--sm btn--soft' }, [
          t('story.takePhoto'),
          el('input', {
            type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none',
            onChange: (e) => {
              const f = e.target.files && e.target.files[0];
              if (f) { photoBlob = f; renderPhotoPreview(); }
            }
          })
        ]),
        photoBlob ? el('button', {
          type: 'button', class: 'btn btn--sm btn--ghost',
          onClick: () => { photoBlob = null; renderPhotoPreview(); }
        }, t('common.delete')) : null
      ])),
      fg(t('story.audioLabel'), el('div', { class: 'row', style: 'gap:8px; flex-wrap:wrap; align-items:center' }, [
        audioInfo,
        recordBtn,
        stopBtn,
        el('label', { class: 'btn btn--sm btn--ghost' }, [
          t('story.audioFile'),
          el('input', {
            type: 'file', accept: 'audio/*', style: 'display:none',
            onChange: (e) => {
              const f = e.target.files && e.target.files[0];
              if (f) { audioBlob = f; audioInfo.textContent = t('story.audioLoaded', { size: Math.round(f.size / 1024) }); }
            }
          })
        ]),
        audioBlob ? clearAudioBtn : null
      ])),
      fg(t('story.sessionLink'), selectEl('sessionId',
        [{ value: '', label: '—' }].concat(sessions.map((s) => ({ value: s.id, label: (s.theme || '?') + ' — ' + formatDate(s.date) }))),
        story.sessionId)),
      fg(t('story.participantLink'), selectEl('participantId',
        [{ value: '', label: '—' }].concat(participants.map((p) => ({ value: p.id, label: ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || '?' }))),
        story.participantId)),
      el('div', { class: 'form-group' }, el('label', { class: 'checkbox' }, [
        consentInput,
        el('span', null, t('story.consentLabel'))
      ])),
      el('p', { class: 'hint' }, t('story.consentHint')),
      el('div', { class: 'form-group' }, el('label', { class: 'checkbox' }, [
        publishableInput,
        el('span', null, t('story.publishableLabel'))
      ])),
      el('p', { class: 'hint' }, t('story.publishableHint')),
      el('button', { class: 'btn btn--block', type: 'submit' }, isEdit ? t('common.save') : t('story.saveCta'))
    ]);
    root.appendChild(form);

    if (isEdit) {
      root.appendChild(dangerButton(t('story.deleteCta'), async () => {
        if (!confirm(t('story.deleteConfirm'))) return;
        await DB.delete('stories', story.id);
        if (window.SYNC) window.SYNC.syncNow().catch(() => {});
        toast(t('story.deleted'));
        go('/stories');
      }));
    }
  }

  // ============================================================
  //  Settings (per-device preferences, persisted in localStorage)
  // ============================================================
  // SETTINGS exposes a small read/write API used by views that need to
  // honour user preferences. Storage shape (JSON under 'ubuntu30.settings'):
  //   { dash: { showKpi: bool, showActions: bool, tiles: string[] } }
  // Anything missing falls back to defaults defined here.
  const SETTINGS = (() => {
    const KEY = 'ubuntu30.settings';
    const ALL_DASH_TILES = ['sessionsMonth', 'stories', 'groups', 'participants', 'cohorts'];
    // Default visible tiles + order. Cohorts intentionally OFF — they're
    // navigational scaffolding, not a headline metric. Participants is now
    // optionally exposed (off by default) — count honours 'my courses only',
    // so trainers see the size of their cohort at a glance when they want
    // to.
    const DEFAULT_TILES = ['sessionsMonth', 'stories', 'groups'];

    function read() {
      try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
      catch (e) { return {}; }
    }
    function write(s) {
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    }
    function dashCfg(s) {
      const d = (s && s.dash) || {};
      let tiles = Array.isArray(d.tiles) ? d.tiles.filter((k) => ALL_DASH_TILES.includes(k)) : null;
      if (!tiles) tiles = DEFAULT_TILES.slice();
      // myCoursesOnly: limit dashboard + Courses + Sessions to courses where
      // the current user is a facilitator. Default ON so trainers see "their"
      // data first. Uncheck to see everything across the org.
      const myOnly = (d.myCoursesOnly === undefined) ? true : !!d.myCoursesOnly;
      return {
        showKpi:     !!d.showKpi,      // default OFF
        showActions: !!d.showActions,  // default OFF
        myCoursesOnly: myOnly,
        tiles
      };
    }
    // v0.3.7 — Chrome (header/tab-bar) preferences. Right now the only
    // knob is whether the Cohorts tab appears in the bottom bar.
    // Default OFF for trainers (cohorts are a planning view they rarely
    // touch in the field) and ON for admins. Stored alongside dash to
    // keep one localStorage key.
    function chromeCfg(s) {
      const c = (s && s.chrome) || {};
      const role = (window.CURRENT_AUTHOR && window.CURRENT_AUTHOR.role)
                || (typeof CURRENT_AUTHOR !== 'undefined' && CURRENT_AUTHOR && CURRENT_AUTHOR.role)
                || 'trainer';
      const defaultShow = (role === 'admin');
      const show = (c.showCohortsTab === undefined) ? defaultShow : !!c.showCohortsTab;
      return { showCohortsTab: show };
    }
    return { read, write, dashCfg, chromeCfg, ALL_DASH_TILES, DEFAULT_TILES };
  })();

  // Hide or reveal the Cohorts tab according to the chrome setting.
  // Called from applyStaticLabels (initial load + lang change + settings
  // save), so it's the single point where the bottom bar reflows.
  function applyTabVisibility() {
    const cfg = SETTINGS.chromeCfg(SETTINGS.read());
    const cohortTab = document.querySelector('.tab[data-tab="cohorts"]');
    if (cohortTab) cohortTab.hidden = !cfg.showCohortsTab;
    // Reflow the grid so the remaining tabs split the bar evenly
    // instead of leaving a blank column where Cohorts used to sit.
    const bar = document.querySelector('.tabbar');
    if (bar) {
      const visible = Array.from(bar.querySelectorAll('.tab')).filter((t) => !t.hidden).length;
      bar.style.gridTemplateColumns = 'repeat(' + Math.max(visible, 1) + ', 1fr)';
    }
  }

  // -------- "My courses" filtering helpers --------
  // The Courses tile, Sessions tile, Courses list and Sessions list can all
  // optionally hide rows that don't involve the current user as a facilitator.
  // Controlled by the SETTINGS toggle myCoursesOnly. When OFF (or when we
  // can't identify the user), these are pass-through no-ops.
  function myCoursesFilterOn() {
    const cfg = SETTINGS.dashCfg(SETTINGS.read());
    return !!cfg.myCoursesOnly;
  }
  function isMyCourse(g) {
    if (!CURRENT_AUTHOR || !CURRENT_AUTHOR.id) return true;
    return Array.isArray(g && g.facilitatorIds)
      ? g.facilitatorIds.indexOf(CURRENT_AUTHOR.id) !== -1
      : false;
  }
  function applyMyCourses(groups) {
    if (!myCoursesFilterOn()) return groups;
    return (groups || []).filter(isMyCourse);
  }
  function applyMySessions(sessions, groups) {
    if (!myCoursesFilterOn()) return sessions;
    const mine = new Set((groups || []).filter(isMyCourse).map((g) => g.id));
    return (sessions || []).filter((s) => mine.has(s.groupId));
  }

  // ---------- Settings popup ----------
  // A centred dialog on desktop, a bottom sheet on phones (driven by CSS).
  // Changes are saved immediately to localStorage; we re-render the popup
  // body in place so the user sees the new state without flicker. On close
  // we re-render the underlying dashboard (if that's what's behind it) so
  // any KPI/tile/visibility change takes effect right away.
  function openSettingsPopup() {
    // Idempotency: if a popup is already up, do nothing.
    if (document.getElementById('settings-popup')) return;

    function close() {
      bg.remove();
      document.removeEventListener('keydown', onKey);
      // Refresh the underlying view so layout choices apply immediately
      handleRoute();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    const bg = el('div', {
      class: 'popup-bg', id: 'settings-popup',
      onClick: (e) => { if (e.target === bg) close(); }
    });

    const body = el('div', { class: 'popup__body' });
    const head = el('div', { class: 'popup__head' }, [
      el('h3', { class: 'popup__title' }, t('settings.title')),
      el('button', { class: 'popup__close', type: 'button', 'aria-label': t('common.cancel') || 'Close', onClick: close }, '×')
    ]);
    const sheet = el('div', { class: 'popup', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('settings.title') }, [head, body]);
    bg.appendChild(sheet);

    function render() {
      body.innerHTML = '';
      const settings = SETTINGS.read();
      const dash = SETTINGS.dashCfg(settings);
      const chrome = SETTINGS.chromeCfg(settings);

      function save(partial) {
        const next = Object.assign({}, settings, { dash: Object.assign({}, dash, partial) });
        SETTINGS.write(next);
        render();   // re-render popup body only — no full route navigation
      }
      function saveChrome(partial) {
        const next = Object.assign({}, settings, { chrome: Object.assign({}, chrome, partial) });
        SETTINGS.write(next);
        applyTabVisibility();
        render();
      }

      // ----- Dashboard section -----
      const section = el('div', { class: 'popup__section' }, [
        el('p', { class: 'small muted', style: 'margin:0 0 8px' }, t('settings.dashIntro')),

        // KPI + Quick Actions
        el('h4', null, t('settings.dashboard')),
        (() => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = dash.myCoursesOnly;
          cb.addEventListener('change', () => save({ myCoursesOnly: cb.checked }));
          return el('label', { class: 'popup__row' }, [cb, el('span', null, t('settings.myCoursesOnly'))]);
        })(),
        (() => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = dash.showKpi;
          cb.addEventListener('change', () => save({ showKpi: cb.checked }));
          return el('label', { class: 'popup__row' }, [cb, el('span', null, t('settings.showKpi'))]);
        })(),
        (() => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = dash.showActions;
          cb.addEventListener('change', () => save({ showActions: cb.checked }));
          return el('label', { class: 'popup__row' }, [cb, el('span', null, t('settings.showActions'))]);
        })(),

        el('div', { style: 'height:6px' }),
        el('h4', null, t('settings.tilesTitle')),
        el('div', null, SETTINGS.ALL_DASH_TILES.map((key) => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = dash.tiles.includes(key);
          cb.addEventListener('change', () => {
            const set = new Set(dash.tiles);
            if (cb.checked) set.add(key); else set.delete(key);
            // Preserve canonical order for stability
            const next = SETTINGS.ALL_DASH_TILES.filter((k) => set.has(k));
            save({ tiles: next });
          });
          const labelKey = key === 'sessionsMonth' ? 'dash.tile.sessionsMonth'
                         : key === 'stories'       ? 'dash.tile.stories'
                         : key === 'groups'        ? 'dash.tile.groups'
                         : key === 'participants'  ? 'dash.tile.participants'
                         : /* cohorts */             'dash.tile.cohorts';
          return el('label', { class: 'popup__row' }, [cb, el('span', null, t(labelKey))]);
        }))
      ]);
      body.appendChild(section);

      // ----- Navigation section -----
      // Right now there's only one toggle (Cohorts tab) but the
      // section is structured to host more bottom-bar prefs later.
      const navSection = el('div', { class: 'popup__section' }, [
        el('h4', null, t('settings.nav')),
        (() => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = chrome.showCohortsTab;
          cb.addEventListener('change', () => saveChrome({ showCohortsTab: cb.checked }));
          return el('label', { class: 'popup__row' }, [cb, el('span', null, t('settings.showCohortsTab'))]);
        })()
      ]);
      body.appendChild(navSection);
    }

    render();
    document.body.appendChild(bg);
    document.addEventListener('keydown', onKey);
  }
  // Expose so wireSyncIndicator/applyStaticLabels (or any other chrome code)
  // can wire it up to the header gear button.
  window.openSettingsPopup = openSettingsPopup;

  // ---------- More: account, sync, settings, export ----------
  async function moreView(_params, root) {
    setTitle(t('more.title'));

    // Settings — top of the More tab so it's the first thing trainers
    // reach for. Tapping the button opens the same popup the header
    // gear used to open before v0.3.7.
    root.appendChild(el('div', { class: 'card' }, [
      el('h3', null, t('settings.title')),
      el('p', { class: 'small muted', style: 'margin-top:0' }, t('more.settingsNote')),
      el('button', {
        class: 'btn btn--sm btn--ghost', type: 'button',
        onClick: () => openSettingsPopup()
      }, t('more.openSettings'))
    ]));

    // Account (v0.2)
    if (window.API && window.API.isAuthenticated()) {
      const apiUser = window.API.getUser() || {};
      const roleLabel = apiUser.role === 'admin' ? t('auth.role.admin') : t('auth.role.trainer');
      root.appendChild(el('div', { class: 'card' }, [
        el('h3', null, t('auth.account')),
        el('p', { class: 'small muted' }, t('auth.signedInAs', { name: CURRENT_AUTHOR.name || apiUser.email || '' })),
        el('p', { class: 'small muted' }, [apiUser.email, ' · ', roleLabel].join('')),
        el('div', { class: 'row', style: 'flex-wrap:wrap; gap:8px; margin-top:8px' }, [
          el('a', { class: 'btn btn--sm btn--ghost', href: '#/change-password' }, t('auth.changePwCta')),
          el('button', {
            class: 'btn btn--sm btn--ghost',
            style: 'color:var(--danger); border-color:var(--danger)',
            onClick: async () => {
              await window.API.logout();
              toast(t('auth.loggedOut'));
              go('/login');
            }
          }, t('auth.logout'))
        ])
      ]));

      // Sync
      const syncStatusEl = el('p', { class: 'small muted' });
      const lastSyncEl = el('p', { class: 'small muted' });
      async function refreshSyncCard() {
        const s = await window.SYNC.getState();
        const status = (s && s.status) || 'idle';
        const map = {
          idle: t('sync.status.idle'),
          syncing: t('sync.status.syncing'),
          offline: t('sync.status.offline'),
          error: t('sync.status.error')
        };
        syncStatusEl.textContent = map[status] || map.idle;
        lastSyncEl.textContent = s && s.lastSync
          ? t('sync.last', { time: new Date(s.lastSync).toLocaleString(window.I18N.dateLocale()) })
          : t('sync.never');
      }
      root.appendChild(el('div', { class: 'card' }, [
        el('h3', null, t('sync.title')),
        syncStatusEl,
        lastSyncEl,
        el('div', { class: 'row', style: 'flex-wrap:wrap; gap:8px; margin-top:8px' }, [
          el('button', {
            class: 'btn btn--sm',
            onClick: async () => {
              const r = await window.SYNC.syncNow();
              await refreshSyncCard();
              if (r && r.ok) toast(r.pushed ? t('sync.pushed', { n: r.pushed }) : t('sync.status.idle'));
            }
          }, t('sync.now')),
          el('button', {
            class: 'btn btn--sm btn--ghost',
            onClick: async () => {
              if (!navigator.onLine) { toast(t('sync.status.offline')); return; }
              const r = await window.SYNC.syncMediaOnly();
              if (r.ok) {
                toast(t('sync.media.result', { up: r.uploaded || 0, down: r.downloaded || 0 }));
              } else {
                toast(t('sync.status.error'));
              }
            }
          }, t('sync.media.now'))
        ]),
        el('p', { class: 'small muted', style: 'margin-top:8px' }, t('sync.note'))
      ]));
      refreshSyncCard();
    }

    // Language
    const langs = window.I18N.languages();
    root.appendChild(el('div', { class: 'card' }, [
      el('h3', null, t('common.language')),
      el('p', { class: 'muted small' }, t('more.langNote')),
      fg(t('common.language'), selectEl('lang', langs.map((l) => ({ value: l.code, label: l.label })), CURRENT_AUTHOR.lang, true, async (e) => {
        await saveProfileLang(e.target.value);
        await handleRoute();
      }))
    ]));

    // Profile
    root.appendChild(el('div', { class: 'card' }, [
      el('h3', null, t('more.profile')),
      el('p', { class: 'muted small' }, t('more.profileNote')),
      fg(t('common.name'), el('input', { id: 'profile-name', type: 'text', value: CURRENT_AUTHOR.name || '' })),
      el('button', {
        class: 'btn btn--sm',
        onClick: async () => {
          const v = $('#profile-name').value.trim();
          if (!v) { toast(t('more.nameRequired')); return; }
          await saveProfileName(v);
          toast(t('toast.profileSaved'));
        }
      }, t('common.save'))
    ]));

    // Export
    root.appendChild(el('div', { class: 'card' }, [
      el('h3', null, t('more.export')),
      el('p', { class: 'muted small' }, t('more.exportNote')),
      el('div', { class: 'row', style: 'flex-wrap:wrap; gap:8px' }, [
        el('button', { class: 'btn btn--soft btn--sm', onClick: () => exportCsv('cohorts') }, t('more.exportCohorts')),
        el('button', { class: 'btn btn--soft btn--sm', onClick: () => exportCsv('groups') }, t('more.exportGroups')),
        el('button', { class: 'btn btn--soft btn--sm', onClick: () => exportCsv('participants') }, t('more.exportParticipants')),
        el('button', { class: 'btn btn--soft btn--sm', onClick: () => exportCsv('sessions') }, t('more.exportSessions')),
        el('button', { class: 'btn btn--soft btn--sm', onClick: () => exportCsv('attendance') }, t('more.exportAttendance')),
        el('button', { class: 'btn btn--soft btn--sm', onClick: () => exportCsv('stories') }, t('more.exportStories'))
      ]),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn btn--block', onClick: exportAllJson }, t('more.exportJson'))
    ]));

    // External links
    root.appendChild(el('div', { class: 'card' }, [
      el('h3', null, t('more.external')),
      el('p', { class: 'muted small' }, t('more.moodleNote')),
      el('a', {
        class: 'btn btn--soft btn--block',
        href: 'https://learn.academyubuntu.com',
        target: '_blank',
        rel: 'noopener noreferrer'
      }, t('more.moodleLink'))
    ]));

    // Server URL (advanced)
    root.appendChild(el('div', { class: 'card' }, [
      el('h3', null, t('auth.serverUrl')),
      el('p', { class: 'small muted' }, t('auth.serverUrlHint')),
      fg(t('auth.serverUrl'), el('input', { id: 'server-url-more', type: 'url', value: window.API.getBase() })),
      el('button', {
        class: 'btn btn--sm',
        onClick: () => {
          const v = $('#server-url-more').value.trim();
          window.API.setBase(v);
          toast(t('auth.serverUrlSaved'));
        }
      }, t('common.save'))
    ]));

    // App
    const lastSyncLineEl = el('p', { class: 'small muted' }, t('more.lastSyncLoading'));
    // Populate "Last sync · 2 min ago" once we can read the sync state.
    (async () => {
      try {
        const s = window.SYNC ? await window.SYNC.getState() : null;
        const iso = s && s.lastSync ? s.lastSync : null;
        lastSyncLineEl.textContent = iso
          ? t('more.lastSyncAgo', { ago: formatRelativeAgo(iso) })
          : t('more.lastSyncNever');
      } catch (e) {
        lastSyncLineEl.textContent = t('more.lastSyncNever');
      }
    })();

    root.appendChild(el('div', { class: 'card' }, [
      el('h3', null, t('more.app')),
      el('p', { class: 'small muted' }, t('more.version', { v: APP_VERSION })),
      lastSyncLineEl,
      el('p', { class: 'small muted' }, t('more.installHint')),
      // Copy a diagnostic to clipboard — useful when a trainer needs to file
      // an issue. One-tap, no jargon, paste into email / WhatsApp.
      el('button', {
        class: 'btn btn--ghost btn--block',
        style: 'margin-top:8px',
        onClick: async () => {
          const text = await buildDiagnostic();
          try {
            await navigator.clipboard.writeText(text);
            toast(t('more.diagCopied'));
          } catch (e) {
            // Fallback: dump into a prompt so the user can copy manually.
            try { window.prompt(t('more.diagFallbackPrompt'), text); } catch (_) {}
            toast(t('more.diagFallback'));
          }
        }
      }, t('more.diagCta')),
      el('button', {
        class: 'btn btn--ghost btn--block',
        style: 'margin-top:8px; color:var(--danger); border-color:var(--danger)',
        onClick: async () => {
          if (!confirm(t('more.clearConfirm'))) return;
          const savedLang = CURRENT_AUTHOR.lang;
          await DB.clearAll();
          await DB.metaSet('profile', { id: DB.uuid(), name: '', lang: savedLang, createdAt: new Date().toISOString() });
          if (window.API) await window.API.logout();
          await loadProfile();
          applyStaticLabels();
          toast(t('more.cleared'));
          go('/login');
        }
      }, t('more.clearCta'))
    ]));
  }

  /** Compact "in N units" relative-time string used by the More tab. */
  function formatRelativeAgo(iso) {
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '—';
    const s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 60)       return t('more.ago.justNow');
    if (s < 3600)    return t('more.ago.min',  { n: Math.round(s / 60) });
    if (s < 86400)   return t('more.ago.hour', { n: Math.round(s / 3600) });
    return t('more.ago.day', { n: Math.round(s / 86400) });
  }

  /** Build a plain-text diagnostic blob for support. */
  async function buildDiagnostic() {
    const apiUser = (window.API && window.API.getUser()) || {};
    const role = apiUser.role || '—';
    const email = apiUser.email || '—';
    const lang = (CURRENT_AUTHOR && CURRENT_AUTHOR.lang) || (window.I18N && window.I18N.getLang()) || 'fr';
    const online = navigator.onLine ? 'online' : 'offline';
    let lastSync = '—', syncStatus = '—', pendingDirty = 0;
    try {
      const s = window.SYNC ? await window.SYNC.getState() : null;
      if (s) {
        lastSync = s.lastSync || '—';
        syncStatus = s.status || '—';
      }
    } catch (e) {}
    // IndexedDB counts (best-effort, count rows including tombstones).
    async function n(store) {
      try { return (await DB.all(store, true)).length; }
      catch (e) { return -1; }
    }
    const counts = {};
    for (const store of ['cohorts', 'groups', 'participants', 'sessions', 'attendance', 'stories']) {
      counts[store] = await n(store);
    }
    try {
      pendingDirty = 0;
      for (const store of ['cohorts', 'groups', 'participants', 'sessions', 'attendance', 'stories']) {
        const rows = await DB.all(store, true);
        pendingDirty += rows.filter((r) => r.dirty).length;
      }
    } catch (e) {}

    const lines = [];
    lines.push('Ubuntu 3.0 diagnostic');
    lines.push('=====================');
    lines.push('Version:      v' + APP_VERSION);
    lines.push('Generated:    ' + new Date().toISOString());
    lines.push('Network:      ' + online);
    lines.push('Language:     ' + lang);
    lines.push('Account:      ' + email + '  (' + role + ')');
    lines.push('');
    lines.push('Sync');
    lines.push('  status:     ' + syncStatus);
    lines.push('  last sync:  ' + lastSync);
    lines.push('  pending:    ' + pendingDirty + ' dirty record(s) waiting to push');
    lines.push('');
    lines.push('Local data');
    Object.keys(counts).forEach((k) => {
      lines.push('  ' + k.padEnd(15) + counts[k]);
    });
    lines.push('');
    lines.push('User agent:   ' + (navigator.userAgent || '—'));
    lines.push('Screen:       ' + (window.screen ? (screen.width + 'x' + screen.height) : '—'));
    return lines.join('\n');
  }

  // ============================================================
  //  UI helpers
  // ============================================================

  function fg(label, control) {
    return el('div', { class: 'form-group' }, [el('label', null, label), control]);
  }

  // Password field with an eye toggle so the trainer can reveal what
  // they typed — helpful on touch keyboards where it's easy to mistype
  // an uppercase letter or a number. Accepts the same attrs as a plain
  // <input>, forces type='password' at first paint, and returns a
  // wrapper element so fg() can slot it under a <label>.
  const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
  const EYE_OFF_SVG  = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92C21.16 15.05 22.49 13.65 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.27-3.97.74l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 9.85 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53a5 5 0 0 1-5-5c0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16a3 3 0 0 0-3-3l-.17.01z"/></svg>';
  function passwordInput(attrs) {
    const input = el('input', Object.assign({}, attrs || {}, { type: 'password' }));
    const btn = el('button', {
      type: 'button',
      class: 'pw-toggle',
      'aria-label': t('auth.showPw'),
      'aria-pressed': 'false',
      tabindex: '-1',
      html: EYE_OPEN_SVG,
    });
    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = showing ? EYE_OPEN_SVG : EYE_OFF_SVG;
      btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
      btn.setAttribute('aria-label', showing ? t('auth.showPw') : t('auth.hidePw'));
      // Keep keyboard focus on the input so typing isn't interrupted
      input.focus();
    });
    return el('div', { class: 'pw-wrap' }, [input, btn]);
  }
  function selectEl(name, options, value, required, onChange) {
    const sel = el('select', { name, required: !!required });
    options.forEach((o) => {
      const opt = el('option', { value: o.value }, o.label);
      if (String(value) === String(o.value)) opt.selected = true;
      sel.appendChild(opt);
    });
    if (onChange) sel.addEventListener('change', onChange);
    return sel;
  }
  function emptyState(title, msg, href, btnLabel) {
    // CTA is optional — when the surrounding section already exposes
    // the same action (e.g. a + Participant button next to the
    // heading) we skip the duplicate button to keep the screen clean.
    const showCta = !!(href && btnLabel);
    return el('div', { class: 'empty' }, [
      el('h3', null, title),
      el('p', null, msg),
      showCta ? el('div', { class: 'spacer' }) : null,
      showCta ? el('a', { class: 'btn', href }, btnLabel) : null
    ]);
  }
  function dangerButton(label, onClick) {
    return el('button', {
      class: 'btn btn--ghost btn--block',
      style: 'margin-top:12px; color:var(--danger); border-color:var(--danger)',
      onClick
    }, label);
  }

  /**
   * Build a small rich-text editor (B / I / bullet list / paragraph break).
   * Returns { wrapper, getHtml, focus } so the caller can drop the wrapper
   * into a form and read getHtml() on submit.
   *
   * Storage model: the editor saves rendered HTML in story.text. For backward
   * compatibility with stories written before this commit (plain text), we
   * detect "looks like plain text" and convert newlines to <br> on load.
   * stripHtml() is the inverse used by list-preview helpers.
   */
  function buildRichTextEditor(initial, opts) {
    opts = opts || {};
    const placeholder = opts.placeholder || '';

    // Convert legacy plain text → safe HTML so it renders as expected.
    function loadInitial(raw) {
      const s = String(raw || '');
      // Heuristic: if the string contains any block-level or formatting tag,
      // assume it's already HTML. Otherwise treat as plain text.
      if (/<(p|br|ul|ol|li|strong|em|b|i|u|div|span)\b/i.test(s)) return s;
      // Escape ‹ &  › and turn newlines into <br>.
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\r?\n/g, '<br>');
    }

    const editor = el('div', {
      class: 'rt-editor',
      contenteditable: 'true',
      role: 'textbox',
      'aria-multiline': 'true',
      'data-placeholder': placeholder
    });
    editor.innerHTML = loadInitial(initial);

    // Toolbar buttons — use execCommand. It's deprecated but universally
    // supported in browsers we ship to (mobile Safari + Chrome) and is the
    // cheapest way to get correct nested-list behaviour. When we outgrow it
    // we'll swap in a DOM-mutating impl.
    function tbBtn(label, cmd, title) {
      return el('button', {
        type: 'button',
        class: 'rt-tb-btn',
        title: title || label,
        'aria-label': title || label,
        // mousedown (not click) so the editor doesn't lose focus before exec
        onMousedown: (e) => {
          e.preventDefault();
          editor.focus();
          document.execCommand(cmd, false, null);
        }
      }, label);
    }
    // Save the current selection before opening the color picker (the
    // native color dialog steals focus on some browsers).
    let savedRange = null;
    function saveSelection() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
    }
    function restoreSelection() {
      if (!savedRange) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }

    // Font-size buttons step through HTML's 1–7 scale via execCommand. Two
    // visible buttons (A− / A+) jump the current selection down to 2 or
    // up to 5; tapping the same one twice still produces a visible change
    // because each tap re-wraps with a fresh <font size> element.
    function fontSizeBtn(label, size, title) {
      return el('button', {
        type: 'button',
        class: 'rt-tb-btn',
        title, 'aria-label': title,
        onMousedown: (e) => {
          e.preventDefault();
          editor.focus();
          document.execCommand('fontSize', false, String(size));
        }
      }, label);
    }

    // Native color picker bound to a <font color="#hex"> via execCommand.
    const colorInput = el('input', {
      type: 'color', value: '#1B1B1B',
      style: 'position:absolute; opacity:0; width:0; height:0; pointer-events:none'
    });
    colorInput.addEventListener('input', () => {
      restoreSelection();
      document.execCommand('foreColor', false, colorInput.value);
    });
    const colorBtn = el('button', {
      type: 'button',
      class: 'rt-tb-btn rt-tb-color',
      title: t('rt.color') || 'Color',
      'aria-label': t('rt.color') || 'Color',
      onMousedown: (e) => {
        // Capture the selection before the color dialog opens.
        e.preventDefault();
        editor.focus();
        saveSelection();
        // Open the picker after the focus dance settles.
        setTimeout(() => colorInput.click(), 0);
      }
    }, [
      el('span', { style: 'font-weight:700' }, 'A'),
      el('span', { class: 'rt-tb-color-swatch', style: 'background:' + colorInput.value }),
    ]);

    // Inline-SVG variant of tbBtn for the icon-only buttons (undo/redo).
    function tbIconBtn(svgPath, cmd, title) {
      const btn = el('button', {
        type: 'button',
        class: 'rt-tb-btn rt-tb-icon',
        title, 'aria-label': title,
        onMousedown: (e) => {
          e.preventDefault();
          editor.focus();
          document.execCommand(cmd, false, null);
        }
      });
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' + svgPath + '</svg>';
      return btn;
    }
    // Material-style undo / redo curl arrows.
    const ICON_UNDO = '<path fill="currentColor" d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>';
    const ICON_REDO = '<path fill="currentColor" d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>';
    const ICON_LINK = '<path fill="currentColor" d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z"/>';
    const ICON_IMG  = '<path fill="currentColor" d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>';

    // ---------- Link button ----------
    // Wraps the selection in <a href="…">. We validate the URL (http(s)://
    // or mailto:) so the sanitiser doesn't have to allow arbitrary schemes.
    const linkBtn = el('button', {
      type: 'button',
      class: 'rt-tb-btn rt-tb-icon',
      title: t('rt.link') || 'Link',
      'aria-label': t('rt.link') || 'Link',
      onMousedown: (e) => {
        e.preventDefault();
        editor.focus();
        saveSelection();
        // Pre-fill the prompt with any href already on the selection.
        const sel = window.getSelection();
        let existingHref = '';
        if (sel && sel.anchorNode) {
          const a = (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('a');
          if (a) existingHref = a.getAttribute('href') || '';
        }
        const url = window.prompt(t('rt.linkPrompt') || 'Link URL', existingHref || 'https://');
        if (url == null) { restoreSelection(); return; }   // cancelled
        const trimmed = url.trim();
        if (!trimmed) {
          // Empty input → remove the link
          restoreSelection();
          document.execCommand('unlink', false, null);
          return;
        }
        if (!/^(https?:\/\/|mailto:)/i.test(trimmed)) {
          toast(t('rt.linkInvalid') || 'Link must start with https://, http:// or mailto:');
          return;
        }
        restoreSelection();
        document.execCommand('createLink', false, trimmed);
        // execCommand doesn't set rel/target — patch the just-created anchor.
        const range = window.getSelection().getRangeAt(0);
        const a = range && range.commonAncestorContainer ?
          (range.commonAncestorContainer.nodeType === 1
            ? range.commonAncestorContainer.querySelector('a[href="' + trimmed + '"]')
            : range.commonAncestorContainer.parentElement.querySelector('a[href="' + trimmed + '"]'))
          : null;
        if (a) {
          a.setAttribute('rel', 'noopener noreferrer');
          a.setAttribute('target', '_blank');
        }
      }
    });
    linkBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' + ICON_LINK + '</svg>';

    // ---------- Image button ----------
    // Opens a file picker that the OS may surface as "Take photo" on
    // mobile (the capture=environment hint). The image is read, drawn into
    // a 800px-wide canvas at JPEG quality 0.75, then embedded as a data: URI
    // <img>. Stays inline in story.text — no separate upload.
    // Limit: 3 images per story (UI guard).
    const MAX_IMAGES_PER_STORY = 3;
    const MAX_IMG_WIDTH = 800;
    const JPEG_QUALITY  = 0.75;
    const imageInput = el('input', {
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      style: 'position:absolute; opacity:0; width:0; height:0; pointer-events:none'
    });
    imageInput.addEventListener('change', async () => {
      const file = imageInput.files && imageInput.files[0];
      imageInput.value = '';   // reset so the same file can be picked again
      if (!file) return;
      const existing = editor.querySelectorAll('img').length;
      if (existing >= MAX_IMAGES_PER_STORY) {
        toast(t('rt.imgLimit', { n: MAX_IMAGES_PER_STORY }) || 'Max images reached');
        return;
      }
      try {
        const dataUrl = await compressImageToDataUrl(file, MAX_IMG_WIDTH, JPEG_QUALITY);
        restoreSelection();
        document.execCommand('insertHTML', false,
          '<img src="' + dataUrl + '" alt="" style="max-width:100%;height:auto;border-radius:8px;margin:6px 0">');
      } catch (err) {
        toast(t('rt.imgError') || ('Image failed: ' + (err.message || err)));
      }
    });
    const imgBtn = el('button', {
      type: 'button',
      class: 'rt-tb-btn rt-tb-icon',
      title: t('rt.image') || 'Insert image',
      'aria-label': t('rt.image') || 'Insert image',
      onMousedown: (e) => {
        e.preventDefault();
        editor.focus();
        saveSelection();
        setTimeout(() => imageInput.click(), 0);
      }
    });
    imgBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' + ICON_IMG + '</svg>';

    const toolbar = el('div', { class: 'rt-toolbar' }, [
      tbBtn('B', 'bold',                t('rt.bold')      || 'Bold'),
      tbBtn('I', 'italic',              t('rt.italic')    || 'Italic'),
      tbBtn('U', 'underline',           t('rt.underline') || 'Underline'),
      tbBtn('•', 'insertUnorderedList', t('rt.bullets')   || 'Bulleted list'),
      tbBtn('¶', 'formatBlock',         t('rt.paragraph') || 'Paragraph'),
      // Separator
      el('span', { class: 'rt-tb-sep' }),
      fontSizeBtn('A−', 2, t('rt.smaller') || 'Smaller'),
      fontSizeBtn('A+', 5, t('rt.larger')  || 'Larger'),
      colorBtn,
      colorInput,
      // Separator
      el('span', { class: 'rt-tb-sep' }),
      linkBtn,
      imgBtn,
      imageInput,
      // Separator
      el('span', { class: 'rt-tb-sep' }),
      tbIconBtn(ICON_UNDO, 'undo', t('rt.undo') || 'Undo'),
      tbIconBtn(ICON_REDO, 'redo', t('rt.redo') || 'Redo'),
    ]);
    // The "U" button uses execCommand('underline') with no value — wraps in <u>.
    // The "¶" button needs a value, not just a command; handle it specially.
    // (Find it by position: index 4 in the array above.)
    const paraBtn = toolbar.children[4];
    paraBtn.onmousedown = (e) => {
      e.preventDefault();
      editor.focus();
      document.execCommand('formatBlock', false, 'p');
    };
    // Visual cue on the "U" button: render an underlined glyph.
    const uBtn = toolbar.children[2];
    if (uBtn) uBtn.style.textDecoration = 'underline';

    // Keep the swatch in sync with the picker value as the user picks.
    colorInput.addEventListener('change', () => {
      const swatch = colorBtn.querySelector('.rt-tb-color-swatch');
      if (swatch) swatch.style.background = colorInput.value;
    });

    // ---------- Active-format highlight ----------
    // When the selection or cursor sits inside <b>/<i>/<u>/<a>, light the
    // matching toolbar button so the trainer sees "this text is already
    // bold". Hooked to the document so it reacts to mouse + keyboard moves.
    const formatButtons = {
      bold:      toolbar.children[0],
      italic:    toolbar.children[1],
      underline: toolbar.children[2],
    };
    function syncToolbarState() {
      // Only react while the selection is inside our editor.
      const sel = window.getSelection();
      const node = sel && sel.anchorNode;
      const inside = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!inside || !editor.contains(inside)) return;
      for (const cmd in formatButtons) {
        const btn = formatButtons[cmd];
        if (!btn) continue;
        try {
          if (document.queryCommandState(cmd)) btn.classList.add('rt-active');
          else                                 btn.classList.remove('rt-active');
        } catch (e) { /* some browsers throw for unsupported cmds */ }
      }
    }
    document.addEventListener('selectionchange', syncToolbarState);
    editor.addEventListener('keyup', syncToolbarState);
    editor.addEventListener('click', syncToolbarState);

    const wrapper = el('div', { class: 'rt-wrapper' }, [toolbar, editor]);

    function getHtml() {
      // Normalise: trim, drop a single trailing <br> the browser may append.
      let html = (editor.innerHTML || '').trim();
      html = html.replace(/(<br\s*\/?>\s*)+$/i, '').trim();
      // If the user typed nothing visible, return empty string so the
      // existing "story.empty" check still fires.
      const plain = stripHtml(html).trim();
      if (!plain) return '';
      return html;
    }

    return { wrapper, getHtml, focus: () => editor.focus() };
  }

  /** Strip HTML tags from a string — used in list previews + dashboard cards. */
  function stripHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.innerHTML = String(s);
    return (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Compress an image File to a JPEG data: URI, capped at `maxWidth` pixels.
   * Used by the rich-text editor's image button. Aggressive compression is
   * the entire reason inline data URIs are viable as story.text — a raw
   * camera photo can be 3 MB; after this it's typically 30–80 KB.
   *
   * Returns a Promise resolving to "data:image/jpeg;base64,…".
   */
  function compressImageToDataUrl(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Image decode failed'));
        img.onload = () => {
          try {
            const scale = Math.min(1, maxWidth / img.naturalWidth);
            const w = Math.round(img.naturalWidth  * scale);
            const h = Math.round(img.naturalHeight * scale);
            const canvas = document.createElement('canvas');
            canvas.width  = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            // White backdrop in case the source is transparent (PNG/HEIC) —
            // JPEG doesn't carry alpha and would otherwise come out black.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch (err) { reject(err); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Install a live-filter search bar at the top of a list view.
   *
   * Call this AFTER the cards have been appended to `parent`. It snapshots
   * the cards matching `itemSelector`, then inserts a search input + counter
   * just before the first card. Typing filters in place; Escape clears.
   *
   * Per-view persistence: pass `key` (e.g. 'pwa.sessions') and the query
   * survives navigation away and back in the same browser tab.
   *
   * @param {HTMLElement} parent  Container the cards live in.
   * @param {object} opts
   *   - key           sessionStorage key suffix; omit for ephemeral.
   *   - placeholder   i18n'd search placeholder text.
   *   - itemSelector  CSS selector for cards (default: '.card-link').
   *   - minToShow     Don't bother rendering below this many items (default 4).
   */
  function attachListSearch(parent, opts) {
    opts = opts || {};
    const itemSel    = opts.itemSelector || '.card-link';
    // Default to 1 so the search bar shows as soon as there's any content,
    // matching iOS-style list UX (the bar is always there, predictable
    // muscle memory). Callers that explicitly want to hide it on small
    // lists can pass minToShow:4 etc.
    const minToShow  = (opts.minToShow != null) ? opts.minToShow : 1;
    const placeholder = opts.placeholder || (t('common.searchPh') || 'Search…');
    const key        = opts.key || null;

    const items = Array.from(parent.querySelectorAll(itemSel));
    if (items.length < minToShow) return;

    const cache = items.map((node) => (node.textContent || '').toLowerCase());

    function readQ() {
      if (!key) return '';
      try { return sessionStorage.getItem('ubuntu30.listSearch.' + key) || ''; }
      catch (e) { return ''; }
    }
    function writeQ(q) {
      if (!key) return;
      try { sessionStorage.setItem('ubuntu30.listSearch.' + key, q); } catch (e) {}
    }

    // The search bar is styled in app.css as .list-search-pill (iOS-style
    // rounded pill with a magnifying-glass icon prepended). The counter
    // sits to the right of the pill, also outside it.
    const counter = el('span', {
      class: 'small muted list-search-counter',
    }, items.length + ' / ' + items.length);

    const input = el('input', {
      type: 'search',
      placeholder,
      autocomplete: 'off',
      spellcheck: 'false',
      class: 'list-search-input',
    });
    if (key) input.value = readQ();

    // Inline-SVG magnifying glass — sits inside the pill, can't be styled
    // away by browser-specific clear buttons.
    const glassSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    glassSvg.setAttribute('viewBox', '0 0 24 24');
    glassSvg.setAttribute('class', 'list-search-glass');
    glassSvg.setAttribute('aria-hidden', 'true');
    const glassPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    glassPath.setAttribute('fill', 'currentColor');
    glassPath.setAttribute('d', 'M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z');
    glassSvg.appendChild(glassPath);

    const pill = el('label', { class: 'list-search-pill' }, [glassSvg, input]);

    function apply() {
      const q = (input.value || '').trim().toLowerCase();
      let shown = 0;
      for (let i = 0; i < items.length; i++) {
        const hit = q === '' || cache[i].indexOf(q) !== -1;
        items[i].style.display = hit ? '' : 'none';
        if (hit) shown++;
      }
      counter.textContent = shown + ' / ' + items.length;
      if (key) writeQ(input.value || '');
    }

    ['input', 'keyup', 'change', 'search'].forEach((evt) => {
      input.addEventListener(evt, apply);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value !== '') {
        input.value = '';
        apply();
        e.stopPropagation();
      }
    });

    const bar = el('div', { class: 'list-search' }, [pill, counter]);
    // Placement: by default put it at the very top of the parent so the
    // "Sync from Ubuntu eLearning" buttons and any hint paragraphs fall
    // beneath it. Pass position:'beforeItems' to keep the old behaviour
    // (search above the first card, after any leading content).
    if (opts.position === 'beforeItems') {
      parent.insertBefore(bar, items[0]);
    } else {
      parent.insertBefore(bar, parent.firstChild);
    }
    if (input.value) apply();
  }

  // ============================================================
  //  CSV / JSON export
  // ============================================================

  function csvEscape(v) {
    if (v == null) return '';
    if (typeof v === 'object' && !(v instanceof Date)) v = JSON.stringify(v);
    const s = String(v);
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCsv(rows, columns) {
    const lines = [columns.map(csvEscape).join(',')];
    rows.forEach((row) => lines.push(columns.map((c) => csvEscape(row[c])).join(',')));
    return lines.join('\n');
  }
  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  async function exportCsv(storeName) {
    const COLUMN_MAP = {
      cohorts: ['id', 'name', 'region', 'startDate', 'endDate', 'createdAt', 'updatedAt', 'authorId'],
      groups: ['id', 'cohortId', 'name', 'facilitator', 'facilitatorIds', 'createdAt', 'updatedAt', 'authorId'],
      participants: ['id', 'groupId', 'firstName', 'lastName', 'sex', 'ageRange', 'contact', 'createdAt', 'updatedAt', 'authorId'],
      sessions: ['id', 'groupId', 'date', 'theme', 'location', 'notes', 'createdAt', 'updatedAt', 'authorId'],
      attendance: ['id', 'sessionId', 'participantId', 'present', 'createdAt', 'updatedAt', 'authorId'],
      stories: ['id', 'sessionId', 'participantId', 'text', 'consent', 'hasPhoto', 'hasAudio', 'createdAt', 'updatedAt', 'authorId']
    };
    const cols = COLUMN_MAP[storeName];
    let rows = await DB.all(storeName);
    if (storeName === 'stories') {
      rows = rows.map((r) => Object.assign({}, r, { hasPhoto: !!r.photo, hasAudio: !!r.audio, photo: undefined, audio: undefined }));
    }
    const csv = toCsv(rows, cols);
    downloadBlob('ubuntu30-' + storeName + '-' + new Date().toISOString().slice(0, 10) + '.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    toast(t('more.exportedRows', { n: rows.length }));
  }
  async function exportAllJson() {
    const snap = await DB.snapshot();
    if (snap.stories) {
      for (const s of snap.stories) {
        if (s.photo instanceof Blob) s.photo = { _blob: true, type: s.photo.type, dataUrl: await blobToDataUrl(s.photo) };
        if (s.audio instanceof Blob) s.audio = { _blob: true, type: s.audio.type, dataUrl: await blobToDataUrl(s.audio) };
      }
    }
    const json = JSON.stringify({
      version: 'v0.1.1',
      exportedAt: new Date().toISOString(),
      profile: CURRENT_AUTHOR,
      data: snap
    }, null, 2);
    downloadBlob('ubuntu30-backup-' + new Date().toISOString().slice(0, 10) + '.json', new Blob([json], { type: 'application/json' }));
    toast(t('more.backupSaved'));
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
  }

  // ============================================================
  //  Network status
  // ============================================================

  function updateNetDot() {
    const dot = $('#net-dot');
    if (!dot) return;
    if (navigator.onLine) dot.classList.remove('offline');
    else dot.classList.add('offline');
  }

  // ============================================================
  //  Routes
  // ============================================================

  route('/login', loginView);
  route('/forgot', forgotPasswordView);
  route('/reset', resetPasswordView);
  route('/change-password', changePasswordView);
  route('/onboarding', onboardingView);
  route('/dashboard', dashboardView);
  route('/cohorts', cohortsListView);
  route('/cohorts/new', (_p, r) => cohortFormView({}, r));
  route('/cohorts/:id', cohortDetailView);
  route('/cohorts/:id/edit', cohortFormView);
  route('/cohorts/:cohortId/groups/new', groupFormView);
  route('/groups', groupsListView);
  route('/groups/:id', groupDetailView);
  route('/groups/:id/edit', groupFormView);
  route('/groups/:groupId/participants/new', participantFormView);
  route('/participants', participantsListView);
  route('/participants/:id/edit', participantFormView);
  route('/sessions', sessionsListView);
  route('/sessions/new', (_p, r) => sessionFormView({}, r));
  route('/sessions/:id', sessionDetailView);
  route('/sessions/:id/edit', sessionFormView);
  route('/stories', storiesListView);
  route('/stories/new', (_p, r) => storyFormView({}, r));
  route('/stories/:id/edit', storyFormView);
  route('/reports', reportsView);
  route('/more', moreView);

  // ============================================================
  //  Boot
  // ============================================================

  document.addEventListener('DOMContentLoaded', async () => {
    await DB.ready();
    await loadProfile();
    applyStaticLabels();
    wireLangSwitcher();
    wireSyncIndicator();
    wireNotificationBell();
    wireHeaderNav();
    updateNetDot();
    // Kick off background sync if already logged in
    if (window.API && window.API.isAuthenticated()) {
      window.SYNC.syncNow().catch(() => {});
    }
    window.addEventListener('online', updateNetDot);
    window.addEventListener('offline', updateNetDot);
    window.addEventListener('hashchange', handleRoute);

    // On first load, either the URL already has a hash (deep link / reload) or
    // it doesn't. If it doesn't, set it to /dashboard — that fires a
    // hashchange event which calls handleRoute for us. Calling handleRoute
    // unconditionally on top of that produces a double-render on the
    // dashboard the first time the app boots.
    if (!location.hash) {
      location.hash = '#/dashboard';
    } else {
      await handleRoute();
    }

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('service-worker.js').catch((err) => console.warn('SW registration failed', err));
    }
  });
})();
