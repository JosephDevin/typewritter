/* ==========================================================================
   Post-it notes (shift + click on a line)
   --------------------------------------------------------------------------
   Each note is anchored to a character offset (the start of the visual line
   that was clicked). The offset follows the text while editing, and a small
   piece of surrounding text is stored so the note can find its place again
   when another chapter is loaded. Notes are kept in localStorage.
   ========================================================================== */

const NOTES_KEY = 'typewriter-postits';
const NOTE_CTX  = 12;    // characters of context kept on each side of the anchor
const NOTE_GAP  = 26;    // px between the text column and the post-it

let notes = loadNotes();
let notesText = null;    // text the offsets currently refer to
const noteEls = new Map();

const noteStyle = document.createElement('style');
noteStyle.textContent = `
.tw-postit{position:absolute;z-index:6;width:250px;box-sizing:border-box;
  padding:28px 20px 18px;background:#fff3a0;color:#3b3200;border-radius:1px 1px 10px 1px;
  box-shadow:0 1px 1px rgba(0,0,0,.18),0 6px 14px rgba(0,0,0,.18);
  font:18px/1.5 'Courier Prime',monospace;transition:transform .12s}
.tw-postit::before{content:'';position:absolute;left:-18px;top:14px;width:18px;
  border-top:1px solid rgba(120,95,0,.45)}
.tw-postit:hover,.tw-postit:focus-within{z-index:7;transform:rotate(0deg) scale(1.02)!important}
.tw-postit textarea{display:block;width:100%;min-height:4.5em;margin:0;padding:0;
  border:0;outline:0;resize:none;overflow:hidden;background:transparent;
  color:inherit;font:inherit}
.tw-postit textarea::placeholder{color:rgba(59,50,0,.4);font-style:italic}
.tw-postit .x{position:absolute;top:5px;right:8px;width:22px;height:22px;padding:0;
  border:0;background:none;color:#6e6e6e;font:400 20px/22px 'Courier Prime',monospace;
  cursor:pointer;transition:color .12s}
.tw-postit .x:hover{color:#2b2b2b;font-weight:700}
`;
document.head.appendChild(noteStyle);

function loadNotes() {
    try {
        const list = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch { return []; }
}

let notesTimer;
function writeNotes() {
    const data = notes.map(({ id, off, pre, ctx, text }) => ({ id, off, pre, ctx, text }));
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(data)); } catch {}
}
function saveNotes() {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(writeNotes, 300);
}
// Never lose a note to the debounce when the tab is closed or hidden
window.addEventListener('pagehide', writeNotes);
document.addEventListener('visibilitychange', () => { if (document.hidden) writeNotes(); });

function noteContext(off) {
    const pre = Math.min(NOTE_CTX, off);
    return { pre, ctx: textarea.value.slice(off - pre, off + NOTE_CTX) };
}

/** Called on every edit: shifts the offsets of the notes after the change. */
function syncNotesToEdit() {
    const prev = notesText, cur = textarea.value;
    notesText = cur;
    if (prev === null || prev === cur || !notes.length) return;

    const max = Math.min(prev.length, cur.length);
    let p = 0;
    while (p < max && prev[p] === cur[p]) p++;
    let s = 0;
    while (s < max - p && prev[prev.length - 1 - s] === cur[cur.length - 1 - s]) s++;

    const delta = cur.length - prev.length;
    const tailStart = prev.length - s;
    for (const n of notes) {
        if (n.lost) continue;
        if (n.off > p) n.off = n.off >= tailStart ? n.off + delta : p;
        Object.assign(n, noteContext(n.off));
    }
    saveNotes();
}

/** The text was replaced from outside (chapter switch, load): find the notes again. */
function relocateNotes() {
    const value = textarea.value;
    notesText = value;
    for (const n of notes) {
        const start = n.off - n.pre;
        const here = n.ctx === ''
            ? value === ''
            : start >= 0 && value.substr(start, n.ctx.length) === n.ctx;
        if (here) { n.lost = false; continue; }
        const idx = n.ctx ? value.indexOf(n.ctx) : -1;
        if (idx >= 0) { n.off = idx + n.pre; n.lost = false; }
        else n.lost = true;                       // belongs to another chapter: hidden, kept
    }
}

/* ---------- Measuring lines ---------- */

const noteMirror = document.createElement('div');
noteMirror.style.cssText =
    'position:absolute;visibility:hidden;top:0;left:-9999px;' +
    'white-space:pre-wrap;overflow-wrap:break-word';
document.body.appendChild(noteMirror);

