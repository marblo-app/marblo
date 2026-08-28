/**
 * REPLAY — execute an intent script against a page that may have changed.
 *
 * Scoring is done by a separate ORACLE, not by the replayer's own opinion of
 * itself. The oracle stands in for the human who would look at the screen
 * afterwards: it reads the fixture's `data-behavior` anchors (which no resolver
 * can see — see lib/snapshot.mjs) and answers two questions:
 *   1. did the form end up in the intended state?
 *   2. did the value land in the RIGHT field?
 * (2) is what separates "it failed" from "it quietly filed the wrong number",
 * and only the second one is expensive in real life.
 */
import { resolveTarget } from './resolve.mjs';

function bind(step, inputs) {
  if (!step.value) return undefined;
  return step.value.from === 'input' ? inputs[step.value.ref] : step.value.text;
}

export async function replay(page, script, { arm, inputs }) {
  const trace = { steps: [], model: [], rejected: [] };

  for (const step of script.steps) {
    const { locator, tier } = await resolveTarget(page, step, arm, trace);
    if (!locator) {
      trace.steps.push({ id: step.id, tier: null, status: 'unresolved' });
      trace.stoppedAt = step.id;
      // onResolveFail: "escalate" → in production this is the handoff point.
      break;
    }

    const value = bind(step, inputs);
    try {
      if (step.kind === 'fill') await locator.fill(value);
      else if (step.kind === 'select') await locator.selectOption(value);
      else if (step.kind === 'click') await locator.click();
    } catch (err) {
      trace.steps.push({ id: step.id, tier, status: 'action-failed', error: String(err).split('\n')[0] });
      trace.stoppedAt = step.id;
      break;
    }

    let verified = null;
    if (step.verify?.kind === 'valueEquals') {
      verified = (await locator.inputValue().catch(() => null)) === value;
    }
    trace.steps.push({ id: step.id, tier, status: verified === false ? 'verify-failed' : 'ok', verified });
    if (verified === false) {
      trace.stoppedAt = step.id;
      break;
    }
  }

  await page.waitForTimeout(150);
  trace.oracle = await oracle(page, inputs);
  return trace;
}

/** Ground truth. Reads the fixture's own anchors — the resolvers never see these. */
async function oracle(page, inputs) {
  return await page.evaluate((inp) => {
    const q = (b) => document.querySelector(`[data-behavior="${b}"]`);
    const result = q('result');
    const amount = q('amount');
    const vendor = q('vendor');
    const decoys = Array.from(document.querySelectorAll('input[type="text"]')).filter(
      (el) => !el.hasAttribute('data-behavior') && el.value
    );
    return {
      resultState: result?.dataset.state || 'none',
      resultText: result?.textContent.trim() || '',
      amountFieldValue: amount?.value ?? null,
      vendorFieldValue: vendor?.value ?? null,
      amountLandedInRightField: (amount?.value ?? '') === String(inp.amount),
      strayFilledFields: decoys.map((el) => ({ name: el.getAttribute('name'), value: el.value })),
    };
  }, inputs);
}

export function grade(trace, inputs) {
  const o = trace.oracle;
  const succeeded =
    o.resultState === 'ok' &&
    o.amountLandedInRightField &&
    o.vendorFieldValue === inputs.vendor &&
    o.strayFilledFields.length === 0;
  if (succeeded) return { verdict: 'PASS', detail: o.resultText };
  if (o.resultState === 'ok' && !o.amountLandedInRightField)
    return { verdict: 'SILENT-CORRUPTION', detail: `submitted, but amount went to ${JSON.stringify(o.strayFilledFields)}` };
  if (o.strayFilledFields.length > 0 && o.resultState !== 'ok')
    return { verdict: 'FAIL-DIRTY', detail: `wrote into wrong field ${JSON.stringify(o.strayFilledFields)}, then stopped` };
  return { verdict: 'FAIL-CLEAN', detail: trace.stoppedAt ? `stopped at ${trace.stoppedAt}` : o.resultText };
}
