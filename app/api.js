/* Ubuntu 3.0 — API client
 *
 * Thin fetch wrapper. Stores token + user profile in localStorage so the
 * PWA can stay logged in across reloads without round-tripping.
 *
 * The API base URL defaults to same-origin /api. Override via API.setBase()
 * (exposed in the "More" tab) if you serve the API from a different host.
 */
(function () {
  'use strict';

  const TOKEN_KEY = 'ubuntu30.token';
  const USER_KEY  = 'ubuntu30.user';
  const BASE_KEY  = 'ubuntu30.apiBase';

  function getBase() {
    return localStorage.getItem(BASE_KEY) || (location.origin + '/api');
  }
  function setBase(url) {
    if (!url) localStorage.removeItem(BASE_KEY);
    else localStorage.setItem(BASE_KEY, url.replace(/\/+$/, ''));
  }
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
    const url = getBase() + path;
    const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let body;
    if (opts.body !== undefined) {
      if (typeof opts.body === 'string') body = opts.body;
      else { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }
    }
    let resp;
    try {
      resp = await fetch(url, { method, headers, body, credentials: 'omit', cache: 'no-store' });
    } catch (netErr) {
      const e = new Error('network');
      e.code = 'network';
      e.cause = netErr;
      throw e;
    }
    let data = null;
    const ctype = resp.headers.get('content-type') || '';
    if (ctype.indexOf('application/json') !== -1) {
      try { data = await resp.json(); } catch (e) { /* tolerate */ }
    }
    if (!resp.ok) {
      const err = new Error((data && data.error && data.error.message) || ('HTTP ' + resp.status));
      err.code = (data && data.error && data.error.code) || ('http_' + resp.status);
      err.status = resp.status;
      err.data = data;
      // Auto-clear bad token
      if (resp.status === 401) {
        setToken(null);
        setUser(null);
      }
      throw err;
    }
    return data;
  }

  const API = {
    getBase, setBase,
    getToken, getUser,
    isAuthenticated() { return !!getToken(); },

    async login(email, password) {
      const r = await call('POST', '/auth/login', { body: { email, password } });
      setToken(r.token);
      setUser(r.user);
      return r.user;
    },
    async logout() {
      try { await call('POST', '/auth/logout'); } catch (e) { /* ignore */ }
      setToken(null);
      setUser(null);
    },
    async me() {
      const r = await call('GET', '/auth/me');
      setUser(r.user);
      return r.user;
    },
    async changePassword(currentPassword, newPassword) {
      await call('POST', '/auth/change-password', {
        body: { current_password: currentPassword, new_password: newPassword }
      });
      // Refresh stored user (clears must_change_password)
      const u = getUser();
      if (u) { u.must_change_password = false; setUser(u); }
    },
    async syncPull(since) {
      // POST so we sail through corporate proxies (Zscaler etc.) that
      // intercept authenticated GETs.
      return call('POST', '/sync/pull', { body: { since: since || '1970-01-01T00:00:00Z' } });
    },
    async syncPush(payload) {
      return call('POST', '/sync/push', { body: payload });
    },
    async forgotPassword(email) {
      return call('POST', '/auth/forgot-password', { body: { email } });
    },
    async resetPassword(token, newPassword) {
      return call('POST', '/auth/reset-password', { body: { token, new_password: newPassword } });
    },
    async uploadMedia(storyId, kind, blob) {
      return this.uploadMediaOn('stories', storyId, kind, blob);
    },
    async fetchMedia(storyId, kind) {
      return this.fetchMediaOn('stories', storyId, kind);
    },
    /**
     * v0.3.8 — generalized media upload / fetch. `entity` is the URL
     * segment for the parent record's media route — 'stories' for the
     * existing story media, 'sessions' for session photos. The legacy
     * uploadMedia / fetchMedia wrappers above keep the existing
     * stories call sites working.
     */
    async uploadMediaOn(entity, id, kind, blob) {
      const url = getBase() + '/' + entity + '/' + encodeURIComponent(id) + '/media/' + kind;
      const fd = new FormData();
      const ext = kind === 'photo' ? '.jpg' : '.webm';
      fd.append('file', blob, 'media' + ext);
      const token = getToken();
      const resp = await fetch(url, {
        method: 'POST',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        body: fd,
        credentials: 'omit'
      });
      let data = null;
      try { data = await resp.json(); } catch (e) { /* */ }
      if (!resp.ok) {
        const err = new Error((data && data.error && data.error.message) || ('HTTP ' + resp.status));
        err.code = (data && data.error && data.error.code) || 'http_' + resp.status;
        err.status = resp.status;
        throw err;
      }
      return data;
    },
    async deleteMediaOn(entity, id, kind) {
      const url = getBase() + '/' + entity + '/' + encodeURIComponent(id) + '/media/' + kind;
      const token = getToken();
      const resp = await fetch(url, {
        method: 'DELETE',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        credentials: 'omit'
      });
      if (!resp.ok) {
        const e = new Error('HTTP ' + resp.status); e.status = resp.status; throw e;
      }
      try { return await resp.json(); } catch (e) { return null; }
    },
    async fetchMediaOn(entity, id, kind) {
      // POST + /get suffix so corporate proxies (Zscaler etc.) don't intercept
      // an authenticated GET and strip the Authorization header.
      const url = getBase() + '/' + entity + '/' + encodeURIComponent(id) + '/media/' + kind + '/get';
      const token = getToken();
      const resp = await fetch(url, {
        method: 'POST',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        credentials: 'omit'
      });
      if (!resp.ok) {
        const e = new Error('HTTP ' + resp.status); e.status = resp.status; throw e;
      }
      return resp.blob();
    },
    async health() { return call('GET', '/health'); },

    /** Trigger a sync from Ubuntu eLearning (manual). Any authenticated user. */
    async moodleSync() {
      return call('POST', '/admin/moodle/sync');
    },

    /**
     * v0.3.5j — Poll for Moodle-sourced rows newer than `since` (ISO). Used
     * by the header notification bell. POST so corporate proxies don't strip
     * auth on GET requests.
     */
    async moodleNews(since) {
      return call('POST', '/admin/moodle/news', { body: { since: since || '1970-01-01T00:00:00Z' } });
    },

    /**
     * v0.3.5 — Pick from the user directory for course enrolment.
     * Returns up to 50 users not yet enrolled in `courseId`, filtered by `q`.
     * POST (not GET) so corporate proxies don't strip the Authorization header.
     */
    async pickUsers(courseId, q) {
      return call('POST', '/users/pick', { body: { courseId: courseId || null, q: q || '' } });
    },

    /**
     * v0.3.5 — Create a user (admin-only on the server side).
     * For trainees, pass role:'trainee' and sendInvite:false.
     */
    async createUser(body) {
      return call('POST', '/users', { body: body });
    },

    /**
     * v0.3.5i — Minimal directory of staff users (trainers + admins).
     * Any authenticated user can call it. Used by course-facilitator pickers
     * in the PWA. POST so corporate proxies don't strip auth on GET.
     */
    async listStaff() {
      return call('POST', '/users/staff', { body: {} });
    },
  };

  window.API = API;
})();
