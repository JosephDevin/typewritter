/* ==========================================================================
   Typewriter → LaTeX
   ========================================================================== */

/* ---------- DOM references ---------- */

const $ = id => document.getElementById(id);

const textarea   = $('paper');
const editor     = $('editor');
const highlight  = $('hl');
const scroller   = $('wrap');
const sheet      = $('sheet');
const spacerTop  = $('spTop');
const spacerBot  = $('spBottom');

const langSelect = $('lang');
const preambleCb = $('pre');
const indentCb   = $('indent');
const fmtSelect  = $('fmt');
const customBox  = $('cust');
const customInputs = { w: $('fW'), h: $('fH'), m: $('fM') };

const overlay    = $('ov');
const srcView    = $('src');
const helpView   = $('help');

const IDLE_DELAY_MS  = 2500;
const TOAST_DELAY_MS = 2200;


/* ==========================================================================
   Help text
   ========================================================================== */

const HELP = `SYNTAX
    # Title            → \\section*{}
    ## Subtitle        → \\subsection*{}
    ### Smaller        → \\subsubsection*{}
    > a quote          → quote environment
    (blank line)       → new paragraph
    Enter              → new line starting with an indent (checkbox "indent");
                         Backspace removes the whole indent
    *italic*  **bold**
    ---  or  * * *     → scene break
    "quotation"        → « quotation » (French) or “quotation”
    @title My title    → \\maketitle (also @author, @date)
    % a comment        → LaTeX comment (line shown in blue, not typeset)

    Special characters (% & $ # _ { } ~ ^ \\) are escaped for you,
    except a % at the very start of a line, which starts a comment.
    Your text is saved in this browser automatically.`;

helpView.textContent = HELP;


/* ==========================================================================
   Page formats (typical French publisher sizes, in cm)
   ========================================================================== */

const FORMATS = {
  poche:  { name: 'Poche · 10 × 17,8 cm',        w: 11,   h: 17.8, m: 1.5, pt: 10 },
  roman:  { name: 'Roman · 14 × 20,5 cm',        w: 14,   h: 20.5, m: 2,   pt: 11 },
  grand:  { name: 'Grand format · 14 × 22 cm',   w: 14,   h: 22,   m: 2.2, pt: 11 },
  a5:     { name: 'A5 · 14,8 × 21 cm',           w: 14.8, h: 21,   m: 2,   pt: 11 },
  a4:     { name: 'A4 · 21 × 29,7 cm',           w: 21,   h: 29.7, m: 2.5, pt: 12 },
};

function fillFormatSelect() {
  const options = Object.entries(FORMATS)
    .map(([key, f]) => `<option value="${key}">${f.name}</option>`);
  options.push('<option value="custom">Custom…</option>');

  fmtSelect.innerHTML = options.join('');
  fmtSelect.value = 'roman';
}

function fontSizeForWidth(width) {
  if (width < 13) return 10;
  if (width < 16) return 11;
  return 12;
}

/** Returns the currently selected page format: { w, h, m, pt } */
function getFormat() {
  const key = fmtSelect.value;

  if (key === 'custom') {
    const w = +customInputs.w.value || 13;
    const h = +customInputs.h.value || 21;
    const m = +customInputs.m.value || 2;
    return { w, h, m, pt: fontSizeForWidth(w) };
  }

  return FORMATS[key] || FORMATS.roman;
}

fillFormatSelect();


/* ==========================================================================
   LaTeX conversion
   ========================================================================== */

const LATEX_ESCAPES = {
  '\\': '\\textbackslash{}',
  '{':  '\\{',
  '}':  '\\}',
  '$':  '\\$',
  '&':  '\\&',
  '#':  '\\#',
  '_':  '\\_',
  '%':  '\\%',
  '~':  '\\textasciitilde{}',
  '^':  '\\textasciicircum{}',
};

