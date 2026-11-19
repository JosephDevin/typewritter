/* ---------- DOM references ---------- */

const $ = id => document.getElementById(id);

const textarea   = $('paper');
const editor     = $('editor');
const highlight  = $('hl');
const scroller   = $('wrap');
const sheet      = $('sheet');
const spacerTop  = $('spTop');
const spacerBot  = $('spBottom');

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

/** Scrolls so the caret sits in the middle of the window. */
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
  scroller.scrollTop  = editor.offsetTop  + marker.offsetTop  + lineHeight / 2 - scroller.clientHeight / 2;
  scroller.scrollLeft = editor.offsetLeft + marker.offsetLeft - scroller.clientWidth / 2;
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
  const halfWidth  = Math.floor(scroller.clientWidth / 2);
  const halfHeight = Math.floor(scroller.clientHeight / 2);

  sheet.style.width        = columnWidth + 'px';
  sheet.style.paddingLeft  = halfWidth + 'px';
  sheet.style.paddingRight = halfWidth + 'px';
  textarea.style.width     = columnWidth + 'px';

  spacerTop.style.height = spacerBot.style.height = halfHeight + 'px';

  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight + 1) + 'px';
  textarea.scrollTop    = 0;

  scroller.scrollTop  = savedTop;
  scroller.scrollLeft = savedLeft;
}

const refreshLayout = () => { fit(); center(); };


/* ==========================================================================
   State, saving, small UI helpers
   ========================================================================== */

function save() {
  try {
    localStorage.setItem('tw-text', textarea.value);
    localStorage.setItem('tw-opt', JSON.stringify({
      i: indentCb.checked,
      f: fmtSelect.value,
      z: [customInputs.w.value, customInputs.h.value, customInputs.m.value],
    }));
  } catch (e) { /* storage unavailable: ignore */ }
}

function restore() {
  try {
    textarea.value = localStorage.getItem('tw-text') || '';
    const opts = JSON.parse(localStorage.getItem('tw-opt') || '{}');

    if (opts.i === false) indentCb.checked = false;

    const formatExists = [...fmtSelect.options].some(o => o.value === opts.f);
    if (opts.f && formatExists) fmtSelect.value = opts.f;

    if (opts.z) {
      ['w', 'h', 'm'].forEach((key, i) => {
        if (opts.z[i]) customInputs[key].value = opts.z[i];
      });
    }
  } catch (e) { /* corrupt or missing data: ignore */ }
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
  contextMenuOpen = e.button === 2 || (e.button === 0 && e.ctrlKey);
});
textarea.addEventListener('contextmenu', () => { contextMenuOpen = true; });

textarea.addEventListener('input', () => {
  hideUiWhileTyping();
  contextMenuOpen = false;                     // e.g. a spell-check suggestion was applied
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

let audioCtx;
let noiseBuffer;
let soundOn = false;

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

restore();
renderHighlight();
syncCustomVisibility();
updateWordCount();
showUiOnPointer();
refreshLayout();

if (document.fonts) document.fonts.ready.then(refreshLayout);