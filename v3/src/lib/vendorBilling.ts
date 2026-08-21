/**
 * 벤더별 **과금축 사실** — "이 벤더는 무엇을 소진하는가" 한 줄.
 *
 * ── ★왜 잔액 숫자가 없는가(조사 결과, 2026-07-27) ────────────────────────
 * 이 티켓의 원래 전제는 "GLM(zai)/MiniMax 는 프리페이드라 잔액 API 로 조회한다"
 * 였다. 두 벤더의 기계판독 문서 인덱스(`/llms.txt`)를 통째로 훑어 api-reference
 * 전 페이지를 열거한 결과, **둘 다 잔액·쿼터 조회 공개 API 가 없다**:
 *
 *   - MiniMax  platform.minimax.io/docs/llms.txt → api-reference 전 항목
 *     (text/image/video/audio/file/models)에 account·balance·quota 엔드포인트 없음.
 *     잔액은 콘솔 전용(Account > Billing > Balance), Token Plan 쿼터도 "콘솔의
 *     usage bar"(docs/token-plan/intro.md).
 *   - Z.ai     docs.z.ai/llms.txt → api-reference 전 항목(llm/agents/image/video/
 *     audio/tools/rate-limit)에 없음. 쿼터 소진 현황은 웹 콘솔에서 보라고 FAQ 가
 *     명시(devpack/faq.md).
 *
 * 게다가 전제 자체가 틀렸다 — 둘 다 프리페이드가 아니라 **구독형 쿼터**(5시간
 * 롤링 + 주간 창)다. GLM Coding Plan 은 쿼터가 떨어져도 계정 잔액을 깎지 않는다고
 * FAQ 가 못박는다("The system will not deduct from your account balance").
 *
 * 그래서 이 모듈은 **숫자를 만들어내지 않는다**. 담는 것은 (a) 확인된 과금축,
 * (b) 사용자가 1초 만에 실물을 확인할 벤더 콘솔 URL(둘 다 1차 문서에서 그대로
 * 읽은 링크)뿐이고, 수치 칸은 화면에서 "조회불가(벤더 API 미제공)"로 정직하게
 * 비운다. 벤더가 나중에 엔드포인트를 내면 `quotaApi` 를 그 자리에 배선한다.
 *
 * ── ★그 "나중" 이 왔다 — DeepSeek (2026-08-21) ───────────────────────────
 * 위 문단은 2026-07-27 시점의 사실이고, 그때는 **전 벤더가 `quotaApi: null`** 이었다.
 * DeepSeek 은 그 전제를 깨는 첫 벤더다: 구독제가 없는 **선불 충전**이고
 * (`docs` 가 "topped-up balance or granted balance" 로 차감 대상을 명시한다),
 * 잔액 조회 공개 API 를 낸다 — `GET /user/balance`
 * (https://api-docs.deepseek.com/api/get-user-balance, 2026-08-21 확인).
 *
 * ★그래서 `quotaApi` 는 이제 **null 아닌 값을 가질 수 있는 타입**이다. 다만 여기
 * 적히는 건 "어느 프로브를 쓰나" 하는 **id 하나**뿐이다 — URL·키·헤더는 이 파일에
 * 오지 않는다. 이 모듈은 렌더러에서 import 되고, 렌더러는 벤더 크레덴셜을 볼 수
 * 없어야 하기 때문이다. 실제 호출은 메인 프로세스의 `electron/vendor-balance.ts`
 * 가 하고, 렌더러로 내려오는 것은 **금액·통화·상태**뿐이다.
 *
 * ★실제로 검증 가능한 축 하나는 화면에 남는다 — **크레덴셜 설정 여부**. 이건
 * 메인 프로세스가 `process.env` 로 판정해 `models:quickLaneCatalog` 로 내려주는
 * 사실이고(키 **이름**과 boolean 뿐, 값은 내려오지 않는다), 우리가 지어낸 값이
 * 아니다.
 */

/** 이 벤더가 무엇을 소진하는가. */
export type BillingAxis =
  /** 정액 구독. 남은 "잔액" 개념 자체가 없고 한도는 리셋되는 창으로 표현된다. */
  | "subscription"
  /** 정액 구독 + 명시적 쿼터 창(5시간 롤링 + 주간). GLM/MiniMax. */
  | "subscription-quota"
  /**
   * 선불 충전. 계정 잔액에서 토큰 단가만큼 깎이고, 잔액이 0 이면 호출이 막힌다.
   * 구독 창(5시간·주간)이라는 개념이 없어서 "남은 한도" 가 아니라 **금액**이 축이다.
   */
  | "prepaid"
  /** 우리가 벤더를 모르는 자리(local/custom) — 판단 자체를 하지 않는다. */
  | "unknown";

