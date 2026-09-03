import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BrowserPaneOpenUrlDelivery,
  classifyInAppBrowserNavigation,
  normalizeBrowserPaneUrl,
  resolveExternalLinkRouting,
  type BrowserPaneOpenUrlSender,
} from "../../electron/in-app-browser-policy";

// electron/main.ts runs Electron app-lifecycle side effects at import time
// (app.whenReady(), etc.), so it can't be imported into a Vitest run — see
// tests/unit/pty-write-submit-ipc-contract.test.ts for the same constraint.
// These assert directly on the source text instead, mirroring that file's
// pattern. The branch logic itself is covered behaviorally below through the
// pure routing + ack-delivery helper extracted from that main-process branch.
const root = path.resolve(__dirname, "../..");
const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");

function extractFunction(name: string): string {
  const start = main.indexOf(`function ${name}(`);
  expect(
    start,
    `function ${name} not found in electron/main.ts`,
  ).toBeGreaterThanOrEqual(0);
  // Grab a generous window past the signature; every function below is well
  // under 4000 chars, so this always captures the full body.
  return main.slice(start, start + 4000);
}

describe("routeAppExternalLink no longer has a silent branch (bHuirRxD643VVvhdaWGM)", () => {
  const source = extractFunction("routeAppExternalLink");

  it("routes through the pure resolveExternalLinkRouting decision instead of re-deriving branches inline", () => {
    expect(source).toContain("resolveExternalLinkRouting(");
  });

  it("keeps local demos distinct from the app's own origin", () => {
    expect(source).toContain("isLocalBrowserPaneUrl(normalized, currentAppOrigin())");
    expect(main).toContain("const appOrigin = currentAppOrigin();");
    expect(main).not.toContain(
      'host === DEV_SERVER_HOST || host === "127.0.0.1"',
    );
  });

  it("does not fire-and-forget shell.openExternal anymore", () => {
    // The exact bug: `void shell.openExternal(normalized);` discarded the
    // promise, so a rejected open (no default browser, OS refusal, ...)
    // vanished with no log and no user-facing notice.
    expect(source).not.toContain("void shell.openExternal(");
    expect(source).toContain("shell.openExternal(normalized).catch(");
  });

  it("the open-external branch handles openExternal rejection with a log and a notice", () => {
    const openExternalBranch = source.slice(
      source.indexOf("shell.openExternal("),
    );
    expect(openExternalBranch).toContain("console.error(");
    expect(openExternalBranch).toContain("presentExternalLinkNotice(");
    expect(openExternalBranch).toContain('"open-failed"');
  });

  it("the blocked (deny) branch logs and notifies instead of doing nothing", () => {
    const blockedBranch = source.slice(
      source.indexOf('routing.kind === "blocked"'),
      source.indexOf('routing.kind === "blocked"') + 400,
    );
    expect(blockedBranch).toContain("console.warn(");
    expect(blockedBranch).toContain("presentExternalLinkNotice(");
  });

  it("the open-in-tab branch uses the ack-backed delivery path", () => {
    expect(source).toContain("browserPaneOpenUrlDelivery.send(");
    expect(source).not.toContain('owner.send("browserPane:openUrl"');
  });
});

describe("routeAppExternalLink open-in-tab behavior", () => {
  function makeClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map<number, { at: number; fn: () => void }>();
    return {
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout: (handle: unknown) => {
        timers.delete(handle as number);
      },
      advance: (ms: number) => {
        now += ms;
        for (const [id, timer] of [...timers].sort(
          (a, b) => a[1].at - b[1].at,
        )) {
          if (timer.at > now) continue;
          timers.delete(id);
          timer.fn();
        }
      },
    };
  }

  function routeAllowedLinkWithRegisteredTab(
    owner: BrowserPaneOpenUrlSender,
    rawUrl: string,
    delivery: BrowserPaneOpenUrlDelivery,
  ) {
    const normalized = normalizeBrowserPaneUrl(rawUrl);
    const decision = classifyInAppBrowserNavigation(normalized);
    const routing = resolveExternalLinkRouting(decision, true);
    if (routing.kind === "open-in-tab") {
      delivery.send(owner, normalized);
    }
    return routing;
  }

  it("does not silently drop an allowed link when the renderer never acknowledges browserPane:openUrl", () => {
    const clock = makeClock();
    const onDeliveryFailed = vi.fn();
    const owner: BrowserPaneOpenUrlSender = {
      id: 17,
      isDestroyed: () => false,
      send: vi.fn(),
    };
    const delivery = new BrowserPaneOpenUrlDelivery({
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      generateRequestId: () => "req-open-tab",
      onDeliveryFailed,
      ackTimeoutMs: 1500,
    });

    expect(
      routeAllowedLinkWithRegisteredTab(
        owner,
        "example.com/docs",
        delivery,
      ),
    ).toEqual({ kind: "open-in-tab" });
    expect(owner.send).toHaveBeenCalledWith("browserPane:openUrl", {
      url: "https://example.com/docs",
      requestId: "req-open-tab",
    });

    clock.advance(1499);
    expect(onDeliveryFailed).not.toHaveBeenCalled();

    clock.advance(1);
    expect(onDeliveryFailed).toHaveBeenCalledWith(
      owner,
      "https://example.com/docs",
    );
  });
});

describe("presentExternalLinkNotice surfaces via the existing best-effort Notification pattern", () => {
  it("guards with Notification.isSupported() like the lifecycle-reclaim alert does", () => {
    const start = main.indexOf("function presentExternalLinkNotice(");
    expect(start).toBeGreaterThanOrEqual(0);
    const source = main.slice(start, start + 500);
    expect(source).toContain("Notification.isSupported()");
    expect(source).toContain("new Notification(");
  });
});

describe("handleBrowserPaneExternalNavigation no longer drops openExternal failures", () => {
  it("catches the rejection and records a pane notice instead of `void`-ing it", () => {
    const start = main.indexOf(
      "function handleBrowserPaneExternalNavigation(",
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const source = main.slice(start, start + 700);
    expect(source).not.toContain("void shell.openExternal(");
    expect(source).toContain("shell.openExternal(url).catch(");
    expect(source).toContain("record.notice = {");
    expect(source).toContain("sendBrowserPaneState(record);");
  });
});
