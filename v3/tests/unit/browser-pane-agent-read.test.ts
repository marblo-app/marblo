import { describe, expect, it } from "vitest";
import type { WebContents } from "electron";
import {
  runAgentNavigation,
  runAgentReadExtraction,
} from "../../electron/browser-pane-agent-read";

function fakeWebContents(
  executeJavaScript: () => Promise<unknown>,
): WebContents {
  return {
    executeJavaScript,
    getURL: () => "https://fallback.example.com",
  } as unknown as WebContents;
}

describe("runAgentReadExtraction", () => {
  it("returns the capped, redacted snapshot on a normal read", async () => {
    const wc = fakeWebContents(async () => ({
      title: "Dashboard",
      url: "https://example.com/dashboard",
      text: "Revenue is up. api key: sk-abcdEFGH12345678ijklMNOP",
    }));
    const snapshot = await runAgentReadExtraction(wc);
    expect(snapshot.title).toBe("Dashboard");
    expect(snapshot.url).toBe("https://example.com/dashboard");
    expect(snapshot.text).toContain("Revenue is up.");
    expect(snapshot.text).toContain("<REDACTED>");
    expect(snapshot.text).not.toContain("sk-abcdEFGH12345678ijklMNOP");
    expect(snapshot.redactedCount).toBe(1);
    expect(snapshot.truncated).toBe(false);
  });

  it("falls back to webContents.getURL() when the page reports no url", async () => {
    const wc = fakeWebContents(async () => ({
      title: "",
      url: "",
      text: "",
    }));
    const snapshot = await runAgentReadExtraction(wc);
    expect(snapshot.url).toBe("https://fallback.example.com");
  });

  it("rejects immediately for an already-aborted signal, without calling executeJavaScript's result", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const wc = fakeWebContents(async () => {
      called = true;
      return { title: "", url: "", text: "" };
    });
    await expect(
      runAgentReadExtraction(wc, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    // The underlying script may or may not have been invoked (fire-and-forget
    // Electron behavior isn't ours to control), but the promise this function
    // hands back must already be the rejection — that's the part the global
    // stop's `suspend()` depends on to keep a cut-off read from being used.
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

    const pending = runAgentReadExtraction(wc, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    // The script "finishing" afterwards must not somehow resurrect the
    // already-rejected read.
    resolveScript({ title: "late", url: "https://late.example.com", text: "" });
  });

  it("does not reject when no signal is given", async () => {
    const wc = fakeWebContents(async () => ({
      title: "ok",
      url: "https://example.com",
      text: "fine",
    }));
    await expect(runAgentReadExtraction(wc)).resolves.toMatchObject({
      title: "ok",
    });
  });
});

describe("runAgentNavigation", () => {
  it("loads only the requested URL", async () => {
    const loadURL = async () => undefined;
    const stop = () => {};
    await expect(
      runAgentNavigation({ loadURL, stop }, "https://example.com"),
    ).resolves.toBeUndefined();
  });

  it("does not start a navigation after the global stop already fired", async () => {
    const controller = new AbortController();
    controller.abort();
    let loaded = false;
    await expect(
      runAgentNavigation(
        {
          loadURL: async () => {
            loaded = true;
          },
          stop: () => {},
        },
        "https://example.com",
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(loaded).toBe(false);
  });

  it("stops an in-flight load and rejects immediately when the global stop fires", async () => {
    const controller = new AbortController();
    let resolveLoad: () => void = () => {};
    let stopped = false;
    const pending = runAgentNavigation(
      {
        loadURL: () =>
          new Promise<void>((resolve) => {
            resolveLoad = resolve;
          }),
        stop: () => {
          stopped = true;
        },
      },
      "https://example.com",
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(stopped).toBe(true);
    resolveLoad();
  });
});
