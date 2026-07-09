#!/usr/bin/env node
/*
 * build-resources/firebase-config.json 생성 (패키지 앱의 marblo MCP child 용).
 *
 * 배경: 패키지 앱이 spawn 하는 marblo MCP(dist-mcp) 는 별도 node 프로세스라
 * 런타임에 process.env 에서 Firebase config 를 읽는다. dev 는 .env/vite 로 이
 * 값이 존재하지만, 패키지 electron main 프로세스 env 엔 없어서(renderer 는 vite
 * 가 빌드타임에 baked, node child 는 런타임 env 필요) getMCPServerEnv 가 빈 값을
 * 넘긴다 → firebase.ts 의 getAuth(app) 이 모듈 로드 중 auth/invalid-api-key 로
 * 크래시 → 연결 즉시 종료 → "Failed to reconnect to marblo: -32000".
 * (deps 미번들 1차 원인 해결 후 드러난 2차 레이어. 티켓 MRJKgyJ4C1qPhj2Ui3vJ.)
 *
 * 해결: 여기서 .env 의 "공개 Firebase Web config"(apiKey 등 6키)만 뽑아
 * build-resources/firebase-config.json(gitignore) 에 쓴다. electron-builder 가
 * 이를 Resources/dist-mcp/firebase-config.json 으로 번들하고, firebase.ts 가 env
 * 부재 시 자기 옆(import.meta.url 기준)의 이 파일을 self-load 한다 → 누가
 * spawn 하든(Marblo main 경유든 외부 글로벌 등록이든) 자기완결적으로 동작.
 *
 * ⚠️ Firebase Web config 는 클라이언트 공개 식별자다(이미 renderer 번들에 배포됨).
 *    서비스 계정 키/서버 secret 이 아니며, 보안은 Firestore 규칙+App Check 로 강제.
 *    단 repo 에 literal 로 커밋하지 않으려고 gitignore 된 build-resources 에만 쓴다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// 이미 셸 env 에 있으면 덮지 않는다(dotenv 기본 동작). CI/로컬 어느 쪽이든 동작.
dotenv.config({ path: resolve(ROOT, ".env") });

const pick = (...keys) => {
  for (const k of keys) {
    if (process.env[k]) return process.env[k];
  }
  return "";
};

const config = {
  apiKey: pick("VITE_FIREBASE_API_KEY", "FIREBASE_API_KEY"),
  authDomain: pick("VITE_FIREBASE_AUTH_DOMAIN", "FIREBASE_AUTH_DOMAIN"),
  projectId: pick("VITE_FIREBASE_PROJECT_ID", "FIREBASE_PROJECT_ID"),
  storageBucket: pick(
    "VITE_FIREBASE_STORAGE_BUCKET",
    "FIREBASE_STORAGE_BUCKET",
  ),
  messagingSenderId: pick(
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_MESSAGING_SENDER_ID",
  ),
  appId: pick("VITE_FIREBASE_APP_ID", "FIREBASE_APP_ID"),
};

const outDir = resolve(ROOT, "build-resources");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "firebase-config.json");
writeFileSync(outPath, JSON.stringify(config, null, 2) + "\n");

const setCount = Object.values(config).filter(Boolean).length;
if (!config.apiKey) {
  console.warn(
    "[write-firebase-config] ⚠️ apiKey 비어있음 — 패키지 앱 MCP 가 Firebase 인증에 실패할 수 있습니다. .env 의 VITE_FIREBASE_API_KEY 확인.",
  );
}
console.log(
  `[write-firebase-config] wrote ${outPath} (${setCount}/6 keys set)`,
);
