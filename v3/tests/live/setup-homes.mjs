/**
 * Build the throwaway HOMEs the `s1c` / `s2` scenarios need, and — as a
 * side effect worth keeping — state what re-arms each first-run screen.
 *
 * ★This script is the ONLY place a key is pressed by hand, and it presses them
 * as the USER, not as the product: it is standing in for "the person ran
 * `claude` once and answered the dialogs". The scenario runners never type.
 *
 *   node tests/live/setup-homes.mjs
 *
 * Leaves $TMPDIR/mb-firstrun-live/home-trust with:
 *   · .claude/settings.json  skipDangerousModePermissionPrompt (machine-wide)
 *   · .claude.json           projects["…/trust-dirA"].hasTrustDialogAccepted
 * and prints the timings of the three screens along the way.
 */
import pty from "node-pty";
import fs from "fs";
import path from "path";
import os from "os";

const BASE = path.join(os.tmpdir(), "mb-firstrun-live");
const HOME = path.join(BASE, "home-trust");

/* eslint-disable no-control-regex -- ANSI sanitizing intentionally matches ESC/C0 bytes. */
function strip(s) {
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "");
}
/* eslint-enable no-control-regex */

async function run(dir, answer) {
  fs.mkdirSync(dir, { recursive: true });
  const p = pty.spawn("claude", ["--dangerously-skip-permissions"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: dir,
    env: { ...process.env, HOME },
  });
  const t0 = Date.now();
  let buf = "";
  let trustAt = null;
  let consentAt = null;
  let composerAt = null;
  let answered = false;
  p.onData((d) => {
    buf = (buf + strip(d)).slice(-6000);
    if (trustAt === null && /trust\s*this\s*folder/i.test(buf)) {
      trustAt = Date.now() - t0;
      // Default highlight is "1. Yes, I trust this folder" (claude 2.1.238),
      // so a bare CR accepts. Verified live — the older code comment claiming
      // the default is "No" is stale.
      if (answer && !answered) {
        answered = true;
        setTimeout(() => p.write("\r"), 120);
      }
    }
    if (consentAt === null && /yes,\s*i\s*accept/i.test(buf)) {
      consentAt = Date.now() - t0;
      if (answer) {
        setTimeout(() => {
          p.write("2");
          setTimeout(() => p.write("\r"), 150);
        }, 120);
      }
    }
    if (composerAt === null && /⏵⏵/.test(buf)) composerAt = Date.now() - t0;
  });
  await new Promise((r) => setTimeout(r, 12000));
  try {
    p.kill();
  } catch {
    /* ignore */
  }
  return { trustAt, consentAt, composerAt };
}

fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(HOME, { recursive: true });
// Onboarding already done = the state a user is in after installing and
// logging into Claude Code by hand. Without this the FIRST screen is the theme
// picker, which nothing in Marblo answers (see the doc).
fs.writeFileSync(
  path.join(HOME, ".claude.json"),
  JSON.stringify({ hasCompletedOnboarding: true, theme: "dark" }),
);

const A = path.join(BASE, "trust-dirA");
const B = path.join(BASE, "trust-dirB");
console.log("1) dirA, answering by hand:", JSON.stringify(await run(A, true)));
console.log("2) dirA again, no answer:  ", JSON.stringify(await run(A, false)));
console.log("3) dirB (NEW), no answer:  ", JSON.stringify(await run(B, false)));

const cfg = JSON.parse(
  fs.readFileSync(path.join(HOME, ".claude.json"), "utf8"),
);
console.log(
  "projects recorded:",
  Object.keys(cfg.projects ?? {}).map((k) => path.basename(k)),
);
const st = path.join(HOME, ".claude", "settings.json");
console.log(
  "settings.json keys:",
  fs.existsSync(st)
    ? Object.keys(JSON.parse(fs.readFileSync(st, "utf8")))
    : "(absent)",
);
console.log(`\nhome-trust ready at ${HOME}`);