const NOTE_PROPS = [...FONT_PROPS, 'wordSpacing', 'lineHeight',
    'paddingLeft', 'paddingRight', 'boxSizing'];

function lineMetrics() {
    const cs = getComputedStyle(textarea);
    NOTE_PROPS.forEach(prop => { noteMirror.style[prop] = cs[prop]; });
    noteMirror.style.paddingTop = noteMirror.style.paddingBottom = '0';
    noteMirror.style.width = textarea.offsetWidth + 'px';
    return {
        lh: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2,
        padTop: parseFloat(cs.paddingTop) || 0,
    };
}

/** Vertical position (inside the text) of the line holding each offset (sorted). */
function lineTops(offsets) {
    const value = textarea.value;
    noteMirror.textContent = '';
    const markers = [];
    let pos = 0;
    for (const off of offsets) {
        if (off >= pos) {
            noteMirror.append(value.slice(pos, off));
            const m = document.createElement('span');
            const word = value.slice(off).match(/^\S*/)[0];     // keeps the word together, like center()
            m.textContent = word || '\u200b';
            noteMirror.append(m);
            pos = off + word.length;
            markers.push(m);
        } else {
            markers.push(markers[markers.length - 1]);
        }
    }
    return markers.map(m => m.offsetTop);
}

/* ---------- Layout ---------- */

function layoutNotes() {
    if (notesText !== textarea.value) relocateNotes();
    if (!notes.length) return;

    const { lh, padTop } = lineMetrics();
    const live = notes.filter(n => !n.lost).sort((a, b) => a.off - b.off);
    const tops = lineTops(live.map(n => n.off));
    const left = textarea.offsetLeft + textarea.offsetWidth + NOTE_GAP;
    const base = textarea.offsetTop + padTop;
    const shown = new Set();

    live.forEach((n, i) => {
        shown.add(n.id);
        const el = noteEl(n);
        el.style.left = left + 'px';
        el.style.top  = (base + Math.round(tops[i] / lh) * lh - 4) + 'px';
        el.style.display = '';
        if (!el._sized) { el._grow(); el._sized = true; }
    });
    for (const [id, el] of noteEls) if (!shown.has(id)) el.style.display = 'none';
}

function noteEl(n) {
    let el = noteEls.get(n.id);
    if (el) return el;

    el = document.createElement('div');
    el.className = 'tw-postit';
    el.style.transform = 'rotate(' + ((n.id.charCodeAt(n.id.length - 1) % 5) - 2) * 0.8 + 'deg)';
    el.innerHTML =
        '<button type="button" class="x" title="Delete note" aria-label="Delete note">\u00d7</button>' +
        '<textarea rows="3" maxlength="300" placeholder="Note\u2026" spellcheck="false"></textarea>';

    const ta = el.querySelector('textarea');
    ta.value = n.text || '';
    el._grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

    ta.addEventListener('input', () => { n.text = ta.value; el._grow(); saveNotes(); });
    ta.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); textarea.focus(); }
    });
    el.querySelector('.x').addEventListener('click', () => {
        deleteNote(n);
        textarea.focus({ preventScroll: true });
    });

    // Keep the page's own handlers (focus stealing, shortcuts, sounds) out of the notes
    ['mousedown', 'pointerdown', 'click', 'keydown', 'keyup', 'input']
        .forEach(type => el.addEventListener(type, e => e.stopPropagation()));

    editor.appendChild(el);
    noteEls.set(n.id, el);
    return el;
}

function deleteNote(n) {
    const i = notes.indexOf(n);
    if (i < 0) return;
    notes.splice(i, 1);
    const el = noteEls.get(n.id);
    if (el) el.remove();
    noteEls.delete(n.id);
    saveNotes();
}

/** Shift+click: puts a post-it on the clicked (visual) line, or focuses the one already there. */
function addNoteAtPoint(e) {
    const { lh, padTop } = lineMetrics();
    const value = textarea.value;
    const lineAt = off => Math.round(lineTops([off])[0] / lh);

    let target = Math.max(0, Math.floor((e.clientY - textarea.getBoundingClientRect().top - padTop) / lh));
    target = Math.min(target, lineAt(value.length));

    let lo = 0, hi = value.length;               // first offset of that visual line
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (lineAt(mid) >= target) hi = mid; else lo = mid + 1;
    }

    let note = notes.find(n => !n.lost && lineAt(n.off) === target);
    if (!note) {
        note = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            off: lo, text: '', ...noteContext(lo),
        };
        notes.push(note);
        saveNotes();
        layoutNotes();
    }
    noteEl(note).querySelector('textarea').focus({ preventScroll: true });
}