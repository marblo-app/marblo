/**
 * 미션 구독의 프로젝트 스코프 — `missions` 룰이 멤버 스코프가 되면서 생긴 규율.
 *
 * ── 왜 필요한가 (티켓 Ciriq5ASEvAlA8TnKxhW) ─────────────────────────────────
 * `firestore.rules` 의 `missions` read 는 이전에 `isAuthenticated()` 뿐이었고,
 * 그래서 엔진은 `where("status","==","planning")` 같은 **무스코프** 쿼리를 쏴도
 * 통과했다. 그 룰이 크로스테넌트 구멍이라 `canReadProjectScopedDoc()`
 * (= isProjectMember(resource.data.projectId)) 으로 조였다.
 *
 * Firestore 는 list 를 문서가 아니라 **쿼리 제약식**으로 판정한다
 * ("security rules are not filters"). 즉 결과가 전부 내 프로젝트 문서여도,
 * projectId 를 고정하지 않은 쿼리는 통째로 거부된다. 같은 규율의 MCP 서버 판이
 * `electron/mcp-server/project-scope.ts` 다 — 거기 주석에 실측 에러가 있다.
 *
 * ── 왜 프로젝트별 구독이 아니라 `in` 인가 (에뮬레이터 실측) ─────────────────
 * `firestore.rules.test.ts` 의 "missions — in-스코프 쿼리 계약" describe 가
 * 실측한 결과:
 *   - `where(projectId,in,[내 프로젝트들])`            → 통과
 *   - `where(projectId,in,[...]) + where(status,in,[...])` → 통과
 *   - `in` 목록에 남의 프로젝트가 섞이면              → 통째로 거부
 * 그래서 프로젝트 수만큼 구독을 늘리지 않고 `in` 한 방으로 덮는다. 그 테스트가
 * 깨지면 이 파일의 전제가 깨진 것이므로 쿼리 모양을 되돌려야 한다.
 */

/**
 * Firestore `in` 연산자 상한(값 30개). 멤버 프로젝트가 이보다 많으면 쿼리를
 * 쪼갠다 — 넘겨서 던지면 런타임에 invalid-argument 로 죽는다.
 */
export const MISSION_PROJECT_CHUNK_SIZE = 30;

/**
 * projectId 목록을 `in` 상한에 맞춰 자른다. 빈 배열이면 빈 배열을 돌려준다 —
 * 호출부는 그때 **쿼리를 쏘지 않아야 한다**(`in` 에 빈 배열을 주면 Firestore 가
 * invalid-argument 로 던진다).
 *
 * 중복은 제거하고 공백 id 는 버린다: 둘 다 `in` 슬롯만 축내고, 공백은 어차피
 * 룰에서 거부된다(projectId=="" 는 fail-closed).
 */
export function chunkProjectIds(
  projectIds: readonly string[],
  size: number = MISSION_PROJECT_CHUNK_SIZE,
): string[][] {
  const cleaned = [
    ...new Set(
      projectIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id !== ""),
    ),
  ];
  const chunks: string[][] = [];
  for (let i = 0; i < cleaned.length; i += size) {
    chunks.push(cleaned.slice(i, i + size));
  }
  return chunks;
}
