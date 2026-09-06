import { describe, expect, it } from "vitest";
import type { WebContents } from "electron";
import { runAgentFillAction } from "../../electron/browser-pane-agent-write";

function fakeWebContents(
  executeJavaScript: (script: string) => Promise<unknown>,
): WebContents {
  return {
    executeJavaScript,
  } as unknown as WebContents;
}

describe("runAgentFillAction", () => {
  it("reports success with the applied value length on a normal fill", async () => {
    const wc = fakeWebContents(async () => ({
      ok: true,
      elementFound: true,
      fieldIsFillable: true,
      appliedValueLength: 11,
    }));
    const result = await runAgentFillAction(wc, "#subject", "hello world");
    expect(result).toEqual({
      ok: true,
      elementFound: true,
      fieldIsFillable: true,
      appliedValueLength: 11,
      truncated: false,
    });
  });

  it("never emits a script containing a submit/click call for the target element", async () => {
    let capturedScript = "";
    const wc = fakeWebContents(async (script) => {
      capturedScript = script;
      return {
        ok: true,
        elementFound: true,
        fieldIsFillable: true,
        appliedValueLength: 5,
      };
    });
    await runAgentFillAction(wc, "#field", "hello");
    expect(capturedScript).not.toMatch(/\.submit\s*\(/);
    expect(capturedScript).not.toMatch(/\.click\s*\(/);
    expect(capturedScript).not.toMatch(/KeyboardEvent/);
    expect(capturedScript).not.toMatch(/requestSubmit/);
  });

  it("never dispatches a 'change' event — only 'input', so a fill can't be more aggressive than a real user's keystroke and can't trip onchange=submit() pages", async () => {
    let capturedScript = "";
    const wc = fakeWebContents(async (script) => {
      capturedScript = script;
      return {
        ok: true,
        elementFound: true,
        fieldIsFillable: true,
        appliedValueLength: 5,
      };
    });
    await runAgentFillAction(wc, "#field", "hello");
    expect(capturedScript).not.toMatch(/["']change["']/);
    expect(capturedScript).toMatch(/["']input["']/);
  });

  it("reports elementFound=false without fieldIsFillable when the selector matches nothing", async () => {
    const wc = fakeWebContents(async () => ({
      ok: false,
      elementFound: false,
      fieldIsFillable: false,
      appliedValueLength: 0,
    }));
    const result = await runAgentFillAction(wc, "#missing", "x");
    expect(result.ok).toBe(false);
    expect(result.elementFound).toBe(false);
  });

  it("reports fieldIsFillable=false for an element found but not fillable (e.g. a button)", async () => {
    const wc = fakeWebContents(async () => ({
      ok: false,
      elementFound: true,
      fieldIsFillable: false,
      appliedValueLength: 0,
    }));
    const result = await runAgentFillAction(wc, "button#submit", "x");
    expect(result.ok).toBe(false);
    expect(result.elementFound).toBe(true);
    expect(result.fieldIsFillable).toBe(false);
  });

  it("truncates an overlong value before it ever reaches the page script", async () => {
    let sentValueLength = 0;
    const wc = fakeWebContents(async (script) => {
      sentValueLength = script.length;
      return {
        ok: true,
        elementFound: true,
        fieldIsFillable: true,
        appliedValueLength: 5000,
      };
    });
    const long = "y".repeat(20_000);
    const result = await runAgentFillAction(wc, "#field", long);
    expect(result.truncated).toBe(true);
    // The script must not contain the full 20,000-char value verbatim.
    expect(sentValueLength).toBeLessThan(20_000 + 500);
  });

  it("rejects immediately for an already-aborted signal, without calling executeJavaScript's result", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const wc = fakeWebContents(async () => {
      called = true;
      return {
        ok: true,
        elementFound: true,
        fieldIsFillable: true,
        appliedValueLength: 1,
      };
    });
    await expect(
      runAgentFillAction(wc, "#field", "x", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(called).toBe(false);
  });

  it("rejects as soon as the signal aborts mid-flight, before the script resolves", async () => {
    const controller = new AbortController();
    let resolveScript: (v: unknown) => void = () => {};
    const wc = fakeWebContents(
      () =>
        new Promise((resolve) => {
          resolveScript = resolve;
        }),
    );

    const pending = runAgentFillAction(wc, "#field", "x", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    // Late resolution must not resurrect the already-rejected fill.
    resolveScript({
      ok: true,
      elementFound: true,
      fieldIsFillable: true,
      appliedValueLength: 1,
    });
  });

  it("does not reject when no signal is given", async () => {
    const wc = fakeWebContents(async () => ({
      ok: true,
      elementFound: true,
      fieldIsFillable: true,
      appliedValueLength: 2,
    }));
    await expect(runAgentFillAction(wc, "#field", "ok")).resolves.toMatchObject(
      { ok: true },
    );
  });
});