const escapeLatex = text =>
  text.replace(/[\\{}$&#_%~^]/g, char => LATEX_ESCAPES[char]);

/** Converts inline markup (bold, italic, quotes, ellipsis) of one paragraph. */
function formatInline(text, isFrench) {
  text = escapeLatex(text)
    .replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}')
    .replace(/\*(.+?)\*/g,     '\\emph{$1}')
    .replace(/'/g, '’')
    .replace(/\.\.\./g, '\\ldots{}');

  if (isFrench) {
    return text.replace(/(?:"|“|«\s?)(.+?)(?:"|”|\s?»)/g, '\\og $1\\fg{}');
  }
  return text.replace(/(?:"|“)(.+?)(?:"|”)/g, "``$1''");
}

/* --- line patterns --- */

const COMMENT_RE = /^%\s?(.*)/;                 // applied to a trimmed line
const META_RE   = /^@(title|author|date)\s+(.+)/;
const HEADING_RE = /^(#{1,3})\s+(.+)/;
const BREAK_RE  = /^(---+|\*\s?\*\s?\*)$/;
const QUOTE_RE  = /^\s*>\s?(.*)/;

const HEADING_COMMANDS = ['section', 'subsection', 'subsubsection'];
const SCENE_BREAK_LATEX =
  '\\begin{center}\\textasteriskcentered\\quad\\textasteriskcentered\\quad\\textasteriskcentered\\end{center}';

/**
 * Parses the typed text into LaTeX body blocks and metadata.
 * Returns { blocks: string[], meta: { title?, author?, date? } }
 */
function parseText(text, isFrench) {
  const lines  = text.replace(/\r/g, '').split('\n');
  const blocks = [];
  const meta   = {};
  let paragraph = [];
  let quote     = [];

  // `paragraph` holds { text } items and { comment } items, in typing order.
  // Comments stay on their own line and don't split the paragraph around them.
  const flushParagraph = () => {
    if (!paragraph.length) return;

    const parts = [];
    let textLines = [];

    const closeText = () => {
      if (textLines.length) {
        parts.push(formatInline(textLines.join(' '), isFrench));
        textLines = [];
      }
    };

    for (const item of paragraph) {
      if ('comment' in item) {
        closeText();
        parts.push('% ' + item.comment);
      } else {
        textLines.push(item.text);
      }
    }
    closeText();

    blocks.push(parts.join('\n'));
    paragraph = [];
  };

  const flushQuote = () => {
    if (!quote.length) return;

    const body = quote
      .join('\n')
      .split(/\n\s*\n/)                       // paragraphs inside the quote
      .map(p => p.split('\n').map(s => s.trim()).filter(Boolean).join(' '))
      .map(p => formatInline(p, isFrench))
      .filter(Boolean)
      .join('\n\n');

    blocks.push('\\begin{quote}\n' + body + '\n\\end{quote}');
    quote = [];
  };

  const flushAll = () => { flushParagraph(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.trim();
    let match;

    if ((match = line.match(COMMENT_RE))) {
      flushQuote();
      paragraph.push({ comment: match[1] });
      continue;
    }

    if ((match = line.match(META_RE))) {
      meta[match[1]] = formatInline(match[2], isFrench);
      continue;
    }

    if ((match = line.match(HEADING_RE))) {
      flushAll();
      const command = HEADING_COMMANDS[match[1].length - 1];
      blocks.push(`\\${command}*{${formatInline(match[2], isFrench)}}`);
      continue;
    }

    if (BREAK_RE.test(line)) {
      flushAll();
      blocks.push(SCENE_BREAK_LATEX);
      continue;
    }

    if ((match = raw.match(QUOTE_RE))) {
      flushParagraph();
      quote.push(match[1]);
      continue;
    }

    if (!line) {                               // blank line
      flushAll();
      continue;
    }

    flushQuote();
    paragraph.push({ text: line });
  }

  flushAll();
  return { blocks, meta };
}

function buildPreamble(meta) {
  const f = getFormat();

  const head = [
    `\\documentclass[${f.pt}pt]{article}`,
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[utf8]{inputenc}',
    `\\usepackage[paperwidth=${f.w}cm,paperheight=${f.h}cm,margin=${f.m}cm]{geometry}`,
    `\\usepackage[${langSelect.value}]{babel}`,
    '\\usepackage{microtype}',
  ].join('\n');

  const title = meta.title
    ? `\n\\title{${meta.title}}\n\\author{${meta.author || ''}}\n\\date{${meta.date || ''}}\n`
    : '';

  return head + title;
}

/** Builds the full LaTeX output (or just the body if "preamble" is unchecked). */
function build() {
  const isFrench = langSelect.value === 'french';
  const { blocks, meta } = parseText(textarea.value, isFrench);
  const body = blocks.join('\n\n');

  if (!preambleCb.checked) return body + '\n';

  const maketitle = meta.title ? '\\maketitle\n\n' : '';
  return buildPreamble(meta)
    + '\n\n\\begin{document}\n'
    + maketitle
    + body
    + '\n\n\\end{document}\n';
}


/* ==========================================================================
   Comment highlighting
   A textarea can't colour individual lines, so a transparent-text textarea
   sits on top of a div (#hl) that shows the same text, comments in blue.
   ========================================================================== */

const escapeHtml = s =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderHighlight() {
  const html = textarea.value
    .split('\n')
    .map(line => {
      const safe = escapeHtml(line);
      return COMMENT_RE.test(line.trim()) ? `<span class="cm">${safe}</span>` : safe;
    })
    .join('\n');

  // Zero-width char so a trailing newline still produces a visible last line
  highlight.innerHTML = html + '\u200b';

  // Hide the textarea's own text only now that the layer below shows it
  editor.classList.add('hl-on');
}


/* ==========================================================================
   Typewriter scrolling (keeps the caret vertically centred)
   ========================================================================== */

/* Hidden "mirror" used to measure where the caret is on screen. */
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

/* Right-clicking a word (e.g. for spell check) selects it, which would make
   the view jump. While the context menu is open, centering is paused. */
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

  // Text before the caret, followed by a marker span at the caret position
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

let idleTimer;
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

function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), IDLE_DELAY_MS);
}

function updateWordCount() {
  const words = (textarea.value.match(/\S+/g) || []).length;
  $('count').textContent = words + (words > 1 ? ' words' : ' word');
}

function save() {
  try {
    localStorage.setItem('tw-text', textarea.value);
    localStorage.setItem('tw-opt', JSON.stringify({
      l: langSelect.value,
      p: preambleCb.checked,
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

    if (opts.l) langSelect.value = opts.l;
    if (opts.p === false) preambleCb.checked = false;
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

const syncLanguage = () => {
  textarea.lang = langSelect.value === 'french' ? 'fr' : 'en';
};

const syncCustomVisibility = () => {
  customBox.style.display = fmtSelect.value === 'custom' ? 'inline-flex' : 'none';
};


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
   Editing events
   ========================================================================== */

/* Paragraph indent: real spaces (a textarea can't indent only the first line
   of each paragraph). Same width as the Tab key. The LaTeX export trims
   leading spaces, so the indent never reaches the .tex file. */
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
  contextMenuOpen = false;                     // e.g. a spell-check suggestion was applied
  renderHighlight();
  fit();
  center();
  requestAnimationFrame(center);
  updateWordCount();
  save();
  wake();
});

textarea.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) return;
    insertTab();
    playClick();
    return;
  }

  if (indentCb.checked && !e.isComposing) {
    const plainEnter = e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

    if (plainEnter) {
      e.preventDefault();
      insertNewParagraphLine();
      playClick();
      return;
    }

    if (e.key === 'Backspace' && deleteWholeIndent()) {
      e.preventDefault();
      playClick();
      return;
    }

    if (isFirstCharacter(e)) insertText(INDENT);   // then the key types normally
  }

  const isTypingKey = e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace';
  if (isTypingKey) playClick();
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
  document.addEventListener(type, wake, { passive: true }));

// Toolbar controls shouldn't steal Tab focus from the writing area
document.querySelectorAll('#bar button, #bar select, #bar input')
  .forEach(el => { el.tabIndex = -1; });


/* ==========================================================================
   Toolbar
   ========================================================================== */

langSelect.onchange = () => { syncLanguage(); save(); };
preambleCb.onchange = save;
indentCb.onchange = () => { save(); textarea.focus(); };

fmtSelect.onchange = () => {
  syncCustomVisibility();
  save();
  refreshLayout();
  textarea.focus();
};

Object.values(customInputs).forEach(input => {
  input.oninput = () => { save(); refreshLayout(); };
});

$('bFs').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    textarea.focus();
  } catch (e) {
    toast('Fullscreen unavailable here — try F10');
  }
};

