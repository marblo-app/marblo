#!/usr/bin/env node
// CI entry point for v3/functions unit tests (task IMwzA1ZCiO5eUprKqI09).
//
// Nothing under v3/functions ever ran in CI before this: #1522 merged with
// `npm run test:marketing` failing 3/47 assertions because lint/typecheck
// were the only gates, and the node:test suites were only ever run by hand.
// The web app was already deployed before anyone noticed.
//
// v3/functions cannot take a devDependency (Cloud Build's `npm ci` dies with
// EUSAGE), so this cannot be a normal test runner script — it shells out to
// each existing `npm run test:*` script instead, using only what's already a
// dependency (typescript) or built into node (`node --test`, child_process).
//
// Classification is read live from package.json, not a hand-maintained list:
// a `test:*` script whose command contains `firebase emulators:exec` needs
// the Firestore/Auth emulator (Java + firebase-tools, neither provisioned in
// this job yet) and is reported-but-skipped; every other `test:*` script is
// assumed pure (no emulator, no real network) and is run. This file itself
// is excluded via its own script name (SELF below) to avoid recursing.
//
// ★FLOOR GUARD (review on PR #1524): a dynamic classifier that runs "however
// many suites it finds" goes quietly green the moment it finds none — a
// renamed `test:*` prefix, a package.json split, or a filter that stops
// matching would make this job pass 0 suites and report success. That is the
// exact failure shape this task exists to close (a gate that silently drops
// its own scope), so the pure-suite count is checked against a floor
// measured on 2026-09-08 (main @ 0341121d): 58. Lowering this constant is a
// real code review decision — bump it up freely as suites are added, but
// only lower it deliberately, in the same PR that removes suites.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIN_PURE_SUITES = 58;
const FUNCTIONS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SELF = "test:ci";

const pkg = JSON.parse(
  readFileSync(join(FUNCTIONS_DIR, "package.json"), "utf8"),
);
const scripts = pkg.scripts ?? {};

const testScripts = Object.entries(scripts).filter(
  ([name]) => name.startsWith("test") && name !== SELF,
);

const emulatorSuites = testScripts.filter(([, cmd]) =>
  cmd.includes("firebase emulators:exec"),
);
const pureSuites = testScripts.filter(
  ([, cmd]) => !cmd.includes("firebase emulators:exec"),
);

console.log(
  `v3/functions test inventory: ${testScripts.length} total, ${pureSuites.length} pure, ${emulatorSuites.length} emulator-only\n`,
);

if (pureSuites.length < MIN_PURE_SUITES) {
  console.log(
    `\n::error::Only ${pureSuites.length} pure suite(s) matched, below the floor of ${MIN_PURE_SUITES}. ` +
      `Either the test:* naming convention changed, package.json moved, or suites silently ` +
      `dropped out of the "pure" bucket (e.g. into "emulator") — this job refuses to report ` +
      `success while running fewer suites than it used to, because that is indistinguishable ` +
      `from a gate that quietly stopped gating. If suites were legitimately removed, lower ` +
      `MIN_PURE_SUITES in this file in the same PR that removes them.`,
  );
  process.exit(1);
}

const failed = [];
for (const [name] of pureSuites) {
  console.log(`::group::npm run ${name}`);
  const result = spawnSync("npm", ["run", name], {
    cwd: FUNCTIONS_DIR,
    stdio: "inherit",
  });
  console.log("::endgroup::");
  if (result.status !== 0) failed.push(name);
}

console.log("\n=== v3/functions/package.json test:* inventory ===");
console.log("script\tkind\tresult");
for (const [name] of pureSuites) {
  console.log(`${name}\tpure\t${failed.includes(name) ? "FAIL" : "pass"}`);
}
for (const [name] of emulatorSuites) {
  console.log(
    `${name}\temulator\tSKIPPED (needs Java + firebase-tools, not provisioned in CI yet)`,
  );
}

console.log(
  `\npure suites: ${pureSuites.length} run, ${failed.length} failed` +
    (failed.length ? ` (${failed.join(", ")})` : ""),
);
console.log(
  `emulator suites: ${emulatorSuites.length} NOT run — need actions/setup-java + a firebase-tools install in the workflow before they can join this job`,
);

process.exit(failed.length > 0 ? 1 : 0);
