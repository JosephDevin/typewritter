/* ---------- DOM references ---------- */

const BOTTOM_OFFSET = 300;   // px between the writing line and the bottom of the window
const sheetPad = () => Math.round(Math.max(120, scroller.clientWidth * 0.25));
const focusY = () => Math.max(
  Math.round(scroller.clientHeight * 0.4),     // never higher than 40% on small screens
  scroller.clientHeight - BOTTOM_OFFSET
);

const $ = id => document.getElementById(id);

const textarea   = $('paper');
const editor     = $('editor');
const highlight  = $('hl');
const scroller   = $('wrap');
const sheet      = $('sheet');
const spacerTop  = $('spTop');
const spacerBot  = $('spBottom');
const paperBg    = $('sheetBg');

const indentCb   = $('indent');
const fmtSelect  = $('fmt');
const customBox  = $('cust');
const customInputs = { w: $('fW'), h: $('fH'), m: $('fM') };

const overlay    = $('ov');
const srcView    = $('src');
const helpView   = $('help');

const DOC_LANGUAGE = 'french';

const TOAST_DELAY_MS = 2200;

/* ==========================================================================
   Typewriter scrolling
   ========================================================================== */

const mirror = document.createElement('div');
mirror.style.cssText =
    'position:absolute;visibility:hidden;top:0;left:-9999px;' +
    'white-space:pre-wrap;overflow-wrap:break-word';
document.body.appendChild(mirror);

const FONT_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing'];
const MIRROR_PROPS = [
  ...FONT_PROPS,
  'wordSpacing', 'lineHeight',
  'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'boxSizing',
];

function copyStyles(props) {
  const computed = getComputedStyle(textarea);
  props.forEach(prop => { mirror.style[prop] = computed[prop]; });
  return computed;
}

// Disables focus changing when right-clicking
let contextMenuOpen = false;

/** Scrolls so the caret sits on the writing line (typewriter position). */
function center() {
  if (contextMenuOpen) return;

  const computed = copyStyles(MIRROR_PROPS);
  mirror.style.whiteSpace   = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.width        = textarea.offsetWidth + 'px';

  const caret = textarea.selectionStart;
  const value = textarea.value;

  mirror.textContent = value.slice(0, caret);
  const marker = document.createElement('span');
  marker.textContent = value.slice(caret).match(/^\S*/)[0] || '\u200b';
  mirror.appendChild(marker);

  const lineHeight = parseFloat(computed.lineHeight)
      || parseFloat(computed.fontSize) * 0.75;

  textarea.scrollTop = 0;
  scroller.scrollTop  = editor.offsetTop  + marker.offsetTop  + lineHeight / 2 - focusY();
  scroller.scrollLeft = editor.offsetLeft + marker.offsetLeft - scroller.clientWidth / 2;
  placePaper();
}

/** Sizes the column to the page format and the textarea to its content. */
function fit() {
  const f = getFormat();
  const charsPerLine = Math.round((f.w - 2 * f.m) * 52 / f.pt);

  // Measure the width of one monospace character
  copyStyles(FONT_PROPS);
  mirror.style.whiteSpace = 'pre';
  mirror.style.width      = 'auto';
  mirror.style.padding    = '0';
  mirror.textContent      = 'x'.repeat(100);

  const charWidth   = mirror.getBoundingClientRect().width / 100;
  const columnWidth = Math.ceil(charsPerLine * charWidth) + 1;

  const savedTop  = scroller.scrollTop;
  const savedLeft = scroller.scrollLeft;
  const halfWidth = Math.floor(scroller.clientWidth / 2);
  const focus     = focusY();

  sheet.style.width        = columnWidth + 'px';
  sheet.style.paddingLeft  = halfWidth + 'px';
  sheet.style.paddingRight = halfWidth + 'px';
  textarea.style.width     = columnWidth + 'px';

  spacerTop.style.height = focus + 'px';
  spacerBot.style.height = (scroller.clientHeight - focus) + 'px';

  // Lets the CSS (the floor under the writing line) follow the caret line
  const root = document.documentElement.style;
  root.setProperty('--focus', focus + 'px');
  root.setProperty('--lh', parseFloat(getComputedStyle(textarea).lineHeight) + 'px');

  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight + 1) + 'px';
  textarea.scrollTop    = 0;

  scroller.scrollTop  = savedTop;
  scroller.scrollLeft = savedLeft;
  placePaper();
  layoutNotes();
}

