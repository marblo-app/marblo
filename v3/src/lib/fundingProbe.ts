import { stripAnsi } from "./ansi";
import type { CliProbeLike } from "./oneClickSetup";
import type { CliModel } from "../stores/cliSetupStore";

/**
 * ★"인증은 됐는데 못 돈다" 를 판정하는 순수 로직 (티켓 sVdwTsiGq6qZVAmSkwZB).
 *
 * 지금까지 온보딩이 아는 상태는 두 개뿐이었다 — `authenticated !== true`(인증
 * 안 됨) 와 `ready`(끝). 그 사이에 실제로 존재하는 세 번째 상태가 빠져 있었다:
 * **로그인은 성공했지만 그 계정에 구독/크레딧이 없어 CLI 가 한 턴도 못 도는**
 * 경우다. 화면은 "연결됐어요" 를 띄우고, 오케는 아무 말도 없이 안 돈다.
 *
 * 그래서 인증 직후 **짧은 헤드리스 턴 하나**를 돌려 실행 가능 여부를 실측하고,
 * 그 출력에서 원인을 읽는다. 여기 있는 것은 그 출력 → 판정의 순수 함수뿐이라
 * PTY 도 DOM 도 없이 테스트된다.
 *
 * ★이 파일의 유일한 설계 원칙은 **오판 금지**다. 정상 구독 유저에게 "구독이
 * 없어요" 를 띄우는 쪽이, 문제 있는 유저에게 아무것도 안 띄우는 쪽보다 훨씬
 * 나쁘다(전자는 돈 낸 사람을 문 앞에서 돌려세운다). 그래서 판정은 한 방향으로만
 * 보수적이다:
 *
 *   - 확신이 없으면 **정상(ok)** 으로 떨어진다. `unfunded` 는 벤더가 사실상
 *     그 말을 문장으로 쓴 경우에만 나온다.
 *   - 실패는 확실한데 원인이 모호하면 `blocked` — 화면은 "인증은 됐지만 실행이
 *     안 돼요" 라는 **중립** 안내를 쓴다(구독 없다고 단정하지 않는다).
 *   - 프로브 자체가 못 돌았으면(스폰 실패·타임아웃) `inconclusive` — 아무것도
 *     띄우지 않는다. "모르겠다" 로 사용자를 막지 않는다.
 */

/**
 * 프로브가 모델에게 시키는 일. 답이 필요해서가 아니라 **한 턴이 도는가**를 보려는
 * 것이므로 가능한 한 짧다.
 *
 * ★기대 토큰(`PROBE_OK_TOKEN`)이 프롬프트 안에 **통째로 들어 있지 않은** 것이
 * 의도다. codex 의 `--json` 스트림은 사용자 턴(=우리 프롬프트)을 이벤트로 되
 * 비추는데, 프롬프트에 완성된 토큰이 박혀 있으면 실패한 실행에서도 토큰이
 * 보여서 "성공" 으로 오판한다. 조각을 이어 붙이라고 시키면 토큰은 **모델이 실제로
 * 답했을 때만** 등장한다.
 */
export const PROBE_PROMPT =
  "Reply with only the word MARBLO followed by _OK and nothing else.";
export const PROBE_OK_TOKEN = "MARBLO_OK";

/** 프로브 한 턴의 상한. 구독/크레딧 오류는 보통 수 초 안에 떨어진다. */
export const PROBE_TIMEOUT_MS = 45_000;

export type FundingVerdict =
  /** 한 턴이 실제로 돌았다 — 막을 이유가 없다. */
  | "ok"
  /** 구독/크레딧이 없다고 벤더가 명시했다. */
  | "unfunded"
  /** 실행은 실패했는데 원인이 구독 문제라고 단정할 수 없다. */
  | "blocked"
  /** 프로브 자체가 못 돌았다 — 판단하지 않는다(아무것도 띄우지 않는다). */
  | "inconclusive";

/** `blocked` 의 하위 사유. 화면 문구만 조금 달라지고, 결론은 전부 중립이다. */
export type FundingBlockedReason =
  /** 요금제는 있는데 지금 한도에 걸렸다(=구독 있음). */
  | "rate_limit"
  /** CLI 가 다시 로그인하라고 한다(프로브 시점에 인증이 깨졌다). */
  | "auth"
  /** 실패했다는 것 외에는 모른다. */
  | "unknown";

export interface FundingProbeOutcome {
  verdict: FundingVerdict;
  /** `blocked` 일 때의 사유. 다른 verdict 에서는 undefined. */
  blockedReason?: FundingBlockedReason;
  /** 어떤 CLI 를 돌린 결과인가 — 구독 링크가 이걸 따라간다. */
  model: CliModel;
  /**
   * 사용자에게 그대로 보여줄 원문 꼬리(잘라서). 중립 안내에서 "무슨 일이
   * 있었는지" 를 감추지 않기 위한 것 — 조용한 실패를 만들지 않는다.
   */
  detail: string;
}

