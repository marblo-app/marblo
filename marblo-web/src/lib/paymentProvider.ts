import { currencyForLocale } from "./pricing";

export type PaymentProvider = "toss" | "portone" | "paddle";

/**
 * 체크아웃이 어느 PG 로 갈지 결정한다.
 *
 * ★국내(ko/KRW) 기본값이 portone 이다. 이전에는 기본값이 toss 였고, portone 은 URL 에
 * `?provider=portone` 를 직접 붙이거나 `NEXT_PUBLIC_PAYMENT_PROVIDER=portone`
 * 를 설정해야만 탔다 — 그런데 그 env 는 어느 환경 파일에도 설정된 적이 없다.
 * 즉 실제 프로덕션 신규 결제는 전부 toss 로 가고 있었다. 토스페이먼츠 PG 직결을
 * 접고 국내 결제를 포트원으로 일원화하므로 국내 기본값을 뒤집는다.
 *
 * 해외(en/ja/unknown)는 pricing.currencyForLocale 과 같은 축을 따른다. 그 함수가
 * ko=KRW, ja=JPY, 그 외=USD 로 정하므로 KRW 가 아닌 로케일은 Paddle 로 간다.
 *
 * ★`?provider=toss` 같은 URL 파라미터로는 토스로 되돌아갈 수 없다 — 진입 경로를
 * 닫는 게 목적인데 URL 만 알면 열리면 닫은 게 아니다. 되돌리는 유일한 방법은
 * 운영자가 명시적으로 `NEXT_PUBLIC_PAYMENT_PROVIDER="toss"` 를 설정하는 것이고,
 * 그 경우에도 서버 게이트(TOSS_ENTRY_ENABLED)가 따로 열려 있어야 실제로 결제가
 * 된다. 롤백은 클라이언트·서버 양쪽을 모두 열어야 성립한다(이중 안전장치).
 * portone/paddle env 는 스테이징 검증용 강제 스위치다.
 */
export function resolveCheckoutProvider(input: {
  envProvider?: string | null;
  locale?: string | null;
}): PaymentProvider {
  const env = String(input.envProvider ?? "")
    .trim()
    .toLowerCase();
  if (env === "toss") return "toss";
  if (env === "portone") return "portone";
  if (env === "paddle") return "paddle";
  if (currencyForLocale(String(input.locale ?? "")) !== "KRW") {
    return "paddle";
  }
  return "portone";
}
