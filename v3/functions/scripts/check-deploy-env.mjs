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
// ★PERSON_AXIS_EFFECTIVE_FROM 은 2026-08-21 에 **여기로 올라왔다.** 전에는
// 일부러 빠져 있었다 — 발효일이 정해지기 전에는 unset 이 곧 "사람 축 0행" 이라는
// **설계된 정상 상태**였고, 필수로 걸면 막힌 배포를 뚫으려고 아무 날짜나 채워
// 고지 발효 전에 소급이 열릴 위험이 있었다.
// 그 전제가 사라졌다: 사장님이 값을 정했고(2026-08-21, 값 `2026-04-01` — 과거
// 포함), 개정 고지와 1회성 배너가 같이 나간다. 이제 unset 은 "아직 안 정했다" 가
// 아니라 **설정 누락**이고, 누락되면 사람 축 화면이 조용히 0행으로 남는다.
// 조용한 열화보다 시끄러운 실패가 낫다는 이 파일의 원칙 그대로 필수로 건다.
// 근거·경위: functions/src/personAxis.ts 의 PERSON_AXIS_EFFECTIVE_FROM_UNSET_NOTE
// 위 주석, v3/docs/person-axis-user-key-design-2026-08-21.md §5.4(추기 포함).
// ★형식은 'YYYY-MM-DD'. 형식이 틀리면 배포는 지나가지만 게이트가 닫힌 채로
// 남는다(personAxis.resolvePersonAxisGate 의 invalid 경로) — 그래서 값 형식도
// 여기서 같이 본다.
const REQUIRED_KEYS = ["ADMIN_UID", "ANALYTICS_ID_SALT", "PERSON_AXIS_EFFECTIVE_FROM"];

/** 값 형식까지 봐야 하는 키. 값은 절대 출력하지 않는다 — 형식 판정만 한다. */
const KEY_VALUE_FORMATS = [
  {
    key: "PERSON_AXIS_EFFECTIVE_FROM",
    test: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
    hint: "must be 'YYYY-MM-DD' (UTC date)",
  },
];

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

function parseEnvEntries(raw) {
  const entries = new Map();
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
    if (key && value) entries.set(key, value);
  }
  return entries;
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

const envEntries = parseEnvEntries(readFileSync(envPath, "utf8"));
const missing = REQUIRED_KEYS.filter((key) => !envEntries.has(key));
if (missing.length > 0) {
  fail(
    `Missing required key(s) in functions/.env.${projectId}: ${missing.join(
      ", "
    )}. Values are intentionally not printed.`
  );
}

// 값 형식 검사 — 값 자체는 출력하지 않고 "형식이 틀렸다" 만 말한다.
const malformed = KEY_VALUE_FORMATS.filter(
  ({ key, test }) => envEntries.has(key) && !test(envEntries.get(key))
);
if (malformed.length > 0) {
  fail(
    `Malformed value(s) in functions/.env.${projectId}: ${malformed
      .map(({ key, hint }) => `${key} (${hint})`)
      .join(", ")}. Values are intentionally not printed.`
  );
}

console.log(
  `[functions-env-gate] OK: functions/.env.${projectId} exists and required key(s) are present: ${REQUIRED_KEYS.join(
    ", "
  )}`
);