/** Places the sheet of paper (decoration) behind the text column. */
function placePaper() {
  const colW = textarea.offsetWidth;
  const pad = sheetPad();
  paperBg.style.width = Math.round(colW + 2 * pad) + 'px';
  paperBg.style.left  = Math.round(editor.offsetLeft - scroller.scrollLeft - pad) + 'px';
  placeNotes();
}

const refreshLayout = () => { fit(); center(); };


/* ==========================================================================
   State, saving, small UI helpers
   ========================================================================== */

/** Called on every edit (and by the toolbar when an option changes). */
function save() {
  if (typeof Projects !== 'undefined') Projects.scheduleSave();
}

const syncCustomVisibility = () => {
  customBox.style.display = fmtSelect.value === 'custom' ? 'inline-flex' : 'none';
};

/* ==========================================================================
   Editing events
   ========================================================================== */

const INDENT = '    ';

/** Inserts text at the caret (replacing any selection), keeping undo working. */
function insertText(text) {
  if (!document.execCommand('insertText', false, text)) {
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
    textarea.dispatchEvent(new Event('input'));
  }
}

function insertTab() {
  insertText(INDENT);
}

function lineStartOf(value, pos) {
  return pos === 0 ? 0 : value.lastIndexOf('\n', pos - 1) + 1;
}

/** Enter: start a new line that already carries the paragraph indent. */
function insertNewParagraphLine() {
  const { value, selectionStart: start, selectionEnd: end } = textarea;

  // Enter on a line that only holds an indent: clear it, so the blank line
  // between two paragraphs stays truly empty.
  if (start === end) {
    const lineStart = lineStartOf(value, start);
    let lineEnd = value.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = value.length;

    const line = value.slice(lineStart, lineEnd);
    if (line.length > 0 && line.trim() === '') {
      textarea.setSelectionRange(lineStart, lineEnd);
    }
  }

  insertText('\n' + INDENT);
}

/** Backspace right after the indent removes all of it at once. */
function deleteWholeIndent() {
  const pos = textarea.selectionStart;
  if (pos !== textarea.selectionEnd) return false;

  const lineStart = lineStartOf(textarea.value, pos);
  if (textarea.value.slice(lineStart, pos) !== INDENT) return false;

  textarea.setSelectionRange(lineStart, pos);
  if (!document.execCommand('delete')) {
    textarea.setRangeText('', lineStart, pos, 'end');
    textarea.dispatchEvent(new Event('input'));
  }
  return true;
}

/** Typing the very first character of an empty document: indent it too. */
function isFirstCharacter(e) {
  return textarea.value === ''
      && e.key.length === 1
      && e.key.trim() !== ''
      && !e.ctrlKey && !e.metaKey;
}

/* Right click (or ctrl+click on macOS) opens the context menu: don't re-center. */
textarea.addEventListener('mousedown', e => {
  if (e.button === 0 && e.shiftKey) {          // shift+click: add a post-it
    e.preventDefault();                        // no selection extension
    addNoteAtPoint(e);
    return;
  }
  contextMenuOpen = e.button === 2 || (e.button === 0 && e.ctrlKey);
});
textarea.addEventListener('contextmenu', () => { contextMenuOpen = true; });

textarea.addEventListener('input', () => {
  hideUiWhileTyping();
  contextMenuOpen = false;                     // e.g. a spell-check suggestion was applied
  syncNotesToEdit();                           // keep post-its attached to their line
  renderHighlight();
  fit();
  center();
  requestAnimationFrame(center);
  updateWordCount();
  save();
});

textarea.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) return;
    insertTab();
    playClick();
    hideUiWhileTyping();
    return;
  }

  if (indentCb.checked && !e.isComposing) {
    const plainEnter = e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

    if (plainEnter) {
      e.preventDefault();
      insertNewParagraphLine();
      playClick();
      hideUiWhileTyping();
      return;
    }

    if (e.key === 'Backspace' && deleteWholeIndent()) {
      e.preventDefault();
      playClick();
      hideUiWhileTyping();
      return;
    }

    if (isFirstCharacter(e)) insertText(INDENT);   // then the key types normally
  }

  const isTypingKey = e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace';
  if (isTypingKey) {
    playClick();
    hideUiWhileTyping();
  }
});

