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
// ★FLOOR GUARDS (review on PR #1524 and task HV8l8Kr5LpTOVUEHS0Ou): a dynamic
// classifier that runs "however many suites it finds" goes quietly green the
// moment it finds none — a renamed `test:*` prefix, a package.json split, or
// a filter that stops matching would make this job pass 0 suites and report
// success. That is the exact failure shape this task exists to close (a gate
// that silently drops its own scope), so BOTH buckets are checked against a
// floor measured on 2026-09-08 (main @ b54d9291): 58 pure, 6 emulator.
// Lowering either constant is a real code review decision — bump it up
// freely as suites are added, but only lower it deliberately, in the same PR
// that removes suites.
//
// Run as `node run-ci-node-test-suites.mjs` for the pure bucket (fast, no
// external deps beyond typescript+node, safe for every PR) or with
// `--emulator` for the Firestore/Auth-emulator bucket (needs Java 21+ and
// firebase-tools on PATH — see .github/workflows/functions-tests.yml's
// emulator-tests job). Kept as ONE file with a mode flag, not two files, so
// the classifier logic (and its two floors) can never drift apart between
// the pure and emulator paths.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIN_PURE_SUITES = 58;
const MIN_EMULATOR_SUITES = 6;
const EMULATOR_MODE = process.argv.includes("--emulator");
const FUNCTIONS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SELF_MARKER = "run-ci-node-test-suites.mjs";

const pkg = JSON.parse(
  readFileSync(join(FUNCTIONS_DIR, "package.json"), "utf8"),
);
const scripts = pkg.scripts ?? {};

// Excluded by CONTENT (does this command invoke this very file?), not by a
// hand-maintained name list — `test:ci` and `test:ci:emulator` both qualify
// today, and a future entry point script would too, without needing an edit
// here. Caught in review (task HV8l8Kr5LpTOVUEHS0Ou): the earlier exact-name
// check missed `test:ci:emulator` and let it run itself as a "pure" suite.
const testScripts = Object.entries(scripts).filter(
  ([name, cmd]) => name.startsWith("test") && !cmd.includes(SELF_MARKER),
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

const [runSuites, bucketName, floor] = EMULATOR_MODE
  ? [emulatorSuites, "emulator", MIN_EMULATOR_SUITES]
  : [pureSuites, "pure", MIN_PURE_SUITES];

if (runSuites.length < floor) {
  console.log(
    `\n::error::Only ${runSuites.length} ${bucketName} suite(s) matched, below the floor of ${floor}. ` +
      `Either the test:* naming convention changed, package.json moved, or suites silently ` +
      `moved to the other bucket — this job refuses to report success while running fewer ` +
      `suites than it used to, because that is indistinguishable from a gate that quietly ` +
      `stopped gating. If suites were legitimately removed, lower MIN_${
        bucketName === "pure" ? "PURE" : "EMULATOR"
      }_SUITES ` +
      `in this file in the same PR that removes them.`,
  );
  process.exit(1);
}

const failed = [];
for (const [name] of runSuites) {
  console.log(`::group::npm run ${name}`);
  const result = spawnSync("npm", ["run", name], {
    cwd: FUNCTIONS_DIR,
    stdio: "inherit",
  });
  console.log("::endgroup::");
  if (result.status !== 0) failed.push(name);
}

console.log(
  `\n=== v3/functions/package.json test:* inventory (${bucketName}) ===`,
);
console.log("script\tkind\tresult");
for (const [name] of runSuites) {
  console.log(
    `${name}\t${bucketName}\t${failed.includes(name) ? "FAIL" : "pass"}`,
  );
}
const otherBucket = EMULATOR_MODE ? pureSuites : emulatorSuites;
for (const [name] of otherBucket) {
  console.log(
    `${name}\t${
      EMULATOR_MODE ? "pure" : "emulator"
    }\tNOT RUN in this mode (run the other npm script)`,
  );
}

console.log(
  `\n${bucketName} suites: ${runSuites.length} run, ${failed.length} failed` +
    (failed.length ? ` (${failed.join(", ")})` : ""),
);

process.exit(failed.length > 0 ? 1 : 0);
