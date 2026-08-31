/**
 * `/[locale]/org/me` — 개인 조직.
 *
 * ★개인 조직은 이 별칭 하나로만 연다 — `personal_<uid>` 는 uid 가 URL 에
 *   실리므로 라우트를 만들지 않는다(#1333 §3.1). `"me"` 는 서버가 푼다.
 * ★팀 개념을 그리지 않는다(#1336 §4.1) — 이 화면은 오늘의 `/team` 을 조직
 *   문맥으로 보여줄 뿐이다(#1333 §7).
 */
import OrgHomeClient from "../OrgHomeClient";

export default function OrgMePage() {
  return <OrgHomeClient orgId="me" />;
}
