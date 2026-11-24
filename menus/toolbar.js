/* ==========================================================================
   Help text
   ========================================================================== */

const HELP = `SYNTAX
    # Titre            → \\section*{}
    ## Sous-titre        → \\subsection*{}
    ### Plus petit        → \\subsubsection*{}
    > Une ciation          → Citation
    (saut de ligne)    → Nouveau paragraphe.
    Entrée              → Une nouvelle ligne commence par un alinéa.
                         'Supprimer' supprime l'alinéa.
    *italique*  **gras**
    ---  ou  * * *     → Rupture de scène
    "citation"        → « citation »
    @title Mon titre    → \\maketitle (avec @author, @date)
    % un commentaire       → Commentaire LaTex
    
    Maj + Click      →  Ajoute un post-it pour vos prochaines idées.
    
    Ctrl + Maj + é = É
    Ctrl + Maj + è = È
    Ctrl + Maj + ^ = Ê
    Ctrl + Maj + A = À

    Votre texte est automatiquement enregistré dans le navigateur`;
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

let audioCtx;
let noiseBuffer;
let soundOn = false;
let mode = true; // False : light theme (default)

const root = document.documentElement;

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
    $('bSnd').textContent = soundOn ? '♪' : '♪';
    $('bSnd').classList.toggle('on', soundOn);
    textarea.focus();
};

$('bMode').onclick = () => {
    mode = !mode;
    $('bMode').textContent = mode ? '⏾' : '☀︎';

    // Update theme
    if (!mode) {
        setThemeColors({
            "--desk":  "#0f1520",
            "--paper": "#172030",
            "--ink":   "#ebeef5",
            "--muted": "#9aa7bd",
            "--ui":    "#a9b6cc",
            "--key":   "#f2f5fa",
            "--comment": "#7eb2ff",
        });
    } else
    {
        // Light theme
        setThemeColors({
            "--desk":  "#f6f1e4",
            "--paper": "#f6f1e4",
            "--ink":   "#25221d",
            "--muted": "#4c483e",
            "--ui":    "#4a453b",
            "--key":   "#25221d",
            "--comment": "#173671",
        });
    }


}

function setThemeColors(colors) {
    for (const [name, value] of Object.entries(colors)) {
        root.style.setProperty(name, value);
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

$('bHelp').onclick    = () => openOverlay('help');
$('bClose').onclick   = closeOverlay;
$('bOvCopy').onclick  = copySourceFromOverlay;