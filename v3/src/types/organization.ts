// 조직 축 저장 스키마. 판정 로직은 `v3/functions/src/orgIdentity.ts` 가 정본이고
// 이 파일은 **Firestore 에 적히는 모양**만 정의한다.
//
// 설계 정본: v3/docs/org-identity-model-2026-08-24.md (ticket LJf0at2EryJ4M5iBHioi)
// 선행 설계: v3/docs/enterprise-ax-client-dashboard-design-2026-08-24.md §4 (#1202)
//
// ★이 타입들이 **컬렉션을 만들지는 않는다.** 선행 설계 §9.3 은 org 컬렉션을 여는
// 트리거를 둘로 못박았다(고객사가 프로젝트 2개를 한 화면에서 본다 / 좌석 인보이스
// 계약 서명). 그 트리거는 **룰 확장(PR-11)** 에 걸린 것이고, 정체성 규약을 지금
// 정하는 것과 충돌하지 않는다 — 오히려 반대다. 원장은 소급 수정이 불가능하므로
// (`ledger-chain.ts computeEventHash` 가 본문을 통째로 해시한다) 규약이 늦으면
// 그 사이에 쌓인 귀속을 영영 못 고친다.

/**
 * 조직 역할. 프로젝트 역할(`invitation.ts` 의 `InvitationRole`)과 **다른 축**이다.
 * 조직 역할이 프로젝트 역할을 자동으로 주지 않는다 — org admin 이라고 모든
 * 프로젝트의 내용을 보는 것이 아니라, 조직 **설정과 청구**를 볼 뿐이다.
 * (선행 설계 §4.3-3 의 감시선을 org 축에서도 유지한다.)
 */
export type OrgRole = "org_owner" | "org_admin" | "org_member";

export const ORG_ROLE_PERMISSIONS: Record<OrgRole, string[]> = {
  org_owner: [
    "org_read",
    "manage_org_members",
    "manage_org_billing",
    "manage_org_domains",
    "rename_org",
    "delete_org",
  ],
  org_admin: [
    "org_read",
    "manage_org_members",
    "manage_org_domains",
    "rename_org",
  ],
  org_member: ["org_read"],
};

/**
 * 조직.
 *
 * ★`id` 는 불변이고 의미가 없다(Firestore 자동 id). 표시명·도메인·슬러그 어느
 * 것도 id 가 되지 않는다. 라우트·원장·청구가 전부 이 값으로 돌기 때문에, 이름이
 * 바뀌어도 아무것도 따라 바뀌지 않는다.
 *
 * ★`displayName` 은 **전역 유일이 아니다.** 유일성 강제는 선점 시장을 만들고,
 * 표시명은 조직 밖으로 나가지 않으므로 충돌 비용이 없다(문서 §4).
 */
export interface Organization {
  /** 불변 식별자. 이 값만이 정체성이다. */
  id: string;
  /** 표시명. 사람이 정한다. 유일하지 않다. 언제든 바꿀 수 있다. */
  displayName: string;
  /** 조직을 만든 사람. */
  createdBy: string;
  createdAt: Date;
  /** 개인 조직인가(`personal_<uid>`). 초대·합류 요청의 대상이 되지 않는다. */
  isPersonal: boolean;
}

/**
 * 표시명 변경 이력. **추가 전용.**
 *
 * ★이름 변경을 허용하기 위한 자료구조다. 원장에는 이름이 들어가지 않으므로
 * (`orgIdentity.assertNoOrgIdentityInLedgerPayload`), 6월 감사 반출물의 조직명은
 * 이 표를 `effectiveFrom` 으로 되짚어 해석한다. 변경 사실 자체는 여기 남아
 * 감사되고, 원장 해시는 건드려지지 않는다.
 */
export interface OrgNameHistoryEntry {
  id: string;
  orgId: string;
  displayName: string;
  /** 이 이름이 유효해지는 시각. */
  effectiveFrom: Date;
  /** 이 행이 기록된 시각. 정정이 **언제** 이루어졌는지가 감사 대상이다. */
  recordedAt: Date;
  /** 이름을 바꾼 사람. */
  actorUid: string;
}

/**
 * 조직↔도메인 결합. **한 조직에 도메인이 여럿일 수 있다** — 우리부터가
 * `hypemarc.com` 과 `marblo.app` 으로 갈린다(문서 §6).
 */
export interface OrgDomainBinding {
  id: string;
  orgId: string;
  /** 소문자 정규화된 도메인. */
  domain: string;
  /** DNS TXT 검증 통과 시각. null 이면 미검증. */
  verifiedAt: Date | null;
  /**
   * 관리자가 도메인 합류 **요청** 창구를 켰는가. 검증과 별개의 결정이다 —
   * 검증했다고 창구가 자동으로 열리지 않는다.
   */
  joinRequestsEnabled: boolean;
  createdAt: Date;
}

/**
 * 프로젝트↔조직 결합. **추가 전용이며 원장 밖에 있다.**
 *
 * ★이 티켓의 결론이 이 타입이다. 원장 본문에 `orgId` 를 박으면 잘못 붙은 귀속을
 * 영원히 못 고친다(해시 체인). 결합을 원장 밖 추가 전용 표에 두면 정정 행을
 * 덧붙여 고칠 수 있고, 그 정정이 지워지지 않고 보이므로 감사 성질도 유지된다.
 * 근거 패턴: `analyticsPseudonym.ts` — "소급은 저장이 아니라 조회로 한다."
 */
export interface OrgProjectBinding {
  id: string;
  projectId: string;
  orgId: string;
  /** 유효 시작. 과거 정정 시 과거 시각을 준다. */
  effectiveFrom: Date;
  recordedAt: Date;
  actorUid: string;
  /** 정정이면 사유. 사람이 읽는 값이며 원장에 복제되지 않는다. */
  reason?: string;
}

/** 조직 멤버십. 도메인이 아니라 초대·승인으로만 생긴다. */
export interface OrgMember {
  /** `{orgId}_{uid}` 결정적 id — 프로젝트 `memberRoles` 규약과 같다. */
  id: string;
  orgId: string;
  uid: string;
  role: OrgRole;
  /** 이 멤버십이 어떻게 생겼나. 자동 가입 값은 **없다**. */
  grantPath: "invitation" | "admin_approval";
  joinedAt: Date;
}

/**
 * 도메인 합류 요청. **요청이지 가입이 아니다.**
 *
 * ★요청자에게는 조직의 존재 여부가 드러나지 않는다. 대상이 없어 버려지는
 * 요청도 사용자에게는 동일한 접수 응답을 준다
 * (`orgIdentity.buildJoinRequestReceipt`).
 */
export interface OrgJoinRequest {
  id: string;
  /** 대상 조직. 요청자에게는 절대 응답에 실리지 않는다. */
  orgId: string;
  requesterUid: string;
  /** 요청자의 검증된 이메일 도메인. 평문 이메일은 여기 저장하지 않는다. */
  requesterDomain: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: Date;
  decidedAt?: Date;
  decidedBy?: string;
}
