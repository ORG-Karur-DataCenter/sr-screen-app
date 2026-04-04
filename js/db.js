/* =============================================
   SRScreen — IndexedDB Wrapper (db.js)
   Promise-based CRUD for runs, articles, criteria
   ============================================= */

const DB_NAME = 'SRScreenDB';
const DB_VERSION = 3;

let _db = null;

/**
 * Open (or create) the IndexedDB database.
 * Returns a Promise<IDBDatabase>.
 */
export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // ── STORE: runs ──
      if (!db.objectStoreNames.contains('runs')) {
        const runStore = db.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });
        runStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // ── STORE: articles ──
      if (!db.objectStoreNames.contains('articles')) {
        const artStore = db.createObjectStore('articles', { keyPath: ['runId', 'index'] });
        artStore.createIndex('runId', 'runId', { unique: false });
        artStore.createIndex('decision', 'decision', { unique: false });
      }

      // ── STORE: criteria_presets ──
      if (!db.objectStoreNames.contains('criteria_presets')) {
        const critStore = db.createObjectStore('criteria_presets', { keyPath: 'id', autoIncrement: true });
        critStore.createIndex('name', 'name', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = (e) => {
      console.error('IndexedDB open error:', e.target.error);
      reject(e.target.error);
    };
  });
}

/* ─── Generic helpers ─────────────────────── */

function tx(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ─── RUNS ────────────────────────────────── */

export async function saveRun(run) {
  await openDB();
  return promisify(tx('runs', 'readwrite').put(run));
}

export async function getRun(id) {
  await openDB();
  return promisify(tx('runs').get(id));
}

export async function getAllRuns() {
  await openDB();
  return new Promise((resolve, reject) => {
    const store = tx('runs');
    const req = store.index('timestamp').openCursor(null, 'prev');
    const runs = [];
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        runs.push(cursor.value);
        cursor.continue();
      } else {
        resolve(runs);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRun(id) {
  await openDB();
  // Delete run record
  await promisify(tx('runs', 'readwrite').delete(id));
  // Delete all articles for this run
  await deleteArticlesForRun(id);
}

export async function getNextRunId() {
  const runs = await getAllRuns();
  if (runs.length === 0) return 1;
  return Math.max(...runs.map(r => r.id)) + 1;
}

/* ─── ARTICLES ────────────────────────────── */

export async function saveArticles(articles) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = _db.transaction('articles', 'readwrite');
    const store = transaction.objectStore('articles');

    // Batch write in chunks of 20 for performance
    let i = 0;
    function writeBatch() {
      const end = Math.min(i + 20, articles.length);
      for (; i < end; i++) {
        store.put(articles[i]);
      }
      if (i < articles.length) {
        // Let microtask queue breathe
        setTimeout(writeBatch, 0);
      }
    }
    writeBatch();

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getArticlesForRun(runId) {
  await openDB();
  return new Promise((resolve, reject) => {
    const store = tx('articles');
    const idx = store.index('runId');
    const req = idx.getAll(runId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function updateArticle(article) {
  await openDB();
  return promisify(tx('articles', 'readwrite').put(article));
}

async function deleteArticlesForRun(runId) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = _db.transaction('articles', 'readwrite');
    const store = transaction.objectStore('articles');
    const idx = store.index('runId');
    const req = idx.openCursor(runId);
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/* ─── CRITERIA PRESETS ────────────────────── */

export async function saveCriteria(preset) {
  await openDB();
  return promisify(tx('criteria_presets', 'readwrite').put(preset));
}

export async function getAllCriteria() {
  await openDB();
  return promisify(tx('criteria_presets').getAll());
}

export async function deleteCriteria(id) {
  await openDB();
  return promisify(tx('criteria_presets', 'readwrite').delete(id));
}

/* ─── CLEAR ALL ───────────────────────────── */

export async function clearAllData() {
  await openDB();
  const transaction = _db.transaction(['runs', 'articles', 'criteria_presets'], 'readwrite');
  transaction.objectStore('runs').clear();
  transaction.objectStore('articles').clear();
  transaction.objectStore('criteria_presets').clear();
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/* ─── AGGREGATE STATS ─────────────────────── */

export async function getAggregateStats() {
  const runs = await getAllRuns();
  let total = 0, included = 0, excluded = 0, uncertain = 0;
  for (const r of runs) {
    total += r.totalArticles || 0;
    included += r.includedCount || 0;
    excluded += r.excludedCount || 0;
    uncertain += r.uncertainCount || 0;
  }
  return { sessions: runs.length, total, included, excluded, uncertain };
}
