/* ==========================================================================
   Projects and chapters: state, saving, and the foldable tree (top left)

   Two levels only: project → chapter.
   The editor always holds ONE chapter. Switching chapter saves the current
   one, then loads the next from IndexedDB (see storage.js).

   Must be loaded LAST: it runs the startup that used to sit at the end of
   typewritter.js, once every other script has defined its functions.
   ========================================================================== */

const Projects = (() => {

  /* ---------- settings ---------- */

  const UI = {
    project:    'Untitled project',
    chapter:    'Chapter',
    migrated:   'My text',
    newProject: '+ New project',
  };

  const SAVE_DELAY_MS = 400;
  const KEY_CURRENT   = 'tw-current';      // id of the chapter that was open
  const KEY_OPEN      = 'tw-tree-open';    // ids of the unfolded projects
  const KEY_MIGRATED  = 'tw-migrated';
  const KEY_OLD_TEXT  = 'tw-text';         // single-document storage (old version)
  const KEY_OLD_OPTS  = 'tw-opt';

  // Shortcut that opens / closes the tree (Ctrl+K, or Cmd+K on macOS).
  const isTreeShortcut = e =>
    (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k';

  /* ---------- DOM ---------- */

  const treeEl    = $('tree');
  const treeBtn   = $('treeBtn');
  const treeLabel = $('treeLabel');
  const panel     = $('treePanel');

  const isOpen = () => treeEl.classList.contains('open');

  /* ---------- state ---------- */

  let projects = [];                // sorted by creation date
  const chapters = new Map();       // chapter id -> metadata
  let current = null;               // { project, chapter } shown in the editor

  let dirty = false;
  let saveTimer = 0;
  let queue = Promise.resolve();    // saves run one after the other
  let persistAsked = false;
  let renaming = null;              // id of the row being renamed, if any

  /* ---------- small helpers ---------- */

  const lsGet = (key, fallback = null) => {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (e) { return fallback; }
  };
  const lsSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  };

  const openProjects = new Set((() => {
    try { return JSON.parse(lsGet(KEY_OPEN, '[]')); } catch (e) { return []; }
  })());
  const saveOpen = () => lsSet(KEY_OPEN, JSON.stringify([...openProjects]));

  const uid = prefix =>
    prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const countWords  = text => (text.match(/\S+/g) || []).length;
  const fmt         = n => n.toLocaleString();
  const findProject = id => projects.find(p => p.id === id);
  const chaptersOf  = project => project.order.map(id => chapters.get(id)).filter(Boolean);
  const projectWords = project => chaptersOf(project).reduce((n, c) => n + c.words, 0);

  /** Tiny DOM builder. Names are set with textContent / .value, never innerHTML. */
  function h(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    node.append(...kids.filter(kid => kid !== false && kid != null));
    return node;
  }

  /* ---------- per-project options (indent, page format) ---------- */

  function collectOpts() {
    return {
      i: indentCb.checked,
      f: fmtSelect.value,
      z: [customInputs.w.value, customInputs.h.value, customInputs.m.value],
    };
  }

  function applyOpts(opts = {}) {
    indentCb.checked = opts.i !== false;

    const formatExists = [...fmtSelect.options].some(o => o.value === opts.f);
    if (opts.f && formatExists) fmtSelect.value = opts.f;

    if (opts.z) {
      ['w', 'h', 'm'].forEach((key, i) => {
        if (opts.z[i]) customInputs[key].value = opts.z[i];
      });
    }
  }

  /* ==========================================================================
     Saving (called by save() in typewritter.js on every edit)
     ========================================================================== */

  function scheduleSave() {
    if (!current) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  }

  /** Writes pending changes now. Returns a promise that settles when done. */
  function flush() {
    clearTimeout(saveTimer);
    queue = queue.then(writeCurrent).catch(err => {
      console.error(err);
      toast('Could not save');
    });
    return queue;
  }

  async function writeCurrent() {
    if (!dirty || !current) return;
    dirty = false;

    const { project, chapter } = current;
    const text = textarea.value;

    chapter.words   = countWords(text);
    chapter.caret   = textarea.selectionStart;
    chapter.updated = project.updated = Date.now();
    project.opts    = collectOpts();

    await Store.write({ project, chapter, text });

    // Ask the browser not to evict our data, once the user has really written something.
    if (!persistAsked && navigator.storage && navigator.storage.persist) {
      persistAsked = true;
      navigator.storage.persist();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);

  /* ==========================================================================
     Opening a chapter
     ========================================================================== */

  async function openChapter(id, { focus = true } = {}) {
    const chapter = chapters.get(id);
    if (!chapter) return;

    await flush();                                   // save what we are leaving
    const [text] = await Store.getTexts([id]);
    const project = findProject(chapter.projectId);

    current = { project, chapter };
    dirty = false;

    textarea.value = text;
    const caret = Math.min(chapter.caret == null ? text.length : chapter.caret, text.length);
    textarea.setSelectionRange(caret, caret);
    applyOpts(project.opts);

    renderHighlight();
    syncCustomVisibility();
    updateWordCount();
    refreshLayout();

    lsSet(KEY_CURRENT, id);
    updateLabel();
    if (isOpen()) render();
    if (focus) textarea.focus();
  }

  function updateLabel() {
    if (!current) return;
    const text = `${current.project.name} › ${current.chapter.title}`;
    treeLabel.textContent = text;
    treeBtn.title = `${text}  (projects and chapters: Ctrl+K)`;
  }

  /* ==========================================================================
     Creating, renaming, moving, deleting
     ========================================================================== */

  function makeChapter(projectId, title) {
    return { id: uid('c_'), projectId, title, words: 0, updated: Date.now(), caret: 0 };
  }

  /** Appends an empty chapter to a project and stores it. */
  async function addChapter(project, title) {
    const chapter = makeChapter(
      project.id, title || `${UI.chapter} ${project.order.length + 1}`);

    project.order.push(chapter.id);
    project.updated = chapter.updated;
    chapters.set(chapter.id, chapter);

    await Store.write({ project, chapter, text: '' });
    return chapter;
  }

  /** A new project (copying the current page format) with its first chapter. */
  async function newProjectRecord(name) {
    const now = Date.now();
    const project = {
      id: uid('p_'), name, created: now, updated: now,
      order: [], opts: collectOpts(),
    };
    projects.push(project);
    const chapter = await addChapter(project);
    return { project, chapter };
  }

  async function createProject() {
    await flush();
    const { project, chapter } = await newProjectRecord(UI.project);

    openProjects.add(project.id);
    saveOpen();
    await openChapter(chapter.id, { focus: false });
    renaming = project.id;                           // type the name straight away
    render();
  }

  async function createChapter(projectId) {
    const project = findProject(projectId);
    const chapter = await addChapter(project);

    openProjects.add(projectId);
    saveOpen();
    await openChapter(chapter.id, { focus: false });
    renaming = chapter.id;
    render();
  }

  async function commitRename(kind, item, value) {
    if (renaming !== item.id) return;                // already handled (Escape, double blur)
    renaming = null;

    const name = value.trim();
    if (name) {
      if (kind === 'project') item.name = name; else item.title = name;
    }
    render();
    updateLabel();

    if (!name) return;
    try {
      await Store.write(kind === 'project' ? { project: item } : { chapter: item });
    } catch (err) {
      console.error(err);
      toast('Could not save');
    }
  }

  async function moveChapter(id, delta) {
    const project = findProject(chapters.get(id).projectId);
    const from = project.order.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= project.order.length) return;

    [project.order[from], project.order[to]] = [project.order[to], project.order[from]];
    render();
    await Store.write({ project });
  }

  async function deleteChapter(id) {
    const chapter = chapters.get(id);
    const project = findProject(chapter.projectId);

    if (project.order.length < 2) {
      toast('A project needs at least one chapter');
      return;
    }
    const sure = confirm(
      `Delete “${chapter.title}” (${fmt(chapter.words)} words)?\nThis cannot be undone.`);
    if (!sure) return;

    if (current.chapter.id === id) {
      const at = project.order.indexOf(id);
      const next = project.order[at + 1] || project.order[at - 1];
      dirty = false;                                 // never write back a chapter we delete
      clearTimeout(saveTimer);
      await openChapter(next, { focus: false });
    }

    project.order = project.order.filter(other => other !== id);
    chapters.delete(id);
    await Store.removeChapter(id, project);
    render();
  }

  async function deleteProject(id) {
    const project = findProject(id);

    if (projects.length < 2) {
      toast('Keep at least one project');
      return;
    }
    const sure = confirm(
      `Delete the project “${project.name}”, with its ${project.order.length} chapter(s) ` +
      `and ${fmt(projectWords(project))} words?\nThis cannot be undone.`);
    if (!sure) return;

    if (current.project.id === id) {
      const other = projects.find(p => p.id !== id);
      dirty = false;
      clearTimeout(saveTimer);
      await openChapter(other.order[0], { focus: false });
    }

    project.order.forEach(chapterId => chapters.delete(chapterId));
    projects = projects.filter(p => p.id !== id);
    openProjects.delete(id);
    saveOpen();
    await Store.removeProject(id);
    render();
  }

  /* ==========================================================================
     The tree
     ========================================================================== */

  const toolButton = (act, id, glyph, title) =>
    h('button', {
      type: 'button', class: 'tw-tool',
      'data-act': act, 'data-id': id, title, 'aria-label': title,
    }, glyph);

  function renameInput(kind, item) {
    const input = h('input', { class: 'rename', type: 'text', 'aria-label': 'Name' });
    input.value = kind === 'project' ? item.name : item.title;

    const rowAct = kind === 'project' ? 'fold' : 'open';

    input.addEventListener('keydown', e => {
      e.stopPropagation();                           // keep typing keys away from the tree
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();                                // commits through the blur handler
        focusRow(rowAct, item.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renaming = null;
        render();
        focusRow(rowAct, item.id);
      }
    });
    input.addEventListener('blur', () => commitRename(kind, item, input.value));
    return input;
  }

  function renderChapter(chapter, index, total) {
    const here = current && current.chapter === chapter;

    const name = renaming === chapter.id
      ? renameInput('chapter', chapter)
      : h('button', {
          type: 'button', class: 'name',
          'data-act': 'open', 'data-id': chapter.id,
          ...(here ? { 'aria-current': 'true' } : {}),
        }, chapter.title);

    return h('li', { class: 'tw-chapter' + (here ? ' tw-current' : '') },
      h('div', { class: 'tw-row', style: `--i:${rowIndex++}` },
        name,
        h('span', { class: 'tw-tools' },
          index > 0         && toolButton('up',   chapter.id, '↑', 'Move up'),
          index < total - 1 && toolButton('down', chapter.id, '↓', 'Move down'),
          toolButton('rename-chapter', chapter.id, '✎', 'Rename chapter'),
          toolButton('delete-chapter', chapter.id, '✕', 'Delete chapter'))));
  }

  function renderProject(project) {
    const isOpen = openProjects.has(project.id);

    const name = renaming === project.id
      ? renameInput('project', project)
      : h('button', {
          type: 'button', class: 'name',
          'data-act': 'fold', 'data-id': project.id,
          'aria-expanded': String(isOpen),
        }, (isOpen ? '▾ ' : '▸ ') + project.name);

    const item = h('li', { class: 'tw-project' },
      h('div', { class: 'tw-row', style: `--i:${rowIndex++}` },
        name,
        h('span', { class: 'tw-tools' },
          toolButton('add-chapter',    project.id, '+', 'New chapter'),
          toolButton('rename-project', project.id, '✎', 'Rename project'),
          toolButton('delete-project', project.id, '✕', 'Delete project'))));

    if (isOpen) {
      const all = chaptersOf(project);
      item.append(h('ul', {}, ...all.map((c, i) => renderChapter(c, i, all.length))));
    }
    return item;
  }

  let rowIndex = 0;                  // numbers the rows for the staggered entrance

  function render() {
    rowIndex = 0;
    panel.replaceChildren(
      h('ul', {}, ...projects.map(renderProject)),
      h('button', { type: 'button', class: 'tw-new', 'data-act': 'new-project' }, UI.newProject));

    const input = panel.querySelector('.rename');
    if (input) { input.focus(); input.select(); }
  }

  const focusRow = (act, id) => {
    const el = panel.querySelector(`.name[data-act="${act}"][data-id="${id}"]`);
    if (el) el.focus();
  };

  function toggleFold(id) {
    if (openProjects.has(id)) openProjects.delete(id); else openProjects.add(id);
    saveOpen();
    render();
    focusRow('fold', id);
  }

  /* ---------- open / close ---------- */

  async function openPanel() {
    await flush();                                   // keep the saved data current
    openProjects.add(current.project.id);            // the current chapter is always visible
    render();

    treeEl.classList.add('open', 'entering');
    treeBtn.setAttribute('aria-expanded', 'true');
    setTimeout(() => treeEl.classList.remove('entering'), 900);

    const here = panel.querySelector('[aria-current="true"]') || panel.querySelector('.name');
    if (here) here.focus();
  }

  function closePanel() {
    renaming = null;
    treeEl.classList.remove('open', 'entering');
    treeBtn.setAttribute('aria-expanded', 'false');
    textarea.focus();
  }

  const togglePanel = () => (isOpen() ? closePanel() : openPanel());

  treeBtn.addEventListener('click', togglePanel);

  document.addEventListener('keydown', e => {
    if (isTreeShortcut(e) && current) {
      e.preventDefault();
      togglePanel();
    }
  });

  // Click outside the tree closes it
  document.addEventListener('mousedown', e => {
    if (isOpen() && !treeEl.contains(e.target)) closePanel();
  });

  panel.addEventListener('click', async e => {
    const button = e.target.closest('button[data-act]');
    if (!button) return;
    const { act, id } = button.dataset;

    try {
      switch (act) {
        case 'fold':           toggleFold(id); break;
        case 'open':
          if (current.chapter.id !== id) await openChapter(id);
          closePanel();
          break;
        case 'new-project':    await createProject(); break;
        case 'add-chapter':    await createChapter(id); break;
        case 'rename-project':
        case 'rename-chapter': renaming = id; render(); break;
        case 'delete-project': await deleteProject(id); break;
        case 'delete-chapter': await deleteChapter(id); break;
        case 'up':             await moveChapter(id, -1); break;
        case 'down':           await moveChapter(id, 1); break;
      }
    } catch (err) {
      console.error(err);
      toast('Something went wrong');
    }
  });

  // Keyboard: arrows move between rows, ←/→ fold, Esc closes
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
      return;
    }

    const rows = [...panel.querySelectorAll('.name')];
    const target = document.activeElement;
    const at = rows.indexOf(target);
    if (at === -1) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rows[Math.min(at + 1, rows.length - 1)].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      rows[Math.max(at - 1, 0)].focus();
    } else if (target.dataset.act === 'fold') {
      const isOpen = openProjects.has(target.dataset.id);
      if ((e.key === 'ArrowRight' && !isOpen) || (e.key === 'ArrowLeft' && isOpen)) {
        e.preventDefault();
        toggleFold(target.dataset.id);
      }
    } else if (target.dataset.act === 'open' && e.key === 'ArrowLeft') {
      e.preventDefault();
      focusRow('fold', chapters.get(target.dataset.id).projectId);
    }
  });

  /* ==========================================================================
     Startup
     ========================================================================== */

  /** Moves the old single document (tw-text / tw-opt) into a first project. */
  async function migrateLegacy() {
    const oldText = lsGet(KEY_OLD_TEXT);
    if (oldText === null || lsGet(KEY_MIGRATED)) return;

    const existing = await Store.loadIndex();
    if (!existing.projects.length) {
      let opts = {};
      try { opts = JSON.parse(lsGet(KEY_OLD_OPTS, '{}')); } catch (e) { /* ignore */ }

      const now = Date.now();
      const project = {
        id: uid('p_'), name: UI.migrated, created: now, updated: now, order: [], opts,
      };
      const chapter = makeChapter(project.id, `${UI.chapter} 1`);
      chapter.words = countWords(oldText);
      chapter.caret = oldText.length;
      project.order.push(chapter.id);

      await Store.write({ project, chapter, text: oldText });
    }
    lsSet(KEY_MIGRATED, '1');                        // old keys are kept, as a backup
  }

  async function loadIndex() {
    const index = await Store.loadIndex();
    projects = index.projects.sort((a, b) => a.created - b.created);
    chapters.clear();
    index.chapters.forEach(c => chapters.set(c.id, c));

    // Repair: each project's `order` must match the chapters that really exist
    for (const project of projects) {
      const mine  = index.chapters.filter(c => c.projectId === project.id);
      const known = new Set(mine.map(c => c.id));
      const order = project.order.filter(id => known.has(id));
      mine.forEach(c => { if (!order.includes(c.id)) order.push(c.id); });

      if (JSON.stringify(order) !== JSON.stringify(project.order)) {
        project.order = order;
        await Store.write({ project });
      }
      if (!project.order.length) await addChapter(project);
    }
  }

  async function init() {
    let startId = null;

    try {
      await migrateLegacy();
      await loadIndex();
      if (!projects.length) await newProjectRecord(UI.project);

      const saved = lsGet(KEY_CURRENT, '');
      startId = chapters.has(saved) ? saved : projects[0].order[0];
    } catch (err) {
      console.error(err);
      treeEl.hidden = true;
      toast('Storage unavailable: your text will not be saved.');
    }

    if (startId) {
      await openChapter(startId);
    } else {
      renderHighlight();
      syncCustomVisibility();
      updateWordCount();
      refreshLayout();
    }

    showUiOnPointer();
    if (document.fonts) document.fonts.ready.then(refreshLayout);
  }

  /** Words of one project's chapters, in order, for the full-project .tex export. */
  async function exportParts() {
    await flush();
    const { project } = current;
    const list  = chaptersOf(project);
    const texts = await Store.getTexts(list.map(c => c.id));
    return { project, parts: list.map((c, i) => ({ title: c.title, text: texts[i] })) };
  }

  return { init, scheduleSave, flush, exportParts, current: () => current };
})();

Projects.init();
