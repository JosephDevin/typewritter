/* ==========================================================================
   Storage: IndexedDB (built into the browser: no server, no library)

   Three object stores, so the tree never has to load any prose:

   projects : { id, name, created, updated, order: [chapterId, ...], opts }
   chapters : { id, projectId, title, words, updated, caret }     (metadata only)
   texts    : { id, text }                              (id = the chapter's id)

   The tree reads `projects` + `chapters` (tiny, even for a huge novel).
   A chapter's text is read from `texts` only when that chapter is opened.
   ========================================================================== */

const Store = (() => {
  const DB_NAME    = 'typewriter-sim';
  const DB_VERSION = 1;
  let dbPromise = null;

  const open = () => dbPromise || (dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('chapters', { keyPath: 'id' })
        .createIndex('byProject', 'projectId');
      db.createObjectStore('texts', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  }));

  const wrap = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });

  const finished = transaction => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror    = () => reject(transaction.error);
    transaction.onabort    = () => reject(transaction.error);
  });

  /** All projects and all chapter metadata (no text). */
  async function loadIndex() {
    const db = await open();
    const t  = db.transaction(['projects', 'chapters'], 'readonly');
    const [projects, chapters] = await Promise.all([
      wrap(t.objectStore('projects').getAll()),
      wrap(t.objectStore('chapters').getAll()),
    ]);
    return { projects, chapters };
  }

  /** Texts for the given chapter ids, in the same order ('' when missing). */
  async function getTexts(ids) {
    const db    = await open();
    const store = db.transaction('texts', 'readonly').objectStore('texts');
    const rows  = await Promise.all(ids.map(id => wrap(store.get(id))));
    return rows.map(row => (row ? row.text : ''));
  }

  /**
   * Writes any of: a project, a chapter's metadata, a chapter's text.
   * Everything given is written in ONE transaction (all or nothing).
   */
  async function write({ project, chapter, text } = {}) {
    const db = await open();
    const t  = db.transaction(['projects', 'chapters', 'texts'], 'readwrite');

    if (project) t.objectStore('projects').put(project);
    if (chapter) t.objectStore('chapters').put(chapter);
    if (chapter && text !== undefined) {
      t.objectStore('texts').put({ id: chapter.id, text });
    }
    return finished(t);
  }

  /** Deletes one chapter and saves its project (whose `order` just changed). */
  async function removeChapter(chapterId, project) {
    const db = await open();
    const t  = db.transaction(['projects', 'chapters', 'texts'], 'readwrite');

    t.objectStore('chapters').delete(chapterId);
    t.objectStore('texts').delete(chapterId);
    t.objectStore('projects').put(project);
    return finished(t);
  }

  /** Deletes a project with all its chapters and texts. */
  async function removeProject(projectId) {
    const db = await open();
    const t  = db.transaction(['projects', 'chapters', 'texts'], 'readwrite');
    const chapters = t.objectStore('chapters');
    const texts    = t.objectStore('texts');

    const keys = chapters.index('byProject').getAllKeys(projectId);
    keys.onsuccess = () => keys.result.forEach(key => {
      chapters.delete(key);
      texts.delete(key);
    });
    t.objectStore('projects').delete(projectId);
    return finished(t);
  }

  return { loadIndex, getTexts, write, removeChapter, removeProject };
})();
