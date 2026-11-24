/* ==========================================================================
   Paper menus for the TEX and FORMAT keys

   The native <select> elements stay in the page (hidden from the mouse), so
   toolbar.js, export.js and projects.js keep working untouched: choosing an
   item sets the select's value and fires its "change" event.
   Load this file after projects.js.
   ========================================================================== */

(() => {
  const selects = [$('texSelect'), $('fmt')];

  const sheet = document.createElement('div');
  sheet.id = 'menuSheet';
  sheet.setAttribute('role', 'menu');
  document.body.appendChild(sheet);

  let active = null;                       // { select, wrap } of the open menu

  const isOpen = () => sheet.classList.contains('open');
  const items  = () => [...sheet.querySelectorAll('.mi')];

  /** One line per visible <option> of the select. */
  function build(select) {
    sheet.replaceChildren();
    let n = 0;

    [...select.options].forEach(option => {
      if (option.disabled || option.hidden) return;      // e.g. the "TEX" placeholder

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'mi' + (select.value === option.value ? ' current' : '');
      item.setAttribute('role', 'menuitem');
      item.dataset.value = option.value;
      item.style.setProperty('--n', n++);                // staggers the entrance
      item.textContent = option.textContent;
      sheet.appendChild(item);
    });
  }

  function open(select) {
    const wrap = select.closest('.select-wrap');
    active = { select, wrap };
    build(select);

    // The sheet hangs from its bottom edge, just above the key
    const r = wrap.getBoundingClientRect();
    sheet.style.maxHeight = Math.max(120, r.top - 24) + 'px';
    sheet.style.bottom    = (window.innerHeight - r.top + 12) + 'px';

    const width = sheet.offsetWidth;
    const left  = Math.min(
      Math.max(12, r.left + r.width / 2 - width / 2),
      window.innerWidth - width - 12);
    sheet.style.left = Math.max(12, left) + 'px';

    wrap.classList.add('on');
    sheet.classList.add('open', 'entering');
    setTimeout(() => sheet.classList.remove('entering'), 900);

    (sheet.querySelector('.current') || sheet.querySelector('.mi')).focus();
  }

  function close(refocus = true) {
    if (active) active.wrap.classList.remove('on');
    active = null;
    sheet.classList.remove('open', 'entering');
    if (refocus) textarea.focus();
  }

  function choose(value) {
    const { select } = active;
    close();
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ---------- events ---------- */

  selects.forEach(select => {
    const wrap = select.closest('.select-wrap');
    wrap.addEventListener('click', () => {
      if (isOpen() && active.select === select) close();
      else open(select);
    });
  });

  sheet.addEventListener('click', e => {
    const item = e.target.closest('.mi');
    if (item) choose(item.dataset.value);
  });

  // Click anywhere else closes it (a click on the key itself toggles, see above)
  document.addEventListener('mousedown', e => {
    if (!isOpen()) return;
    if (sheet.contains(e.target) || active.wrap.contains(e.target)) return;
    close(false);
  });

  window.addEventListener('resize', () => { if (isOpen()) close(false); });

  sheet.addEventListener('keydown', e => {
    const list = items();
    const at = list.indexOf(document.activeElement);

    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[Math.min(at + 1, list.length - 1)].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[Math.max(at - 1, 0)].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1].focus();
    }
  });
})();
