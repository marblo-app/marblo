import { describe, expect, it } from "vitest";
import {
  resolveAppLinkSurface,
  type AppLinkSurfaceGraph,
} from "../../electron/in-app-browser-policy";

/**
 * WHICH surface a clicked link belongs to (ticket Gebe84T64LVUh1iO1hQR).
 *
 * `route-app-external-link.test.ts` pins the *other* half of the decision —
 * given "there is a Web tab surface", where does this URL go. It was green
 * the whole time the app was visibly broken, because the half that was wrong
 * is this one: main asked `browserPaneOpenTargets.has(owner.id)` where
 * `owner` is whichever webContents happened to fire the handler, while the
 * only id ever registered is the workspace shell's.
 *
 * The CEO's report is scenario 2 below. xterm's WebLinksAddon default
 * handler opens a link in two steps — `window.open()` with NO url, then
 * `location.href = uri` — so Electron makes a stray default BrowserWindow
 * ("조그만 새 창") and the navigation then surfaces on THAT window's
 * webContents, which is not the shell, so the click was declared homeless and
 * shipped to the OS browser with a "no app window was ready to host a Web
 * tab" notice.
 *
 * A Web-tab host is therefore a property of the OPENER CHAIN, not of a single
 * webContents.
 */

/** A stand-in for Electron's webContents graph at click time. */
function makeGraph(spec: {
  hosts?: number[];
  panes?: number[];
  openers?: Record<number, number>;
}): AppLinkSurfaceGraph {
  const hosts = new Set(spec.hosts ?? []);
  const panes = new Set(spec.panes ?? []);
  const openers = new Map<number, number>(
    Object.entries(spec.openers ?? {}).map(([child, opener]) => [
      Number(child),
      opener,
    ]),
  );
  return {
    isWebTabHost: (id) => hosts.has(id),
    isInAppBrowserPane: (id) => panes.has(id),
    openerOf: (id) => openers.get(id) ?? null,
  };
}

const SHELL = 1;

describe("resolving which surface hosts a clicked link", () => {
  it("uses the shell itself when the click surfaced on the shell", () => {
    const graph = makeGraph({ hosts: [SHELL] });
    expect(resolveAppLinkSurface(SHELL, graph)).toEqual({
      kind: "web-tab-host",
      hostId: SHELL,
    });
  });

  it("uses the opener's shell when the click surfaced on a window the shell opened", () => {
    // THE REGRESSION. The terminal's link handler opened a blank window and
    // then navigated it; the navigation arrives on window 7, not on the
    // shell, and window 7 has never registered anything.
    const graph = makeGraph({ hosts: [SHELL], openers: { 7: SHELL } });
    expect(resolveAppLinkSurface(7, graph)).toEqual({
      kind: "web-tab-host",
      hostId: SHELL,
    });
  });

  it("walks more than one hop of openers", () => {
    const graph = makeGraph({ hosts: [SHELL], openers: { 7: SHELL, 8: 7 } });
    expect(resolveAppLinkSurface(8, graph)).toEqual({
      kind: "web-tab-host",
      hostId: SHELL,
    });
  });

  it("picks the nearest registered host, not the furthest", () => {
    // A second window with its own shell opened a popup: the popup's link
    // belongs in THAT window's Web tab, not the first window's.
    const graph = makeGraph({ hosts: [SHELL, 4], openers: { 7: 4, 4: SHELL } });
    expect(resolveAppLinkSurface(7, graph)).toEqual({
      kind: "web-tab-host",
      hostId: 4,
    });
  });

  it("reports no host when nothing in the chain registered one", () => {
    // The reverse direction the ticket asks us not to break: with no Web tab
    // surface anywhere, the click must still fall back to the OS browser and
    // say why (`no-tab-target`), which is what this answer drives.
    const graph = makeGraph({ hosts: [], openers: { 7: 9 } });
    expect(resolveAppLinkSurface(7, graph)).toEqual({ kind: "no-web-tab-host" });
  });

  it("leaves a click inside the Web tab to the in-app browser's own policy", () => {
    // The pane's WebContentsView also gets the global external-link handling,
    // and its `will-navigate` listener ran FIRST — so every link clicked
    // inside the app's own browser was preventDefault()ed and kicked out to
    // the OS browser. The pane has a complete policy of its own.
    const graph = makeGraph({ hosts: [SHELL], panes: [5] });
    expect(resolveAppLinkSurface(5, graph)).toEqual({
      kind: "in-app-browser-pane",
    });
  });

  it("terminates on a cycle instead of hanging", () => {
    const graph = makeGraph({ hosts: [SHELL], openers: { 7: 8, 8: 7 } });
    expect(resolveAppLinkSurface(7, graph)).toEqual({ kind: "no-web-tab-host" });
  });

  it("gives up on a chain longer than the hop limit", () => {
    const openers: Record<number, number> = {};
    for (let i = 100; i > 2; i--) openers[i] = i - 1;
    const graph = makeGraph({ hosts: [2], openers });
    expect(resolveAppLinkSurface(100, graph)).toEqual({
      kind: "no-web-tab-host",
    });
  });
});
