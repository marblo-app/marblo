/**
 * **로컬 모델 tool-use 티어 판정 — 단일 소스.**
 *
 * 이 파일은 의존성이 0이다(의도적). `local-models.ts`(카탈로그·스토어)와
 * `model-registry.ts`(스폰 축 등록)가 **양쪽 다** 이 판정을 필요로 하는데,
 * local-models → model-registry 방향의 import 가 이미 있어서 반대 방향을 추가하면
 * 순환이 된다. 그래서 registry 쪽이 임계값을 복붙해 두고 있었고("카탈로그 import
 * 순환 회피"), 그 복붙이 곧 드리프트 위험이었다 — 임계를 한쪽만 고치면 스토어
 * 카드와 스폰 레지스트리가 다른 말을 한다. 여기로 끌어내 둘이 같은 함수를 부른다.
 *
 * ── ★임계값의 정직성 ────────────────────────────────────────────────────
 * 아래 두 경계(25B / 30B)는 **실측값이 아니라 추정치다.** 근거로 있는 것은:
 *   · 0.5b/7b/14b 급이 MCP 툴 스키마 + tool 강제 system 을 받으면 tool_use JSON 을
 *     흉내내고 무너진다는 실측(ollama 0.32.14 + claude CLI env-swap).
 *   · 26B 급에서 "superpowers 스킬 + MCP 41툴 + 완료규약 full 주입"이 과부하로
 *     측정됐다는 관측(티켓 X8ZzPLey1Uk7uFm8q3bv). ★주의: 이건 "26B 는 도구를 못
 *     쓴다"가 아니라 "**그 주입량으로는** 못 쓴다"는 관측이다. 그래서 25~30B 를
 *     그냥 tool-use 로 올리는 대신 주입량을 깎은 lite 티어를 만든다.
 *   · devstral 24b 를 "사장님 판단 위해 일단 chat-only 로" 남겨 둔 결정(#1036).
 * 어느 것도 "29B 는 되고 24B 는 안 된다"를 증명하지 않는다. 경계는 실측이 오면
 * 이 상수 두 개만 고치면 되도록 여기 모아 뒀다.
 *
 * ── 실측할 때 볼 지표(맥미니 검증용) ────────────────────────────────────
 *   1. 도구 호출 성공률 — 한 턴에서 의도한 MCP 툴이 실제 tool_use 로 나가고
 *      결과를 받아 다음 턴을 이어가는 비율. 이게 경계의 1차 판정 기준이다.
 *   2. 가짜 JSON 빈도 — 툴을 부르는 대신 tool_use 처럼 생긴 텍스트를 본문에
 *      뱉는 빈도. 0 이 아니면 그 크기는 그 주입량을 못 견딘다는 뜻이다.
 *   3. 응답 지연 — 첫 토큰까지 / 한 턴 완료까지. 정확해도 너무 느리면 티어를
 *      올릴 이유가 없다(사람이 기다리는 축이 아니라 오케가 기다리는 축이다).
 * 셋을 같은 티켓 한 개로 (a) lite 프로파일, (b) full tool-use 프로파일 두 조건에서
 * 재면 경계가 크기 때문인지 주입량 때문인지 분리된다.
 */

/**
 * 로컬 모델의 하네스 tool-use 적합성 — 3단계.
 *
 *   chat-only     대화 전용. MCP/툴 스키마를 아예 싣지 않는다(`--tools ""`).
 *   tool-use-lite 도구는 주되 주입을 깎는다. MCP 표면 최소 + 역할 스킬 전문 대신
 *                 짧은 브리프 + 완료규약 compact.
 *   tool-use      기존 대형 로컬 경로. 역할 스킬 전문까지 주입한다.
 */
export type LocalToolSupport = "chat-only" | "tool-use-lite" | "tool-use";

/**
 * full tool-use 로 올리는 최소 파라미터 규모(B). ★추정치 — 파일 헤더 참조.
 * 이 아래는 lite 이거나 chat-only 다.
 */
export const LOCAL_TOOL_USE_MIN_BILLIONS = 30;

/**
 * 경량(lite) tool-use 로 올리는 최소 파라미터 규모(B). ★추정치 — 파일 헤더 참조.
 * 사장님 요청("25B 이상은 경량 주입과 도구 호출 가능하도록")이 정한 값이고,
 * 그 위 경계(30B)는 종전 그대로 둔다 — 기존 tool-use 모델의 동작을 바꾸지 않기
 * 위해서다.
 */
export const LOCAL_TOOL_USE_LITE_MIN_BILLIONS = 25;

/**
 * ollama 태그에서 파라미터 규모(B)를 읽는다. 못 읽으면 null.
 * 예: `qwen2.5:0.5b`→0.5, `phi3:mini`→3.8, `qwen3.8:27b`→27,
 *     `deepseek-r1:8b-0528-…`→8.
 *
 * ★`qwen3.8:27b` 처럼 **모델명 자체에 소수점이 든** 태그를 조심할 것. 정규식은
 * 숫자 바로 뒤에 `b` 가 오는 곳만 잡으므로 `3.8` 은 걸리지 않고 `27` 이 잡힌다.
 */
export function parseLocalParamBillions(id: string): number | null {
  const trimmed = id.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "phi3:mini" || trimmed.startsWith("phi3:mini-")) return 3.8;
  const match = /(\d+(?:\.\d+)?)b\b/.exec(trimmed);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 로컬 모델 id → tool-use 티어(크기 규칙만).
 *
 * 파라미터를 못 읽으면 안전하게 chat-only — 모르는 것을 도구 티어로 올리면
 * 실패가 조용하다(가짜 JSON 을 뱉으며 일한 척한다).
 *
 * ★크기만으로 판단이 안 되는 모델(코더 특화 등)은 이 함수를 고치지 말고
 * 카탈로그 행의 명시 override 를 쓸 것 — `local-models.ts` 의
 * `buildLocalCatalogEntry({ toolSupport, toolSupportOverrideReason })`.
 */
export function resolveLocalToolSupport(id: string): LocalToolSupport {
  const billions = parseLocalParamBillions(id);
  if (billions === null) return "chat-only";
  if (billions >= LOCAL_TOOL_USE_MIN_BILLIONS) return "tool-use";
  if (billions >= LOCAL_TOOL_USE_LITE_MIN_BILLIONS) return "tool-use-lite";
  return "chat-only";
}

/** UI 배지 문구. 세 티어가 서로 다른 말을 하도록 — lite 를 대화전용으로 보이면 안 된다. */
export function localToolSupportLabel(support: LocalToolSupport): string {
  switch (support) {
    case "tool-use":
      return "도구 사용 가능(대형 모델)";
    case "tool-use-lite":
      return "도구 사용 가능(경량 주입)";
    default:
      return "대화·업무 분배";
  }
}

/** 도구를 아예 안 싣는 티어인가(= 대화모드 스폰). */
export function isChatOnlyToolSupport(support: LocalToolSupport): boolean {
  return support === "chat-only";
}

/** 도구를 싣는 티어인가(lite 포함). */
export function isToolCapableToolSupport(support: LocalToolSupport): boolean {
  return support !== "chat-only";
}
