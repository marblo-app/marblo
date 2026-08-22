/**
 * 데스크톱 → 웹 체크아웃 링크 (국내 결제 · 포트원). 순수 계산만(의존성 0) —
 * 단위 테스트 진입점이다. 부수효과(브라우저 열기, 상태 갱신)는 호출부인
 * components/settings/BillingPage.tsx 가 담당한다.
 *
 * ─── 왜 인앱 SDK 가 아니라 브라우저인가 ────────────────────────────────
 *
 * 예전 데스크톱 결제는 토스페이먼츠 SDK 를 렌더러에 직접 임베드하고
 * `successUrl: ${window.location.origin}/settings/billing?toss_success=true`
 * 로 리다이렉트를 기대했다. ★그 origin 은 Electron 에서 앱 자신의 로더
 * (file:// 또는 127.0.0.1 정적 서버)라, PG 가 거기로 리다이렉트해도 결제
 * 결과가 앱 화면으로 돌아오지 않는다. 웹 기준 코드가 데스크톱에 그대로
 * 들어와 있었던 것이다.
 *
 * 포트원 SDK 로 갈아끼우는 것으로는 그 함정이 안 풀린다. 국내 결제는
 * 리다이렉트·3DS 인증·PG 팝업을 타고, 그걸 Electron 렌더러 안에서 감당하려면
 * 특수 케이스가 계속 붙는다(창 열기 정책, 외부 링크 핸들러 예외, 인증 창의
 * 세션 쿠키, 복귀 딥링크…).
 *
 * ★그리고 웹 체크아웃(marblo-web /checkout)은 이미 있고, 포트원 이니시스
 * 심사·실제 테스트 결제를 완주한 유일한 경로다. 앱에 두 번째 결제 구현을
 * 만들면 둘 중 하나만 고쳐지는 상태가 반드시 온다.
 *
 * → 그래서 앱은 **결제를 하지 않는다. 결제로 데려다줄 뿐이다.** 링크 하나가
 *   앱이 지는 전부이고, 결제·검증·원장은 이미 검증된 웹/서버 경로가 그대로
 *   맡는다. 결제가 끝나면 서버가 subscriptions 문서를 쓰고, 앱은 이미 걸어둔
 *   onSnapshot 구독으로 그 변경을 받는다(BillingPage 참조).
 */
import type { PlanType } from "../types/subscription";

/** 웹 서비스 오리진. services/publicReplayService·lib/attributionLink 와 같은 값. */
export const WEB_CHECKOUT_BASE_URL = "https://marblo.app";

/**
 * 웹 /checkout 이 가격표를 가진 플랜만 결제 링크를 만든다.
 * free 는 결제 대상이 아니고, enterprise 는 별도 협의(Contact Sales)다 —
 * 링크를 만들어 보내면 웹에서 금액 0 짜리 빈 결제창이 뜬다.
 */
const CHECKOUT_PLANS: readonly PlanType[] = ["pro", "team", "team_plus"];

export type CheckoutBillingCycle = "monthly" | "annual";

/**
 * 웹의 기본 로케일. 이 로케일만 URL 에서 접두사를 **떼야** 한다 —
 * marblo-web 의 `routing.ts` 가 `localePrefix: "as-needed"` 이고 defaultLocale
 * 이 ko 다. `/ko/checkout` 도 결국 `/checkout` 으로 301 되며 쿼리는 보존되지만,
 * 결제 진입에 리다이렉트 한 번을 공짜로 얹을 이유가 없다(실측: 301 → 200).
 */
const WEB_DEFAULT_LOCALE = "ko";

export interface WebCheckoutUrlArgs {
  plan: PlanType;
  /** 앱 로케일. ko/en 외의 값은 ko 로 접는다(웹 라우팅과 동일 규약). */
  locale: string;
  /** 기본 monthly — 데스크톱 플랜 카드가 월 요금만 보여준다. */
  billing?: CheckoutBillingCycle;
  /** 테스트·스테이징 오버라이드. 프로덕션에서는 넘기지 않는다. */
  baseUrl?: string;
}

/**
 * 웹 체크아웃 URL 을 만든다.
 *
 * @returns 결제할 수 없는 플랜(free/enterprise)이면 null — 창을 열지 않는다.
 */
export function buildWebCheckoutUrl(args: WebCheckoutUrlArgs): string | null {
  if (!CHECKOUT_PLANS.includes(args.plan)) return null;

  const locale = args.locale === "en" ? "en" : "ko";
  const params = new URLSearchParams({
    plan: args.plan,
    // ★provider 를 명시한다. 웹의 기본 결제사는 운영 env
    // (NEXT_PUBLIC_PAYMENT_PROVIDER)에 달려 있어 앱이 알 수 없는 값이다.
    // 국내 결제는 포트원으로 못 박아 보낸다 — 앱이 토스 경로로 흘러들어갈
    // 여지를 URL 단에서 없앤다.
    provider: "portone",
    billing: args.billing ?? "monthly",
  });

  const base = (args.baseUrl ?? WEB_CHECKOUT_BASE_URL).replace(/\/+$/, "");
  const prefix = locale === WEB_DEFAULT_LOCALE ? "" : `/${locale}`;
  return `${base}${prefix}/checkout?${params.toString()}`;
}
