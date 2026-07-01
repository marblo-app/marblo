// @ts-check

/**
 * Marblo Windows code-sign hook (electron-builder `win.sign`).
 *
 * Runs DURING the build — before electron-builder computes `latest.yml` and the
 * `.blockmap` — so the auto-update metadata hashes are calculated from the
 * SIGNED exe. Signing AFTER the build changes the exe bytes and breaks
 * electron-updater's sha512 check (see docs/signing_runbook.md §6-2).
 *
 * CI-safe: signing only runs when WIN_SIGN=1. Without it (PR/CI builds and
 * ordinary local builds) this hook is a no-op and the exe stays unsigned exactly
 * as before — no USB token required just to build.
 *
 * Signing uses the KoreaSSL EV cert on a SafeNet/Gemalto USB token via
 * `signtool /a` (auto-select the right cert on the token). The token must be
 * plugged in; signtool prompts for the token PIN on the console (stdio is
 * inherited so the prompt is visible). Never store the PIN anywhere — type it at
 * the prompt only. SafeNet can cache the PIN for the session, otherwise each
 * signable file prompts again.
 *
 * Env:
 *   WIN_SIGN=1            enable signing (anything else → skip / unsigned)
 *   SIGNTOOL_PATH=...     full path to signtool.exe (else auto-discover / PATH)
 *   WIN_TIMESTAMP_URL=... RFC3161 timestamp server (default: digicert)
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** Locate signtool.exe — it ships with the Windows SDK and is rarely on PATH. */
function resolveSigntool() {
  if (process.env.SIGNTOOL_PATH) return process.env.SIGNTOOL_PATH;
  const sdkBin = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  try {
    const versions = fs
      .readdirSync(sdkBin)
      .filter((d) => /^10\./.test(d))
      .sort() // zero-padded versions sort correctly lexically
      .reverse(); // newest first
    for (const v of versions) {
      const candidate = path.join(sdkBin, v, "x64", "signtool.exe");
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    /* SDK dir missing — fall back to PATH lookup */
  }
  return "signtool";
}

/** @param {{ path: string }} configuration */
exports.default = async function (configuration) {
  const file = configuration.path;

  if (process.env.WIN_SIGN !== "1") {
    console.log(`[win-sign] WIN_SIGN!=1 — leaving unsigned: ${file}`);
    return;
  }

  // Skip bundled third-party helper binaries (e.g. node-pty's winpty-agent.exe /
  // conpty / pty.node, shipped for several arches). Each signtool call is a fresh
  // token access → one PIN prompt per file when single-logon/PIN-caching is off,
  // which balloons to a dozen+ prompts. SmartScreen reputation and the
  // electron-updater integrity check only care about the primary executables
  // (app exe, uninstaller, and the Setup installer), which live OUTSIDE
  // node_modules and are still signed. Set WIN_SIGN_ALL=1 to sign everything
  // (recommended once PIN caching is enabled).
  if (process.env.WIN_SIGN_ALL !== "1" && /[\\/]node_modules[\\/]/.test(file)) {
    console.log(`[win-sign] skip bundled binary (WIN_SIGN_ALL!=1): ${file}`);
    return;
  }

  const signtool = resolveSigntool();
  const tsUrl =
    process.env.WIN_TIMESTAMP_URL || "http://timestamp.digicert.com";

  console.log(`[win-sign] signing ${file}\n[win-sign]   signtool: ${signtool}`);
  execFileSync(
    signtool,
    ["sign", "/fd", "sha256", "/tr", tsUrl, "/td", "sha256", "/a", file],
    { stdio: "inherit" }, // token PIN prompt shows here
  );
  console.log(`[win-sign] signed ${file}`);
};