textarea.addEventListener('keydown', () => {
  contextMenuOpen = false;
  requestAnimationFrame(center);
});
textarea.addEventListener('focus', center);

['keyup', 'click'].forEach(type =>
    textarea.addEventListener(type, () => setTimeout(center, 0)));

document.addEventListener('selectionchange', () => {
  if (document.activeElement === textarea) requestAnimationFrame(center);
});

window.addEventListener('resize', refreshLayout);
scroller.addEventListener('scroll', placePaper, { passive: true });

['mousemove', 'touchstart'].forEach(type =>
    document.addEventListener(type, showUiOnPointer, { passive: true }));

// Toolbar controls shouldn't steal Tab focus from the writing area
document.querySelectorAll('#bar button, #bar select, #bar input')
    .forEach(el => { el.tabIndex = -1; });

/* ==========================================================================
   Key-click sound
   ========================================================================== */

const NOISE_SAMPLES = 900;

function createNoiseBuffer() {
  const buffer = audioCtx.createBuffer(1, NOISE_SAMPLES, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < NOISE_SAMPLES; i++) {
    const fade = Math.pow(1 - i / NOISE_SAMPLES, 3);
    data[i] = (Math.random() * 2 - 1) * fade * 0.3;
  }
  return buffer;
}

function playClick() {
  if (!soundOn) return;

  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  noiseBuffer = noiseBuffer || createNoiseBuffer();

  const source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer;
  source.connect(audioCtx.destination);
  source.start();
}

/* ==========================================================================
    Small UI helpers
   ========================================================================== */
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('on'), TOAST_DELAY_MS);
}

function hideUiWhileTyping() {
  document.body.classList.add('idle');
}

function showUiOnPointer() {
  document.body.classList.remove('idle');
}

function updateWordCount() {
  const words = (textarea.value.match(/\S+/g) || []).length;
  $('count').textContent = words + (words > 1 ? ' words' : ' word');
}

/* ==========================================================================
   Startup
   ========================================================================== */

// Moved to projects.js (loaded last): it loads the last open chapter, then runs
// renderHighlight / syncCustomVisibility / updateWordCount / refreshLayout.


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
.tw-postit{position:absolute;z-index:1;pointer-events:auto;width:250px;box-sizing:border-box;
  padding:28px 20px 18px;background:#fff3a0;color:#3b3200;border-radius:1px 1px 10px 1px;
  box-shadow:0 1px 1px rgba(0,0,0,.18),0 6px 14px rgba(0,0,0,.18);
  font:18px/1.5 'Courier Prime',monospace;transition:transform .12s}
.tw-postit::before{content:'';position:absolute;left:-18px;top:14px;width:18px;
  border-top:1px solid rgba(120,95,0,.45)}
.tw-postit:hover,.tw-postit:focus-within{z-index:2;transform:rotate(0deg) scale(1.02)!important}
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

// Fixed overlay above everything else (floor, toolbar...): notes are placed
// from the text column's on-screen rectangle and follow it while scrolling.
const notesLayer = document.createElement('div');
notesLayer.id = 'twNotes';
notesLayer.style.cssText =
    'position:fixed;inset:0;z-index:100;overflow:hidden;pointer-events:none';
document.body.appendChild(notesLayer);

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
  const shown = new Set();

  live.forEach((n, i) => {
    shown.add(n.id);
    const el = noteEl(n);
    el._y = padTop + Math.round(tops[i] / lh) * lh - 4;   // relative to the text column
    el.style.display = '';
    if (!el._sized) { el._grow(); el._sized = true; }
  });
  for (const [id, el] of noteEls) if (!shown.has(id)) el.style.display = 'none';
  placeNotes();
}

/** Applies the on-screen position (cheap: runs on every scroll). */
function placeNotes() {
  if (!noteEls.size) return;
  const r = textarea.getBoundingClientRect();
  const left = r.right + NOTE_GAP;
  for (const el of noteEls.values()) {
    if (el._y === undefined) continue;
    el.style.left = Math.min(left, window.innerWidth - el.offsetWidth - 8) + 'px';
    el.style.top  = (r.top + el._y) + 'px';
  }
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

  notesLayer.appendChild(el);
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
