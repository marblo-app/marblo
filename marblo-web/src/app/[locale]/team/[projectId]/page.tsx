/**
 * `/[locale]/team/[projectId]` — 프로젝트 하나로 좁힌 팀 오버뷰(설계 §3).
 *
 * ★URL 의 `projectId` 는 **권한 근거가 아니다.** 서버가 uid 로 만든 허용 집합과의
 *   교집합으로만 쓰인다(설계 §5.3-1). 그래서 이 라우트는 아무 id 나 받아도 되고,
 *   존재 여부조차 화면이 판정하지 않는다 — 권한 밖이면 서버가 0행으로 답한다.
 */
import TeamOverviewClient from "../TeamOverviewClient";

export default async function TeamProjectPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { projectId } = await params;
  return <TeamOverviewClient projectId={projectId} />;
}
