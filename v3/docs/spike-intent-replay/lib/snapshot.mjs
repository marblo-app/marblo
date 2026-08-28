/**
 * Interactive snapshot of a page — the input a model resolver gets when the
 * recorded selector hints stop matching.
 *
 * Deliberately narrow: it carries only what a *human looking at the screen*
 * could also see (role, label, placeholder, visible text, current value, the
 * group heading a control sits under). It does NOT carry ids, classes, or the
 * `data-behavior` attribute the fixtures use to wire up shared behaviour —
 * ids/classes because they are exactly what churns, `data-behavior` because
 * leaving it in would let the resolver cheat and make this whole spike
 * worthless. run-poc.mjs asserts it never leaks.
 */

export const BANNED_IN_SNAPSHOT = ['data-behavior'];

export async function interactiveSnapshot(page) {
  return await page.evaluate(() => {
    const SELECTOR = 'input, select, textarea, button, a[href], [role="button"]';
    const out = [];
    let i = 0;

    function visible(el) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none';
    }

    function label(el) {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return l.textContent.trim();
      }
      const wrap = el.closest('label');
      if (wrap) return wrap.textContent.trim();
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      return '';
    }

    function group(el) {
      const fs = el.closest('fieldset');
      const lg = fs && fs.querySelector('legend');
      if (lg) return lg.textContent.trim();
      const sec = el.closest('section, form, main');
      const h = sec && sec.querySelector('h1, h2, h3');
      return h ? h.textContent.trim() : '';
    }

    function role(el) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a') return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'submit' || t === 'button') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'textbox';
    }

    for (const el of document.querySelectorAll(SELECTOR)) {
      if (!visible(el)) continue;
      const ref = `@e${++i}`;
      el.setAttribute('data-spike-ref', ref);
      const node = {
        ref,
        role: role(el),
        label: label(el),
        text: (el.tagName.toLowerCase() === 'button' || el.tagName.toLowerCase() === 'a')
          ? el.textContent.trim()
          : '',
        placeholder: el.getAttribute('placeholder') || '',
        group: group(el),
        value: 'value' in el ? String(el.value ?? '') : '',
      };
      if (el.tagName.toLowerCase() === 'select') {
        node.options = Array.from(el.options).map((o) => o.value).filter(Boolean);
      }
      for (const k of Object.keys(node)) {
        if (node[k] === '' || (Array.isArray(node[k]) && node[k].length === 0)) delete node[k];
      }
      out.push(node);
    }
    return out;
  });
}

/** Compact one-line-per-element rendering — this is what goes into the prompt. */
export function renderSnapshot(nodes) {
  return nodes
    .map((n) => {
      const bits = [`${n.ref} ${n.role}`];
      if (n.label) bits.push(`label="${n.label}"`);
      if (n.text) bits.push(`text="${n.text}"`);
      if (n.placeholder) bits.push(`placeholder="${n.placeholder}"`);
      if (n.group) bits.push(`group="${n.group}"`);
      if (n.options) bits.push(`options=[${n.options.join(', ')}]`);
      if (n.value) bits.push(`value="${n.value}"`);
      return bits.join(' ');
    })
    .join('\n');
}