export interface FundingProbeInput {
  model: CliModel;
  /** PTY 원문(ANSI 포함 가능). */
  raw: string;
  exitCode: number | null;
  /** 상한 시간을 넘겨서 우리가 끊었는가. */
  timedOut?: boolean;
  /** 프로세스를 띄우는 것 자체가 실패했는가. */
  spawnFailed?: boolean;
}

/**
 * ★레이트리밋 문구가 **구독 문구보다 먼저** 검사된다. 이 순서가 이 파일에서
 * 가장 중요한 한 줄이다.
 *
 * 한도에 걸린 유료 유저에게 벤더는 대개 "usage limit reached — upgrade to
 * Max" 처럼 **업그레이드 권유를 같은 문장에** 붙여 인쇄한다. 업그레이드 문구만
 * 보고 판정하면 그 순간 돈 내고 쓰는 사용자에게 "구독이 없으세요" 를 띄우게
 * 된다. 한도 문구가 보이면 그건 요금제가 **있다는** 증거이므로 여기서 끊는다.
 */
const RATE_LIMIT_MARKERS = [
  "usage limit reached",
  "usage limit will reset",
  "hit your usage limit",
  "reached your usage limit",
  "rate limit",
  "rate_limit",
  "too many requests",
  "limit resets",
];

/** 프로브 시점에 인증이 깨져 있었다 — 구독 문제가 아니다. */
const AUTH_MARKERS = [
  "please run /login",
  "run `claude login`",
  "not logged in",
  "no credentials",
  "invalid api key",
  "authentication_error",
  "unauthorized",
];

/**
 * "구독/크레딧이 없다" 를 벤더가 사실상 문장으로 쓴 경우만. 느슨한 단어
 * (`quota`, `plan`, `billing` 단독)는 일부러 넣지 않았다 — 그 단어들은 정상
 * 유저의 한도 안내에도 그대로 등장한다. 맨 상태코드(`401`/`402`)도 뺐다: 세 자리
 * 숫자는 토큰 수·소요 시간·버전 문자열 어디에나 부분일치한다.
 */
const UNFUNDED_MARKERS = [
  "credit balance is too low",
  "insufficient credit",
  "insufficient credits",
  "insufficient_quota",
  "insufficient quota",
  "out of credits",
  "no credits remaining",
  "purchase credits",
  "add credits",
  "no active subscription",
  "active subscription required",
  "subscription required",
  "requires an active subscription",
  "requires a subscription",
  "you need a subscription",
  "exceeded your current quota",
  "check your plan and billing",
  "add a payment method",
  "payment required",
];

/**
 * ANSI 를 걷고 CRLF 를 정규화한다(PTY 원문 → 검사 가능한 텍스트). 퀵액션의
 * `normalizePtyText` 와 같은 처리이고, ANSI 제거는 같은 `lib/ansi` 를 쓴다 —
 * 이스케이프 시퀀스가 문구 중간에 남아 있으면 마커 매칭이 그냥 어긋난다.
 */
export function normalizeProbeOutput(raw: string): string {
  return stripAnsi(raw).replace(/\r\n/g, "\n").replace(/\r/g, "");
}

function hasAny(haystack: string, markers: string[]): boolean {
  return markers.some((m) => haystack.includes(m));
}

