/**
 * 파운더 인센티브 계단 — 순수 상수/함수, 의존성 0.
 *
 * ─── 왜 index.ts 에서 빼냈는가 ────────────────────────────────────────
 * 계단 값은 "제품 정책"이지 구현 디테일이 아니다. index.ts 안에 흩어져 있으면
 * (a) 값이 바뀔 때 호출부 전수 확인이 매번 필요하고, (b) firebase-admin 을
 * 끌고 오는 index.ts 는 유닛 테스트가 불가능해서 계단 불변식을 테스트로 못 박을
 * 수가 없다. 여기로 모아 `founderLadder.test.ts` 가 계단 자체를 검증한다.
 *
 * ─── 계단(2026-08-29 개정) ───────────────────────────────────────────
 *   베타                     총 3개월  (FOUNDER_BETA_MONTHS)
 *   성실 설문 + 루브릭 통과   총 5개월  (FOUNDER_PRO_MONTHS)
 *   우수 + 화상 인터뷰        총 9개월  (FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS)
 *
 * ★전부 "추가 N개월"이 아니라 **총 N개월**이다. 문면(웹·메일 3개국어)이 그렇게
 * 약속하고, grantFounderProTotalInternal 이 실제로 그렇게 부여한다(채우기).
 *
 * ─── 왜 베타가 1 → 3 인가 ─────────────────────────────────────────────
 * 베타가 30일이면 D30 을 재려는 바로 그 시점에 접근권이 끊긴다. 실측: 취소된
 * 구독 26건이 전부 `2026-07-14 → 2026-08-14`(31일) 한 패턴이었다. 그 상태로
 * 나온 D30 은 제품 리텐션이 아니라 **만료 신호**다. 3개월이면 D30 시점에
 * 접근권이 살아 있어 "쓸 수 있는데 안 썼다"를 잰다.
 *
 * ─── 왜 설문 5 · 인터뷰 9 인가 ────────────────────────────────────────
 * 계단의 불변식은 "**뒤 단계일수록 증분이 커진다**"이다. 더 어려운 행동에 더 큰
 * 보상이 붙지 않으면 그 단계는 아무도 안 밟는다.
 *   구(舊): 1 → 3 → 6   증분 +2, +3   (증가)
 *   신(新): 3 → 5 → 9   증분 +2, +4   (증가)
 * 베타를 3으로 올리면 설문 보상이 3(구 값)일 때 증분이 **0** 이 되어 설문할
 * 이유가 사라진다. 5 는 그 증분을 구 계단과 같은 +2 로 되돌린다.
 * 인터뷰를 6 으로 두면 증분이 +1 로 **줄어들어** 계단이 뒤집힌다. 8(+3)이면
 * 증분은 지켜지지만 상대 이득(+60%)이 설문 단계(+67%)보다 낮아 여전히 평평하다.
 * 9(+4, +80%)라야 "더 어려운 단계가 더 크게 보상된다"가 절대·상대 양쪽에서
 * 성립한다. 비용도 여기가 가장 싸다 — 인터뷰는 운영자가 상위 ~10명에게만
 * 요청하므로 8→9 의 추가 비용은 ~10 Pro-월인 반면, 설문은 ~100명 전원 대상이라
 * 1개월 올릴 때마다 ~100 Pro-월이 든다. 12(=1년)로 가지 않는 이유는 첫 결제
 * 판단이 가입 1주년 밖으로 밀려 연차 전환 신호를 통째로 잃기 때문이다.
 */

/** 선정 시 부여하는 기본 베타 기간(개월). 총 기간의 1층. */
export const FOUNDER_BETA_MONTHS = 3;

/** 성실 설문이 루브릭을 통과했을 때 채워 주는 **총** 기간(개월). 2층. */
export const FOUNDER_PRO_MONTHS = 5;

/** 우수 응답자가 화상 인터뷰까지 완료했을 때의 **총** 기간(개월). 3층. */
export const FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS = 9;

/**
 * ★legacy 문서의 베타 창을 **재구성**할 때만 쓰는 값. 정책 값이 아니다.
 *
 * `betaExpiresAt` 없이 `accessGrantedAt` 만 있는 옛 founders 문서가 있다. 그
 * 문서들이 선정될 당시 우리가 한 약속은 "1개월"이었고, 재구성은 **그때의 약속을
 * 복원**하는 일이지 오늘의 정책을 소급 적용하는 일이 아니다.
 *
 * 여기를 FOUNDER_BETA_MONTHS 로 두면 상수를 3으로 올리는 순간 legacy 선정자
 * 전원의 만료일이 `accessGrantedAt + 3개월` 로 **조용히 소급 연장**된다 —
 * 코드 한 줄로 승인 없는 실데이터 변경이 일어난다. 소급 여부는 별도 판단이며
 * 드라이런 → 승인 → 명시적 스크립트 실행 경로로만 해야 한다.
 * (드라이런: `scripts/dryrun-founder-beta-retro-extend.mjs`)
 */
export const FOUNDER_LEGACY_BETA_MONTHS = 1;

/**
 * 월 단위 가산. `setMonth` 라 월경계를 넘긴다(1/31 + 1개월 = 3/2 또는 3/3).
 * 파운더 부여·만료 계산이 전부 이 한 함수를 통과해야 경로별로 어긋나지 않는다.
 */
export function addMonths(base: Date, months: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** 계단 한 층. 총 기간과 직전 층 대비 증분을 함께 들고 있다. */
export interface FounderLadderStep {
  /** 단계 식별자. */
  key: "beta" | "survey" | "interview";
  /** 이 단계까지 도달했을 때의 **총** 무료 기간(개월). */
  totalMonths: number;
  /** 직전 단계 대비 증분(개월). 1층은 자기 자신. */
  incrementMonths: number;
}

/**
 * 계단을 배열로 편다. 테스트가 불변식(단조 증가·증분 증가)을 검사하는 단일
 * 지점이고, 어드민 화면이나 문구 생성이 값을 다시 적어 넣지 않게 하는 SoT 다.
 */
export function founderLadderSteps(): FounderLadderStep[] {
  const totals: Array<[FounderLadderStep["key"], number]> = [
    ["beta", FOUNDER_BETA_MONTHS],
    ["survey", FOUNDER_PRO_MONTHS],
    ["interview", FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS],
  ];
  let previous = 0;
  return totals.map(([key, totalMonths]) => {
    const step: FounderLadderStep = {
      key,
      totalMonths,
      incrementMonths: totalMonths - previous,
    };
    previous = totalMonths;
    return step;
  });
}
