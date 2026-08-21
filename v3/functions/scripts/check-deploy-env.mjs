#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ANALYTICS_ID_SALT: 익명 텔레메트리(events/task_outcomes/agent_heartbeats)의
// 조인키를 가명화하는 HMAC 키다(functions/src/analyticsPseudonym.ts). 없으면
// 런타임이 원시 id 로 폴백하지 않고 조인키를 **버리므로**, 조용한 분석 열화를
// 막으려면 배포 전에 막는 게 맞다. 값은 아무 고엔트로피 문자열이면 되고,
// 한 번 정하면 바꾸지 않는다 — 바꾸면 그 시점 전후의 가명이 갈라져
// events↔task_outcomes 조인이 끊긴다.
// ★PERSON_AXIS_EFFECTIVE_FROM 은 **일부러 여기 없다.** 사람 축(가명 계정키)의
// 소급 상한이고, 값이 없으면(unset) 사람 축이 0행 + 사유를 돌려주는 것이
// **설계된 정상 상태**다(functions/src/personAxis.ts,
// v3/docs/person-axis-user-key-design-2026-08-21.md §5.4). 여기에 올리면
// 배포가 막히고, 막힌 배포를 뚫으려고 아무 날짜나 채우게 되며, 그 순간 개정
// 고지가 발효되기도 전에 소급이 열린다. 채우는 조건은 personAxis.ts 의
// PERSON_AXIS_EFFECTIVE_FROM_UNSET_NOTE 위에 체크리스트로 있다.
const REQUIRED_KEYS = ["ADMIN_UID", "ANALYTICS_ID_SALT"];

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
    "[functions-env-gate] Cloud Functions deploy is blocked before Firebase can silently deploy without required env."
  );
  process.exit(1);
}

const projectId = resolveProjectId();
if (!projectId) {
  fail(
    "Could not resolve Firebase project id. Pass --project <project-id> or configure .firebaserc."
  );
}

const envPath = resolve(functionsDir, `.env.${projectId}`);
if (!existsSync(envPath)) {
  fail(
    `Missing ${envPath}. This file is gitignored and is not present in isolated Marblo worktrees. Deploy functions from the main checkout that has functions/.env.${projectId}, not from ~/.marblo/worktrees/<project>/<task>.`
  );
}

const envKeys = parseEnvKeys(readFileSync(envPath, "utf8"));
const missing = REQUIRED_KEYS.filter((key) => !envKeys.has(key));
if (missing.length > 0) {
  fail(
    `Missing required key(s) in functions/.env.${projectId}: ${missing.join(
      ", "
    )}. Values are intentionally not printed.`
  );
}

console.log(
  `[functions-env-gate] OK: functions/.env.${projectId} exists and required key(s) are present: ${REQUIRED_KEYS.join(
    ", "
  )}`
);
