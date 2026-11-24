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

        if (!line) {
            flushAll();
            continue;
        }

        flushQuote();
        paragraph.push({ text: line });
    }

    flushAll();
    return { blocks, meta };
}

function buildPreamble(meta, docClass = 'article') {
    const f = getFormat();

    const head = [
        `\\documentclass[${f.pt}pt]{${docClass}}`,
        '\\usepackage[T1]{fontenc}',
        '\\usepackage[utf8]{inputenc}',
        `\\usepackage[paperwidth=${f.w}cm,paperheight=${f.h}cm,margin=${f.m}cm]{geometry}`,
        `\\usepackage[${DOC_LANGUAGE}]{babel}`,
        '\\usepackage{microtype}',
    ].join('\n');

    const title = meta.title
        ? `\n\\title{${meta.title}}\n\\author{${meta.author || ''}}\n\\date{${meta.date || ''}}\n`
        : '';

    return head + title;
}

/**
 * Builds the full LaTeX output (preamble + body).
 *  - build()      : the chapter in the editor, as an article (unchanged behaviour)
 *  - build(parts) : a whole project, parts = [{ title, text }, ...] in order,
 *                   as a report with one \\chapter* per part
 */
function build(parts) {
    const isFrench  = DOC_LANGUAGE === 'french';
    const isProject = Array.isArray(parts);
    if (!isProject) parts = [{ title: '', text: textarea.value }];

    const meta   = {};
    const blocks = [];

    for (const part of parts) {
        const parsed = parseText(part.text, isFrench);

        // @title / @author / @date: the first chapter that defines one wins
        for (const key in parsed.meta) {
            if (!(key in meta)) meta[key] = parsed.meta[key];
        }
        if (isProject && part.title) {
            blocks.push(`\\chapter*{${formatInline(part.title, isFrench)}}`);
        }
        blocks.push(...parsed.blocks);
    }
    const body = blocks.join('\n\n');

    const maketitle = meta.title ? '\\maketitle\n\n' : '';
    return buildPreamble(meta, isProject ? 'report' : 'article')
        + '\n\n\\begin{document}\n'
        + maketitle
        + body
        + '\n\n\\end{document}\n';
}


/* ==========================================================================
   Comment highlighting
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

/* ---------- export / copy ---------- */

const slug = text =>
    (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
    || 'document';

function exportTex(tex, filename) {
    const blob = new Blob([tex], { type: 'application/x-tex;charset=utf-8' });
    const link = document.createElement('a');

    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast('The .tex has been successfully exported.');
}

async function copyTex() {
    try {
        await navigator.clipboard.writeText(build());
        toast('LaTeX copied');
        textarea.focus();
    } catch (e) {
        openOverlay('src');                        // fallback: let the user copy manually
    }
}


/* ---------- TEX select: export / copy / source ---------- */

const texSelect = $('texSelect');
const texHandlers = {
    exportProject: async () => {
        const { project, parts } = await Projects.exportParts();
        exportTex(build(parts), slug(project.name) + '.tex');
        textarea.focus();
    },
    export: () => {
        const { project, chapter } = Projects.current();
        exportTex(build(), `${slug(project.name)}-${slug(chapter.title)}.tex`);
        textarea.focus();
    },
    copy:   () => copyTex(),
    source: () => openOverlay('src'),
};

texSelect?.addEventListener('change', () => {
    const run = texHandlers[texSelect.value];
    texSelect.selectedIndex = 0;
    texSelect.blur();
    if (run) {
        run();
    } else {
        textarea.focus();
    }
});