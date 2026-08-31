/**
 * `/[locale]/org` — 조직 착지 + 선택 화면(#1333 §3.3).
 *
 * ★착지 규칙(§5.8)은 클라이언트에서 실행된다 — "마지막 본 조직" 이
 *   localStorage 에 있고, 멤버십 확인은 서버 콜러블이 한다. 규칙 3
 *   (비개인 조직 여럿 + 마지막 본 조직 없음)일 때만 이 화면이 남는다.
 */
import OrgLandingClient from "./OrgLandingClient";

export default function OrgPage() {
  return <OrgLandingClient />;
}
