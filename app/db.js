/* Ubuntu 3.0 — IndexedDB data layer
 * Local-first storage. Every record carries id (UUID), createdAt, updatedAt, authorId, dirty.
 * The dirty flag is set on every write; v0.2 will clear it after a successful sync.
 */
(function () {
  const DB_NAME = 'ubuntu30';
  const DB_VERSION = 1;
  const STORES = [
    'cohorts',
    'groups',
    'participants',
    'sessions',
    'attendance',
    'stories',
    'meta'
  ];

  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        STORES.forEach((name) => {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            if (name !== 'meta') {
              store.createIndex('updatedAt', 'updatedAt');
            }
            if (name === 'groups') store.createIndex('cohortId', 'cohortId');
            if (name === 'participants') store.createIndex('groupId', 'groupId');
            if (name === 'sessions') store.createIndex('groupId', 'groupId');
            if (name === 'attendance') {
              store.createIndex('sessionId', 'sessionId');
              store.createIndex('participantId', 'participantId');
            }
            if (name === 'stories') {
              store.createIndex('sessionId', 'sessionId');
              store.createIndex('participantId', 'participantId');
            }
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function reqP(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback (RFC4122 v4)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function stamp(record, authorId) {
    const now = new Date().toISOString();
    if (!record.id) record.id = uuid();
    if (!record.createdAt) record.createdAt = now;
    record.updatedAt = now;
    if (authorId && !record.authorId) record.authorId = authorId;
    record.dirty = true;
    return record;
  }

  const DB = {
    uuid,
    async ready() { await openDB(); },

    async put(storeName, record, authorId) {
      stamp(record, authorId);
      const db = await openDB();
      const tx = db.transaction(storeName, 'readwrite');
      await reqP(tx.objectStore(storeName).put(record));
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      return record;
    },

    /**
     * putClean — store a record without re-stamping updatedAt or marking dirty.
     * Used by the sync engine to apply server-authoritative data.
     */
    async putClean(storeName, record) {
      if (!record.id) record.id = uuid();
      const db = await openDB();
      const tx = db.transaction(storeName, 'readwrite');
      await reqP(tx.objectStore(storeName).put(record));
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      return record;
    },

    async get(storeName, id) {
      const db = await openDB();
      return reqP(db.transaction(storeName, 'readonly').objectStore(storeName).get(id));
    },

    /**
     * @param {string} storeName
     * @param {boolean} [includeDeleted=false] — pass true to include tombstones
     *   (only the sync engine should do this; UI calls leave it false).
     */
    async all(storeName, includeDeleted) {
      const db = await openDB();
      const rows = await reqP(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
      return includeDeleted ? rows : rows.filter((r) => !r.deletedAt);
    },

    async byIndex(storeName, indexName, value, includeDeleted) {
      const db = await openDB();
      const store = db.transaction(storeName, 'readonly').objectStore(storeName);
      const idx = store.index(indexName);
      const rows = await reqP(idx.getAll(value));
      return includeDeleted ? rows : rows.filter((r) => !r.deletedAt);
    },

    /**
     * Soft-delete: tombstone the record locally (deletedAt + dirty) so the
     * sync engine pushes the deletion to the server. UI list queries filter
     * tombstones out by default. After the server confirms and the next pull
     * returns the tombstone, applyPull calls hardDelete to remove it.
     */
    async delete(storeName, id) {
      const existing = await this.get(storeName, id);
      if (!existing) return;
      const now = new Date().toISOString();
      existing.deletedAt = now;
      existing.updatedAt = now;
      existing.dirty = true;
      const db = await openDB();
      const tx = db.transaction(storeName, 'readwrite');
      await reqP(tx.objectStore(storeName).put(existing));
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    },

    /** True removal from IndexedDB. Reserved for the sync engine applying
     *  server-side tombstones — UI code should call .delete() instead. */
    async hardDelete(storeName, id) {
      const db = await openDB();
      const tx = db.transaction(storeName, 'readwrite');
      await reqP(tx.objectStore(storeName).delete(id));
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    },

    async clear(storeName) {
      const db = await openDB();
      const tx = db.transaction(storeName, 'readwrite');
      await reqP(tx.objectStore(storeName).clear());
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    },

    async clearAll() {
      const db = await openDB();
      const tx = db.transaction(STORES, 'readwrite');
      STORES.forEach((s) => tx.objectStore(s).clear());
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    },

    /* Meta store: simple key/value */
    async metaGet(key) {
      const rec = await this.get('meta', key);
      return rec ? rec.value : null;
    },
    async metaSet(key, value) {
      const db = await openDB();
      const tx = db.transaction('meta', 'readwrite');
      await reqP(tx.objectStore('meta').put({ id: key, value, updatedAt: new Date().toISOString() }));
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    },

    /* Exports a snapshot of all stores (without blobs) */
    async snapshot() {
      const out = {};
      for (const s of STORES) {
        if (s === 'meta') continue;
        out[s] = await this.all(s);
      }
      return out;
    }
  };

  window.DB = DB;
})();
