import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * 클린룸 하네스가 만든 임시 루트를 실행이 끝난 뒤 정리한다.
 *
 * ★왜 필요한가(실측): `launchCleanRoom` 은 실행마다
 * `<tmp>/marblo-cleanroom-XXXX` 를 새로 만들고 그 안에 Chromium `userData`
 * (캐시·GPU 캐시·IndexedDB)까지 통째로 담는다 — 한 런당 **~280MB**. 지우는
 * 코드가 어디에도 없어서 이 맥에는 360개(≈40GB)가 쌓여 있었고, 결국 디스크가
 * 차서 스위트 자체가 ENOSPC 로 깨졌다(스크린샷 저장 실패 → 테스트 실패).
 * 실패 증거(스크린샷·trace·비디오)는 `test-results/` 에 남으므로 이 임시 루트를
 * 지워도 잃는 것이 없다.
 *
 * 지우는 대상은 **하네스가 만든 접두사**뿐이다. 임시 디렉터리 전체를 훑거나
 * 다른 프로세스의 파일을 건드리지 않는다.
 */
const PREFIXES = ["marblo-cleanroom-", "marblo-own-repo-"];

export default function globalTeardown(): void {
  if (process.env.KEEP_CLEANROOM_ROOTS === "1") {
    console.log("[cleanroom] KEEP_CLEANROOM_ROOTS=1 — 임시 루트를 남겨 둡니다");
    return;
  }
  const tmp = os.tmpdir();
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(tmp);
  } catch {
    return; // 임시 디렉터리를 못 읽으면 조용히 통과 — 테스트 결과와 무관하다.
  }
  for (const name of entries) {
    if (!PREFIXES.some((p) => name.startsWith(p))) continue;
    try {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
      removed += 1;
    } catch {
      // 아직 살아 있는 프로세스가 물고 있을 수 있다 — 다음 런에서 다시 시도된다.
    }
  }
  if (removed > 0) {
    console.log(`[cleanroom] 임시 루트 ${removed}개 정리`);
  }
}
