#!/usr/bin/env node
/**
 * Build-time fail-fast guard for Firebase renderer config.
 *
 * Why this exists (regression BAcFpVKbTFX18gs3UEEt):
 *   `vite build` inlines `import.meta.env.VITE_*` at build time. A local build
 *   picked up `.env.production` — which shipped with PLACEHOLDER Firebase values
 *   (`your-api-key`, `your-project-id`) — and those placeholders override the
 *   real values in `.env` (Vite gives `.env.[mode]` higher priority than `.env`).
 *   The result: a signed release with a bogus Firebase config → `onAuthStateChanged`
 *   never fires → AuthProvider `loading` stays true forever → infinite spinner.
 *   CI builds were fine (they synthesize `.env` from secrets), so nothing caught it.
 *
 * This script replicates Vite's env-file precedence for the target mode and
 * FAILS THE BUILD if the resolved Firebase config is missing or still a
 * placeholder. Run it *before* `vite build` in every release path.
 *
 * Escape hatch: set SKIP_FIREBASE_ENV_CHECK=1 to bypass (e.g. building a
 * throwaway artifact that will never touch real auth). Do not use for releases.
 *
 * No dependencies — a tiny inline dotenv parser keeps this immune to the
 * toolchain breakage that periodically knocks out node_modules on this project.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ lives directly under the v3 package root.
const ROOT = resolve(__dirname, "..");

// `vite build` defaults to production mode. Allow override via arg / NODE_ENV
// so a `--mode staging` build checks the right files.
const mode =
  process.argv[2] ||
  process.env.VITE_MODE ||
  process.env.NODE_ENV ||
  "production";

// The Firebase keys that firebase.ts reads. API key + project id are the ones
// that silently break auth when wrong; the rest are required for a valid config.
const REQUIRED_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

// Placeholder detector: the shipped template values all start with `your-` /
// `your_` (your-api-key, your-project-id, …). Also treat obviously-empty and
// angle-bracket templates (<your-key>) as placeholders.
const PLACEHOLDER_RE = /^(your[-_]|<|xxx+$|changeme$|placeholder$)/i;

/** Minimal .env parser — KEY=VALUE, `#` comments, optional quotes, `export `. */
function parseEnvFile(path) {
  const out = {};
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length)
      : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    let value = withoutExport.slice(eq + 1).trim();
    // Strip a single layer of matching quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Vite env-file precedence for a given mode (lowest → highest priority):
//   .env  <  .env.local  <  .env.[mode]  <  .env.[mode].local
// Apply in that order so higher-priority files overwrite. THIS is exactly the
// ordering that let `.env.production` placeholders bury the real `.env` values.
const files = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];

const resolved = {};
const loadedFiles = [];
for (const name of files) {
  const path = join(ROOT, name);
  if (!existsSync(path)) continue;
  loadedFiles.push(name);
  Object.assign(resolved, parseEnvFile(path));
}

// Real env vars present at build time win over .env files (Vite behavior + CI).
for (const key of REQUIRED_KEYS) {
  if (process.env[key] != null && process.env[key] !== "") {
    resolved[key] = process.env[key];
  }
}

if (process.env.SKIP_FIREBASE_ENV_CHECK === "1") {
  console.warn(
    "[check-firebase-env] SKIP_FIREBASE_ENV_CHECK=1 set — skipping guard. " +
      "Do NOT use this for a release build.",
  );
  process.exit(0);
}

const problems = [];
for (const key of REQUIRED_KEYS) {
  const value = resolved[key];
  if (value == null || value === "") {
    problems.push(`  • ${key} is missing or empty`);
  } else if (PLACEHOLDER_RE.test(value)) {
    problems.push(`  • ${key} still holds a placeholder value`);
  }
}

if (problems.length > 0) {
  console.error(
    "\n[31m✖ Firebase build guard FAILED[0m — the resolved Firebase config " +
      `is invalid for mode "${mode}".\n`,
  );
  console.error(problems.join("\n"));
  console.error(
    `\nResolved from: ${loadedFiles.length ? loadedFiles.join(", ") : "(no .env files found)"}` +
      " + process.env",
  );
  console.error(
    "\nWhy this matters: a bogus Firebase config compiles fine but ships a dead\n" +
      "app — onAuthStateChanged never fires and users get an infinite spinner.\n" +
      "Fix: put the REAL Firebase values into the highest-priority env file for\n" +
      `this mode (e.g. .env.${mode}), not placeholders. Secrets stay out of git.\n` +
      "(Bypass only for throwaway builds: SKIP_FIREBASE_ENV_CHECK=1)\n",
  );
  process.exit(1);
}

console.log(
  `[check-firebase-env] OK — Firebase config resolved for mode "${mode}" ` +
    `(${loadedFiles.join(", ") || "process.env only"}).`,
);
