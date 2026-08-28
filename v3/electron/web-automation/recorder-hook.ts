export const INTENT_RECORDER_GLOBAL = "__marbloIntentRecorderV1";

export const INTENT_RECORDER_HOOK = `
(() => {
  const KEY = "${INTENT_RECORDER_GLOBAL}";
  if (window[KEY] && window[KEY].version === "1.0") return;

  window[KEY] = { version: "1.0", events: [] };

  function cssPath(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let seg = cur.tagName.toLowerCase();
      if (cur.classList.length) {
        seg += "." + Array.from(cur.classList).map((c) => CSS.escape(c)).join(".");
      }
      const sibs = cur.parentElement
        ? Array.from(cur.parentElement.children).filter((s) => s.tagName === cur.tagName)
        : [];
      if (sibs.length > 1) seg += ":nth-of-type(" + (sibs.indexOf(cur) + 1) + ")";
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function xPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== "html") {
      const sibs = Array.from(cur.parentElement ? cur.parentElement.children : []).filter(
        (s) => s.tagName === cur.tagName,
      );
      parts.unshift(cur.tagName.toLowerCase() + "[" + (sibs.indexOf(cur) + 1) + "]");
      cur = cur.parentElement;
    }
    return "/html/" + parts.join("/");
  }

  function labelOf(el) {
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) return label.textContent.trim();
    }
    const wrap = el.closest("label");
    if (wrap) return wrap.textContent.trim();
    return (el.getAttribute("aria-label") || "").trim();
  }

  function groupOf(el) {
    const fieldset = el.closest("fieldset");
    const legend = fieldset && fieldset.querySelector("legend");
    if (legend) return legend.textContent.trim();
    const section = el.closest("section, form, main");
    const heading = section && section.querySelector("h1, h2, h3");
    return heading ? heading.textContent.trim() : "";
  }

  function roleOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "submit" || type === "button") return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    return "textbox";
  }

  function nearbyText(el) {
    const box = el.closest("div, td, li, fieldset") || el.parentElement;
    if (!box) return [];
    return box.textContent
      .split(/\\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  function attrsOf(el) {
    return {
      name: el.getAttribute("name") || "",
      placeholder: el.getAttribute("placeholder") || "",
      type: el.getAttribute("type") || "",
    };
  }

  function looksLikeCardNumber(value) {
    const digits = String(value || "").replace(/[\\s-]/g, "");
    return /^\\d{13,19}$/.test(digits);
  }

  function isSensitiveCandidate(el, value) {
    const attrs = attrsOf(el);
    const type = attrs.type.toLowerCase();
    if (type === "password") return true;

    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/^(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year)$/.test(autocomplete)) {
      return true;
    }

    const joined = [
      attrs.name,
      attrs.placeholder,
      el.id || "",
      labelOf(el),
      el.getAttribute("aria-label") || "",
    ]
      .join(" ")
      .toLowerCase();
    if (/(password|passcode|secret|token|api key|apikey|card|credit|cc-number|cvc|cvv|security code|비밀번호|카드|카드번호|보안코드|주민등록)/.test(joined)) {
      return true;
    }

    return looksLikeCardNumber(value);
  }

  function capture(kind, el, rawValue) {
    const tag = el.tagName.toLowerCase();
    const role = roleOf(el);
    const text = tag === "button" || tag === "a" ? el.textContent.trim() : "";
    const sensitiveValue = rawValue === undefined ? false : isSensitiveCandidate(el, rawValue);
    const event = {
      kind,
      role,
      accessibleName: labelOf(el) || text,
      group: groupOf(el),
      hints: {
        css: cssPath(el),
        xpath: xPath(el),
        attrs: attrsOf(el),
        text,
        nearbyText: nearbyText(el),
      },
      sensitiveValue,
    };
    if (rawValue !== undefined && !sensitiveValue) {
      event.value = String(rawValue);
    }
    window[KEY].events.push(event);
  }

  document.addEventListener(
    "change",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const tag = el.tagName.toLowerCase();
      if (tag === "select") {
        capture("select", el, el.value);
      } else if (tag === "input" || tag === "textarea") {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (type === "checkbox" || type === "radio") capture("check", el, el.checked);
        else capture("fill", el, el.value);
      }
    },
    true,
  );

  document.addEventListener(
    "click",
    (e) => {
      const el = e.target instanceof HTMLElement
        ? e.target.closest('button, a[href], [role="button"], input[type="submit"], input[type="button"]')
        : null;
      if (el) capture("click", el);
    },
    true,
  );
})();
`;
