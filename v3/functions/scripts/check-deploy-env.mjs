#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_KEYS = ["ADMIN_UID"];

const __dirname = dirname(fileURLToPath(import.meta.url));
const functionsDir = resolve(__dirname, "..");
const projectDir = resolve(functionsDir, "..");

function getArgValue(name) {
  const exact = `--${name}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith(exact)) return arg.slice(exact.length).trim();
    if (arg === `--${name}` && process.argv[i + 1]) {
      return process.argv[i + 1].trim();
    }
  }
  return "";
}

function readDefaultFirebaseProject() {
  const rcPath = resolve(projectDir, ".firebaserc");
  if (!existsSync(rcPath)) return "";
  try {
    const parsed = JSON.parse(readFileSync(rcPath, "utf8"));
    const value = parsed?.projects?.default;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function resolveProjectId() {
  return (
    getArgValue("project") ||
    process.env.FIREBASE_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    readDefaultFirebaseProject()
  ).trim();
}

function parseEnvKeys(raw) {
  const keys = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    const value = withoutExport.slice(eq + 1).trim();
    if (key && value) keys.add(key);
  }
  return keys;
}

function fail(message) {
  console.error(`\n[functions-env-gate] ${message}`);
  console.error(
    "[functions-env-gate] Cloud Functions deploy is blocked before Firebase can silently deploy without required env.",
  );
  process.exit(1);
}

const projectId = resolveProjectId();
if (!projectId) {
  fail(
    "Could not resolve Firebase project id. Pass --project <project-id> or configure .firebaserc.",
  );
}

const envPath = resolve(functionsDir, `.env.${projectId}`);
if (!existsSync(envPath)) {
  fail(
    `Missing ${envPath}. This file is gitignored and is not present in isolated Marblo worktrees. Deploy functions from the main checkout that has functions/.env.${projectId}, not from ~/.marblo/worktrees/<project>/<task>.`,
  );
}

const envKeys = parseEnvKeys(readFileSync(envPath, "utf8"));
const missing = REQUIRED_KEYS.filter((key) => !envKeys.has(key));
if (missing.length > 0) {
  fail(
    `Missing required key(s) in functions/.env.${projectId}: ${missing.join(", ")}. Values are intentionally not printed.`,
  );
}

console.log(
  `[functions-env-gate] OK: functions/.env.${projectId} exists and required key(s) are present: ${REQUIRED_KEYS.join(", ")}`,
);
