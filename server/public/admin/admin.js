/* Ubuntu 3.0 — Admin web view
 * Plain JS, no framework. Shares the same localStorage token with the PWA.
 */
(function () {
  'use strict';

  // ============================================================
  //  API client (mirrors the PWA's api.js)
  // ============================================================
  const TOKEN_KEY = 'ubuntu30.token';
  const USER_KEY  = 'ubuntu30.user';
  const API_BASE  = (location.origin + '/api');

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function setUser(u) {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  }

  async function call(method, path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let body;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    const resp = await fetch(API_BASE + path, { method, headers, body, credentials: 'omit', cache: 'no-store' });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* not JSON */ }
    if (!resp.ok) {
      const err = new Error((data && data.error && data.error.message) || ('HTTP ' + resp.status));
      err.code = (data && data.error && data.error.code) || 'http_' + resp.status;
      err.status = resp.status;
      if (resp.status === 401) { setToken(null); setUser(null); }
      throw err;
    }
    return data;
  }

  const API = {
    login(email, password) {
      return call('POST', '/auth/login', { body: { email, password } })
        .then((r) => { setToken(r.token); setUser(r.user); return r.user; });
    },
    logout() {
      return call('POST', '/auth/logout').catch(() => {}).then(() => { setToken(null); setUser(null); });
    },
    me() {
      return call('GET', '/auth/me').then((r) => { setUser(r.user); return r.user; });
    },
    pull(since) {
      // POST instead of GET — corporate proxies (Zscaler etc.) sometimes
      // strip Authorization on GET redirects but leave POSTs alone.
      return call('POST', '/sync/pull', { body: { since: since || '1970-01-01T00:00:00Z' } });
    },
    listUsers()                     { return call('POST',   '/users/list'); },
    createUser(b)                   { return call('POST',   '/users', { body: b }); },
    updateUser(id, b)               { return call('PATCH',  '/users/' + id, { body: b }); },
    sendReset(id)                   { return call('POST',   '/users/' + id + '/send-reset'); },
    deleteUser(id)                  { return call('POST',   '/users/' + id + '/delete'); },
    moodleSync()                    { return call('POST',   '/admin/moodle/sync'); },
    forgotPassword(email)           { return call('POST',   '/auth/forgot-password', { body: { email } }); },
    donorReport(body)               { return call('POST',   '/admin/reports/donor', { body: body || {} }); },
    syncPush(payload)               { return call('POST',   '/sync/push', { body: payload }); },
    pickUsers(courseId, q)          { return call('POST',   '/users/pick', { body: { courseId: courseId || null, q: q || '' } }); },
  };

  /** RFC4122 v4 UUID. */
  function genUuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Form modal helper.
   * config = {
   *   title, fields: [{name,label,type,options?,required?,placeholder?,value?,disabled?}],
   *   onSave(values), saveLabel?,
   *   onDelete?(), deleteLabel?, deleteConfirm?
   * }
   * Returns a Promise resolved with the saved record (or null on cancel/delete).
   */
  function openFormModal(config) {
    return new Promise(function (resolve) {
      const bg = el('div', { class: 'modal-bg', onClick: (e) => { if (e.target === bg) { bg.remove(); resolve(null); } } });
      const errEl = el('p', { class: 'error', hidden: true });
      // For 'custom' fields the caller supplies a getValue() — we keep them
      // in this lookup so the submit handler can collect their values.
      const customGetters = {};
      const form = el('form', {
        onSubmit: async (e) => {
          e.preventDefault();
          errEl.hidden = true;
          const fd = new FormData(form);
          const values = {};
          try {
            config.fields.forEach((f) => {
              if (f.type === 'checkbox') {
                const node = form.elements[f.name];
                values[f.name] = !!(node && node.checked);
              } else if (f.type === 'custom') {
                const getter = customGetters[f.name];
                values[f.name] = getter ? getter() : null;
              } else {
                const v = fd.get(f.name);
                values[f.name] = v == null ? '' : String(v).trim();
              }
              if (f.required && !values[f.name]) {
                throw new Error(f.label + ' is required.');
              }
            });
          } catch (err) {
            errEl.textContent = err.message;
            errEl.hidden = false;
            return;
          }
          const btn = form.querySelector('button[type=submit]');
          btn.disabled = true;
          try {
            const result = await config.onSave(values);
            bg.remove();
            resolve(result);
          } catch (err) {
            errEl.textContent = err.message || 'Could not save.';
            errEl.hidden = false;
            btn.disabled = false;
          }
        }
      }, [
        el('h2', null, config.title),
        errEl
      ].concat(config.fields.map((f) => {
        const disabledAttr = f.disabled ? { disabled: 'disabled' } : {};
        if (f.type === 'select') {
          const sel = el('select', Object.assign({ name: f.name, required: !!f.required }, disabledAttr));
          (f.options || []).forEach((o) => {
            const opt = el('option', { value: o.v }, o.l);
            if (String(f.value) === String(o.v)) opt.selected = true;
            sel.appendChild(opt);
          });
          return formGroup(f.label, sel);
        }
        if (f.type === 'checkbox') {
          return el('div', { class: 'form-group' }, el('label', { style: 'display:inline-flex; align-items:center; gap:6px; cursor:pointer' }, [
            el('input', Object.assign({ type: 'checkbox', name: f.name, checked: !!f.value }, disabledAttr)),
            el('span', null, f.label)
          ]));
        }
        if (f.type === 'textarea') {
          return formGroup(f.label, el('textarea', Object.assign({ name: f.name, rows: '3', placeholder: f.placeholder || '' }, disabledAttr), f.value || ''));
        }
        if (f.type === 'custom') {
          // Caller supplies render() -> { node, getValue }. We store getValue
          // so the submit handler can collect its value alongside the others.
          const built = f.render();
          customGetters[f.name] = built.getValue;
          return formGroup(f.label, built.node);
        }
        return formGroup(f.label, el('input', Object.assign({
          name: f.name, type: f.type || 'text', required: !!f.required,
          placeholder: f.placeholder || '',
          value: f.value != null ? String(f.value) : ''
        }, disabledAttr)));
      })).concat([
        el('div', { class: 'row', style: 'gap:8px; margin-top:10px; align-items:center' }, [
          config.onDelete ? el('button', {
            class: 'btn btn--sm', type: 'button',
            style: 'background:var(--danger); color:#fff; margin-right:auto',
            onClick: async () => {
              if (config.deleteConfirm && !confirm(config.deleteConfirm)) return;
              try {
                await config.onDelete();
                bg.remove();
                resolve(null);
              } catch (err) {
                errEl.textContent = err.message || 'Could not delete.';
                errEl.hidden = false;
              }
            }
          }, config.deleteLabel || 'Delete') : null,
          el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => { bg.remove(); resolve(null); } }, 'Cancel'),
          el('button', { class: 'btn', type: 'submit' }, config.saveLabel || 'Save')
        ])
      ]));
      const modal = el('div', { class: 'modal' }, form);
      bg.appendChild(modal);
      document.body.appendChild(bg);
      setTimeout(() => {
        const first = form.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
        if (first) first.focus();
      }, 0);
    });
  }

  /** Soft-delete: send the record with deletedAt set so the server tombstones it. */
  async function softDelete(entityName, id) {
    const rec = { id: id, deletedAt: new Date().toISOString() };
    const payload = {}; payload[entityName] = [rec];
    return API.syncPush(payload);
  }

  function todayIso() { return new Date().toISOString().slice(0, 10); }

  // ============================================================
  //  helpers
  // ============================================================
  const $ = (sel) => document.querySelector(sel);

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) n.setAttribute(k, '');
        else n.setAttribute(k, v);
      }
    }
    if (kids != null) {
      const list = Array.isArray(kids) ? kids : [kids];
      list.forEach((c) => {
        if (c == null || c === false) return;
        if (c instanceof Node) n.appendChild(c);
        else n.appendChild(document.createTextNode(String(c)));
      });
    }
    return n;
  }

  let _toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
  }
  function fmtDate(s) { if (!s) return ''; const d = new Date(s); return isNaN(d) ? s : d.toLocaleString(); }
  function pill(label, klass) { return el('span', { class: 'pill ' + (klass || '') }, label); }

  // ============================================================
  //  data cache (snapshot from /sync/pull, refreshed on demand)
  // ============================================================
  const cache = {
    cohorts: [], groups: [], participants: [], sessions: [], attendance: [], stories: [],
    users: [], serverTime: null, loadedAt: 0
  };

  async function refresh() {
    const pull = await API.pull('1970-01-01T00:00:00Z');
    // The server returns soft-deleted (tombstoned) rows so other clients can
    // apply the deletion. The admin UI should hide them — once a course is
    // deleted it must disappear from the table here too.
    const alive = (rows) => (rows || []).filter((r) => !r.deletedAt);
    cache.cohorts = alive(pull.cohorts);
    cache.groups = alive(pull.groups);
    cache.participants = alive(pull.participants);
    cache.sessions = alive(pull.sessions);
    cache.attendance = alive(pull.attendance);
    cache.stories = alive(pull.stories);
    cache.serverTime = pull.serverTime;
    cache.loadedAt = Date.now();
    try {
      const usersResp = await API.listUsers();
      cache.users = usersResp.users || [];
    } catch (e) {
      cache.users = [];
    }
  }

  function indexBy(arr, key) {
    const m = new Map();
    arr.forEach((r) => m.set(r[key], r));
    return m;
  }

  // ============================================================
  //  views
  // ============================================================

  function renderDashboard() {
    const main = $('#main');
    main.innerHTML = '';
    main.appendChild(el('h1', null, 'Dashboard'));

    // Headline KPIs — same metrics as the PWA dashboard
    const att = cache.attendance || [];
    const present = att.filter((a) => a.present).length;
    const attRate = att.length ? Math.round((present * 100) / att.length) : 0;

    const allStories = cache.stories || [];
    const storiesConsent = allStories.filter((s) => s.consent).length;
    const consentRate = allStories.length ? Math.round((storiesConsent * 100) / allStories.length) : 0;

    const monthKey = new Date().toISOString().slice(0, 7);
    const activeGroupIds = new Set(
      (cache.sessions || [])
        .filter((s) => (s.date || '').slice(0, 7) === monthKey)
        .map((s) => s.groupId)
        .filter(Boolean)
    );
    const activeGroupsRate = (cache.groups || []).length
      ? Math.round((activeGroupIds.size * 100) / cache.groups.length)
      : 0;

    main.appendChild(el('section', { class: 'kpis' }, [
      kpi('Average attendance', attRate + '%', present + ' present / ' + att.length, attRate),
      kpi('Stories with consent', consentRate + '%', storiesConsent + ' / ' + allStories.length, consentRate),
      kpi('Active courses (month)', activeGroupsRate + '%', activeGroupIds.size + ' / ' + (cache.groups || []).length + ' courses', activeGroupsRate),
    ]));

    // Clickable navigation tiles
    const tiles = el('div', { class: 'tiles' }, [
      linkTile('Users',        cache.users.length,        '#users'),
      linkTile('Cohorts',      cache.cohorts.length,      '#cohorts'),
      linkTile('Courses',      cache.groups.length,       '#groups'),
      linkTile('Participants', cache.participants.length, '#participants'),
      linkTile('Sessions',     cache.sessions.length,     '#sessions'),
      linkTile('Stories',      cache.stories.length,      '#stories'),
    ]);
    main.appendChild(tiles);

    // Recent activity (last 8 sessions)
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card__head' }, el('h2', null, 'Recent sessions')));
    const recent = cache.sessions.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);
    if (!recent.length) {
      card.appendChild(el('p', { class: 'muted' }, 'No sessions yet.'));
    } else {
      const groupsById = indexBy(cache.groups, 'id');
      const tbl = renderTable(['Date', 'Theme', 'Course', 'Author'], recent.map((s) => [
        s.date || '',
        s.theme || '',
        (groupsById.get(s.groupId) || {}).name || '',
        userName(s.authorId)
      ]));
      card.appendChild(tbl);
    }
    main.appendChild(card);

    // Recent stories
    const card2 = el('div', { class: 'card' });
    card2.appendChild(el('div', { class: 'card__head' }, el('h2', null, 'Recent stories')));
    const stories = cache.stories.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8);
    if (!stories.length) {
      card2.appendChild(el('p', { class: 'muted' }, 'No stories yet.'));
    } else {
      const tbl = renderTable(['Updated', 'Text', 'Consent', 'Media', 'Author'], stories.map((s) => [
        fmtDate(s.updatedAt),
        truncate(s.text || '', 60),
        s.consent ? pill('yes', 'pill--success') : pill('no', 'pill--warning'),
        [s.hasPhoto ? 'photo' : null, s.hasAudio ? 'audio' : null].filter(Boolean).join(', ') || '—',
        userName(s.authorId)
      ]));
      card2.appendChild(tbl);
    }
    main.appendChild(card2);
  }

  /** "Trainees" sidebar link: render the Users page in trainees mode. */
  function renderTrainees() { renderUsers(); }

  // Persisted across re-renders: when on, the Trainees table also lists
  // merged duplicates and disabled trainees so an admin can clean them up
  // one by one (Delete button hard-deletes via API.deleteUser).
  let showMergedTrainees = false;

  function renderUsers() {
    const main = $('#main');
    main.innerHTML = '';
    // The sidebar route decides what we show. No top-level filter chips —
    // Trainees and Staff are accessed via their dedicated nav links.
    const onTraineesRoute = currentSection() === 'trainees';
    const filterMode = onTraineesRoute ? 'trainees' : 'staff';

    const headActions = el('div', { class: 'row', style: 'gap:8px' }, [
      onTraineesRoute
        ? el('label', { class: 'small muted', style: 'display:flex; align-items:center; gap:6px; user-select:none' }, [
            (() => {
              const cb = el('input', { type: 'checkbox' });
              cb.checked = showMergedTrainees;
              cb.addEventListener('change', () => {
                showMergedTrainees = cb.checked;
                renderUsers();
              });
              return cb;
            })(),
            'Show merged / disabled'
          ])
        : null,
      onTraineesRoute
        ? el('button', { class: 'btn', onClick: openAddTraineeModal }, '+ Add trainee')
        : el('button', { class: 'btn', onClick: openInviteModal }, '+ Invite trainer')
    ].filter(Boolean));
    const head = el('div', { class: 'row between' }, [
      el('h1', { style: 'margin:0' }, onTraineesRoute ? 'Trainees' : 'Staff'),
      headActions
    ]);
    main.appendChild(head);

    if (!cache.users.length) {
      main.appendChild(el('p', { class: 'empty' }, 'No users yet. Invite the first trainer.'));
      return;
    }
    const currentUser = getUser() || {};
    // Filter by the current sidebar route. Disabled users are hidden from
    // Trainees by default (those are merged duplicates) but kept in Staff so
    // admins can re-enable a disabled trainer/admin. Tick "Show merged /
    // disabled" on the Trainees page to surface them for manual deletion.
    const visibleUsers = cache.users.filter((u) => {
      if (filterMode === 'staff') return (u.role === 'trainer' || u.role === 'admin');
      // trainees
      if (u.role !== 'trainee') return false;
      if (showMergedTrainees) return true;
      return !u.disabledAt && !String(u.email || '').startsWith('merged-');
    });

    if (!visibleUsers.length) {
      main.appendChild(el('p', { class: 'empty' }, 'No users match this filter.'));
      return;
    }

    const rows = visibleUsers.map((u) => {
      const isMerged = String(u.email || '').startsWith('merged-');
      const status = isMerged ? pill('merged', 'pill--danger')
                  : u.disabledAt ? pill('disabled', 'pill--danger')
                  : u.mustChangePassword ? pill('must change pwd', 'pill--warning')
                  : pill('active', 'pill--success');
      const role = u.role === 'admin' ? pill('admin', 'pill--brand')
                 : u.role === 'trainee' ? pill('trainee', 'pill--muted')
                 : pill('trainer');
      const isSelf = u.id === currentUser.id;
      const isTrainee = u.role === 'trainee';
      // Trainees don't need role-toggle / send-reset / disable. Keep delete only.
      const actions = isTrainee
        ? el('div', { class: 'row wrap' }, [
            el('button', {
              class: 'btn btn--sm btn--ghost',
              onClick: () => openUserDemographicsModal(u)
            }, 'Edit'),
            isSelf ? null : el('button', {
              class: 'btn btn--sm', style: 'background:var(--danger); color:#fff;',
              onClick: () => deleteUser(u)
            }, 'Delete'),
          ].filter(Boolean))
        : el('div', { class: 'row wrap' }, [
            el('button', { class: 'btn btn--sm btn--ghost', onClick: () => toggleRole(u) }, u.role === 'admin' ? 'Make trainer' : 'Make admin'),
            el('button', { class: 'btn btn--sm btn--ghost', onClick: () => sendReset(u) }, 'Send reset'),
            el('button', { class: 'btn btn--sm btn--ghost',
              style: u.disabledAt ? '' : 'color:var(--danger);border-color:var(--danger)',
              onClick: () => toggleDisabled(u) },
              u.disabledAt ? 'Re-enable' : 'Disable'),
            isSelf ? null : el('button', {
              class: 'btn btn--sm', style: 'background:var(--danger); color:#fff;',
              onClick: () => deleteUser(u)
            }, 'Delete'),
          ].filter(Boolean));
      // Visually fade synthetic placeholder emails
      const isSynthetic = (u.email || '').endsWith('@ubuntu3.local');
      const emailCell = isSynthetic
        ? el('span', { class: 'muted small' }, truncate(u.email || '', 36))
        : (u.email || '');
      return [
        u.username || u.email,
        emailCell,
        u.phone || '—',
        u.firstName || '',
        u.lastName  || '',
        u.sex      || '—',
        u.ageRange || '—',
        role,
        (u.language || '').toUpperCase(),
        fmtDate(u.lastLoginAt) || '—',
        status,
        actions
      ];
    });
    main.appendChild(renderTable(
      ['Username', 'Email', 'Phone', 'First name', 'Last name', 'Sex', 'Age', 'Role', 'Lang', 'Last login', 'Status', 'Actions'],
      rows
    ));
  }

  /** Edit a trainee user: identity (username, email) + demographics. */
  async function openUserDemographicsModal(u) {
    const sexOpts = [
      { v: '',  l: '—' },
      { v: 'F', l: 'F' }, { v: 'M', l: 'M' }, { v: 'O', l: 'O' }
    ];
    const ageOpts = [
      { v: '',     l: '—' },
      { v: '<18',  l: '<18' }, { v: '18-24', l: '18-24' }, { v: '25-34', l: '25-34' },
      { v: '35-44', l: '35-44' }, { v: '45-54', l: '45-54' }, { v: '55+', l: '55+' }
    ];
    const isSynthetic = (u.email || '').endsWith('@ubuntu3.local');
    await openFormModal({
      title: 'Edit ' + (u.name || u.email),
      fields: [
        { name: 'firstName', label: 'First name', type: 'text',  required: true, value: u.firstName || '' },
        { name: 'lastName',  label: 'Last name',  type: 'text',                   value: u.lastName  || '' },
        { name: 'email',     label: 'Email (unique identifier)', type: 'email', required: true,
                                                                 value: isSynthetic ? '' : (u.email || ''),
                                                                 placeholder: isSynthetic ? 'Enter a real email…' : '' },
        { name: 'username',  label: 'Username',   type: 'text',                   value: u.username || '' },
        { name: 'phone',     label: 'Phone',      type: 'tel',                    value: u.phone    || '' },
        { name: 'sex',       label: 'Sex',        type: 'select', options: sexOpts, value: u.sex || '' },
        { name: 'ageRange',  label: 'Age range',  type: 'select', options: ageOpts, value: u.ageRange || '' },
      ],
      saveLabel: 'Update',
      onSave: async (v) => {
        await API.updateUser(u.id, {
          firstName: v.firstName,
          lastName:  v.lastName || '',
          email:     v.email,
          username:  v.username || v.email,
          phone:     v.phone || '',
          sex:       v.sex || '',
          ageRange:  v.ageRange || '',
        });
        toast('Trainee updated');
        await refresh();
        renderUsers();
      },
    });
  }

  /** Admin creates a new trainee directly (no course context required).
   *  Email is the unique identifier; phone/sex/age optional. */
  async function openAddTraineeModal() {
    const sexOpts = [
      { v: '',  l: '—' },
      { v: 'F', l: 'F' }, { v: 'M', l: 'M' }, { v: 'O', l: 'O' }
    ];
    const ageOpts = [
      { v: '',     l: '—' },
      { v: '<18',  l: '<18' }, { v: '18-24', l: '18-24' }, { v: '25-34', l: '25-34' },
      { v: '35-44', l: '35-44' }, { v: '45-54', l: '45-54' }, { v: '55+', l: '55+' }
    ];
    await openFormModal({
      title: 'Add trainee',
      fields: [
        { name: 'firstName', label: 'First name', type: 'text',  required: true },
        { name: 'lastName',  label: 'Last name',  type: 'text',  required: true },
        { name: 'email',     label: 'Email (unique identifier)', type: 'email', required: true },
        { name: 'phone',     label: 'Phone',      type: 'tel' },
        { name: 'sex',       label: 'Sex',        type: 'select', options: sexOpts },
        { name: 'ageRange',  label: 'Age range',  type: 'select', options: ageOpts },
      ],
      saveLabel: 'Create',
      onSave: async (v) => {
        const r = await API.createUser({
          firstName: v.firstName,
          lastName:  v.lastName,
          email:     v.email,
          phone:     v.phone || '',
          sex:       v.sex || '',
          ageRange:  v.ageRange || '',
          role: 'trainee',
          sendInvite: false,
        });
        toast(r && r.reused ? 'Existing trainee reused — no duplicate created' : 'Trainee created');
        await refresh();
        renderTrainees();
      },
    });
  }

  function renderCohorts() {
    const main = $('#main'); main.innerHTML = '';
    main.appendChild(sectionHeader('Cohorts', '+ New cohort', openCohortModal));
    if (!cache.cohorts.length) {
      main.appendChild(el('p', { class: 'empty' }, 'No cohorts yet. Click "+ New cohort" to create the first one.'));
      return;
    }
    const groupsByCohort = groupBy(cache.groups, 'cohortId');
    const partsByGroup = groupBy(cache.participants, 'groupId');
    const sortedCohorts = cache.cohorts.slice();
    const rows = sortedCohorts.map((c) => {
      const gs = groupsByCohort.get(c.id) || [];
      const partCount = gs.reduce((acc, g) => acc + ((partsByGroup.get(g.id) || []).length), 0);
      return [
        c.name || '—',
        c.region || '',
        c.startDate || '',
        c.endDate || '',
        gs.length,
        partCount,
        userName(c.authorId),
        fmtDate(c.updatedAt)
      ];
    });
    main.appendChild(renderTable(
      ['Name', 'Region', 'Start', 'End', 'Courses', 'Participants', 'Author', 'Updated'],
      rows,
      (i) => openCohortModal(sortedCohorts[i])
    ));
  }

  /**
   * Section header: title + optional secondary "ghost" action + primary "+ New" action.
   * @param {string} title
   * @param {string} newLabel
   * @param {Function} onNew  click handler that opens the create modal
   * @param {{label:string,onClick:Function}} [secondary]  optional ghost-style action
   */
  function sectionHeader(title, newLabel, onNew, secondary) {
    const actions = el('div', { class: 'row', style: 'gap:8px' }, [
      secondary ? el('button', {
        class: 'btn btn--ghost', type: 'button', onClick: secondary.onClick
      }, secondary.label) : null,
      onNew ? el('button', { class: 'btn', type: 'button', onClick: onNew }, newLabel) : null
    ]);
    const header = el('div', { class: 'row between', style: 'margin-bottom:8px' }, [
      el('h1', { style: 'margin:0' }, title),
      actions
    ]);
    return header;
  }

  /** Wrap a name string in a DOM node, adding a small "Moodle" pill when applicable. */
  function nameWithMoodlePill(name, isMoodle) {
    const span = el('span');
    span.appendChild(document.createTextNode(name || '—'));
    if (isMoodle) {
      const pill = el('span', { class: 'pill pill--brand', style: 'margin-left:6px; font-size:10px; background:#E3EEF7; color:#25517A' }, 'Moodle');
      span.appendChild(pill);
    }
    return span;
  }

  function renderGroups() {
    const main = $('#main'); main.innerHTML = '';
    main.appendChild(sectionHeader('Courses', '+ New course', openCourseModal, {
      label: '↻ Sync from Ubuntu eLearning',
      onClick: runMoodleSyncFromCourses
    }));
    if (!cache.groups.length) {
      main.appendChild(el('p', { class: 'empty' }, 'No courses yet. Click "+ New course" to add one inside a cohort.'));
      return;
    }
    const cohortsById = indexBy(cache.cohorts, 'id');
    const partsByGroup = groupBy(cache.participants, 'groupId');
    const sortedGroups = cache.groups.slice();
    const rows = sortedGroups.map((g) => [
      nameWithMoodlePill(g.name, !!g.moodleCourseId),
      (cohortsById.get(g.cohortId) || {}).name || '',
      g.facilitator || '',
      (partsByGroup.get(g.id) || []).length,
      userName(g.authorId),
      fmtDate(g.updatedAt)
    ]);
    main.appendChild(renderTable(
      ['Name', 'Cohort', 'Facilitators', 'Participants', 'Author', 'Updated'],
      rows,
      (i) => openCourseModal(sortedGroups[i])
    ));
  }

  function renderParticipants() {
    const main = $('#main'); main.innerHTML = '';
    main.appendChild(sectionHeader('Participants', '+ Add participant', openParticipantModal));
    if (!cache.participants.length) {
      main.appendChild(el('p', { class: 'empty' }, 'No participants yet. Open a course and use "+ Participant" to add one.'));
      return;
    }
    const groupsById = indexBy(cache.groups, 'id');
    const usersById  = indexBy(cache.users || [], 'id');
    const sortedParts = cache.participants.slice();
    const rows = sortedParts.map((p) => {
      const u = p.userId ? usersById.get(p.userId) : null;
      // Pull demographics from the linked user (canonical) with participant as fallback
      const sex      = (u && u.sex)      || p.sex      || '';
      const ageRange = (u && u.ageRange) || p.ageRange || '';
      // Hide synthetic placeholder emails — show '—' instead
      const email    = u && u.email && !String(u.email).endsWith('@ubuntu3.local') ? u.email : '';
      const phone    = (u && u.phone) || '';
      return [
        nameWithMoodlePill(((p.firstName || '') + ' ' + (p.lastName || '')).trim(), p.source === 'moodle'),
        sex || '—',
        ageRange || '—',
        (groupsById.get(p.groupId) || {}).name || '',
        email || (p.contact && !String(p.contact).includes('@') ? '' : (p.contact || '')) || '—',
        phone || (p.contact && !String(p.contact).includes('@') ? p.contact : '') || '—',
        fmtDate(p.updatedAt)
      ];
    });
    main.appendChild(renderTable(
      ['Name', 'Sex', 'Age', 'Course', 'Email', 'Phone', 'Updated'],
      rows,
      (i) => openParticipantEditModal(sortedParts[i])
    ));
  }

  function renderSessions() {
    const main = $('#main'); main.innerHTML = '';
    main.appendChild(sectionHeader('Sessions', '+ New session', openSessionModal));
    if (!cache.sessions.length) {
      main.appendChild(el('p', { class: 'empty' }, 'No sessions yet. Click "+ New session" to record the first one.'));
      return;
    }
    const groupsById = indexBy(cache.groups, 'id');
    const attBySession = groupBy(cache.attendance, 'sessionId');
    const sortedSessions = cache.sessions.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const rows = sortedSessions.map((s) => {
      const att = attBySession.get(s.id) || [];
      const present = att.filter((a) => a.present).length;
      return [
        s.date || '',
        nameWithMoodlePill(s.theme, s.source === 'moodle'),
        (groupsById.get(s.groupId) || {}).name || '',
        s.location || '',
        att.length ? `${present}/${att.length}` : '—',
        userName(s.authorId),
        fmtDate(s.updatedAt)
      ];
    });
    main.appendChild(renderTable(
      ['Date', 'Theme', 'Course', 'Location', 'Attendance', 'Author', 'Updated'],
      rows,
      (i) => openSessionModal(sortedSessions[i])
    ));
  }

  function renderStories() {
    const main = $('#main'); main.innerHTML = '';
    main.appendChild(sectionHeader('Stories', '+ New story', openStoryModal));
    if (!cache.stories.length) {
      main.appendChild(el('p', { class: 'empty' }, 'No stories yet. Click "+ New story" to capture the first one.'));
      return;
    }
    const sessionsById = indexBy(cache.sessions, 'id');
    const participantsById = indexBy(cache.participants, 'id');
    const sortedStories = cache.stories.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const rows = sortedStories.map((s) => {
      const tag = s.sessionId ? ((sessionsById.get(s.sessionId) || {}).theme || 'session')
        : s.participantId ? (((participantsById.get(s.participantId) || {}).firstName || 'participant'))
        : 'free';
      const media = el('div', { class: 'row' }, [
        s.hasPhoto ? el('a', { href: API_BASE + '/stories/' + s.id + '/media/photo', target: '_blank', onClick: (e) => downloadMedia(e, s.id, 'photo') }, 'photo') : null,
        s.hasAudio ? el('a', { href: API_BASE + '/stories/' + s.id + '/media/audio', target: '_blank', onClick: (e) => downloadMedia(e, s.id, 'audio') }, 'audio') : null,
        (!s.hasPhoto && !s.hasAudio) ? el('span', { class: 'muted' }, '—') : null
      ]);
      return [
        fmtDate(s.updatedAt),
        tag,
        truncate(s.text || '', 80),
        s.consent ? pill('yes', 'pill--success') : pill('no', 'pill--warning'),
        media,
        userName(s.authorId)
      ];
    });
    main.appendChild(renderTable(
      ['Updated', 'Tag', 'Text', 'Consent', 'Media', 'Author'],
      rows,
      (i) => openStoryModal(sortedStories[i])
    ));
  }

  // ============================================================
  //  reports (v0.3.2 — donor reports)
  // ============================================================

  /** Default range: last 3 months ending today. */
  function defaultReportRange() {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 3);
    const fmt = (d) => d.toISOString().slice(0, 10);
    return { from: fmt(from), to: fmt(to) };
  }

  /**
   * Render the Reports section: filter form + result container. The result
   * region only fills once the admin taps "Generate".
   */
  function renderReports() {
    const main = $('#main'); main.innerHTML = '';
    const range = defaultReportRange();

    main.appendChild(el('h1', null, 'Donor reports'));
    main.appendChild(el('p', { class: 'muted', style: 'margin-top:-6px' },
      'Compile a donor-ready report for a date range. Print to PDF when you\'re happy with the result.'));

    // ----- Filter form -----
    const form = el('form', { class: 'card no-print', id: 'reports-form', onSubmit: async (e) => {
      e.preventDefault();
      const body = {
        from: form.elements['from'].value,
        to:   form.elements['to'].value,
        cohortId: form.elements['cohortId'].value || null,
      };
      const btn = $('#reports-generate');
      btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Generating…';
      try {
        const data = await API.donorReport(body);
        renderReportResult(data);
      } catch (err) {
        toast('Could not generate: ' + (err.message || 'server error'));
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    } }, [
      el('div', { class: 'row wrap', style: 'gap:12px' }, [
        el('div', { class: 'form-group', style: 'flex:0 0 160px' }, [
          el('label', null, 'From'),
          el('input', { name: 'from', type: 'date', value: range.from, required: true })
        ]),
        el('div', { class: 'form-group', style: 'flex:0 0 160px' }, [
          el('label', null, 'To'),
          el('input', { name: 'to', type: 'date', value: range.to, required: true })
        ]),
        el('div', { class: 'form-group', style: 'flex:1 1 220px; min-width:200px' }, [
          el('label', null, 'Cohort (optional)'),
          (function () {
            const sel = el('select', { name: 'cohortId' });
            sel.appendChild(el('option', { value: '' }, 'All cohorts'));
            cache.cohorts.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'')).forEach((c) => {
              sel.appendChild(el('option', { value: c.id }, c.name || '—'));
            });
            return sel;
          })()
        ])
      ]),
      el('div', { class: 'row', style: 'gap:8px; margin-top:4px' }, [
        el('button', { class: 'btn', type: 'submit', id: 'reports-generate' }, 'Generate'),
        el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => window.print() }, 'Print / Save as PDF')
      ])
    ]);
    main.appendChild(form);

    // Result region — filled by renderReportResult after generation
    const result = el('div', { id: 'reports-result' });
    main.appendChild(result);
  }

  /** Render one report payload into the #reports-result container. */
  function renderReportResult(d) {
    const result = $('#reports-result'); if (!result) return;
    result.innerHTML = '';

    // ----- Print header (only visible when printing) -----
    result.appendChild(el('div', { class: 'print-header' }, [
      el('div', { class: 'print-header__title' }, 'Ubuntu Academy — Donor Report'),
      el('div', { class: 'print-header__sub', style: 'color:#6B6B6B' }, d.period.label)
    ]));

    // ----- Period banner -----
    result.appendChild(el('div', { class: 'card' }, [
      el('h2', { style: 'margin-top:0' }, 'Period: ' + d.period.label),
      el('p', { class: 'small muted', style: 'margin:0' }, d.period.days + ' days')
    ]));

    // ----- KPIs -----
    const k = d.kpis || {};
    result.appendChild(el('div', { class: 'kpis' }, [
      kpi('Attendance rate', (k.attendancePct ?? 0) + '%',
          (k.presentTotal || 0) + ' present / ' + (k.attendanceRecordedTotal || 0) + ' records',
          k.attendancePct || 0),
      kpi('Sessions delivered', k.sessions ?? 0, 'In the period'),
      kpi('Participants', k.participants ?? 0, 'In scope'),
      kpi('Stories collected', k.stories ?? 0, 'With consent + photos'),
    ]));

    // ----- Demographics -----
    const dem = d.demographics || { bySex: {}, byAgeRange: {} };
    const demTotal = Object.values(dem.bySex).reduce((s, n) => s + n, 0);
    const sexLabel = { F: 'Female', M: 'Male', O: 'Other', '': 'Not recorded' };
    const ageLabelOrDash = (a) => a || 'Not recorded';
    result.appendChild(el('div', { class: 'card' }, [
      el('h2', null, 'Demographics'),
      el('div', { class: 'row wrap', style: 'gap:24px' }, [
        el('div', { style: 'flex:1 1 200px' }, [
          el('h3', null, 'By sex'),
          renderTable(['Sex', 'Count', '%'], Object.entries(dem.bySex).map(([k, n]) => [
            sexLabel[k] || k, n, demTotal ? Math.round(n*100/demTotal) + '%' : '—'
          ]))
        ]),
        el('div', { style: 'flex:1 1 200px' }, [
          el('h3', null, 'By age range'),
          renderTable(['Age', 'Count'], Object.entries(dem.byAgeRange).map(([k, n]) => [
            ageLabelOrDash(k), n
          ]))
        ])
      ])
    ]));

    // ----- Per-cohort -----
    result.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row between' }, [
        el('h2', { style: 'margin:0' }, 'By cohort'),
        el('button', { class: 'btn btn--sm btn--ghost no-print', type: 'button',
          onClick: () => downloadCohortsCsv(d.cohorts) }, 'Download CSV')
      ]),
      (d.cohorts || []).length === 0
        ? el('p', { class: 'empty' }, 'No cohorts in range.')
        : renderTable(
            ['Cohort', 'Region', 'Courses', 'Participants', 'Sessions', 'Attendance'],
            d.cohorts.map((c) => [
              c.name, c.region || '—', c.groups, c.participants, c.sessions,
              c.attendanceN > 0 ? c.attendancePct + '%' : '—'
            ])
          )
    ]));

    // ----- Attendance trend (CSS bar chart) -----
    const trend = d.attendanceTrend || [];
    if (trend.length) {
      const maxSessions = Math.max(...trend.map((m) => m.sessions || 0)) || 1;
      result.appendChild(el('div', { class: 'card' }, [
        el('h2', null, 'Attendance trend'),
        el('table', { class: 'data' }, [
          el('thead', null, el('tr', null, [
            el('th', null, 'Month'),
            el('th', null, 'Sessions'),
            el('th', null, 'Attendance'),
            el('th', null, 'Visual')
          ])),
          el('tbody', null, trend.map((m) => el('tr', null, [
            el('td', null, m.month),
            el('td', null, String(m.sessions)),
            el('td', null, m.attendanceN > 0 ? (m.attendancePct + '%') : '—'),
            el('td', null, el('div', {
              style: 'background: var(--brand-tint); height: 12px; border-radius: 4px; min-width: 80px; position: relative; overflow: hidden;'
            }, el('div', {
              style: 'background: var(--brand); height: 100%; width: ' + Math.round((m.sessions / maxSessions) * 100) + '%;'
            })))
          ])))
        ])
      ]));
    }

    // ----- Stories -----
    const stories = d.stories || [];
    result.appendChild(el('div', { class: 'card' }, [
      el('h2', null, 'Selected stories'),
      el('p', { class: 'small muted', style: 'margin-top:-4px' },
        stories.length + ' stor' + (stories.length === 1 ? 'y' : 'ies') +
        ' with explicit consent in the period.'),
      stories.length === 0
        ? el('p', { class: 'empty' }, 'No stories in range — or none had consent.')
        : el('div', null, stories.map(renderStoryCard))
    ]));
  }

  /** A single donor-report story card: photo + text + attribution. */
  function renderStoryCard(s) {
    return el('div', { class: 'story-card' }, [
      s.photoUrl
        ? el('img', { class: 'story-card__photo', src: API_BASE.replace(/\/api$/, '') + s.photoUrl, alt: '' })
        : null,
      el('div', { class: 'story-card__body' }, [
        el('p', { style: 'white-space:pre-wrap; margin:0 0 8px;' }, '"' + (s.text || '') + '"'),
        el('p', { class: 'small muted', style: 'margin:0' },
          [
            s.participant || null,
            s.sessionTheme ? ('Session: ' + s.sessionTheme) : null,
            s.groupName ? ('Group: ' + s.groupName) : null,
            s.sessionDate ? fmtDate(s.sessionDate) : null,
          ].filter(Boolean).join(' · ')
        )
      ])
    ]);
  }

  /** Build & trigger download of a CSV of the per-cohort table. */
  function downloadCohortsCsv(cohorts) {
    const header = ['Cohort', 'Region', 'Courses', 'Participants', 'Sessions', 'AttendancePct', 'AttendanceN'];
    const lines = [header.join(',')];
    (cohorts || []).forEach((c) => {
      lines.push([
        csvCell(c.name), csvCell(c.region || ''),
        c.groups, c.participants, c.sessions, c.attendancePct, c.attendanceN
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'donor-report-cohorts.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ============================================================
  //  helpers (rendering)
  // ============================================================
  function tile(label, value) {
    return el('div', { class: 'tile' }, [
      el('div', { class: 'tile__label' }, label),
      el('div', { class: 'tile__value' }, String(value))
    ]);
  }
  function linkTile(label, value, href) {
    return el('a', { class: 'tile tile--link', href }, [
      el('div', { class: 'tile__label' }, label),
      el('div', { class: 'tile__value' }, String(value))
    ]);
  }
  function kpi(label, value, sub, pct) {
    const node = el('div', { class: 'kpi' }, [
      el('div', { class: 'kpi__label' }, label),
      el('div', { class: 'kpi__value' }, String(value)),
      el('div', { class: 'kpi__sub' }, sub),
    ]);
    if (typeof pct === 'number') {
      node.appendChild(el('div', { class: 'kpi__bar' },
        el('div', { class: 'kpi__bar-fill', style: 'width:' + Math.max(0, Math.min(100, pct)) + '%' })
      ));
    }
    return node;
  }
  /**
   * @param {Array<string>} headers
   * @param {Array<Array<*>>} rows
   * @param {Function} [onRowClick]  fn(rowIndex) — when provided, rows become clickable
   */
  function renderTable(headers, rows, onRowClick) {
    const wrap = el('div', { class: 'table-wrap' });
    const tbl = el('table', { class: 'data' });
    const thead = el('thead'); const trh = el('tr');
    headers.forEach((h) => trh.appendChild(el('th', null, h)));
    thead.appendChild(trh); tbl.appendChild(thead);
    const tbody = el('tbody');
    rows.forEach((r, idx) => {
      const tr = el('tr');
      if (onRowClick) {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
          // Don't fire when clicking an embedded button/link inside the row
          if (e.target.closest('button, a')) return;
          onRowClick(idx);
        });
      }
      r.forEach((cell) => {
        if (cell instanceof Node) {
          const td = el('td'); td.appendChild(cell); tr.appendChild(td);
        } else {
          tr.appendChild(el('td', null, cell == null ? '' : String(cell)));
        }
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody); wrap.appendChild(tbl); return wrap;
  }
  function groupBy(arr, key) {
    const m = new Map();
    arr.forEach((r) => { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return m;
  }
  function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
  function userName(id) {
    const u = cache.users.find((x) => x.id === id);
    return u ? (u.name || u.email) : '';
  }

  // ============================================================
  //  user actions (modals & API calls)
  // ============================================================
  function openInviteModal() {
    const bg = el('div', { class: 'modal-bg', onClick: (e) => { if (e.target === bg) bg.remove(); } });
    const errEl = el('p', { class: 'error', hidden: true });
    const tempPwBox = el('p', { class: 'small', hidden: true, style: 'background:#FFF9D8;padding:8px 10px;border-radius:8px;' });

    const form = el('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        errEl.hidden = true;
        const fd = new FormData(form);
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          const r = await API.createUser({
            email: fd.get('email'),
            phone: (fd.get('phone') || '').trim(),
            username: fd.get('username') || '',
            firstName: (fd.get('firstName') || '').trim(),
            lastName:  (fd.get('lastName')  || '').trim(),
            role: fd.get('role') || 'trainer',
            language: fd.get('language') || 'fr',
          });
          await refresh();
          renderUsers();
          tempPwBox.hidden = false;
          const status = r.emailSent
            ? '<span style="color:#1E5C3D">&#10004; Invitation email sent to <strong>' + r.user.email + '</strong>.</span>'
            : '<span style="color:#7A4F00">&#9888; Email could not be sent (Brevo config). Share the temp password manually:</span>';
          tempPwBox.innerHTML =
            status +
            '<br><br><strong>Temporary password:</strong> <code>' + r.tempPassword + '</code>' +
            '<br><span class="muted small">The trainer will be asked to change it on first login.</span>';
          form.querySelectorAll('input').forEach((i) => { i.value = ''; });
        } catch (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
        } finally {
          btn.disabled = false;
        }
      }
    }, [
      el('h2', null, 'Invite trainer'),
      errEl,
      tempPwBox,
      // All three (first name, last name, email) are required at creation
      el('div', { class: 'row', style: 'gap:10px' }, [
        el('div', { class: 'form-group', style: 'flex:1; min-width:0' }, [
          el('label', null, 'First name'),
          el('input', { name: 'firstName', type: 'text', required: true, autocomplete: 'given-name', maxlength: '80' })
        ]),
        el('div', { class: 'form-group', style: 'flex:1; min-width:0' }, [
          el('label', null, 'Last name'),
          el('input', { name: 'lastName', type: 'text', required: true, autocomplete: 'family-name', maxlength: '80' })
        ])
      ]),
      formGroup('Email (unique identifier)', el('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' })),
      formGroup('Phone (optional)', el('input', { name: 'phone', type: 'tel', autocomplete: 'tel', placeholder: '+257…' })),
      formGroup('Username (leave blank to use email)', el('input', { name: 'username', type: 'text' })),
      formGroup('Role', selectEl('role', [{ v: 'trainer', l: 'Trainer' }, { v: 'admin', l: 'Admin' }], 'trainer')),
      formGroup('Language', selectEl('language', [{ v: 'fr', l: 'Français' }, { v: 'en', l: 'English' }, { v: 'rn', l: 'Ikirundi' }], 'fr')),
      el('div', { class: 'row', style: 'margin-top:8px; gap:8px; justify-content:flex-end' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => bg.remove() }, 'Close'),
        el('button', { class: 'btn', type: 'submit' }, 'Create')
      ])
    ]);
    const modal = el('div', { class: 'modal' }, form);
    bg.appendChild(modal);
    document.body.appendChild(bg);
  }

  function formGroup(label, control) {
    return el('div', { class: 'form-group' }, [el('label', null, label), control]);
  }
  function selectEl(name, options, value) {
    const sel = el('select', { name });
    options.forEach((o) => {
      const opt = el('option', { value: o.v }, o.l);
      if (value === o.v) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }

  async function toggleRole(u) {
    if (!confirm('Change role for ' + u.email + '?')) return;
    try {
      await API.updateUser(u.id, { role: u.role === 'admin' ? 'trainer' : 'admin' });
      await refresh();
      renderUsers();
      toast('Role updated');
    } catch (e) { toast(e.message); }
  }
  async function toggleDisabled(u) {
    const verb = u.disabledAt ? 'Re-enable' : 'Disable';
    if (!confirm(verb + ' ' + u.email + '?')) return;
    try {
      await API.updateUser(u.id, { disabled: !u.disabledAt });
      await refresh();
      renderUsers();
      toast(verb + 'd');
    } catch (e) { toast(e.message); }
  }
  async function sendReset(u) {
    if (!confirm('Send a password reset email to ' + u.email + '?')) return;
    try {
      const r = await API.sendReset(u.id);
      toast(r.emailSent ? 'Reset email sent' : 'Reset token issued (email not sent — check Brevo config)');
    } catch (e) { toast(e.message); }
  }
  async function deleteUser(u) {
    if (!confirm('Permanently delete ' + (u.name || u.email) + '?\n\nThis cannot be undone. Any cohorts, sessions, or stories they created will remain (with no author).')) return;
    // Second confirmation as a small safety net
    const typed = prompt('Type DELETE to confirm:');
    if (typed !== 'DELETE') { toast('Cancelled'); return; }
    try {
      await API.deleteUser(u.id);
      await refresh();
      renderUsers();
      toast('User deleted');
    } catch (e) { toast(e.message); }
  }

  // ============================================================
  //  Media download with auth header
  // ============================================================
  async function downloadMedia(e, storyId, kind) {
    e.preventDefault();
    try {
      const resp = await fetch(API_BASE + '/stories/' + storyId + '/media/' + kind, {
        headers: { 'Authorization': 'Bearer ' + getToken() }
      });
      if (!resp.ok) { toast('Cannot fetch media: ' + resp.status); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { toast(err.message); }
  }

  // ============================================================
  //  create modals (cohort / course / session / story / participant)
  // ============================================================

  /** Push a single record of one entity to the server's sync endpoint. */
  async function pushOne(entityName, record) {
    const payload = {};
    payload[entityName] = [record];
    return API.syncPush(payload);
  }

  async function openCohortModal(existing) {
    const isEdit = !!existing;
    await openFormModal({
      title: isEdit ? 'Edit cohort' : 'New cohort',
      fields: [
        { name: 'name',      label: 'Name',        type: 'text', required: true, value: isEdit ? existing.name : '',      placeholder: 'e.g. MAHAMA_2025' },
        { name: 'region',    label: 'Region',      type: 'text',                   value: isEdit ? existing.region : '',    placeholder: 'e.g. Mahama' },
        { name: 'startDate', label: 'Start date',  type: 'date',                   value: isEdit ? (existing.startDate || '') : '' },
        { name: 'endDate',   label: 'End date',    type: 'date',                   value: isEdit ? (existing.endDate   || '') : '' },
      ],
      saveLabel: isEdit ? 'Update' : 'Save',
      onSave: async (v) => {
        const rec = {
          id: isEdit ? existing.id : genUuid(),
          name: v.name,
          region: v.region || null,
          startDate: v.startDate || null,
          endDate:   v.endDate   || null,
        };
        await pushOne('cohorts', rec);
        toast(isEdit ? 'Cohort updated' : 'Cohort created');
        await refresh();
        renderCohorts();
      },
      onDelete: isEdit ? async () => {
        await softDelete('cohorts', existing.id);
        toast('Cohort deleted');
        await refresh();
        renderCohorts();
      } : null,
      deleteConfirm: 'Delete this cohort? Its courses and participants will keep their data but will no longer be grouped under any cohort.',
    });
  }

  /** Trigger a Moodle sync from the Courses page. Same backend as the PWA's
   *  sessions-screen button. Refreshes the cache and re-renders on success. */
  async function runMoodleSyncFromCourses() {
    const main = $('#main');
    // Lightweight inline status — avoid blocking the user with a modal
    toast('Syncing from Ubuntu eLearning…');
    try {
      const r = await API.moodleSync();
      const s = (r && r.summary) || {};
      if (s.skipped) {
        toast('Sync not configured — check moodle.url / moodle.ws_token in config.php');
      } else if ((s.errors || []).length) {
        console.warn('[admin moodle-sync] errors:', s.errors);
        toast(s.errors.length + ' group(s) failed — see console');
      } else {
        const parts = [];
        if (s.sessions_created)     parts.push('+' + s.sessions_created + ' sessions');
        if (s.sessions_updated)     parts.push('~' + s.sessions_updated + ' sessions');
        if (s.participants_created) parts.push('+' + s.participants_created + ' participants');
        if (s.participants_updated) parts.push('~' + s.participants_updated + ' participants');
        toast(parts.length ? parts.join(' · ') : 'Sync complete — nothing changed.');
      }
      await refresh();
      renderGroups();
    } catch (err) {
      toast(err.message || 'Moodle sync failed');
    }
  }

  async function openCourseModal(existing) {
    const isEdit = !!existing;
    if (!cache.cohorts.length && !isEdit) {
      toast('Create a cohort first');
      return;
    }
    const cohortOpts = cache.cohorts.slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map((c) => ({ v: c.id, l: c.name || '—' }));
    // v0.3.5i — Facilitators come from the staff directory now (trainer +
    // admin users only). Multi-select via a checkbox list inside the modal.
    const staff = (cache.users || [])
      .filter((u) => (u.role === 'trainer' || u.role === 'admin') && !u.disabledAt)
      .sort((a, b) => ((a.firstName || '') + (a.lastName || '')).localeCompare((b.firstName || '') + (b.lastName || '')));
    const initialFacIds = new Set(
      Array.isArray(existing && existing.facilitatorIds) ? existing.facilitatorIds : []
    );
    await openFormModal({
      title: isEdit ? 'Edit course' : 'New course',
      fields: [
        { name: 'cohortId',        label: 'Cohort',         type: 'select', options: cohortOpts, required: true, value: isEdit ? existing.cohortId : '' },
        { name: 'name',            label: 'Course name',    type: 'text', required: true, value: isEdit ? existing.name : '', placeholder: 'e.g. Audio History' },
        {
          name: 'facilitatorIds',
          label: 'Facilitators (staff)',
          type: 'custom',
          render: () => {
            // Selected set + live query, mutated by handlers below.
            const selected = new Set(initialFacIds);
            let query = '';

            const wrap = el('div');
            const chipsHolder = el('div', { style: 'display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px' });
            const search = el('input', {
              type: 'text', placeholder: 'Search staff…', autocomplete: 'off',
              style: 'width:100%; padding:8px 10px; border:1px solid var(--border); border-radius:8px; font-size:14px; margin-bottom:6px'
            });
            const listEl = el('div', {
              style: 'max-height:220px; overflow-y:auto; border:1px solid var(--border); border-radius:8px'
            });

            function displayName(u) {
              return ((u && u.firstName || '') + ' ' + (u && u.lastName || '')).trim() || (u && u.email) || '—';
            }

            function renderChips() {
              chipsHolder.innerHTML = '';
              if (!selected.size) return;
              Array.from(selected).forEach((id) => {
                const u = staff.find((s) => s.id === id);
                const chip = el('span', {
                  style: 'display:inline-flex; align-items:center; gap:6px; background:var(--brand-tint); color:var(--brand); border-radius:999px; padding:3px 8px 3px 10px; font-size:13px; font-weight:600'
                }, [
                  el('span', null, displayName(u || { id })),
                  el('button', {
                    type: 'button', 'aria-label': 'Remove',
                    style: 'background:transparent; border:0; color:inherit; cursor:pointer; font-size:16px; line-height:1; padding:0 2px',
                    onClick: () => { selected.delete(id); renderChips(); renderList(); }
                  }, '×')
                ]);
                chipsHolder.appendChild(chip);
              });
            }

            function renderList() {
              listEl.innerHTML = '';
              if (!staff.length) {
                listEl.appendChild(el('p', { class: 'small muted', style: 'margin:8px 10px' }, 'No staff users yet — invite a trainer first.'));
                return;
              }
              const q = query.trim().toLowerCase();
              const filtered = staff.filter((u) => {
                if (!q) return true;
                const hay = (displayName(u) + ' ' + (u.email || '')).toLowerCase();
                return hay.indexOf(q) !== -1;
              });
              if (!filtered.length) {
                listEl.appendChild(el('p', { class: 'small muted', style: 'margin:8px 10px' }, 'No one matches.'));
                return;
              }
              filtered.forEach((u) => {
                const cb = el('input', { type: 'checkbox', value: u.id });
                if (selected.has(u.id)) cb.checked = true;
                cb.addEventListener('change', () => {
                  if (cb.checked) selected.add(u.id);
                  else selected.delete(u.id);
                  renderChips();
                });
                listEl.appendChild(el('label', {
                  style: 'display:flex; align-items:center; gap:8px; padding:6px 10px; cursor:pointer; border-bottom:1px solid var(--border)'
                }, [
                  cb,
                  el('div', { style: 'flex:1' }, [
                    el('div', null, displayName(u)),
                    el('div', { class: 'small muted' }, u.role === 'admin' ? 'admin' : 'trainer')
                  ])
                ]));
              });
            }

            search.addEventListener('input', () => { query = search.value; renderList(); });

            wrap.appendChild(chipsHolder);
            wrap.appendChild(search);
            wrap.appendChild(listEl);
            renderChips();
            renderList();

            return { node: wrap, getValue: () => Array.from(selected) };
          }
        },
        { name: 'moodleCourseId',  label: 'Linked Moodle course ID (optional)', type: 'number', value: isEdit ? (existing.moodleCourseId || '') : '', placeholder: 'e.g. 12' },
      ],
      saveLabel: isEdit ? 'Update' : 'Save',
      onSave: async (v) => {
        const ids = Array.isArray(v.facilitatorIds) ? v.facilitatorIds : [];
        // Mirror the joined names into the legacy text column so older
        // clients (and any read path that hasn't been migrated yet) still
        // see who's running the course.
        const facText = ids
          .map((id) => {
            const u = staff.find((s) => s.id === id);
            return u ? (((u.firstName || '') + ' ' + (u.lastName || '')).trim() || u.email || '') : '';
          })
          .filter(Boolean)
          .join(', ');
        const rec = {
          id: isEdit ? existing.id : genUuid(),
          cohortId: v.cohortId,
          name: v.name,
          facilitator: facText || null,
          facilitatorIds: ids,
          moodleCourseId: v.moodleCourseId ? parseInt(v.moodleCourseId, 10) : null,
        };
        await pushOne('groups', rec);
        toast(isEdit ? 'Course updated' : 'Course created');
        await refresh();
        renderGroups();
      },
      onDelete: isEdit ? async () => {
        await softDelete('groups', existing.id);
        toast('Course deleted');
        await refresh();
        renderGroups();
      } : null,
      deleteConfirm: 'Delete this course? Participants, sessions and stories already linked will keep their data but will no longer be under any course.',
    });
  }

  async function openSessionModal(existing) {
    const isEdit = !!existing;
    if (!cache.groups.length && !isEdit) {
      toast('Create a course first');
      return;
    }
    const isMoodle = isEdit && existing.source === 'moodle';
    const courseOpts = cache.groups.slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map((g) => ({ v: g.id, l: g.name || '—' }));
    await openFormModal({
      title: isEdit ? 'Edit session' : 'New session',
      fields: [
        { name: 'groupId',  label: 'Course',   type: 'select', options: courseOpts, required: true, value: isEdit ? existing.groupId : '', disabled: isMoodle },
        { name: 'date',     label: 'Date',     type: 'date', required: true, value: isEdit ? (existing.date || todayIso()) : todayIso(), disabled: isMoodle },
        { name: 'theme',    label: 'Theme',    type: 'text', required: true, value: isEdit ? (existing.theme || '') : '', placeholder: 'e.g. Inclusive communication', disabled: isMoodle },
        { name: 'location', label: 'Location', type: 'text', value: isEdit ? (existing.location || '') : '' },
        { name: 'notes',    label: 'Notes',    type: 'textarea', value: isEdit ? (existing.notes || '') : '' },
      ],
      saveLabel: isEdit ? 'Update' : 'Save',
      onSave: async (v) => {
        const rec = isMoodle
          ? { id: existing.id, location: v.location || null, notes: v.notes || null }
          : {
              id: isEdit ? existing.id : genUuid(),
              groupId: v.groupId,
              date: v.date,
              theme: v.theme,
              location: v.location || null,
              notes: v.notes || null,
            };
        await pushOne('sessions', rec);
        toast(isEdit ? 'Session updated' : 'Session created');
        await refresh();
        renderSessions();
      },
      onDelete: isEdit && !isMoodle ? async () => {
        await softDelete('sessions', existing.id);
        toast('Session deleted');
        await refresh();
        renderSessions();
      } : null,
      deleteConfirm: 'Delete this session? Recorded attendance and stories will be kept.',
    });
  }

  async function openStoryModal(existing) {
    const isEdit = !!existing;
    const sessionOpts = [{ v: '', l: '— None —' }].concat(
      cache.sessions.slice()
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .map((s) => ({ v: s.id, l: (s.theme || '?') + ' (' + (s.date || '') + ')' }))
    );
    const participantOpts = [{ v: '', l: '— None —' }].concat(
      cache.participants.slice()
        .sort((a, b) => ((a.firstName || '') + ' ' + (a.lastName || '')).localeCompare((b.firstName || '') + ' ' + (b.lastName || '')))
        .map((p) => ({ v: p.id, l: ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || '?' }))
    );
    await openFormModal({
      title: isEdit ? 'Edit story' : 'New story',
      fields: [
        { name: 'text',          label: 'Story text', type: 'textarea', required: true, value: isEdit ? (existing.text || '') : '' },
        { name: 'sessionId',     label: 'Linked session (optional)', type: 'select', options: sessionOpts, value: isEdit ? (existing.sessionId || '') : '' },
        { name: 'participantId', label: 'Linked participant (optional)', type: 'select', options: participantOpts, value: isEdit ? (existing.participantId || '') : '' },
        { name: 'consent',       label: 'Explicit consent obtained', type: 'checkbox', value: isEdit ? !!existing.consent : false },
        { name: 'publishable',   label: 'Publish on the public news page (requires consent)', type: 'checkbox', value: isEdit ? !!existing.publishable : false },
      ],
      saveLabel: isEdit ? 'Update' : 'Save',
      onSave: async (v) => {
        if (v.publishable && !v.consent) {
          throw new Error('Publish requires consent first.');
        }
        const rec = {
          id: isEdit ? existing.id : genUuid(),
          text: v.text,
          sessionId:     v.sessionId     || null,
          participantId: v.participantId || null,
          consent:     !!v.consent,
          publishable: !!v.publishable,
          hasPhoto: isEdit ? !!existing.hasPhoto : false,
          hasAudio: isEdit ? !!existing.hasAudio : false,
        };
        await pushOne('stories', rec);
        toast(isEdit ? 'Story updated' : 'Story created');
        await refresh();
        renderStories();
      },
      onDelete: isEdit ? async () => {
        await softDelete('stories', existing.id);
        toast('Story deleted');
        await refresh();
        renderStories();
      } : null,
      deleteConfirm: 'Delete this story? Photos/audio attached will be removed too.',
    });
  }

  /**
   * Edit an existing participant: sex/ageRange/contact are always editable;
   * if attendance exists, hard-delete is blocked — admin can Drop instead.
   */
  async function openParticipantEditModal(p) {
    const isMoodle = p.source === 'moodle';
    // Only attendance with present=true counts as "history worth preserving".
    // Unticked roster rows shouldn't block deletion.
    const hasAttendance = (cache.attendance || []).some((a) => a.participantId === p.id && a.present);
    const courseName = (cache.groups.find((g) => g.id === p.groupId) || {}).name || '—';
    // v0.3.5e — sex/age live on the user now. Read from the linked user when possible.
    // v0.3.5f — phone too lives on the user.
    const linkedUser = p.userId ? (cache.users || []).find((u) => u.id === p.userId) : null;
    const sexValue      = linkedUser ? (linkedUser.sex      || '') : (p.sex      || '');
    const ageRangeValue = linkedUser ? (linkedUser.ageRange || '') : (p.ageRange || '');
    const phoneValue    = linkedUser ? (linkedUser.phone    || '') : '';
    const sexOpts = [
      { v: '',  l: '—' },
      { v: 'F', l: 'F' }, { v: 'M', l: 'M' }, { v: 'O', l: 'O' }
    ];
    const ageOpts = [
      { v: '', l: '—' },
      { v: '<18', l: '<18' }, { v: '18-24', l: '18-24' }, { v: '25-34', l: '25-34' },
      { v: '35-44', l: '35-44' }, { v: '45-54', l: '45-54' }, { v: '55+', l: '55+' }
    ];
    const isDropped = p.status === 'dropped';

    await openFormModal({
      title: 'Edit participant — ' + courseName,
      fields: [
        { name: 'firstName', label: 'First name', type: 'text', required: true, value: p.firstName || '', disabled: isMoodle },
        { name: 'lastName',  label: 'Last name',  type: 'text',                   value: p.lastName  || '', disabled: isMoodle },
        { name: 'phone',     label: 'Phone (on the person)',     type: 'tel',    value: phoneValue },
        { name: 'sex',       label: 'Sex (on the person)',       type: 'select', options: sexOpts, value: sexValue },
        { name: 'ageRange',  label: 'Age range (on the person)', type: 'select', options: ageOpts, value: ageRangeValue },
        { name: 'contact',   label: 'Contact (course-scoped, legacy)', type: 'text', value: p.contact || '', disabled: isMoodle },
      ],
      saveLabel: 'Update',
      onSave: async (v) => {
        // Write sex/age/phone to the LINKED USER (intrinsic to the person), and the
        // course-scoped fields (firstName/lastName/contact) to the participant.
        if (p.userId) {
          await API.updateUser(p.userId, {
            sex: v.sex || '',
            ageRange: v.ageRange || '',
            phone: v.phone || '',
          });
        }
        const partRec = isMoodle
          ? { id: p.id }   // nothing course-scoped to update for synced participants
          : { id: p.id,
              firstName: v.firstName, lastName: v.lastName || null,
              contact: v.contact || null };
        // Keep sex/age in sync on the participant row too for back-compat
        partRec.sex      = v.sex      || null;
        partRec.ageRange = v.ageRange || null;
        if (Object.keys(partRec).length > 1) {
          await pushOne('participants', partRec);
        }
        toast('Participant updated');
        await refresh();
        renderParticipants();
      },
      onDelete: hasAttendance
        ? (isDropped ? null : async () => {
            // Has attendance → Drop instead of Delete
            const rec = { id: p.id, status: 'dropped' };
            await pushOne('participants', rec);
            toast('Participant dropped');
            await refresh();
            renderParticipants();
          })
        : async () => {
            await softDelete('participants', p.id);
            toast('Participant deleted');
            await refresh();
            renderParticipants();
          },
      deleteLabel:
        isDropped ? null
        : hasAttendance ? 'Drop'
        : 'Delete',
      deleteConfirm:
        hasAttendance
          ? 'This participant has attendance records. Drop them? They\'ll stay on the roster with a "Dropped" badge but won\'t be selectable for new sessions.'
          : 'Delete this participant?',
    });
  }

  /**
   * Admin "+ Add participant": two-step modal.
   *   1. Pick the target course
   *   2. Pick a user from the directory (with search), or create a new one
   */
  async function openParticipantModal() {
    if (!cache.groups.length) {
      toast('Create a course first');
      return;
    }
    const courseOpts = cache.groups.slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map((g) => ({ v: g.id, l: g.name || '—' }));

    const bg = el('div', { class: 'modal-bg', onClick: (e) => { if (e.target === bg) bg.remove(); } });
    const modal = el('div', { class: 'modal' });
    const status = el('p', { class: 'small muted', style: 'margin-top:6px' }, 'Type 2+ letters to search.');
    const listEl = el('div');
    const courseSelect = el('select', { name: 'courseId' });
    courseOpts.forEach((o) => {
      const opt = el('option', { value: o.v }, o.l);
      courseSelect.appendChild(opt);
    });
    const search = el('input', {
      name: 'q', type: 'text', placeholder: 'Search a person (first name, last name, email)…', autocomplete: 'off',
      style: 'width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; font-size:14px; margin-bottom:8px;'
    });

    async function addUserToCourse(u) {
      const targetCourseId = courseSelect.value;
      // Guard against duplicates. The server's pick endpoint already filters
      // enrolled users out of the search, but the "+ Create new person" path
      // can reuse an existing user by email — that user might already be on
      // this course's roster.
      const already = (cache.participants || []).some((p) =>
        p.groupId === targetCourseId &&
        p.userId  === u.id &&
        !p.walkInSessionId &&
        !p.deletedAt
      );
      if (already) {
        const nm = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || u.email || 'This person';
        toast(nm + ' is already enrolled in this course.');
        bg.remove();
        return;
      }
      const newP = {
        id: genUuid(),
        userId: u.id,
        groupId: targetCourseId,
        firstName: u.firstName || '',
        lastName:  u.lastName  || '',
        sex: null,
        ageRange: null,
        contact: (u.syntheticEmail ? null : (u.email || null)),
      };
      await pushOne('participants', newP);
      toast('Participant added to course');
      bg.remove();
      await refresh();
      renderParticipants();
    }

    let inflight = null;
    async function runSearch() {
      const q = search.value.trim();
      if (q.length < 2) { status.textContent = 'Type 2+ letters to search.'; listEl.innerHTML = ''; return; }
      status.textContent = 'Searching…';
      const myReq = (inflight = {});
      try {
        const r = await API.pickUsers(courseSelect.value, q);
        if (myReq !== inflight) return;
        const users = (r && r.users) || [];
        listEl.innerHTML = '';
        if (!users.length) { status.textContent = 'No one matches.'; return; }
        status.textContent = users.length + ' result' + (users.length === 1 ? '' : 's');
        users.forEach((u) => {
          listEl.appendChild(el('button', {
            class: 'btn btn--ghost btn--block', type: 'button',
            style: 'justify-content:flex-start; text-align:left; margin-bottom:6px',
            onClick: () => addUserToCourse(u)
          }, (((u.firstName || '') + ' ' + (u.lastName || '')).trim() || '?')
            + (u.syntheticEmail ? '' : ' · ' + u.email)));
        });
      } catch (err) {
        if (myReq !== inflight) return;
        status.textContent = 'Network error. Try again.';
      }
    }
    let dbTimer = null;
    search.addEventListener('input', () => { clearTimeout(dbTimer); dbTimer = setTimeout(runSearch, 250); });
    courseSelect.addEventListener('change', runSearch);

    modal.appendChild(el('h2', null, 'Add participant'));
    modal.appendChild(formGroup('Course', courseSelect));
    modal.appendChild(formGroup('Search the directory', search));
    modal.appendChild(status);
    modal.appendChild(listEl);

    // "+ Create new person" expander — matches Add Trainee fields
    const sexOptsP = [
      { v: '',  l: '—' },
      { v: 'F', l: 'F' }, { v: 'M', l: 'M' }, { v: 'O', l: 'O' }
    ];
    const ageOptsP = [
      { v: '',      l: '—' },
      { v: '<18',   l: '<18' }, { v: '18-24', l: '18-24' }, { v: '25-34', l: '25-34' },
      { v: '35-44', l: '35-44' }, { v: '45-54', l: '45-54' }, { v: '55+',   l: '55+' }
    ];
    const sexSelectP = el('select', { name: 'sex' });
    sexOptsP.forEach((o) => sexSelectP.appendChild(el('option', { value: o.v }, o.l)));
    const ageSelectP = el('select', { name: 'ageRange' });
    ageOptsP.forEach((o) => ageSelectP.appendChild(el('option', { value: o.v }, o.l)));

    const createBtn = el('button', { class: 'btn btn--soft btn--block', type: 'button', style: 'margin-top:12px' }, '+ Create a new person');
    const createForm = el('form', {
      hidden: true, style: 'margin-top:8px',
      onSubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(createForm);
        const firstName = String(fd.get('firstName') || '').trim();
        const lastName  = String(fd.get('lastName')  || '').trim();
        const email     = String(fd.get('email')     || '').trim();
        const phone     = String(fd.get('phone')     || '').trim();
        const sex       = String(fd.get('sex')       || '').trim();
        const ageRange  = String(fd.get('ageRange')  || '').trim();
        if (!firstName || !lastName) return;
        const sub = createForm.querySelector('button[type=submit]');
        sub.disabled = true;
        try {
          const r = await API.createUser({
            firstName, lastName, email, phone, sex, ageRange,
            role: 'trainee', sendInvite: false,
          });
          if (r && r.reused) toast('Existing trainee reused — no duplicate created');
          await addUserToCourse({
            id: r.user.id, firstName: r.user.firstName, lastName: r.user.lastName, email: r.user.email,
            syntheticEmail: !email
          });
        } catch (err) {
          toast(err.message || 'Could not create user');
          sub.disabled = false;
        }
      }
    }, [
      el('div', { class: 'row', style: 'gap:8px' }, [
        el('div', { class: 'form-group', style: 'flex:1' }, [
          el('label', null, 'First name'),
          el('input', { name: 'firstName', type: 'text', required: true })
        ]),
        el('div', { class: 'form-group', style: 'flex:1' }, [
          el('label', null, 'Last name'),
          el('input', { name: 'lastName', type: 'text', required: true })
        ])
      ]),
      formGroup('Email (optional — auto-generated if blank)', el('input', { name: 'email', type: 'email', autocomplete: 'email' })),
      formGroup('Phone (optional)', el('input', { name: 'phone', type: 'tel', autocomplete: 'tel', placeholder: '+257…' })),
      el('div', { class: 'row', style: 'gap:8px' }, [
        el('div', { class: 'form-group', style: 'flex:1' }, [
          el('label', null, 'Sex'),
          sexSelectP
        ]),
        el('div', { class: 'form-group', style: 'flex:1' }, [
          el('label', null, 'Age range'),
          ageSelectP
        ])
      ]),
      el('div', { class: 'row', style: 'gap:8px; justify-content:flex-end' }, [
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => { createForm.reset(); createForm.hidden = true; createBtn.hidden = false; } }, 'Cancel'),
        el('button', { class: 'btn', type: 'submit' }, 'Create & add to course')
      ])
    ]);
    createBtn.addEventListener('click', () => { createForm.hidden = false; createBtn.hidden = true; });
    modal.appendChild(createBtn);
    modal.appendChild(createForm);

    // Close
    modal.appendChild(el('div', { class: 'row', style: 'gap:8px; justify-content:flex-end; margin-top:14px' },
      el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => bg.remove() }, 'Close')
    ));

    // Add admin's createUser API endpoint (admin.js calls /users which expects auth)
    // (We reuse API.createUser which already exists.)

    bg.appendChild(modal);
    document.body.appendChild(bg);
    setTimeout(() => search.focus(), 0);
  }

  // ============================================================
  //  routing
  // ============================================================
  function currentSection() {
    return (location.hash || '#dashboard').replace(/^#/, '').split('?')[0] || 'dashboard';
  }
  function setActiveNav() {
    const s = currentSection();
    document.querySelectorAll('.nav-item').forEach((n) => {
      if (n.dataset.section === s) n.classList.add('active');
      else n.classList.remove('active');
    });
  }
  function renderCurrent() {
    setActiveNav();
    const s = currentSection();
    const renderers = {
      dashboard: renderDashboard,
      users: renderUsers,
      trainees: renderTrainees,
      cohorts: renderCohorts, groups: renderGroups, participants: renderParticipants,
      sessions: renderSessions, stories: renderStories, reports: renderReports
    };
    (renderers[s] || renderDashboard)();
    // Close sidebar on mobile
    document.getElementById('sidebar').classList.remove('open');
  }

  // ============================================================
  //  boot
  // ============================================================
  async function showApp() {
    console.log('[showApp] start');
    $('#login').hidden = true;
    $('#app').hidden = false;
    const user = getUser() || {};
    console.log('[showApp] user from localStorage:', user);
    if (!user.id) {
      console.warn('[showApp] no user.id — falling back to login');
      renderLogin();
      return;
    }
    if (user.role !== 'admin') {
      console.warn('[showApp] user role is not admin:', user.role);
      toast('Admin access required.');
      await API.logout();
      renderLogin();
      return;
    }
    $('#user-pill').textContent = (user.email || '');
    console.log('[showApp] calling refresh()');
    try {
      await refresh();
      console.log('[showApp] refresh OK; cache sizes:', {
        cohorts: cache.cohorts.length, groups: cache.groups.length,
        participants: cache.participants.length, sessions: cache.sessions.length,
        attendance: cache.attendance.length, stories: cache.stories.length,
        users: cache.users.length
      });
      renderCurrent();
      console.log('[showApp] renderCurrent done');
    } catch (e) {
      console.error('[showApp] failed:', e);
      if (e && e.status === 401) {
        await API.logout();
        renderLogin();
        return;
      }
      cache.cohorts = []; cache.groups = []; cache.participants = [];
      cache.sessions = []; cache.attendance = []; cache.stories = []; cache.users = [];
      try { renderCurrent(); } catch (e2) { console.error('[showApp] renderCurrent also failed:', e2); }
      toast('Could not load data: ' + (e.message || e));
    }
  }

  function renderLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Login form
    const f = $('#login-form');
    const errEl = $('#login-error');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.hidden = true;
      const btn = $('#login-btn');
      btn.disabled = true;
      try {
        const fd = new FormData(f);
        const user = await API.login(fd.get('email'), fd.get('password'));
        if (user.role !== 'admin') {
          await API.logout();
          errEl.textContent = 'Admin access required.';
          errEl.hidden = false;
          return;
        }
        await showApp();
      } catch (err) {
        errEl.textContent = err.status === 401 ? 'Wrong username/email or password.' : (err.message || 'Server error');
        errEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });

    // Forgot password — send a reset email via the server endpoint
    const forgotLink = $('#login-forgot');
    if (forgotLink) {
      forgotLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = (prompt('Enter your account email to receive a password reset link:') || '').trim();
        if (!email) return;
        try {
          await API.forgotPassword(email);
          alert('If that account exists, a reset link has been sent. Check your inbox.');
        } catch (err) {
          alert('Could not send reset email: ' + (err.message || 'server error'));
        }
      });
    }

    $('#logout-btn').addEventListener('click', async () => {
      await API.logout();
      renderLogin();
    });
    // Manual refresh — pulls latest from the server and re-renders the current view.
    // Useful when changes happened elsewhere (PWA, another admin, Moodle sync).
    $('#refresh-btn').addEventListener('click', async () => {
      const btn = $('#refresh-btn');
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = '… Refreshing';
      try {
        await refresh();
        renderCurrent();
        toast('Refreshed');
      } catch (err) {
        toast(err.message || 'Refresh failed');
      } finally {
        btn.textContent = orig;
        btn.disabled = false;
      }
    });
    $('#hamburger').addEventListener('click', () => {
      $('#sidebar').classList.toggle('open');
    });
    window.addEventListener('hashchange', renderCurrent);

    // Try auto-login from existing token
    if (getToken()) showApp();
    else renderLogin();
  });
})();
