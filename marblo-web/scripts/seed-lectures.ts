/**
 * Firestore 강의 시드 데이터 업로드 (멱등)
 *
 * 실행:
 *   미리보기(기본, 쓰지 않음): FIREBASE_PROJECT_ID=marblo-2253d npx tsx scripts/seed-lectures.ts
 *   실제 쓰기               : FIREBASE_PROJECT_ID=marblo-2253d npx tsx scripts/seed-lectures.ts --apply
 *
 * 설계 근거 — lectures 문서는 결제 페이지가 읽는 프로덕션 데이터다:
 *  1) 기본이 dry-run 이다. `--apply` 를 명시해야만 쓴다. 손이 미끄러져도 프로덕션이 안 바뀐다.
 *  2) 쓰기 전에 변경될 필드를 before/after 로 전부 출력한다. 되돌릴 수 없는 동작이라
 *     "무엇이 바뀌는지" 를 눈으로 보고 실행한다.
 *  3) 멱등이다. 차이가 없는 문서는 쓰기 자체를 건너뛴다. 두 번 돌려도 결과가 같고
 *     updatedAt 도 흔들리지 않는다.
 *  4) createdAt 은 문서가 없을 때만 넣는다. 기존 문서의 생성 시각을 매 실행마다
 *     덮어써 버리던 동작이 멱등성을 깨고 있었다.
 *  5) set(..., { merge: true }) 라 시드가 모르는 필드는 건드리지 않는다.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { lectures } from "../src/data/lectures";
import { computeDocDiff, renderDocDiff } from "../src/lib/lecturesSeedDiff";

const projectId = process.env.FIREBASE_PROJECT_ID || "marblo-2253d";
const apply = process.argv.includes("--apply");
const verbose = process.argv.includes("--verbose");

initializeApp({ projectId });
const db = getFirestore();

async function seed() {
  console.log(
    `[${
      apply ? "APPLY — 프로덕션에 씁니다" : "DRY-RUN — 아무것도 쓰지 않습니다"
    }] ` + `project=${projectId} lectures ${lectures.length}건`
  );

  let written = 0;
  let skipped = 0;

  for (const lecture of lectures) {
    const ref = db.collection("lectures").doc(lecture.slug);
    const snap = await ref.get();
    const remote = snap.exists
      ? (snap.data() as Record<string, unknown>)
      : undefined;
    const diff = computeDocDiff(lecture, remote);

    console.log(`\n${renderDocDiff(diff, verbose)}`);

    if (diff.diffs.length === 0) {
      skipped += 1;
      console.log("  → 건너뜀 (변경 없음)");
      continue;
    }

    if (!apply) {
      console.log("  → DRY-RUN: 쓰지 않음. 실제 반영은 --apply 로.");
      continue;
    }

    // 바뀐 필드만 보낸다. merge:true 라 나머지 필드는 그대로 남는다.
    const payload: Record<string, unknown> = {};
    for (const f of diff.diffs) payload[f.field] = f.after;
    payload.updatedAt = FieldValue.serverTimestamp();
    if (!diff.exists) payload.createdAt = FieldValue.serverTimestamp();

    await ref.set(payload, { merge: true });
    written += 1;
    console.log(`  → 기록 완료 (${diff.diffs.length}개 필드)`);
  }

  console.log(
    `\n요약: 변경 ${written}건 / 건너뜀 ${skipped}건` +
      (apply ? "" : " (DRY-RUN — 프로덕션은 그대로다)")
  );
  if (apply && written > 0) {
    console.log(
      "반영 확인: npx tsx scripts/diff-lectures.ts  (차이 없음이면 성공)"
    );
  }
}

seed().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
