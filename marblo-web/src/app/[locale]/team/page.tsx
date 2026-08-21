/**
 * `/[locale]/team` — 프로젝트를 지정하지 않은 진입.
 *
 * ★프로젝트 선택을 화면이 하지 않는다. `projectId` 를 안 보내면 서버가
 *   `context.auth.uid` 로 도출한 **자기 권한 집합 전체**를 스코프로 잡는다
 *   (설계 §5.3). 클라가 고른 값은 어차피 교집합 필터로만 쓰이므로, 여기서
 *   목록을 만들려고 Firestore 를 여는 것은 룰 표면만 늘리는 일이다.
 */
import TeamOverviewClient from "./TeamOverviewClient";

export default function TeamPage() {
  return <TeamOverviewClient projectId={null} />;
}
