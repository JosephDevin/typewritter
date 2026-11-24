// accents.js: Ctrl shortcuts for French accented capitals and circumflexes
(() => {
    const ta = document.getElementById('paper');
    if (!ta) return;

    function insert(text) {
        ta.focus();
        // execCommand keeps native undo/redo and fires "input" (so the highlight layer updates)
        if (document.execCommand && document.execCommand('insertText', false, text)) return;
        // Fallback
        const s = ta.selectionStart, e = ta.selectionEnd;
        ta.setRangeText(text, s, e, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    ta.addEventListener('keydown', (ev) => {
        if (!ev.ctrlKey || ev.metaKey) return;

        let out = null;

        if (ev.shiftKey && ev.code === 'Digit2') out = 'É';
        else if (ev.shiftKey && ev.code === 'Digit7') out = 'È';
        else if (ev.code === 'Digit0') out = ev.shiftKey ? 'À' : 'à';
        else if (ev.key === '{') out = ev.shiftKey ? 'Ê' : 'ê';
        else if (ev.key === '\'') out = 'ù';

        if (out) {
            ev.preventDefault();
            insert(out);
        }
    });
})();