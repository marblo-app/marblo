/**
 * Guards for scripts/bundle-preload.mjs — the step that makes the sandboxed
 * preload's `require("@sentry/electron/preload")` resolve at BUILD time.
 *
 * Why these tests exist (ticket zTwKGyaveJYHEno7G7os): a sandboxed preload
 * cannot resolve node_modules, so the un-bundled tsc output failed that require
 * with "module not found" and the surrounding try/catch swallowed it — the
 * renderer↔main Sentry bridge had never once installed, silently, in any build.
 * The whole class of bug here is "fails quietly", so the bundler self-verifies
 * its artifact and these tests pin that verification down.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error — plain .mjs build script, no type declarations.
import { resolveDsn, verifyBundle } from "../../scripts/bundle-preload.mjs";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bundle-preload-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, body: string) =>
  writeFileSync(join(dir, name), body);

describe("resolveDsn — must agree with what `vite build` inlines", () => {
  it("returns null when no env file declares a DSN", () => {
    expect(resolveDsn(dir, "production", {})).toBeNull();
  });

  it("reads VITE_SENTRY_DSN out of .env", () => {
    write(".env", "VITE_SENTRY_DSN=https://abc@o1.ingest.sentry.io/2\n");
    expect(resolveDsn(dir, "production", {})).toBe(
      "https://abc@o1.ingest.sentry.io/2",
    );
  });

  it("gives .env.[mode] priority over .env — the precedence that once shipped placeholders (BAcFpVKb)", () => {
    write(".env", "VITE_SENTRY_DSN=https://base@o1.ingest.sentry.io/2\n");
    write(
      ".env.production",
      "VITE_SENTRY_DSN=https://prod@o1.ingest.sentry.io/2\n",
    );
    expect(resolveDsn(dir, "production", {})).toBe(
      "https://prod@o1.ingest.sentry.io/2",
    );
  });

  it("lets a real process env var win over every env file", () => {
    write(".env", "VITE_SENTRY_DSN=https://file@o1.ingest.sentry.io/2\n");
    expect(
      resolveDsn(dir, "production", {
        VITE_SENTRY_DSN: "https://real@o1.ingest.sentry.io/2",
      }),
    ).toBe("https://real@o1.ingest.sentry.io/2");
  });

  it("treats template placeholders as unset so .env.example never enables Sentry", () => {
    for (const placeholder of ["<your-dsn>", "your-dsn-here", "changeme", ""]) {
      write(".env", `VITE_SENTRY_DSN=${placeholder}\n`);
      expect(resolveDsn(dir, "production", {})).toBeNull();
    }
  });

  it("strips quotes and honours `export ` prefixes", () => {
    write(".env", `export VITE_SENTRY_DSN="https://q@o1.ingest.sentry.io/2"\n`);
    expect(resolveDsn(dir, "production", {})).toBe(
      "https://q@o1.ingest.sentry.io/2",
    );
  });
});

describe("verifyBundle — the anti-silence guard", () => {
  const withBridge = `require("electron");window.__SENTRY_IPC__={};contextBridge.exposeInMainWorld("electronAPI",{})`;
  const withoutBridge = `require("electron");contextBridge.exposeInMainWorld("electronAPI",{})`;

  it("accepts a DSN build that carries the bridge", () => {
    expect(verifyBundle(withBridge, true)).toMatchObject({ hasBridge: true });
  });

  it("accepts a no-DSN build with the SDK dead-code-eliminated away", () => {
    expect(verifyBundle(withoutBridge, false)).toMatchObject({
      hasBridge: false,
    });
  });

  it("FAILS the build when a DSN is set but the bridge is missing — the silent release breakage", () => {
    expect(() => verifyBundle(withoutBridge, true)).toThrow(/조용히 깨진다/);
  });

  it("FAILS the build when the SDK leaks into a no-DSN artifact — no-op invariant", () => {
    expect(() => verifyBundle(withBridge, false)).toThrow(/no-op 불변식 위반/);
  });

  it("FAILS when a bare require survives — a sandboxed preload cannot resolve it", () => {
    expect(() =>
      verifyBundle(
        `require("electron");require("@sentry/electron/preload");window.__SENTRY_IPC__={};contextBridge.exposeInMainWorld("electronAPI",{})`,
        true,
      ),
    ).toThrow(/미해결 require/);
  });

  it('permits require("electron") and node: builtins, which the sandbox does serve', () => {
    expect(() =>
      verifyBundle(
        `require("electron");require("node:path");window.__SENTRY_IPC__={};contextBridge.exposeInMainWorld("electronAPI",{})`,
        true,
      ),
    ).not.toThrow();
  });

  it("FAILS when the bundle lost exposeInMainWorld — that would white-screen the app (#405)", () => {
    expect(() =>
      verifyBundle(`require("electron");window.__SENTRY_IPC__={}`, true),
    ).toThrow(/번들이 깨졌다/);
  });
});
