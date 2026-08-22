/**
 * 강의 시드 ↔ 프로덕션 Firestore 차이 조회 (읽기 전용, 절대 쓰지 않음)
 *
 * 실행: FIREBASE_PROJECT_ID=marblo-2253d npx tsx scripts/diff-lectures.ts [--verbose]
 *
 * 왜 따로 두나: lectures 문서는 결제 페이지가 읽는 데이터라 덮어쓰기가
 * 되돌릴 수 없다. 올리기 전에 "무엇이 바뀌는지" 를 쓰기 권한 없이 볼 수 있어야 한다.
 * 종료코드 0 = 차이 없음, 1 = 차이 있음(CI 에서 시드 미반영 감지용), 2 = 오류.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { lectures } from "../src/data/lectures";
import { computeDocDiff, renderDocDiff } from "../src/lib/lecturesSeedDiff";

const projectId = process.env.FIREBASE_PROJECT_ID || "marblo-2253d";
const verbose = process.argv.includes("--verbose");

initializeApp({ projectId });
const db = getFirestore();

async function main() {
  console.log(
    `[읽기 전용] project=${projectId} lectures ${lectures.length}건 비교`
  );

  let changed = 0;
  for (const lecture of lectures) {
    const snap = await db.collection("lectures").doc(lecture.slug).get();
    const remote = snap.exists
      ? (snap.data() as Record<string, unknown>)
      : undefined;
    const diff = computeDocDiff(lecture, remote);
    if (diff.diffs.length > 0) changed += 1;
    console.log(`\n${renderDocDiff(diff, verbose)}`);
    if (remote) {
      const u = remote.updatedAt as { toDate?: () => Date } | undefined;
      console.log(
        `  (현재 문서 updatedAt: ${
          u?.toDate ? u.toDate().toISOString() : String(u)
        })`
      );
    }
  }

  // 시드에 없는 slug 가 Firestore 에 남아 있으면 알린다 — 시드는 지우지 않는다.
  const all = await db.collection("lectures").listDocuments();
  const seeded = new Set(lectures.map((l) => l.slug));
  const orphans = all.map((d) => d.id).filter((id) => !seeded.has(id));
  console.log(
    `\nFirestore 에만 있고 시드에 없는 문서: ${
      orphans.length ? orphans.join(", ") : "없음"
    }`
  );

  console.log(
    changed === 0
      ? "\n결론: 차이 없음. 시드를 올릴 필요 없다."
      : `\n결론: ${changed}건 문서에 차이가 있다. seed-lectures.ts 로 반영 필요.`
  );
  process.exit(changed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(2);
});
