/**
 * 팀 멤버 표시 이름 해석 + 역할 정렬 (순수 함수 — firebase/DOM 의존 없음, 유닛테스트 대상).
 *
 * ★ 오너 외 멤버는 `users/{uid}` 문서에 displayName 이 비어 있는 경우가 흔하다
 * (그 문서를 채우는 경로가 이 앱 어디에도 없다 — presence 갱신은 merge:true 로
 * lastHeartbeatAt 만 건드리고, 마케팅 동의 저장도 marketing 필드만 건드린다).
 * 반면 `presence/{projectId}/users/{uid}` 문서는 usePresenceSync 가 60초마다
 * Firebase Auth 의 살아있는 displayName/email 로 직접 채운다 — 그래서 이름 소스
 * 우선순위는 users 문서 → presence → email → uid 순이다. 마지막 uid 폴백까지
 * 두는 이유는 화면에 빈 이름 칸을 남기지 않기 위해서다.
 */
import type { User } from "../types/user";
import type { InvitationRole } from "../types/invitation";

const ROLE_ORDER: Record<InvitationRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
  viewer: 3,
};

/** 표시용 이름 하나를 정한다 — 절대 빈 문자열을 돌려주지 않는다(마지막 폴백=uid). */
export function resolveMemberDisplayName(
  member: Pick<User, "id" | "email" | "displayName">,
  presenceDisplayName?: string
): string {
  return member.displayName || presenceDisplayName || member.email || member.id;
}

/**
 * 멤버 목록을 role 우선순(owner→admin→member→viewer)으로, 같은 role 안에서는
 * 이름순으로 정렬한다. owner 는 role 유실 시에도 항상 최상단에 오도록
 * memberRoles 조회가 비어 있으면 "member" 로 취급(기존 관례와 동일)한다.
 */
export function sortMembersByRole<
  T extends { id: string; displayName?: string; email?: string }
>(members: T[], memberRoles: Record<string, InvitationRole>): T[] {
  return [...members].sort((a, b) => {
    const roleA =
      ROLE_ORDER[memberRoles[a.id] || "member"] ?? ROLE_ORDER.member;
    const roleB =
      ROLE_ORDER[memberRoles[b.id] || "member"] ?? ROLE_ORDER.member;
    if (roleA !== roleB) return roleA - roleB;
    const nameA = a.displayName || a.email || a.id;
    const nameB = b.displayName || b.email || b.id;
    return nameA.localeCompare(nameB);
  });
}
