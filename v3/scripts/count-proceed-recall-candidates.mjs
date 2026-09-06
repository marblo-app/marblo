#!/usr/bin/env node
/**
 * 읽기 전용 진단 — "가드를 켰다면 지금 몇 건이 재호출 대상인가"
 * (티켓 xKhErJdSwDH3LIItFe42, PROCEED 무반응 재호출).
 *
 * ★쓰기가 전혀 없다. `missions` 컬렉션을 projectId 단일 필드로만 읽고
 * (electron/main.ts 의 `listStalledProceedMissions` 와 같은 쿼리 모양 —
 * 새 인덱스 불필요), `advanceState.handoffOutcome === "auto-proceed"` 인
 * 것만 남긴 뒤 각 후보의 근거 티켓(`advanceState.handoffNextTaskId`)을
 * 단건으로 읽어 지금도 `TODO` 인지 확인한다. 그 개수가 "가드를 켰다면
 * 지금 당장 재호출 신호가 나갈 건수"다.
 *
 * ★이 스크립트는 앱을 건드리지 않는다(재시작·배포 없음) — 앱 프로세스와
 *   무관한 별도 node 실행이다. `MISSION_ADVANCE_SIGNAL` 값도 안 바꾼다.
 *
 * Usage (v3/ 에서):
 *   node scripts/count-proceed-recall-candidates.mjs --project <projectId>
 *
 * 앱과 같은 Firebase env 가 필요하다(FIREBASE_* / VITE_FIREBASE_*, v3/.env).
 * 이 저장소의 이 워크트리에는 그 env 파일이 없어서(실행 시도 시 아래
 * MISSING_ENV 로 즉시 종료) 실제 프로덕션 실측은 이 스크립트를 그 env 를
 * 가진 환경(예: 앱을 실행 중인 사장님 머신)에서 돌려야 한다.
 */
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
} from "firebase/firestore";

const WINDOW_MS = 10 * 60_000; // ACTIVE_STALL_WINDOW_MS 재사용 — 새 숫자 아님.

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function toMillis(v) {
  return typeof v?.toMillis === "function" ? v.toMillis() : null;
}

const projectId = arg("project");
if (!projectId) {
  console.error(
    "Usage: node scripts/count-proceed-recall-candidates.mjs --project <projectId>",
  );
  process.exit(1);
}

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
  authDomain:
    process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:
    process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
  console.error(
    "MISSING_ENV — FIREBASE_API_KEY/FIREBASE_PROJECT_ID(또는 VITE_ 접두사)가 " +
      "이 프로세스 env 에 없다. 앱과 같은 v3/.env 를 가진 환경에서 실행해야 한다.",
  );
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const missionsSnap = await getDocs(
  query(collection(db, "missions"), where("projectId", "==", projectId)),
);

const now = Date.now();
let totalProceed = 0;
let skippedNoTaskIdOrTimestamp = 0;
let stillTodoWithinWindow = 0;
let stillTodoOverdue = 0; // ★이게 "가드를 켰으면 지금 재호출 신호가 나갈 건수".
let resolved = 0;

for (const d of missionsSnap.docs) {
  const data = d.data();
  const advanceState = data.advanceState ?? {};
  if (advanceState.handoffOutcome !== "auto-proceed") continue;
  totalProceed += 1;

  const handoffAskedAt = toMillis(advanceState.handoffAskedAt);
  const nextTaskId =
    typeof advanceState.handoffNextTaskId === "string"
      ? advanceState.handoffNextTaskId
      : "";
  if (handoffAskedAt === null || !nextTaskId) {
    skippedNoTaskIdOrTimestamp += 1;
    continue;
  }

  const taskSnap = await getDoc(doc(db, "tasks", nextTaskId));
  const status =
    taskSnap.exists() && taskSnap.data().deleted !== true
      ? taskSnap.data().status
      : null;

  if (status !== "TODO") {
    resolved += 1;
    continue;
  }
  if (now - handoffAskedAt >= WINDOW_MS) {
    stillTodoOverdue += 1;
    console.log(
      `  RED  mission=${d.id} task=${nextTaskId} handoffAskedAt=${new Date(
        handoffAskedAt,
      ).toISOString()} (${Math.floor((now - handoffAskedAt) / 60_000)}분 경과)`,
    );
  } else {
    stillTodoWithinWindow += 1;
  }
}

console.log("---");
console.log(`project=${projectId}`);
console.log(`PROCEED 를 낸 미션 총: ${totalProceed}`);
console.log(
  `  근거 티켓/시각 없어 판단 불가(구버전 문서·split 후보): ${skippedNoTaskIdOrTimestamp}`,
);
console.log(`  이미 해소(TODO 벗어남): ${resolved}`);
console.log(`  아직 TODO, 판정 창(10분) 안: ${stillTodoWithinWindow}`);
console.log(
  `  ★아직 TODO, 판정 창 넘김 = 지금 가드를 켜면 즉시 재호출 신호가 나갈 건수: ${stillTodoOverdue}`,
);