$('bSnd').onclick = () => {
  soundOn = !soundOn;
  $('bSnd').textContent = soundOn ? '♪ on' : '♪ off';
  textarea.focus();
};


/* ---------- export / copy ---------- */

function exportTex() {
  const blob = new Blob([build()], { type: 'application/x-tex;charset=utf-8' });
  const link = document.createElement('a');

  link.href = URL.createObjectURL(blob);
  link.download = 'texte.tex';
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('texte.tex downloaded');
}

async function copyTex() {
  try {
    await navigator.clipboard.writeText(build());
    toast('LaTeX copied');
  } catch (e) {
    openOverlay('src');                        // fallback: let the user copy manually
  }
}


/* ---------- overlay (source / help) ---------- */

function openOverlay(mode) {
  const showSource = mode === 'src';
  const showHelp   = mode === 'help';

  overlay.classList.add('on');
  srcView.style.display  = showSource ? 'block' : 'none';
  helpView.style.display = showHelp   ? 'block' : 'none';
  $('bOvCopy').style.display = showSource ? 'inline-block' : 'none';

  if (showSource) {
    srcView.value = build();
    srcView.focus();
    srcView.select();
  }
}

function closeOverlay() {
  overlay.classList.remove('on');
  textarea.focus();
}

function copySourceFromOverlay() {
  srcView.select();
  try {
    document.execCommand('copy');
    toast('LaTeX copied');
  } catch (e) { /* nothing more to do */ }
}

$('bExp').onclick     = exportTex;
$('bCopy').onclick    = copyTex;
$('bSrc').onclick     = () => openOverlay('src');
$('bHelp').onclick    = () => openOverlay('help');
$('bClose').onclick   = closeOverlay;
$('bOvCopy').onclick  = copySourceFromOverlay;


/* ==========================================================================
   Startup
   ========================================================================== */

restore();
renderHighlight();
syncLanguage();
syncCustomVisibility();
updateWordCount();
wake();
refreshLayout();

if (document.fonts) document.fonts.ready.then(refreshLayout);