/**
 * 잔액 프로브 id. **문자열 하나**이고, 이것이 가리키는 실제 엔드포인트·인증은
 * 전부 메인 프로세스(`electron/vendor-balance.ts` 의 `BALANCE_PROBES`)에 있다.
 * 렌더러는 "이 벤더는 조회 가능하다" 는 사실만 알면 되고, 그 이상을 알면 안 된다.
 */
export type VendorQuotaApiId = "deepseek-user-balance";

export interface VendorBillingFact {
  axis: BillingAxis;
  /**
   * 잔여량을 조회할 수 있는 공개 API 의 프로브 id. null 이면 조회 수단이 없다는
   * **확인된 사실**이다(위 조사) — 화면은 그 자리를 "조회불가" 로 비운다.
   */
  quotaApi: VendorQuotaApiId | null;
  /**
   * 사용자가 실물을 확인할 벤더 콘솔 URL. 1차 문서에서 읽은 것만 적는다 —
   * 없으면 undefined(추측 URL 금지).
   */
  consoleUrl?: string;
}

/**
 * 벤더 → 과금축. 키는 `model-registry.VendorId` 와 같은 문자열이다.
 *
 * 근거:
 *   anthropic / openai — CLI 자기 구독(Max/Pro, ChatGPT plan). 5시간·주간 한도는
 *     이미 "한도(Rate limit) 상태" 패널이 **실측**으로 그린다(usage:accountRateLimits).
 *   xai              — Grok Build 는 브라우저 인증 = SuperGrok 구독 경로다. 토큰
 *     단가로 선불 충전하는 축이 아니다(벤더 서베이 정정 이력).
 *   zai / minimax    — 위 파일 주석의 1차 문서 인용.
 *   deepseek         — **선불 충전**(prepaid). 구독 상품이 없고 공식 문서가 차감
 *     대상을 "topped-up balance or granted balance" 로 적는다(2026-08-21 확인).
 *     유일하게 잔액 조회 API 가 배선된 벤더다.
 *   google           — 축을 라이브로 확인하지 못했다. 모르면 unknown 이 정직하다.
 *
 * ★이 표에서 벤더가 빠지면 폴백(`axis: "unknown"`)으로 조용히 떨어져 화면이
 * "과금축 미상" 이 된다 — deepseek 이 정확히 그랬다. 활성 모델 행이 있는 벤더가
 * 여기 다 있는지는 `tests/unit/vendor-axis-coverage.test.ts` 가 지킨다.
 */
export const VENDOR_BILLING: Readonly<Record<string, VendorBillingFact>> = {
  anthropic: { axis: "subscription", quotaApi: null },
  openai: { axis: "subscription", quotaApi: null },
  xai: { axis: "subscription", quotaApi: null },
  zai: {
    axis: "subscription-quota",
    quotaApi: null,
    // docs.z.ai/devpack/faq.md 가 "쿼터 소비 진행률은 여기서 보라" 고 준 링크.
    consoleUrl: "https://z.ai/manage-apikey/subscription",
  },
  minimax: {
    axis: "subscription-quota",
    quotaApi: null,
    // docs/token-plan/intro.md 의 "Account / Token Plan" 링크 원문.
    consoleUrl: "https://platform.minimax.io/user-center/payment/token-plan",
  },
  deepseek: {
    axis: "prepaid",
    // ★전 벤더 중 유일하게 null 이 아닌 칸. 실제 호출은 메인 프로세스가 한다.
    quotaApi: "deepseek-user-balance",
    // consoleUrl 없음 — 충전 페이지 URL 을 1차 문서에서 그대로 읽어오지 못했다.
    // 이 표의 규율은 "추측 URL 금지" 이고, 잔액 자체는 위 quotaApi 로 화면에
    // 뜨므로 콘솔 링크가 없다고 사용자가 눈이 머는 자리도 아니다.
  },
  google: { axis: "unknown", quotaApi: null },
  moonshot: { axis: "unknown", quotaApi: null },
  upstage: {
    axis: "unknown",
    quotaApi: null,
    consoleUrl: "https://console.upstage.ai/",
  },
  local: { axis: "unknown", quotaApi: null },
  custom: { axis: "unknown", quotaApi: null },
};

export function billingFor(vendor: string): VendorBillingFact {
  return (
    VENDOR_BILLING[vendor.trim().toLowerCase()] ?? {
      axis: "unknown",
      quotaApi: null,
    }
  );
}