/** 중립 안내에 붙일 원문 꼬리. 길면 자른다(모달을 로그 뷰어로 만들지 않는다). */
function tail(text: string, max = 400): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(-max)}`;
}

/**
 * 프로브 한 턴의 원문 → 판정.
 *
 * 순서가 곧 계약이다(위에서부터 이긴다):
 *  1. 프로브가 못 돌았다              → inconclusive (아무것도 안 띄운다)
 *  2. 기대 토큰이 보인다               → ok (한 턴이 실제로 돌았다는 직접 증거)
 *  3. 한도 문구                        → blocked/rate_limit (요금제는 있다)
 *  4. 재로그인 문구                    → blocked/auth
 *  5. 구독·크레딧 문구                 → unfunded
 *  6. 출력이 비었다                    → inconclusive
 *  7. 종료코드가 0 이 아니다           → blocked/unknown
 *  8. 그 밖의 모든 경우                → ok  ← ★기본값이 통과인 것이 핵심이다
 */
export function classifyFundingProbe(
  input: FundingProbeInput,
): FundingProbeOutcome {
  const { model, raw, exitCode, timedOut, spawnFailed } = input;
  const base = { model } as const;

  if (spawnFailed || timedOut) {
    return { ...base, verdict: "inconclusive", detail: "" };
  }

  const text = normalizeProbeOutput(raw);
  const lower = text.toLowerCase();

  if (text.includes(PROBE_OK_TOKEN)) {
    return { ...base, verdict: "ok", detail: "" };
  }

  if (hasAny(lower, RATE_LIMIT_MARKERS)) {
    return {
      ...base,
      verdict: "blocked",
      blockedReason: "rate_limit",
      detail: tail(text),
    };
  }

  if (hasAny(lower, AUTH_MARKERS)) {
    return {
      ...base,
      verdict: "blocked",
      blockedReason: "auth",
      detail: tail(text),
    };
  }

  if (hasAny(lower, UNFUNDED_MARKERS)) {
    return { ...base, verdict: "unfunded", detail: tail(text) };
  }

  if (!text.trim()) {
    // 아무 말도 없이 끝났다. 실패인지 우리가 너무 일찍 읽은 것인지 모른다.
    return { ...base, verdict: "inconclusive", detail: "" };
  }

  if (exitCode !== null && exitCode !== 0) {
    return {
      ...base,
      verdict: "blocked",
      blockedReason: "unknown",
      detail: tail(text),
    };
  }

  return { ...base, verdict: "ok", detail: "" };
}

/**
 * 프로브를 실제로 돌릴 수 있는 CLI 의 인자.
 *
 * 오케 후보(Claude/Codex)만 지원한다. grok·antigravity 는 헤드리스 계약을
 * 실측하지 못했고, 모르는 CLI 에 추측한 플래그를 던지면 프로브가 **실패로**
 * 떨어져 정상 유저에게 경고를 띄우게 된다 — 지원하지 않는 편이 안전하다
 * (null = 프로브 생략 = 아무것도 안 띄움).
 */
export function probeArgs(model: CliModel): string[] | null {
  if (model === "claude") return ["--print", PROBE_PROMPT];
  if (model === "codex") {
    return [
      "exec",
      "--json",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      PROBE_PROMPT,
    ];
  }
  return null;
}

export function canProbeFunding(model: CliModel): boolean {
  return probeArgs(model) !== null;
}

/**
 * 어느 CLI 로 프로브를 돌릴 것인가.
 *
 * 설치+인증이 끝났고 프로브를 지원하는 행 중 하나다. 오케 후보(Claude/Codex)를
 * 우선하는 이유는 `signInRows` 와 같다 — 오케를 실제로 돌릴 CLI 의 실행 가능
 * 여부가 사용자가 겪는 진실이다. 대상이 없으면 null(=프로브 생략).
 */
export function fundingProbeTarget<R extends { id: string; model: CliModel }>(
  rows: R[],
  results: Record<string, CliProbeLike | undefined>,
  priorityIds: string[] = [],
): R | null {
  const eligible = rows.filter((r) => {
    const s = results[r.id];
    return (
      s?.installed === true &&
      s.authenticated === true &&
      canProbeFunding(r.model)
    );
  });
  const rank = (id: string) => {
    const i = priorityIds.indexOf(id);
    return i === -1 ? priorityIds.length : i;
  };
  return [...eligible].sort((a, b) => rank(a.id) - rank(b.id))[0] ?? null;
}

// ── 온보딩이 읽는 상태 ────────────────────────────────────────────────────

/**
 * 온보딩 표면이 실제로 분기하는 **네 가지** 상태. 종전에는 앞의 둘밖에 없었다.
 */
export type OnboardingAuthState =
  | "unauthenticated"
  | "authenticated"
  /** 로그인은 됐는데 구독/크레딧이 없다. */
  | "authedButUnfunded"
  /** 로그인은 됐는데 이유가 뭐든 한 턴이 안 돈다(중립). */
  | "authedButBlocked";

export interface FundingProbeState {
  /** 프로브가 돌고 있는가. */
  checking: boolean;
  /** 마지막 판정. 아직 안 돌렸으면 null. */
  outcome: FundingProbeOutcome | null;
}

/**
 * `ready`(설치+인증) 와 프로브 판정을 합쳐 온보딩 상태를 만든다.
 *
 * `ready` 가 아니면 프로브 결과가 무엇이든 "인증 안 됨" 이다 — 기존 인증 플로우가
 * 그대로 맡는다. 프로브가 아직 없거나(`null`) 판단 불가면 **정상으로 본다**:
 * 모르는 것이 사용자를 막는 이유가 되어서는 안 된다.
 */
export function onboardingAuthState(input: {
  ready: boolean;
  funding: FundingProbeState;
}): OnboardingAuthState {
  if (!input.ready) return "unauthenticated";
  const verdict = input.funding.outcome?.verdict;
  if (verdict === "unfunded") return "authedButUnfunded";
  if (verdict === "blocked") return "authedButBlocked";
  return "authenticated";
}

/**
 * 가이드 모달을 띄울 것인가. 프로브가 도는 중에는 띄우지 않는다(재확인 버튼을
 * 눌렀을 때 모달이 깜빡이며 사라졌다 나타나는 것을 막는다 — 모달 안에서
 * 스피너를 돌린다), 사용자가 닫았으면 다시 띄우지 않는다.
 */
export function shouldShowFundingGuide(input: {
  state: OnboardingAuthState;
  dismissed: boolean;
}): boolean {
  if (input.dismissed) return false;
  return (
    input.state === "authedButUnfunded" || input.state === "authedButBlocked"
  );
}
