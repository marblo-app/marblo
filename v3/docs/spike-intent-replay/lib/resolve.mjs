/**
 * Resolution ladder. A step names an element by intent; these are the ways to
 * turn that name back into a live element, cheapest first.
 *
 *   T0 hint:css     recorded CSS path        — free, dies on id/class churn
 *   T0 hint:xpath   recorded structural path — free, dies on layout change
 *   T1 hint:role    role + accessible name   — free, dies on copy changes
 *   T2 hint:attrs   name= / placeholder=     — free, dies on field renames
 *   T3 model        read the screen, pick    — one model call, survives the above
 *
 * Three arms are compared:
 *   selector-only        T0 only,  NO sanity gate  (what Playwright codegen gives you)
 *   intent-deterministic T0..T2 with sanity gate   (intent script, model disabled)
 *   intent-full          T0..T3 with sanity gate   (intent script as designed)
 *
 * The sanity gate is the difference that matters on M5: a stale selector can
 * still *match* something. Without the gate the bot types money into the wrong
 * box and submits. Codegen output has no gate, so neither does the arm that
 * stands in for it.
 */
import { interactiveSnapshot } from './snapshot.mjs';
import { resolveWithModel } from './resolver-llm.mjs';

export const ARMS = {
  'selector-only': { tiers: ['hint:css', 'hint:xpath'], gate: false },
  'intent-deterministic': { tiers: ['hint:css', 'hint:xpath', 'hint:role', 'hint:attrs'], gate: true },
  'intent-full': { tiers: ['hint:css', 'hint:xpath', 'hint:role', 'hint:attrs', 'model'], gate: true },
};

async function uniqueVisible(locator) {
  const n = await locator.count().catch(() => 0);
  if (n !== 1) return null;
  const first = locator.first();
  return (await first.isVisible().catch(() => false)) ? first : null;
}

async function describe(locator) {
  return await locator.evaluate((el) => ({
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    name: el.getAttribute('name') || '',
    placeholder: el.getAttribute('placeholder') || '',
    text: el.textContent.trim(),
    label: el.id
      ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent.trim() || ''
      : '',
  }));
}

function roleMatches(role, seen) {
  if (role === 'button') return seen.tag === 'button' || seen.type === 'submit' || seen.type === 'button';
  if (role === 'combobox') return seen.tag === 'select';
  return seen.tag === 'input' || seen.tag === 'textarea';
}

/**
 * A recorded hint is only trusted if the element it lands on still LOOKS like
 * the thing that was recorded — same role, and at least one identity signal
 * (label text, button text, form name, placeholder) still agreeing.
 */
async function hintLooksRight(locator, target) {
  const seen = await describe(locator).catch(() => null);
  if (!seen || !roleMatches(target.role, seen)) return false;
  const a = target.hints?.attrs || {};
  return (
    seen.label === target.name ||
    seen.text === target.name ||
    (!!a.name && seen.name === a.name) ||
    (!!a.placeholder && seen.placeholder === a.placeholder)
  );
}

export async function resolveTarget(page, step, armName, trace) {
  const { tiers, gate } = ARMS[armName];
  const target = step.target;
  const h = target.hints || {};

  for (const tier of tiers) {
    let loc = null;

    if (tier === 'hint:css' && h.css) {
      loc = await uniqueVisible(page.locator(h.css));
    } else if (tier === 'hint:xpath' && h.xpath) {
      loc = await uniqueVisible(page.locator(`xpath=${h.xpath}`));
    } else if (tier === 'hint:role' && target.name) {
      loc =
        (await uniqueVisible(page.getByLabel(target.name, { exact: true }))) ||
        (await uniqueVisible(page.getByRole(target.role, { name: target.name, exact: true })));
    } else if (tier === 'hint:attrs') {
      for (const s of [
        h.attrs?.name && `[name="${h.attrs.name}"]`,
        h.attrs?.placeholder && `[placeholder="${h.attrs.placeholder}"]`,
      ].filter(Boolean)) {
        loc = await uniqueVisible(page.locator(s));
        if (loc) break;
      }
    } else if (tier === 'model') {
      const nodes = await interactiveSnapshot(page);
      const res = await resolveWithModel(step, nodes);
      trace?.model?.push({ step: step.id, ref: res.ref, raw: res.raw, ms: res.ms, attempts: res.tries.length, prompt: res.prompt });
      if (!res.ref) continue;
      loc = await uniqueVisible(page.locator(`[data-spike-ref="${res.ref}"]`));
      if (!loc) continue;
      // A model pick is EXPECTED to disagree with the recorded label/attrs —
      // that is the whole point — so it is checked on role only.
      const seen = await describe(loc).catch(() => null);
      if (!seen || !roleMatches(target.role, seen)) {
        trace?.rejected?.push({ step: step.id, tier, reason: `model picked ${res.ref}, wrong role` });
        continue;
      }
      return { locator: loc, tier };
    }

    if (!loc) continue;
    if (gate && !(await hintLooksRight(loc, target))) {
      const seen = await describe(loc).catch(() => ({}));
      trace?.rejected?.push({
        step: step.id,
        tier,
        reason: `hint still matched, but element no longer looks like the recorded target (now label="${seen.label || ''}" name="${seen.name || ''}")`,
      });
      continue;
    }
    return { locator: loc, tier };
  }
  return { locator: null, tier: null };
}
