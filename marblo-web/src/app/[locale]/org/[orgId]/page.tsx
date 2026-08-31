/**
 * `/[locale]/org/[orgId]` — 조직 홈(비개인 조직).
 *
 * ★URL 의 `orgId` 는 **권한 근거가 아니다.** 서버가 uid 로 만든 멤버십과의
 *   교집합으로만 쓰인다(`team/[projectId]` 규약 그대로). 그래서 이 라우트는
 *   아무 id 나 받아도 되고, 존재 여부조차 화면이 판정하지 않는다 — 권한 밖이면
 *   서버가 `detail: null` 로 답하고 §3.3 의 기본 조직으로 조용히 착지한다.
 */
import OrgHomeClient from "../OrgHomeClient";

export default async function OrgIdPage({
  params,
}: {
  params: Promise<{ locale: string; orgId: string }>;
}) {
  const { orgId } = await params;
  return <OrgHomeClient orgId={orgId} />;
}
