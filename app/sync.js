/* Ubuntu 3.0 — Sync engine
 *
 * Push every record with dirty=true, then pull anything updated on the server
 * since our lastSync. Stores sync state in IndexedDB meta. Emits "change"
 * events so the header indicator can refresh.
 *
 * v0.2.0 limitations (Phase B will lift):
 *   - Photo/audio blobs are not synced. Their existence is signalled via
 *     hasPhoto / hasAudio booleans.
 *   - Deletions are not propagated. A record deleted locally won't be
 *     removed on the server.
 */
(function () {
  'use strict';

  const ENTITIES = ['cohorts', 'groups', 'participants', 'sessions', 'attendance', 'stories'];
  const STATE_KEY = 'syncState';

  const listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, data) { (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { /* ignore */ } }); }

  async function getState() {
    return (await DB.metaGet(STATE_KEY)) || { lastSync: null, status: 'idle', error: null };
  }
  async function setState(patch) {
    const s = Object.assign(await getState(), patch);
    await DB.metaSet(STATE_KEY, s);
    emit('change', s);
    return s;
  }

  async function collectDirty() {
    const out = {};
    for (const e of ENTITIES) {
      // includeDeleted=true so tombstones (soft-deleted records) get pushed
      const rows = await DB.all(e, true);
      out[e] = rows.filter((r) => r.dirty).map((r) => {
        const c = Object.assign({}, r);
        delete c.dirty;
        // Strip blobs — v0.2.0 syncs metadata only
        if (c.photo instanceof Blob) { c.hasPhoto = true; delete c.photo; }
        else { c.hasPhoto = !!c.hasPhoto; }
        if (c.audio instanceof Blob) { c.hasAudio = true; delete c.audio; }
        else { c.hasAudio = !!c.hasAudio; }
        return c;
      });
    }
    return out;
  }

  async function clearDirtyForAccepted(accepted, snapshotBefore) {
    for (const e of ENTITIES) {
      const ids = (accepted && accepted[e]) || [];
      for (const id of ids) {
        const local = await DB.get(e, id);
        if (!local) continue;
        const before = (snapshotBefore[e] || []).find((x) => x.id === id);
        // If the record was edited between push start and now, keep it dirty for the next pass.
        if (!before || local.updatedAt === before.updatedAt) {
          local.dirty = false;
          await DB.putClean(e, local);
        }
      }
    }
  }

  async function applyPull(server) {
    for (const e of ENTITIES) {
      const incoming = server[e];
      if (!Array.isArray(incoming)) continue;
      for (const row of incoming) {
        const existing = await DB.get(e, row.id);
        // Preserve any local media blobs the server doesn't know about (v0.2.0 limitation).
        const merged = Object.assign({}, existing || {}, row, { dirty: false });
        if (existing) {
          if (existing.photo instanceof Blob) merged.photo = existing.photo;
          if (existing.audio instanceof Blob) merged.audio = existing.audio;
        }
        // Server flagged a tombstone — hard-remove the local copy. We use
        // hardDelete (not delete) because delete now writes a soft tombstone,
        // and we don't want to re-tombstone what the server already confirmed.
        if (merged.deletedAt) {
          await DB.hardDelete(e, row.id).catch(() => {});
          continue;
        }
        delete merged.deletedAt;
        await DB.putClean(e, merged);
      }
    }
  }

  /**
   * Download any media bytes we should have but don't yet (best effort).
   * Happens after a pull, so stories another trainer captured become visible
   * with their photos and audio on this device too.
   */
  async function downloadMissingMedia() {
    const stories = await DB.all('stories');
    let fetched = 0;
    let failed = 0;
    for (const s of stories) {
      let changed = false;
      if (s.hasPhoto && !isBlobLike(s.photo)) {
        try {
          s.photo = await window.API.fetchMedia(s.id, 'photo');
          s.photoUploaded = true; // already on server
          changed = true;
          fetched++;
        } catch (e) {
          // Server says it doesn't have this file — clear the flag locally so we
          // stop asking on every sync. The trainer can re-attach a new photo later.
          if (e && e.status === 404) { s.hasPhoto = false; changed = true; }
          failed++;
        }
      }
      if (s.hasAudio && !isBlobLike(s.audio)) {
        try {
          s.audio = await window.API.fetchMedia(s.id, 'audio');
          s.audioUploaded = true;
          changed = true;
          fetched++;
        } catch (e) {
          if (e && e.status === 404) { s.hasAudio = false; changed = true; }
          failed++;
        }
      }
      if (changed) await DB.putClean('stories', s);
    }
    return { fetched, failed };
  }

  // Duck-typed blob check — Safari sometimes returns Blobs from IndexedDB without
  // the Blob.prototype chain, so `instanceof Blob` is false. We accept any object
  // that has the right shape (size + slice).
  function isBlobLike(v) {
    return v && typeof v === 'object'
      && typeof v.size === 'number' && v.size > 0
      && typeof v.slice === 'function';
  }

  async function uploadPendingMedia() {
    const stories = await DB.all('stories');
    let uploaded = 0;
    let candidates = 0;
    const attempts = [];
    // Snapshot of every story's media-related fields, so we can show on-screen
    // what state the local DB actually thinks each story is in. Crucial for
    // iOS Safari where we can't open the dev console.
    const inspected = stories.map((s) => ({
      id: s.id.slice(0, 8),
      photo: s.photo ? typeof s.photo + (isBlobLike(s.photo) ? `(${s.photo.size}b)` : '(not-blob)') : '-',
      audio: s.audio ? typeof s.audio + (isBlobLike(s.audio) ? `(${s.audio.size}b)` : '(not-blob)') : '-',
      hasPhoto: !!s.hasPhoto,
      hasAudio: !!s.hasAudio,
      photoUploaded: !!s.photoUploaded,
      audioUploaded: !!s.audioUploaded,
    }));
    for (const s of stories) {
      const needPhoto = isBlobLike(s.photo) && !s.photoUploaded;
      const needAudio = isBlobLike(s.audio) && !s.audioUploaded;
      if (s.photo || s.audio) candidates++;
      if (!needPhoto && !needAudio) continue;
      let okPhoto = !needPhoto;
      let okAudio = !needAudio;
      console.log('[ubuntu30 sync] uploading media for story', s.id.slice(0, 8),
        'photo:', needPhoto ? `${s.photo.size}b` : 'no',
        'audio:', needAudio ? `${s.audio.size}b` : 'no');
      if (needPhoto) {
        try {
          await window.API.uploadMedia(s.id, 'photo', s.photo);
          okPhoto = true; uploaded++;
          attempts.push({ id: s.id.slice(0,8), kind: 'photo', size: s.photo.size, ok: true });
        } catch (e) {
          console.warn('[ubuntu30 sync] photo upload failed', s.id.slice(0, 8), e);
          attempts.push({ id: s.id.slice(0,8), kind: 'photo', size: s.photo.size, ok: false, error: String(e && e.message || e) });
        }
      }
      if (needAudio) {
        try {
          await window.API.uploadMedia(s.id, 'audio', s.audio);
          okAudio = true; uploaded++;
          attempts.push({ id: s.id.slice(0,8), kind: 'audio', size: s.audio.size, ok: true });
        } catch (e) {
          console.warn('[ubuntu30 sync] audio upload failed', s.id.slice(0, 8), e);
          attempts.push({ id: s.id.slice(0,8), kind: 'audio', size: s.audio.size, ok: false, error: String(e && e.message || e) });
        }
      }
      // Persist whichever upload(s) succeeded
      if (okPhoto && needPhoto) s.photoUploaded = true;
      if (okAudio && needAudio) s.audioUploaded = true;
      if ((needPhoto && okPhoto) || (needAudio && okAudio)) {
        await DB.putClean('stories', s);
      }
    }
    if (candidates > 0 || inspected.length > 0) {
      console.log('[ubuntu30 sync] uploadPendingMedia done — candidates:', candidates, 'uploaded:', uploaded);
    }
    // Save diagnostics so the UI can display them (visible on iOS without devtools)
    try {
      await DB.metaSet('lastMediaDiag', {
        at: new Date().toISOString(),
        storyCount: stories.length,
        candidates,
        uploaded,
        attempts,
        inspected,
      });
    } catch (e) { /* ignore */ }
    return uploaded;
  }

  async function syncNow(opts) {
    opts = opts || {};
    if (!window.API || !window.API.isAuthenticated()) {
      await setState({ status: 'idle', error: 'not_authenticated' });
      return { ok: false, reason: 'not_authenticated' };
    }
    if (!navigator.onLine) {
      await setState({ status: 'offline', error: null });
      return { ok: false, reason: 'offline' };
    }
    await setState({ status: 'syncing', error: null });
    try {
      // 1. PUSH dirty metadata
      const dirty = await collectDirty();
      const snapshotBefore = JSON.parse(JSON.stringify(dirty));
      let totalDirty = 0;
      for (const k in dirty) totalDirty += dirty[k].length;
      if (totalDirty > 0) {
        const pushResp = await window.API.syncPush(dirty);
        await clearDirtyForAccepted(pushResp.accepted || {}, snapshotBefore);
      }
      // 2. UPLOAD pending media (best effort)
      const mediaUploaded = await uploadPendingMedia();
      // 3. PULL updates
      const state = await getState();
      const since = state.lastSync || '1970-01-01T00:00:00Z';
      const pullResp = await window.API.syncPull(since);
      await applyPull(pullResp);
      // 4. DOWNLOAD any media we should have but don't yet (best effort)
      const mediaDownload = await downloadMissingMedia();

      await setState({ status: 'idle', lastSync: pullResp.serverTime, error: null });
      emit('synced', {
        at: pullResp.serverTime,
        pushed: totalDirty,
        mediaUploaded,
        mediaDownloaded: mediaDownload.fetched
      });
      return {
        ok: true,
        pushed: totalDirty,
        mediaUploaded,
        mediaDownloaded: mediaDownload.fetched,
        lastSync: pullResp.serverTime
      };
    } catch (err) {
      const code = err && err.code ? err.code : 'unknown';
      await setState({ status: 'error', error: code + ': ' + (err.message || err) });
      emit('error', err);
      return { ok: false, error: err };
    }
  }

  // Auto-sync when network reconnects
  window.addEventListener('online', () => { syncNow(); });
  // Best-effort periodic sync every 5 minutes while the app is open
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, 5 * 60 * 1000);

  /** Manual media-only sync — pushes any pending uploads and fetches anything missing. */
  async function syncMediaOnly() {
    if (!window.API || !window.API.isAuthenticated()) {
      return { ok: false, reason: 'not_authenticated' };
    }
    if (!navigator.onLine) {
      return { ok: false, reason: 'offline' };
    }
    try {
      const uploaded = await uploadPendingMedia();
      const dl = await downloadMissingMedia();
      return { ok: true, uploaded, downloaded: dl.fetched, failed: dl.failed };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  window.SYNC = { syncNow, getState, on, downloadMissingMedia, syncMediaOnly };
})();
