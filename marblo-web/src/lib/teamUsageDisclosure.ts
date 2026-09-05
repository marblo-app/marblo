/**
 * 팀 요금제 관리자 열람 고지 — 방침 페이지 제2항·제14항에 들어가는 문면.
 *
 * ★왜 페이지에서 떼어냈나: 방침 페이지 본문은 한국 전자상거래법상 한국어가
 *   원본이라 통째로 한국어 하드코딩이었다(`LegalPageLayout` 이 비-ko 로케일에
 *   "원본은 한국어" 안내를 이미 띄운다). 그런데 이 **한 고지만은** 이용약관
 *   제13조가 방침을 직접 인용해 구속하고 발효일(2026-09-07)이 걸려 있어서,
 *   영어 독자가 읽을 수 없으면 고지가 성립하지 않는다. 그래서 이 고지에
 *   한해 로케일별 문면을 두고, 나머지 본문은 기존대로 한국어를 유지한다.
 *
 * ★문구 출처: 새로 창작하지 않았다. 앱 방침
 *   `v3/src/components/legal/privacyContent.tsx` 의 KO/EN "사용량·비용 기록"
 *   항목에 이미 검토를 거친 같은 뜻의 문장이 있어 그 표현을 그대로 옮겼다.
 *   앱과 웹의 고지가 갈리면 그 자체가 결함이므로 문면은 한 곳에서 온다.
 *
 * ★ja: 앱 방침에 승인된 일본어 법률 문면이 없다(PRIVACY_CONTENT 는 ko·en 뿐).
 *   없는 번역을 여기서 지어내는 것이 미고지보다 위험해서, ja 는 영문 고지를
 *   준다 — 한국어 원본 우선 안내는 레이아웃이 이미 띄운다.
 */

/** 발효일 — 문서상의 약속이 아니라 코드가 지키는 경계다. */
export const TEAM_USAGE_EFFECTIVE_FROM = "2026-09-07";

/** 방침 최종 개정일. */
export const PRIVACY_LAST_UPDATED = "2026-08-31";

/** 문단 조각. `strong` 인 조각은 화면에서 굵게 나간다. */
export interface DisclosureSegment {
  readonly text: string;
  readonly strong?: boolean;
}

export interface TeamUsageDisclosureCopy {
  /** 제2항 — 열람 고지 본문. */
  readonly body: readonly DisclosureSegment[];
  /** 제14항 — 시행일 문장. */
  readonly effective: readonly DisclosureSegment[];
}

/** 고지 문면이 반드시 담아야 하는 네 요소. 테스트가 이 축으로 검사한다. */
export const DISCLOSURE_ELEMENTS = [
  "who",
  "what",
  "notIncluded",
  "effectiveFrom",
] as const;
export type DisclosureElement = typeof DISCLOSURE_ELEMENTS[number];

const KO: TeamUsageDisclosureCopy = {
  body: [
    { text: "또한 " },
    { text: "팀 요금제", strong: true },
    {
      text:
        `를 이용하는 경우, ${TEAM_USAGE_EFFECTIVE_FROM} 부터 회원님이 속한 ` +
        "프로젝트의 관리자와 그 프로젝트가 결합된 조직의 관리자가 회원님의 " +
        "사용량(모델별 토큰 수, 사용량 환산 비용(추정), 완료·실패한 작업 수)을 " +
        "가명 표시명으로 열람할 수 있습니다. 조직 관리자는 자신이 초대한 팀원이 " +
        "초대를 수락했는지, 앱에 처음 접속했는지, 첫 작업을 마쳤는지와 각각의 " +
        "시점도 볼 수 있습니다. 이용 목적은 팀 요금제의 사용량·비용 관리와 도입 " +
        "현황 확인에 한합니다. ",
    },
    { text: "코드·프롬프트·응답 원문은 포함되지 않으며", strong: true },
    {
      text: `, ${TEAM_USAGE_EFFECTIVE_FROM} 보다 이전 날짜의 사용량은 위 화면에 나타나지 않습니다.`,
    },
  ],
  effective: [
    {
      text:
        `본 방침은 ${PRIVACY_LAST_UPDATED} 부터 시행됩니다. 다만 ` +
        `${PRIVACY_LAST_UPDATED} 개정으로 추가된 `,
    },
    { text: "팀 요금제 관리자의 사용량 열람", strong: true },
    { text: "에 관한 사항(제2항)은 사전 통지 기간을 두어 " },
    { text: TEAM_USAGE_EFFECTIVE_FROM, strong: true },
    { text: " 부터 시행됩니다." },
  ],
};

const EN: TeamUsageDisclosureCopy = {
  body: [
    { text: "In addition, if you are on a " },
    { text: "team plan", strong: true },
    {
      text:
        `, then starting ${TEAM_USAGE_EFFECTIVE_FROM} the administrator of the ` +
        "project you belong to — and the administrator of the organization that " +
        "project is linked to — can view your usage (tokens per model, estimated " +
        "usage-based cost, and the number of completed and failed tasks) under a " +
        "pseudonymous display name. An organization administrator can also see " +
        "whether a team member they invited accepted the invitation, first signed " +
        "in to the app, and completed a first task, along with when each happened. " +
        "This is used only to manage team-plan usage and cost and to check " +
        "adoption status. ",
    },
    {
      text: "Code, prompts, and raw responses are never included",
      strong: true,
    },
    {
      text:
        `, and usage dated before ${TEAM_USAGE_EFFECTIVE_FROM} never appears on ` +
        "that screen.",
    },
  ],
  effective: [
    {
      text: `This policy takes effect on ${PRIVACY_LAST_UPDATED}. However, the `,
    },
    {
      text: "administrator's viewing of team-plan usage",
      strong: true,
    },
    {
      text:
        ` added in the ${PRIVACY_LAST_UPDATED} revision (Section 2) takes effect ` +
        "on ",
    },
    { text: TEAM_USAGE_EFFECTIVE_FROM, strong: true },
    { text: ", after a period of advance notice." },
  ],
};

/**
 * 로케일별 고지 문면. ★ja 는 승인된 일본어 법률 문면이 없어 영문을 준다
 * (없는 번역을 지어내지 않는다 — 모듈 상단 주석 참조).
 */
export function teamUsageDisclosureFor(
  locale: string
): TeamUsageDisclosureCopy {
  return locale === "ko" ? KO : EN;
}

/** 조각을 이어붙인 평문. 테스트·검사용. */
export function disclosureText(segments: readonly DisclosureSegment[]): string {
  return segments.map((s) => s.text).join("");
}
