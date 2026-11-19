/* ==========================================================================
   Help text
   ========================================================================== */

const HELP = `SYNTAX
    # Title            → \\section*{}
    ## Subtitle        → \\subsection*{}
    ### Smaller        → \\subsubsection*{}
    > a quote          → quote environment
    (blank line)       → new paragraph
    Enter              → new line starting with an indent.
                         Backspace removes the whole indent.
    *italic*  **bold**
    ---  or  * * *     → scene break
    "quotation"        → « quotation »
    @title My title    → \\maketitle (also @author, @date)
    % a comment        → LaTeX comment (line shown in blue, not typeset)

    Special characters (% & $ # _ { } ~ ^ \\) are escaped for you,
    except a % at the very start of a line, which starts a comment.
    Your text is saved in this browser automatically.`;

helpView.textContent = HELP;

// ===================== Page formats ========================

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
   Toolbar
   ========================================================================== */

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
    $('bSnd').classList.toggle('on', soundOn);
    textarea.focus();
};


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

$('bHelp').onclick    = () => openOverlay('help');
$('bClose').onclick   = closeOverlay;
$('bOvCopy').onclick  = copySourceFromOverlay;