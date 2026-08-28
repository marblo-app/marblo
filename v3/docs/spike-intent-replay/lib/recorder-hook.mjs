/**
 * The in-page recorder. Injected before any page script runs; listens to real
 * DOM events and captures, for every interaction, both the *intent context*
 * (what the control is called, what group it is in) and the *selector hints*
 * (fast path for replay). Playwright's actions dispatch trusted events, so the
 * capture path is the same one a human's clicks would take.
 */
export const RECORDER_HOOK = `
(() => {
  window.__spikeRec = [];

  function cssPath(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let seg = cur.tagName.toLowerCase();
      if (cur.classList.length) seg += '.' + Array.from(cur.classList).map((c) => CSS.escape(c)).join('.');
      const sibs = cur.parentElement ? Array.from(cur.parentElement.children).filter((s) => s.tagName === cur.tagName) : [];
      if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function xPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
      const sibs = Array.from(cur.parentElement ? cur.parentElement.children : []).filter((s) => s.tagName === cur.tagName);
      parts.unshift(cur.tagName.toLowerCase() + '[' + (sibs.indexOf(cur) + 1) + ']');
      cur = cur.parentElement;
    }
    return '/html/' + parts.join('/');
  }

  function labelOf(el) {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return l.textContent.trim();
    }
    const w = el.closest('label');
    if (w) return w.textContent.trim();
    return el.getAttribute('aria-label') || '';
  }

  function groupOf(el) {
    const fs = el.closest('fieldset');
    const lg = fs && fs.querySelector('legend');
    if (lg) return lg.textContent.trim();
    const sec = el.closest('section, form, main');
    const h = sec && sec.querySelector('h1, h2, h3');
    return h ? h.textContent.trim() : '';
  }

  function roleOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (t === 'submit' || t === 'button') return 'button';
    return 'textbox';
  }

  function nearby(el) {
    const box = el.closest('div, td, li, fieldset') || el.parentElement;
    if (!box) return [];
    return box.textContent.split(/\\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  }

  function capture(kind, el, value) {
    window.__spikeRec.push({
      kind,
      value: value === undefined ? undefined : String(value),
      role: roleOf(el),
      accessibleName: labelOf(el) || (el.tagName.toLowerCase() === 'button' ? el.textContent.trim() : ''),
      group: groupOf(el),
      hints: {
        css: cssPath(el),
        xpath: xPath(el),
        attrs: {
          name: el.getAttribute('name') || '',
          placeholder: el.getAttribute('placeholder') || '',
          type: el.getAttribute('type') || '',
        },
        text: el.tagName.toLowerCase() === 'button' ? el.textContent.trim() : '',
        nearbyText: nearby(el),
      },
    });
  }

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') capture('select', el, el.value);
    else if (tag === 'input' || tag === 'textarea') capture('fill', el, el.value);
  }, true);

  document.addEventListener('click', (e) => {
    const el = e.target instanceof HTMLElement ? e.target.closest('button, a[href], [role="button"]') : null;
    if (el) capture('click', el);
  }, true);
})();
`;
